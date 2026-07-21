using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.MddMeanReversion;

public sealed class MddMeanReversionStrategyModuleDescriptor : IStrategyModuleDescriptorProvider
{
    public const string StrategyType = "mdd_mean_reversion";

    public StrategyDescriptor Descriptor { get; } = new(
        StrategyType,
        "MDD Mean Reversion",
        SchemaVersion: 2,
        IsProductionCalculationAvailable: true,
        Parameters:
        [
            new(
                "deals",
                "Сделки",
                StrategyParameterKind.LevelCollection,
                new StrategyLevelDefault[]
                {
                    new(-0.10, 0.10),
                    new(-0.20, 0.20),
                    new(-0.30, 0.30),
                    new(-0.40, 0.40),
                    new(-0.50, 0.50)
                },
                Unit: "decimal")
        ],
        Optimization: new(
            Supported: true,
            Controls:
            [
                new("parameterMode", "Режим параметров", StrategyParameterKind.Choice, "simple", Choices: ["simple", "detailed"]),
                new("levelCount", "Количество сделок", StrategyParameterKind.Integer, 5, 1, 10, 1),
                new("minEntryDelta", "Мин. дельта входов", StrategyParameterKind.Decimal, 5, 0, null, 1, Unit: "percent_points"),
                new("drawdown", "Вход Local DD исходника", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(0, 80, 1), 0, 100, Unit: "percent_points"),
                new("weight", "Вес открытия", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(1, 100, 1), 0, null, Unit: "percent_points"),
                new("exitValue", "Выход DD исходника", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(0, 0, 1), 0, null, Unit: "percent_points"),
                new("searchMode", "Режим поиска", StrategyParameterKind.Choice, "random", Choices: ["random", "full"]),
                new("maxCandidates", "Кандидатов", StrategyParameterKind.Integer, 100000, 1, null, 1),
                new("seed", "Seed", StrategyParameterKind.Integer, 42, 0, null, 1)
            ]),
        Outputs:
        [
            new("strategy_diff", "OUT Diff", StrategyOutputKind.ResultSeries, "decimal"),
            new("base_dd", "IN DD", StrategyOutputKind.Indicator, "decimal"),
            new("local_mdd", "Local DD исходника", StrategyOutputKind.Indicator, "decimal"),
            new("signal", "Сигнал", StrategyOutputKind.Signal),
            new("execution", "Исполнение", StrategyOutputKind.Signal),
            new("active_deals", "Активные сделки", StrategyOutputKind.Signal),
            new("position", "Вес", StrategyOutputKind.Position, "decimal"),
            new("max_config_weight", "Максимально возможный вес конфигурации", StrategyOutputKind.Indicator, "decimal"),
            new("max_realized_weight", "Максимально набранный вес в расчете", StrategyOutputKind.Indicator, "decimal")
        ],
        IsProductionOptimizationAvailable: true);
}
