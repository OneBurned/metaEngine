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
    Number(a.parameters.rsiPeriod ?? a.parameters.levels?.[0]?.drawdownPercent ?? 0) - Number(b.parameters.rsiPeriod ?? b.parameters.levels?.[0]?.drawdownPercent ?? 0)
  ));
  return runs;
}

function createRsiParameterGrid(ranges) {
  const rsiPeriods = expandNumericRange('rsiPeriod', ranges?.rsiPeriod, { integer: true });
  const buyLevels = expandNumericRange('buyLevel', ranges?.buyLevel);
  const sellLevels = expandNumericRange('sellLevel', ranges?.sellLevel);
  const grid = [];
  for (const rsiPeriod of rsiPeriods) {
    for (const buyLevel of buyLevels) {
      for (const sellLevel of sellLevels) grid.push({ rsiPeriod, buyLevel, sellLevel });
    }
  }
  return grid;
}

function levelCountFromRanges(ranges) {
  const count = Math.floor(Number(ranges?.levelCount ?? ranges?.entryCount ?? 5));
  return Math.min(10, Math.max(1, Number.isFinite(count) ? count : 5));
}

function maxTargetWeightFromRanges(ranges) {
  const value = Math.abs(Number(ranges?.maxTotalWeight ?? 100));
  return Number.isFinite(value) && value > 0 ? value : 100;
}

function minEntryDeltaFromRanges(ranges) {
  const value = Math.abs(Number(ranges?.minEntryDelta ?? 0));
  return Number.isFinite(value) ? value : 0;
}

function levelDrawdownRanges(ranges, count) {
  const positiveValues = (values, name) => {
    const filtered = values.filter((value) => value > 0);
    if (!filtered.length) throw new Error(`Диапазон ${name}: нужен хотя бы один вход DD больше 0`);
    return filtered;
  };
  if (ranges?.parameterMode === 'simple') {
    const shared = positiveValues(expandNumericRange('drawdown', ranges?.drawdown ?? ranges?.entry), 'drawdown');
    return Array.from({ length: count }, () => shared);
  }
  return Array.from({ length: count }, (_, index) => positiveValues(
    expandNumericRange(`drawdown${index + 1}`, ranges?.[`drawdown${index + 1}`] ?? ranges?.[`entry${index + 1}`]),
    `drawdown${index + 1}`
  ));
}

function levelWeightRanges(ranges, count) {
  if (ranges?.parameterMode === 'simple') {
    const shared = expandNumericRange('weight', ranges?.weight);
    return Array.from({ length: count }, () => shared);
  }
  return Array.from({ length: count }, (_, index) => expandNumericRange(`weight${index + 1}`, ranges?.[`weight${index + 1}`]));
}

function levelsAreSeparated(drawdowns, minDelta) {
  return drawdowns.every((value, index, values) => {
    if (index === 0) return true;
    const delta = value - values[index - 1];
    return minDelta > 0 ? delta >= minDelta : delta > 0;
  });
}

function weightsAreNonDecreasing(weights) {
  return weights.every((value, index, values) => index === 0 || value >= values[index - 1]);
}

function mddParameterObject(drawdowns, weights, takeProfit, maxTotalWeight) {
  return {
    levelCount: drawdowns.length,
    maxTotalWeight,
    takeProfit,
    levels: drawdowns.map((drawdownPercent, index) => ({
      drawdown: -(drawdownPercent / 100),
      drawdownPercent,
      weight: weights[index] / 100,
      weightPercent: weights[index]
    }))
  };
}

function createMddParameterGrid(ranges) {
  const count = levelCountFromRanges(ranges);
  const maxTotalWeight = maxTargetWeightFromRanges(ranges);
  const minDelta = minEntryDeltaFromRanges(ranges);
  const drawdownRanges = levelDrawdownRanges(ranges, count);
  const weightRanges = levelWeightRanges(ranges, count);
  const takeProfits = expandNumericRange('takeProfit', ranges?.takeProfit);
  const grid = [];

  function walkWeights(drawdowns, weights, index) {
    if (index === count) {
      for (const takeProfit of takeProfits) grid.push(mddParameterObject(drawdowns, weights, takeProfit / 100, maxTotalWeight));
      return;
    }
    for (const weight of weightRanges[index]) {
      const candidate = [...weights, weight];
      if (!weightsAreNonDecreasing(candidate)) continue;
      if (weight > maxTotalWeight + 1e-9) continue;
      walkWeights(drawdowns, candidate, index + 1);
    }
  }

  function walkDrawdowns(drawdowns, index) {
    if (index === count) {
      walkWeights(drawdowns, [], 0);
      return;
    }
    for (const drawdown of drawdownRanges[index]) {
      const candidate = [...drawdowns, drawdown];
      if (!levelsAreSeparated(candidate, minDelta)) continue;
      walkDrawdowns(candidate, index + 1);
    }
  }

  walkDrawdowns([], 0);
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

function createMddRandomParameterGrid(ranges, options = {}) {
  const count = levelCountFromRanges(ranges);
  const maxTotalWeight = maxTargetWeightFromRanges(ranges);
  const minDelta = minEntryDeltaFromRanges(ranges);
  const maxCandidates = Math.max(1, Math.floor(Number(options.maxCandidates ?? 100000)));
  const seed = Math.floor(Number(options.seed ?? 42));
  const random = mulberry32(seed);
  const drawdownRanges = levelDrawdownRanges(ranges, count);
  const weightRanges = levelWeightRanges(ranges, count);
  const takeProfits = expandNumericRange('takeProfit', ranges?.takeProfit);
  const grid = [];
  const seen = new Set();
  const maxAttempts = maxCandidates * 60;

  for (let attempt = 0; grid.length < maxCandidates && attempt < maxAttempts; attempt += 1) {
    const pairs = drawdownRanges
      .map((values, index) => ({ drawdown: randomChoice(values, random), weight: randomChoice(weightRanges[index], random) }))
      .sort((a, b) => a.drawdown - b.drawdown);
    const drawdowns = pairs.map((pair) => pair.drawdown);
    if (!levelsAreSeparated(drawdowns, minDelta)) continue;
    const weights = pairs.map((pair) => pair.weight);
    if (!weightsAreNonDecreasing(weights)) continue;
    if (weights.at(-1) > maxTotalWeight + 1e-9) continue;
    const takeProfit = randomChoice(takeProfits, random);
    const key = `${drawdowns.join('|')}|${weights.join('|')}|${takeProfit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grid.push(mddParameterObject(drawdowns, weights, takeProfit / 100, maxTotalWeight));
  }
  if (!grid.length) throw new Error('MDD random search: не удалось создать кандидатов. Проверьте диапазоны уровней и весов.');
  return grid;
}

module.exports = {
  expandNumericRange,
  recoveryScore,
  sortOptimizationRuns,
  createRsiParameterGrid,
  createMddParameterGrid,
  createMddRandomParameterGrid
};
