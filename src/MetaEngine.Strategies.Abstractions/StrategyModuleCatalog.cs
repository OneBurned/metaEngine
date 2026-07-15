namespace MetaEngine.Strategies.Abstractions;

public sealed class StrategyModuleCatalog
{
    public StrategyModuleCatalog(IEnumerable<IStrategyModuleDescriptorProvider> providers)
    {
        var descriptors = providers
            .Select(provider => provider.Descriptor)
            .OrderBy(descriptor => descriptor.StrategyType, StringComparer.Ordinal)
            .ToArray();

        var duplicate = descriptors
            .GroupBy(descriptor => descriptor.StrategyType, StringComparer.Ordinal)
            .FirstOrDefault(group => group.Count() > 1);

        if (duplicate is not null)
        {
            throw new InvalidOperationException($"Strategy type '{duplicate.Key}' is registered more than once.");
        }

        Descriptors = Array.AsReadOnly(descriptors);
    }

    public IReadOnlyList<StrategyDescriptor> Descriptors { get; }

    public StrategyDescriptor GetRequired(string strategyType) =>
        Descriptors.FirstOrDefault(descriptor =>
            string.Equals(descriptor.StrategyType, strategyType, StringComparison.Ordinal))
        ?? throw new KeyNotFoundException($"Strategy type '{strategyType}' is not registered.");
}
