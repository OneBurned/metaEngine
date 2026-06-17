const fs = require('node:fs');
const path = require('node:path');

const HOUR_MS = 60 * 60 * 1000;
const KNOWN_STEPS = [5 * 60 * 1000, HOUR_MS, 24 * HOUR_MS];

function parseTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Пустой timestamp');
  if (/^-?\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (match) {
    const [, y, mo, d, h, mi] = match.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  throw new Error(`Не удалось прочитать timestamp: ${raw}`);
}

function formatTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function parseNumber(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw) throw new Error('Пустое значение');
  const percent = raw.endsWith('%');
  const normalized = percent ? raw.slice(0, -1).trim() : raw;
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`Не удалось прочитать число: ${raw}`);
  return percent ? number / 100 : number;
}

function parsePortfolioCsv(text) {
  const rows = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const points = [];
  for (let i = 0; i < rows.length; i += 1) {
    const parts = rows[i].split(',').map((part) => part.trim());
    if (parts.length < 2) throw new Error(`Строка ${i + 1}: нужны 2 колонки timestamp,value`);
    if (i === 0 && !/^-?\d+$/.test(parts[0]) && parts[0].toLowerCase() === 'timestamp') continue;
    points.push({ timestamp: parseTimestamp(parts[0]), value: parseNumber(parts[1]) });
  }
  return sortAndDedupe(points);
}

const parseStrategyCsv = parsePortfolioCsv;

function sortAndDedupe(points) {
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].timestamp === sorted[i - 1].timestamp) {
      throw new Error(`Дублируется timestamp ${formatTimestamp(sorted[i].timestamp)}`);
    }
  }
  return sorted;
}

