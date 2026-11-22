using System.IO.Compression;
using System.Security.Claims;
using System.Threading.RateLimiting;
using BuildTelemetry.Api;
using BuildTelemetry.Api.Admin;
using BuildTelemetry.Api.Analytics;
using BuildTelemetry.Api.Client;
using BuildTelemetry.Api.Data;
using BuildTelemetry.Api.Demo;
using BuildTelemetry.Api.Ingestion;
using BuildTelemetry.Api.Maintenance;
using BuildTelemetry.Api.Options;
using BuildTelemetry.Api.Security;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

var telemetry = builder.Configuration.GetSection(TelemetryOptions.Section).Get<TelemetryOptions>() ?? new TelemetryOptions();
builder.Services.Configure<TelemetryOptions>(builder.Configuration.GetSection(TelemetryOptions.Section));

// --- infrastructure -----------------------------------------------------------------
builder.Services.AddTelemetryDatabase(builder.Configuration);
builder.Services.AddSingleton<IngestService>();
builder.Services.AddSingleton<AnalyticsService>();
builder.Services.AddSingleton<AdminService>();
builder.Services.AddHostedService<MaintenanceService>();
builder.Services.AddHostedService<DemoDataSeeder>();

builder.Services.AddProblemDetails();
builder.Services.AddRequestDecompression();
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<BrotliCompressionProvider>();
    o.Providers.Add<GzipCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    // Behind a reverse proxy / ingress: trust it explicitly (Telemetry__TrustAllProxies=true in containers).
    if (builder.Configuration.GetValue<bool>("Telemetry:TrustAllProxies"))
    {
        o.KnownNetworks.Clear();
        o.KnownProxies.Clear();
    }
});
builder.Services.AddOpenApi(o => o.AddDocumentTransformer((doc, _, _) =>
{
    doc.Info.Title = "BuildTelemetry API";
    doc.Info.Version = AppVersion.Current;
    return Task.CompletedTask;
}));
if (!string.IsNullOrWhiteSpace(telemetry.DataProtectionKeysPath))
{
    builder.Services.AddDataProtection()
        .SetApplicationName("build-telemetry")
        .PersistKeysToFileSystem(new DirectoryInfo(telemetry.DataProtectionKeysPath));
}

builder.Services.AddHealthChecks()
    .AddCheck<PostgresHealthCheck>("postgres", tags: ["ready"]);

