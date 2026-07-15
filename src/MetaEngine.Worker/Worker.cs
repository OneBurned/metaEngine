using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Worker;

public sealed class Worker(
    ILogger<Worker> logger,
    StrategyModuleCatalog strategyCatalog) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "MetaEngine Worker started with {StrategyCount} registered strategy descriptors: {StrategyTypes}",
            strategyCatalog.Descriptors.Count,
            string.Join(", ", strategyCatalog.Descriptors.Select(descriptor => descriptor.StrategyType)));

        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("MetaEngine Worker is stopping.");
        }
    }
}
