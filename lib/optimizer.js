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

function sortOptimizationRuns(runs) {
  runs.sort((a, b) => (
    b.score - a.score ||
    b.summary.finalAccum - a.summary.finalAccum ||
    b.summary.maxDrawdown - a.summary.maxDrawdown ||
    Number(a.parameters.rsiPeriod ?? a.parameters.entry1 ?? 0) - Number(b.parameters.rsiPeriod ?? b.parameters.entry1 ?? 0) ||
    Number(a.parameters.buyLevel ?? a.parameters.entry2 ?? 0) - Number(b.parameters.buyLevel ?? b.parameters.entry2 ?? 0) ||
    Number(a.parameters.sellLevel ?? a.parameters.exitLevel ?? 0) - Number(b.parameters.sellLevel ?? b.parameters.exitLevel ?? 0)
  ));
  return runs;
}

function createRsiParameterGrid(ranges, options = {}) {
  const rsiPeriods = expandNumericRange('rsiPeriod', ranges?.rsiPeriod, { integer: true });
  const buyLevels = expandNumericRange('buyLevel', ranges?.buyLevel);
  const sellLevels = expandNumericRange('sellLevel', ranges?.sellLevel);
  const totalRuns = rsiPeriods.length * buyLevels.length * sellLevels.length;

  const grid = [];
  for (const rsiPeriod of rsiPeriods) {
    for (const buyLevel of buyLevels) {
      for (const sellLevel of sellLevels) {
        grid.push({ rsiPeriod, buyLevel, sellLevel });
      }
    }
  }
  return grid;
}

function createMddParameterGrid(ranges) {
  const entries = [1, 2, 3, 4, 5].map((index) => expandNumericRange(`entry${index}`, ranges?.[`entry${index}`]));
  const exitLevels = expandNumericRange('exitLevel', ranges?.exitLevel);
  const grid = [];
  for (const entry1 of entries[0]) {
    for (const entry2 of entries[1]) {
      for (const entry3 of entries[2]) {
        for (const entry4 of entries[3]) {
          for (const entry5 of entries[4]) {
            const ordered = [entry1, entry2, entry3, entry4, entry5].every((value, index, values) => index === 0 || value > values[index - 1]);
            if (!ordered) continue;
            for (const exitLevel of exitLevels) grid.push({ entry1, entry2, entry3, entry4, entry5, exitLevel });
          }
        }
      }
    }
  }
  return grid;
}

function runRsiOptimizationCase(baseResult, baseConfig, parameters, calculateTradingStrategy) {
  const config = {
    ...baseConfig,
    type: 'rsi',
    ...parameters
  };
  const result = calculateTradingStrategy(baseResult, config);
  const finalAccum = result.summary.finalAccum;
  const maxDrawdown = result.summary.maxDrawdown;
  const score = recoveryScore(finalAccum, maxDrawdown);
  return {
    strategy: 'rsi',
    parameters: { ...parameters },
    summary: {
      finalAccum,
      maxDrawdown,
      buyCount: result.summary.buyCount,
      sellCount: result.summary.sellCount,
      points: result.summary.points
    },
    score
  };
}

function optimizeRsiStrategy(baseResult, baseConfig, ranges, calculateTradingStrategy, options = {}) {
  const maxResults = Number(options.maxResults ?? 100);
  const grid = createRsiParameterGrid(ranges, options);
  const runs = grid.map((parameters) => runRsiOptimizationCase(baseResult, baseConfig, parameters, calculateTradingStrategy));
  sortOptimizationRuns(runs);

  return {
    type: 'rsi',
    metric: 'recovery',
    totalRuns: grid.length,
    returnedRuns: Math.min(runs.length, maxResults),
    runs: runs.slice(0, maxResults)
  };
}

module.exports = {
  expandNumericRange,
  recoveryScore,
  createRsiParameterGrid,
  createMddParameterGrid,
  runRsiOptimizationCase,
  sortOptimizationRuns,
  optimizeRsiStrategy
};
