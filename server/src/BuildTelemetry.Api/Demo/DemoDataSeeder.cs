using System.Security.Cryptography;
using System.Text;
using BuildTelemetry.Api.Data;
using BuildTelemetry.Api.Ingestion;
using BuildTelemetry.Api.Options;
using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;

namespace BuildTelemetry.Api.Demo;

/// <summary>
/// Generates a realistic, deterministic fleet history (developer workstations, laptops,
/// CI runners; full and incremental builds; occasional failures) so the dashboard can
/// be evaluated without instrumenting real builds. Runs only when enabled and the
/// database contains no builds. Data goes through the regular <see cref="IngestService"/>.
/// </summary>
public sealed class DemoDataSeeder(
    IngestService ingest,
    NpgsqlDataSource dataSource,
    DatabaseReadiness readiness,
    IOptions<TelemetryOptions> options,
    ILogger<DemoDataSeeder> logger) : BackgroundService
{
    private sealed record Machine(
        string Key, string Host, string Cpu, int Threads, int Cores, long MemMb, string Os, string OsPretty, string OsRelease,
        double Speed, bool Ci, string CompilerId, string CompilerVersion, string[] Users, int BuildsPerDay);

    private sealed record SourceFile(string Path, string Target, double BaseMs, long RssKb);

    private sealed record Project(string Name, string[] Libraries, string[] Executables, List<SourceFile> Files);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Demo.Seed)
        {
            return;
        }

        await readiness.WaitAsync(stoppingToken);
        await using (var conn = await dataSource.OpenConnectionAsync(stoppingToken))
        {
            if (await conn.ExecuteScalarAsync<bool>("select exists(select 1 from builds)"))
            {
                logger.LogInformation("Demo seeding skipped: database already contains builds");
                return;
            }
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        var count = 0;
        foreach (var bundle in Generate(options.Value.Demo.Days, DateTimeOffset.UtcNow))
        {
            stoppingToken.ThrowIfCancellationRequested();
            await ingest.StoreAsync(bundle, stoppingToken);
            count++;
        }

        logger.LogInformation("Demo data seeded: {Count} builds in {Elapsed}", count, sw.Elapsed);
    }

    internal static IEnumerable<NormalizedBundle> Generate(int days, DateTimeOffset now)
    {
        var rng = new Random(20261121);
        var projects = new[]
        {
            MakeProject(rng, "atlas-engine",
                [("core", 90), ("render", 110), ("physics", 60), ("audio", 30), ("net", 50), ("scripting", 45)],
                ["atlas_editor", "atlas_tools", "atlas_tests"]),
            MakeProject(rng, "nova-sdk",
                [("api", 40), ("codec", 55), ("transport", 40), ("storage", 35)],
                ["nova_cli", "nova_tests"]),
        };

        var machines = new[]
        {
            new Machine("demo-ws-ryzen", "ws-zrh-017", "AMD Ryzen 9 7950X 16-Core Processor", 32, 16, 65536, "Linux", "Ubuntu 24.04.3 LTS", "6.8.0-79-generic", 1.35, false, "GNU", "14.2.0", ["anna", "marco"], 9),
            new Machine("demo-ws-i9", "ws-zrh-022", "13th Gen Intel(R) Core(TM) i9-13900K", 32, 24, 65536, "Windows", "Windows 11 Pro 25H2", "10.0.26200", 1.2, false, "MSVC", "19.44.35211.0", ["lukas"], 8),
            new Machine("demo-mbp-m3", "mbp-sarah", "Apple M3 Max", 16, 16, 65536, "macOS", "macOS 15.6", "24.6.0", 1.3, false, "AppleClang", "17.0.0.17000013", ["sarah"], 7),
            new Machine("demo-mbp-m1", "mbp-tom", "Apple M1 Pro", 10, 10, 32768, "macOS", "macOS 15.6", "24.6.0", 0.95, false, "AppleClang", "17.0.0.17000013", ["tom"], 6),
            new Machine("demo-lt-i7", "lt-nina", "11th Gen Intel(R) Core(TM) i7-1185G7 @ 3.00GHz", 8, 4, 32768, "Windows", "Windows 11 Enterprise 24H2", "10.0.26100", 0.55, false, "MSVC", "19.44.35211.0", ["nina"], 6),
            new Machine("demo-lt-7840u", "lt-jonas", "AMD Ryzen 7 PRO 7840U w/ Radeon 780M Graphics", 16, 8, 32768, "Windows", "Windows 11 Enterprise 24H2", "10.0.26100", 0.85, false, "MSVC", "19.44.35211.0", ["jonas"], 6),
            new Machine("demo-ws-xeon", "ws-ber-004", "Intel(R) Xeon(R) W-2245 CPU @ 3.90GHz", 16, 8, 131072, "Linux", "Rocky Linux 9.6 (Blue Onyx)", "5.14.0-570.el9.x86_64", 0.9, false, "Clang", "19.1.7", ["felix"], 7),
            new Machine("demo-ci-gh-1", "fv-az1271-604", "AMD EPYC 7763 64-Core Processor", 4, 2, 16384, "Linux", "Ubuntu 24.04.3 LTS", "6.11.0-1018-azure", 0.8, true, "GNU", "14.2.0", ["ci"], 10),
            new Machine("demo-ci-gh-2", "fv-az1271-911", "AMD EPYC 7763 64-Core Processor", 4, 2, 16384, "Linux", "Ubuntu 24.04.3 LTS", "6.11.0-1018-azure", 0.8, true, "GNU", "14.2.0", ["ci"], 10),
            new Machine("demo-ci-big", "build-runner-01", "AMD EPYC 9654 96-Core Processor", 64, 32, 262144, "Linux", "Ubuntu 22.04.5 LTS", "6.8.0-60-generic", 1.1, true, "Clang", "19.1.7", ["ci"], 14),
            new Machine("demo-ci-win", "win-runner-03", "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz", 8, 4, 32768, "Windows", "Windows Server 2022 Datacenter", "10.0.20348", 0.65, true, "MSVC", "19.44.35211.0", ["ci"], 8),
        };

        string[] branches = ["main", "main", "main", "develop", "feature/vulkan-backend", "feature/async-io", "fix/link-order", "release/2.4"];
        var start = now.Date.AddDays(-days);
        for (var day = 0; day <= days; day++)
        {
            var date = new DateTimeOffset(start.AddDays(day), TimeSpan.Zero);
            var weekend = date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            foreach (var m in machines)
            {
                var n = weekend ? (m.Ci ? m.BuildsPerDay / 3 : rng.Next(0, 2)) : rng.Next(m.BuildsPerDay / 2, m.BuildsPerDay + 1);
                for (var i = 0; i < n; i++)
                {
                    var hour = m.Ci ? rng.NextDouble() * 24 : 7.5 + rng.NextDouble() * 10.5;
                    var t = date.AddHours(hour);
                    if (t > now)
                    {
                        continue;
                    }

                    var project = projects[m.Ci ? rng.Next(projects.Length) : rng.NextDouble() < 0.3 ? 1 : 0];
                    var full = m.Ci ? rng.NextDouble() < 0.7 : rng.NextDouble() < 0.12;
                    var branch = branches[rng.Next(branches.Length)];
                    yield return Simulate(rng, project, m, t, full, branch, day, days);
                }
            }
        }
    }

    private static Project MakeProject(Random rng, string name, (string Lib, int Files)[] libs, string[] exes)
    {
        string[] stems =
        [
            "allocator", "arena", "buffer", "cache", "channel", "codec", "command_queue", "config", "context", "device",
            "dispatcher", "encoder", "entity", "event_loop", "executor", "fence", "filesystem", "frame_graph", "handle",
            "hash_map", "image", "instance", "job_system", "json", "layout", "loader", "logger", "material", "math",
            "memory", "mesh", "mutex", "node", "packet", "parser", "pipeline", "pool", "profiler", "queue", "reflection",
            "registry", "renderer", "resource", "scheduler", "serializer", "session", "shader", "socket", "stream",
            "string_util", "surface", "swapchain", "task", "texture", "thread", "timer", "transform", "uuid", "vector", "world",
        ];
        var files = new List<SourceFile>();
        foreach (var (lib, count) in libs)
        {
            for (var i = 0; i < count; i++)
            {
                var stem = stems[rng.Next(stems.Length)];
                var sub = i % 4 == 0 ? "detail/" : i % 7 == 0 ? "impl/" : "";
                var path = $"src/{lib}/{sub}{stem}{(i >= stems.Length / 2 ? "_" + i : "")}.cpp";
                if (files.Any(f => f.Path == path))
                {
                    path = $"src/{lib}/{sub}{stem}_{i}.cpp";
                }

                // log-normal compile cost; a few template-heavy outliers dominate
                var baseMs = Math.Exp(Math.Log(1400) + 0.65 * Normal(rng));
                if (rng.NextDouble() < 0.025)
                {
                    baseMs *= 6 + rng.NextDouble() * 8;
                }

                var rss = Math.Min(4_200_000L, (long)(180_000 + baseMs * 90 + rng.Next(0, 120_000)));
                files.Add(new SourceFile(path, lib, baseMs, rss));
            }
        }

        foreach (var exe in exes)
        {
            for (var i = 0; i < 6; i++)
            {
                files.Add(new SourceFile($"apps/{exe}/{stems[rng.Next(stems.Length)]}_{i}.cpp", exe,
                    Math.Exp(Math.Log(1100) + 0.5 * Normal(rng)), 220_000 + rng.Next(0, 200_000)));
            }
        }

        // named hotspots that make the hotspot view interesting
        files.Add(new SourceFile("src/render/shader_compiler_generated.cpp", libs[0].Lib, 26_000, 2_900_000));
        files.Add(new SourceFile("src/core/reflection_registry.cpp", libs[0].Lib, 14_500, 1_800_000));
        return new Project(name, libs.Select(l => l.Lib).ToArray(), exes, files);
    }

    private static NormalizedBundle Simulate(Random rng, Project project, Machine m, DateTimeOffset start, bool full, string branch, int day, int days)
    {
        var id = DeterministicGuid($"{project.Name}|{m.Key}|{start.ToUnixTimeMilliseconds()}");
        // gentle regression in week 3 for one project, fixed later: shows up in the trend chart
        var drift = project.Name == "atlas-engine" && day is >= 14 and <= 19 ? 1.18 : 1.0;
        var files = full
            ? project.Files
            : project.Files.OrderBy(_ => rng.Next()).Take(Math.Max(1, (int)Math.Round(Math.Exp(rng.NextDouble() * 3.4)))).ToList();
        var jobs = m.Threads + 2;
        var contention = 1 + 0.25 * Math.Min(1.0, (double)jobs / Math.Max(1, m.Cores * 2));
        var lanes = new long[jobs];
        var steps = new List<(string Role, string? Target, string? Source, string? Output, long Start, long Dur, int? Result, long? Rss, string? Cmd)>();
        long t0 = 0;

        var configure = full && (m.Ci || rng.NextDouble() < 0.6);
        if (configure)
        {
            var cfg = (long)(rng.Next(2500, 9000) / m.Speed);
            steps.Add(("configure", null, null, null, 0, cfg, 0, null, "cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo"));
            var gen = (long)(rng.Next(250, 1200) / m.Speed);
            steps.Add(("generate", null, null, null, cfg, gen, 0, null, null));
            t0 = cfg + gen;
        }

        Array.Fill(lanes, t0);
        var failAt = rng.NextDouble() < (m.Ci ? 0.02 : 0.035) ? rng.Next(files.Count) : -1;
        var targetEnd = new Dictionary<string, long>();
        var compiled = 0;
        var sep = m.Os == "Windows" ? "\\" : "/";
        var root = m.Os == "Windows" ? $"C:/src/{project.Name}" : m.Os == "macOS" ? $"/Users/{m.Users[0]}/src/{project.Name}" : $"/home/{m.Users[0]}/src/{project.Name}";
        foreach (var f in files)
        {
            var lane = 0;
            for (var l = 1; l < lanes.Length; l++)
            {
                if (lanes[l] < lanes[lane])
                {
                    lane = l;
                }
            }

            var dur = (long)(f.BaseMs * drift * contention / m.Speed * Math.Exp(0.08 * Normal(rng)));
            var result = compiled == failAt ? 1 : 0;
            var obj = $"CMakeFiles/{f.Target}.dir/{f.Path}.{(m.CompilerId == "MSVC" ? "obj" : "o")}";
            var cmd = m.CompilerId == "MSVC"
                ? $"C:{sep}PROGRA~1{sep}MICROS~1{sep}2022{sep}ENTERP~1{sep}VC{sep}Tools{sep}MSVC{sep}14.44.35207{sep}bin{sep}Hostx64{sep}x64{sep}cl.exe /nologo /TP -I{root}/src /DWIN32 /D_WINDOWS /EHsc /O2 /Ob1 /DNDEBUG /Zi /std:c++20 /Fo{obj} /c {root}/{f.Path}"
                : $"/usr/bin/{(m.CompilerId == "GNU" ? "g++" : "clang++")} -I{root}/src -O2 -g -DNDEBUG -std=c++20 -MD -MT {obj} -MF {obj}.d -o {obj} -c {root}/{f.Path}";
            steps.Add(("compile", f.Target, f.Path, obj, lanes[lane], dur, result, (long)(f.RssKb * (0.9 + rng.NextDouble() * 0.2)), cmd));
            lanes[lane] += dur + rng.Next(2, 15);
            targetEnd[f.Target] = Math.Max(targetEnd.GetValueOrDefault(f.Target), lanes[lane]);
            compiled++;
            if (result != 0)
            {
                break;
            }
        }

        var success = failAt < 0 || failAt >= files.Count;
        long end = lanes.Max();
        if (success)
        {
            var libEnd = t0;
            foreach (var lib in project.Libraries.Where(targetEnd.ContainsKey))
            {
                var dur = (long)(rng.Next(150, 900) / m.Speed);
                steps.Add(("link", lib, null, $"lib{lib}.a", targetEnd[lib], dur, 0, 40_000, $"ar qc lib{lib}.a ..."));
                libEnd = Math.Max(libEnd, targetEnd[lib] + dur);
            }

            foreach (var exe in project.Executables.Where(e => full || targetEnd.ContainsKey(e) || rng.NextDouble() < 0.5))
            {
                var at = Math.Max(libEnd, targetEnd.GetValueOrDefault(exe, t0));
                var dur = (long)(rng.Next(1500, 9000) / m.Speed);
                steps.Add(("link", exe, null, exe + (m.Os == "Windows" ? ".exe" : ""), at, dur, 0, rng.Next(600_000, 1_900_000), $"c++ -o {exe} ..."));
                end = Math.Max(end, at + dur);
            }
        }

        var buildStart = configure ? t0 - 50 : 0;
        steps.Insert(0, ("build", null, null, null, buildStart, end - buildStart + 40, null, null, null));

        var startMs = start.ToUnixTimeMilliseconds();
        var stepRecords = steps
            .OrderBy(s => s.Start)
            .Select((s, i) => new StepRecord(i, s.Role, s.Target, TargetType(project, s.Target), s.Source, s.Output, s.Role is "compile" or "link" ? "CXX" : null,
                "RelWithDebInfo", s.Start - buildStart, s.Dur, s.Result, s.Role == "compile" ? 180_000 + s.Dur * 40 : null, s.Rss,
                s.Role == "compile" ? s.Dur * 900 : null, s.Role == "compile" ? s.Dur * 60 : null, s.Cmd))
            .ToList();

        var compiles = stepRecords.Where(s => s.Role == "compile").ToList();
        var links = stepRecords.Where(s => s.Role == "link").ToList();
        var wall = end - buildStart + 40;
        var user = m.Users[rng.Next(m.Users.Length)];
        var record = new BuildRecord
        {
            Id = id,
            StartedAt = DateTimeOffset.FromUnixTimeMilliseconds(startMs),
            FinishedAt = DateTimeOffset.FromUnixTimeMilliseconds(startMs + wall),
            WallMs = wall,
            ConfigureMs = stepRecords.Where(s => s.Role == "configure").Sum(s => s.DurationMs),
            GenerateMs = stepRecords.Where(s => s.Role == "generate").Sum(s => s.DurationMs),
            Hook = m.Ci ? "postCMakeBuild" : "postBuild",
            Success = success,
            CompileCount = compiles.Count,
            CompileMs = compiles.Sum(s => s.DurationMs),
            LinkCount = links.Count,
            LinkMs = links.Sum(s => s.DurationMs),
            FailedCount = success ? 0 : 1,
            TotalStepMs = compiles.Sum(s => s.DurationMs) + links.Sum(s => s.DurationMs),
            Parallelism = Math.Round((double)(compiles.Sum(s => s.DurationMs) + links.Sum(s => s.DurationMs)) / Math.Max(1, wall), 3),
            MaxRssKb = stepRecords.Max(s => s.MaxRssKb),
            OutputBytes = stepRecords.Sum(s => s.OutputBytes ?? 0),
            BuildType = "RelWithDebInfo",
            Generator = "Ninja",
            BuildTool = "1.13.1",
            CmakeVersion = day < days / 2 ? "4.4.5" : "4.5.1",
            CxxCompilerId = m.CompilerId,
            CxxCompilerVersion = m.CompilerVersion,
            CompilerLauncher = !m.Ci && m.Os == "Linux" ? "ccache" : null,
            Branch = branch,
            CommitSha = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes($"{branch}{day}{rng.Next(4)}"))).ToLowerInvariant(),
            IsCi = m.Ci,
            CiProvider = m.Ci ? (m.Key.StartsWith("demo-ci-gh", StringComparison.Ordinal) ? "github" : "gitlab") : null,
            CiUrl = m.Ci ? $"https://ci.example.com/{project.Name}/jobs/{Math.Abs(id.GetHashCode())}" : null,
            CiJob = m.Ci ? $"{project.Name}/build-{(m.Os == "Windows" ? "windows" : "linux")}" : null,
            UserHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("user:" + user)))[..16].ToLowerInvariant(),
            Detail = "full",
            ClientVersion = AppVersion.Current,
            DataVersion = day < days / 2 ? "1.1" : "1.2",
            SourceDir = root,
            BuildDir = root + "/build",
            Tags = m.Ci ? "{\"pipeline\":\"ci\",\"team\":\"platform\"}" : "{\"team\":\"" + (project.Name == "atlas-engine" ? "engine" : "sdk") + "\"}",
            SystemInfo = $$"""{"OSName":"{{m.Os}}","OSRelease":"{{m.OsRelease}}","hostname":"{{m.Host}}","numberOfLogicalCPU":{{m.Threads}},"numberOfPhysicalCPU":{{m.Cores}},"totalPhysicalMemory":{{m.MemMb}},"processorName":"{{m.Cpu}}"}""",
        };

        var machine = new MachineRecord
        {
            MachineKey = m.Key,
            Hostname = m.Host,
            OsName = m.Os,
            OsRelease = m.OsRelease,
            OsPretty = m.OsPretty,
            OsPlatform = m.Cpu.StartsWith("Apple", StringComparison.Ordinal) ? "arm64" : "x86_64",
            CpuModel = m.Cpu,
            CpuVendor = m.Cpu.StartsWith("AMD", StringComparison.Ordinal) ? "AuthenticAMD" : m.Cpu.StartsWith("Apple", StringComparison.Ordinal) ? "Apple" : "GenuineIntel",
            LogicalCores = m.Threads,
            PhysicalCores = m.Cores,
            MemoryMb = m.MemMb,
            IsCi = m.Ci,
        };

        return new NormalizedBundle(id, project.Name, machine, record, stepRecords);
    }

    private static string? TargetType(Project p, string? target) =>
        target is null ? null : p.Libraries.Contains(target) ? "STATIC_LIBRARY" : "EXECUTABLE";

    private static double Normal(Random rng)
    {
        var u1 = 1.0 - rng.NextDouble();
        var u2 = rng.NextDouble();
        return Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }

    private static Guid DeterministicGuid(string s)
    {
        var h = SHA256.HashData(Encoding.UTF8.GetBytes(s));
        return new Guid(h.AsSpan(0, 16));
    }
}
