using BuildTelemetry.Api.Analytics;
using Dapper;
using Npgsql;

namespace BuildTelemetry.Api.Admin;

public sealed class AdminMachineDto
{
    public long Id { get; init; }
    public string? Hostname { get; init; }
    public string? CpuModel { get; init; }
    public string? OsPretty { get; init; }
    public bool IsCi { get; init; }
    public DateTimeOffset FirstSeen { get; init; }
    public DateTimeOffset LastSeen { get; init; }
    public long Builds { get; init; }
    public DateTimeOffset? LastBuildAt { get; init; }
}

/// <summary>Write-side administration: deleting builds and machines, legend rules.</summary>
public sealed class AdminService(NpgsqlDataSource dataSource, ILogger<AdminService> logger)
{
    public async Task<int> DeleteBuildsAsync(IReadOnlyCollection<Guid> ids, string who, CancellationToken ct)
    {
        if (ids.Count == 0)
        {
            return 0;
        }

        await using var conn = await dataSource.OpenConnectionAsync(ct);
        // steps go with the build (on delete cascade)
        var n = await conn.ExecuteAsync(new CommandDefinition(
            "delete from builds where id = any(@ids)", new { ids = ids.ToArray() }, cancellationToken: ct, commandTimeout: 600));
        logger.LogInformation("Admin {Who} deleted {Count} build(s)", who, n);
        return n;
    }

    /// <summary>Deletes every build the filter matches (the same filter as the build list).</summary>
    public async Task<int> DeleteMatchingBuildsAsync(BuildFilter filter, string who, CancellationToken ct)
    {
        var p = new DynamicParameters();
        var where = filter.Where(p);
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        var n = await conn.ExecuteAsync(new CommandDefinition(
            $"delete from builds b {where}", p, cancellationToken: ct, commandTimeout: 600));
        logger.LogInformation("Admin {Who} deleted {Count} build(s) matching {Filter}", who, n, filter);
        return n;
    }

    /// <summary>Deletes a machine with all its builds. Null when the machine does not exist.</summary>
    public async Task<int?> DeleteMachineAsync(long id, string who, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        var builds = await conn.ExecuteAsync(new CommandDefinition(
            "delete from builds where machine_id = @id", new { id }, tx, cancellationToken: ct, commandTimeout: 600));
        var machines = await conn.ExecuteAsync(new CommandDefinition(
            "delete from machines where id = @id", new { id }, tx, cancellationToken: ct));
        if (machines == 0)
        {
            await tx.RollbackAsync(ct);
            return null;
        }

        await tx.CommitAsync(ct);
        logger.LogInformation("Admin {Who} deleted machine {Machine} with {Count} build(s)", who, id, builds);
        return builds;
    }

    /// <summary>Every machine with its build count, also those without builds in any date range.</summary>
    public async Task<IReadOnlyList<AdminMachineDto>> MachinesAsync(CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return (await conn.QueryAsync<AdminMachineDto>(new CommandDefinition(
            """
            select m.id, m.hostname, m.cpu_model, m.os_pretty, m.is_ci, m.first_seen, m.last_seen,
                   count(b.id) as builds, max(b.started_at) as last_build_at
            from machines m left join builds b on b.machine_id = m.id
            group by m.id order by m.last_seen desc
            """, cancellationToken: ct, commandTimeout: 120))).AsList();
    }

    public async Task<IReadOnlyList<StepCategoryDto>> CategoriesAsync(CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        return (await conn.QueryAsync<StepCategoryDto>(new CommandDefinition(
            """
            select id, position, name, color_slot, role, field, pattern, is_regex, enabled
            from step_categories order by position, id
            """, cancellationToken: ct))).AsList();
    }

    /// <summary>Replaces the whole rule set (the editor saves the list as one document).</summary>
    public async Task<IReadOnlyList<StepCategoryDto>> SaveCategoriesAsync(IReadOnlyList<StepCategoryDto> rules, string who, CancellationToken ct)
    {
        await using var conn = await dataSource.OpenConnectionAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync(new CommandDefinition("delete from step_categories", transaction: tx, cancellationToken: ct));
        for (var i = 0; i < rules.Count; i++)
        {
            var r = rules[i];
            await conn.ExecuteAsync(new CommandDefinition(
                """
                insert into step_categories (position, name, color_slot, role, field, pattern, is_regex, enabled)
                values (@position, @name, @colorSlot, @role, @field, @pattern, @isRegex, @enabled)
                """,
                new { position = i, name = r.Name.Trim(), r.ColorSlot, r.Role, r.Field, r.Pattern, r.IsRegex, r.Enabled },
                tx, cancellationToken: ct));
        }

        await tx.CommitAsync(ct);
        logger.LogInformation("Admin {Who} saved {Count} legend rule(s)", who, rules.Count);
        return await CategoriesAsync(ct);
    }
}
