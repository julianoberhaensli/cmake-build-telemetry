using System.Text.Json;

namespace BuildTelemetry.Api.Ingestion;

/// <summary>
/// Converts a raw <c>build-telemetry/bundle@1</c> document (CMake instrumentation index +
/// snippets + client metadata) into normalized build / step records. Pure function, no I/O.
/// </summary>
public static class BundleNormalizer
{
    public const string Schema = "build-telemetry/bundle@1";
    private const int MaxCommandLength = 16 * 1024;
    private const int MaxPathLength = 2048;
    private const int MaxNameLength = 512;

    private static readonly HashSet<string> ToolRoles = new(StringComparer.Ordinal) { "build", "cmakeBuild" };

    public static NormalizedBundle Normalize(JsonElement root, bool storeCommands = true, int maxSteps = 250_000)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new BundleValidationException("bundle must be a JSON object");
        }

        var schema = Str(root, "schema");
        if (schema != Schema)
        {
            throw new BundleValidationException($"unsupported schema '{schema}', expected '{Schema}'");
        }

        if (!Guid.TryParse(Str(root, "bundleId"), out var bundleId) || bundleId == Guid.Empty)
        {
            throw new BundleValidationException("bundleId must be a UUID");
        }

        var project = Obj(root, "project");
        var machine = Obj(root, "machine");
        var system = Obj(root, "system");
        var build = Obj(root, "build");
        var vcs = Obj(root, "vcs");
        var ci = Obj(root, "ci");
        var client = Obj(root, "client");
        var compilers = build is { } b ? Obj(b, "compilers") : null;

        var sourceDir = Clean(Str(project, "sourceDir"), MaxPathLength);
        var buildDir = Clean(Str(project, "buildDir"), MaxPathLength);

        // --- target types and project name from CMake content files ---------------
        var targetTypes = new Dictionary<string, string>(StringComparer.Ordinal);
        string? contentProject = null;
        if (root.TryGetProperty("content", out var contents) && contents.ValueKind == JsonValueKind.Array)
        {
            foreach (var c in contents.EnumerateArray())
            {
                if (Obj(c, "data") is not { } data)
                {
                    continue;
                }

                contentProject ??= Str(data, "project");
                if (Obj(data, "targets") is { } targets)
                {
                    foreach (var t in targets.EnumerateObject())
                    {
                        if (Str(t.Value, "type") is { } type)
                        {
                            targetTypes.TryAdd(t.Name, type);
                        }
                    }
                }
            }
        }

        // --- snippets ---------------------------------------------------------------
        var raw = new List<RawStep>();
        if (root.TryGetProperty("snippets", out var snippets) && snippets.ValueKind == JsonValueKind.Array)
        {
            if (snippets.GetArrayLength() > maxSteps)
            {
                throw new BundleValidationException($"bundle has {snippets.GetArrayLength()} snippets, limit is {maxSteps}");
            }

            foreach (var s in snippets.EnumerateArray())
            {
                if (s.ValueKind != JsonValueKind.Object || Str(s, "role") is not { Length: > 0 } role)
                {
                    continue;
                }

                if (Long(s, "timeStart") is not { } start || start <= 0)
                {
                    continue;
                }

                var duration = Math.Max(0, Long(s, "duration") ?? 0);
                long? outputBytes = null;
                string? output = null;
                if (s.TryGetProperty("outputs", out var outs) && outs.ValueKind == JsonValueKind.Array && outs.GetArrayLength() > 0)
                {
                    output = outs[0].ValueKind == JsonValueKind.String ? outs[0].GetString() : null;
                }

                if (s.TryGetProperty("outputSizes", out var sizes) && sizes.ValueKind == JsonValueKind.Array)
                {
                    long sum = 0;
                    foreach (var sz in sizes.EnumerateArray())
                    {
                        if (sz.ValueKind == JsonValueKind.Number && sz.TryGetInt64(out var v))
                        {
                            sum += v;
                        }
                    }

                    outputBytes = sum;
                }

                var pm = Obj(s, "processMetrics");
                var target = Clean(Str(s, "target"), MaxNameLength);
                raw.Add(new RawStep(
                    Role: Clean(role, 64)!,
                    Target: target,
                    TargetType: target is not null && targetTypes.TryGetValue(target, out var tt) ? tt : null,
                    Source: Clean(Relativize(Str(s, "source"), sourceDir, "$SRC/"), MaxPathLength),
                    Output: Clean(Relativize(output, buildDir, "$BUILD/"), MaxPathLength),
                    Language: Clean(Str(s, "language"), 32),
                    Config: Clean(Str(s, "config"), 64),
                    Start: start,
                    Duration: duration,
                    Result: Int(s, "result"),
                    OutputBytes: outputBytes,
                    MaxRssKb: Long(pm, "maxRSS"),
                    UserTimeUs: Long(pm, "userTime"),
                    SystemTimeUs: Long(pm, "systemTime"),
                    Command: storeCommands ? Clean(Str(s, "command"), MaxCommandLength) : null));
            }
        }

        // --- timing window: the build tool run, else the span of everything ----------
        var tool = raw.Where(r => ToolRoles.Contains(r.Role)).ToList();
        long startedMs, finishedMs;
        if (tool.Count > 0)
        {
            startedMs = tool.Min(r => r.Start);
            finishedMs = tool.Max(r => r.Start + r.Duration);
        }
        else if (raw.Count > 0)
        {
            startedMs = raw.Min(r => r.Start);
            finishedMs = raw.Max(r => r.Start + r.Duration);
        }
        else
        {
            var created = Str(root, "createdAt") is { } ca && DateTimeOffset.TryParse(ca, out var dto) ? dto : DateTimeOffset.UtcNow;
            startedMs = finishedMs = created.ToUnixTimeMilliseconds();
        }

        var wallMs = Math.Max(0, finishedMs - startedMs);

        // --- aggregates (steps + roleStats from "summary" detail level) ---------------
        static (int Count, long Ms, int Failed) Agg(IEnumerable<RawStep> steps, string role)
        {
            var list = steps.Where(s => s.Role == role).ToList();
            return (list.Count, list.Sum(s => s.Duration), list.Count(s => s.Result is not null and not 0));
        }

        var compile = Agg(raw, "compile");
        var link = Agg(raw, "link");
        var custom = Agg(raw, "custom");
        var failed = raw.Count(s => s.Result is not null and not 0);
        string? roleStatsJson = null;
        if (Obj(root, "roleStats") is { } roleStats && roleStats.EnumerateObject().Any())
        {
            roleStatsJson = roleStats.GetRawText();
            foreach (var rs in roleStats.EnumerateObject())
            {
                var n = Int(rs.Value, "count") ?? 0;
                var ms = Long(rs.Value, "durationMs") ?? 0;
                var f = Int(rs.Value, "failed") ?? 0;
                failed += f;
                switch (rs.Name)
                {
                    case "compile": compile = (compile.Count + n, compile.Ms + ms, compile.Failed + f); break;
                    case "link": link = (link.Count + n, link.Ms + ms, link.Failed + f); break;
                    case "custom": custom = (custom.Count + n, custom.Ms + ms, custom.Failed + f); break;
                }
            }
        }

        var totalStepMs = compile.Ms + link.Ms + custom.Ms;
        var buildType = Clean(Str(build, "buildType"), 64);
        if (string.IsNullOrEmpty(buildType))
        {
            buildType = raw.Where(r => r.Role == "compile" && !string.IsNullOrEmpty(r.Config))
                .GroupBy(r => r.Config).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();
        }

        var steps = raw
            .OrderBy(r => r.Start).ThenBy(r => r.Role, StringComparer.Ordinal)
            .Select((r, i) => new StepRecord(i, r.Role, r.Target, r.TargetType, r.Source, r.Output, r.Language, r.Config,
                r.Start - startedMs, r.Duration, r.Result, r.OutputBytes, r.MaxRssKb, r.UserTimeUs, r.SystemTimeUs, r.Command))
            .ToList();

        // --- machine -------------------------------------------------------------------
        var hostname = Clean(Str(machine, "hostname") ?? Str(system, "hostname"), MaxNameLength);
        var machineKey = Clean(Str(machine, "id"), 128);
        if (string.IsNullOrEmpty(machineKey))
        {
            machineKey = "host:" + (hostname ?? "unknown");
        }

        var osName = Clean(Str(system, "OSName"), 64);
        var osRelease = Clean(Str(system, "OSRelease"), 64);
        var isCi = Bool(ci, "isCI") ?? false;

        var machineRecord = new MachineRecord
        {
            MachineKey = machineKey,
            Hostname = hostname,
            OsName = osName,
            OsRelease = osRelease,
            OsPretty = Clean(Str(machine, "osPrettyName"), 128) is { Length: > 0 } pretty ? pretty : PrettyOs(osName, osRelease, Str(system, "OSVersion")),
            OsPlatform = Clean(Str(system, "OSPlatform"), 32),
            CpuModel = Clean(Str(machine, "cpuModel"), MaxNameLength) is { Length: > 0 } cpu ? cpu : Clean(Str(system, "processorName"), MaxNameLength),
            CpuVendor = Clean(Str(system, "vendorString") ?? Str(system, "vendorID"), 64),
            LogicalCores = Int(system, "numberOfLogicalCPU"),
            PhysicalCores = Int(system, "numberOfPhysicalCPU"),
            CpuMhz = Double(system, "processorClockFrequency"),
            MemoryMb = Long(system, "totalPhysicalMemory"),
            IsCi = isCi,
        };

        var cxx = compilers is { } cs ? Obj(cs, "CXX") : null;
        var cc = compilers is { } cs2 ? Obj(cs2, "C") : null;
        var dataVersion = Obj(root, "dataVersion") is { } dv ? $"{Int(dv, "major") ?? 1}.{Int(dv, "minor") ?? 0}" : null;

        var record = new BuildRecord
        {
            Id = bundleId,
            StartedAt = DateTimeOffset.FromUnixTimeMilliseconds(startedMs),
            FinishedAt = DateTimeOffset.FromUnixTimeMilliseconds(finishedMs),
            WallMs = wallMs,
            ConfigureMs = raw.Where(r => r.Role == "configure").Sum(r => r.Duration),
            GenerateMs = raw.Where(r => r.Role == "generate").Sum(r => r.Duration),
            Hook = Clean(Str(root, "hook"), 64),
            Success = failed == 0 && tool.All(t => t.Result is null or 0),
            CompileCount = compile.Count,
            CompileMs = compile.Ms,
            LinkCount = link.Count,
            LinkMs = link.Ms,
            CustomCount = custom.Count,
            CustomMs = custom.Ms,
            FailedCount = failed,
            TotalStepMs = totalStepMs,
            Parallelism = wallMs > 0 && totalStepMs > 0 ? Math.Round((double)totalStepMs / wallMs, 3) : null,
            MaxRssKb = raw.Max(r => r.MaxRssKb),
            OutputBytes = raw.Where(r => r.Role is "compile" or "link").Sum(r => r.OutputBytes ?? 0) is var ob && ob > 0 ? ob : null,
            BuildType = buildType,
            Generator = Clean(Str(build, "generator"), 64),
            BuildTool = Clean(Str(build, "buildTool"), 128),
            CmakeVersion = Clean(Str(build, "cmakeVersion"), 32),
            CxxCompilerId = Clean(Str(cxx, "id"), 64),
            CxxCompilerVersion = Clean(Str(cxx, "version"), 64),
            CCompilerId = Clean(Str(cc, "id"), 64),
            CCompilerVersion = Clean(Str(cc, "version"), 64),
            CompilerLauncher = Clean(Str(build, "compilerLauncher"), 64),
            LinkerType = Clean(Str(build, "linkerType"), 64),
            Branch = Clean(Str(vcs, "branch"), 256),
            CommitSha = Clean(Str(vcs, "commit"), 64),
            IsCi = isCi,
            CiProvider = Clean(Str(ci, "provider"), 32),
            CiUrl = Clean(Str(ci, "url"), MaxPathLength),
            CiJob = Clean(Str(ci, "job"), MaxNameLength),
            UserHash = Clean(Str(machine, "user"), 128),
            Detail = Clean(Str(client, "detail"), 32),
            ClientVersion = Clean(Str(client, "version"), 32),
            DataVersion = dataVersion,
            SourceDir = sourceDir,
            BuildDir = buildDir,
            Tags = Obj(root, "tags") is { } tags ? tags.GetRawText() : "{}",
            RoleStats = roleStatsJson,
            SystemInfo = system?.GetRawText(),
        };

        var projectName = Clean(Str(project, "name"), MaxNameLength);
        if (string.IsNullOrWhiteSpace(projectName))
        {
            projectName = Clean(contentProject, MaxNameLength);
        }

        return new NormalizedBundle(bundleId, string.IsNullOrWhiteSpace(projectName) ? "unknown" : projectName!, machineRecord, record, steps);
    }

    internal static string? Relativize(string? path, string? baseDir, string placeholder)
    {
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        var p = path.Replace('\\', '/');
        if (p.StartsWith(placeholder, StringComparison.Ordinal))
        {
            return p[placeholder.Length..];
        }

        if (!string.IsNullOrEmpty(baseDir) && !baseDir.StartsWith('$'))
        {
            var b = baseDir.Replace('\\', '/').TrimEnd('/') + "/";
            if (p.StartsWith(b, StringComparison.OrdinalIgnoreCase))
            {
                return p[b.Length..];
            }
        }

        return p;
    }

    internal static string? PrettyOs(string? osName, string? release, string? version)
    {
        if (osName == "Windows" && release is not null)
        {
            var parts = release.Split('.');
            if (parts.Length >= 3 && int.TryParse(parts[2], out var buildNo))
            {
                return buildNo >= 22000 ? "Windows 11" : "Windows 10";
            }
        }

        return osName is null ? version : string.Join(' ', new[] { osName, release }.Where(s => !string.IsNullOrEmpty(s)));
    }

    private static string? Clean(string? s, int maxLength)
    {
        if (s is null)
        {
            return null;
        }

        if (s.Contains('\0'))
        {
            s = s.Replace("\0", string.Empty);
        }

        return s.Length > maxLength ? s[..maxLength] : s;
    }

    private static JsonElement? Obj(JsonElement? e, string name) =>
        e is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object ? v : null;

    private static string? Str(JsonElement? e, string name) =>
        e is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? Long(JsonElement? e, string name)
    {
        if (e is not { ValueKind: JsonValueKind.Object } o || !o.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number)
        {
            return null;
        }

        return v.TryGetInt64(out var l) ? l : v.TryGetDouble(out var d) ? (long)Math.Round(d) : null;
    }

    private static int? Int(JsonElement? e, string name) => Long(e, name) is { } l && l is >= int.MinValue and <= int.MaxValue ? (int)l : null;

    private static double? Double(JsonElement? e, string name) =>
        e is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;

    private static bool? Bool(JsonElement? e, string name) =>
        e is { ValueKind: JsonValueKind.Object } o && o.TryGetProperty(name, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False
            ? v.GetBoolean()
            : null;

    private sealed record RawStep(
        string Role, string? Target, string? TargetType, string? Source, string? Output, string? Language, string? Config,
        long Start, long Duration, int? Result, long? OutputBytes, long? MaxRssKb, long? UserTimeUs, long? SystemTimeUs, string? Command);
}
