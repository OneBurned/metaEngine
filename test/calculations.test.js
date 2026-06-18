const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseTimestamp,
  formatTimestamp,
  normalizeToDiffCsv,
  calculateFromDiffs,
  calculatePreset,
  validatePresetItems
} = require('../lib/calculations');
const { calculateRsiFromEquity } = require('../strategies/rsi');
const { calculateTradingStrategy, getStrategy } = require('../strategies');

test('formats timestamps as YYYY-MM-DD HH:MM without shifting the Unix time', () => {
  assert.equal(formatTimestamp(1777557600000), '2026-04-30 14:00');
  assert.equal(formatTimestamp(1744239600000), '2025-04-09 23:00');
  assert.equal(formatTimestamp(1633302000000), '2021-10-03 23:00');
  assert.equal(parseTimestamp('2026-04-30 14:00'), 1777557600000);
  assert.equal(parseTimestamp('2026-04-30T14:00'), 1777557600000);
});

test('normalizes diff CSV and keeps missing diff points as calculation warnings only', () => {
  const csv = '1704499200000,0\n1704502800000,-0.0003\n1704510000000,0.0002\n';
  const normalized = normalizeToDiffCsv(csv, 'diff');
  assert.equal(normalized.step, 3600000);
  assert.deepEqual(normalized.gaps.map(formatTimestamp), ['2024-01-06 02:00']);
  assert.match(normalized.csv, /^timestamp,diff/);
});

test('converts accum input to diff and fills missing accum with previous value', () => {
  const csv = '1704499200000,0.1\n1704502800000,0.2\n1704510000000,0.3\n';
  const normalized = normalizeToDiffCsv(csv, 'accum');
  const lines = normalized.csv.trim().split('\n');
  assert.equal(lines[1], '1704499200000,0');
  assert.equal(Number(lines[2].split(',')[1]).toFixed(12), '0.090909090909');
  assert.equal(Number(lines[3].split(',')[1]), 0);
  assert.equal(Number(lines[4].split(',')[1]).toFixed(12), '0.083333333333');
});

test('calculates accum, hwm, dd and mdd series', () => {
  const grid = [0, 1, 2, 3, 4, 5];
  const diffs = [0, -0.02, -0.030612244897959107, 0.042105263157894646, -0.07070707070707072, 0.05434782608695643];
  const result = calculateFromDiffs(grid, diffs);
  assert.deepEqual(result.rows.map((row) => Number(row.dd.toFixed(2))), [0, -0.02, -0.05, -0.01, -0.08, -0.03]);
  assert.deepEqual(result.rows.map((row) => Number(row.mdd.toFixed(2))), [0, -0.02, -0.05, -0.05, -0.08, -0.08]);
  assert.equal(result.summary.hwm, 0);
});

test('rejects overlapping rebalance periods for the same portfolio', () => {
  assert.throws(() => validatePresetItems([
    { portfolio: 'a.csv', date_from: '2024-01-01 00:00', date_to: '2025-01-01 00:00' },
    { portfolio: 'a.csv', date_from: '2024-06-01 00:00', date_to: null }
  ]), /пересекаются/);

  assert.doesNotThrow(() => validatePresetItems([
    { portfolio: 'a.csv', date_from: '2024-01-01 00:00', date_to: '2025-01-01 00:00' },
    { portfolio: 'a.csv', date_from: '2025-01-01 00:00', date_to: null }
  ]));
});

test('preset uses zero diffs for deleted portfolio files and keeps calculating', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-test-'));
  const preset = {
    name: 'missing_portfolio_preset',
    items: [
      { portfolio: 'deleted.csv', weight: 1, weightPercent: 100, date_from: '2024-01-06 00:00', date_to: null }
    ]
  };

  const result = calculatePreset(preset, dir, parseTimestamp('2024-01-06 00:00'), parseTimestamp('2024-01-06 02:00'));

  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((row) => row.diff), [0, 0, 0]);
  assert.equal(result.summary.finalAccum, 0);
  assert.equal(result.warnings[0].reason, 'portfolio_file_missing_zero');
});


test('strategy registry exposes the RSI module', () => {
  const rsi = getStrategy('rsi');
  assert.ok(rsi);
  assert.equal(rsi.type, 'rsi');
  assert.equal(typeof rsi.calculate, 'function');
  assert.equal(typeof rsi.calculateRsiFromEquity, 'function');
});

test('calculates RSI from equity curve', () => {
  const grid = Array.from({ length: 18 }, (_, i) => i);
  const diffs = [0, 0.01, 0.01, -0.01, 0.02, -0.02, 0.01, 0.01, -0.01, 0.02, -0.01, 0.01, 0.01, -0.02, 0.03, 0.01, -0.01, 0.02];
  const base = calculateFromDiffs(grid, diffs);
  const rsi = calculateRsiFromEquity(base.rows, 14);
  assert.equal(rsi.slice(0, 14).every((row) => row.rsi === null), true);
  assert.equal(typeof rsi[14].rsi, 'number');
  assert.ok(rsi[14].rsi >= 0 && rsi[14].rsi <= 100);
});

test('RSI trading strategy changes position next point and builds strategy result', () => {
  const grid = Array.from({ length: 20 }, (_, i) => i);
  const diffs = [0, -0.02, -0.02, -0.02, -0.02, -0.02, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, -0.02, -0.02, -0.02, 0.03, 0.03, 0.03, -0.01, -0.01];
  const base = { ...calculateFromDiffs(grid, diffs), step: 1 };
  const result = calculateTradingStrategy(base, {
    rsiPeriod: 3,
    buyLevel: 40,
    sellLevel: 60,
    upperLevel: 60,
    lowerLevel: 40,
    baseline: 50,
    periodFrom: '1970-01-01 00:00',
    periodTo: '1970-01-01 00:00'
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].strategy_diff, 0);

  const full = calculateTradingStrategy(base, { rsiPeriod: 3, buyLevel: 40, sellLevel: 60 });
  assert.ok(full.summary.buyCount >= 1);
  assert.ok(full.rows.some((row) => row.signal === 'buy'));
  const buyIndex = full.rows.findIndex((row) => row.signal === 'buy');
  assert.equal(full.rows[0].signal, '');
  assert.equal(full.rows[buyIndex].strategy_diff, 0);
  if (buyIndex + 1 < full.rows.length) {
    assert.equal(full.rows[buyIndex + 1].execution, 'buy');
    assert.equal(full.rows[buyIndex + 1].position, 1);
  }
});


test('RSI trading strategy allows inverted levels without validation error', () => {
  const base = { ...calculateFromDiffs([0, 1, 2, 3], [0, -0.01, 0.02, 0.01]), step: 1 };
  assert.doesNotThrow(() => calculateTradingStrategy(base, { rsiPeriod: 2, buyLevel: 80, sellLevel: 20 }));
});
