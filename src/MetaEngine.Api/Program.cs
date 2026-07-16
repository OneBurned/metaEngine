using System.Text.Json;
using System.Text.Json.Serialization;
using MetaEngine.Api.Contracts;
using MetaEngine.Api.Endpoints;
using MetaEngine.Api.Security;
using MetaEngine.Application.Portfolios;
using MetaEngine.Application.Security;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using MetaEngine.Strategies.Abstractions;
using MetaEngine.Strategies.MddMeanReversion;
using MetaEngine.Strategies.Rsi;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Http.Features;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("MetaEngine")
    ?? throw new InvalidOperationException("Connection string 'MetaEngine' is required.");
var migrationMode = args.Contains("--migrate", StringComparer.Ordinal);

builder.Services.AddMetaEnginePersistence(connectionString);
if (!migrationMode)
{
    builder.Services.AddMetaEngineAuthentication(builder.Environment, builder.Configuration);
    builder.Services.AddSingleton<RsiStrategyModule>();
    builder.Services.AddSingleton<MddMeanReversionStrategyModule>();
    builder.Services.AddSingleton<IStrategyModule>(serviceProvider => serviceProvider.GetRequiredService<RsiStrategyModule>());
    builder.Services.AddSingleton<IStrategyModule>(serviceProvider => serviceProvider.GetRequiredService<MddMeanReversionStrategyModule>());
    builder.Services.AddSingleton<IStrategyModuleDescriptorProvider>(serviceProvider => serviceProvider.GetRequiredService<RsiStrategyModule>());
    builder.Services.AddSingleton<IStrategyModuleDescriptorProvider>(serviceProvider => serviceProvider.GetRequiredService<MddMeanReversionStrategyModule>());
    builder.Services.AddSingleton<StrategyModuleCatalog>();
    builder.Services.ConfigureHttpJsonOptions(options =>
        options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
    builder.Services.Configure<FormOptions>(options =>
        options.MultipartBodyLengthLimit = PortfolioImportLimits.MaxSourceBytes + 1024 * 1024);
}

var app = builder.Build();

if (migrationMode)
{
    await ApplyMigrationsAsync(app.Services);
    return;
}

if (args.Contains("--bootstrap-admin", StringComparer.Ordinal))
{
    await BootstrapAdminAsync(app.Services, builder.Configuration);
    return;
}

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Ok(new
{
    service = "MetaEngine.Api",
    status = "platform scaffold",
    apiVersion = "v1"
}));

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }));
app.MapGet("/health/ready", async (
    MetaEngineDbContext dbContext,
    ILoggerFactory loggerFactory,
    CancellationToken cancellationToken) =>
{
    try
    {
        if (!await dbContext.Database.CanConnectAsync(cancellationToken))
        {
            return Results.Json(
                new { status = "not_ready", dependencies = new { postgresql = "unavailable" } },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var pendingMigrations = (await dbContext.Database.GetPendingMigrationsAsync(cancellationToken)).ToArray();
        if (pendingMigrations.Length > 0)
        {
            return Results.Json(
                new
                {
                    status = "not_ready",
                    dependencies = new { postgresql = "ready", migrations = "pending" },
                    pendingMigrationCount = pendingMigrations.Length
                },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new
        {
            status = "ready",
            dependencies = new { postgresql = "ready", migrations = "current" }
        });
    }
    catch (Exception exception)
    {
        loggerFactory
            .CreateLogger("MetaEngine.DatabaseReadiness")
            .LogError(exception, "PostgreSQL readiness check failed.");

        return Results.Json(
            new { status = "not_ready", dependencies = new { postgresql = "unavailable" } },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});

app.MapGet("/api/v1/strategy-types", (StrategyModuleCatalog catalog) =>
    Results.Ok(new { items = catalog.Descriptors }));

var auth = app.MapGroup("/api/v1/auth");
auth.MapGet("/csrf", (HttpContext httpContext, IAntiforgery antiforgery) =>
{
    var token = antiforgery.GetAndStoreTokens(httpContext).RequestToken
        ?? throw new InvalidOperationException("Antiforgery request token was not created.");
    return Results.Ok(new CsrfTokenResponse(token));
});
auth.MapGet("/bootstrap-status", async (
    MetaEngineDbContext dbContext,
    CancellationToken cancellationToken) =>
    Results.Ok(new
    {
        setupRequired = !await dbContext.UserAccounts.AnyAsync(cancellationToken)
    }));
auth.MapPost("/login", async (
    LoginRequest request,
    UserManager<IdentityAccount> userManager,
    SignInManager<IdentityAccount> signInManager,
    MetaEngineDbContext dbContext,
    IWorkspaceAccessService workspaceAccessService,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
    {
        return Results.BadRequest(new { code = "validation_error", message = "Email and password are required." });
    }

    var identity = await userManager.FindByEmailAsync(request.Email.Trim());
    if (identity is null)
    {
        return Results.Json(
            new { code = "invalid_credentials", message = "Invalid email or password." },
            statusCode: StatusCodes.Status401Unauthorized);
    }

    var profile = await dbContext.UserAccounts
        .AsNoTracking()
        .SingleOrDefaultAsync(
            user => user.Id == identity.Id && user.Status == UserAccessStatus.Active,
            cancellationToken);
    if (profile is null)
    {
        return Results.Json(
            new { code = "invalid_credentials", message = "Invalid email or password." },
            statusCode: StatusCodes.Status401Unauthorized);
    }

    var signInResult = await signInManager.PasswordSignInAsync(
        identity,
        request.Password,
        request.RememberMe,
        lockoutOnFailure: true);
    if (!signInResult.Succeeded)
    {
        return Results.Json(
            new { code = "invalid_credentials", message = "Invalid email or password." },
            statusCode: StatusCodes.Status401Unauthorized);
    }

    return Results.Ok(await BuildCurrentUserAsync(
        profile,
        workspaceAccessService,
        cancellationToken));
}).AddEndpointFilter<AntiforgeryEndpointFilter>();
auth.MapPost("/logout", async (SignInManager<IdentityAccount> signInManager) =>
{
    await signInManager.SignOutAsync();
    return Results.NoContent();
}).RequireAuthorization().AddEndpointFilter<AntiforgeryEndpointFilter>();
auth.MapGet("/me", async (
    HttpContext httpContext,
    MetaEngineDbContext dbContext,
    IWorkspaceAccessService workspaceAccessService,
    CancellationToken cancellationToken) =>
{
    if (!httpContext.User.TryGetUserId(out var userId))
    {
        return Results.Unauthorized();
    }

    var profile = await dbContext.UserAccounts
        .AsNoTracking()
        .SingleOrDefaultAsync(user => user.Id == userId, cancellationToken);
    return profile is null
        ? Results.Unauthorized()
        : Results.Ok(await BuildCurrentUserAsync(profile, workspaceAccessService, cancellationToken));
}).RequireAuthorization();

var workspaces = app.MapGroup("/api/v1/workspaces").RequireAuthorization();
workspaces.MapGet("/", async (
    HttpContext httpContext,
    IWorkspaceAccessService workspaceAccessService,
    CancellationToken cancellationToken) =>
{
    if (!httpContext.User.TryGetUserId(out var userId))
    {
        return Results.Unauthorized();
    }

    var items = await workspaceAccessService.ListForUserAsync(userId, cancellationToken);
    return Results.Ok(new { items = items.Select(ToResponse) });
});
workspaces.MapGet("/{workspaceId:guid}", async (
    Guid workspaceId,
    HttpContext httpContext,
    IWorkspaceAccessService workspaceAccessService,
    CancellationToken cancellationToken) =>
{
    if (!httpContext.User.TryGetUserId(out var userId))
    {
        return Results.Unauthorized();
    }

    var access = await workspaceAccessService.FindForUserAsync(userId, workspaceId, cancellationToken);
    return access is null
        ? Results.NotFound()
        : Results.Ok(ToResponse(access));
});
workspaces.MapPortfolioEndpoints();
workspaces.MapPresetEndpoints();
workspaces.MapCalculationRunEndpoints();
workspaces.MapStrategyEndpoints();
workspaces.MapOptimizationEndpoints();

app.Run();

static async Task ApplyMigrationsAsync(IServiceProvider services)
{
    await using var scope = services.CreateAsyncScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<MetaEngineDbContext>();
    await dbContext.Database.MigrateAsync();
    scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("MetaEngine.Migrations")
        .LogInformation("Database migrations are current.");
}

static async Task BootstrapAdminAsync(IServiceProvider services, IConfiguration configuration)
{
    var email = GetRequiredBootstrapSetting(configuration, "Email");
    var password = GetRequiredBootstrapSetting(configuration, "Password");
    var displayName = configuration["MetaEngine:BootstrapAdmin:DisplayName"] ?? "MetaEngine Owner";
    var workspaceName = configuration["MetaEngine:BootstrapAdmin:WorkspaceName"] ?? "Personal";

    await using var scope = services.CreateAsyncScope();
    var bootstrapper = scope.ServiceProvider.GetRequiredService<AdminBootstrapper>();
    var result = await bootstrapper.BootstrapAsync(
        new AdminBootstrapRequest(email, password, displayName, workspaceName),
        CancellationToken.None);

    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("MetaEngine.AdminBootstrap");
    logger.LogInformation(
        result.Created ? "Initial admin and workspace created." : "Initial admin already exists.");
}

static string GetRequiredBootstrapSetting(IConfiguration configuration, string name) =>
    configuration[$"MetaEngine:BootstrapAdmin:{name}"]
    ?? throw new InvalidOperationException(
        $"Environment setting 'MetaEngine__BootstrapAdmin__{name}' is required for admin bootstrap.");

static async Task<CurrentUserResponse> BuildCurrentUserAsync(
    UserAccount profile,
    IWorkspaceAccessService workspaceAccessService,
    CancellationToken cancellationToken)
{
    var workspaces = await workspaceAccessService.ListForUserAsync(profile.Id, cancellationToken);
    return new CurrentUserResponse(
        profile.Id,
        profile.Email,
        profile.DisplayName,
        workspaces.Select(ToResponse).ToArray());
}

static WorkspaceAccessResponse ToResponse(WorkspaceAccess access) => new(
    access.WorkspaceId,
    access.WorkspaceName,
    access.Role,
    access.CanWrite,
    access.CanAdminister);

public partial class Program;