// --- rate limiting (per API key, else per client IP) --------------------------------
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy(IngestEndpoints.RateLimitPolicy, ctx =>
    {
        var key = ctx.User.FindFirst(IngestKeyAuthenticationHandler.KeyNameClaim)?.Value ?? "anon";
        var partition = $"{key}|{ctx.Connection.RemoteIpAddress}";
        return RateLimitPartition.GetFixedWindowLimiter(partition, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = Math.Max(1, telemetry.Ingest.RateLimitPerMinute),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        });
    });
    // admin password guessing: 10 attempts per minute and client IP
    o.AddPolicy(AdminEndpoints.LoginRateLimit, ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "?",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// --- authentication / authorization ---------------------------------------------------
var auth = builder.Services.AddAuthentication(o =>
    {
        o.DefaultScheme = telemetry.Auth.Mode == DashboardAuthMode.Oidc
            ? CookieAuthenticationDefaults.AuthenticationScheme
            : IngestKeyAuthenticationHandler.SchemeName;
    })
    .AddScheme<AuthenticationSchemeOptions, IngestKeyAuthenticationHandler>(IngestKeyAuthenticationHandler.SchemeName, null)
    // admin password session (both auth modes); SameSite=Strict, plus the CSRF header on writes
    .AddCookie(AdminEndpoints.Scheme, o =>
    {
        o.Cookie.Name = "bt.admin";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.SlidingExpiration = true;
        o.ExpireTimeSpan = telemetry.Admin.SessionLifetime;
        o.Events.OnRedirectToLogin = ctx => ApiAware(ctx, StatusCodes.Status401Unauthorized);
        o.Events.OnRedirectToAccessDenied = ctx => ApiAware(ctx, StatusCodes.Status403Forbidden);
    });

if (telemetry.Auth.Mode == DashboardAuthMode.Oidc)
{
    auth.AddCookie(o =>
        {
            o.Cookie.Name = "bt.session";
            o.LoginPath = "/auth/login";
            o.ReturnUrlParameter = "returnUrl";
            o.Cookie.SameSite = SameSiteMode.Lax;
            o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            o.SlidingExpiration = true;
            o.ExpireTimeSpan = TimeSpan.FromHours(8);
            // XHR calls get 401/403 instead of an HTML redirect; the SPA then navigates to /auth/login.
            o.Events.OnRedirectToLogin = ctx => ApiAware(ctx, StatusCodes.Status401Unauthorized);
            o.Events.OnRedirectToAccessDenied = ctx => ApiAware(ctx, StatusCodes.Status403Forbidden);
        })
        .AddOpenIdConnect(o =>
        {
            o.Authority = telemetry.Auth.Authority;
            o.ClientId = telemetry.Auth.ClientId;
            o.ClientSecret = telemetry.Auth.ClientSecret;
            o.ResponseType = "code";
            o.UsePkce = true;
            o.SaveTokens = false;
            o.GetClaimsFromUserInfoEndpoint = true;
            o.MapInboundClaims = false;
            o.TokenValidationParameters.NameClaimType = "name";
            o.TokenValidationParameters.RoleClaimType = telemetry.Auth.RoleClaimType;
            o.Scope.Clear();
            foreach (var scope in telemetry.Auth.Scopes)
            {
                o.Scope.Add(scope);
            }
        });
}

builder.Services.AddAuthorization(o =>
{
    o.AddPolicy(IngestEndpoints.Policy, p => p
        .AddAuthenticationSchemes(IngestKeyAuthenticationHandler.SchemeName)
        .RequireAuthenticatedUser());
    o.AddPolicy(AnalyticsEndpoints.Policy, p =>
    {
        if (telemetry.Auth.Mode == DashboardAuthMode.Oidc)
        {
            p.AddAuthenticationSchemes(CookieAuthenticationDefaults.AuthenticationScheme).RequireAuthenticatedUser();
            if (!string.IsNullOrWhiteSpace(telemetry.Auth.RequiredRole))
            {
                p.RequireRole(telemetry.Auth.RequiredRole);
            }
        }
        else
        {
            p.RequireAssertion(_ => true);
        }
    });
    o.AddPolicy(AdminEndpoints.Policy, p =>
    {
        p.AddAuthenticationSchemes(AdminEndpoints.Scheme);
        if (telemetry.Auth.Mode == DashboardAuthMode.Oidc)
        {
            p.AddAuthenticationSchemes(CookieAuthenticationDefaults.AuthenticationScheme);
        }

        p.RequireAssertion(ctx => AdminEndpoints.IsAdmin(ctx.User, telemetry));
    });
});

// --- OpenTelemetry (enabled when an OTLP endpoint is configured) -----------------------
if (!string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]))
{
    builder.Services.AddOpenTelemetry()
        .ConfigureResource(r => r.AddService("build-telemetry", serviceVersion: AppVersion.Current))
        .WithTracing(t => t.AddAspNetCoreInstrumentation().AddNpgsql().AddOtlpExporter())
        .WithMetrics(m => m
            .AddAspNetCoreInstrumentation()
            .AddRuntimeInstrumentation()
            .AddMeter(IngestService.Meter.Name)
            .AddOtlpExporter());
}

var app = builder.Build();

if (!telemetry.Ingest.EffectiveKeys.Any())
{
    app.Logger.LogWarning(telemetry.Ingest.AllowAnonymous
        ? "No ingest API keys configured: ingestion is OPEN to anonymous clients (set Telemetry__Ingest__ApiKeys__<name>=<secret>)"
        : "No ingest API keys configured and anonymous ingestion disabled: all uploads will be rejected");
}

