using System.Text.Json;

namespace MetaEngine.ContractTests;

public sealed class GoldenFixtureShapeTests
{
    [Fact]
    public void Shared_golden_fixtures_have_the_required_contract_metadata()
    {
        var fixturesDirectory = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Golden");
        var files = Directory.GetFiles(fixturesDirectory, "*.json").Order(StringComparer.Ordinal).ToArray();

        Assert.Contains(files, file => Path.GetFileName(file) == "mdd_grid_strategy.json");

        foreach (var file in files)
        {
            using var document = JsonDocument.Parse(File.ReadAllText(file));
            var root = document.RootElement;

            Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
            Assert.Equal("1.0", root.GetProperty("contractVersion").GetString());
            Assert.False(string.IsNullOrWhiteSpace(root.GetProperty("id").GetString()));
            Assert.True(root.GetProperty("absoluteTolerance").GetDouble() > 0);
            var input = root.GetProperty("input");
            if (root.GetProperty("kind").GetString() == "preset_calculation")
            {
                var items = input.GetProperty("items");
                Assert.True(items.GetArrayLength() > 0);
                foreach (var item in items.EnumerateArray())
                {
                    Assert.Equal(
                        item.GetProperty("timestamps").GetArrayLength(),
                        item.GetProperty("diffs").GetArrayLength());
                }
            }
            else
            {
                Assert.Equal(
                    input.GetProperty("timestamps").GetArrayLength(),
                    input.GetProperty("diffs").GetArrayLength());
            }
            Assert.Equal(JsonValueKind.Object, root.GetProperty("expected").ValueKind);
        }
    }
}
