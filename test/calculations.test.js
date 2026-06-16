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
});

test('rejects overlapping rebalance periods for the same strategy', () => {
  assert.throws(() => validatePresetItems([
    { strategy: 'a.csv', date_from: '2024-01-01 00:00', date_to: '2025-01-01 00:00' },
    { strategy: 'a.csv', date_from: '2024-06-01 00:00', date_to: null }
  ]), /пересекаются/);

  assert.doesNotThrow(() => validatePresetItems([
    { strategy: 'a.csv', date_from: '2024-01-01 00:00', date_to: '2025-01-01 00:00' },
    { strategy: 'a.csv', date_from: '2025-01-01 00:00', date_to: null }
  ]));
});


test('preset uses zero diffs for deleted strategy files and keeps calculating', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-test-'));
  const preset = {
    name: 'missing_strategy_preset',
    items: [
      { strategy: 'deleted.csv', weight: 1, weightPercent: 100, date_from: '2024-01-06 00:00', date_to: null }
    ]
  };

  const result = calculatePreset(preset, dir, parseTimestamp('2024-01-06 00:00'), parseTimestamp('2024-01-06 02:00'));

  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows.map((row) => row.diff), [0, 0, 0]);
  assert.equal(result.summary.finalAccum, 0);
  assert.equal(result.warnings[0].reason, 'strategy_file_missing_zero');
});
