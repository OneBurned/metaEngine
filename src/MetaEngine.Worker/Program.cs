using MetaEngine.Worker;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, RsiStrategyModuleDescriptor>();
builder.Services.AddSingleton<IStrategyModuleDescriptorProvider, MddMeanReversionStrategyModuleDescriptor>();
builder.Services.AddSingleton<StrategyModuleCatalog>();
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
