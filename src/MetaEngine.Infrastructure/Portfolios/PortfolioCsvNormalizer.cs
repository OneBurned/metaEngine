using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using CsvHelper;
using CsvHelper.Configuration;
using MetaEngine.Application.Portfolios;

namespace MetaEngine.Infrastructure.Portfolios;

internal sealed record NormalizedPortfolioPoint(DateTimeOffset Timestamp, double Diff);

internal sealed record NormalizedPortfolioSeries(
    IReadOnlyList<NormalizedPortfolioPoint> Points,
    string Timeframe,
    string SourceChecksum,
    string SeriesChecksum,
    long GapCount,
    IReadOnlyList<PortfolioImportWarning> Warnings,
    bool WarningsTruncated);

internal sealed class PortfolioCsvNormalizer
{
    private static readonly IReadOnlyDictionary<long, string> KnownTimeframes =
        new Dictionary<long, string>
        {
            [60_000] = "1m",
            [5 * 60_000] = "5m",
            [15 * 60_000] = "15m",
            [60 * 60_000] = "1h",
            [24 * 60 * 60_000] = "1d"
        };

    public async Task<NormalizedPortfolioSeries> NormalizeAsync(
        Stream source,
        CancellationToken cancellationToken)
    {
        await using var buffer = await ReadSourceAsync(source, cancellationToken);
        var sourceChecksum = ComputeHash(buffer);
        buffer.Position = 0;

        var points = await ParseAsync(buffer, cancellationToken);
        points.Sort((left, right) => left.Timestamp.CompareTo(right.Timestamp));
        EnsureUniqueTimestamps(points);

        var stepMilliseconds = InferStepMilliseconds(points);
        if (!KnownTimeframes.TryGetValue(stepMilliseconds, out var timeframe))
        {
            throw new PortfolioImportValidationException(
                "unsupported_timeframe",
                $"The inferred interval {stepMilliseconds} ms is not supported.");
        }

        var (gapCount, warnings) = FindGaps(points, stepMilliseconds);
        return new NormalizedPortfolioSeries(
            points,
            timeframe,
            sourceChecksum,
            ComputeSeriesChecksum(points),
            gapCount,
            warnings,
            gapCount > warnings.Count);
    }

    private static async Task<MemoryStream> ReadSourceAsync(
        Stream source,
        CancellationToken cancellationToken)
    {
        var output = new MemoryStream();
        var buffer = new byte[81_920];
        while (true)
        {
            var read = await source.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            if (output.Length + read > PortfolioImportLimits.MaxSourceBytes)
            {
                await output.DisposeAsync();
                throw new PortfolioImportValidationException(
                    "file_too_large",
                    $"CSV file exceeds {PortfolioImportLimits.MaxSourceBytes} bytes.");
            }

            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }

        if (output.Length == 0)
        {
            await output.DisposeAsync();
            throw new PortfolioImportValidationException("empty_file", "CSV file is empty.");
        }

        output.Position = 0;
        return output;
    }

