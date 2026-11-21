using System.Text.Json;

namespace BuildTelemetry.Api.Analytics;

public static class AnalyticsEndpoints
{
    public const string Policy = "dashboard";

    public static IEndpointRouteBuilder MapAnalyticsEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/v1").RequireAuthorization(Policy);

        var stats = api.MapGroup("").WithTags("Analytics");
        stats.MapGet("/filters", (AnalyticsService s, CancellationToken ct) => s.FiltersAsync(ct))
            .WithSummary("Distinct values for the dashboard filter bar");
        stats.MapGet("/overview", (BuildFilter f, AnalyticsService s, CancellationToken ct) => s.OverviewAsync(f, ct))
            .WithSummary("KPIs for the filtered period and the period before it");
        stats.MapGet("/trend", (BuildFilter f, string? bucket, AnalyticsService s, CancellationToken ct) => s.TrendAsync(f, bucket, ct))
            .WithSummary("Build count and duration percentiles per time bucket (hour/day/week/month)");

        var builds = api.MapGroup("/builds").WithTags("Builds");
        builds.MapGet("", (BuildFilter f, int? page, int? pageSize, string? sort, string? dir, AnalyticsService s, CancellationToken ct)
                => s.BuildsAsync(f, page ?? 1, pageSize ?? 50, sort, dir, ct))
            .WithSummary("Paged, filtered, sortable build list");
        builds.MapGet("/{id:guid}", async (Guid id, AnalyticsService s, CancellationToken ct)
                => await s.BuildAsync(id, ct) is { } b ? Results.Ok(b) : Results.NotFound())
            .WithSummary("One build with environment, machine, per-target and per-role aggregates");
        builds.MapGet("/{id:guid}/steps", async (Guid id, AnalyticsService s, CancellationToken ct)
                => await s.StepsAsync(id, ct) is { } steps ? Results.Ok(steps) : Results.NotFound())
            .WithSummary("All steps of a build with reconstructed parallel lanes (timeline)");
        builds.MapGet("/{id:guid}/steps/{seq:int}", async (Guid id, int seq, AnalyticsService s, CancellationToken ct)
                => await s.StepAsync(id, seq, ct) is { } step ? Results.Ok(step) : Results.NotFound())
            .WithSummary("One step including its command line");
        builds.MapGet("/{id:guid}/trace", TraceAsync)
            .WithSummary("Chrome/Perfetto trace (open in ui.perfetto.dev or chrome://tracing)");

        api.MapGet("/compare", async (Guid a, Guid b, AnalyticsService s, CancellationToken ct)
                => await s.CompareAsync(a, b, ct) is { } r ? Results.Ok(r) : Results.NotFound())
            .WithTags("Builds")
            .WithSummary("Per-file compile time difference between two builds");

        var machines = api.MapGroup("/machines").WithTags("Machines");
        machines.MapGet("", (BuildFilter f, AnalyticsService s, CancellationToken ct) => s.MachinesAsync(f, ct))
            .WithSummary("Machines with build statistics and speed index");
        machines.MapGet("/{id:long}", async (long id, BuildFilter f, AnalyticsService s, CancellationToken ct)
                => await s.MachineAsync(id, f, ct) is { } m ? Results.Ok(m) : Results.NotFound())
            .WithSummary("One machine with build statistics");
        api.MapGet("/hardware", (BuildFilter f, AnalyticsService s, CancellationToken ct) => s.HardwareAsync(f, ct))
            .WithTags("Machines")
            .WithSummary("Statistics grouped by hardware profile (CPU, threads, memory, OS)");

        var hotspots = api.MapGroup("/hotspots").WithTags("Hotspots");
        hotspots.MapGet("/files", (BuildFilter f, string? sort, int? limit, string? search, AnalyticsService s, CancellationToken ct)
                => s.FileHotspotsAsync(f, sort, limit ?? 100, search, ct))
            .WithSummary("Translation units by total / average / p90 compile time and memory");
        hotspots.MapGet("/targets", (BuildFilter f, int? limit, AnalyticsService s, CancellationToken ct)
                => s.TargetHotspotsAsync(f, limit ?? 100, ct))
            .WithSummary("Targets by accumulated compile + link time");

        return app;
    }

    private static async Task<IResult> TraceAsync(Guid id, AnalyticsService s, HttpContext ctx, CancellationToken ct)
    {
        var build = await s.BuildAsync(id, ct);
        var steps = await s.StepsAsync(id, ct);
        if (build is null || steps is null)
        {
            return Results.NotFound();
        }

        ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"build-{id:N}.trace.json\"";
        ctx.Response.ContentType = "application/json";
        await using var w = new Utf8JsonWriter(ctx.Response.Body);
        w.WriteStartObject();
        w.WriteString("displayTimeUnit", "ms");
        w.WriteStartObject("otherData");
        w.WriteString("project", build.Project);
        w.WriteString("machine", build.Machine?.Hostname);
        w.WriteString("startedAt", build.StartedAt);
        w.WriteEndObject();
        w.WriteStartArray("traceEvents");
        w.WriteStartObject();
        w.WriteString("name", "process_name");
        w.WriteString("ph", "M");
        w.WriteNumber("pid", 0);
        w.WriteStartObject("args");
        w.WriteString("name", $"{build.Project} @ {build.Machine?.Hostname}");
        w.WriteEndObject();
        w.WriteEndObject();
        foreach (var step in steps)
        {
            w.WriteStartObject();
            w.WriteString("name", step.Source is { } src ? Path.GetFileName(src) : step.Output ?? step.Target ?? step.Role);
            w.WriteString("cat", step.Role);
            w.WriteString("ph", "X");
            w.WriteNumber("ts", step.StartMs * 1000);
            w.WriteNumber("dur", step.DurationMs * 1000);
            w.WriteNumber("pid", 0);
            w.WriteNumber("tid", step.Lane + 1);
            w.WriteStartObject("args");
            w.WriteString("role", step.Role);
            if (step.Target is not null) w.WriteString("target", step.Target);
            if (step.Source is not null) w.WriteString("source", step.Source);
            if (step.Output is not null) w.WriteString("output", step.Output);
            if (step.Result is { } r) w.WriteNumber("result", r);
            if (step.MaxRssKb is { } rss) w.WriteNumber("maxRssKb", rss);
            w.WriteEndObject();
            w.WriteEndObject();
        }

        w.WriteEndArray();
        w.WriteEndObject();
        await w.FlushAsync(ct);
        return Results.Empty;
    }
}
