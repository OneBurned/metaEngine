using System.Text.Json;

namespace MetaEngine.Strategies.Abstractions;

public enum StrategyParameterKind
{
    Integer,
    Decimal,
    Choice,
    LevelCollection,
    IntegerRange,
    DecimalRange
}

public enum StrategyOutputKind
{
    ResultSeries,
    Indicator,
    Signal,
    Position
}

public sealed record StrategyLevelDefault(double Drawdown, double Weight);

public sealed record StrategyNumericRangeDefault(double From, double To, double Step);

public sealed record StrategyParameterDescriptor(
    string Key,
    string DisplayName,
    StrategyParameterKind Kind,
    object? DefaultValue = null,
    double? Minimum = null,
    double? Maximum = null,
    double? Step = null,
    bool Optimizable = true,
    IReadOnlyList<string>? Choices = null,
    string? Unit = null);

public sealed record StrategyOutputDescriptor(
    string Key,
    string DisplayName,
    StrategyOutputKind Kind,
    string? Unit = null);

public sealed record StrategyOptimizationDescriptor(
    bool Supported,
    IReadOnlyList<StrategyParameterDescriptor> Controls);

public sealed record StrategyDescriptor(
    string StrategyType,
    string DisplayName,
    int SchemaVersion,
    bool IsProductionCalculationAvailable,
    IReadOnlyList<StrategyParameterDescriptor> Parameters,
    StrategyOptimizationDescriptor Optimization,
    IReadOnlyList<StrategyOutputDescriptor> Outputs);

public interface IStrategyModuleDescriptorProvider
{
    StrategyDescriptor Descriptor { get; }
}

public sealed record StrategySourcePoint(long Timestamp, double Diff);

public interface IStrategyPreparedData;

public sealed record StrategyValidationError(string Path, string Message);

public sealed record StrategyValidationResult(IReadOnlyList<StrategyValidationError> Errors)
{
    public bool IsValid => Errors.Count == 0;

    public static StrategyValidationResult Valid { get; } = new([]);
}

public sealed class StrategyParameterException(IReadOnlyList<StrategyValidationError> errors)
    : Exception("Strategy parameters are invalid.")
{
    public IReadOnlyList<StrategyValidationError> Errors { get; } = errors;
}

public sealed record StrategyResultPoint(
    long Timestamp,
    double Diff,
    IReadOnlyDictionary<string, JsonElement> Fields);

public sealed record StrategyRunSummary(
    double FinalAccum,
    double HighWaterMark,
    double MaxDrawdown,
    int BuyCount,
    int SellCount);

public sealed record StrategyCalculationResult(
    IReadOnlyList<StrategyResultPoint> Rows,
    StrategyRunSummary Summary);

public interface IStrategyModule : IStrategyModuleDescriptorProvider
{
    StrategyValidationResult ValidateParameters(JsonElement parameters);

    ValueTask<IStrategyPreparedData> PrepareAsync(
        IReadOnlyList<StrategySourcePoint> source,
        CancellationToken cancellationToken);

    IAsyncEnumerable<JsonElement> GenerateCandidatesAsync(
        JsonElement searchSpace,
        int seed,
        CancellationToken cancellationToken);

    ValueTask<StrategyCalculationResult> CalculateAsync(
        IStrategyPreparedData preparedData,
        JsonElement parameters,
        CancellationToken cancellationToken);
}
