namespace BuildTelemetry.Api.Ingestion;

/// <summary>A validated, normalized bundle ready to be stored.</summary>
public sealed record NormalizedBundle(
    Guid BundleId,
    string ProjectName,
    MachineRecord Machine,
    BuildRecord Build,
    IReadOnlyList<StepRecord> Steps);

public sealed class MachineRecord
{
    public required string MachineKey { get; init; }
    public string? Hostname { get; init; }
    public string? OsName { get; init; }
    public string? OsRelease { get; init; }
    public string? OsPretty { get; init; }
    public string? OsPlatform { get; init; }
    public string? CpuModel { get; init; }
    public string? CpuVendor { get; init; }
    public int? LogicalCores { get; init; }
    public int? PhysicalCores { get; init; }
    public double? CpuMhz { get; init; }
    public long? MemoryMb { get; init; }
    public bool IsCi { get; init; }
}

public sealed class BuildRecord
{
    public Guid Id { get; init; }
    public DateTimeOffset StartedAt { get; init; }
    public DateTimeOffset FinishedAt { get; init; }
    public long WallMs { get; init; }
    public long ConfigureMs { get; init; }
    public long GenerateMs { get; init; }
    public string? Hook { get; init; }
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
    public string? IngestKey { get; set; }
    public string? SourceDir { get; init; }
    public string? BuildDir { get; init; }
    public string Tags { get; init; } = "{}";
    public string? RoleStats { get; init; }
    public string? SystemInfo { get; init; }
}

public sealed record StepRecord(
    int Seq,
    string Role,
    string? Target,
    string? TargetType,
    string? Source,
    string? Output,
    string? Language,
    string? Config,
    long StartOffsetMs,
    long DurationMs,
    int? Result,
    long? OutputBytes,
    long? MaxRssKb,
    long? UserTimeUs,
    long? SystemTimeUs,
    string? Command);

public sealed class BundleValidationException(string message) : Exception(message);

public enum IngestOutcome
{
    Created,
    Duplicate,
}

public sealed record IngestResult(Guid Id, IngestOutcome Outcome, int Steps);
