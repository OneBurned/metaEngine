using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;
using MetaEngine.Strategies.ZScore;

namespace MetaEngine.ContractTests;

public sealed class StrategyCatalogTests
{
    private static StrategyModuleCatalog CreateCatalog() => new(
    [
        new RsiStrategyModuleDescriptor(),
        new MddMeanReversionStrategyModuleDescriptor(),
        new ZScoreStrategyModuleDescriptor()
    ]);

    [Fact]
    public void Catalog_exposes_registered_strategy_descriptors_in_stable_order()
    {
        var catalog = CreateCatalog();

        Assert.Equal(
            ["mdd_mean_reversion", "rsi", "z_score"],
            catalog.Descriptors.Select(descriptor => descriptor.StrategyType));
        Assert.Equal(2, catalog.GetRequired("mdd_mean_reversion").SchemaVersion);
        Assert.Equal(1, catalog.GetRequired("rsi").SchemaVersion);
        Assert.Equal(1, catalog.GetRequired("z_score").SchemaVersion);
        Assert.All(catalog.Descriptors, descriptor => Assert.NotEmpty(descriptor.Parameters));
        Assert.All(catalog.Descriptors.Where(descriptor => descriptor.StrategyType != "z_score"), descriptor => Assert.True(descriptor.Optimization.Supported));
        Assert.False(catalog.GetRequired("z_score").Optimization.Supported);
        Assert.All(catalog.Descriptors.Where(descriptor => descriptor.StrategyType != "z_score"), descriptor => Assert.NotEmpty(descriptor.Optimization.Controls));
        Assert.All(catalog.Descriptors, descriptor => Assert.NotEmpty(descriptor.Outputs));
        Assert.All(catalog.Descriptors, descriptor => Assert.True(descriptor.IsProductionCalculationAvailable));
    }

    [Fact]
    public void Catalog_rejects_duplicate_strategy_types()
    {
        Assert.Throws<InvalidOperationException>(() => new StrategyModuleCatalog(
        [
            new RsiStrategyModuleDescriptor(),
            new RsiStrategyModuleDescriptor()
        ]));
    }

    [Fact]
    public void Rsi_descriptor_uses_trade_levels_without_legacy_baseline_fields()
    {
        var descriptor = CreateCatalog().GetRequired("rsi");
        var keys = descriptor.Parameters.Select(parameter => parameter.Key).ToArray();

        Assert.Equal(["rsiPeriod", "buyLevel", "sellLevel"], keys);
        Assert.DoesNotContain("baseline", keys);
        Assert.DoesNotContain("upperLevel", keys);
        Assert.DoesNotContain("lowerLevel", keys);
    }

    [Fact]
    public void Mdd_descriptor_separates_decimal_config_from_percent_optimizer_controls()
    {
        var descriptor = CreateCatalog().GetRequired("mdd_mean_reversion");

        Assert.Equal(["deals"], descriptor.Parameters.Select(parameter => parameter.Key));
        Assert.All(descriptor.Parameters, parameter => Assert.Equal("decimal", parameter.Unit));
        Assert.Equal(
            "percent_points",
            descriptor.Optimization.Controls.Single(control => control.Key == "drawdown").Unit);
        Assert.Equal(
            "percent_points",
            descriptor.Optimization.Controls.Single(control => control.Key == "weight").Unit);
        Assert.Equal(
            "percent_points",
            descriptor.Optimization.Controls.Single(control => control.Key == "exitValue").Unit);
        Assert.DoesNotContain(descriptor.Optimization.Controls, control => control.Key == "takeProfit");
    }


    [Fact]
    public void ZScore_descriptor_uses_rolling_window_and_deals_without_optimizer()
    {
        var descriptor = CreateCatalog().GetRequired("z_score");

        Assert.Equal("Z-Score", descriptor.DisplayName);
        Assert.Equal(["rollingWindow", "deals"], descriptor.Parameters.Select(parameter => parameter.Key));
        Assert.False(descriptor.IsProductionOptimizationAvailable);
        Assert.False(descriptor.Optimization.Supported);
        Assert.Contains(descriptor.Outputs, output => output.Key == "source_z");
        Assert.Contains(descriptor.Outputs, output => output.Key == "strategy_z");
    }
}
