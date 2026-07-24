namespace MetaEngine.Api.Security;

public sealed class DevAuthOptions
{
    public const string SectionName = "MetaEngine:DevAuth";

    public bool Enabled { get; init; }

    public string Login { get; init; } = "admin";

    public string Password { get; init; } = "admin";

    public string Email { get; init; } = "admin@metaengine.local";

    public string DisplayName { get; init; } = "Local Admin";

    public string WorkspaceName { get; init; } = "Personal";
}
