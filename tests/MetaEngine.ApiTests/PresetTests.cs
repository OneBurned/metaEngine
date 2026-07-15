using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Api.Contracts;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Presets;
using MetaEngine.Domain.Model;

namespace MetaEngine.ApiTests;

public sealed class PresetTests(MetaEngineApiFactory factory) : IClassFixture<MetaEngineApiFactory>
{
    private const string PrimaryCsv =
        "timestamp,diff\n" +
        "1704499200000,0\n" +
        "1704502800000,0.01\n" +
        "1704506400000,-0.02\n";
    private const string SecondaryCsv =
        "timestamp,diff\n" +
        "1704499200000,0\n" +
        "1704502800000,-0.01\n" +
        "1704506400000,0.03\n";

    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    [Fact]
    public async Task Admin_can_create_versioned_preset_with_exact_portfolio_versions()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        var primary = await ImportAsync(client, owner.WorkspaceId, PrimaryCsv, "Primary");
        var secondary = await ImportAsync(client, owner.WorkspaceId, SecondaryCsv, "Secondary");
        var start = DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L);
        var rebalancedAt = start.AddHours(2);

        var firstResponse = await CreateAsync(
            client,
            owner.WorkspaceId,
            new CreatePresetRequest(
                "Leveraged allocation",
                null,
                [
                    new CreatePresetItemRequest(primary.Portfolio.Id, 0.25, start, rebalancedAt),
                    new CreatePresetItemRequest(primary.Portfolio.Id, 0.75, rebalancedAt, null),
                    new CreatePresetItemRequest(secondary.Portfolio.Id, 0.5, start, null)
                ]));
        var first = await firstResponse.Content.ReadFromJsonAsync<PresetDetails>(JsonOptions);

        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        Assert.NotNull(first);
        Assert.Equal(1, first.Preset.Version);
        Assert.Equal(3, first.Preset.ItemCount);
        Assert.Equal(primary.Portfolio.Id, first.Items[0].PortfolioId);
        Assert.Equal(primary.Portfolio.Version, first.Items[0].PortfolioVersion);
        Assert.Equal(0.25, first.Items[0].Weight);
        Assert.Equal(rebalancedAt, first.Items[0].EndsAt);
        Assert.Equal(primary.Portfolio.Id, first.Items[1].PortfolioId);
        Assert.Equal(secondary.Portfolio.Id, first.Items[2].PortfolioId);

        var secondResponse = await CreateAsync(
            client,
            owner.WorkspaceId,
            new CreatePresetRequest(
                "Leveraged allocation revised",
                first.Preset.PresetKey,
                [new CreatePresetItemRequest(secondary.Portfolio.Id, 1.5, start, null)]));
        var second = await secondResponse.Content.ReadFromJsonAsync<PresetDetails>(JsonOptions);
        var list = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/presets");
        var found = await client.GetFromJsonAsync<PresetDetails>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/presets/{first.Preset.Id}",
            JsonOptions);

        Assert.Equal(HttpStatusCode.Created, secondResponse.StatusCode);
        Assert.NotNull(second);
        Assert.Equal(first.Preset.PresetKey, second.Preset.PresetKey);
        Assert.Equal(2, second.Preset.Version);
        Assert.Equal(2, list.GetProperty("items").GetArrayLength());
        Assert.NotNull(found);
        Assert.Equal(first.Preset.Id, found.Preset.Id);
        Assert.Equal(3, found.Items.Count);
    }

    [Fact]
    public async Task Preset_rejects_overlapping_periods_for_the_same_portfolio()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        var portfolio = await ImportAsync(client, owner.WorkspaceId, PrimaryCsv, "Primary");
        var start = DateTimeOffset.FromUnixTimeMilliseconds(1_704_499_200_000L);

        var response = await CreateAsync(
            client,
            owner.WorkspaceId,
            new CreatePresetRequest(
                "Invalid rebalancing",
                null,
                [
                    new CreatePresetItemRequest(portfolio.Portfolio.Id, 0.5, start, start.AddHours(2)),
                    new CreatePresetItemRequest(portfolio.Portfolio.Id, 0.5, start.AddHours(1), null)
                ]));
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("overlapping_portfolio_periods", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Viewer_cannot_create_a_preset()
    {
        var viewer = await factory.CreateUserAsync(WorkspaceRole.Viewer);
        using var client = factory.CreateClient();
        await LoginAsync(client, viewer);

        var response = await CreateAsync(
            client,
            viewer.WorkspaceId,
            new CreatePresetRequest("Viewer preset", null, []));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Foreign_workspace_presets_are_hidden()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        var other = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);

        var create = await CreateAsync(
            client,
            other.WorkspaceId,
            new CreatePresetRequest("Foreign", null, []));
        var list = await client.GetAsync($"/api/v1/workspaces/{other.WorkspaceId}/presets");

        Assert.Equal(HttpStatusCode.NotFound, create.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, list.StatusCode);
    }

    [Fact]
    public async Task Create_preset_requires_a_csrf_token()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);

        var response = await client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/presets",
            new CreatePresetRequest("No CSRF", null, []));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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

    private static async Task<HttpResponseMessage> CreateAsync(
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
        return await client.SendAsync(request);
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
