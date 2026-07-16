using MetaEngine.Application.Calculations;
using MetaEngine.Application.Optimizations;
using MetaEngine.Strategies.Abstractions;

namespace MetaEngine.Worker;

public sealed class Worker(
    ILogger<Worker> logger,
    StrategyModuleCatalog strategyCatalog,
    IServiceScopeFactory serviceScopeFactory) : BackgroundService
{
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation(
            "MetaEngine Worker started with {StrategyCount} registered strategy descriptors: {StrategyTypes}",
            strategyCatalog.Descriptors.Count,
            string.Join(", ", strategyCatalog.Descriptors.Select(descriptor => descriptor.StrategyType)));

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = serviceScopeFactory.CreateAsyncScope();
                var calculationProcessor = scope.ServiceProvider.GetRequiredService<ICalculationRunProcessor>();
                if (await calculationProcessor.ProcessNextAsync(stoppingToken))
                {
                    continue;
                }

                var optimizationProcessor = scope.ServiceProvider.GetRequiredService<IOptimizationJobProcessor>();
                if (await optimizationProcessor.ProcessNextAsync(stoppingToken))
                {
                    continue;
                }

                await Task.Delay(IdleDelay, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Worker loop failed; retrying after delay.");
                await Task.Delay(IdleDelay, stoppingToken);
            }
        }

        logger.LogInformation("MetaEngine Worker is stopping.");
    }
}
