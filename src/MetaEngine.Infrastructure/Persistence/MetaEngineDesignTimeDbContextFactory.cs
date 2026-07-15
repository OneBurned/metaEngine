using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace MetaEngine.Infrastructure.Persistence;

public sealed class MetaEngineDesignTimeDbContextFactory : IDesignTimeDbContextFactory<MetaEngineDbContext>
{
    private const string LocalDevelopmentConnection =
        "Host=localhost;Port=5432;Database=metaengine;Username=metaengine;Password=metaengine_dev";

    public MetaEngineDbContext CreateDbContext(string[] args)
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__MetaEngine")
            ?? LocalDevelopmentConnection;

        var options = new DbContextOptionsBuilder<MetaEngineDbContext>()
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention()
            .Options;

        return new MetaEngineDbContext(options);
    }
}
