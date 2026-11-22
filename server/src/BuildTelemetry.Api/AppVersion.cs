using System.Reflection;

namespace BuildTelemetry.Api;

/// <summary>
/// Release version of the server, the dashboard it hosts and the client it serves: the
/// repository's VERSION file, compiled in by Directory.Build.props.
/// </summary>
public static class AppVersion
{
    public static readonly string Current =
        typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? "0.0.0-dev";
}
