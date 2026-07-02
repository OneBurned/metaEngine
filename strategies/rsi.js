const {
  parseTimestamp,
  formatTimestamp,
  calculateFromDiffs
} = require('../lib/calculations');

function calculateRsiFromEquity(rows, period = 14) {
  const rsi = rows.map((row) => ({ timestamp: row.timestamp, time: row.time, rsi: null }));
  if (!rows.length || period <= 0 || rows.length <= period) return rsi;
  const equity = rows.map((row) => 1 + row.accum);
  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i += 1) {
    const delta = equity[i] - equity[i - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum += Math.abs(delta);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period].rsi = rsiValue(avgGain, avgLoss);

  for (let i = period + 1; i < rows.length; i += 1) {
    const delta = equity[i] - equity[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    rsi[i].rsi = rsiValue(avgGain, avgLoss);
  }
  return rsi;
}

function rsiValue(avgGain, avgLoss) {
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function buildRowsFromBase(baseRows, from, to) {
  const warnings = [];
  const rows = baseRows
    .filter((row) => row.timestamp >= from && row.timestamp <= to)
    .map((row) => ({ ...row }));

  if (baseRows[0] && from < baseRows[0].timestamp) {
    warnings.push({ timestamp: from, display: formatTimestamp(from), reason: 'strategy_period_starts_before_source' });
  }
  if (baseRows.at(-1) && to > baseRows.at(-1).timestamp) {
    warnings.push({ timestamp: to, display: formatTimestamp(to), reason: 'strategy_period_ends_after_source' });
  }

  return { rows, warnings };
}

function calculate(baseResult, config) {
  const step = baseResult.step ?? baseResult.timeframe ?? '1h';
  const sourceFrom = baseResult.rows[0]?.timestamp;
  const sourceTo = baseResult.rows.at(-1)?.timestamp;
  const from = config.periodFrom ? parseTimestamp(config.periodFrom) : sourceFrom;
  const to = config.periodTo ? parseTimestamp(config.periodTo) : sourceTo;
  if (from === undefined || to === undefined) throw new Error('Сначала рассчитайте портфолио или пресет');
  if (to < from) throw new Error('Дата окончания стратегии должна быть позже даты начала');

  const rsiPeriod = Number(config.rsiPeriod ?? 14);
  const fullRsiSeries = calculateRsiFromEquity(baseResult.rows, rsiPeriod);
  const fullRsiByTimestamp = new Map(fullRsiSeries.map((row) => [row.timestamp, row]));
  const source = buildRowsFromBase(baseResult.rows, from, to);
  const rowsForStrategy = source.rows;
  const rsiSeries = rowsForStrategy.map((row) => fullRsiByTimestamp.get(row.timestamp) ?? { timestamp: row.timestamp, time: row.time, rsi: null });
  const buyLevel = Number(config.buyLevel ?? config.lowerLevel ?? 30);
  const sellLevel = Number(config.sellLevel ?? config.upperLevel ?? 70);
  let position = 0;
  let pendingExecution = '';
  const strategyDiffs = [];
  const signals = [];

  for (let i = 0; i < rowsForStrategy.length; i += 1) {
    const sourceRow = rowsForStrategy[i];
    const rsi = rsiSeries[i]?.rsi;
    const execution = pendingExecution;
    pendingExecution = '';

    if (execution === 'buy') position = 1;
    if (execution === 'sell') position = 0;

    strategyDiffs.push(position ? sourceRow.diff : 0);

    const previousRsi = i > 0 ? rsiSeries[i - 1]?.rsi : null;
    const crossedBuy = previousRsi !== null && rsi !== null && previousRsi > buyLevel && rsi <= buyLevel;
    const crossedSell = previousRsi !== null && rsi !== null && previousRsi < sellLevel && rsi >= sellLevel;
    let signal = '';
    if (crossedBuy && position === 0) {
      signal = 'buy';
      pendingExecution = 'buy';
    } else if (crossedSell && position === 1) {
      signal = 'sell';
      pendingExecution = 'sell';
    }
    signals.push({ signal, execution, position, rsi, sourceDiff: sourceRow.diff, sourceAccum: sourceRow.accum });
  }

  const calculated = calculateFromDiffs(rowsForStrategy.map((row) => row.timestamp), strategyDiffs);
  const rows = calculated.rows.map((row, index) => ({
    ...row,
    strategy_diff: row.diff,
    strategy_accum: row.accum,
    strategy_hwm: row.hwm,
    strategy_dd: row.dd,
    strategy_mdd: row.mdd,
    rsi: signals[index].rsi,
    signal: signals[index].signal,
    execution: signals[index].execution,
    position: signals[index].position,
    source_diff: signals[index].sourceDiff,
    source_accum: signals[index].sourceAccum
  }));

  const buyCount = signals.filter((item) => item.signal === 'buy').length;
  const sellCount = signals.filter((item) => item.signal === 'sell').length;
  return {
    type: 'rsi',
    step,
    rsi: rsiSeries,
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
      rsiPeriod,
      upperLevel: Number(config.upperLevel ?? 70),
      lowerLevel: Number(config.lowerLevel ?? 30),
      baseline: Number(config.baseline ?? 50),
      buyLevel,
      sellLevel,
      periodFrom: formatTimestamp(from),
      periodTo: formatTimestamp(to)
    }
  };
}

module.exports = {
  type: 'rsi',
  calculate,
  calculateRsiFromEquity
};
