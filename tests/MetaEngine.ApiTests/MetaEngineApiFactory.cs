using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MetaEngine.ApiTests;

public sealed record SeededUser(Guid UserId, Guid WorkspaceId, string Email, string Password);

public sealed class MetaEngineApiFactory : WebApplicationFactory<Program>
{
    private const string ConnectionStringEnvironmentKey = "ConnectionStrings__MetaEngine";
    private readonly string databaseName = $"metaengine-api-tests-{Guid.NewGuid():N}";
    private readonly string? previousConnectionString;
    private readonly string environment;
    private readonly Dictionary<string, string?> configurationValues;

    public MetaEngineApiFactory()
        : this("Testing", null)
    {
    }

    public MetaEngineApiFactory(string environment, Dictionary<string, string?>? configurationValues = null)
    {
        this.environment = environment;
        this.configurationValues = configurationValues ?? [];
        previousConnectionString = Environment.GetEnvironmentVariable(ConnectionStringEnvironmentKey);
        Environment.SetEnvironmentVariable(
            ConnectionStringEnvironmentKey,
            "Host=localhost;Database=metaengine_api_tests;Username=unused;Password=unused");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration(configuration =>
        {
            var values = new Dictionary<string, string?>(configurationValues)
            {
                ["ConnectionStrings:MetaEngine"] =
                    "Host=localhost;Database=metaengine_api_tests;Username=unused;Password=unused"
            };
            configuration.AddInMemoryCollection(values);
        });
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<MetaEngineDbContext>();
            services.RemoveAll<DbContextOptions<MetaEngineDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<MetaEngineDbContext>>();
            services.AddDbContext<MetaEngineDbContext>(options =>
                options
                    .UseInMemoryDatabase(databaseName)
                    .ConfigureWarnings(warnings =>
                        warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning)));
        });
    }

    public async Task<SeededUser> CreateUserAsync(WorkspaceRole role)
    {
        using var scope = Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MetaEngineDbContext>();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<IdentityAccount>>();

        var suffix = Guid.NewGuid().ToString("N");
        var userId = Guid.CreateVersion7();
        var workspaceId = Guid.CreateVersion7();
        var email = $"user-{suffix}@example.test";
        const string password = "ValidPass123!";

        dbContext.UserAccounts.Add(new UserAccount
        {
            Id = userId,
            Email = email,
            DisplayName = $"User {suffix}",
            Status = UserAccessStatus.Active
        });
        dbContext.Workspaces.Add(new Workspace
        {
            Id = workspaceId,
            Name = $"Workspace {suffix}"
        });
        dbContext.WorkspaceMembers.Add(new WorkspaceMember
        {
            UserId = userId,
            WorkspaceId = workspaceId,
            Role = role
        });
        await dbContext.SaveChangesAsync();

        var createResult = await userManager.CreateAsync(new IdentityAccount
        {
            Id = userId,
            UserName = email,
            Email = email,
            EmailConfirmed = true
        }, password);
        Assert.True(
            createResult.Succeeded,
            string.Join("; ", createResult.Errors.Select(error => error.Description)));

        return new SeededUser(userId, workspaceId, email, password);
    }

    public async Task SetUserStatusAsync(Guid userId, UserAccessStatus status)
    {
        using var scope = Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<MetaEngineDbContext>();
        var user = await dbContext.UserAccounts.SingleAsync(account => account.Id == userId);
        user.Status = status;
        user.UpdatedAt = DateTimeOffset.UtcNow;
        await dbContext.SaveChangesAsync();
    }

    public async Task<AdminBootstrapResult> BootstrapAdminAsync(string email, string password)
    {
        using var scope = Services.CreateScope();
        var bootstrapper = scope.ServiceProvider.GetRequiredService<AdminBootstrapper>();
        return await bootstrapper.BootstrapAsync(
            new AdminBootstrapRequest(email, password, "Initial Owner", "Personal Workspace"),
            CancellationToken.None);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        Environment.SetEnvironmentVariable(ConnectionStringEnvironmentKey, previousConnectionString);
    }
}
