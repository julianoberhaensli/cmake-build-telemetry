using System.Text.RegularExpressions;
using BuildTelemetry.Api.Options;
using Microsoft.Extensions.Options;

namespace BuildTelemetry.Api.Client;

/// <summary>
/// Serves the CMake client pre-configured for this server, so onboarding is
/// <c>file(DOWNLOAD https://telemetry/api/v1/client/BuildTelemetry.cmake ...)</c>.
/// </summary>
public static partial class ClientEndpoints
{
    public static IEndpointRouteBuilder MapClientEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/client").WithTags("Client").AllowAnonymous();

        group.MapGet("/BuildTelemetry.cmake", async (HttpContext ctx, IOptionsSnapshot<TelemetryOptions> options, IWebHostEnvironment env) =>
            {
                var path = Path.Combine(AppContext.BaseDirectory, "client", "BuildTelemetry.cmake");
                if (!File.Exists(path))
                {
                    return Results.Problem("client module not bundled with this server build", statusCode: 503);
                }

                var text = await File.ReadAllTextAsync(path, ctx.RequestAborted);
                var url = PublicUrl(ctx, options.Value);
                text = DefaultUrlLine().Replace(text, $"set(_BT_DEFAULT_URL \"{url}\")", 1);
                return Results.Text(text, "text/plain; charset=utf-8");
            })
            .WithSummary("The CMake client module with this server's URL as default endpoint");

        group.MapGet("/info", (HttpContext ctx, IOptionsSnapshot<TelemetryOptions> options) =>
            {
                var o = options.Value;
                return Results.Ok(new
                {
                    publicUrl = PublicUrl(ctx, o),
                    ingestRequiresKey = o.Ingest.RequiresKey,
                    clientVersion = ClientVersion(),
                    authMode = o.Auth.Mode.ToString().ToLowerInvariant(),
                });
            })
            .WithSummary("Server facts the onboarding page needs");

        return app;
    }

    /// <summary>
    /// Configured public URL, else derived from the request. The value is embedded in a
    /// CMake script, so anything that is not a plain http(s) URL is rejected (Host header
    /// injection must not be able to smuggle CMake code into the download).
    /// </summary>
    internal static string PublicUrl(HttpContext ctx, TelemetryOptions o)
    {
        var url = !string.IsNullOrWhiteSpace(o.PublicUrl)
            ? o.PublicUrl.Trim().TrimEnd('/')
            : $"{ctx.Request.Scheme}://{ctx.Request.Host}{ctx.Request.PathBase}".TrimEnd('/');
        return SafeUrl().IsMatch(url) && Uri.TryCreate(url, UriKind.Absolute, out _) ? url : string.Empty;
    }

    [GeneratedRegex(@"^https?://[A-Za-z0-9.\-_:\[\]/~%]+$")]
    private static partial Regex SafeUrl();

    private static string? ClientVersion()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "client", "BuildTelemetry.cmake");
        if (!File.Exists(path))
        {
            return null;
        }

        foreach (var line in File.ReadLines(path).Take(80))
        {
            var m = VersionLine().Match(line);
            if (m.Success)
            {
                return m.Groups[1].Value;
            }
        }

        return null;
    }

    [GeneratedRegex("""^set\(_BT_DEFAULT_URL "[^"]*"\)""", RegexOptions.Multiline)]
    private static partial Regex DefaultUrlLine();

    [GeneratedRegex("""^set\(_BT_CLIENT_VERSION "([^"]+)"\)""")]
    private static partial Regex VersionLine();
}
