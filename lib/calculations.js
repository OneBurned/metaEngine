const fs = require('node:fs');
const path = require('node:path');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TIMEFRAMES = {
  '1m': { label: '1 минута', rank: 1, fixedMs: MINUTE_MS },
  '5m': { label: '5 минут', rank: 5, fixedMs: 5 * MINUTE_MS },
  '15m': { label: '15 минут', rank: 15, fixedMs: 15 * MINUTE_MS },
  '1h': { label: '1 час', rank: 60, fixedMs: HOUR_MS },
  '1d': { label: '1 день', rank: 1440, fixedMs: DAY_MS },
  '1M': { label: '1 месяц', rank: 44640 },
  '1Y': { label: '1 год', rank: 525600 }
};
const KNOWN_STEPS = [MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS, HOUR_MS, DAY_MS];

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

function timeframeFromStep(step) {
  const found = Object.entries(TIMEFRAMES).find(([, cfg]) => cfg.fixedMs === step);
  return found?.[0] ?? null;
}

function normalizeTimeframe(value) {
  const timeframe = String(value || '1h');
  if (!TIMEFRAMES[timeframe]) throw new Error(`Неизвестный таймфрейм: ${timeframe}`);
  return timeframe;
}

function compareTimeframes(sourceTimeframe, targetTimeframe) {
  return TIMEFRAMES[targetTimeframe].rank - TIMEFRAMES[sourceTimeframe].rank;
}

function ceilFixedBoundary(ts, size) {
  return Math.ceil(ts / size) * size;
}

function floorFixedBoundary(ts, size) {
  return Math.floor(ts / size) * size;
}

function utcMonthStart(year, month) {
  return Date.UTC(year, month, 1, 0, 0, 0, 0);
}

function ceilMonthBoundary(ts) {
  const d = new Date(ts);
  const current = utcMonthStart(d.getUTCFullYear(), d.getUTCMonth());
  return ts === current ? current : utcMonthStart(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

function floorMonthBoundary(ts) {
  const d = new Date(ts);
  return utcMonthStart(d.getUTCFullYear(), d.getUTCMonth());
}

function ceilYearBoundary(ts) {
  const d = new Date(ts);
  const current = Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
  return ts === current ? current : Date.UTC(d.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0);
}

function floorYearBoundary(ts) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
}

function nextCalendarBoundary(ts, timeframe) {
  const d = new Date(ts);
  if (timeframe === '1M') return utcMonthStart(d.getUTCFullYear(), d.getUTCMonth() + 1);
  if (timeframe === '1Y') return Date.UTC(d.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0);
  throw new Error(`Календарный таймфрейм не поддержан: ${timeframe}`);
}

function buildTimeframeBoundaries(from, to, timeframe) {
  const cfg = TIMEFRAMES[timeframe];
  if (cfg.fixedMs) return buildGrid(ceilFixedBoundary(from, cfg.fixedMs), floorFixedBoundary(to, cfg.fixedMs), cfg.fixedMs);
  const first = timeframe === '1M' ? ceilMonthBoundary(from) : ceilYearBoundary(from);
  const last = timeframe === '1M' ? floorMonthBoundary(to) : floorYearBoundary(to);
  const boundaries = [];
  for (let ts = first; ts <= last; ts = nextCalendarBoundary(ts, timeframe)) boundaries.push(ts);
  return boundaries;
}

function convertRowsToTimeframe(sourceRows, from, to, sourceStep, targetTimeframe) {
  const timeframe = normalizeTimeframe(targetTimeframe);
  const sourceTimeframe = timeframeFromStep(sourceStep);
  if (!sourceTimeframe) throw new Error('Не удалось определить исходный таймфрейм данных');
  if (compareTimeframes(sourceTimeframe, timeframe) < 0) {
    throw new Error(`Нельзя честно построить ${timeframe} из ${sourceTimeframe}: выберите ${sourceTimeframe} или более крупный таймфрейм.`);
  }
  const boundaries = buildTimeframeBoundaries(from, to, timeframe);
  if (!boundaries.length) return { ...calculateFromDiffs([], []), timeframe, sourceStep };
  const byTs = new Map(sourceRows.map((row) => [row.timestamp, row]));
  const diffs = boundaries.map((ts, index) => {
    if (index === 0) return 0;
    const previous = byTs.get(boundaries[index - 1]);
    const current = byTs.get(ts);
    return (1 + (current?.accum ?? 0)) / (1 + (previous?.accum ?? 0)) - 1;
  });
  return { ...calculateFromDiffs(boundaries, diffs), timeframe, sourceStep };
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

function calculatePortfolio(portfolioPath, periodFrom, periodTo, options = {}) {
  const { points, step } = readPortfolioFile(portfolioPath);
  const opts = typeof options === 'number' ? { forcedStep: options } : (options ?? {});
  const calcStep = opts.forcedStep ?? step ?? HOUR_MS;
  const timeframe = normalizeTimeframe(opts.timeframe ?? timeframeFromStep(calcStep) ?? '1h');
  const grid = buildGrid(periodFrom, periodTo, calcStep);
  const series = valueOnGrid(points, grid, { step: calcStep, from: periodFrom, to: periodTo });
  const base = calculateFromDiffs(grid, series.diffs);
  const converted = convertRowsToTimeframe(base.rows, periodFrom, periodTo, calcStep, timeframe);
  return { ...converted, warnings: series.warnings, step: timeframe, sourceStep: calcStep };
}

const calculateStrategy = calculatePortfolio;

function calculatePreset(preset, portfoliosDir, periodFrom, periodTo, options = {}) {
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
  const timeframe = normalizeTimeframe(options.timeframe ?? timeframeFromStep(step) ?? '1h');
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

  const base = calculateFromDiffs(grid, totalDiffs);
  const converted = convertRowsToTimeframe(base.rows, periodFrom, periodTo, step, timeframe);
  return { ...converted, warnings, step: timeframe, sourceStep: step };
}

module.exports = {
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  TIMEFRAMES,
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
  convertRowsToTimeframe,
  buildTimeframeBoundaries,
  normalizeTimeframe,
  timeframeFromStep,
  calculatePortfolio,
  calculateStrategy,
  calculatePreset,
  buildGrid,
  validatePresetItems,
  formatNumber
};
