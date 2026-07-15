using MetaEngine.Application.Security;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Presets;
using MetaEngine.Infrastructure.Portfolios;
using MetaEngine.Infrastructure.Presets;
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

        return services;
    }
}
