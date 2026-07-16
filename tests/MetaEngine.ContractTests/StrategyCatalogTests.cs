using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddGrid;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;

namespace MetaEngine.ContractTests;

public sealed class StrategyCatalogTests
{
    private static StrategyModuleCatalog CreateCatalog() => new(
    [
        new RsiStrategyModuleDescriptor(),
        new MddGridStrategyModuleDescriptor(),
        new MddMeanReversionStrategyModuleDescriptor()
    ]);

    [Fact]
    public void Catalog_exposes_registered_strategy_descriptors_in_stable_order()
    {
        var catalog = CreateCatalog();

        Assert.Equal(
            ["mdd_grid", "mdd_mean_reversion", "rsi"],
            catalog.Descriptors.Select(descriptor => descriptor.StrategyType));
        Assert.All(catalog.Descriptors, descriptor => Assert.Equal(1, descriptor.SchemaVersion));
        Assert.All(catalog.Descriptors, descriptor => Assert.NotEmpty(descriptor.Parameters));
        Assert.All(catalog.Descriptors, descriptor => Assert.NotEmpty(descriptor.Outputs));
        Assert.All(catalog.Descriptors, descriptor => Assert.True(descriptor.IsProductionCalculationAvailable));
        Assert.All(catalog.Descriptors.Where(descriptor => descriptor.StrategyType != "mdd_grid"), descriptor =>
        {
            Assert.True(descriptor.Optimization.Supported);
            Assert.NotEmpty(descriptor.Optimization.Controls);
        });
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

        Assert.All(descriptor.Parameters, parameter => Assert.Equal("decimal", parameter.Unit));
        Assert.Equal(
            "percent_points",
            descriptor.Optimization.Controls.Single(control => control.Key == "takeProfit").Unit);
    }

    [Fact]
    public void Mdd_grid_descriptor_exposes_independent_lot_configuration_without_an_optimizer()
    {
        var descriptor = CreateCatalog().GetRequired("mdd_grid");

        Assert.False(descriptor.Optimization.Supported);
        Assert.Empty(descriptor.Optimization.Controls);
        Assert.Contains(descriptor.Parameters, parameter => parameter.Key == "maxTotalWeight");
        Assert.Contains(descriptor.Outputs, output => output.Key == "strategy_hwm");
    }
}
