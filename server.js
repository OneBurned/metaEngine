const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  HOUR_MS,
  parseTimestamp,
  formatTimestamp,
  normalizeToDiffCsv,
  readPortfolioFile,
  findGaps,
  calculatePortfolio,
  calculatePreset,
  validatePresetItems,
  formatNumber
} = require('./lib/calculations');
const { optimizeRsiStrategy } = require('./lib/optimizer');
const tradingStrategies = require('./strategies');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const PORTFOLIOS_DIR = path.join(SAMPLES_DIR, 'portfolios');
const TRADING_STRATEGIES_DIR = path.join(SAMPLES_DIR, 'strategies');
const PRESETS_DIR = path.join(SAMPLES_DIR, 'presets');
const RUNS_DIR = path.join(SAMPLES_DIR, 'runs');
const PORT = Number(process.env.PORT || 5173);

for (const dir of [PORTFOLIOS_DIR, TRADING_STRATEGIES_DIR, PRESETS_DIR, RUNS_DIR]) fs.mkdirSync(dir, { recursive: true });

const CSV_EXPORT_COLUMNS = ['timestamp', 'diff', 'accum', 'hwm', 'dd', 'mdd'];

function parseCsvExportColumns(value) {
  const requested = String(value || 'timestamp,diff,accum,hwm,dd,mdd')
    .split(',')
    .map((column) => column.trim().toLowerCase())
    .filter(Boolean);
  const columns = [...new Set(['timestamp', ...requested])];
  const unknown = columns.filter((column) => !CSV_EXPORT_COLUMNS.includes(column));
  if (unknown.length) throw new Error(`Неизвестные колонки CSV: ${unknown.join(', ')}`);
  return columns;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function portfolioRowsToCsv(rows, columns) {
  const lines = rows.map((row) => columns.map((column) => {
    if (column === 'timestamp') return csvCell(row.timestamp);
    return csvCell(formatNumber(row[column]));
  }).join(','));
  return `${columns.join(',')}\n${lines.join('\n')}\n`;
}

function exportPortfolioCsv(file, columns) {
  const safeFile = safeName(file, '.csv');
  const fullPath = path.join(PORTFOLIOS_DIR, safeFile);
  if (!fs.existsSync(fullPath)) throw new Error('Портфолио не найдено');
  const loaded = readPortfolioFile(fullPath);
  const first = loaded.points[0]?.timestamp;
  const last = loaded.points.at(-1)?.timestamp;
  if (first === undefined || last === undefined) throw new Error('Портфолио пустое');
  const result = calculatePortfolio(fullPath, first, last);
  return portfolioRowsToCsv(result.rows, columns);
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers
  });
  res.end(payload);
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body), { 'content-type': 'application/json; charset=utf-8' });
}

function error(res, status, message) {
  json(res, status, { error: message });
}

function safeName(name, ext) {
  const raw = String(name || '').trim();
  if (!raw) throw new Error('Пустое имя');
  const cleaned = raw.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('Некорректное имя');
  return `${cleaned}${ext}`;
}

function uniqueFileName(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let counter = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base}_${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) throw new Error('Не найден multipart boundary');
  const raw = buffer.toString('binary');
  const parts = raw.split(`--${boundary}`).slice(1, -1);
  const result = {};
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const [rawHeaders, ...bodyParts] = trimmed.split('\r\n\r\n');
    const body = bodyParts.join('\r\n\r\n');
    const disposition = rawHeaders.match(/content-disposition:[^\r\n]+/i)?.[0] ?? '';
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;
    result[name] = { filename, value: Buffer.from(body, 'binary').toString('utf8') };
  }
  return result;
}

function formatStep(step) {
  if (step === 5 * 60 * 1000) return '5 минут';
  if (step === HOUR_MS) return '1 час';
  if (step === 24 * HOUR_MS) return '1 день';
  return `${Math.round(step / 60000)} минут`;
}

function listPortfolios() {
  return fs.readdirSync(PORTFOLIOS_DIR)
    .filter((file) => file.endsWith('.csv'))
    .sort()
    .map((file) => {
      const fullPath = path.join(PORTFOLIOS_DIR, file);
      const { points, step } = readPortfolioFile(fullPath);
      const gaps = findGaps(points, step);
      return {
        file,
        points: points.length,
        start: points[0] ? formatTimestamp(points[0].timestamp) : null,
        end: points.at(-1) ? formatTimestamp(points.at(-1).timestamp) : null,
        step,
        stepLabel: formatStep(step),
        gaps: gaps.length
      };
    });
}

function listPresets() {
  return fs.readdirSync(PRESETS_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, file), 'utf8')));
}

