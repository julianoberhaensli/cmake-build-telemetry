using System.Globalization;
using System.Text;
using Dapper;

namespace BuildTelemetry.Api.Analytics;

/// <summary>
/// Common dashboard filter, bound from the query string of every analytics endpoint:
/// <c>from, to, project, machine, branch, ci, kind, buildType, compiler, success, tag=key:value</c>.
/// All values end up as SQL parameters - never concatenated into SQL text.
/// </summary>
public sealed record BuildFilter(
    DateTimeOffset From,
    DateTimeOffset To,
    string? Project,
    long? Machine,
    string? Branch,
    bool? Ci,
    string? Kind,
    string? BuildType,
    string? Compiler,
    bool? Success,
    string? TagKey,
    string? TagValue)
{
    public static readonly TimeSpan DefaultRange = TimeSpan.FromDays(30);

    public static ValueTask<BuildFilter?> BindAsync(HttpContext ctx)
    {
        var q = ctx.Request.Query;
        var to = ParseDate(q["to"]) ?? DateTimeOffset.UtcNow;
        var from = ParseDate(q["from"]) ?? to - DefaultRange;
        if (from > to)
        {
            (from, to) = (to, from);
        }

        string? tagKey = null, tagValue = null;
        if (Text(q["tag"]) is { } tag && tag.IndexOf(':') is var i && i > 0)
        {
            tagKey = tag[..i];
            tagValue = tag[(i + 1)..];
        }

        return ValueTask.FromResult<BuildFilter?>(new BuildFilter(
            from, to,
            Text(q["project"]),
            long.TryParse(q["machine"], NumberStyles.Integer, CultureInfo.InvariantCulture, out var m) ? m : null,
            Text(q["branch"]),
            ParseBool(q["ci"]),
            Text(q["kind"]),
            Text(q["buildType"]),
            Text(q["compiler"]),
            ParseBool(q["success"]),
            tagKey, tagValue));
    }

    /// <summary>Builds a WHERE clause over the <c>builds</c> table aliased as <paramref name="b"/>.</summary>
    public string Where(DynamicParameters p, string b = "b", bool includeKind = true)
    {
        var sql = new StringBuilder($"where {b}.started_at >= @f_from and {b}.started_at < @f_to");
        p.Add("f_from", From.UtcDateTime);
        p.Add("f_to", To.UtcDateTime);

        if (Project is not null)
        {
            sql.Append($" and {b}.project_id = (select id from projects where name = @f_project)");
            p.Add("f_project", Project);
        }

        if (Machine is not null)
        {
            sql.Append($" and {b}.machine_id = @f_machine");
            p.Add("f_machine", Machine);
        }

        if (Branch is not null)
        {
            sql.Append($" and {b}.branch = @f_branch");
            p.Add("f_branch", Branch);
        }

        if (Ci is not null)
        {
            sql.Append($" and {b}.is_ci = @f_ci");
            p.Add("f_ci", Ci);
        }

        if (BuildType is not null)
        {
            sql.Append($" and lower({b}.build_type) = lower(@f_build_type)");
            p.Add("f_build_type", BuildType);
        }

        if (Compiler is not null)
        {
            sql.Append($" and {b}.cxx_compiler_id = @f_compiler");
            p.Add("f_compiler", Compiler);
        }

        if (Success is not null)
        {
            sql.Append($" and {b}.success = @f_success");
            p.Add("f_success", Success);
        }

        if (TagKey is not null)
        {
            sql.Append($" and {b}.tags @> jsonb_build_object(@f_tag_key::text, @f_tag_value::text)");
            p.Add("f_tag_key", TagKey);
            p.Add("f_tag_value", TagValue ?? string.Empty);
        }

        if (includeKind)
        {
            switch (Kind)
            {
                case null or "" or "builds":
                    sql.Append($" and {b}.kind in ('full', 'incremental')");
                    break;
                case "all":
                    break;
                default:
                    sql.Append($" and {b}.kind = @f_kind");
                    p.Add("f_kind", Kind);
                    break;
            }
        }

        return sql.ToString();
    }

    /// <summary>The same filter shifted to the immediately preceding period of equal length.</summary>
    public BuildFilter PreviousPeriod()
    {
        var span = To - From;
        return this with { From = From - span, To = From };
    }

    private static string? Text(Microsoft.Extensions.Primitives.StringValues v)
    {
        var s = v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }

    private static bool? ParseBool(Microsoft.Extensions.Primitives.StringValues v) => v.ToString().ToLowerInvariant() switch
    {
        "true" or "1" or "yes" => true,
        "false" or "0" or "no" => false,
        _ => null,
    };

    private static DateTimeOffset? ParseDate(Microsoft.Extensions.Primitives.StringValues v) =>
        DateTimeOffset.TryParse(v.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var d) ? d.ToUniversalTime() : null;
}
