using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Infrastructure.Persistence;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("MetaEngine")
    ?? throw new InvalidOperationException("Connection string 'MetaEngine' is required.");

builder.Services.AddMetaEnginePersistence(connectionString);
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, RsiStrategyModuleDescriptor>();
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, MddMeanReversionStrategyModuleDescriptor>();
builder.Services.AddSingleton<StrategyModuleCatalog>();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

var app = builder.Build();

app.MapGet("/", () => Results.Ok(new
{
    service = "MetaEngine.Api",
    status = "platform scaffold",
    apiVersion = "v1"
}));

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));
app.MapGet("/health/ready", async (
    MetaEngineDbContext dbContext,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    try
    {
        if (!await dbContext.Database.CanConnectAsync(cancellationToken))
        {
            return Results.Json(
                new { status = "not_ready", dependencies = new { postgresql = "unavailable" } },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var pendingMigrations = (await dbContext.Database.GetPendingMigrationsAsync(cancellationToken)).ToArray();
        if (pendingMigrations.Length > 0)
        {
            return Results.Json(
                new
                {
                    status = "not_ready",
                    dependencies = new { postgresql = "ready", migrations = "pending" },
                    pendingMigrationCount = pendingMigrations.Length
                },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new
        {
            status = "ready",
            dependencies = new { postgresql = "ready", migrations = "current" }
        });
    }
    catch (Exception exception)
    {
        loggerFactory
            .CreateLogger("MetaEngine.DatabaseReadiness")
            .LogError(exception, "PostgreSQL readiness check failed.");

        return Results.Json(
            new { status = "not_ready", dependencies = new { postgresql = "unavailable" } },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapGet("/api/v1/strategy-types", (StrategyModuleCatalog catalog) =>
    Results.Ok(new { items = catalog.Descriptors }));

app.Run();
