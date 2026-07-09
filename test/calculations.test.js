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




test('RSI strategy handles string target timeframe from converted base result', () => {
  const from = parseTimestamp('2024-01-01 00:00');
  const grid = Array.from({ length: 20 }, (_, i) => from + i * 3600000);
  const base = { ...calculateFromDiffs(grid, grid.map((_, index) => index === 0 ? 0 : 0.01)), step: '1h', timeframe: '1h', sourceStep: 3600000 };
  const result = calculateTradingStrategy(base, { rsiPeriod: 3 });
  assert.equal(result.rows.length, 20);
  assert.equal(result.step, '1h');
});

test('RSI trading strategy allows inverted levels without validation error', () => {
  const base = { ...calculateFromDiffs([0, 1, 2, 3], [0, -0.01, 0.02, 0.01]), step: 1 };
  assert.doesNotThrow(() => calculateTradingStrategy(base, { rsiPeriod: 2, buyLevel: 80, sellLevel: 20 }));
});

test('builds strict daily timeframe boundaries inside selected period', () => {
  const { buildTimeframeBoundaries } = require('../lib/calculations');
  assert.deepEqual(
    buildTimeframeBoundaries(parseTimestamp('2024-01-10 13:00'), parseTimestamp('2024-03-20 18:00'), '1d').map(formatTimestamp).filter((_, index, arr) => index === 0 || index === arr.length - 1),
    ['2024-01-11 00:00', '2024-03-20 00:00']
  );
  assert.deepEqual(
    buildTimeframeBoundaries(parseTimestamp('2024-01-10 00:00'), parseTimestamp('2024-03-20 00:00'), '1d').map(formatTimestamp).filter((_, index, arr) => index === 0 || index === arr.length - 1),
    ['2024-01-10 00:00', '2024-03-20 00:00']
  );
});

test('builds strict monthly and yearly boundaries inside selected period', () => {
  const { buildTimeframeBoundaries } = require('../lib/calculations');
  assert.deepEqual(
    buildTimeframeBoundaries(parseTimestamp('2024-01-10 13:00'), parseTimestamp('2024-03-20 18:00'), '1M').map(formatTimestamp),
    ['2024-02-01 00:00', '2024-03-01 00:00']
  );
  assert.deepEqual(
    buildTimeframeBoundaries(parseTimestamp('2024-01-01 00:00'), parseTimestamp('2026-06-01 00:00'), '1Y').map(formatTimestamp),
    ['2024-01-01 00:00', '2025-01-01 00:00', '2026-01-01 00:00']
  );
});

test('converts hourly rows to daily rows through accum checkpoints', () => {
  const { convertRowsToTimeframe, HOUR_MS } = require('../lib/calculations');
  const from = parseTimestamp('2024-01-01 00:00');
  const to = parseTimestamp('2024-01-03 00:00');
  const grid = Array.from({ length: 49 }, (_, i) => from + i * HOUR_MS);
  const diffs = grid.map((_, index) => index === 0 ? 0 : 0.01);
  const hourly = calculateFromDiffs(grid, diffs);
  const daily = convertRowsToTimeframe(hourly.rows, from, to, HOUR_MS, '1d');

  assert.deepEqual(daily.rows.map((row) => row.time), ['2024-01-01 00:00', '2024-01-02 00:00', '2024-01-03 00:00']);
  assert.equal(daily.rows[0].diff, 0);
  assert.equal(Number(daily.rows[1].diff.toFixed(12)), Number((Math.pow(1.01, 24) - 1).toFixed(12)));
  assert.equal(Number(daily.rows[2].diff.toFixed(12)), Number((Math.pow(1.01, 24) - 1).toFixed(12)));
});

test('rejects conversion from hourly rows to a smaller timeframe', () => {
  const { convertRowsToTimeframe, HOUR_MS } = require('../lib/calculations');
  const from = parseTimestamp('2024-01-01 00:00');
  const grid = [from, from + HOUR_MS];
  const hourly = calculateFromDiffs(grid, [0, 0.01]);
  assert.throws(() => convertRowsToTimeframe(hourly.rows, from, from + HOUR_MS, HOUR_MS, '15m'), /Нельзя честно построить 15m из 1h/);
});

