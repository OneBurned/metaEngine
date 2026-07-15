using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Strategies.Rsi;

public sealed class RsiStrategyModuleDescriptor : IStrategyModuleDescriptorProvider
{
    public const string StrategyType = "rsi";

    public StrategyDescriptor Descriptor { get; } = new(
        StrategyType,
        "RSI",
        SchemaVersion: 1,
        IsProductionCalculationAvailable: false,
        Parameters:
        [
            new("rsiPeriod", "RSI период", StrategyParameterKind.Integer, 14, 1, 1000, 1, Unit: "periods"),
            new("buyLevel", "Купить на", StrategyParameterKind.Decimal, 30, 0, 100, 1, Unit: "rsi_points"),
            new("sellLevel", "Продать на", StrategyParameterKind.Decimal, 70, 0, 100, 1, Unit: "rsi_points")
        ],
        Optimization: new(
            Supported: true,
            Controls:
            [
                new("rsiPeriod", "RSI период", StrategyParameterKind.IntegerRange, new StrategyNumericRangeDefault(5, 30, 1), 1, 1000, Unit: "periods"),
                new("buyLevel", "Купить", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(20, 45, 5), 0, 100, Unit: "rsi_points"),
                new("sellLevel", "Продать", StrategyParameterKind.DecimalRange, new StrategyNumericRangeDefault(55, 80, 5), 0, 100, Unit: "rsi_points")
            ]),
        Outputs:
        [
            new("strategy_diff", "OUT Diff", StrategyOutputKind.ResultSeries, "decimal"),
            new("rsi", "RSI", StrategyOutputKind.Indicator, "points"),
            new("signal", "Сигнал", StrategyOutputKind.Signal),
            new("execution", "Исполнение", StrategyOutputKind.Signal),
            new("position", "Вес", StrategyOutputKind.Position, "decimal")
        ]);
}
