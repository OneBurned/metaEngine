using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Api.Contracts;
using MetaEngine.Domain.Model;

namespace MetaEngine.ApiTests;

public sealed class AuthenticationTests(MetaEngineApiFactory factory) : IClassFixture<MetaEngineApiFactory>
{
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    [Fact]
    public async Task Anonymous_user_cannot_read_workspaces()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/api/v1/workspaces/");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_requires_a_valid_csrf_token()
    {
        var user = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/v1/auth/login",
            new LoginRequest(user.Email, user.Password));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_csrf_token", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Authenticated_user_can_only_read_their_own_workspace()
    {
        var owner = await factory.CreateUserAsync(WorkspaceRole.Admin);
        var otherUser = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();

        var login = await LoginAsync(client, owner);
        var workspaces = await client.GetFromJsonAsync<JsonElement>("/api/v1/workspaces/");
        var ownWorkspace = await client.GetAsync($"/api/v1/workspaces/{owner.WorkspaceId}");
        var foreignWorkspace = await client.GetAsync($"/api/v1/workspaces/{otherUser.WorkspaceId}");
        var currentUser = await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me", JsonOptions);

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Single(workspaces.GetProperty("items").EnumerateArray());
        Assert.Equal(owner.WorkspaceId, workspaces.GetProperty("items")[0].GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.OK, ownWorkspace.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreignWorkspace.StatusCode);
        Assert.NotNull(currentUser);
        Assert.Equal(owner.UserId, currentUser.Id);
        Assert.Single(currentUser.Workspaces);
        Assert.True(currentUser.Workspaces[0].CanWrite);
        Assert.True(currentUser.Workspaces[0].CanAdminister);
    }

    [Fact]
    public async Task Viewer_workspace_access_is_read_only()
    {
        var viewer = await factory.CreateUserAsync(WorkspaceRole.Viewer);
        using var client = factory.CreateClient();

        await LoginAsync(client, viewer);
        var currentUser = await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me", JsonOptions);

        Assert.NotNull(currentUser);
        Assert.Single(currentUser.Workspaces);
        Assert.False(currentUser.Workspaces[0].CanWrite);
        Assert.False(currentUser.Workspaces[0].CanAdminister);
    }

    [Fact]
    public async Task Researcher_can_write_but_cannot_administer_workspace()
    {
        var researcher = await factory.CreateUserAsync(WorkspaceRole.Researcher);
        using var client = factory.CreateClient();

        await LoginAsync(client, researcher);
        var currentUser = await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me", JsonOptions);

        Assert.NotNull(currentUser);
        Assert.Single(currentUser.Workspaces);
        Assert.True(currentUser.Workspaces[0].CanWrite);
        Assert.False(currentUser.Workspaces[0].CanAdminister);
    }

    [Fact]
    public async Task Disabled_user_loses_access_with_an_existing_cookie()
    {
        var user = await factory.CreateUserAsync(WorkspaceRole.Admin);
        using var client = factory.CreateClient();

        await LoginAsync(client, user);
        await factory.SetUserStatusAsync(user.UserId, UserAccessStatus.Disabled);
        var response = await client.GetAsync("/api/v1/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }


    [Fact]
    public async Task Development_admin_shortcut_creates_admin_workspace()
    {
        using var isolatedFactory = new MetaEngineApiFactory(
            "Development",
            new Dictionary<string, string?>
            {
                ["MetaEngine:DevAuth:Enabled"] = "true"
            });
        using var client = isolatedFactory.CreateClient();

        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest("admin", "admin"))
        };
        request.Headers.Add("X-CSRF-TOKEN", csrf.Token);

        var login = await client.SendAsync(request);
        var currentUser = await client.GetFromJsonAsync<CurrentUserResponse>("/api/v1/auth/me", JsonOptions);

        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.NotNull(currentUser);
        Assert.Equal("admin@metaengine.local", currentUser.Email);
        Assert.Single(currentUser.Workspaces);
        Assert.True(currentUser.Workspaces[0].CanWrite);
        Assert.True(currentUser.Workspaces[0].CanAdminister);
    }

    [Fact]
    public async Task Admin_bootstrap_is_idempotent_for_the_initial_owner()
    {
        using var isolatedFactory = new MetaEngineApiFactory();
        var email = $"owner-{Guid.NewGuid():N}@example.test";
        const string password = "ValidOwner123!";

        var first = await isolatedFactory.BootstrapAdminAsync(email, password);
        var second = await isolatedFactory.BootstrapAdminAsync(email, password);
        using var client = isolatedFactory.CreateClient();
        var status = await client.GetFromJsonAsync<JsonElement>("/api/v1/auth/bootstrap-status");

        Assert.True(first.Created);
        Assert.False(second.Created);
        Assert.Equal(first.UserId, second.UserId);
        Assert.Equal(first.WorkspaceId, second.WorkspaceId);
        Assert.False(status.GetProperty("setupRequired").GetBoolean());
    }

    private static async Task<HttpResponseMessage> LoginAsync(HttpClient client, SeededUser user)
    {
        var csrf = await client.GetFromJsonAsync<CsrfTokenResponse>("/api/v1/auth/csrf");
        Assert.NotNull(csrf);

        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(user.Email, user.Password))
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
