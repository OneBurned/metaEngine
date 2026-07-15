using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Data.Common;
using MetaEngine.Api.Contracts;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MetaEngine.PostgresIntegrationTests;

public sealed class PostgresAuthenticationTests
{
    private const string OwnerEmail = "integration-owner@metaengine.test";
    private const string OwnerPassword = "IntegrationOwner123!";

    [PostgresFact]
    public async Task Migrations_bootstrap_and_cookie_auth_work_on_postgresql()
    {
        var connectionString = Environment.GetEnvironmentVariable(
            PostgresFactAttribute.ConnectionStringEnvironmentVariable);
        Assert.False(string.IsNullOrWhiteSpace(connectionString));
        EnsureDedicatedTestDatabase(connectionString);

        using var factory = new PostgresApiFactory(connectionString);
        await ApplyMigrationsAndBootstrapAsync(factory);

        using var client = factory.CreateClient();
        var readiness = await client.GetAsync("/health/ready");
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");

        Assert.Equal(HttpStatusCode.OK, readiness.StatusCode);
        Assert.NotNull(csrf);

        using var loginRequest = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(OwnerEmail, OwnerPassword))
        };
        loginRequest.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var login = await client.SendAsync(loginRequest);
        var workspaces = await client.GetFromJsonAsync<JsonElement>("/api/v1/workspaces/");

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var workspace = Assert.Single(workspaces.GetProperty("items").EnumerateArray());
        Assert.Equal("admin", workspace.GetProperty("role").GetString());
        Assert.True(workspace.GetProperty("canWrite").GetBoolean());
        Assert.True(workspace.GetProperty("canAdminister").GetBoolean());
    }

    private static async Task ApplyMigrationsAndBootstrapAsync(PostgresApiFactory factory)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MetaEngineDbContext>();
        await dbContext.Database.MigrateAsync();
        Assert.Empty(await dbContext.Database.GetPendingMigrationsAsync());

        var bootstrapper = scope.ServiceProvider.GetRequiredService<AdminBootstrapper>();
        var first = await bootstrapper.BootstrapAsync(
            new AdminBootstrapRequest(
                OwnerEmail,
                OwnerPassword,
                "Integration Owner",
                "Integration Workspace"),
            CancellationToken.None);
        var second = await bootstrapper.BootstrapAsync(
            new AdminBootstrapRequest(
                OwnerEmail,
                OwnerPassword,
                "Integration Owner",
                "Integration Workspace"),
            CancellationToken.None);

        Assert.Equal(first.UserId, second.UserId);
        Assert.Equal(first.WorkspaceId, second.WorkspaceId);
        Assert.False(second.Created);
    }

    private static void EnsureDedicatedTestDatabase(string connectionString)
    {
        var builder = new DbConnectionStringBuilder { ConnectionString = connectionString };
        if (!builder.TryGetValue("Database", out var databaseValue))
        {
            throw new InvalidOperationException("PostgreSQL integration connection string requires Database.");
        }

        var database = Convert.ToString(databaseValue);
        if (database is null ||
            (!database.EndsWith("_test", StringComparison.OrdinalIgnoreCase) &&
             !database.EndsWith("_ci", StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException(
                "PostgreSQL integration tests require a dedicated database ending in '_test' or '_ci'.");
        }
    }
}