test('calculation and display timeframe controls live in separate result blocks', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const calculationBlock = html.slice(html.indexOf('<h2>3. Расчет</h2>'), html.indexOf('<section class="card hidden" id="resultCard">'));
  const resultBlock = html.slice(html.indexOf('<section class="card hidden" id="resultCard">'), html.indexOf('<h2>5. Стратегии</h2>'));
  const strategyBlock = html.slice(html.indexOf('<h2>5. Стратегии</h2>'), html.indexOf('<section class="card hidden" id="strategyResultCard">'));
  const strategyResultBlock = html.slice(html.indexOf('<section class="card hidden" id="strategyResultCard">'), html.indexOf('<section class="card" id="exportCard">'));
  assert.ok(calculationBlock.includes('id="timeframe"'));
  assert.ok(calculationBlock.includes('ТФ для расчета'));
  assert.ok(!calculationBlock.includes('Вид Diff'));
  assert.ok(!calculationBlock.includes('id="chartMode"'));
  assert.ok(resultBlock.includes('id="displayTimeframe"'));
  assert.ok(resultBlock.includes('ТФ для отображения'));
  assert.ok(resultBlock.includes('id="chartMode"'));
  assert.ok(resultBlock.includes('Вид Diff'));
  assert.ok(strategyBlock.includes('id="strategyTimeframe"'));
  assert.ok(strategyBlock.includes('ТФ для расчета'));
  assert.ok(strategyResultBlock.includes('id="strategyDisplayTimeframe"'));
  assert.ok(strategyResultBlock.includes('ТФ для отображения'));
  assert.ok(strategyResultBlock.includes('id="strategyChartMode"'));
  assert.ok(strategyResultBlock.includes('Вид Diff'));
});

test('chart histogram and line modes toggle standard metric sets', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(app.includes('checkedLine(\'[data-line="diff"]\', mode === \'bar\')'));
  assert.ok(app.includes('checkedLine(\'[data-line="accum"]\', mode === \'line\')'));
  assert.ok(app.includes('checkedLine(\'[data-line="hwm"]\', mode === \'line\')'));
  assert.ok(app.includes('checkedLine(\'[data-line="dd"]\', mode === \'line\')'));
  assert.ok(app.includes('checkedLine(\'[data-line="mdd"]\', mode === \'line\')'));
  assert.ok(app.includes('checkedLine(\'[data-strategy-line="strategy_diff"]\', mode === \'bar\')'));
  assert.ok(app.includes('checkedLine(\'[data-strategy-line="strategy_accum"]\', mode === \'line\')'));
  assert.ok(app.includes('checkedLine(\'[data-strategy-line="strategy_mdd"]\', mode === \'line\')'));
  assert.ok(app.includes("value > 0 ? '#16a56f' : value < 0 ? '#cf3341'"));
  assert.ok(!app.includes('MONTH_YEAR_TIMEFRAMES.has(event.target.value) ? \'bar\' : \'line\''));
});

test('new calculations reset display and strategy timeframes to the fresh calculation timeframe', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(app.includes('showResult(result, { resetDisplayTimeframe: true })'));
  assert.ok(app.includes('showResult(pendingResult, { resetDisplayTimeframe: true })'));
  assert.ok(app.includes('resetSelectValue($(\'#displayTimeframe\'), calculationTimeframe)'));
  assert.ok(app.includes('resetSelectValue($(\'#strategyTimeframe\'), calculationTimeframe)'));
  assert.ok(app.includes('showStrategyResult(result.strategyResult, result.strategy.name, { resetDisplayTimeframe: true })'));
  assert.ok(app.includes('resetSelectValue($(\'#strategyDisplayTimeframe\'), calculationTimeframe)'));
  assert.ok(!app.includes('lastResult = result.baseResult'));
  assert.ok(!app.includes('showResult(result.baseResult)'));
  assert.ok(html.includes('id="displayRecalcStatus"'));
  assert.ok(html.includes('id="strategyDisplayRecalcStatus"'));
  assert.ok(app.includes('function rerenderWithStatus'));
});

test('strategy calculation rejects timeframe lower than base calculation', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(app.includes('Вы выбрали ТФ ниже чем имеется в расчетах'));
  assert.ok(app.includes('compareTimeframes(lastResult.step ?? lastResult.timeframe ?? body.timeframe, $(\'#strategyTimeframe\').value) < 0'));
  assert.ok(app.includes('body: JSON.stringify({ ...base, timeframe: strategy.timeframe, strategy })'));
});

