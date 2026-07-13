function expandNumericRange(name, range, { integer = false } = {}) {
  const from = Number(range?.from);
  const to = Number(range?.to);
  const step = Number(range?.step);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
    throw new Error(`Диапазон ${name}: заполните from, to и step`);
  }
  if (step <= 0) throw new Error(`Диапазон ${name}: step должен быть больше 0`);
  if (to < from) throw new Error(`Диапазон ${name}: to должен быть больше или равен from`);

  const values = [];
  const scale = 1_000_000;
  for (let value = from; value <= to + step / scale; value += step) {
    const normalized = Math.round(value * scale) / scale;
    values.push(integer ? Math.round(normalized) : normalized);
  }
  return [...new Set(values)];
}

function recoveryScore(finalAccum, maxDrawdown) {
  const drawdown = Math.abs(Number(maxDrawdown) || 0);
  const profit = Number(finalAccum) || 0;
  if (drawdown === 0) {
    if (profit > 0) return 1_000_000_000 + profit;
    if (profit < 0) return -1_000_000_000 + profit;
    return 0;
  }
  return profit / drawdown;
}

function optimizeRsiStrategy(baseResult, baseConfig, ranges, calculateTradingStrategy, options = {}) {
  const rsiPeriods = expandNumericRange('rsiPeriod', ranges?.rsiPeriod, { integer: true });
  const buyLevels = expandNumericRange('buyLevel', ranges?.buyLevel);
  const sellLevels = expandNumericRange('sellLevel', ranges?.sellLevel);
  const maxRuns = Number(options.maxRuns ?? 5000);
  const maxResults = Number(options.maxResults ?? 100);
  const totalRuns = rsiPeriods.length * buyLevels.length * sellLevels.length;
  if (totalRuns > maxRuns) throw new Error(`Слишком много прогонов: ${totalRuns}. Уменьшите диапазоны или шаг.`);

  const runs = [];
  for (const rsiPeriod of rsiPeriods) {
    for (const buyLevel of buyLevels) {
      for (const sellLevel of sellLevels) {
        const config = {
          ...baseConfig,
          type: 'rsi',
          rsiPeriod,
          buyLevel,
          sellLevel
        };
        const result = calculateTradingStrategy(baseResult, config);
        const finalAccum = result.summary.finalAccum;
        const maxDrawdown = result.summary.maxDrawdown;
        const score = recoveryScore(finalAccum, maxDrawdown);
        runs.push({
          strategy: 'rsi',
          parameters: { rsiPeriod, buyLevel, sellLevel },
          summary: {
            finalAccum,
            maxDrawdown,
            buyCount: result.summary.buyCount,
            sellCount: result.summary.sellCount,
            points: result.summary.points
          },
          score
        });
      }
    }
  }

  runs.sort((a, b) => (
    b.score - a.score ||
    b.summary.finalAccum - a.summary.finalAccum ||
    b.summary.maxDrawdown - a.summary.maxDrawdown ||
    a.parameters.rsiPeriod - b.parameters.rsiPeriod ||
    a.parameters.buyLevel - b.parameters.buyLevel ||
    a.parameters.sellLevel - b.parameters.sellLevel
  ));

  return {
    type: 'rsi',
    metric: 'recovery',
    totalRuns,
    returnedRuns: Math.min(runs.length, maxResults),
    runs: runs.slice(0, maxResults)
  };
}

module.exports = {
  expandNumericRange,
  recoveryScore,
  optimizeRsiStrategy
};
