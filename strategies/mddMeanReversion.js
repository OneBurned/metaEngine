const {
  parseTimestamp,
  formatTimestamp,
  calculateFromDiffs
} = require('../lib/calculations');

const DEFAULT_LEVELS = [
  { drawdown: -0.10, weight: 0.10 },
  { drawdown: -0.20, weight: 0.20 },
  { drawdown: -0.30, weight: 0.30 },
  { drawdown: -0.40, weight: 0.40 },
  { drawdown: -0.50, weight: 0.50 }
];

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

function normalizeLevels(rawLevels = DEFAULT_LEVELS) {
  const levels = (Array.isArray(rawLevels) && rawLevels.length ? rawLevels : DEFAULT_LEVELS)
    .map((level) => ({
      drawdown: Number(level.drawdown ?? level.level ?? level.mddLevel),
      weight: Number(level.weight ?? level.targetWeight)
    }));

  const seen = new Set();
  for (const level of levels) {
    if (!Number.isFinite(level.drawdown) || level.drawdown >= 0) throw new Error('Уровень просадки MDD должен быть отрицательным');
    if (!Number.isFinite(level.weight) || level.weight < 0) throw new Error('Вес MDD стратегии не может быть отрицательным');
    const key = level.drawdown.toFixed(12);
    if (seen.has(key)) throw new Error('Уровни просадки MDD не должны повторяться');
    seen.add(key);
  }

  return levels.sort((a, b) => b.drawdown - a.drawdown);
}

function calculateLocalMdd(rows) {
  let localMinEquity = rows[0] ? 1 + rows[0].accum : 1;
  return rows.map((row) => {
    const equity = 1 + row.accum;
    const hwmEquity = 1 + row.hwm;
    const dd = hwmEquity === 0 ? 0 : equity / hwmEquity - 1;
    if (dd >= 0) {
      localMinEquity = equity;
      return { timestamp: row.timestamp, time: row.time, dd: 0, localMdd: 0, localMinEquity, hwmEquity };
    }
    localMinEquity = Math.min(localMinEquity, equity);
    return { timestamp: row.timestamp, time: row.time, dd, localMdd: localMinEquity / hwmEquity - 1, localMinEquity, hwmEquity };
  });
}

function targetWeightForLocalMdd(localMdd, levels) {
  let target = null;
  for (const level of levels) {
    if (localMdd <= level.drawdown) target = level;
  }
  return target;
}

function calculate(baseResult, config) {
  const step = baseResult.step ?? baseResult.timeframe ?? '1h';
  const sourceFrom = baseResult.rows[0]?.timestamp;
  const sourceTo = baseResult.rows.at(-1)?.timestamp;
  const from = config.periodFrom ? parseTimestamp(config.periodFrom) : sourceFrom;
  const to = config.periodTo ? parseTimestamp(config.periodTo) : sourceTo;
  if (from === undefined || to === undefined) throw new Error('Сначала рассчитайте портфолио или пресет');
  if (to < from) throw new Error('Дата окончания стратегии должна быть позже даты начала');

  const takeProfit = Number(config.takeProfit ?? 0.01);
  if (!Number.isFinite(takeProfit) || takeProfit < 0) throw new Error('TP MDD стратегии не может быть отрицательным');
  const levels = normalizeLevels(config.levels);
  const source = buildRowsFromBase(baseResult.rows, from, to);
  const rowsForStrategy = source.rows;
  const indicator = calculateLocalMdd(rowsForStrategy);

  let position = 0;
  let pendingPosition = null;
  let waitingTakeProfit = false;
  let takeProfitStartEquity = null;
  const strategyDiffs = [];
  const signals = [];

  for (let i = 0; i < rowsForStrategy.length; i += 1) {
    const sourceRow = rowsForStrategy[i];
    const mddRow = indicator[i];
    const equity = 1 + sourceRow.accum;
    const execution = pendingPosition === null ? '' : `weight:${pendingPosition}`;
    if (pendingPosition !== null) {
      position = pendingPosition;
      pendingPosition = null;
    }

    strategyDiffs.push((sourceRow.diff * position) || 0);

    let signal = '';
    let tpState = waitingTakeProfit ? 'waiting' : '';

    if (waitingTakeProfit && mddRow.dd < 0) {
      waitingTakeProfit = false;
      takeProfitStartEquity = null;
      tpState = 'cancelled';
    }

    if (waitingTakeProfit) {
      const targetEquity = takeProfitStartEquity * (1 + takeProfit);
      if (equity >= targetEquity && position > 0) {
        signal = 'take_profit_close';
        pendingPosition = 0;
        waitingTakeProfit = false;
        takeProfitStartEquity = null;
        tpState = 'hit';
      }
    } else if (mddRow.dd >= 0 && position > 0) {
      waitingTakeProfit = true;
      takeProfitStartEquity = equity;
      tpState = 'waiting';
      if (takeProfit === 0) {
        signal = 'take_profit_close';
        pendingPosition = 0;
        waitingTakeProfit = false;
        takeProfitStartEquity = null;
        tpState = 'hit';
      }
    } else if (mddRow.dd < 0) {
      const target = targetWeightForLocalMdd(mddRow.localMdd, levels);
      if (target && target.weight > position) {
        signal = `target_weight:${target.weight}`;
        pendingPosition = target.weight;
      }
    }

    signals.push({
      signal,
      execution,
      position,
      sourceDiff: sourceRow.diff,
      sourceAccum: sourceRow.accum,
      dd: mddRow.dd,
      localMdd: mddRow.localMdd,
      tpState,
      takeProfitStartEquity,
      nextPosition: pendingPosition
    });
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
    base_dd: signals[index].dd,
    local_mdd: signals[index].localMdd,
    tp_state: signals[index].tpState,
    tp_start_equity: signals[index].takeProfitStartEquity,
    next_position: signals[index].nextPosition
  }));

  const buyCount = signals.filter((item) => item.signal.startsWith('target_weight')).length;
  const sellCount = signals.filter((item) => item.signal === 'take_profit_close').length;
  return {
    type: 'mdd_mean_reversion',
    step,
    mdd: indicator,
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
      takeProfit,
      levels,
      periodFrom: formatTimestamp(from),
      periodTo: formatTimestamp(to)
    }
  };
}

module.exports = {
  type: 'mdd_mean_reversion',
  calculate,
  calculateLocalMdd,
  normalizeLevels,
  DEFAULT_LEVELS
};
