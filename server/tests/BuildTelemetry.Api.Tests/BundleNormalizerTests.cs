using System.Text.Json;
using BuildTelemetry.Api.Ingestion;

namespace BuildTelemetry.Api.Tests;

public class BundleNormalizerTests
{
    private static JsonElement Fixture(string name)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", name);
        return JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
    }

    [Fact]
    public void Full_bundle_from_cmake_client_is_normalized()
    {
        var b = BundleNormalizer.Normalize(Fixture("bundle-full-postCMakeBuild.json"));

        Assert.Equal("Exp3", b.ProjectName);
        Assert.Equal(400 + 1, b.Build.CompileCount);           // 400 generated TUs + main.cpp
        Assert.True(b.Build.Success);
        Assert.True(b.Build.WallMs > 0);
        Assert.True(b.Build.Parallelism > 1, "a ninja build with 32 threads must run steps concurrently");
        Assert.Equal("postCMakeBuild", b.Build.Hook);
        Assert.Equal("GNU", b.Build.CxxCompilerId);
        Assert.Equal("Ninja", b.Build.Generator);
        Assert.False(string.IsNullOrEmpty(b.Machine.CpuModel));
        Assert.True(b.Machine.LogicalCores > 0);
        Assert.Equal(b.Steps.Count, b.Steps.Select(s => s.Seq).Distinct().Count());

        var compile = b.Steps.First(s => s.Role == "compile");
        Assert.StartsWith("src/", compile.Source);              // relative to the project source dir
        Assert.NotNull(compile.Command);
        Assert.Equal("big", b.Steps.First(s => s.Source == "src/f1.cpp").Target);
        Assert.Equal("STATIC_LIBRARY", b.Steps.First(s => s.Target == "big").TargetType);
        Assert.All(b.Steps.Where(s => s.Role != "configure" && s.Role != "generate"), s => Assert.True(s.StartOffsetMs >= 0));
    }

    [Fact]
    public void Commands_are_dropped_when_server_policy_says_so()
    {
        var b = BundleNormalizer.Normalize(Fixture("bundle-full-postBuild.json"), storeCommands: false);
        Assert.All(b.Steps, s => Assert.Null(s.Command));
    }

    [Fact]
    public void Nocommands_bundle_has_steps_without_command_lines()
    {
        var b = BundleNormalizer.Normalize(Fixture("bundle-nocommands-postCMakeBuild.json"));
        Assert.Contains(b.Steps, s => s.Role == "compile");
        Assert.All(b.Steps, s => Assert.Null(s.Command));
        Assert.Equal("nocommands", b.Build.Detail);
    }

    [Fact]
    public void Anonymized_bundle_uses_placeholders_that_are_stripped()
    {
        var b = BundleNormalizer.Normalize(Fixture("bundle-nocommands-anon-postCMakeBuild.json"));
        var compile = b.Steps.First(s => s.Role == "compile");
        Assert.DoesNotContain("$SRC", compile.Source);
        Assert.StartsWith("src/", compile.Source);
        Assert.Matches("^[0-9a-f]{16}$", b.Machine.Hostname!);
    }

    [Fact]
    public void Summary_bundle_takes_counts_from_role_stats()
    {
        var b = BundleNormalizer.Normalize(Fixture("bundle-summary-postCMakeBuild.json"));
        Assert.DoesNotContain(b.Steps, s => s.Role == "compile");
        Assert.True(b.Build.CompileCount > 0);
        Assert.True(b.Build.CompileMs > 0);
        Assert.NotNull(b.Build.RoleStats);
    }

    [Theory]
    [InlineData("""{"schema":"other@1","bundleId":"6f1c0d4e-1111-2222-3333-444455556666"}""")]
    [InlineData("""{"schema":"build-telemetry/bundle@1","bundleId":"not-a-guid"}""")]
    [InlineData("""[1,2,3]""")]
    public void Invalid_bundles_are_rejected(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Throws<BundleValidationException>(() => BundleNormalizer.Normalize(doc.RootElement));
    }

    [Fact]
    public void Failed_compile_marks_build_failed()
    {
        const string json = """
        {
          "schema": "build-telemetry/bundle@1",
          "bundleId": "6f1c0d4e-1111-2222-3333-444455556666",
          "project": { "name": "p", "sourceDir": "C:/src/p", "buildDir": "C:/src/p/build" },
          "machine": { "id": "m1", "hostname": "h" },
          "snippets": [
            { "role": "build", "timeStart": 1000000, "duration": 5000, "result": null },
            { "role": "compile", "timeStart": 1000100, "duration": 2000, "result": 0, "source": "C:\\src\\p\\a.cpp", "target": "t" },
            { "role": "compile", "timeStart": 1000200, "duration": 3000, "result": 1, "source": "C:/src/p/b.cpp", "target": "t" }
          ]
        }
        """;
        using var doc = JsonDocument.Parse(json);
        var b = BundleNormalizer.Normalize(doc.RootElement);
        Assert.False(b.Build.Success);
        Assert.Equal(1, b.Build.FailedCount);
        Assert.Equal(5000, b.Build.WallMs);
        Assert.Equal(2, b.Build.CompileCount);
        Assert.Equal(1.0, b.Build.Parallelism);
        Assert.Equal(["a.cpp", "b.cpp"], b.Steps.Where(s => s.Role == "compile").Select(s => s.Source));
    }

    [Theory]
    [InlineData("C:\\src\\p\\x\\a.cpp", "C:/src/p", "x/a.cpp")]
    [InlineData("c:/SRC/p/a.cpp", "C:/src/p/", "a.cpp")]
    [InlineData("$SRC/a.cpp", "$SRC", "a.cpp")]
    [InlineData("/other/a.cpp", "/src/p", "/other/a.cpp")]
    public void Paths_are_made_relative(string path, string baseDir, string expected)
    {
        Assert.Equal(expected, BundleNormalizer.Relativize(path, baseDir, "$SRC/"));
    }

    [Theory]
    [InlineData("Windows", "10.0.26100", "Windows 11")]
    [InlineData("Windows", "10.0.19045", "Windows 10")]
    [InlineData("Linux", "6.8.0", "Linux 6.8.0")]
    public void Os_names_are_prettified(string os, string release, string expected)
    {
        Assert.Equal(expected, BundleNormalizer.PrettyOs(os, release, null));
    }
}
