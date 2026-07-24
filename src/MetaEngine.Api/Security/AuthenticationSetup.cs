using System.Security.Claims;
using System.Security.Cryptography.X509Certificates;
using MetaEngine.Domain.Model;
using MetaEngine.Infrastructure.Identity;
using MetaEngine.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace MetaEngine.Api.Security;

public static class AuthenticationSetup
{
    public static IServiceCollection AddMetaEngineAuthentication(
        this IServiceCollection services,
        IHostEnvironment environment,
        IConfiguration configuration)
    {
        services
            .AddIdentityCore<IdentityAccount>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 12;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = true;
                options.Lockout.AllowedForNewUsers = true;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            })
            .AddEntityFrameworkStores<MetaEngineDbContext>()
            .AddSignInManager();

        services
            .AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = IdentityConstants.ApplicationScheme;
                options.DefaultChallengeScheme = IdentityConstants.ApplicationScheme;
                options.DefaultSignInScheme = IdentityConstants.ApplicationScheme;
            })
            .AddCookie(IdentityConstants.ApplicationScheme, options =>
            {
                options.Cookie.Name = environment.IsProduction()
                    ? "__Host-MetaEngine.Auth"
                    : "MetaEngine.Auth";
                options.Cookie.HttpOnly = true;
                options.Cookie.IsEssential = true;
                options.Cookie.SameSite = SameSiteMode.Strict;
                options.Cookie.SecurePolicy = environment.IsProduction()
                    ? CookieSecurePolicy.Always
                    : CookieSecurePolicy.SameAsRequest;
                options.ExpireTimeSpan = TimeSpan.FromHours(8);
                options.SlidingExpiration = true;
                options.Events = new CookieAuthenticationEvents
                {
                    OnValidatePrincipal = async context =>
                    {
                        var userIdValue = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                        if (!Guid.TryParse(userIdValue, out var userId))
                        {
                            context.RejectPrincipal();
                            return;
                        }

                        var dbContext = context.HttpContext.RequestServices
                            .GetRequiredService<MetaEngineDbContext>();
                        var isActive = await dbContext.UserAccounts
                            .AnyAsync(
                                user => user.Id == userId && user.Status == UserAccessStatus.Active,
                                context.HttpContext.RequestAborted);
                        if (!isActive)
                        {
                            context.RejectPrincipal();
                        }
                    },
                    OnRedirectToLogin = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                        return Task.CompletedTask;
                    },
                    OnRedirectToAccessDenied = context =>
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        return Task.CompletedTask;
                    }
                };
            });

        services.AddAuthorization();
        services.AddAntiforgery(options =>
        {
            options.HeaderName = "X-CSRF-TOKEN";
            options.Cookie.Name = environment.IsProduction()
                ? "__Host-MetaEngine.Csrf"
                : "MetaEngine.Csrf";
            options.Cookie.HttpOnly = true;
            options.Cookie.IsEssential = true;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.Cookie.SecurePolicy = environment.IsProduction()
                ? CookieSecurePolicy.Always
                : CookieSecurePolicy.SameAsRequest;
        });
        var dataProtection = services
            .AddDataProtection()
            .SetApplicationName("MetaEngine")
            .PersistKeysToDbContext<MetaEngineDbContext>();
        if (environment.IsProduction())
        {
            var certificatePath = GetRequiredProductionSetting(configuration, "CertificatePath");
            var certificatePassword = GetRequiredProductionSetting(configuration, "CertificatePassword");
            var certificate = X509CertificateLoader.LoadPkcs12FromFile(
                certificatePath,
                certificatePassword,
                X509KeyStorageFlags.EphemeralKeySet);
            dataProtection.ProtectKeysWithCertificate(certificate);
        }

        services.Configure<DevAuthOptions>(configuration.GetSection(DevAuthOptions.SectionName));
        services.AddScoped<AdminBootstrapper>();
        services.AddScoped<DevAuthService>();

        return services;
    }

    private static string GetRequiredProductionSetting(IConfiguration configuration, string name) =>
        configuration[$"MetaEngine:DataProtection:{name}"]
        ?? throw new InvalidOperationException(
            $"Production setting 'MetaEngine__DataProtection__{name}' is required.");
}