function inferStep(points, fallback = HOUR_MS) {
  if (!points || points.length < 2) return fallback;
  const counts = new Map();
  for (let i = 1; i < points.length; i += 1) {
    const delta = points[i].timestamp - points[i - 1].timestamp;
    if (delta > 0) counts.set(delta, (counts.get(delta) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;

  const exactKnown = KNOWN_STEPS
    .map((step) => ({ step, count: counts.get(step) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.step - b.step)[0];
  if (exactKnown.count > 0) return exactKnown.step;

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

function findGaps(points, step = inferStep(points), from = null, to = null) {
  const byTs = new Set(points.map((point) => point.timestamp));
  if (points.length === 0) return [];
  const start = from ?? points[0].timestamp;
  const end = to ?? points[points.length - 1].timestamp;
  const gaps = [];
  for (let ts = start; ts <= end; ts += step) {
    if (!byTs.has(ts)) gaps.push(ts);
  }
  return gaps;
}

function fillAccumPoints(points, step = inferStep(points)) {
  if (points.length === 0) return [];
  const byTs = new Map(points.map((point) => [point.timestamp, point.value]));
  const start = points[0].timestamp;
  const end = points[points.length - 1].timestamp;
  const filled = [];
  let previous = points[0].value;
  for (let ts = start; ts <= end; ts += step) {
    if (byTs.has(ts)) previous = byTs.get(ts);
    filled.push({ timestamp: ts, accum: previous });
  }
  return filled;
}

function normalizeToDiffCsv(text, valueType) {
  const points = parsePortfolioCsv(text);
  const step = inferStep(points);
  const gaps = findGaps(points, step);
  let diffPoints;

  if (valueType === 'diff') {
    diffPoints = points.map((point) => ({ timestamp: point.timestamp, diff: point.value }));
  } else if (valueType === 'accum') {
    const filled = fillAccumPoints(points, step);
    diffPoints = filled.map((point, index) => {
      if (index === 0) return { timestamp: point.timestamp, diff: 0 };
      const previous = filled[index - 1].accum;
      return { timestamp: point.timestamp, diff: (1 + point.accum) / (1 + previous) - 1 };
    });
  } else {
    throw new Error('Тип значения должен быть diff или accum');
  }

  const csv = ['timestamp,diff', ...diffPoints.map((point) => `${point.timestamp},${formatNumber(point.diff)}`)].join('\n') + '\n';
  return { csv, points: diffPoints, step, gaps };
}

function formatNumber(value) {
  if (Object.is(value, -0)) return '0';
  return Number(value).toPrecision(17).replace(/(?:\.0+|(?:(\.\d*?)0+))$/, '$1');
}

function readPortfolioFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const points = parsePortfolioCsv(text).map((point) => ({ timestamp: point.timestamp, diff: point.value }));
  return { points, step: inferStep(points) };
}

const readStrategyFile = readPortfolioFile;

function buildGrid(from, to, step) {
  const grid = [];
  for (let ts = from; ts <= to; ts += step) grid.push(ts);
  return grid;
}

function valueOnGrid(points, grid, { step, from, to }) {
  const map = new Map(points.map((point) => [point.timestamp, point.diff]));
  const warnings = [];
  const dataStart = points[0]?.timestamp;
  const dataEnd = points.at(-1)?.timestamp;
  for (const ts of grid) {
    if (!map.has(ts)) {
      warnings.push({ timestamp: ts, display: formatTimestamp(ts), reason: 'missing_diff_zero' });
      map.set(ts, 0);
    }
  }
  return {
    diffs: grid.map((ts) => map.get(ts) ?? 0),
    warnings,
    meta: { step, from, to, dataStart, dataEnd }
  };
}

function calculateFromDiffs(grid, diffs) {
  const rows = [];
  let accum = 0;
  let hwm = 0;
  let mdd = 0;

  for (let i = 0; i < grid.length; i += 1) {
    const diff = diffs[i] ?? 0;
    accum = i === 0 ? 0 : (1 + diff) * (1 + accum) - 1;
    if (i === 0) accum = 0;
    hwm = Math.max(hwm, accum);
    const dd = (1 + accum) / (1 + hwm) - 1;
    mdd = Math.min(mdd, dd);
    rows.push({ timestamp: grid[i], time: formatTimestamp(grid[i]), diff, accum, hwm, dd, mdd });
  }

  return {
    rows,
    summary: {
      start: rows[0]?.time ?? null,
      end: rows.at(-1)?.time ?? null,
      points: rows.length,
      finalAccum: rows.at(-1)?.accum ?? 0,
      hwm: rows.at(-1)?.hwm ?? 0,
      maxDrawdown: rows.at(-1)?.mdd ?? 0
    }
  };
}

function itemPortfolio(item) {
  return item.portfolio ?? item.strategy;
}

function validatePresetItems(items) {
  const byPortfolio = new Map();
  for (const item of items) {
    const portfolio = itemPortfolio(item);
    if (!portfolio) throw new Error('В строке пресета не выбрано портфолио');
    const from = parseTimestamp(item.date_from);
    const to = item.date_to ? parseTimestamp(item.date_to) : null;
    if (to !== null && to <= from) throw new Error(`У ${portfolio} дата окончания должна быть позже даты начала`);
    if (!byPortfolio.has(portfolio)) byPortfolio.set(portfolio, []);
    byPortfolio.get(portfolio).push({ from, to });
  }

  for (const [portfolio, ranges] of byPortfolio.entries()) {
    ranges.sort((a, b) => a.from - b.from);
    for (let i = 1; i < ranges.length; i += 1) {
      const previousEnd = ranges[i - 1].to ?? Infinity;
      if (ranges[i].from < previousEnd) {
        throw new Error(`У портфолио ${portfolio} пересекаются периоды в пресете`);
      }
    }
  }
}

function calculatePortfolio(portfolioPath, periodFrom, periodTo, forcedStep = null) {
  const { points, step } = readPortfolioFile(portfolioPath);
  const calcStep = forcedStep ?? step ?? HOUR_MS;
  const grid = buildGrid(periodFrom, periodTo, calcStep);
  const series = valueOnGrid(points, grid, { step: calcStep, from: periodFrom, to: periodTo });
  return { ...calculateFromDiffs(grid, series.diffs), warnings: series.warnings, step: calcStep };
}

const calculateStrategy = calculatePortfolio;

function calculatePreset(preset, portfoliosDir, periodFrom, periodTo) {
  validatePresetItems(preset.items ?? []);
  const portfolioCache = new Map();
  const missingPortfolios = new Set();
  const steps = [];
  for (const item of preset.items ?? []) {
    const portfolio = itemPortfolio(item);
    const portfolioPath = path.join(portfoliosDir, portfolio);
    if (!fs.existsSync(portfolioPath)) {
      missingPortfolios.add(portfolio);
      continue;
    }
    const loaded = readPortfolioFile(portfolioPath);
    portfolioCache.set(portfolio, loaded);
    steps.push(loaded.step);
  }
  const step = steps.length ? Math.min(...steps) : HOUR_MS;
  const grid = buildGrid(periodFrom, periodTo, step);
  const totalDiffs = grid.map(() => 0);
  const warnings = [];

  for (const item of preset.items ?? []) {
    const portfolio = itemPortfolio(item);
    const loaded = portfolioCache.get(portfolio);
    const map = loaded ? new Map(loaded.points.map((point) => [point.timestamp, point.diff])) : new Map();
    const itemFrom = parseTimestamp(item.date_from);
    const itemTo = item.date_to ? parseTimestamp(item.date_to) : null;
    const weight = Number(item.weight);

    for (let i = 0; i < grid.length; i += 1) {
      const ts = grid[i];
      const active = ts >= itemFrom && (itemTo === null || ts < itemTo);
      if (!active) continue;
      const rawDiff = map.get(ts);
      if (rawDiff === undefined) {
        warnings.push({
          portfolio,
          timestamp: ts,
          display: formatTimestamp(ts),
          reason: missingPortfolios.has(portfolio) ? 'portfolio_file_missing_zero' : 'missing_diff_zero'
        });
      }
      totalDiffs[i] += (rawDiff ?? 0) * weight;
    }
  }

  return { ...calculateFromDiffs(grid, totalDiffs), warnings, step };
}

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

function calculateRsiTradingStrategy(baseResult, config) {
  const step = baseResult.step ?? HOUR_MS;
  const sourceFrom = baseResult.rows[0]?.timestamp;
  const sourceTo = baseResult.rows.at(-1)?.timestamp;
  const from = config.periodFrom ? parseTimestamp(config.periodFrom) : sourceFrom;
  const to = config.periodTo ? parseTimestamp(config.periodTo) : sourceTo;
  if (from === undefined || to === undefined) throw new Error('Сначала рассчитайте портфолио или пресет');
  if (to < from) throw new Error('Дата окончания стратегии должна быть позже даты начала');

  const source = buildRowsFromBase(baseResult.rows, from, to, step);
  const rowsForStrategy = source.rows;
  const rsiSeries = calculateRsiFromEquity(rowsForStrategy, Number(config.rsiPeriod ?? 14));
  const buyLevel = Number(config.buyLevel ?? config.lowerLevel ?? 30);
  const sellLevel = Number(config.sellLevel ?? config.upperLevel ?? 70);
  if (buyLevel >= sellLevel) throw new Error('Уровень покупки должен быть ниже уровня продажи');
  let position = 0;
  const strategyDiffs = [];
  const signals = [];

  for (let i = 0; i < rowsForStrategy.length; i += 1) {
    const sourceRow = rowsForStrategy[i];
    const rsi = rsiSeries[i]?.rsi;
    strategyDiffs.push(position ? sourceRow.diff : 0);

    let signal = '';
    let nextPosition = position;
    if (rsi !== null && rsi <= buyLevel && position === 0) {
      signal = 'buy';
      nextPosition = 1;
    } else if (rsi !== null && rsi >= sellLevel && position === 1) {
      signal = 'sell';
      nextPosition = 0;
    }
    signals.push({ signal, position, rsi, sourceDiff: sourceRow.diff, sourceAccum: sourceRow.accum });
    position = nextPosition;
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
      rsiPeriod: Number(config.rsiPeriod ?? 14),
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
  HOUR_MS,
  parseTimestamp,
  formatTimestamp,
  parseNumber,
  parsePortfolioCsv,
  parseStrategyCsv,
  inferStep,
  findGaps,
  normalizeToDiffCsv,
  readPortfolioFile,
  readStrategyFile,
  calculateFromDiffs,
  calculatePortfolio,
  calculateStrategy,
  calculatePreset,
  calculateRsiFromEquity,
  calculateRsiTradingStrategy,
  validatePresetItems,
  formatNumber
};
