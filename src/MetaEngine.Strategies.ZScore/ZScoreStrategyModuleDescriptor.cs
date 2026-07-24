using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.ZScore;

public sealed class ZScoreStrategyModuleDescriptor : IStrategyModuleDescriptorProvider
{
    public const string StrategyType = "z_score";

    public StrategyDescriptor Descriptor { get; } = new(
        StrategyType,
        "Z-Score",
        SchemaVersion: 1,
        IsProductionCalculationAvailable: true,
        Parameters:
        [
            new("rollingWindow", "Rolling window", StrategyParameterKind.Integer, 240, 2, 10000, 1, Unit: "periods"),
            new(
                "deals",
                "Сделки",
                StrategyParameterKind.LevelCollection,
                new StrategyLevelDefault[]
                {
                    new(-1.5, 0.10),
                    new(-2.0, 0.20),
                    new(-2.5, 0.30),
                    new(-3.0, 0.40),
                    new(-3.5, 0.50)
                },
                Unit: "z_score")
        ],
        Optimization: new(false, []),
        Outputs:
        [
            new("strategy_diff", "OUT Diff", StrategyOutputKind.ResultSeries, "decimal"),
            new("source_z", "Source Z", StrategyOutputKind.Indicator, "points"),
            new("strategy_z", "Strategy Z", StrategyOutputKind.Indicator, "points"),
            new("source_dd_mean", "IN DD rolling mean", StrategyOutputKind.Indicator, "decimal"),
            new("source_dd_std", "IN DD rolling std", StrategyOutputKind.Indicator, "decimal"),
            new("signal", "Сигнал", StrategyOutputKind.Signal),
            new("execution", "Исполнение", StrategyOutputKind.Signal),
            new("active_deals", "Активные сделки", StrategyOutputKind.Signal),
            new("position", "Вес", StrategyOutputKind.Position, "decimal"),
            new("max_config_weight", "Максимально возможный вес конфигурации", StrategyOutputKind.Indicator, "decimal"),
            new("max_realized_weight", "Максимально набранный вес в расчете", StrategyOutputKind.Indicator, "decimal")
        ],
        IsProductionOptimizationAvailable: false);
}
