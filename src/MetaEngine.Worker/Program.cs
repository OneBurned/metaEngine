using MetaEngine.Worker;
using MetaEngine.Infrastructure.Persistence;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;

var builder = Host.CreateApplicationBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("MetaEngine")
    ?? throw new InvalidOperationException("Connection string 'MetaEngine' is required.");

builder.Services.AddMetaEnginePersistence(connectionString);
builder.Services.AddSingleton<RsiStrategyModule>();
builder.Services.AddSingleton<MddMeanReversionStrategyModule>();
builder.Services.AddSingleton<IStrategyModule>(serviceProvider => serviceProvider.GetRequiredService<RsiStrategyModule>());
builder.Services.AddSingleton<IStrategyModule>(serviceProvider => serviceProvider.GetRequiredService<MddMeanReversionStrategyModule>());
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider>(serviceProvider => serviceProvider.GetRequiredService<RsiStrategyModule>());
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider>(serviceProvider => serviceProvider.GetRequiredService<MddMeanReversionStrategyModule>());
builder.Services.AddSingleton<StrategyModuleCatalog>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