if (!telemetry.Admin.PasswordEnabled && string.IsNullOrWhiteSpace(telemetry.Admin.Role))
{
    app.Logger.LogInformation(
        "Administration is disabled: set Telemetry__Admin__Password (at least {Min} characters) to delete builds and machines and edit legend rules",
        AdminOptions.AdminMinPasswordLength);
}
else if (!string.IsNullOrEmpty(telemetry.Admin.Password) && !telemetry.Admin.PasswordEnabled)
{
    app.Logger.LogWarning("Telemetry__Admin__Password is shorter than {Min} characters and is ignored", AdminOptions.AdminMinPasswordLength);
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseResponseCompression();
app.UseRequestDecompression();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // hashed asset names are immutable; index.html must always revalidate
        ctx.Context.Response.Headers.CacheControl = ctx.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase)
            ? "no-cache"
            : "public, max-age=31536000, immutable";
    },
});
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/healthz/live", new() { Predicate = _ => false });
app.MapHealthChecks("/healthz/ready", new() { Predicate = r => r.Tags.Contains("ready") });
app.MapOpenApi().AllowAnonymous();
app.MapScalarApiReference("/api/docs", o => o.WithTitle("BuildTelemetry API")).AllowAnonymous();

app.MapIngestEndpoints();
app.MapAnalyticsEndpoints();
app.MapClientEndpoints();
app.MapAdminEndpoints();

app.MapGet("/api/v1/me", (HttpContext ctx) => new
    {
        authenticated = ctx.User.Identity?.IsAuthenticated == true && ctx.User.Identity.AuthenticationType != IngestKeyAuthenticationHandler.SchemeName,
        name = ctx.User.Identity?.Name ?? ctx.User.FindFirst("email")?.Value,
        authMode = telemetry.Auth.Mode.ToString().ToLowerInvariant(),
        version = AppVersion.Current,
    })
    .WithTags("Session")
    .AllowAnonymous();

if (telemetry.Auth.Mode == DashboardAuthMode.Oidc)
{
    app.MapGet("/auth/login", (string? returnUrl) => Results.Challenge(
        new AuthenticationProperties { RedirectUri = SafeReturnUrl(returnUrl) },
        [OpenIdConnectDefaults.AuthenticationScheme])).AllowAnonymous();
    app.MapGet("/auth/logout", () => Results.SignOut(
        new AuthenticationProperties { RedirectUri = "/" },
        [CookieAuthenticationDefaults.AuthenticationScheme, OpenIdConnectDefaults.AuthenticationScheme])).AllowAnonymous();
}

// SPA: client-side routes fall back to index.html (behind dashboard auth when enabled)
app.MapFallbackToFile("index.html").RequireAuthorization(AnalyticsEndpoints.Policy);

app.Run();

static Task ApiAware(RedirectContext<CookieAuthenticationOptions> ctx, int status)
{
    if (ctx.Request.Path.StartsWithSegments("/api"))
    {
        ctx.Response.StatusCode = status;
        return Task.CompletedTask;
    }

    ctx.Response.Redirect(ctx.RedirectUri);
    return Task.CompletedTask;
}

static string SafeReturnUrl(string? returnUrl) =>
    !string.IsNullOrEmpty(returnUrl) && returnUrl.StartsWith('/') && !returnUrl.StartsWith("//", StringComparison.Ordinal) && !returnUrl.StartsWith("/\\", StringComparison.Ordinal)
        ? returnUrl
        : "/";

/// <summary>Readiness: migrations applied and the database answers.</summary>
internal sealed class PostgresHealthCheck(NpgsqlDataSource dataSource, DatabaseReadiness readiness) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        if (!readiness.IsReady)
        {
            return HealthCheckResult.Unhealthy("database migrations not applied yet");
        }

        try
        {
            await using var cmd = dataSource.CreateCommand("select 1");
            await cmd.ExecuteScalarAsync(cancellationToken);
            return HealthCheckResult.Healthy();
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("database unreachable", ex);
        }
    }
}

public partial class Program;
