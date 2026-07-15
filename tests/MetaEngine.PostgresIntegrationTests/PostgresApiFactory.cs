using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace MetaEngine.PostgresIntegrationTests;

public sealed class PostgresApiFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvironmentKey = "ConnectionStrings__MetaEngine";
    private readonly string connectionString;
    private readonly string? previousConnectionString;

    public PostgresApiFactory(string connectionString)
    {
        this.connectionString = connectionString;
        previousConnectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentKey);
        Environment.SetEnvironmentVariable(ConnectionStringEnvironmentKey, connectionString);
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration(configuration =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:MetaEngine"] = connectionString
            }));
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvironmentKey, previousConnectionString);
    }
}
