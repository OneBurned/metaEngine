using System.Text.Json;
using MetaEngine.Strategies.Abstractions;
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
    public async Task Mdd_gap_opens_all_crossed_independent_deals_with_additive_weight()
    {
        var module = new MddMeanReversionStrategyModule();
        var source = new[]
        {
            new StrategySourcePoint(1, 0),
            new StrategySourcePoint(2, -0.35),
            new StrategySourcePoint(3, 0)
        };
        using var parameters = JsonDocument.Parse("""
            {"deals":[
              {"entryDrawdown":-0.1,"weight":0.1,"exitType":"source_dd","exitValue":0},
              {"entryDrawdown":-0.2,"weight":0.2,"exitType":"source_dd","exitValue":0},
              {"entryDrawdown":-0.3,"weight":0.3,"exitType":"source_dd","exitValue":0}
            ]}
            """);

        var prepared = await module.PrepareAsync(source, CancellationToken.None);
        var result = await module.CalculateAsync(prepared, parameters.RootElement, CancellationToken.None);

        Assert.Equal(0, result.Rows[1].Fields["position"].GetDouble());
        Assert.Equal(0.6, result.Rows[2].Fields["position"].GetDouble(), 10);
        Assert.Equal(3, result.Summary.BuyCount);
        Assert.Contains("сделка 1", result.Rows[1].Fields["signal"].GetString());
        Assert.Contains("сделка 3", result.Rows[1].Fields["signal"].GetString());
    }

    [Fact]
    public void Mdd_allows_decreasing_weights_and_leverage_sum()
    {
        var module = new MddMeanReversionStrategyModule();
        using var parameters = JsonDocument.Parse("""
            {"deals":[
              {"entryDrawdown":-0.1,"weight":0.5,"exitType":"source_dd","exitValue":0},
              {"entryDrawdown":-0.2,"weight":0.1,"exitType":"source_dd","exitValue":0},
              {"entryDrawdown":-0.3,"weight":1.0,"exitType":"source_dd","exitValue":0}
            ]}
            """);

        Assert.True(module.ValidateParameters(parameters.RootElement).IsValid);
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
    public async Task Mdd_generates_random_candidates_with_ordered_deals_and_additive_weights()
    {
        var module = new MddMeanReversionStrategyModule();
        using var searchSpace = JsonDocument.Parse("""
            {
              "parameterMode": "simple",
              "levelCount": 3,
              "minEntryDelta": 5,
              "drawdown": { "from": 5, "to": 25, "step": 5 },
              "weight": { "from": 10, "to": 50, "step": 10 },
              "exitValue": { "from": 0, "to": 0, "step": 1 },
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
            var deals = candidate.GetProperty("deals").EnumerateArray().ToArray();
            Assert.Equal(3, deals.Length);
            var previousDrawdown = 0d;
            foreach (var deal in deals)
            {
                var drawdown = deal.GetProperty("entryDrawdown").GetDouble();
                var weight = deal.GetProperty("weight").GetDouble();
                Assert.True(drawdown < previousDrawdown);
                Assert.True(Math.Abs(drawdown - previousDrawdown) >= 0.05 - 1e-12);
                Assert.InRange(weight, 0.1, 0.5);
                Assert.Equal("source_dd", deal.GetProperty("exitType").GetString());
                previousDrawdown = drawdown;
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
              "levels": [
                { "drawdown": { "from": 5, "to": 5, "step": 1 }, "weight": { "from": 10, "to": 10, "step": 1 } },
                { "drawdown": { "from": 10, "to": 10, "step": 1 }, "weight": { "from": 20, "to": 20, "step": 1 } }
              ],
              "exitValue": { "from": 0, "to": 0, "step": 1 },
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

        Assert.Single(candidates);
        Assert.Equal(-0.05, candidates[0].GetProperty("deals")[0].GetProperty("entryDrawdown").GetDouble(), 10);
        Assert.Equal(0.2, candidates[0].GetProperty("deals")[1].GetProperty("weight").GetDouble(), 10);
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
              "drawdown": { "from": 5, "to": 5, "step": 1 },
              "weight": { "from": 10, "to": 10, "step": 1 },
              "exitValue": { "from": 0, "to": 0, "step": 1 },
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
