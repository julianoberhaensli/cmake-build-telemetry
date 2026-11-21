using BuildTelemetry.Api.Analytics;

namespace BuildTelemetry.Api.Tests;

public class LaneAssignmentTests
{
    private static StepDto Step(int seq, long start, long duration, string role = "compile") =>
        new() { Seq = seq, Role = role, StartMs = start, DurationMs = duration };

    [Fact]
    public void Overlapping_steps_get_distinct_lanes_and_lanes_are_reused()
    {
        var steps = new List<StepDto>
        {
            Step(0, 0, 100),
            Step(1, 10, 100),
            Step(2, 20, 30),
            Step(3, 100, 50),  // lane 0 is free again at t=100
            Step(4, 0, 500, "build"),
        };

        AnalyticsService.AssignLanes(steps);

        Assert.Equal(0, steps[0].Lane);
        Assert.Equal(1, steps[1].Lane);
        Assert.Equal(2, steps[2].Lane);
        Assert.Equal(0, steps[3].Lane);
        Assert.Equal(-1, steps[4].Lane);
    }

    [Fact]
    public void Lane_count_equals_peak_concurrency()
    {
        var rng = new Random(1);
        var steps = Enumerable.Range(0, 500).Select(i => Step(i, rng.Next(0, 10_000), rng.Next(1, 800))).ToList();
        AnalyticsService.AssignLanes(steps);

        var peak = 0;
        foreach (var s in steps)
        {
            peak = Math.Max(peak, steps.Count(o => o.StartMs <= s.StartMs && o.StartMs + o.DurationMs > s.StartMs));
        }

        Assert.Equal(peak, steps.Max(s => s.Lane) + 1);
        foreach (var group in steps.GroupBy(s => s.Lane))
        {
            var ordered = group.OrderBy(s => s.StartMs).ToList();
            for (var i = 1; i < ordered.Count; i++)
            {
                Assert.True(ordered[i].StartMs >= ordered[i - 1].StartMs + ordered[i - 1].DurationMs, "steps in one lane must not overlap");
            }
        }
    }
}
