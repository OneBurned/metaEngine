using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Api.Contracts;
using MetaEngine.Application.Portfolios;
using MetaEngine.Domain.Model;

namespace MetaEngine.ApiTests;

public sealed class PortfolioTests(MetaEngineApiFactory factory) : IClassFixture<MetaEngineApiFactory>
{
    private const string PortfolioCsv =
        "timestamp,diff\n" +
        "1704510000000,0.03\n" +
        "1704499200000,0.01\n" +
        "1704502800000,-0.02\n";

    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    [Fact]
    public async Task Admin_can_import_deduplicate_version_and_page_portfolio_points()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);

        var firstResponse = await ImportAsync(client, owner.WorkspaceId, PortfolioCsv, "Primary");
        var first = await firstResponse.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);

        Assert.Equal(HttpStatusCode.Created, firstResponse.StatusCode);
        Assert.NotNull(first);
        Assert.True(first.Created);
        Assert.Equal(3, first.Portfolio.PointCount);
        Assert.Equal("1h", first.Portfolio.Timeframe);
        Assert.Equal(1, first.Report.GapCount);
        Assert.Single(first.Report.Warnings);

        const string normalizedDuplicateCsv =
            "timestamp,diff\n" +
            "2024-01-06T01:00:00Z,-0.02\n" +
            "2024-01-06T03:00:00Z,0.03\n" +
            "2024-01-06T00:00:00Z,0.01\n";
        var duplicateResponse = await ImportAsync(
            client,
            owner.WorkspaceId,
            normalizedDuplicateCsv,
            "Ignored duplicate name");
        var duplicate = await duplicateResponse.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);

        Assert.Equal(HttpStatusCode.OK, duplicateResponse.StatusCode);
        Assert.NotNull(duplicate);
        Assert.False(duplicate.Created);
        Assert.Equal(first.Portfolio.Id, duplicate.Portfolio.Id);
        Assert.NotEqual(
            first.Portfolio.SourceChecksum,
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedDuplicateCsv))));
        Assert.Equal(first.Portfolio.SeriesChecksum, duplicate.Portfolio.SeriesChecksum);

        const string secondVersionCsv =
            "timestamp,diff\n" +
            "1704499200000,0.02\n" +
            "1704502800000,-0.01\n" +
            "1704506400000,0.04\n";
        var versionResponse = await ImportAsync(
            client,
            owner.WorkspaceId,
            secondVersionCsv,
            "Primary revised",
            first.Portfolio.PortfolioKey);
        var version = await versionResponse.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);

        Assert.Equal(HttpStatusCode.Created, versionResponse.StatusCode);
        Assert.NotNull(version);
        Assert.Equal(first.Portfolio.PortfolioKey, version.Portfolio.PortfolioKey);
        Assert.Equal(2, version.Portfolio.Version);

        var list = await client.GetFromJsonAsync<JsonElement>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/portfolios");
        var metadata = await client.GetFromJsonAsync<PortfolioSummary>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/portfolios/{first.Portfolio.Id}",
            JsonOptions);
        var page = await client.GetFromJsonAsync<PortfolioPointPage>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/portfolios/{first.Portfolio.Id}/points?offset=1&limit=2");

        Assert.Equal(2, list.GetProperty("items").GetArrayLength());
        Assert.NotNull(metadata);
        Assert.Equal(first.Portfolio.Id, metadata.Id);
        Assert.NotNull(page);
        Assert.Equal(3, page.Total);
        Assert.Equal(2, page.Items.Count);
        Assert.True(page.Items[0].Timestamp < page.Items[1].Timestamp);
    }

    [Fact]
    public async Task Researcher_can_import_a_portfolio()
    {
        var researcher = await factory.CreateUserAsync(WorkspaceRole.Researcher);
        using var client = factory.CreateClient();
        await LoginAsync(client, researcher);

        var response = await ImportAsync(
            client,
            researcher.WorkspaceId,
            PortfolioCsv,
            "Researcher import");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }


    [Fact]
    public async Task Admin_can_import_accum_portfolio_with_custom_headers()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        const string accumCsv =
            "Timestamp,Unrealized_profits\n" +
            "1704499200000,0.01\n" +
            "1704502800000,0.03\n" +
            "1704506400000,0.00\n";

        var response = await ImportAsync(client, owner.WorkspaceId, accumCsv, "Custom header accum", valueType: "accum");
        var result = await response.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(result);
        Assert.Equal(PortfolioValueType.Accum, result.Portfolio.ValueType);

        var page = await client.GetFromJsonAsync<PortfolioPointPage>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/portfolios/{result.Portfolio.Id}/points?offset=0&limit=3");

        Assert.NotNull(page);
        Assert.Equal(0.01, page.Items[0].Diff, 10);
        Assert.Equal((1.03 / 1.01) - 1, page.Items[1].Diff, 10);
        Assert.Equal((1.00 / 1.03) - 1, page.Items[2].Diff, 10);
    }

    [Fact]
    public async Task Admin_can_import_headerless_accum_portfolio()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        const string accumCsv =
            "1704499200000,0.01\n" +
            "1704502800000,0.03\n" +
            "1704506400000,0.00\n";

        var response = await ImportAsync(client, owner.WorkspaceId, accumCsv, "Accum import", valueType: "accum");
        var result = await response.Content.ReadFromJsonAsync<PortfolioImportResult>(JsonOptions);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(result);
        Assert.Equal(PortfolioValueType.Accum, result.Portfolio.ValueType);

        var page = await client.GetFromJsonAsync<PortfolioPointPage>(
            $"/api/v1/workspaces/{owner.WorkspaceId}/portfolios/{result.Portfolio.Id}/points?offset=0&limit=3");

        Assert.NotNull(page);
        Assert.Equal(0.01, page.Items[0].Diff, 10);
        Assert.Equal((1.03 / 1.01) - 1, page.Items[1].Diff, 10);
        Assert.Equal((1.00 / 1.03) - 1, page.Items[2].Diff, 10);
    }

    [Fact]
    public async Task Import_requires_a_csrf_token()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        using var form = CreateImportForm(PortfolioCsv, "Missing CSRF");

        var response = await client.PostAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/portfolios/import",
            form);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Viewer_cannot_import_a_portfolio()
    {
        var viewer = await factory.CreateUserAsync(WorkspaceRole.Viewer);
        using var client = factory.CreateClient();
        await LoginAsync(client, viewer);

        var response = await ImportAsync(client, viewer.WorkspaceId, PortfolioCsv, "Viewer import");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Import_into_a_foreign_workspace_is_hidden()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        var other = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);

        var response = await ImportAsync(client, other.WorkspaceId, PortfolioCsv, "Foreign import");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Import_rejects_duplicate_timestamps()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        const string invalidCsv =
            "timestamp,diff\n" +
            "1704499200000,0.01\n" +
            "1704499200000,0.02\n";

        var response = await ImportAsync(client, owner.WorkspaceId, invalidCsv, "Invalid");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("duplicate_timestamp", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Import_rejects_a_return_below_minus_one()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();
        await LoginAsync(client, owner);
        const string invalidCsv =
            "timestamp,diff\n" +
            "1704499200000,0\n" +
            "1704502800000,-1.0001\n";

        var response = await ImportAsync(client, owner.WorkspaceId, invalidCsv, "Invalid return");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("return_below_minus_one", body.GetProperty("code").GetString());
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

    private static async Task<HttpResponseMessage> ImportAsync(
        HttpClient client,
        Guid workspaceId,
        string csv,
        string name,
        Guid? portfolioKey = null,
        string valueType = "diff")
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var form = CreateImportForm(csv, name, valueType);
        if (portfolioKey is not null)
        {
            form.Add(new StringContent(portfolioKey.Value.ToString()), "portfolioKey");
        }
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/workspaces/{workspaceId}/portfolios/import")
        {
            Content = form
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);
        return await client.SendAsync(request);
    }

    private static MultipartFormDataContent CreateImportForm(string csv, string name, string valueType = "diff")
    {
        var form = new MultipartFormDataContent();
        form.Add(new StringContent(name), "name");
        form.Add(new StringContent(valueType), "valueType");
        form.Add(
            new ByteArrayContent(Encoding.UTF8.GetBytes(csv)),
            "file",
            "portfolio.csv");
        return form;
    }

    private static JsonSerializerOptions CreateJsonOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }
}
