using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, RsiStrategyModuleDescriptor>();
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, MddMeanReversionStrategyModuleDescriptor>();
builder.Services.AddSingleton<StrategyModuleCatalog>();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

var app = builder.Build();

app.MapGet("/", () => Results.Ok(new
{
    service = "MetaEngine.Api",
    status = "production scaffold",
    apiVersion = "v1"
}));

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));
app.MapGet("/health/ready", () => Results.Ok(new { status = "ready", dependencies = Array.Empty<string>() }));

app.MapGet("/api/v1/strategy-types", (StrategyModuleCatalog catalog) =>
    Results.Ok(new { items = catalog.Descriptors }));

app.Run();
