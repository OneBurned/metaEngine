using System.Text.Json;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddGrid;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;

namespace MetaEngine.DomainTests;

public sealed class StrategyModuleTests
{
    [Fact]
    public async Task Rsi_executes_a_buy_on_the_point_after_the_cross()
    {
        var module = new RsiStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, 0.1),
            new StrategySourcePoint(3, -0.2),
            new StrategySourcePoint(4, 0.1)
        };
        using var parameters = JsonDocument.Parse("{\"rsiPeriod\":1,\"buyLevel\":30,\"sellLevel\":70}");

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        Assert.Equal(0, result.Rows[2].Diff);
        AssertClose(0.1, result.Rows[3].Diff);
        Assert.Equal(1, result.Summary.BuyCount);
    }

    [Fact]
    public async Task Rsi_generates_each_candidate_lazily_from_its_search_space()
    {
        var module = new RsiStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "rsiPeriod": { "from": 5, "to": 6, "step": 1 },
              "buyLevel": { "from": 20, "to": 30, "step": 10 },
              "sellLevel": { "from": 70, "to": 70, "step": 1 }
            }
            """);

        Assert.True(module.ValidateSearchSpace(searchSpace.RootElement).IsValid);
        Assert.Equal(4, module.EstimateCandidateCount(searchSpace.RootElement));

        var candidates = new List<JsonElement>();
        await foreach (var candidate in module.GenerateCandidatesAsync(searchSpace.RootElement, 42, CancellationToken.None))
        {
            candidates.Add(candidate);
        }

        Assert.Equal(4, candidates.Count);
        Assert.Equal(5, candidates[0].GetProperty("rsiPeriod").GetInt32());
        Assert.Equal(20, candidates[0].GetProperty("buyLevel").GetDouble());
        Assert.Equal(5, candidates[1].GetProperty("rsiPeriod").GetInt32());
        Assert.Equal(6, candidates[2].GetProperty("rsiPeriod").GetInt32());
        Assert.Equal(20, candidates[2].GetProperty("buyLevel").GetDouble());
        Assert.Equal(6, candidates[^1].GetProperty("rsiPeriod").GetInt32());
        Assert.Equal(30, candidates[^1].GetProperty("buyLevel").GetDouble());
    }

    [Fact]
    public async Task Rsi_summary_matches_full_calculation_after_the_cached_period_changes()
    {
        var module = new RsiStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, 0.15),
            new StrategySourcePoint(3, -0.25),
            new StrategySourcePoint(4, 0.08),
            new StrategySourcePoint(5, 0.12),
            new StrategySourcePoint(6, -0.18),
            new StrategySourcePoint(7, 0.06)
        };
        using var firstParameters = JsonDocument.Parse("{\"rsiPeriod\":1,\"buyLevel\":35,\"sellLevel\":65}");
        using var secondParameters = JsonDocument.Parse("{\"rsiPeriod\":2,\"buyLevel\":35,\"sellLevel\":65}");

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var firstSummary = await module.CalculateSummaryAsync(prepared, firstParameters.RootElement, CancellationToken.None);
        _ = await module.CalculateSummaryAsync(prepared, secondParameters.RootElement, CancellationToken.None);
        var firstSummaryAfterPeriodChange = await module.CalculateSummaryAsync(prepared, firstParameters.RootElement, CancellationToken.None);
        var fullResult = await module.CalculateAsync(prepared, firstParameters.RootElement, CancellationToken.None);

        AssertSummaryEqual(firstSummary, firstSummaryAfterPeriodChange);
        AssertSummaryEqual(firstSummary, fullResult.Summary);
    }

    [Fact]
    public async Task Mdd_executes_the_target_weight_on_the_point_after_the_level()
    {
        var module = new MddMeanReversionStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.2),
            new StrategySourcePoint(3, 0.1)
        };
        using var parameters = JsonDocument.Parse("{\"levels\":[{\"drawdown\":-0.1,\"weight\":1}],\"takeProfit\":0}");

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        Assert.Equal(0, result.Rows[1].Diff);
        AssertClose(0.1, result.Rows[2].Diff);
        Assert.Equal(1, result.Summary.BuyCount);
    }

    [Fact]
    public async Task Mdd_summary_matches_full_calculation()
    {
        var module = new MddMeanReversionStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.15),
            new StrategySourcePoint(3, -0.1),
            new StrategySourcePoint(4, 0.2),
            new StrategySourcePoint(5, 0.05),
            new StrategySourcePoint(6, -0.18),
            new StrategySourcePoint(7, 0.25)
        };
        using var parameters = JsonDocument.Parse("""
            {"levels":[{"drawdown":-0.1,"weight":0.25},{"drawdown":-0.2,"weight":0.5}],"takeProfit":0.01}
            """);

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var summary = await module.CalculateSummaryAsync(prepared, parameters.RootElement, CancellationToken.None);
        var fullResult = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        AssertSummaryEqual(summary, fullResult.Summary);
    }

    [Fact]
    public async Task Mdd_grid_opens_every_level_crossed_by_a_gap_and_uses_incremental_weights()
    {
        var module = new MddGridStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.3),
            new StrategySourcePoint(3, 0.1)
        };
        using var parameters = JsonDocument.Parse("""
            {
              "maxTotalWeight": 0.3,
              "levels": [
                { "drawdown": -0.1, "weight": 0.1, "exitMetric": "source_dd", "takeProfit": 0 },
                { "drawdown": -0.2, "weight": 0.2, "exitMetric": "source_dd", "takeProfit": 0 }
              ]
            }
            """);

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        Assert.Equal(0, result.Rows[1].Diff);
        AssertClose(0.03, result.Rows[2].Diff);
        Assert.Equal(2, result.Summary.BuyCount);
    }

    [Fact]
    public async Task Mdd_grid_rearms_a_closed_lot_for_a_fresh_source_drawdown_cross()
    {
        var module = new MddGridStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.2),
            new StrategySourcePoint(3, 0.25),
            new StrategySourcePoint(4, -0.11),
            new StrategySourcePoint(5, 0.01),
        };
        using var parameters = JsonDocument.Parse("""
            {
              "maxTotalWeight": 0.2,
              "levels": [
                { "drawdown": -0.1, "weight": 0.2, "exitMetric": "source_dd", "takeProfit": 0 }
              ]
            }
            """);

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        AssertClose(0.05, result.Rows[2].Diff);
        Assert.Equal(0, result.Rows[3].Diff);
        AssertClose(0.002, result.Rows[4].Diff);
        Assert.Equal(2, result.Summary.BuyCount);
        Assert.Equal(1, result.Summary.SellCount);
    }

    [Fact]
    public async Task Mdd_grid_matches_the_shared_golden_contract()
    {
        var fixturePath = Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "Golden",
            "mdd_grid_strategy.json");
        using var fixture = JsonDocument.Parse(File.ReadAllText(fixturePath));
        var root = fixture.RootElement;
        var input = root.GetProperty("input");
        var timestamps = input.GetProperty("timestamps").EnumerateArray().Select(value => value.GetInt64()).ToArray();
        var diffs = input.GetProperty("diffs").EnumerateArray().Select(value => value.GetDouble()).ToArray();
        var source = timestamps.Select((timestamp, index) => new StrategySourcePoint(timestamp, diffs[index])).ToArray();

        var module = new MddGridStrategyModule();
        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, input.GetProperty("config"), CancellationToken.None);
        var expected = root.GetProperty("expected");
        var expectedDiffs = expected.GetProperty("resultDiffs").EnumerateArray().Select(value => value.GetDouble()).ToArray();
        var tolerance = root.GetProperty("absoluteTolerance").GetDouble();

        Assert.Equal(expectedDiffs.Length, result.Rows.Count);
        for (var index = 0; index < expectedDiffs.Length; index++)
        {
            Assert.InRange(result.Rows[index].Diff, expectedDiffs[index] - tolerance, expectedDiffs[index] + tolerance);
        }

        var expectedSummary = expected.GetProperty("summary");
        Assert.Equal(expectedSummary.GetProperty("points").GetInt32(), result.Rows.Count);
        AssertClose(expectedSummary.GetProperty("finalAccum").GetDouble(), result.Summary.FinalAccum);
        AssertClose(expectedSummary.GetProperty("hwm").GetDouble(), result.Summary.HighWaterMark);
        AssertClose(expectedSummary.GetProperty("maxDrawdown").GetDouble(), result.Summary.MaxDrawdown);
        Assert.Equal(expectedSummary.GetProperty("buyCount").GetInt32(), result.Summary.BuyCount);
        Assert.Equal(expectedSummary.GetProperty("sellCount").GetInt32(), result.Summary.SellCount);
    }

    [Fact]
    public async Task Mdd_grid_can_close_a_lot_by_the_meta_strategy_high_water_mark()
    {
        var module = new MddGridStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.2),
            new StrategySourcePoint(3, 0.1),
            new StrategySourcePoint(4, -0.1)
        };
        using var parameters = JsonDocument.Parse("""
            {
              "maxTotalWeight": 0.2,
              "levels": [
                { "drawdown": -0.1, "weight": 0.2, "exitMetric": "strategy_hwm", "takeProfit": 0.01 }
              ]
            }
            """);

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        AssertClose(0.02, result.Rows[2].Diff);
        Assert.Equal(1, result.Summary.SellCount);
        Assert.Equal(0, result.Rows[3].Diff);
    }

    [Fact]
    public void Mdd_grid_rejects_entry_weights_above_the_total_weight_cap()
    {
        var module = new MddGridStrategyModule();
        using var parameters = JsonDocument.Parse("""
            {
              "maxTotalWeight": 1,
              "levels": [
                { "drawdown": -0.1, "weight": 0.6, "exitMetric": "source_dd", "takeProfit": 0.01 },
                { "drawdown": -0.2, "weight": 0.6, "exitMetric": "source_dd", "takeProfit": 0.01 }
              ]
            }
            """);

        var validation = module.ValidateParameters(parameters.RootElement);

        Assert.False(validation.IsValid);
        Assert.Contains(validation.Errors, error => error.Path == "levels.weight");
    }

    [Fact]
    public async Task Mdd_grid_closes_source_drawdown_lot_at_the_absolute_target()
    {
        var module = new MddGridStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.11),
            new StrategySourcePoint(3, 0.04),
            new StrategySourcePoint(4, 0.03),
            new StrategySourcePoint(5, 0)
        };
        using var parameters = JsonDocument.Parse("""
            {
              "maxTotalWeight": 0.2,
              "levels": [
                { "drawdown": -0.1, "weight": 0.2, "exitMetric": "source_dd", "takeProfit": 0.05 }
              ]
            }
            """);

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        AssertClose(0.008, result.Rows[2].Diff);
        AssertClose(0.006, result.Rows[3].Diff);
        Assert.Equal(0, result.Rows[4].Diff);
        Assert.Equal(1, result.Summary.SellCount);
    }

    [Fact]
    public async Task Mdd_grid_generates_valid_random_candidates_with_independent_take_profits()
    {
        var module = new MddGridStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "levelCount": 3,
              "minEntryDelta": 5,
              "maxTotalWeight": 60,
              "drawdown": { "from": 5, "to": 25, "step": 5 },
              "weight": { "from": 10, "to": 30, "step": 10 },
              "exitMetric": "source_dd",
              "takeProfit": { "from": 0, "to": 15, "step": 5 },
              "searchMode": "random",
              "maxCandidates": 4
            }
            """);

        Assert.True(module.ValidateSearchSpace(searchSpace.RootElement).IsValid);
        Assert.Equal(4, module.EstimateCandidateCount(searchSpace.RootElement));

        var candidates = new List<JsonElement>();
        await foreach (var candidate in module.GenerateCandidatesAsync(searchSpace.RootElement, 42, CancellationToken.None))
        {
            candidates.Add(candidate);
        }

        Assert.Equal(4, candidates.Count);
        foreach (var candidate in candidates)
        {
            var levels = candidate.GetProperty("levels").EnumerateArray().ToArray();
            Assert.Equal(3, levels.Length);
            var previousDrawdown = 0d;
            var previousWeight = double.NegativeInfinity;
            var totalWeight = 0d;
            foreach (var level in levels)
            {
                var drawdown = level.GetProperty("drawdown").GetDouble();
                var weight = level.GetProperty("weight").GetDouble();
                var takeProfit = level.GetProperty("takeProfit").GetDouble();
                Assert.True(drawdown < previousDrawdown);
                Assert.True(Math.Abs(drawdown - previousDrawdown) >= 0.05 - 1e-12);
                Assert.True(weight + 1e-12 >= previousWeight);
                Assert.True(takeProfit <= -drawdown + 1e-12);
                Assert.Equal("source_dd", level.GetProperty("exitMetric").GetString());
                previousDrawdown = drawdown;
                previousWeight = weight;
                totalWeight += weight;
            }
            Assert.True(totalWeight <= 0.6 + 1e-12);
        }
    }

    [Fact]
    public async Task Mdd_grid_full_search_streams_candidates_without_a_total_estimate()
    {
        var module = new MddGridStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "levelCount": 2,
              "minEntryDelta": 5,
              "maxTotalWeight": 30,
              "drawdown": { "from": 5, "to": 10, "step": 5 },
              "weight": { "from": 10, "to": 20, "step": 10 },
              "exitMetric": "source_dd",
              "takeProfit": { "from": 0, "to": 0, "step": 1 },
              "searchMode": "full",
              "maxCandidates": 1
            }
            """);

        Assert.True(module.ValidateSearchSpace(searchSpace.RootElement).IsValid);
        Assert.Null(module.EstimateCandidateCount(searchSpace.RootElement));

        var candidates = new List<JsonElement>();
        await foreach (var candidate in module.GenerateCandidatesAsync(searchSpace.RootElement, 42, CancellationToken.None))
        {
            candidates.Add(candidate);
        }

        Assert.Equal(2, candidates.Count);
        Assert.Equal(-0.05, candidates[0].GetProperty("levels")[0].GetProperty("drawdown").GetDouble(), 10);
        Assert.Equal(0.2, candidates[1].GetProperty("levels")[1].GetProperty("weight").GetDouble(), 10);
    }

    [Fact]
    public async Task Mdd_generates_random_candidates_with_ordered_levels_and_target_weights()
    {
        var module = new MddMeanReversionStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "parameterMode": "simple",
              "levelCount": 3,
              "minEntryDelta": 5,
              "maxTotalWeight": 40,
              "drawdown": { "from": 5, "to": 25, "step": 5 },
              "weight": { "from": 10, "to": 50, "step": 10 },
              "takeProfit": { "from": 0, "to": 2, "step": 1 },
              "searchMode": "random",
              "maxCandidates": 4
            }
            """);

        Assert.True(module.ValidateSearchSpace(searchSpace.RootElement).IsValid);
        Assert.Equal(4, module.EstimateCandidateCount(searchSpace.RootElement));

        var candidates = new List<JsonElement>();
        await foreach (var candidate in module.GenerateCandidatesAsync(searchSpace.RootElement, 42, CancellationToken.None))
        {
            candidates.Add(candidate);
        }

        Assert.Equal(4, candidates.Count);
        foreach (var candidate in candidates)
        {
            var levels = candidate.GetProperty("levels").EnumerateArray().ToArray();
            Assert.Equal(3, levels.Length);
            var previousDrawdown = 0d;
            var previousWeight = double.NegativeInfinity;
            foreach (var level in levels)
            {
                var drawdown = level.GetProperty("drawdown").GetDouble();
                var weight = level.GetProperty("weight").GetDouble();
                Assert.True(drawdown < previousDrawdown);
                Assert.True(Math.Abs(drawdown - previousDrawdown) >= 0.05 - 1e-12);
                Assert.InRange(weight, previousWeight, 0.4);
                previousDrawdown = drawdown;
                previousWeight = weight;
            }
        }
    }

    [Fact]
    public async Task Mdd_detailed_full_search_streams_valid_candidates_without_a_total_estimate()
    {
        var module = new MddMeanReversionStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "parameterMode": "detailed",
              "levelCount": 2,
              "minEntryDelta": 5,
              "maxTotalWeight": 30,
              "levels": [
                { "drawdown": { "from": 5, "to": 5, "step": 1 }, "weight": { "from": 10, "to": 10, "step": 1 } },
                { "drawdown": { "from": 10, "to": 10, "step": 1 }, "weight": { "from": 20, "to": 20, "step": 1 } }
              ],
              "takeProfit": { "from": 1, "to": 2, "step": 1 },
              "searchMode": "full",
              "maxCandidates": 1
            }
            """);

        Assert.True(module.ValidateSearchSpace(searchSpace.RootElement).IsValid);
        Assert.Null(module.EstimateCandidateCount(searchSpace.RootElement));

        var candidates = new List<JsonElement>();
        await foreach (var candidate in module.GenerateCandidatesAsync(searchSpace.RootElement, 42, CancellationToken.None))
        {
            candidates.Add(candidate);
        }

        Assert.Equal(2, candidates.Count);
        Assert.Equal(-0.05, candidates[0].GetProperty("levels")[0].GetProperty("drawdown").GetDouble(), 10);
        Assert.Equal(0.2, candidates[0].GetProperty("levels")[1].GetProperty("weight").GetDouble(), 10);
    }

    [Fact]
    public void Mdd_search_space_rejects_duplicate_drawdown_levels_when_delta_is_zero()
    {
        var module = new MddMeanReversionStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "parameterMode": "simple",
              "levelCount": 2,
              "minEntryDelta": 0,
              "maxTotalWeight": 100,
              "drawdown": { "from": 5, "to": 5, "step": 1 },
              "weight": { "from": 10, "to": 10, "step": 1 },
              "takeProfit": { "from": 0, "to": 0, "step": 1 },
              "searchMode": "random",
              "maxCandidates": 1
            }
            """);

        var validation = module.ValidateSearchSpace(searchSpace.RootElement);

        Assert.False(validation.IsValid);
        Assert.Contains(validation.Errors, error => error.Path == "drawdown");
    }

    private static void AssertClose(double expected, double actual) =>
        Assert.InRange(actual, expected - 1e-12, expected + 1e-12);

    private static void AssertSummaryEqual(StrategyRunSummary expected, StrategyRunSummary actual)
    {
        AssertClose(expected.FinalAccum, actual.FinalAccum);
        AssertClose(expected.HighWaterMark, actual.HighWaterMark);
        AssertClose(expected.MaxDrawdown, actual.MaxDrawdown);
        Assert.Equal(expected.BuyCount, actual.BuyCount);
        Assert.Equal(expected.SellCount, actual.SellCount);
    }
}
