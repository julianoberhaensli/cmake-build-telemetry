using System.Reflection;
using Dapper;
using Npgsql;

namespace BuildTelemetry.Api.Data;

/// <summary>
/// Applies embedded <c>Data/Migrations/NNNN_name.sql</c> scripts in order, each in its
/// own transaction. A PostgreSQL advisory lock makes concurrent replicas safe.
/// </summary>
public sealed class MigrationRunner(NpgsqlDataSource dataSource, ILogger<MigrationRunner> logger)
{
    private const long AdvisoryLockKey = 0x42_75_69_6C_64_54_6C_6D; // "BuildTlm"

    /// <summary>Creates the configured database when it does not exist (needs CREATEDB).</summary>
    public async Task<bool> TryCreateDatabaseAsync(CancellationToken ct)
    {
        var csb = new NpgsqlConnectionStringBuilder(dataSource.ConnectionString);
        var name = csb.Database;
        if (string.IsNullOrEmpty(name))
        {
            return false;
        }

        csb.Database = "postgres";
        try
        {
            await using var conn = new NpgsqlConnection(csb.ConnectionString);
            await conn.OpenAsync(ct);
            var quoted = "\"" + name.Replace("\"", "\"\"") + "\"";
            await conn.ExecuteAsync(new CommandDefinition($"create database {quoted}", cancellationToken: ct));
            logger.LogInformation("Created database {Database}", name);
            return true;
        }
        catch (PostgresException ex) when (ex.SqlState is "42P04")
        {
            return true; // created concurrently
        }
        catch (Exception ex) when (ex is NpgsqlException)
        {
            logger.LogWarning(ex, "Database {Database} does not exist and could not be created", name);
            return false;
        }
    }

    public async Task MigrateAsync(CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("select pg_advisory_lock(@k)", new { k = AdvisoryLockKey }, cancellationToken: ct));
        try
        {
            await conn.ExecuteAsync(new CommandDefinition(
                """
                create table if not exists schema_migrations (
                    version    integer primary key,
                    name       text not null,
                    applied_at timestamptz not null default now()
                )
                """, cancellationToken: ct));

            var applied = (await conn.QueryAsync<int>(new CommandDefinition(
                "select version from schema_migrations", cancellationToken: ct))).ToHashSet();

            foreach (var (version, name, sql) in LoadScripts())
            {
                if (applied.Contains(version))
                {
                    continue;
                }

                logger.LogInformation("Applying database migration {Version} ({Name})", version, name);
                await using var tx = await conn.BeginTransactionAsync(ct);
                await conn.ExecuteAsync(new CommandDefinition(sql, transaction: tx, cancellationToken: ct, commandTimeout: 600));
                await conn.ExecuteAsync(new CommandDefinition(
                    "insert into schema_migrations (version, name) values (@version, @name)",
                    new { version, name }, tx, cancellationToken: ct));
                await tx.CommitAsync(ct);
            }
        }
        finally
        {
            await conn.ExecuteAsync("select pg_advisory_unlock(@k)", new { k = AdvisoryLockKey });
        }
    }

    internal static IEnumerable<(int Version, string Name, string Sql)> LoadScripts()
    {
        var asm = Assembly.GetExecutingAssembly();
        const string marker = ".Data.Migrations.";
        foreach (var resource in asm.GetManifestResourceNames().Order(StringComparer.Ordinal))
        {
            var idx = resource.IndexOf(marker, StringComparison.Ordinal);
            if (idx < 0 || !resource.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var file = resource[(idx + marker.Length)..^4];      // 0001_initial
            var sep = file.IndexOf('_');
            if (sep <= 0 || !int.TryParse(file[..sep], out var version))
            {
                continue;
            }

            using var stream = asm.GetManifestResourceStream(resource)!;
            using var reader = new StreamReader(stream);
            yield return (version, file[(sep + 1)..], reader.ReadToEnd());
        }
    }
}

/// <summary>Runs migrations at startup, waiting for the database to become reachable.</summary>
internal sealed class DatabaseInitializer(
    MigrationRunner runner,
    DatabaseReadiness readiness,
    ILogger<DatabaseInitializer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(1);
        for (var attempt = 1; !stoppingToken.IsCancellationRequested; attempt++)
        {
            try
            {
                await runner.MigrateAsync(stoppingToken);
                readiness.MarkReady();
                logger.LogInformation("Database schema is up to date");
                return;
            }
            catch (PostgresException ex) when (ex.SqlState == "3D000")
            {
                // database does not exist yet: create it (if permitted), then retry
                if (!await runner.TryCreateDatabaseAsync(stoppingToken))
                {
                    await Task.Delay(delay, stoppingToken);
                    delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 30));
                }
            }
            catch (Exception ex) when (IsTransient(ex))
            {
                logger.LogWarning(ex, "Database not reachable yet (attempt {Attempt}); retrying in {Delay}", attempt, delay);
                await Task.Delay(delay, stoppingToken);
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 30));
            }
        }
    }

    // Connection problems and "database is starting up" are retried; SQL errors in a
    // migration are not (they stop the host so the problem is visible).
    private static bool IsTransient(Exception ex) => ex switch
    {
        PostgresException pg => pg.SqlState is "57P03" or "53300" or "08006" or "08001",
        NpgsqlException => true,
        TimeoutException => true,
        System.Net.Sockets.SocketException => true,
        _ => false,
    };
}

/// <summary>Signals that migrations completed (used by readiness probe and dependent services).</summary>
public sealed class DatabaseReadiness
{
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public bool IsReady => _ready.Task.IsCompleted;

    public Task WaitAsync(CancellationToken ct) => _ready.Task.WaitAsync(ct);

    public void MarkReady() => _ready.TrySetResult();
}
