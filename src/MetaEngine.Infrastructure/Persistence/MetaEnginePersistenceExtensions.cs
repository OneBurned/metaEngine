using MetaEngine.Application.Security;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Presets;
using MetaEngine.Application.Calculations;
using MetaEngine.Application.Optimizations;
using MetaEngine.Application.Strategies;
using MetaEngine.Infrastructure.Calculations;
using MetaEngine.Infrastructure.Optimizations;
using MetaEngine.Infrastructure.Portfolios;
using MetaEngine.Infrastructure.Presets;
using MetaEngine.Infrastructure.Strategies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MetaEngine.Infrastructure.Persistence;

public static class MetaEnginePersistenceExtensions
{
    public static IServiceCollection AddMetaEnginePersistence(
        this IServiceCollection services,
        string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);

        services.AddDbContext<MetaEngineDbContext>(options =>
            options
                .UseNpgsql(connectionString, npgsql =>
                    npgsql.MigrationsAssembly(typeof(MetaEngineDbContext).Assembly.FullName))
                .UseSnakeCaseNamingConvention());
        services.AddScoped<IWorkspaceAccessService, WorkspaceAccessService>();
        services.AddScoped<PortfolioCsvNormalizer>();
        services.AddScoped<IPortfolioService, PortfolioService>();
        services.AddScoped<IPresetService, PresetService>();
        services.AddScoped<ISavedStrategyService, SavedStrategyService>();
        services.AddScoped<CalculationRunService>();
        services.AddScoped<ICalculationRunService>(serviceProvider =>
            serviceProvider.GetRequiredService<CalculationRunService>());
        services.AddScoped<ICalculationRunProcessor>(serviceProvider =>
            serviceProvider.GetRequiredService<CalculationRunService>());
        services.AddScoped<OptimizationJobService>();
        services.AddScoped<IOptimizationJobService>(serviceProvider =>
            serviceProvider.GetRequiredService<OptimizationJobService>());
        services.AddScoped<IOptimizationJobProcessor>(serviceProvider =>
            serviceProvider.GetRequiredService<OptimizationJobService>());

        return services;
    }
}
