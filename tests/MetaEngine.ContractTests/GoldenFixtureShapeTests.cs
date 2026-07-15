using System.Text.Json;

namespace MetaEngine.ContractTests;

public sealed class GoldenFixtureShapeTests
{
    [Fact]
    public void Shared_golden_fixtures_have_the_required_contract_metadata()
    {
        var fixturesDirectory = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Golden");
        var files = Directory.GetFiles(fixturesDirectory, "*.json").Order(StringComparer.Ordinal).ToArray();

        Assert.Equal(3, files.Length);

        foreach (var file in files)
        {
            using var document = JsonDocument.Parse(File.ReadAllText(file));
            var root = document.RootElement;

            Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
            Assert.Equal("1.0", root.GetProperty("contractVersion").GetString());
            Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("id").GetString()));
            Assert.True(root.GetProperty("absoluteTolerance").GetDouble() > 0);
            Assert.Equal(
                root.GetProperty("input").GetProperty("timestamps").GetArrayLength(),
                root.GetProperty("input").GetProperty("diffs").GetArrayLength());
            Assert.Equal(JsonValueKind.Object, root.GetProperty("expected").ValueKind);
        }
    }
}
