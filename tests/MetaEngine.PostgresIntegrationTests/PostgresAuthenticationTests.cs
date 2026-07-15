using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Data.Common;
using MetaEngine.Api.Contracts;
using MetaEngine.Application.Portfolios;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MetaEngine.PostgresIntegrationTests;

public sealed class PostgresAuthenticationTests
{
    private const string OwnerEmail = "integration-owner@metaengine.test";
    private const string OwnerPassword = "IntegrationOwner123!";
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

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

        var workspaceId = workspace.GetProperty("id").GetGuid();
        var import = await ImportPortfolioAsync(client, workspaceId);
        var duplicate = await ImportPortfolioAsync(client, workspaceId);
        var list = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/workspaces/{workspaceId}/portfolios");
        var page = await client.GetFromJsonAsync<PortfolioPointPage>(
            $"/api/v1/workspaces/{workspaceId}/portfolios/{import.Portfolio.Id}/points?limit=2");

        Assert.True(import.Created);
        Assert.False(duplicate.Created);
        Assert.Equal(import.Portfolio.Id, duplicate.Portfolio.Id);
        Assert.Contains(
            list.GetProperty("items").EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == import.Portfolio.Id);
        Assert.NotNull(page);
        Assert.Equal(3, page.Total);
        Assert.Equal(2, page.Items.Count);

        await using var auditScope = factory.Services.CreateAsyncScope();
        var auditDbContext = auditScope.ServiceProvider.GetRequiredService<MetaEngineDbContext>();
        Assert.Equal(
            1,
            await auditDbContext.AuditEvents.CountAsync(
                auditEvent => auditEvent.Action == "portfolio_imported" &&
                              auditEvent.EntityId == import.Portfolio.Id));
    }

    private static async Task<PortfolioImportResult> ImportPortfolioAsync(HttpClient client, Guid workspaceId)
    {
        const string csv =
            "timestamp,diff\n" +
            "1704499200000,0.01\n" +
            "1704502800000,-0.02\n" +
            "1704506400000,0.03\n";
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Integration portfolio"), "name");
        form.Add(new StringContent(csv), "file", "integration.csv");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/portfolios/import")
        {
            Content = form
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.True(
            response.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK,
            await response.Content.ReadAsStringAsync());

        var result = await response.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
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

        await dbContext.AuditEvents
            .Where(auditEvent => auditEvent.Action == "portfolio_imported")
            .ExecuteDeleteAsync();
        await dbContext.Portfolios.ExecuteDeleteAsync();
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
