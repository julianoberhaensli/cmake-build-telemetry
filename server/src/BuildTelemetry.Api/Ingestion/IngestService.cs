using System.Diagnostics;
using System.Diagnostics.Metrics;
using Dapper;
using Npgsql;
using NpgsqlTypes;

namespace BuildTelemetry.Api.Ingestion;

/// <summary>Stores normalized bundles: upserts project + machine, inserts build, bulk-copies steps.</summary>
public sealed class IngestService(NpgsqlDataSource dataSource, ILogger<IngestService> logger)
{
    public static readonly Meter Meter = new("BuildTelemetry.Ingest", AppVersion.Current);
    private static readonly Counter<long> Bundles = Meter.CreateCounter<long>("buildtelemetry.ingest.bundles", description: "Bundles ingested");
    private static readonly Counter<long> Steps = Meter.CreateCounter<long>("buildtelemetry.ingest.steps", description: "Build steps ingested");
    private static readonly Counter<long> Duplicates = Meter.CreateCounter<long>("buildtelemetry.ingest.duplicates", description: "Duplicate bundles");
    private static readonly Histogram<double> StoreDuration = Meter.CreateHistogram<double>("buildtelemetry.ingest.store.duration", "ms");

    public async Task<IngestResult> StoreAsync(NormalizedBundle bundle, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        var exists = await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            "select exists(select 1 from builds where id = @id)", new { id = bundle.BundleId }, tx, cancellationToken: ct));
        if (exists)
        {
            Duplicates.Add(1);
            return new IngestResult(bundle.BundleId, IngestOutcome.Duplicate, 0);
        }

        var projectId = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            """
            insert into projects (name, last_seen) values (@name, now())
            on conflict (name) do update set last_seen = excluded.last_seen
            returning id
            """, new { name = bundle.ProjectName }, tx, cancellationToken: ct));

        var m = bundle.Machine;
        var machineId = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
            """
            insert into machines (machine_key, hostname, os_name, os_release, os_pretty, os_platform, cpu_model, cpu_vendor,
                                  logical_cores, physical_cores, cpu_mhz, memory_mb, is_ci, last_seen)
            values (@MachineKey, @Hostname, @OsName, @OsRelease, @OsPretty, @OsPlatform, @CpuModel, @CpuVendor,
                    @LogicalCores, @PhysicalCores, @CpuMhz, @MemoryMb, @IsCi, now())
            on conflict (machine_key) do update set
                hostname       = coalesce(excluded.hostname, machines.hostname),
                os_name        = coalesce(excluded.os_name, machines.os_name),
                os_release     = coalesce(excluded.os_release, machines.os_release),
                os_pretty      = coalesce(excluded.os_pretty, machines.os_pretty),
                os_platform    = coalesce(excluded.os_platform, machines.os_platform),
                cpu_model      = coalesce(excluded.cpu_model, machines.cpu_model),
                cpu_vendor     = coalesce(excluded.cpu_vendor, machines.cpu_vendor),
                logical_cores  = coalesce(excluded.logical_cores, machines.logical_cores),
                physical_cores = coalesce(excluded.physical_cores, machines.physical_cores),
                cpu_mhz        = coalesce(excluded.cpu_mhz, machines.cpu_mhz),
                memory_mb      = coalesce(excluded.memory_mb, machines.memory_mb),
                is_ci          = excluded.is_ci,
                last_seen      = excluded.last_seen
            returning id
            """, m, tx, cancellationToken: ct));

        var b = bundle.Build;
        var kind = await ClassifyAsync(conn, tx, projectId, b, ct);

        var p = new DynamicParameters(b);
        p.Add("ProjectId", projectId);
        p.Add("MachineId", machineId);
        p.Add("Kind", kind);
        try
        {
            await InsertBuildAsync(conn, tx, p, ct);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            // a concurrent request stored the same bundle first (transaction rolls back on dispose)
            Duplicates.Add(1);
            return new IngestResult(bundle.BundleId, IngestOutcome.Duplicate, 0);
        }

        if (bundle.Steps.Count > 0)
        {
            await CopyStepsAsync(conn, bundle.BundleId, projectId, bundle.Steps, ct);
        }

        await tx.CommitAsync(ct);

        Bundles.Add(1, new KeyValuePair<string, object?>("project", bundle.ProjectName));
        Steps.Add(bundle.Steps.Count);
        StoreDuration.Record(sw.Elapsed.TotalMilliseconds);
        logger.LogInformation(
            "Stored build {BuildId} project={Project} machine={Machine} kind={Kind} steps={Steps} wall={WallMs}ms in {Elapsed}ms",
            bundle.BundleId, bundle.ProjectName, m.Hostname, kind, bundle.Steps.Count, b.WallMs, sw.ElapsedMilliseconds);
        return new IngestResult(bundle.BundleId, IngestOutcome.Created, bundle.Steps.Count);
    }

    private static Task InsertBuildAsync(NpgsqlConnection conn, NpgsqlTransaction tx, DynamicParameters p, CancellationToken ct) =>
        conn.ExecuteAsync(new CommandDefinition(
            """
            insert into builds (
                id, project_id, machine_id, started_at, finished_at, wall_ms, configure_ms, generate_ms, hook, kind, success,
                compile_count, compile_ms, link_count, link_ms, custom_count, custom_ms, failed_count, total_step_ms,
                parallelism, max_rss_kb, output_bytes, build_type, generator, build_tool, cmake_version,
                cxx_compiler_id, cxx_compiler_version, c_compiler_id, c_compiler_version, compiler_launcher, linker_type,
                branch, commit_sha, is_ci, ci_provider, ci_url, ci_job, user_hash, detail, client_version, data_version,
                ingest_key, source_dir, build_dir, tags, role_stats, system_info)
            values (
                @Id, @ProjectId, @MachineId, @StartedAt, @FinishedAt, @WallMs, @ConfigureMs, @GenerateMs, @Hook, @Kind, @Success,
                @CompileCount, @CompileMs, @LinkCount, @LinkMs, @CustomCount, @CustomMs, @FailedCount, @TotalStepMs,
                @Parallelism, @MaxRssKb, @OutputBytes, @BuildType, @Generator, @BuildTool, @CmakeVersion,
                @CxxCompilerId, @CxxCompilerVersion, @CCompilerId, @CCompilerVersion, @CompilerLauncher, @LinkerType,
                @Branch, @CommitSha, @IsCi, @CiProvider, @CiUrl, @CiJob, @UserHash, @Detail, @ClientVersion, @DataVersion,
                @IngestKey, @SourceDir, @BuildDir, @Tags::jsonb, @RoleStats::jsonb, @SystemInfo::jsonb)
            """, p, tx, cancellationToken: ct));

    /// <summary>
    /// "full" when the build compiled (nearly) as many translation units as the largest
    /// recent build of the project, "incremental" otherwise; refined later by the
    /// maintenance job once more builds are known.
    /// </summary>
    private static async Task<string> ClassifyAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long projectId, BuildRecord b, CancellationToken ct)
    {
        if (b.CompileCount == 0)
        {
            return b.LinkCount + b.CustomCount > 0 ? "incremental" : b.ConfigureMs + b.GenerateMs > 0 ? "configure" : "other";
        }

        var max = await conn.ExecuteScalarAsync<int?>(new CommandDefinition(
            "select max(compile_count) from builds where project_id = @projectId and started_at > now() - interval '30 days'",
            new { projectId }, tx, cancellationToken: ct)) ?? 0;
        return b.CompileCount >= 0.9 * Math.Max(max, b.CompileCount) ? "full" : "incremental";
    }

    private static async Task CopyStepsAsync(NpgsqlConnection conn, Guid buildId, long projectId, IReadOnlyList<StepRecord> steps, CancellationToken ct)
    {
        await using var writer = await conn.BeginBinaryImportAsync(
            """
            copy build_steps (build_id, seq, project_id, role, target, target_type, source, output, language, config,
                              start_offset_ms, duration_ms, result, output_bytes, max_rss_kb, user_time_us, system_time_us, command)
            from stdin (format binary)
            """, ct);
        foreach (var s in steps)
        {
            await writer.StartRowAsync(ct);
            await writer.WriteAsync(buildId, NpgsqlDbType.Uuid, ct);
            await writer.WriteAsync(s.Seq, NpgsqlDbType.Integer, ct);
            await writer.WriteAsync(projectId, NpgsqlDbType.Bigint, ct);
            await writer.WriteAsync(s.Role, NpgsqlDbType.Text, ct);
            await WriteText(writer, s.Target, ct);
            await WriteText(writer, s.TargetType, ct);
            await WriteText(writer, s.Source, ct);
            await WriteText(writer, s.Output, ct);
            await WriteText(writer, s.Language, ct);
            await WriteText(writer, s.Config, ct);
            await writer.WriteAsync(s.StartOffsetMs, NpgsqlDbType.Bigint, ct);
            await writer.WriteAsync(s.DurationMs, NpgsqlDbType.Bigint, ct);
            await WriteNullable(writer, s.Result, NpgsqlDbType.Integer, ct);
            await WriteNullable(writer, s.OutputBytes, NpgsqlDbType.Bigint, ct);
            await WriteNullable(writer, s.MaxRssKb, NpgsqlDbType.Bigint, ct);
            await WriteNullable(writer, s.UserTimeUs, NpgsqlDbType.Bigint, ct);
            await WriteNullable(writer, s.SystemTimeUs, NpgsqlDbType.Bigint, ct);
            await WriteText(writer, s.Command, ct);
        }

        await writer.CompleteAsync(ct);
    }

    private static Task WriteText(NpgsqlBinaryImporter w, string? value, CancellationToken ct) =>
        value is null ? w.WriteNullAsync(ct) : w.WriteAsync(value, NpgsqlDbType.Text, ct);

    private static Task WriteNullable<T>(NpgsqlBinaryImporter w, T? value, NpgsqlDbType type, CancellationToken ct) where T : struct =>
        value is { } v ? w.WriteAsync(v, type, ct) : w.WriteNullAsync(ct);
}