function listTradingStrategies() {
  return fs.readdirSync(TRADING_STRATEGIES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(TRADING_STRATEGIES_DIR, file), 'utf8')));
}

function presetsUsingPortfolio(portfolioFile) {
  return listPresets()
    .filter((preset) => (preset.items ?? []).some((item) => (item.portfolio ?? item.strategy) === portfolioFile))
    .map((preset) => preset.name);
}

function defaultStrategyName() {
  return `rsi_${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!fullPath.startsWith(PUBLIC_DIR)) return error(res, 403, 'Запрещено');
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return error(res, 404, 'Не найдено');
  const ext = path.extname(fullPath);
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(fullPath).pipe(res);
}

function portfolioLastTimestamp(file) {
  const loaded = readPortfolioFile(path.join(PORTFOLIOS_DIR, file));
  return loaded.points.at(-1)?.timestamp;
}

function presetLastTimestamp(preset) {
  const ends = (preset.items ?? [])
    .map((item) => item.portfolio ?? item.strategy)
    .filter(Boolean)
    .map((file) => {
      const safeFile = safeName(file, '.csv');
      const fullPath = path.join(PORTFOLIOS_DIR, safeFile);
      if (!fs.existsSync(fullPath)) return null;
      return readPortfolioFile(fullPath).points.at(-1)?.timestamp ?? null;
    })
    .filter((value) => value !== null && value !== undefined);
  return ends.length ? Math.max(...ends) : null;
}

async function calculateTarget(body) {
  const from = parseTimestamp(body.periodFrom);
  let to = body.periodUntilEnd ? null : parseTimestamp(body.periodTo);
  if (body.targetType === 'portfolio') {
    const file = safeName(body.targetName, '.csv');
    if (to === null) to = portfolioLastTimestamp(file);
    if (to === null || to === undefined) throw new Error('Не удалось определить дату окончания портфолио');
    if (to < from) throw new Error('Дата окончания расчета должна быть позже даты начала');
    return calculatePortfolio(path.join(PORTFOLIOS_DIR, file), from, to);
  }
  if (body.targetType === 'preset') {
    const file = safeName(body.targetName, '.json');
    const preset = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, file), 'utf8'));
    if (to === null) to = presetLastTimestamp(preset);
    if (to === null || to === undefined) throw new Error('Не удалось определить дату окончания пресета');
    if (to < from) throw new Error('Дата окончания расчета должна быть позже даты начала');
    return calculatePreset(preset, PORTFOLIOS_DIR, from, to);
  }
  throw new Error('Выберите портфолио или пресет');
}

function normalizeTradingStrategy(body) {
  const name = safeName(body.name || defaultStrategyName(), '.json').replace(/\.json$/i, '');
  const strategy = {
    name,
    type: 'rsi',
    created_at: body.created_at || new Date().toISOString(),
    rsiPeriod: Number(body.rsiPeriod ?? 14),
    upperLevel: Number(body.upperLevel ?? 70),
    lowerLevel: Number(body.lowerLevel ?? 30),
    baseline: Number(body.baseline ?? 50),
    buyLevel: Number(body.buyLevel ?? 30),
    sellLevel: Number(body.sellLevel ?? 70),
    periodFrom: body.periodFrom,
    periodTo: body.periodTo
  };
  return strategy;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/portfolios') return json(res, 200, { portfolios: listPortfolios() });

    if (req.method === 'GET' && url.pathname.startsWith('/api/portfolios/') && url.pathname.endsWith('/export')) {
      const encoded = url.pathname.slice('/api/portfolios/'.length, -'/export'.length);
      const file = decodeURIComponent(encoded);
      const columns = parseCsvExportColumns(url.searchParams.get('columns'));
      const csv = exportPortfolioCsv(file, columns);
      return send(res, 200, csv, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="portfolio_${columns.join('_')}.csv"`
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/portfolios') {
      const parts = parseMultipart(await readBody(req), req.headers['content-type'] || '');
      const file = parts.file;
      const valueType = parts.valueType?.value;
      const desiredName = parts.name?.value || file?.filename || `portfolio_${Date.now()}`;
      if (!file?.value) throw new Error('CSV-файл пустой или не выбран');
      const requestedFilename = safeName(desiredName, '.csv');
      const filename = uniqueFileName(PORTFOLIOS_DIR, requestedFilename);
      const normalized = normalizeToDiffCsv(file.value, valueType);
      fs.writeFileSync(path.join(PORTFOLIOS_DIR, filename), normalized.csv, 'utf8');
      return json(res, 200, {
        file: filename,
        requestedFile: requestedFilename,
        renamed: filename !== requestedFilename,
        points: normalized.points.length,
        step: normalized.step,
        stepLabel: formatStep(normalized.step),
        gaps: normalized.gaps.map(formatTimestamp)
      });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/portfolios/')) {
      const file = safeName(decodeURIComponent(url.pathname.split('/').pop()), '.csv');
      const fullPath = path.join(PORTFOLIOS_DIR, file);
      if (!fs.existsSync(fullPath)) return error(res, 404, 'Портфолио не найдено');
      const usedBy = presetsUsingPortfolio(file);
      fs.unlinkSync(fullPath);
      return json(res, 200, { deleted: file, usedBy });
    }

    if (req.method === 'GET' && url.pathname === '/api/presets') return json(res, 200, { presets: listPresets() });

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/presets/')) {
      const file = safeName(decodeURIComponent(url.pathname.split('/').pop()), '.json');
      const fullPath = path.join(PRESETS_DIR, file);
      if (!fs.existsSync(fullPath)) return error(res, 404, 'Пресет не найден');
      fs.unlinkSync(fullPath);
      return json(res, 200, { deleted: file.replace(/\.json$/i, '') });
    }

    if (req.method === 'POST' && url.pathname === '/api/presets') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const filename = safeName(body.name, '.json');
      const fullPath = path.join(PRESETS_DIR, filename);
      if (fs.existsSync(fullPath) && !body.overwrite) return json(res, 409, { exists: true, message: 'Такой пресет уже существует' });
      const items = (body.items ?? []).map((item) => ({
        portfolio: safeName(item.portfolio ?? item.strategy, '.csv'),
        weight: Number(item.weightPercent) / 100,
        weightPercent: Number(item.weightPercent),
        date_from: item.date_from,
        date_to: item.untilEnd ? null : item.date_to
      }));
      validatePresetItems(items);
      const preset = { name: filename.replace(/\.json$/i, ''), created_at: new Date().toISOString(), items };
      fs.writeFileSync(fullPath, JSON.stringify(preset, null, 2), 'utf8');
      return json(res, 200, { preset });
    }

    if (req.method === 'GET' && url.pathname === '/api/strategies') return json(res, 200, { strategies: listTradingStrategies() });

    if (req.method === 'POST' && url.pathname === '/api/strategies/calculate') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const baseResult = await calculateTarget(body);
      const strategy = normalizeTradingStrategy(body.strategy ?? body);
      const result = tradingStrategies.calculateTradingStrategy(baseResult, strategy);
      return json(res, 200, { baseResult, strategyResult: result, strategy });
    }

    if (req.method === 'POST' && url.pathname === '/api/strategies/optimize') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const baseResult = await calculateTarget(body);
      const strategy = normalizeTradingStrategy(body.strategy ?? body);
      const optimization = optimizeRsiStrategy(
        baseResult,
        strategy,
        body.ranges,
        tradingStrategies.calculateTradingStrategy,
        { maxRuns: body.maxRuns, maxResults: body.maxResults }
      );
      const runId = crypto.randomUUID();
      const payload = { runId, baseResult, strategy, optimization };
      fs.writeFileSync(path.join(RUNS_DIR, `${runId}.optimizer.json`), JSON.stringify(payload, null, 2), 'utf8');
      return json(res, 200, payload);
    }

    if (req.method === 'POST' && url.pathname === '/api/strategies') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const strategy = normalizeTradingStrategy(body);
      const filename = safeName(strategy.name, '.json');
      const fullPath = path.join(TRADING_STRATEGIES_DIR, filename);
      if (fs.existsSync(fullPath) && !body.overwrite) return json(res, 409, { exists: true, message: 'Такая стратегия уже существует' });
      fs.writeFileSync(fullPath, JSON.stringify(strategy, null, 2), 'utf8');
      return json(res, 200, { strategy });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/strategies/')) {
      const file = safeName(decodeURIComponent(url.pathname.split('/').pop()), '.json');
      const fullPath = path.join(TRADING_STRATEGIES_DIR, file);
      if (!fs.existsSync(fullPath)) return error(res, 404, 'Стратегия не найдена');
      fs.unlinkSync(fullPath);
      return json(res, 200, { deleted: file.replace(/\.json$/i, '') });
    }

    if (req.method === 'POST' && url.pathname === '/api/calculate') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const result = await calculateTarget(body);
      const runId = crypto.randomUUID();
      const payload = { runId, targetType: body.targetType, targetName: body.targetName, periodFrom: body.periodFrom, periodTo: body.periodTo, ...result };
      fs.writeFileSync(path.join(RUNS_DIR, `${runId}.json`), JSON.stringify(payload, null, 2), 'utf8');
      return json(res, 200, payload);
    }

    return error(res, 404, 'API endpoint не найден');
  } catch (err) {
    return error(res, 400, err.message);
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`MetaEngine local lab: http://localhost:${PORT}`);
});
