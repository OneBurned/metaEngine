using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Api.Contracts;
using MetaEngine.Application.Calculations;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Presets;
using MetaEngine.Application.Strategies;
using MetaEngine.Domain.Model;
using Microsoft.Extensions.DependencyInjection;

namespace MetaEngine.ApiTests;

public sealed class CalculationRunTests(MetaEngineApiFactory factory) : IClassFixture<MetaEngineApiFactory>
{
    private const string PortfolioCsv =
        "timestamp,diff\n" +
        "1704499200000,0\n" +
        "1704502800000,0.01\n" +
        "1704506400000,-0.02\n";
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    [Fact]
    public async Task Admin_can_queue_process_and_read_a_portfolio_calculation()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        var portfolio = await ImportAsync(client, owner.WorkspaceId, PortfolioCsv, "Calculation source");
        var queued = await QueueAsync(
            client,
            owner.WorkspaceId,
            new QueueCalculationRequest(
                portfolio.Portfolio.Id,
                null,
                DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L),
                DateTimeOffset.FromUnixTimeMilliseconds(1_704_506_400_000L),
                "1h"));

        Assert.Equal(HttpStatusCode.Accepted, queued.Response.StatusCode);
        Assert.Equal(JobStatus.Queued, queued.Run.Status);
        var beforeProcessing = await client.GetAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs/{queued.Run.Id}/result");
        Assert.Equal(HttpStatusCode.Conflict, beforeProcessing.StatusCode);

        await ProcessOneAsync();

        var details = await client.GetFromJsonAsync<CalculationRunDetails>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs/{queued.Run.Id}",
            JsonOptions);
        var page = await client.GetFromJsonAsync<CalculationResultPage>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs/{queued.Run.Id}/result?limit=2",
            JsonOptions);
        var list = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs");

        Assert.NotNull(details);
        Assert.Equal(JobStatus.Completed, details.Run.Status);
        Assert.Equal(3, details.Run.PointCount);
        AssertClose(-0.0102, details.Run.FinalAccum!.Value);
        Assert.NotNull(details.Artifact);
        Assert.Equal(3, details.Artifact.PointCount);
        Assert.Matches("^[0-9a-f]{64}$", details.Artifact.SeriesChecksum);
        Assert.NotNull(page);
        Assert.Equal(3, page.Total);
        Assert.Equal(2, page.Items.Count);
        AssertClose(0, page.Items[0].Diff);
        AssertClose(0.01, page.Items[1].Diff);
        Assert.Equal(1, list.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Admin_can_process_a_saved_preset()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        var portfolio = await ImportAsync(client, owner.WorkspaceId, PortfolioCsv, "Preset source");
        var start = DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L);
        var preset = await CreatePresetAsync(
            client,
            owner.WorkspaceId,
            new CreatePresetRequest(
                "Half exposure",
                null,
                [new CreatePresetItemRequest(portfolio.Portfolio.Id, 0.5, start, null)]));
        var queued = await QueueAsync(
            client,
            owner.WorkspaceId,
            new QueueCalculationRequest(
                null,
                preset.Preset.Id,
                start,
                start.AddHours(2),
                "1h"));

        await ProcessOneAsync();

        var details = await client.GetFromJsonAsync<CalculationRunDetails>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs/{queued.Run.Id}",
            JsonOptions);
        var page = await client.GetFromJsonAsync<CalculationResultPage>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs/{queued.Run.Id}/result",
            JsonOptions);

        Assert.NotNull(details);
        Assert.Equal(CalculationInputType.Preset, details.Run.InputType);
        Assert.Equal(JobStatus.Completed, details.Run.Status);
        AssertClose(-0.00505, details.Run.FinalAccum!.Value);
        Assert.NotNull(page);
        Assert.Equal(3, page.Items.Count);
        AssertClose(0, page.Items[0].Diff);
        AssertClose(0.005, page.Items[1].Diff);
        AssertClose(-0.01, page.Items[2].Diff);
    }

    [Fact]
    public async Task Viewer_cannot_queue_a_calculation()
    {
        var viewer = await factory.CreateUserAsync(WorkspaceRole.Viewer);
        using var client = factory.CreateClient();
        await LoginAsync(client, viewer);

        var response = await SendQueueAsync(
            client,
            viewer.WorkspaceId,
            new QueueCalculationRequest(
                Guid.CreateVersion7(),
                null,
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow,
                "1h"));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Admin_can_queue_process_and_save_a_strategy_calculation()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        var portfolio = await ImportAsync(client, owner.WorkspaceId, PortfolioCsv, "Strategy source");
        var baseRun = await QueueAsync(
            client,
            owner.WorkspaceId,
            new QueueCalculationRequest(
                portfolio.Portfolio.Id,
                null,
                DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L),
                DateTimeOffset.FromUnixTimeMilliseconds(1_704_506_400_000L),
                "1h"));
        await ProcessOneAsync();

        var strategyResponse = await SendStrategyQueueAsync(
            client,
            owner.WorkspaceId,
            baseRun.Run.Id,
            new QueueStrategyCalculationRequest(
                "rsi",
                JsonSerializer.SerializeToElement(new { rsiPeriod = 1, buyLevel = 30, sellLevel = 70 })));
        var strategyRun = await strategyResponse.Content.ReadFromJsonAsync<CalculationRunSummary>(JsonOptions);

        Assert.Equal(HttpStatusCode.Accepted, strategyResponse.StatusCode);
        Assert.NotNull(strategyRun);
        Assert.Equal(CalculationRunKind.Strategy, strategyRun.Kind);
        Assert.Equal(baseRun.Run.Id, strategyRun.SourceCalculationRunId);
        await ProcessOneAsync();

        var result = await client.GetFromJsonAsync<CalculationResultPage>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs/{strategyRun.Id}/result",
            JsonOptions);
        Assert.NotNull(result);
        Assert.Equal(3, result.Items.Count);

        var saved = await SaveStrategyAsync(
            client,
            owner.WorkspaceId,
            new SaveStrategyRequest("RSI 1", strategyRun.Id, null));
        var savedStrategies = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/strategies");
        Assert.Equal("rsi", saved.StrategyType);
        Assert.Equal(1, saved.Version);
        Assert.Equal(1, savedStrategies.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Queue_requires_one_known_source_and_csrf()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        var invalidInputResponse = await SendQueueAsync(
            client,
            owner.WorkspaceId,
            new QueueCalculationRequest(
                null,
                null,
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow,
                "1h"));
        var invalidInput = await invalidInputResponse.Content.ReadFromJsonAsync<JsonElement>();
        var csrfResponse = await client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/calculation-runs",
            new QueueCalculationRequest(
                Guid.CreateVersion7(),
                null,
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow,
                "1h"));

        Assert.Equal(HttpStatusCode.BadRequest, invalidInputResponse.StatusCode);
        Assert.Equal("calculation_input_required", invalidInput.GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, csrfResponse.StatusCode);
    }

    private async Task ProcessOneAsync()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var processor = scope.ServiceProvider.GetRequiredService<ICalculationRunProcessor>();
        Assert.True(await processor.ProcessNextAsync(CancellationToken.None));
    }

    private static async Task LoginAsync(HttpClient client, SeededUser user)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(user.Email, user.Password))
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<PortfolioImportResult> ImportAsync(
        HttpClient client,
        Guid workspaceId,
        string csv,
        string name)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(name), "name");
        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(csv)), "file", "portfolio.csv");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/portfolios/import")
        {
            Content = form
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task<PresetDetails> CreatePresetAsync(
        HttpClient client,
        Guid workspaceId,
        CreatePresetRequest requestBody)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/presets")
        {
            Content = JsonContent.Create(requestBody)
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var result = await response.Content.ReadFromJsonAsync<PresetDetails>(JsonOptions);
        Assert.NotNull(result);
        return result;
    }

    private static async Task<(HttpResponseMessage Response, CalculationRunSummary Run)> QueueAsync(
        HttpClient client,
        Guid workspaceId,
        QueueCalculationRequest requestBody)
    {
        var response = await SendQueueAsync(client, workspaceId, requestBody);
        var run = await response.Content.ReadFromJsonAsync<CalculationRunSummary>(JsonOptions);
        Assert.NotNull(run);
        return (response, run);
    }

    private static async Task<HttpResponseMessage> SendQueueAsync(
        HttpClient client,
        Guid workspaceId,
        QueueCalculationRequest requestBody)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/calculation-runs")
        {
            Content = JsonContent.Create(requestBody)
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        return await client.SendAsync(request);
    }

    private static async Task<HttpResponseMessage> SendStrategyQueueAsync(
        HttpClient client,
        Guid workspaceId,
        Guid sourceRunId,
        QueueStrategyCalculationRequest requestBody)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/calculation-runs/{sourceRunId}/strategies")
        {
            Content = JsonContent.Create(requestBody)
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        return await client.SendAsync(request);
    }

    private static async Task<SavedStrategySummary> SaveStrategyAsync(
        HttpClient client,
        Guid workspaceId,
        SaveStrategyRequest requestBody)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/workspaces/{workspaceId}/strategies")
        {
            Content = JsonContent.Create(requestBody)
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var saved = await response.Content.ReadFromJsonAsync<SavedStrategySummary>(JsonOptions);
        Assert.NotNull(saved);
        return saved;
    }

    private static void AssertClose(double expected, double actual) =>
        Assert.InRange(actual, expected - 1e-12, expected + 1e-12);

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
