const {
  HOUR_MS,
  parseTimestamp,
  formatTimestamp,
  calculateFromDiffs,
  buildGrid
} = require('../lib/calculations');

function buildRowsFromBase(baseRows, from, to, step) {
  const map = new Map(baseRows.map((row) => [row.timestamp, row]));
  const grid = buildGrid(from, to, step);
  const rows = [];
  const warnings = [];
  let previousAccum = 0;

  for (const ts of grid) {
    const source = map.get(ts);
    if (source) {
      previousAccum = source.accum;
      rows.push({ ...source });
    } else {
      warnings.push({ timestamp: ts, display: formatTimestamp(ts), reason: 'strategy_period_missing_source_filled' });
      rows.push({
        timestamp: ts,
        time: formatTimestamp(ts),
        diff: 0,
        accum: previousAccum,
        hwm: 0,
        dd: 0,
        mdd: 0
      });
    }
  }
  return { rows, warnings };
}

function entryCount(config) {
  const count = Math.floor(Number(config.entryCount ?? 5));
  return Math.min(10, Math.max(1, Number.isFinite(count) ? count : 5));
}

function normalizeEntryConfigs(config) {
  const count = entryCount(config);
  const defaultWeight = 100 / count;
  const entries = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      levelPercent: Math.abs(Number(config[`entry${n}`] ?? n * 5)),
      weight: Math.abs(Number(config[`weight${n}`] ?? defaultWeight))
    };
  }).sort((a, b) => a.levelPercent - b.levelPercent);
  const maxTotalWeight = Math.abs(Number(config.maxTotalWeight ?? 100));
  const totalWeight = entries.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight > maxTotalWeight + 1e-9) throw new Error('Сумма весов входов больше максимального общего веса');
  return entries.map((item) => ({
    level: -(item.levelPercent / 100),
    levelPercent: item.levelPercent,
    weight: item.weight
  }));
}

function normalizeExit(config) {
  return -(Math.abs(Number(config.exitLevel ?? 2)) / 100);
}

function calculateMetricsFromRows(rows, config) {
  const entries = normalizeEntryConfigs(config);
  const exitLevel = normalizeExit(config);
  let activeEntries = 0;
  let pendingActiveEntries = 0;
  let accum = 0;
  let hwm = 0;
  let maxDrawdown = 0;
  let buyCount = 0;
  let sellCount = 0;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    activeEntries = pendingActiveEntries;
    const positionWeight = entries.slice(0, activeEntries).reduce((sum, entry) => sum + entry.weight, 0) / 100;
    const strategyDiff = positionWeight * row.diff;
    accum = i === 0 ? 0 : ((1 + strategyDiff) * (1 + accum)) - 1;
    hwm = Math.max(hwm, accum);
    const drawdown = ((1 + accum) / (1 + hwm)) - 1;
    maxDrawdown = Math.min(maxDrawdown, drawdown);

    let nextActiveEntries = entries.filter((entry) => row.dd <= entry.level).length;
    if (activeEntries > 0 && row.dd >= exitLevel) nextActiveEntries = 0;
    if (nextActiveEntries > activeEntries) buyCount += nextActiveEntries - activeEntries;
    if (nextActiveEntries < activeEntries) sellCount += activeEntries - nextActiveEntries;
    pendingActiveEntries = nextActiveEntries;
  }

  return {
    summary: {
      start: rows[0]?.time ?? null,
      end: rows.at(-1)?.time ?? null,
      points: rows.length,
      finalAccum: accum,
      hwm,
      maxDrawdown,
      buyCount,
      sellCount
    }
  };
}

function calculate(baseResult, config) {
  const step = baseResult.step ?? HOUR_MS;
  const sourceFrom = baseResult.rows[0]?.timestamp;
  const sourceTo = baseResult.rows.at(-1)?.timestamp;
  const from = config.periodFrom ? parseTimestamp(config.periodFrom) : sourceFrom;
  const to = config.periodTo ? parseTimestamp(config.periodTo) : sourceTo;
  if (from === undefined || to === undefined) throw new Error('Сначала рассчитайте портфолио или пресет');
  if (to < from) throw new Error('Дата окончания стратегии должна быть позже даты начала');

  const source = buildRowsFromBase(baseResult.rows, from, to, step);
  const rowsForStrategy = source.rows;
  const entries = normalizeEntryConfigs(config);
  const exitLevel = normalizeExit(config);
  let activeEntries = 0;
  let pendingActiveEntries = 0;
  const strategyDiffs = [];
  const signals = [];

  for (const sourceRow of rowsForStrategy) {
    activeEntries = pendingActiveEntries;
    const positionWeight = entries.slice(0, activeEntries).reduce((sum, entry) => sum + entry.weight, 0) / 100;
    strategyDiffs.push(positionWeight * sourceRow.diff);

    let nextActiveEntries = entries.filter((entry) => sourceRow.dd <= entry.level).length;
    if (activeEntries > 0 && sourceRow.dd >= exitLevel) nextActiveEntries = 0;
    const delta = nextActiveEntries - activeEntries;
    const signal = delta > 0 ? 'buy' : delta < 0 ? 'sell' : '';
    signals.push({
      signal,
      quantity: Math.abs(delta),
      execution: delta > 0 ? `buy ${delta}` : delta < 0 ? `sell ${Math.abs(delta)}` : '',
      position: positionWeight,
      sourceDiff: sourceRow.diff,
      sourceAccum: sourceRow.accum
    });
    pendingActiveEntries = nextActiveEntries;
  }

  const calculated = calculateFromDiffs(rowsForStrategy.map((row) => row.timestamp), strategyDiffs);
  const rows = calculated.rows.map((row, index) => ({
    ...row,
    strategy_diff: row.diff,
    strategy_accum: row.accum,
    strategy_hwm: row.hwm,
    strategy_dd: row.dd,
    strategy_mdd: row.mdd,
    signal: signals[index].signal,
    execution: signals[index].execution,
    position: signals[index].position,
    source_diff: signals[index].sourceDiff,
    source_accum: signals[index].sourceAccum,
    source_dd: rowsForStrategy[index].dd,
    mdd_entry_steps: entries.filter((entry) => rowsForStrategy[index].dd <= entry.level).length
  }));

  const buyCount = signals.reduce((sum, item) => sum + (item.signal === 'buy' ? item.quantity : 0), 0);
  const sellCount = signals.reduce((sum, item) => sum + (item.signal === 'sell' ? item.quantity : 0), 0);
  return {
    type: 'mdd',
    step,
    warnings: source.warnings,
    rows,
    summary: {
      ...calculated.summary,
      finalAccum: rows.at(-1)?.strategy_accum ?? 0,
      hwm: rows.at(-1)?.strategy_hwm ?? 0,
      maxDrawdown: rows.at(-1)?.strategy_mdd ?? 0,
      buyCount,
      sellCount
    },
    config: {
      entryCount: entries.length,
      maxTotalWeight: Math.abs(Number(config.maxTotalWeight ?? 100)),
      ...Object.fromEntries(entries.flatMap((entry, index) => [
        [`entry${index + 1}`, entry.levelPercent],
        [`weight${index + 1}`, entry.weight]
      ])),
      exitLevel: Math.abs(exitLevel * 100),
      periodFrom: formatTimestamp(from),
      periodTo: formatTimestamp(to)
    }
  };
}

module.exports = {
  type: 'mdd',
  calculate,
  calculateMetricsFromRows
};
