using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using BuildTelemetry.Api.Options;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace BuildTelemetry.Api.Security;

/// <summary>
/// Authenticates build clients with a named API key sent as
/// <c>Authorization: Bearer &lt;key&gt;</c> or <c>X-Api-Key: &lt;key&gt;</c>.
/// Keys are compared in constant time on their SHA-256 digests.
/// </summary>
public sealed class IngestKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IOptionsMonitor<TelemetryOptions> telemetry) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "IngestKey";
    public const string KeyNameClaim = "ingest_key";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var ingest = telemetry.CurrentValue.Ingest;
        var presented = ReadKey(Request);

        var keys = ingest.EffectiveKeys.ToList();
        if (keys.Count == 0)
        {
            return Task.FromResult(ingest.AllowAnonymous
                ? Success("anonymous")
                : AuthenticateResult.Fail("ingestion is closed: no API keys configured"));
        }

        if (presented is null)
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var presentedHash = SHA256.HashData(Encoding.UTF8.GetBytes(presented));
        foreach (var (name, secret) in keys)
        {
            var expected = SHA256.HashData(Encoding.UTF8.GetBytes(secret));
            if (CryptographicOperations.FixedTimeEquals(presentedHash, expected))
            {
                return Task.FromResult(Success(name));
            }
        }

        return Task.FromResult(AuthenticateResult.Fail("invalid API key"));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer realm=\"build-telemetry\"";
        return Task.CompletedTask;
    }

    private AuthenticateResult Success(string keyName)
    {
        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.Name, keyName), new Claim(KeyNameClaim, keyName)], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    private static string? ReadKey(HttpRequest request)
    {
        if (request.Headers.TryGetValue("X-Api-Key", out var apiKey) && !string.IsNullOrWhiteSpace(apiKey))
        {
            return apiKey.ToString().Trim();
        }

        var auth = request.Headers.Authorization.ToString();
        return auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? auth["Bearer ".Length..].Trim() : null;
    }
}
