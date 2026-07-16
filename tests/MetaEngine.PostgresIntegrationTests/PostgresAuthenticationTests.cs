using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Data.Common;
using MetaEngine.Api.Contracts;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Presets;
using MetaEngine.Application.Calculations;
using MetaEngine.Application.Strategies;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace MetaEngine.PostgresIntegrationTests;

public sealed class PostgresAuthenticationTests
{
    private const string OwnerEmail = "integration-owner@metaengine.test";
    private const string OwnerPassword = "IntegrationOwner123!";
    private const int LongStrategySourcePointCount = 4_000;
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
        var preset = await CreatePresetAsync(client, workspaceId, import.Portfolio.Id);
        var presets = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/workspaces/{workspaceId}/presets");
        var foundPreset = await client.GetFromJsonAsync<PresetDetails>(
            $"/api/v1/workspaces/{workspaceId}/presets/{preset.Preset.Id}",
            JsonOptions);
        var calculation = await QueueCalculationAsync(
            client,
            workspaceId,
            null,
            preset.Preset.Id,
            DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L),
            DateTimeOffset.FromUnixTimeMilliseconds(1_704_506_400_000L));
        await ProcessOneCalculationAsync(factory);
        var calculationDetails = await client.GetFromJsonAsync<CalculationRunDetails>(
            $"/api/v1/workspaces/{workspaceId}/calculation-runs/{calculation.Id}",
            JsonOptions);
        var calculationResult = await client.GetFromJsonAsync<CalculationResultPage>(
            $"/api/v1/workspaces/{workspaceId}/calculation-runs/{calculation.Id}/result?limit=2",
            JsonOptions);

        Assert.True(import.Created);
        Assert.False(duplicate.Created);
        Assert.Equal(import.Portfolio.Id, duplicate.Portfolio.Id);
        Assert.Contains(
            list.GetProperty("items").EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == import.Portfolio.Id);
        Assert.NotNull(page);
        Assert.Equal(3, page.Total);
        Assert.Equal(2, page.Items.Count);
        Assert.Equal(1, preset.Preset.Version);
        Assert.Single(preset.Items);
        Assert.Equal(PresetItemSourceType.Portfolio, preset.Items[0].SourceType);
        Assert.Equal(import.Portfolio.Id, preset.Items[0].SourceId);
        Assert.Contains(
            presets.GetProperty("items").EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == preset.Preset.Id);
        Assert.NotNull(foundPreset);
        Assert.Equal(preset.Preset.Id, foundPreset.Preset.Id);
        Assert.NotNull(calculationDetails);
        Assert.Equal(JobStatus.Completed, calculationDetails.Run.Status);
        Assert.NotNull(calculationDetails.Artifact);
        Assert.NotNull(calculationResult);
        Assert.Equal(3, calculationResult.Total);
        Assert.Equal(2, calculationResult.Items.Count);

        var longSource = await ImportPortfolioAsync(
            client,
            workspaceId,
            "Long strategy source",
            CreateHourlyCsv(LongStrategySourcePointCount));
        var longPeriodStart = DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L);
        var longBaseRun = await QueueCalculationAsync(
            client,
            workspaceId,
            longSource.Portfolio.Id,
            null,
            longPeriodStart,
            longPeriodStart.AddHours(LongStrategySourcePointCount - 1));
        await ProcessOneCalculationAsync(factory);

        var longStrategyRun = await QueueStrategyCalculationAsync(
            client,
            workspaceId,
            longBaseRun.Id);
        await ProcessOneCalculationAsync(factory);
        var longStrategyDetails = await client.GetFromJsonAsync<CalculationRunDetails>(
            $"/api/v1/workspaces/{workspaceId}/calculation-runs/{longStrategyRun.Id}",
            JsonOptions);

        Assert.NotNull(longStrategyDetails);
        Assert.Equal(JobStatus.Completed, longStrategyDetails.Run.Status);
        Assert.Equal(LongStrategySourcePointCount, longStrategyDetails.Run.PointCount);

        var savedStrategy = await SaveStrategyAsync(
            client,
            workspaceId,
            longStrategyRun.Id);
        var strategyPreset = await CreateStrategyPresetAsync(
            client,
            workspaceId,
            savedStrategy.Id,
            longPeriodStart,
            longPeriodStart.AddHours(LongStrategySourcePointCount - 1));
        var strategyPresetRun = await QueueCalculationAsync(
            client,
            workspaceId,
            null,
            strategyPreset.Preset.Id,
            longPeriodStart,
            longPeriodStart.AddHours(LongStrategySourcePointCount - 1));
        await ProcessOneCalculationAsync(factory);
        var strategyPresetDetails = await client.GetFromJsonAsync<CalculationRunDetails>(
            $"/api/v1/workspaces/{workspaceId}/calculation-runs/{strategyPresetRun.Id}",
            JsonOptions);

        Assert.NotNull(strategyPresetDetails);
        Assert.Equal(JobStatus.Completed, strategyPresetDetails.Run.Status);
        Assert.Equal(LongStrategySourcePointCount, strategyPresetDetails.Run.PointCount);

        await using var auditScope = factory.Services.CreateAsyncScope();
        var auditDbContext = auditScope.ServiceProvider.GetRequiredService<MetaEngineDbContext>();
        Assert.Equal(
            1,
            await auditDbContext.AuditEvents.CountAsync(
                auditEvent => auditEvent.Action == "portfolio_imported" &&
                               auditEvent.EntityId == import.Portfolio.Id));
        Assert.Equal(
            1,
            await auditDbContext.AuditEvents.CountAsync(
                auditEvent => auditEvent.Action == "preset_created" &&
                               auditEvent.EntityId == preset.Preset.Id));
        Assert.Equal(
            1,
            await auditDbContext.AuditEvents.CountAsync(
                auditEvent => auditEvent.Action == "calculation_queued" &&
                               auditEvent.EntityId == calculation.Id));
        Assert.Equal(
            1,
            await auditDbContext.AuditEvents.CountAsync(
                auditEvent => auditEvent.Action == "calculation_completed" &&
                               auditEvent.EntityId == calculation.Id));
    }

    private static async Task<PortfolioImportResult> ImportPortfolioAsync(
        HttpClient client,
        Guid workspaceId,
        string name = "Integration portfolio",
        string? csv = null)
    {
        csv ??=
            "timestamp,diff\n" +
            "1704499200000,0.01\n" +
            "1704502800000,-0.02\n" +
            "1704506400000,0.03\n";
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(name), "name");
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

    private static async Task<PresetDetails> CreatePresetAsync(
        HttpClient client,
        Guid workspaceId,
        Guid portfolioId)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);
        var start = DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/presets")
        {
            Content = JsonContent.Create(new CreatePresetRequest(
                "Integration preset",
                null,
                [new CreatePresetItemRequest(PresetItemSourceType.Portfolio, portfolioId, 1.25, start, null)]))
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<PresetDetails>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task<PresetDetails> CreateStrategyPresetAsync(
        HttpClient client,
        Guid workspaceId,
        Guid strategyId,
        DateTimeOffset startsAt,
        DateTimeOffset endsAt)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/presets")
        {
            Content = JsonContent.Create(new CreatePresetRequest(
                "Strategy preset",
                null,
                [new CreatePresetItemRequest(
                    PresetItemSourceType.Strategy,
                    strategyId,
                    1,
                    startsAt,
                    endsAt)]))
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<PresetDetails>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task<SavedStrategySummary> SaveStrategyAsync(
        HttpClient client,
        Guid workspaceId,
        Guid strategyRunId)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/strategies")
        {
            Content = JsonContent.Create(new SaveStrategyRequest("Long RSI", strategyRunId, null))
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<SavedStrategySummary>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task<CalculationRunSummary> QueueCalculationAsync(
        HttpClient client,
        Guid workspaceId,
        Guid? portfolioId,
        Guid? presetId,
        DateTimeOffset periodStart,
        DateTimeOffset periodEnd)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/calculation-runs")
        {
            Content = JsonContent.Create(new QueueCalculationRequest(
                portfolioId,
                presetId,
                periodStart,
                periodEnd,
                "1h"))
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<CalculationRunSummary>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task<CalculationRunSummary> QueueStrategyCalculationAsync(
        HttpClient client,
        Guid workspaceId,
        Guid sourceRunId)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/calculation-runs/{sourceRunId}/strategies")
        {
            Content = JsonContent.Create(new
            {
                strategyType = "rsi",
                parameters = new { rsiPeriod = 14, buyLevel = 30, sellLevel = 70 }
            })
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<CalculationRunSummary>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task ProcessOneCalculationAsync(PostgresApiFactory factory)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var processor = scope.ServiceProvider.GetRequiredService<ICalculationRunProcessor>();
        Assert.True(await processor.ProcessNextAsync(CancellationToken.None));
    }

    private static string CreateHourlyCsv(int pointCount)
    {
        var builder = new StringBuilder("timestamp,diff\n");
        const long firstTimestamp = 1_704_499_200_000L;
        const long hourMilliseconds = 3_600_000L;
        for (var index = 0; index < pointCount; index++)
        {
            builder.Append(firstTimestamp + (index * hourMilliseconds));
            builder.Append(',');
            builder.Append(index % 17 == 0 ? "-0.002" : "0.001");
            builder.Append('\n');
        }

        return builder.ToString();
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
            .Where(auditEvent =>
                auditEvent.Action == "portfolio_imported" ||
                auditEvent.Action == "preset_created" ||
                auditEvent.Action == "calculation_queued" ||
                auditEvent.Action == "calculation_completed" ||
                auditEvent.Action == "calculation_failed" ||
                auditEvent.Action == "strategy_calculation_queued" ||
                auditEvent.Action == "strategy_calculation_completed" ||
                auditEvent.Action == "strategy_calculation_failed" ||
                auditEvent.Action == "strategy_saved")
            .ExecuteDeleteAsync();
        await dbContext.PresetItems.ExecuteDeleteAsync();
        await dbContext.Strategies.ExecuteDeleteAsync();
        await dbContext.CalculationRuns.ExecuteDeleteAsync();
        await dbContext.Presets.ExecuteDeleteAsync();
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
