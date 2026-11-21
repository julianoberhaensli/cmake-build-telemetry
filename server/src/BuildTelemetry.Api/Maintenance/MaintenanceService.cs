using BuildTelemetry.Api.Data;
using BuildTelemetry.Api.Options;
using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BuildTelemetry.Api.Maintenance;

/// <summary>
/// Periodic housekeeping: data retention, command-line purging and re-classification of
/// full vs. incremental builds once more history is known. Safe to run on every replica
/// (a transaction-scoped advisory lock lets one instance work at a time).
/// </summary>
public sealed class MaintenanceService(
    NpgsqlDataSource dataSource,
    DatabaseReadiness readiness,
    IOptionsMonitor<TelemetryOptions> options,
    ILogger<MaintenanceService> logger) : BackgroundService
{
    private const long LockKey = 0x42_75_69_6C_64_4D_6E_74; // "BuildMnt"

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await readiness.WaitAsync(stoppingToken);
        await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Maintenance run failed");
            }

            await Task.Delay(options.CurrentValue.Retention.Interval, stoppingToken);
        }
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        var retention = options.CurrentValue.Retention;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        if (!await conn.ExecuteScalarAsync<bool>(new CommandDefinition("select pg_try_advisory_xact_lock(@k)", new { k = LockKey }, tx, cancellationToken: ct)))
        {
            return;
        }

        var deleted = 0;
        if (retention.Days > 0)
        {
            int batch;
            do
            {
                batch = await conn.ExecuteAsync(new CommandDefinition(
                    """
                    delete from builds where id in (
                        select id from builds where started_at < now() - make_interval(days => @days) limit 2000)
                    """, new { days = retention.Days }, tx, cancellationToken: ct, commandTimeout: 600));
                deleted += batch;
            }
            while (batch > 0 && !ct.IsCancellationRequested);
        }

        var purged = 0;
        if (retention.CommandDays > 0)
        {
            purged = await conn.ExecuteAsync(new CommandDefinition(
                """
                with old as (
                    update builds set commands_purged = true
                    where id in (select id from builds
                                 where not commands_purged and started_at < now() - make_interval(days => @days)
                                 limit 5000)
                    returning id)
                update build_steps s set command = null from old
                where s.build_id = old.id and s.command is not null
                """, new { days = retention.CommandDays }, tx, cancellationToken: ct, commandTimeout: 600));
        }

        var reclassified = await conn.ExecuteAsync(new CommandDefinition(
            """
            with mx as (
                select project_id, max(compile_count) as mx from builds
                where started_at > now() - interval '30 days' group by project_id)
            update builds b
               set kind = case when b.compile_count >= 0.9 * mx.mx then 'full' else 'incremental' end
              from mx
             where b.project_id = mx.project_id
               and b.compile_count > 0
               and b.started_at > now() - interval '30 days'
               and b.kind <> case when b.compile_count >= 0.9 * mx.mx then 'full' else 'incremental' end
            """, transaction: tx, cancellationToken: ct, commandTimeout: 600));

        await tx.CommitAsync(ct);
        if (deleted + purged + reclassified > 0)
        {
            logger.LogInformation(
                "Maintenance: deleted {Deleted} builds, purged {Purged} command lines, reclassified {Reclassified} builds",
                deleted, purged, reclassified);
        }
    }
}
