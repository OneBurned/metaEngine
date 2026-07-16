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
        Optimization: new(
            Supported: true,
            Controls:
            [
                new("levelCount", "Количество входов", StrategyParameterKind.Integer, 5, 1, 10, 1, Unit: "count"),
                new("minEntryDelta", "Мин. дельта входов", StrategyParameterKind.Decimal, 5d, 0, null, 1, Unit: "percent_points"),
                new("maxTotalWeight", "Макс. общий вес", StrategyParameterKind.Decimal, 100d, 1, null, 1, Unit: "percent_points"),
                new("drawdown", "Вход DD", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(5, 50, 5), 0, 100, Unit: "percent_points"),
                new("weight", "Вес входа", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(10, 100, 10), 0, null, Unit: "percent_points"),
                new("exitMetric", "TP считается по", StrategyParameterKind.Choice, "source_dd", Choices: ["source_dd", "strategy_dd", "source_hwm", "strategy_hwm"]),
                new("takeProfit", "Цель TP", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(0, 20, 1), 0, 100, Unit: "percent_points"),
                new("searchMode", "Режим поиска", StrategyParameterKind.Choice, "random", Choices: ["random", "full"]),
                new("maxCandidates", "Кандидатов", StrategyParameterKind.Integer, 100000, 1, null, 1, Unit: "count")
            ]),
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
        ],
        IsProductionOptimizationAvailable: true);
}
