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

    private static void AssertClose(double expected, double actual) =>
        Assert.InRange(actual, expected - 1e-12, expected + 1e-12);
}
