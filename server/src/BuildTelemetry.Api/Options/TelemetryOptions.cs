namespace BuildTelemetry.Api.Options;

/// <summary>Root configuration section "Telemetry".</summary>
public sealed class TelemetryOptions
{
    public const string Section = "Telemetry";

    /// <summary>Externally reachable base URL (used for the pre-configured client download).</summary>
    public string? PublicUrl { get; set; }

    /// <summary>Directory for ASP.NET Core data-protection keys; share it between replicas when OIDC is enabled.</summary>
    public string? DataProtectionKeysPath { get; set; }

    public IngestOptions Ingest { get; set; } = new();
    public AuthOptions Auth { get; set; } = new();
    public AdminOptions Admin { get; set; } = new();
    public RetentionOptions Retention { get; set; } = new();
    public DemoOptions Demo { get; set; } = new();
}

public sealed class IngestOptions
{
    /// <summary>
    /// Named ingest API keys: name -> secret. Configure e.g. via environment
    /// variable <c>Telemetry__Ingest__ApiKeys__ci=…</c>. When empty and
    /// <see cref="AllowAnonymous"/> is true, ingestion is open (development).
    /// </summary>
    public Dictionary<string, string> ApiKeys { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Keys with a non-empty secret (an empty value, e.g. from KEY=${VAR:-}, is ignored).</summary>
    public IEnumerable<KeyValuePair<string, string>> EffectiveKeys => ApiKeys.Where(k => !string.IsNullOrWhiteSpace(k.Value));

    public bool RequiresKey => EffectiveKeys.Any() || !AllowAnonymous;

    /// <summary>Accept bundles without a key when no keys are configured.</summary>
    public bool AllowAnonymous { get; set; } = true;

    /// <summary>Maximum (decompressed) bundle size in bytes.</summary>
    public long MaxBundleBytes { get; set; } = 128L * 1024 * 1024;

    /// <summary>Maximum number of steps accepted per bundle.</summary>
    public int MaxStepsPerBundle { get; set; } = 250_000;

    /// <summary>Requests per minute per client (API key or IP).</summary>
    public int RateLimitPerMinute { get; set; } = 600;

    /// <summary>Drop command lines server-side even when the client sent them.</summary>
    public bool StoreCommands { get; set; } = true;
}

public enum DashboardAuthMode
{
    None,
    Oidc,
}

public sealed class AuthOptions
{
    public DashboardAuthMode Mode { get; set; } = DashboardAuthMode.None;
    public string? Authority { get; set; }
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public string[] Scopes { get; set; } = ["openid", "profile", "email"];

    /// <summary>Optional role/group claim value required to see the dashboard.</summary>
    public string? RequiredRole { get; set; }
    public string RoleClaimType { get; set; } = "roles";
}

/// <summary>
/// Administration (deleting builds and machines, legend rules). Admins sign in with
/// <see cref="Password"/>, or, with OIDC, by having <see cref="Role"/> in the role claim.
/// Without either, administration is disabled.
/// </summary>
public sealed class AdminOptions
{
    /// <summary>Admin password for the dashboard's admin sign-in (at least 12 characters).</summary>
    public string? Password { get; set; }

    /// <summary>OIDC mode: role/group claim value that makes a signed-in user an admin.</summary>
    public string? Role { get; set; }

    /// <summary>Admin session lifetime (sliding).</summary>
    public TimeSpan SessionLifetime { get; set; } = TimeSpan.FromHours(8);

    public bool PasswordEnabled => Password is { Length: >= AdminMinPasswordLength };

    public const int AdminMinPasswordLength = 12;
}

public sealed class RetentionOptions
{
    /// <summary>Builds older than this are deleted (0 = keep forever).</summary>
    public int Days { get; set; } = 180;

    /// <summary>Command lines are cleared after this many days to save space (0 = keep).</summary>
    public int CommandDays { get; set; } = 30;

    public TimeSpan Interval { get; set; } = TimeSpan.FromHours(1);
}

public sealed class DemoOptions
{
    /// <summary>Seed synthetic data on startup when the database is empty.</summary>
    public bool Seed { get; set; }
    public int Days { get; set; } = 30;
}
