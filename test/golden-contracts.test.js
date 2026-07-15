const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateFromDiffs } = require('../lib/calculations');
const { calculateTradingStrategy } = require('../strategies');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'golden');

function loadFixture(file) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
}

function assertContractValue(actual, expected, tolerance, location) {
  if (typeof expected === 'number') {
    assert.equal(Number.isFinite(actual), true, `${location}: actual value must be finite`);
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `${location}: expected ${expected}, received ${actual}, tolerance ${tolerance}`
    );
    return;
  }

  if (Array.isArray(expected)) {
    assert.equal(Array.isArray(actual), true, `${location}: expected an array`);
    assert.equal(actual.length, expected.length, `${location}: array length`);
    expected.forEach((value, index) => assertContractValue(actual[index], value, tolerance, `${location}[${index}]`));
    return;
  }

  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${location}: expected an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertContractValue(actual[key], value, tolerance, `${location}.${key}`);
    }
    return;
  }

  assert.equal(actual, expected, location);
}

function assertFixtureMetadata(fixture) {
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.contractVersion, /^\d+\.\d+$/);
  assert.ok(fixture.id);
  assert.ok(Number.isFinite(fixture.absoluteTolerance));
  assert.ok(fixture.absoluteTolerance > 0);
  assert.equal(fixture.input.timestamps.length, fixture.input.diffs.length);
}

test('base calculation matches the golden contract', () => {
  const fixture = loadFixture('base_metrics.json');
  assertFixtureMetadata(fixture);
  assert.equal(fixture.kind, 'base_calculation');

  const result = calculateFromDiffs(fixture.input.timestamps, fixture.input.diffs);
  assertContractValue(result.rows, fixture.expected.rows, fixture.absoluteTolerance, `${fixture.id}.rows`);
  assertContractValue(result.summary, fixture.expected.summary, fixture.absoluteTolerance, `${fixture.id}.summary`);
});

for (const file of ['rsi_strategy.json', 'mdd_mean_reversion_strategy.json']) {
  const fixture = loadFixture(file);

  test(`${fixture.id} matches the golden strategy contract`, () => {
    assertFixtureMetadata(fixture);
    assert.equal(fixture.kind, 'trading_strategy');

    const baseResult = {
      ...calculateFromDiffs(fixture.input.timestamps, fixture.input.diffs),
      step: fixture.input.step,
      timeframe: fixture.input.step
    };
    const result = calculateTradingStrategy(baseResult, fixture.input.config);
    assert.equal(result.type, fixture.expected.type);
    assertContractValue(
      result.rows.map((row) => row.strategy_diff),
      fixture.expected.resultDiffs,
      fixture.absoluteTolerance,
      `${fixture.id}.resultDiffs`
    );

    for (const checkpoint of fixture.expected.checkpoints) {
      const { index, ...expectedRow } = checkpoint;
      assertContractValue(result.rows[index], expectedRow, fixture.absoluteTolerance, `${fixture.id}.rows[${index}]`);
    }

    assertContractValue(result.summary, fixture.expected.summary, fixture.absoluteTolerance, `${fixture.id}.summary`);
  });
}
