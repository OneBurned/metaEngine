using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.MddGrid;

public sealed record MddGridLevelDefault(
    double Drawdown,
    double Weight,
    string ExitMetric,
    double TakeProfit);

public sealed class MddGridStrategyModuleDescriptor : IStrategyModuleDescriptorProvider
{
    public const string StrategyType = "mdd_grid";

    public StrategyDescriptor Descriptor { get; } = new(
        StrategyType,
        "MDDGrid",
        SchemaVersion: 1,
        IsProductionCalculationAvailable: true,
        Parameters:
        [
            new(
                "levels",
                "Уровни входа и выхода",
                StrategyParameterKind.LevelCollection,
                new MddGridLevelDefault[]
                {
                    new(-0.10, 0.10, "source_dd", 0.05),
                    new(-0.20, 0.20, "source_dd", 0.05),
                    new(-0.30, 0.30, "source_dd", 0.05),
                    new(-0.40, 0.40, "source_dd", 0.05),
                    new(-0.50, 0.50, "source_dd", 0.05)
                },
                Unit: "decimal"),
            new(
                "maxTotalWeight",
                "Макс. общий вес",
                StrategyParameterKind.Decimal,
                1d,
                0,
                null,
                0.01,
                Unit: "decimal")
        ],
        Optimization: new(Supported: false, Controls: []),
        Outputs:
        [
            new("strategy_diff", "OUT Diff", StrategyOutputKind.ResultSeries, "decimal"),
            new("source_dd", "IN DD", StrategyOutputKind.Indicator, "decimal"),
            new("source_hwm", "IN HWM", StrategyOutputKind.Indicator, "decimal"),
            new("strategy_dd", "OUT DD", StrategyOutputKind.Indicator, "decimal"),
            new("strategy_hwm", "OUT HWM", StrategyOutputKind.Indicator, "decimal"),
            new("signal", "Сигнал", StrategyOutputKind.Signal),
            new("execution", "Исполнение", StrategyOutputKind.Signal),
            new("position", "Вес", StrategyOutputKind.Position, "decimal")
        ]);
}
