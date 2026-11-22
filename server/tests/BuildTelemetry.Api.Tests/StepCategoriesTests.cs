using BuildTelemetry.Api.Admin;
using BuildTelemetry.Api.Ingestion;

namespace BuildTelemetry.Api.Tests;

public class StepCategoriesTests
{
    [Theory]
    // CMake keeps only "C:/Program" of "C:/Program Files/…" (broken quoting of --output)
    // … and the program at the start of the command is not the output
    [InlineData("C:/Program", "\"C:\\Program Files\\CMake\\bin\\cmake.exe\" -E copy a.h \"C:/Program Files/App/include/a.h\"", "C:/build",
        "C:/Program Files/App/include/a.h")]
    [InlineData("C:/Program", "\"C:/Program Files/App/deploy.exe\" --all", "C:/build", "C:/Program…")]
    // relative output: matched with the build directory in front, backslashes normalized
    [InlineData("dir", "cmake.exe -E touch \"C:\\build\\dir with space\\gen.txt\"", "C:/build", "C:/build/dir with space/gen.txt")]
    // complete outputs and unrelated quoted text stay untouched
    [InlineData("plain.txt", "cmake -E touch C:/build/plain.txt", "C:/build", "plain.txt")]
    [InlineData("dir", "cmake -E echo \"dir is here\"", null, "dir")]
    [InlineData("gen/a b.h", "whatever", "C:/build", "gen/a b.h")]
    public void Truncated_outputs_are_repaired_from_the_command(string output, string command, string? buildDir, string expected) =>
        Assert.Equal(expected, BundleNormalizer.RepairOutput(output, command, buildDir));

    [Theory]
    [InlineData("C:\\Qt\\6.8\\bin\\moc.exe -o moc_a.cpp a.h", "moc")]
    [InlineData("\"C:/Program Files/CMake/bin/cmake.exe\" -E copy_if_different a b", "cmake -E copy_if_different")]
    [InlineData("cd /D C:\\build && \"C:/Python312/python.exe\" C:/src/tools/gen_version.py --out v.h", "python gen_version.py")]
    [InlineData("/usr/bin/protoc --cpp_out=. a.proto", "protoc")]
    [InlineData("", null)]
    public void Tool_name_comes_from_the_command(string command, string? expected) =>
        Assert.Equal(expected, StepCategories.ToolName(command));

    [Fact]
    public void First_matching_enabled_rule_wins()
    {
        var m = new StepCategories.Matcher(
        [
            new StepCategoryDto { Id = 1, Position = 0, Name = "off", ColorSlot = 6, Field = "command", Pattern = "moc", Enabled = false },
            new StepCategoryDto { Id = 2, Position = 1, Name = "Qt moc", ColorSlot = 6, Role = "custom", Field = "command", Pattern = @"\bmoc(\.exe)?\b", IsRegex = true },
            new StepCategoryDto { Id = 3, Position = 2, Name = "generated", ColorSlot = 7, Field = "file", Pattern = "/gen/" },
            new StepCategoryDto { Id = 4, Position = 3, Name = "tests", ColorSlot = 8, Field = "target", Pattern = "_test" },
        ]);

        Assert.Equal(2, m.Match("custom", "C:/Qt/bin/moc.exe -o x.cpp x.h", null, "x.cpp", null));
        Assert.Null(m.Match("compile", "C:/Qt/bin/moc.exe", null, null, null));            // role filter
        Assert.Equal(3, m.Match("compile", "cl.exe", "src/GEN/a.cpp", null, null));        // case-insensitive
        Assert.Equal(4, m.Match("link", null, null, "bin/core_test.exe", "core_test"));
        Assert.Null(m.Match("link", null, null, null, null));
        Assert.Equal(new HashSet<string?> { "custom" }, m.CommandRoles);
    }

    [Fact]
    public void Invalid_rules_are_reported_per_field()
    {
        var errors = StepCategories.Validate(
        [
            new StepCategoryDto { Name = "", ColorSlot = 9, Role = "nope", Field = "x", Pattern = "(?<=a)b", IsRegex = true },
            new StepCategoryDto { Name = "ok", ColorSlot = 1, Field = "command", Pattern = "moc" },
        ]);

        Assert.Equal(
            new HashSet<string> { "rules[0].name", "rules[0].colorSlot", "rules[0].role", "rules[0].field", "rules[0].pattern" },
            errors.Keys.ToHashSet());
    }
}