test('documentation explains calculation and display timeframe split', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const timeframes = fs.readFileSync(path.join(__dirname, '..', 'docs', 'TIMEFRAMES.md'), 'utf8');
  const strategies = fs.readFileSync(path.join(__dirname, '..', 'docs', 'STRATEGIES.md'), 'utf8');
  assert.ok(readme.includes('ТФ для расчета'));
  assert.ok(readme.includes('ТФ для отображения'));
  assert.ok(timeframes.includes('calculation timeframe'));
  assert.ok(timeframes.includes('display timeframe'));
  assert.ok(strategies.includes('Вы выбрали ТФ ниже чем имеется в расчетах'));
});

test('target selection syncs calculation timeframe from portfolio or preset metadata', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(app.includes('function sourceTimeframeForTarget'));
  assert.ok(app.includes('function syncTimeframeToTarget'));
  assert.ok(server.includes('timeframe: timeframeFromStep(step)'));
  assert.ok(server.includes('function presetSourceStep'));
});

test('strategy registry exposes the MDD Mean Reversion module', () => {
  const mdd = getStrategy('mdd_mean_reversion');
  assert.ok(mdd);
  assert.equal(mdd.type, 'mdd_mean_reversion');
  assert.equal(typeof mdd.calculate, 'function');
});

test('MDD Mean Reversion applies weights next point and closes after TP next point', () => {
  const grid = Array.from({ length: 8 }, (_, index) => Date.UTC(2024, 0, 1, index, 0));
  const diffs = [0, -0.12, -0.10, 0.10, 1 / 0.8712 - 1, 0.005, 1.01 / 1.005 - 1, 0.01];
  const base = { ...calculateFromDiffs(grid, diffs), step: '1h', timeframe: '1h' };
  const result = calculateTradingStrategy(base, {
    type: 'mdd_mean_reversion',
    takeProfit: 0.01,
    levels: [
      { drawdown: -0.1, weight: 0.1 },
      { drawdown: -0.2, weight: 0.2 }
    ]
  });

  assert.equal(result.type, 'mdd_mean_reversion');
  assert.equal(result.rows[1].signal, 'target_weight:0.1');
  assert.equal(result.rows[1].position, 0);
  assert.equal(result.rows[1].strategy_diff, 0);
  assert.equal(result.rows[2].execution, 'weight:0.1');
  assert.equal(result.rows[2].position, 0.1);
  assert.equal(Math.round(result.rows[2].strategy_diff * 10000) / 10000, -0.01);
  assert.equal(result.rows[2].signal, 'target_weight:0.2');
  assert.equal(result.rows[3].execution, 'weight:0.2');
  assert.equal(result.rows[4].tp_state, 'waiting');
  assert.equal(result.rows[4].local_accum, 0);
  assert.ok(result.rows[6].local_accum >= 0.01);
  assert.equal(result.rows[6].signal, 'take_profit_close');
  assert.equal(result.rows[6].position, 0.2);
  assert.equal(result.rows[7].execution, 'weight:0');
  assert.equal(result.rows[7].position, 0);
  assert.equal(result.summary.buyCount, 2);
  assert.equal(result.summary.sellCount, 1);
});

test('MDD Mean Reversion validates levels and supports zero TP close next point', () => {
  const grid = Array.from({ length: 5 }, (_, index) => Date.UTC(2024, 0, 1, index, 0));
  const base = { ...calculateFromDiffs(grid, [0, -0.12, 0.1, 1 / 0.968 - 1, 0.01]), step: '1h', timeframe: '1h' };
  assert.throws(() => calculateTradingStrategy(base, { type: 'mdd_mean_reversion', levels: [{ drawdown: 0.1, weight: 0.1 }] }), /отрицательным/);
  assert.throws(() => calculateTradingStrategy(base, { type: 'mdd_mean_reversion', levels: [{ drawdown: -0.1, weight: -0.1 }] }), /не может быть отрицательным/);
  const result = calculateTradingStrategy(base, { type: 'mdd_mean_reversion', takeProfit: 0, levels: [{ drawdown: -0.1, weight: 0.1 }] });
  assert.equal(result.rows[1].signal, 'target_weight:0.1');
  assert.equal(result.rows[3].signal, 'take_profit_close');
  assert.equal(result.rows[3].local_accum, 0);
  assert.equal(result.rows[3].position, 0.1);
  assert.equal(result.rows[4].position, 0);
});
