using System.Text.RegularExpressions;

namespace BuildTelemetry.Api.Admin;

/// <summary>
/// A legend rule: steps that match get their own name and colour on the build timeline.
/// Rules are evaluated in <see cref="Position"/> order; the first match wins.
/// </summary>
public sealed class StepCategoryDto
{
    public long Id { get; init; }
    public int Position { get; init; }
    public string Name { get; init; } = "";

    /// <summary>Categorical palette slot 1-8 (the dashboard maps it to the light/dark colour).</summary>
    public int ColorSlot { get; init; }

    /// <summary>Only steps of this role (compile, link, custom, ...); null = any role.</summary>
    public string? Role { get; init; }

    /// <summary>What the pattern is matched against: command, file (source or output) or target.</summary>
    public string Field { get; init; } = "command";

    public string Pattern { get; init; } = "";
    public bool IsRegex { get; init; }
    public bool Enabled { get; init; } = true;
}

public static class StepCategories
{
    public const int MaxRules = 64;
    public static readonly string[] Fields = ["command", "file", "target"];
    public static readonly string[] Roles = ["compile", "link", "custom", "install", "test", "configure", "generate"];

    /// <summary>Commands are matched on their first 4 KB (the tool and its leading arguments).</summary>
    public const int CommandPrefix = 4096;

    /// <summary>Validation errors keyed by "rules[i].field", empty when the set is valid.</summary>
    public static Dictionary<string, string[]> Validate(IReadOnlyList<StepCategoryDto> rules)
    {
        var errors = new Dictionary<string, string[]>();
        if (rules.Count > MaxRules)
        {
            errors["rules"] = [$"At most {MaxRules} rules."];
        }

        for (var i = 0; i < rules.Count; i++)
        {
            var r = rules[i];
            if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 64)
            {
                errors[$"rules[{i}].name"] = ["Name is required (at most 64 characters)."];
            }

            if (r.ColorSlot is < 1 or > 8)
            {
                errors[$"rules[{i}].colorSlot"] = ["Colour slot must be 1-8."];
            }

            if (r.Role is not null && !Roles.Contains(r.Role))
            {
                errors[$"rules[{i}].role"] = [$"Role must be empty or one of {string.Join(", ", Roles)}."];
            }

            if (!Fields.Contains(r.Field))
            {
                errors[$"rules[{i}].field"] = [$"Field must be one of {string.Join(", ", Fields)}."];
            }

            if (string.IsNullOrEmpty(r.Pattern) || r.Pattern.Length > 512)
            {
                errors[$"rules[{i}].pattern"] = ["Pattern is required (at most 512 characters)."];
            }
            else if (r.IsRegex && Compile(r.Pattern) is null)
            {
                errors[$"rules[{i}].pattern"] = ["Not a valid regular expression (lookarounds and backreferences are not supported)."];
            }
        }

        return errors;
    }

    /// <summary>
    /// Non-backtracking: matching time is linear in the input, so a rule can never stall the
    /// server, whatever pattern an admin enters.
    /// </summary>
    internal static Regex? Compile(string pattern)
    {
        try
        {
            return new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException)
        {
            return null;
        }
    }

    /// <summary>Compiled rule set for one request.</summary>
    public sealed class Matcher
    {
        private readonly List<(StepCategoryDto Rule, Regex? Regex)> _rules;

        public Matcher(IEnumerable<StepCategoryDto> rules)
        {
            _rules = rules.Where(r => r.Enabled).OrderBy(r => r.Position).ThenBy(r => r.Id)
                .Select(r => (r, r.IsRegex ? Compile(r.Pattern) : null))
                .Where(x => !x.Item1.IsRegex || x.Item2 is not null)
                .ToList();
        }

        public bool IsEmpty => _rules.Count == 0;

        /// <summary>Roles whose command lines are needed (null in the set = every role).</summary>
        public HashSet<string?> CommandRoles => _rules.Where(r => r.Rule.Field == "command").Select(r => r.Rule.Role).ToHashSet();

        public long? Match(string role, string? command, string? source, string? output, string? target)
        {
            foreach (var (rule, regex) in _rules)
            {
                if (rule.Role is not null && rule.Role != role)
                {
                    continue;
                }

                var hit = rule.Field switch
                {
                    "command" => Test(command, rule, regex),
                    "file" => Test(source, rule, regex) || Test(output, rule, regex),
                    "target" => Test(target, rule, regex),
                    _ => false,
                };
                if (hit)
                {
                    return rule.Id;
                }
            }

            return null;
        }

        private static bool Test(string? value, StepCategoryDto rule, Regex? regex) =>
            !string.IsNullOrEmpty(value) &&
            (regex?.IsMatch(value) ?? value.Contains(rule.Pattern, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Short name of the program a command runs: "moc", "python", "cmake -E copy_if_different".
    /// Skips a leading "cd … &amp;&amp;" and the cmd.exe / sh wrappers CMake puts around custom commands.
    /// </summary>
    public static string? ToolName(string? command)
    {
        if (string.IsNullOrWhiteSpace(command))
        {
            return null;
        }

        var c = command;
        var amp = c.LastIndexOf(" && ", StringComparison.Ordinal);
        if (amp >= 0)
        {
            c = c[(amp + 4)..];
        }

        var args = SplitArgs(c, 4);
        while (args.Count > 0 && Strip(args[0]) is "cmd" or "sh" or "bash" && args.Count > 2 && args[1] is "/C" or "/c" or "-c")
        {
            args = SplitArgs(args[2].Trim('"'), 4);
        }

        if (args.Count == 0)
        {
            return null;
        }

        var tool = Strip(args[0]);
        if (tool is "cmake" && args.Count > 2 && args[1] == "-E")
        {
            return $"cmake -E {args[2]}";
        }

        if (tool is "python" or "python3" or "py" or "node" or "perl" or "ruby" && args.Count > 1 && !args[1].StartsWith('-'))
        {
            return $"{tool} {FileName(args[1])}";
        }

        return tool.Length > 64 ? tool[..64] : tool;

        static string Strip(string exe)
        {
            var n = FileName(exe);
            foreach (var ext in new[] { ".exe", ".bat", ".cmd", ".com" })
            {
                if (n.EndsWith(ext, StringComparison.OrdinalIgnoreCase))
                {
                    return n[..^ext.Length];
                }
            }

            return n;
        }

        static string FileName(string path)
        {
            var p = path.Trim('"', '\'').Replace('\\', '/');
            var i = p.LastIndexOf('/');
            return i >= 0 ? p[(i + 1)..] : p;
        }
    }

    /// <summary>First <paramref name="max"/> whitespace-separated arguments, honouring double quotes.</summary>
    private static List<string> SplitArgs(string s, int max)
    {
        var list = new List<string>();
        var i = 0;
        while (i < s.Length && list.Count < max)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i]))
            {
                i++;
            }

            if (i >= s.Length)
            {
                break;
            }

            var start = i;
            if (s[i] == '"')
            {
                var end = s.IndexOf('"', i + 1);
                i = end < 0 ? s.Length : end + 1;
                list.Add(s[(start + 1)..Math.Max(start + 1, i - 1)]);
                continue;
            }

            while (i < s.Length && !char.IsWhiteSpace(s[i]))
            {
                i++;
            }

            list.Add(s[start..i]);
        }

        return list;
    }
}
