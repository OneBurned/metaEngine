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

function mddEntryCountFromRanges(ranges) {
  const count = Math.floor(Number(ranges?.entryCount ?? 5));
  return Math.min(10, Math.max(1, Number.isFinite(count) ? count : 5));
}

function mddMaxTotalWeightFromRanges(ranges) {
  const value = Math.abs(Number(ranges?.maxTotalWeight ?? 100));
  return Number.isFinite(value) && value > 0 ? value : 100;
}

function mddParameterObject(entries, weights, exitLevel, maxTotalWeight) {
  const parameters = {
    entryCount: entries.length,
    maxTotalWeight,
    exitLevel
  };
  entries.forEach((entry, index) => {
    parameters[`entry${index + 1}`] = entry;
    parameters[`weight${index + 1}`] = weights[index];
  });
  return parameters;
}

function createMddParameterGrid(ranges) {
  const count = mddEntryCountFromRanges(ranges);
  const maxTotalWeight = mddMaxTotalWeightFromRanges(ranges);
  const entryRanges = Array.from({ length: count }, (_, index) => expandNumericRange(`entry${index + 1}`, ranges?.[`entry${index + 1}`]));
  const weightRanges = Array.from({ length: count }, (_, index) => expandNumericRange(`weight${index + 1}`, ranges?.[`weight${index + 1}`]));
  const exitLevels = expandNumericRange('exitLevel', ranges?.exitLevel);
  const grid = [];

  function walkWeights(entries, weights, index, totalWeight) {
    if (index === count) {
      for (const exitLevel of exitLevels) grid.push(mddParameterObject(entries, weights, exitLevel, maxTotalWeight));
      return;
    }
    for (const weight of weightRanges[index]) {
      const nextTotal = totalWeight + weight;
      if (nextTotal > maxTotalWeight + 1e-9) continue;
      walkWeights(entries, [...weights, weight], index + 1, nextTotal);
    }
  }

  function walkEntries(entries, index) {
    if (index === count) {
      walkWeights(entries, [], 0, 0);
      return;
    }
    for (const entry of entryRanges[index]) {
      if (index > 0 && entry <= entries[index - 1]) continue;
      walkEntries([...entries, entry], index + 1);
    }
  }

  walkEntries([], 0);
  return grid;
}

function mddCandidateKey(entries, weights, exitLevel) {
  return `${entries.join('|')}|${weights.join('|')}|${exitLevel}`;
}

function createMddRandomParameterGrid(ranges, options = {}) {
  const count = mddEntryCountFromRanges(ranges);
  const maxTotalWeight = mddMaxTotalWeightFromRanges(ranges);
  const maxCandidates = Math.max(1, Math.floor(Number(options.maxCandidates ?? 100000)));
  const seed = Math.floor(Number(options.seed ?? 42));
  const random = mulberry32(seed);
  const entryRanges = Array.from({ length: count }, (_, index) => expandNumericRange(`entry${index + 1}`, ranges?.[`entry${index + 1}`]));
  const weightRanges = Array.from({ length: count }, (_, index) => expandNumericRange(`weight${index + 1}`, ranges?.[`weight${index + 1}`]));
  const exitLevels = expandNumericRange('exitLevel', ranges?.exitLevel);
  const grid = [];
  const seen = new Set();
  const maxAttempts = maxCandidates * 40;

  for (let attempt = 0; grid.length < maxCandidates && attempt < maxAttempts; attempt += 1) {
    const pairs = entryRanges
      .map((values, index) => ({ entry: randomChoice(values, random), weight: randomChoice(weightRanges[index], random) }))
      .sort((a, b) => a.entry - b.entry);
    const entries = pairs.map((pair) => pair.entry);
    const ordered = entries.every((value, index, values) => index === 0 || value > values[index - 1]);
    if (!ordered) continue;
    const weights = pairs.map((pair) => pair.weight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight > maxTotalWeight + 1e-9) continue;
    const exitLevel = randomChoice(exitLevels, random);
    const key = mddCandidateKey(entries, weights, exitLevel);
    if (seen.has(key)) continue;
    seen.add(key);
    grid.push(mddParameterObject(entries, weights, exitLevel, maxTotalWeight));
  }
  if (!grid.length) throw new Error('MDD random search: не удалось создать кандидатов. Проверьте диапазоны входов и весов.');
  return grid;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChoice(values, random) {
  return values[Math.floor(random() * values.length)];
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
  createMddRandomParameterGrid,
  runRsiOptimizationCase,
  sortOptimizationRuns,
  optimizeRsiStrategy
};
