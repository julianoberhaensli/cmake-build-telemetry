using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using BuildTelemetry.Api.Analytics;
using BuildTelemetry.Api.Options;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace BuildTelemetry.Api.Admin;

public static class AdminEndpoints
{
    /// <summary>Cookie scheme of the password sign-in (separate from the OIDC session).</summary>
    public const string Scheme = "BtAdmin";
    public const string Policy = "admin";
    public const string LoginRateLimit = "admin-login";
    public const string AdminClaim = "bt_admin";

    /// <summary>
    /// Every state-changing admin request must carry this header. Browsers only send custom
    /// headers cross-origin after a CORS preflight, which this server never allows, so a
    /// forged form post or link from another site cannot delete anything (CSRF).
    /// </summary>
    public const string CsrfHeader = "X-BuildTelemetry-Admin";

    /// <summary>Admin via the password session, or (OIDC) via the configured role claim.</summary>
    public static bool IsAdmin(ClaimsPrincipal user, TelemetryOptions o) =>
        user.HasClaim(c => c.Type == AdminClaim) ||
        (o.Auth.Mode == DashboardAuthMode.Oidc && !string.IsNullOrWhiteSpace(o.Admin.Role) &&
         user.HasClaim(c => c.Type == o.Auth.RoleClaimType && c.Value == o.Admin.Role));

    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        // Legend rules are read by every dashboard user; only admins change them.
        app.MapGet("/api/v1/step-categories", (AdminService s, CancellationToken ct) => s.CategoriesAsync(ct))
            .RequireAuthorization(AnalyticsEndpoints.Policy)
            .WithTags("Admin")
            .WithSummary("Legend rules that name and colour matching steps on the timeline");

        var admin = app.MapGroup("/api/v1/admin").WithTags("Admin").RequireAuthorization(AnalyticsEndpoints.Policy);

        admin.MapGet("/session", async (HttpContext ctx, IOptionsMonitor<TelemetryOptions> o) =>
            {
                var opts = o.CurrentValue;
                var result = await ctx.AuthenticateAsync(Scheme);
                var user = new ClaimsPrincipal(ctx.User.Identities.Concat(result.Principal?.Identities ?? []));
                return new AdminSession(
                    IsAdmin(user, opts),
                    result.Succeeded ? "password" : IsAdmin(user, opts) ? "role" : null,
                    opts.Admin.PasswordEnabled,
                    opts.Auth.Mode == DashboardAuthMode.Oidc && !string.IsNullOrWhiteSpace(opts.Admin.Role));
            })
            .WithSummary("Whether the caller is an admin and which sign-in methods are configured");

        admin.MapPost("/login", LoginAsync)
            .RequireRateLimiting(LoginRateLimit)
            .AddEndpointFilter(RequireCsrfHeader)
            .WithSummary("Admin sign-in with the configured password (Telemetry__Admin__Password); sets a session cookie");

        admin.MapPost("/logout", async (HttpContext ctx) =>
            {
                await ctx.SignOutAsync(Scheme);
                return Results.NoContent();
            })
            .AddEndpointFilter(RequireCsrfHeader)
            .WithSummary("Ends the admin session");

        admin.MapGet("/machines", (AdminService s, CancellationToken ct) => s.MachinesAsync(ct))
            .RequireAuthorization(Policy)
            .WithSummary("Every machine with its total build count");

        var write = admin.MapGroup("").RequireAuthorization(Policy).AddEndpointFilter(RequireCsrfHeader);

        write.MapDelete("/builds/{id:guid}", async (Guid id, AdminService s, HttpContext ctx, CancellationToken ct)
                => await s.DeleteBuildsAsync([id], Who(ctx), ct) > 0 ? Results.NoContent() : Results.NotFound())
            .WithSummary("Delete one build with its steps");

        write.MapPost("/builds/delete", async (DeleteBuildsRequest req, AdminService s, HttpContext ctx, CancellationToken ct) =>
            {
                if (req.Ids is not { Length: > 0 } || req.Ids.Length > 10_000)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["ids"] = ["1 to 10 000 build ids."] });
                }

                return Results.Ok(new DeleteResult(await s.DeleteBuildsAsync(req.Ids, Who(ctx), ct)));
            })
            .WithSummary("Delete several builds by id");

        write.MapPost("/builds/delete-matching", async (BuildFilter f, AdminService s, HttpContext ctx, CancellationToken ct)
                => Results.Ok(new DeleteResult(await s.DeleteMatchingBuildsAsync(f, Who(ctx), ct))))
            .WithSummary("Delete every build matching the build-list filter in the query string (range, project, machine, …)");

        write.MapDelete("/machines/{id:long}", async (long id, AdminService s, HttpContext ctx, CancellationToken ct)
                => await s.DeleteMachineAsync(id, Who(ctx), ct) is { } n ? Results.Ok(new DeleteResult(n)) : Results.NotFound())
            .WithSummary("Delete a machine with all its builds");

        write.MapPut("/step-categories", async (StepCategoryDto[] rules, AdminService s, HttpContext ctx, CancellationToken ct) =>
            {
                var errors = StepCategories.Validate(rules);
                if (errors.Count > 0)
                {
                    return Results.ValidationProblem(errors);
                }

                return Results.Ok(await s.SaveCategoriesAsync(rules, Who(ctx), ct));
            })
            .WithSummary("Replace the legend rules (ordered; the first matching rule wins)");

        return app;
    }

    private static async Task<IResult> LoginAsync(LoginRequest req, HttpContext ctx, IOptionsMonitor<TelemetryOptions> o, ILoggerFactory loggers)
    {
        var admin = o.CurrentValue.Admin;
        if (!admin.PasswordEnabled)
        {
            return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Password sign-in is not configured",
                detail: $"Set Telemetry__Admin__Password (at least {AdminOptions.AdminMinPasswordLength} characters) on the server.");
        }

        // constant-time compare of fixed-length digests: no length or prefix timing leak
        var ok = CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(Encoding.UTF8.GetBytes(req.Password ?? "")),
            SHA256.HashData(Encoding.UTF8.GetBytes(admin.Password!)));
        var log = loggers.CreateLogger("Admin");
        if (!ok)
        {
            log.LogWarning("Failed admin sign-in from {Ip}", ctx.Connection.RemoteIpAddress);
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Wrong password");
        }

        var identity = new ClaimsIdentity([new Claim(AdminClaim, "password"), new Claim(ClaimTypes.Name, "admin")], Scheme);
        await ctx.SignInAsync(Scheme, new ClaimsPrincipal(identity));
        log.LogInformation("Admin signed in from {Ip}", ctx.Connection.RemoteIpAddress);
        return Results.NoContent();
    }

    private static ValueTask<object?> RequireCsrfHeader(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next) =>
        ctx.HttpContext.Request.Headers.ContainsKey(CsrfHeader)
            ? next(ctx)
            : ValueTask.FromResult<object?>(Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: $"Missing {CsrfHeader} header"));

    private static string Who(HttpContext ctx) =>
        ctx.User.FindFirst("email")?.Value ?? ctx.User.Identity?.Name ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "?";

    public sealed record LoginRequest(string? Password);
    public sealed record DeleteBuildsRequest(Guid[]? Ids);
    public sealed record DeleteResult(int Deleted);
    public sealed record AdminSession(bool IsAdmin, string? Via, bool PasswordConfigured, bool RoleConfigured);
}