    private static async Task<List<NormalizedPortfolioPoint>> ParseAsync(
        Stream source,
        CancellationToken cancellationToken)
    {
        try
        {
            using var reader = new StreamReader(
                source,
                new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true),
                detectEncodingFromByteOrderMarks: true,
                leaveOpen: true);
            using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                Delimiter = ",",
                HasHeaderRecord = true,
                IgnoreBlankLines = true,
                TrimOptions = TrimOptions.Trim,
                DetectDelimiter = false,
                HeaderValidated = null,
                MissingFieldFound = null
            });

            if (!await csv.ReadAsync())
            {
                throw new PortfolioImportValidationException("empty_file", "CSV file is empty.");
            }

            csv.ReadHeader();
            ValidateHeaders(csv.HeaderRecord);

            var points = new List<NormalizedPortfolioPoint>();
            while (await csv.ReadAsync())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (points.Count >= PortfolioImportLimits.MaxPoints)
                {
                    throw new PortfolioImportValidationException(
                        "too_many_points",
                        $"CSV file exceeds {PortfolioImportLimits.MaxPoints} points.");
                }

                var row = csv.Parser.Row;
                var timestamp = ParseTimestamp(csv.GetField(0), row);
                var diff = ParseDiff(csv.GetField(1), row);
                points.Add(new NormalizedPortfolioPoint(timestamp, diff));
            }

            if (points.Count == 0)
            {
                throw new PortfolioImportValidationException(
                    "empty_series",
                    "CSV file does not contain portfolio points.");
            }

            return points;
        }
        catch (PortfolioImportValidationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is CsvHelperException or DecoderFallbackException)
        {
            throw new PortfolioImportValidationException(
                "invalid_csv",
                "CSV structure or UTF-8 encoding is invalid.");
        }
    }

    private static void ValidateHeaders(string[]? headers)
    {
        if (headers is null || headers.Length != 2 ||
            !string.Equals(headers[0].Trim(), "timestamp", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(headers[1].Trim(), "diff", StringComparison.OrdinalIgnoreCase))
        {
            throw new PortfolioImportValidationException(
                "invalid_headers",
                "CSV header must contain exactly: timestamp,diff.");
        }
    }

    private static DateTimeOffset ParseTimestamp(string? value, int row)
    {
        var raw = value?.Trim();
        if (string.IsNullOrWhiteSpace(raw))
        {
            throw InvalidRow(row, "timestamp is empty");
        }

        if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var unixMilliseconds))
        {
            try
            {
                return DateTimeOffset.FromUnixTimeMilliseconds(unixMilliseconds);
            }
            catch (ArgumentOutOfRangeException)
            {
                throw InvalidRow(row, $"timestamp is outside the supported range: {raw}");
            }
        }

        string[] exactFormats = ["yyyy-MM-dd HH:mm", "yyyy-MM-dd'T'HH:mm"];
        if (DateTimeOffset.TryParseExact(
                raw,
                exactFormats,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var exactTimestamp))
        {
            return exactTimestamp;
        }

        if (DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var timestamp))
        {
            return timestamp.ToUniversalTime();
        }

        throw InvalidRow(row, $"timestamp cannot be parsed: {raw}");
    }

    private static double ParseDiff(string? value, int row)
    {
        var raw = value?.Trim();
        if (string.IsNullOrWhiteSpace(raw) ||
            !double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var diff) ||
            !double.IsFinite(diff))
        {
            throw InvalidRow(row, $"diff must be a finite decimal number: {raw}");
        }

        if (diff < -1)
        {
            throw new PortfolioImportValidationException(
                "return_below_minus_one",
                $"Row {row}: diff cannot be less than -100%.");
        }

        return diff;
    }

    private static PortfolioImportValidationException InvalidRow(int row, string message) =>
        new("invalid_row", $"Row {row}: {message}.");

    private static void EnsureUniqueTimestamps(IReadOnlyList<NormalizedPortfolioPoint> points)
    {
        for (var index = 1; index < points.Count; index++)
        {
            if (points[index].Timestamp == points[index - 1].Timestamp)
            {
                throw new PortfolioImportValidationException(
                    "duplicate_timestamp",
                    $"Timestamp {points[index].Timestamp:O} is duplicated.");
            }
        }
    }

    private static long InferStepMilliseconds(IReadOnlyList<NormalizedPortfolioPoint> points)
    {
        if (points.Count < 2)
        {
            return 60 * 60_000;
        }

        var counts = new Dictionary<long, int>();
        for (var index = 1; index < points.Count; index++)
        {
            var delta = points[index].Timestamp.ToUnixTimeMilliseconds() -
                        points[index - 1].Timestamp.ToUnixTimeMilliseconds();
            if (delta > 0)
            {
                counts[delta] = counts.GetValueOrDefault(delta) + 1;
            }
        }

        var known = KnownTimeframes.Keys
            .Select(step => new { Step = step, Count = counts.GetValueOrDefault(step) })
            .OrderByDescending(item => item.Count)
            .ThenBy(item => item.Step)
            .First();
        return known.Count > 0
            ? known.Step
            : counts.OrderByDescending(item => item.Value).ThenBy(item => item.Key).First().Key;
    }

    private static (long Count, IReadOnlyList<PortfolioImportWarning> Warnings) FindGaps(
        IReadOnlyList<NormalizedPortfolioPoint> points,
        long stepMilliseconds)
    {
        long count = 0;
        var warnings = new List<PortfolioImportWarning>();
        for (var index = 1; index < points.Count; index++)
        {
            var previous = points[index - 1].Timestamp.ToUnixTimeMilliseconds();
            var current = points[index].Timestamp.ToUnixTimeMilliseconds();
            var missing = Math.Max(0, (current - previous - 1) / stepMilliseconds);
            count += missing;

            for (long gapIndex = 1;
                 gapIndex <= missing && warnings.Count < PortfolioImportLimits.MaxReportedWarnings;
                 gapIndex++)
            {
                var timestamp = DateTimeOffset.FromUnixTimeMilliseconds(previous + gapIndex * stepMilliseconds);
                warnings.Add(new PortfolioImportWarning(
                    "missing_point",
                    timestamp,
                    "Expected timestamp is missing; calculations will treat its diff as zero."));
            }
        }

        return (count, warnings);
    }

    private static string ComputeHash(Stream source)
    {
        source.Position = 0;
        var hash = SHA256.HashData(source);
        source.Position = 0;
        return Convert.ToHexStringLower(hash);
    }

    private static string ComputeSeriesChecksum(IReadOnlyList<NormalizedPortfolioPoint> points)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var point in points)
        {
            var line = string.Create(
                CultureInfo.InvariantCulture,
                $"{point.Timestamp.ToUnixTimeMilliseconds()},{point.Diff:R}\n");
            hash.AppendData(Encoding.UTF8.GetBytes(line));
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }
}
