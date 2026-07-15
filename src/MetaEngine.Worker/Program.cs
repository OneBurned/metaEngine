using MetaEngine.Worker;
using MetaEngine.Infrastructure.Persistence;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;

var builder = Host.CreateApplicationBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("MetaEngine")
    ?? throw new InvalidOperationException("Connection string 'MetaEngine' is required.");

builder.Services.AddMetaEnginePersistence(connectionString);
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, RsiStrategyModuleDescriptor>();
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, MddMeanReversionStrategyModuleDescriptor>();
builder.Services.AddSingleton<StrategyModuleCatalog>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
