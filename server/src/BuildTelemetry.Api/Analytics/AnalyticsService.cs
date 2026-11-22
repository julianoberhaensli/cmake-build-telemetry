using BuildTelemetry.Api.Admin;
using Dapper;
using Npgsql;

namespace BuildTelemetry.Api.Analytics;

/// <summary>Read-side queries for the dashboard. Every user value is a SQL parameter.</summary>
public sealed class AnalyticsService(NpgsqlDataSource dataSource)
{
    private const string BuildListColumns =
        """
        b.id, p.name as project, b.machine_id, m.hostname, m.cpu_model, m.logical_cores, m.os_pretty,
        b.started_at, b.wall_ms, b.success, b.kind, b.compile_count, b.compile_ms, b.link_count, b.failed_count,
        b.parallelism, b.branch, b.commit_sha, b.build_type, b.is_ci, b.ci_provider,
        b.cxx_compiler_id, b.cxx_compiler_version, b.user_hash, b.max_rss_kb, b.hook
        """;

    private static readonly Dictionary<string, string> BuildSortColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["startedAt"] = "b.started_at",
        ["wallMs"] = "b.wall_ms",
        ["compileCount"] = "b.compile_count",
        ["parallelism"] = "b.parallelism",
        ["maxRssKb"] = "b.max_rss_kb",
        ["project"] = "p.name",
        ["hostname"] = "m.hostname",
    };

    private static readonly Dictionary<string, string> FileSortColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["totalMs"] = "total_ms",
        ["avgMs"] = "avg_ms",
        ["p90Ms"] = "p90_ms",
        ["maxMs"] = "max_ms",
        ["compiles"] = "compiles",
        ["maxRssKb"] = "max_rss_kb",
    };

    public async Task<OverviewDto> OverviewAsync(BuildFilter filter, CancellationToken ct)
    {
        var current = await OverviewCoreAsync(filter, ct);
        current.Previous = await OverviewCoreAsync(filter.PreviousPeriod(), ct);
        return current;
    }

    private async Task<OverviewDto> OverviewCoreAsync(BuildFilter filter, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var where = filter.Where(p);
        var sql =
            $"""
             select count(*) as builds,
                    count(*) filter (where not b.success) as failed,
                    avg(case when b.success then 1.0 else 0.0 end)::float8 as success_rate,
                    count(distinct b.machine_id) as machines,
                    count(distinct b.project_id) as projects,
                    count(distinct b.user_hash) as developers,
                    percentile_cont(0.5) within group (order by b.wall_ms) as p50_wall_ms,
                    percentile_cont(0.9) within group (order by b.wall_ms) as p90_wall_ms,
                    avg(b.wall_ms)::float8 as avg_wall_ms,
                    coalesce(sum(b.wall_ms), 0)::bigint as total_wall_ms,
                    coalesce(sum(b.compile_count), 0)::bigint as compile_units,
                    (sum(b.compile_ms)::float8 / nullif(sum(b.compile_count), 0)) as avg_compile_ms,
                    avg(b.parallelism)::float8 as avg_parallelism,
                    count(*) filter (where b.kind = 'full') as full_builds,
                    percentile_cont(0.5) within group (order by b.wall_ms) filter (where b.kind = 'full') as full_p50_wall_ms,
                    count(*) filter (where b.is_ci) as ci_builds
             from builds b
             {where}
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return await conn.QuerySingleAsync<OverviewDto>(new CommandDefinition(sql, p, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<TrendPointDto>> TrendAsync(BuildFilter filter, string? bucket, CancellationToken ct)
    {
        bucket = bucket?.ToLowerInvariant() switch
        {
            "hour" => "hour",
            "week" => "week",
            "month" => "month",
            "day" => "day",
            _ => (filter.To - filter.From).TotalDays switch
            {
                <= 2 => "hour",
                <= 120 => "day",
                _ => "week",
            },
        };
        var p = new DynamicParameters();
        var where = filter.Where(p);
        p.Add("bucket", bucket);
        var sql =
            $"""
             select date_trunc(@bucket, b.started_at) as bucket,
                    count(*) as builds,
                    count(*) filter (where not b.success) as failed,
                    percentile_cont(0.5) within group (order by b.wall_ms) as p50_wall_ms,
                    percentile_cont(0.9) within group (order by b.wall_ms) as p90_wall_ms,
                    avg(b.wall_ms)::float8 as avg_wall_ms,
                    percentile_cont(0.5) within group (order by b.wall_ms) filter (where b.kind = 'full') as full_p50_wall_ms,
                    coalesce(sum(b.compile_count), 0)::bigint as compile_units
             from builds b
             {where}
             group by 1
             order by 1
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return (await conn.QueryAsync<TrendPointDto>(new CommandDefinition(sql, p, cancellationToken: ct))).AsList();
    }

    public async Task<PagedResult<BuildListItemDto>> BuildsAsync(
        BuildFilter filter, int page, int pageSize, string? sort, string? dir, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 500);
        var orderBy = sort is not null && BuildSortColumns.TryGetValue(sort, out var col) ? col : "b.started_at";
        var direction = string.Equals(dir, "asc", StringComparison.OrdinalIgnoreCase) ? "asc" : "desc";

        var p = new DynamicParameters();
        var where = filter.Where(p);
        p.Add("limit", pageSize);
        p.Add("offset", (page - 1) * pageSize);
        var sql =
            $"""
             select {BuildListColumns}
             from builds b
             join projects p on p.id = b.project_id
             join machines m on m.id = b.machine_id
             {where}
             order by {orderBy} {direction} nulls last, b.id
             limit @limit offset @offset;

             select count(*) from builds b {where};
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, p, cancellationToken: ct));
        var items = (await multi.ReadAsync<BuildListItemDto>()).AsList();
        var total = await multi.ReadSingleAsync<long>();
        return new PagedResult<BuildListItemDto>(items, total, page, pageSize);
    }

    public async Task<BuildDetailDto?> BuildAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        var build = await conn.QuerySingleOrDefaultAsync<BuildDetailDto>(new CommandDefinition(
            """
            select b.*, p.name as project
            from builds b join projects p on p.id = b.project_id
            where b.id = @id
            """, new { id }, cancellationToken: ct));
        if (build is null)
        {
            return null;
        }

        build.Machine = await conn.QuerySingleOrDefaultAsync<MachineDto>(new CommandDefinition(
            "select * from machines where id = @id", new { id = build.MachineId }, cancellationToken: ct));

        build.Targets = (await conn.QueryAsync<TargetAggDto>(new CommandDefinition(
            """
            select target,
                   max(target_type) as target_type,
                   count(*) filter (where role = 'compile') as compiles,
                   coalesce(sum(duration_ms) filter (where role = 'compile'), 0)::bigint as compile_ms,
                   coalesce(sum(duration_ms) filter (where role = 'link'), 0)::bigint as link_ms,
                   coalesce(sum(duration_ms) filter (where role = 'custom'), 0)::bigint as custom_ms,
                   min(start_offset_ms) as first_start_ms,
                   max(start_offset_ms + duration_ms) as last_end_ms
            from build_steps
            where build_id = @id and target is not null
            group by target
            order by sum(duration_ms) filter (where role in ('compile', 'link', 'custom')) desc nulls last
            """, new { id }, cancellationToken: ct))).AsList();

        build.Roles = (await conn.QueryAsync<RoleAggDto>(new CommandDefinition(
            """
            select role, count(*) as count, coalesce(sum(duration_ms), 0)::bigint as duration_ms,
                   count(*) filter (where result is not null and result <> 0) as failed
            from build_steps where build_id = @id group by role order by duration_ms desc
            """, new { id }, cancellationToken: ct))).AsList();

        build.ProjectMedianFullWallMs = await conn.ExecuteScalarAsync<double?>(new CommandDefinition(
            """
            select percentile_cont(0.5) within group (order by wall_ms)
            from builds
            where project_id = (select project_id from builds where id = @id)
              and kind = 'full' and success and started_at > now() - interval '30 days'
            """, new { id }, cancellationToken: ct));
        return build;
    }

    public async Task<IReadOnlyList<StepDto>?> StepsAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        var exists = await conn.ExecuteScalarAsync<bool>(new CommandDefinition(
            "select exists(select 1 from builds where id = @id)", new { id }, cancellationToken: ct));
        if (!exists)
        {
            return null;
        }

        var steps = (await conn.QueryAsync<StepDto>(new CommandDefinition(
            """
            select seq, role, target, target_type, source, output, language, start_offset_ms as start_ms, duration_ms,
                   result, max_rss_kb, output_bytes, user_time_us, system_time_us, command is not null as has_command
            from build_steps where build_id = @id order by start_offset_ms, seq
            """, new { id }, cancellationToken: ct))).AsList();
        AssignLanes(steps);
        await ClassifyAsync(conn, id, steps, ct);
        return steps;
    }

    /// <summary>
    /// Tool names for non-compile/link steps and the legend category of every step. Command
    /// lines are read only for the roles that need them, and only their first 4 KB.
    /// </summary>
    private static async Task ClassifyAsync(NpgsqlConnection conn, Guid id, List<StepDto> steps, CancellationToken ct)
    {
        var rules = (await conn.QueryAsync<StepCategoryDto>(new CommandDefinition(
            "select id, position, name, color_slot, role, field, pattern, is_regex, enabled from step_categories where enabled",
            cancellationToken: ct))).AsList();
        var matcher = new StepCategories.Matcher(rules);
        var commandRoles = matcher.CommandRoles;
        var allRoles = commandRoles.Contains(null);
        var roles = commandRoles.Where(r => r is not null).Cast<string>()
            .Concat(["custom", "install", "test"]).Distinct().ToArray();

        var commands = (await conn.QueryAsync<(int Seq, string Command)>(new CommandDefinition(
            $"""
             select seq, left(command, {StepCategories.CommandPrefix}) from build_steps
             where build_id = @id and command is not null {(allRoles ? "" : "and role = any(@roles)")}
             """, new { id, roles }, cancellationToken: ct, commandTimeout: 120)))
            .ToDictionary(x => x.Seq, x => x.Command);

        foreach (var s in steps)
        {
            commands.TryGetValue(s.Seq, out var command);
            if (s.Role is not ("compile" or "link"))
            {
                s.Tool = StepCategories.ToolName(command);
            }

            if (!matcher.IsEmpty)
            {
                s.Category = matcher.Match(s.Role, command, s.Source, s.Output, s.Target);
            }
        }
    }

    public async Task<StepDetailDto?> StepAsync(Guid id, int seq, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<StepDetailDto>(new CommandDefinition(
            """
            select seq, role, target, source, output, config, start_offset_ms as start_ms, duration_ms, result,
                   max_rss_kb, user_time_us, system_time_us, command
            from build_steps where build_id = @id and seq = @seq
            """, new { id, seq }, cancellationToken: ct));
    }

    /// <summary>
    /// Greedy interval partitioning: every step goes to the lowest-numbered lane that is
    /// free at its start time - reconstructs the build tool's concurrent job slots.
    /// Phase steps (configure / generate / build tool) get lane -1.
    /// </summary>
    internal static void AssignLanes(List<StepDto> steps)
    {
        var laneEnds = new List<long>();
        var free = new PriorityQueue<int, int>();
        var busy = new PriorityQueue<int, long>();
        foreach (var s in steps.OrderBy(s => s.StartMs).ThenBy(s => s.Seq))
        {
            if (s.Role is "configure" or "generate" or "build" or "cmakeBuild" or "cmakeInstall" or "ctest")
            {
                s.Lane = -1;
                continue;
            }

            while (busy.TryPeek(out var lane, out var end) && end <= s.StartMs)
            {
                busy.Dequeue();
                free.Enqueue(lane, lane);
            }

            if (!free.TryDequeue(out var chosen, out _))
            {
                chosen = laneEnds.Count;
                laneEnds.Add(0);
            }

            laneEnds[chosen] = s.StartMs + s.DurationMs;
            busy.Enqueue(chosen, laneEnds[chosen]);
            s.Lane = chosen;
        }
    }

    public async Task<IReadOnlyList<MachineDto>> MachinesAsync(BuildFilter filter, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var where = filter.Where(p);
        var sql =
            $"""
             with f as (select b.* from builds b {where})
             select m.*,
                    count(f.id) as builds,
                    count(*) filter (where not f.success) as failed,
                    percentile_cont(0.5) within group (order by f.wall_ms) as p50_wall_ms,
                    percentile_cont(0.5) within group (order by f.wall_ms) filter (where f.kind = 'full') as p50_full_wall_ms,
                    (sum(f.compile_ms)::float8 / nullif(sum(f.compile_count), 0)) as avg_compile_ms,
                    avg(f.parallelism)::float8 as avg_parallelism,
                    max(f.max_rss_kb) as max_rss_kb
             from machines m join f on f.machine_id = m.id
             group by m.id
             order by builds desc
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        var machines = (await conn.QueryAsync<MachineDto>(new CommandDefinition(sql, p, cancellationToken: ct))).AsList();

        var speed = await SpeedIndexAsync(conn, filter, "s.machine_id::text", ct);
        foreach (var m in machines)
        {
            if (speed.TryGetValue(m.Id.ToString(System.Globalization.CultureInfo.InvariantCulture), out var si))
            {
                m.SpeedIndex = si.Index;
                m.SpeedSamples = si.Samples;
            }
        }

        return machines;
    }

    public async Task<MachineDto?> MachineAsync(long id, BuildFilter filter, CancellationToken ct)
    {
        var machines = await MachinesAsync(filter with { Machine = id }, ct);
        if (machines.Count > 0)
        {
            return machines[0];
        }

        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return await conn.QuerySingleOrDefaultAsync<MachineDto>(new CommandDefinition(
            "select * from machines where id = @id", new { id }, cancellationToken: ct));
    }

    private const string ProfileKeySql =
        "concat_ws(' | ', coalesce(m.cpu_model, '?'), coalesce(m.logical_cores::text, '?') || ' threads', round(coalesce(m.memory_mb, 0) / 1024.0)::text || ' GB', coalesce(m.os_name, '?'))";

    public async Task<IReadOnlyList<HardwareProfileDto>> HardwareAsync(BuildFilter filter, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var where = filter.Where(p);
        var sql =
            $"""
             with f as (select b.* from builds b {where})
             select {ProfileKeySql} as key,
                    max(m.cpu_model) as cpu_model,
                    max(m.logical_cores) as logical_cores,
                    max(round(coalesce(m.memory_mb, 0) / 1024.0))::bigint as memory_gb,
                    max(m.os_name) as os_name,
                    count(distinct m.id) as machines,
                    count(f.id) as builds,
                    percentile_cont(0.5) within group (order by f.wall_ms) as p50_wall_ms,
                    percentile_cont(0.5) within group (order by f.wall_ms) filter (where f.kind = 'full') as p50_full_wall_ms,
                    (sum(f.compile_ms)::float8 / nullif(sum(f.compile_count), 0)) as avg_compile_ms,
                    avg(f.parallelism)::float8 as avg_parallelism
             from machines m join f on f.machine_id = m.id
             group by 1
             order by builds desc
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        var profiles = (await conn.QueryAsync<HardwareProfileDto>(new CommandDefinition(sql, p, cancellationToken: ct))).AsList();
        var speed = await SpeedIndexAsync(conn, filter, ProfileKeySql, ct);
        foreach (var h in profiles)
        {
            if (speed.TryGetValue(h.Key, out var si))
            {
                h.SpeedIndex = si.Index;
                h.SpeedSamples = si.Samples;
            }
        }

        return profiles;
    }

    /// <summary>
    /// Speed index = 100 / median(step duration / fleet median duration of the same
    /// translation unit). 100 = fleet median, 200 = compiles twice as fast. Only TUs seen
    /// on at least two machines and taking >= 20 ms contribute, so different projects and
    /// file mixes compare fairly.
    /// </summary>
    private static async Task<Dictionary<string, (double Index, long Samples)>> SpeedIndexAsync(
        NpgsqlConnection conn, BuildFilter filter, string groupExpr, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var where = filter with { Machine = null };
        var sql =
            $"""
             with f as (select b.id, b.machine_id from builds b {where.Where(p)}),
             s as (
                 select st.project_id, st.source, st.duration_ms, f.machine_id
                 from build_steps st join f on f.id = st.build_id
                 where st.role = 'compile' and st.result = 0 and st.source is not null
             ),
             base as (
                 select project_id, source, percentile_cont(0.5) within group (order by duration_ms) as med
                 from s group by project_id, source
                 having count(distinct machine_id) >= 2
             ),
             r as (
                 select s.machine_id, s.duration_ms / base.med as ratio
                 from s join base on base.project_id = s.project_id and base.source = s.source
                 where base.med >= 20
             )
             select {groupExpr} as key,
                    100.0 / nullif(percentile_cont(0.5) within group (order by s.ratio), 0) as idx,
                    count(*) as samples
             from r as s join machines m on m.id = s.machine_id
             group by 1
             """;
        var rows = await conn.QueryAsync<(string Key, double? Idx, long Samples)>(new CommandDefinition(sql, p, cancellationToken: ct, commandTimeout: 120));
        return rows.Where(r => r.Idx is not null).ToDictionary(r => r.Key, r => (Math.Round(r.Idx!.Value, 1), r.Samples));
    }

    public async Task<IReadOnlyList<FileHotspotDto>> FileHotspotsAsync(BuildFilter filter, string? sort, int limit, string? search, CancellationToken ct)
    {
        var orderBy = sort is not null && FileSortColumns.TryGetValue(sort, out var col) ? col : "total_ms";
        var p = new DynamicParameters();
        var where = filter.Where(p);
        p.Add("limit", Math.Clamp(limit, 1, 1000));
        var searchSql = "";
        if (!string.IsNullOrWhiteSpace(search))
        {
            searchSql = "and s.source ilike @search";
            p.Add("search", "%" + search.Replace("%", "\\%").Replace("_", "\\_") + "%");
        }

        var sql =
            $"""
             with f as (select b.id, b.machine_id from builds b {where})
             select s.source,
                    max(s.target) as target,
                    count(*) as compiles,
                    count(distinct s.build_id) as builds,
                    count(distinct f.machine_id) as machines,
                    avg(s.duration_ms)::float8 as avg_ms,
                    percentile_cont(0.5) within group (order by s.duration_ms) as p50_ms,
                    percentile_cont(0.9) within group (order by s.duration_ms) as p90_ms,
                    max(s.duration_ms) as max_ms,
                    sum(s.duration_ms)::bigint as total_ms,
                    avg(s.max_rss_kb)::float8 as avg_rss_kb,
                    max(s.max_rss_kb) as max_rss_kb,
                    count(*) filter (where s.result <> 0) as failures
             from build_steps s join f on f.id = s.build_id
             where s.role = 'compile' and s.source is not null {searchSql}
             group by s.source
             order by {orderBy} desc nulls last
             limit @limit
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return (await conn.QueryAsync<FileHotspotDto>(new CommandDefinition(sql, p, cancellationToken: ct, commandTimeout: 120))).AsList();
    }

    public async Task<IReadOnlyList<TargetHotspotDto>> TargetHotspotsAsync(BuildFilter filter, int limit, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var where = filter.Where(p);
        p.Add("limit", Math.Clamp(limit, 1, 1000));
        var sql =
            $"""
             with f as (select b.id from builds b {where})
             select s.target,
                    max(s.target_type) as target_type,
                    count(*) filter (where s.role = 'compile') as compiles,
                    count(distinct s.build_id) as builds,
                    coalesce(sum(s.duration_ms) filter (where s.role = 'compile'), 0)::bigint as compile_ms,
                    avg(s.duration_ms) filter (where s.role = 'compile')::float8 as avg_compile_ms,
                    avg(s.duration_ms) filter (where s.role = 'link')::float8 as avg_link_ms,
                    sum(s.duration_ms)::bigint as total_ms
             from build_steps s join f on f.id = s.build_id
             where s.target is not null
             group by s.target
             order by total_ms desc
             limit @limit
             """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return (await conn.QueryAsync<TargetHotspotDto>(new CommandDefinition(sql, p, cancellationToken: ct, commandTimeout: 120))).AsList();
    }

    public async Task<CompareResultDto?> CompareAsync(Guid a, Guid b, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        var builds = (await conn.QueryAsync<BuildListItemDto>(new CommandDefinition(
            $"""
             select {BuildListColumns}
             from builds b join projects p on p.id = b.project_id join machines m on m.id = b.machine_id
             where b.id = any(@ids)
             """, new { ids = new[] { a, b } }, cancellationToken: ct))).ToDictionary(x => x.Id);
        if (!builds.TryGetValue(a, out var ba) || !builds.TryGetValue(b, out var bb))
        {
            return null;
        }

        var files = (await conn.QueryAsync<CompareFileDto>(new CommandDefinition(
            """
            with x as (select source, max(target) as target, sum(duration_ms)::bigint as ms from build_steps
                       where build_id = @a and role = 'compile' and source is not null group by source),
                 y as (select source, max(target) as target, sum(duration_ms)::bigint as ms from build_steps
                       where build_id = @b and role = 'compile' and source is not null group by source)
            select coalesce(x.source, y.source) as source, coalesce(x.target, y.target) as target,
                   x.ms as a_ms, y.ms as b_ms, coalesce(y.ms, 0) - coalesce(x.ms, 0) as delta_ms
            from x full join y on x.source = y.source
            order by abs(coalesce(y.ms, 0) - coalesce(x.ms, 0)) desc
            limit 500
            """, new { a, b }, cancellationToken: ct))).AsList();

        const string rolesSql =
            """
            select role, count(*) as count, coalesce(sum(duration_ms), 0)::bigint as duration_ms,
                   count(*) filter (where result is not null and result <> 0) as failed
            from build_steps where build_id = @id group by role order by duration_ms desc
            """;
        var rolesA = (await conn.QueryAsync<RoleAggDto>(new CommandDefinition(rolesSql, new { id = a }, cancellationToken: ct))).AsList();
        var rolesB = (await conn.QueryAsync<RoleAggDto>(new CommandDefinition(rolesSql, new { id = b }, cancellationToken: ct))).AsList();
        return new CompareResultDto(ba, bb, files, rolesA, rolesB);
    }

    public async Task<FiltersDto> FiltersAsync(CancellationToken ct)
    {
        const string sql =
            """
            select p.name, count(b.id) as count from projects p left join builds b on b.project_id = p.id
            group by p.name having count(b.id) > 0 order by count desc, p.name;

            select branch from builds where branch is not null and started_at > now() - interval '90 days'
            group by branch order by max(started_at) desc limit 200;

            select distinct build_type from builds where build_type is not null and build_type <> '' order by 1;

            select distinct cxx_compiler_id from builds where cxx_compiler_id is not null order by 1;

            select id, hostname, cpu_model, is_ci from machines order by last_seen desc limit 1000;

            select distinct ci_provider from builds where ci_provider is not null order by 1;

            select distinct jsonb_object_keys(tags) from builds where started_at > now() - interval '90 days' order by 1;
            """;
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var multi = await conn.QueryMultipleAsync(new CommandDefinition(sql, cancellationToken: ct));
        var projects = (await multi.ReadAsync<(string Name, long Count)>()).Select(x => new NamedCount(x.Name, x.Count)).ToList();
        var branches = (await multi.ReadAsync<string>()).AsList();
        var buildTypes = (await multi.ReadAsync<string>()).AsList();
        var compilers = (await multi.ReadAsync<string>()).AsList();
        var machines = (await multi.ReadAsync<(long Id, string? Hostname, string? CpuModel, bool IsCi)>())
            .Select(x => new MachineOption(x.Id, x.Hostname, x.CpuModel, x.IsCi)).ToList();
        var providers = (await multi.ReadAsync<string>()).AsList();
        var tagKeys = (await multi.ReadAsync<string>()).AsList();
        return new FiltersDto(projects, branches, buildTypes, compilers, machines, providers, tagKeys);
    }
}
