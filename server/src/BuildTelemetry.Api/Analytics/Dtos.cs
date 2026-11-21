using System.Text.Json;
using System.Text.Json.Serialization;

namespace BuildTelemetry.Api.Analytics;

public sealed class OverviewDto
{
    public long Builds { get; init; }
    public long Failed { get; init; }
    public double? SuccessRate { get; init; }
    public long Machines { get; init; }
    public long Projects { get; init; }
    public long Developers { get; init; }
    public double? P50WallMs { get; init; }
    public double? P90WallMs { get; init; }
    public double? AvgWallMs { get; init; }
    public long TotalWallMs { get; init; }
    public long CompileUnits { get; init; }
    public double? AvgCompileMs { get; init; }
    public double? AvgParallelism { get; init; }
    public long FullBuilds { get; init; }
    public double? FullP50WallMs { get; init; }
    public long CiBuilds { get; init; }
    public OverviewDto? Previous { get; set; }
}

public sealed class TrendPointDto
{
    public DateTimeOffset Bucket { get; init; }
    public long Builds { get; init; }
    public long Failed { get; init; }
    public double? P50WallMs { get; init; }
    public double? P90WallMs { get; init; }
    public double? AvgWallMs { get; init; }
    public double? FullP50WallMs { get; init; }
    public long CompileUnits { get; init; }
}

