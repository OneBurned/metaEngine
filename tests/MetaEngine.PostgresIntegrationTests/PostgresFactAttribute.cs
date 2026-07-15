namespace MetaEngine.PostgresIntegrationTests;

[AttributeUsage(AttributeTargets.Method)]
public sealed class PostgresFactAttribute : FactAttribute
{
    public const string ConnectionStringEnvironmentVariable = "METAENGINE_TEST_POSTGRES";

    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(
            Environment.GetEnvironmentVariable(ConnectionStringEnvironmentVariable)))
        {
            Skip = $"Set {ConnectionStringEnvironmentVariable} to run PostgreSQL integration tests.";
        }
    }
}
