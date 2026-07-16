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
    private static readonly TimeSpan RecoveryInterval = TimeSpan.FromSeconds(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextRecoveryAt = DateTimeOffset.MinValue;
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
                var optimizationProcessor = scope.ServiceProvider.GetRequiredService<IOptimizationJobProcessor>();
                if (DateTimeOffset.UtcNow >= nextRecoveryAt)
                {
                    await calculationProcessor.RecoverExpiredLeasesAsync(stoppingToken);
                    await optimizationProcessor.RecoverExpiredLeasesAsync(stoppingToken);
                    nextRecoveryAt = DateTimeOffset.UtcNow.Add(RecoveryInterval);
                }
                if (await calculationProcessor.ProcessNextAsync(stoppingToken))
                {
                    continue;
                }

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
