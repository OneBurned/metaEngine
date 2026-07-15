using MetaEngine.Application.Security;
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

        return services;
    }
}