public sealed class BuildListItemDto
{
    public Guid Id { get; init; }
    public string Project { get; init; } = "";
    public long MachineId { get; init; }
    public string? Hostname { get; init; }
    public string? CpuModel { get; init; }
    public int? LogicalCores { get; init; }
    public string? OsPretty { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public long WallMs { get; init; }
    public bool Success { get; init; }
    public string Kind { get; init; } = "";
    public int CompileCount { get; init; }
    public long CompileMs { get; init; }
    public int LinkCount { get; init; }
    public int FailedCount { get; init; }
    public double? Parallelism { get; init; }
    public string? Branch { get; init; }
    public string? CommitSha { get; init; }
    public string? BuildType { get; init; }
    public bool IsCi { get; init; }
    public string? CiProvider { get; init; }
    public string? CxxCompilerId { get; init; }
    public string? CxxCompilerVersion { get; init; }
    public string? UserHash { get; init; }
    public long? MaxRssKb { get; init; }
    public string? Hook { get; init; }
}

public sealed record PagedResult<T>(IReadOnlyList<T> Items, long Total, int Page, int PageSize);

public sealed class BuildDetailDto
{
    public Guid Id { get; init; }
    public string Project { get; init; } = "";
    public DateTimeOffset ReceivedAt { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset FinishedAt { get; init; }
    public long WallMs { get; init; }
    public long ConfigureMs { get; init; }
    public long GenerateMs { get; init; }
    public string? Hook { get; init; }
    public string Kind { get; init; } = "";
    public bool Success { get; init; }
    public int CompileCount { get; init; }
    public long CompileMs { get; init; }
    public int LinkCount { get; init; }
    public long LinkMs { get; init; }
    public int CustomCount { get; init; }
    public long CustomMs { get; init; }
    public int FailedCount { get; init; }
    public long TotalStepMs { get; init; }
    public double? Parallelism { get; init; }
    public long? MaxRssKb { get; init; }
    public long? OutputBytes { get; init; }
    public string? BuildType { get; init; }
    public string? Generator { get; init; }
    public string? BuildTool { get; init; }
    public string? CmakeVersion { get; init; }
    public string? CxxCompilerId { get; init; }
    public string? CxxCompilerVersion { get; init; }
    public string? CCompilerId { get; init; }
    public string? CCompilerVersion { get; init; }
    public string? CompilerLauncher { get; init; }
    public string? LinkerType { get; init; }
    public string? Branch { get; init; }
    public string? CommitSha { get; init; }
    public bool IsCi { get; init; }
    public string? CiProvider { get; init; }
    public string? CiUrl { get; init; }
    public string? CiJob { get; init; }
    public string? UserHash { get; init; }
    public string? Detail { get; init; }
    public string? ClientVersion { get; init; }
    public string? DataVersion { get; init; }
    public string? IngestKey { get; init; }
    public string? SourceDir { get; init; }
    public string? BuildDir { get; init; }
    [JsonIgnore] public string? Tags { get; init; }
    [JsonIgnore] public string? RoleStats { get; init; }
    [JsonIgnore] public string? SystemInfo { get; init; }

    [JsonPropertyName("tags")] public JsonElement? TagsJson => Json.Parse(Tags);
    [JsonPropertyName("roleStats")] public JsonElement? RoleStatsJson => Json.Parse(RoleStats);
    [JsonPropertyName("systemInfo")] public JsonElement? SystemInfoJson => Json.Parse(SystemInfo);

    public long MachineId { get; init; }
    public MachineDto? Machine { get; set; }
    public IReadOnlyList<TargetAggDto> Targets { get; set; } = [];
    public IReadOnlyList<RoleAggDto> Roles { get; set; } = [];
    public double? ProjectMedianFullWallMs { get; set; }
}

public sealed class TargetAggDto
{
    public string Target { get; init; } = "";
    public string? TargetType { get; init; }
    public long Compiles { get; init; }
    public long CompileMs { get; init; }
    public long LinkMs { get; init; }
    public long CustomMs { get; init; }
    public long FirstStartMs { get; init; }
    public long LastEndMs { get; init; }
}

public sealed class RoleAggDto
{
    public string Role { get; init; } = "";
    public long Count { get; init; }
    public long DurationMs { get; init; }
    public long Failed { get; init; }
}

public sealed class StepDto
{
    public int Seq { get; init; }
    public string Role { get; init; } = "";
    public string? Target { get; init; }
    public string? TargetType { get; init; }
    public string? Source { get; init; }
    public string? Output { get; init; }
    public string? Language { get; init; }
    public long StartMs { get; init; }
    public long DurationMs { get; init; }
    public int? Result { get; init; }
    public long? MaxRssKb { get; init; }
    public long? OutputBytes { get; init; }
    public bool HasCommand { get; init; }
    public int Lane { get; set; }
}

public sealed class StepDetailDto
{
    public int Seq { get; init; }
    public string Role { get; init; } = "";
    public string? Target { get; init; }
    public string? Source { get; init; }
    public string? Output { get; init; }
    public string? Config { get; init; }
    public long StartMs { get; init; }
    public long DurationMs { get; init; }
    public int? Result { get; init; }
    public long? MaxRssKb { get; init; }
    public long? UserTimeUs { get; init; }
    public long? SystemTimeUs { get; init; }
    public string? Command { get; init; }
}

public sealed class MachineDto
{
    public long Id { get; init; }
    public string MachineKey { get; init; } = "";
    public string? Hostname { get; init; }
    public string? OsName { get; init; }
    public string? OsRelease { get; init; }
    public string? OsPretty { get; init; }
    public string? CpuModel { get; init; }
    public string? CpuVendor { get; init; }
    public int? LogicalCores { get; init; }
    public int? PhysicalCores { get; init; }
    public double? CpuMhz { get; init; }
    public long? MemoryMb { get; init; }
    public bool IsCi { get; init; }
    public DateTimeOffset FirstSeen { get; init; }
    public DateTimeOffset LastSeen { get; init; }
    public long Builds { get; init; }
    public long Failed { get; init; }
    public double? P50WallMs { get; init; }
    public double? P50FullWallMs { get; init; }
    public double? AvgCompileMs { get; init; }
    public double? AvgParallelism { get; init; }
    public long? MaxRssKb { get; init; }
    public double? SpeedIndex { get; set; }
    public long SpeedSamples { get; set; }
}

public sealed class HardwareProfileDto
{
    public string Key { get; init; } = "";
    public string? CpuModel { get; init; }
    public int? LogicalCores { get; init; }
    public long? MemoryGb { get; init; }
    public string? OsName { get; init; }
    public long Machines { get; init; }
    public long Builds { get; init; }
    public double? P50WallMs { get; init; }
    public double? P50FullWallMs { get; init; }
    public double? AvgCompileMs { get; init; }
    public double? AvgParallelism { get; init; }
    public double? SpeedIndex { get; set; }
    public long SpeedSamples { get; set; }
}

public sealed class FileHotspotDto
{
    public string Source { get; init; } = "";
    public string? Target { get; init; }
    public long Compiles { get; init; }
    public long Builds { get; init; }
    public long Machines { get; init; }
    public double? AvgMs { get; init; }
    public double? P50Ms { get; init; }
    public double? P90Ms { get; init; }
    public long MaxMs { get; init; }
    public long TotalMs { get; init; }
    public double? AvgRssKb { get; init; }
    public long? MaxRssKb { get; init; }
    public long Failures { get; init; }
}

public sealed class TargetHotspotDto
{
    public string Target { get; init; } = "";
    public string? TargetType { get; init; }
    public long Compiles { get; init; }
    public long Builds { get; init; }
    public long CompileMs { get; init; }
    public double? AvgCompileMs { get; init; }
    public double? AvgLinkMs { get; init; }
    public long TotalMs { get; init; }
}

public sealed class CompareFileDto
{
    public string Source { get; init; } = "";
    public string? Target { get; init; }
    public long? AMs { get; init; }
    public long? BMs { get; init; }
    public long DeltaMs { get; init; }
}

public sealed record CompareResultDto(
    BuildListItemDto A,
    BuildListItemDto B,
    IReadOnlyList<CompareFileDto> Files,
    IReadOnlyList<RoleAggDto> RolesA,
    IReadOnlyList<RoleAggDto> RolesB);

public sealed record NamedCount(string Name, long Count);

public sealed record MachineOption(long Id, string? Hostname, string? CpuModel, bool IsCi);

public sealed record FiltersDto(
    IReadOnlyList<NamedCount> Projects,
    IReadOnlyList<string> Branches,
    IReadOnlyList<string> BuildTypes,
    IReadOnlyList<string> Compilers,
    IReadOnlyList<MachineOption> Machines,
    IReadOnlyList<string> CiProviders,
    IReadOnlyList<string> TagKeys);

internal static class Json
{
    public static JsonElement? Parse(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return null;
        }

        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }
}
