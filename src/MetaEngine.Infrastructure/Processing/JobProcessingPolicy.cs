using Microsoft.Extensions.Options;
using Npgsql;

namespace MetaEngine.Infrastructure.Processing;

public sealed class JobProcessingOptions
{
    public const int DefaultLeaseDurationSeconds = 120;
    public const int DefaultMaximumAutomaticAttempts = 3;
    public const int DefaultInitialRetryDelaySeconds = 5;

    public int LeaseDurationSeconds { get; set; } = DefaultLeaseDurationSeconds;

    public int MaximumAutomaticAttempts { get; set; } = DefaultMaximumAutomaticAttempts;

    public int InitialRetryDelaySeconds { get; set; } = DefaultInitialRetryDelaySeconds;
}

internal sealed class JobProcessingPolicy(IOptions<JobProcessingOptions> options)
{
    public TimeSpan LeaseDuration => TimeSpan.FromSeconds(Math.Max(30, options.Value.LeaseDurationSeconds));

    public bool CanRetryAutomatically(int attemptCount) =>
        attemptCount < Math.Max(1, options.Value.MaximumAutomaticAttempts);

    public DateTimeOffset GetRetryNotBefore(DateTimeOffset now, int attemptCount)
    {
        var initialDelay = Math.Max(1, options.Value.InitialRetryDelaySeconds);
        var exponent = Math.Clamp(attemptCount - 1, 0, 5);
        return now.AddSeconds(initialDelay * Math.Pow(2, exponent));
    }

    public static bool IsTransientDatabaseFailure(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is TimeoutException || current is NpgsqlException { IsTransient: true })
            {
                return true;
            }
        }

        return false;
    }
}

internal readonly record struct ClaimedJob(Guid Id, Guid LeaseId);
