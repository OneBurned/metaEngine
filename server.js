const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  HOUR_MS,
  parseTimestamp,
  formatTimestamp,
  normalizeToDiffCsv,
  readStrategyFile,
  inferStep,
  findGaps,
  calculateStrategy,
  calculatePreset,
  validatePresetItems
} = require('./lib/calculations');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const STRATEGIES_DIR = path.join(SAMPLES_DIR, 'strategies');
const PRESETS_DIR = path.join(SAMPLES_DIR, 'presets');
const RUNS_DIR = path.join(SAMPLES_DIR, 'runs');
const PORT = Number(process.env.PORT || 5173);

for (const dir of [STRATEGIES_DIR, PRESETS_DIR, RUNS_DIR]) fs.mkdirSync(dir, { recursive: true });

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

function listStrategies() {
  return fs.readdirSync(STRATEGIES_DIR)
    .filter((file) => file.endsWith('.csv'))
    .sort()
    .map((file) => {
      const fullPath = path.join(STRATEGIES_DIR, file);
      const { points, step } = readStrategyFile(fullPath);
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

function formatStep(step) {
  if (step === 5 * 60 * 1000) return '5 минут';
  if (step === HOUR_MS) return '1 час';
  if (step === 24 * HOUR_MS) return '1 день';
  return `${Math.round(step / 60000)} минут`;
}

function presetsUsingStrategy(strategyFile) {
  return listPresets().filter((preset) => (preset.items ?? []).some((item) => item.strategy === strategyFile)).map((preset) => preset.name);
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

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/strategies') return json(res, 200, { strategies: listStrategies() });

    if (req.method === 'POST' && url.pathname === '/api/strategies') {
      const parts = parseMultipart(await readBody(req), req.headers['content-type'] || '');
      const file = parts.file;
      const valueType = parts.valueType?.value;
      const desiredName = parts.name?.value || file?.filename || `strategy_${Date.now()}`;
      if (!file?.value) throw new Error('CSV-файл пустой или не выбран');
      const requestedFilename = safeName(desiredName, '.csv');
      const filename = uniqueFileName(STRATEGIES_DIR, requestedFilename);
      const normalized = normalizeToDiffCsv(file.value, valueType);
      fs.writeFileSync(path.join(STRATEGIES_DIR, filename), normalized.csv, 'utf8');
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

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/strategies/')) {
      const file = safeName(decodeURIComponent(url.pathname.split('/').pop()), '.csv');
      const fullPath = path.join(STRATEGIES_DIR, file);
      if (!fs.existsSync(fullPath)) return error(res, 404, 'Стратегия не найдена');
      const usedBy = presetsUsingStrategy(file);
      fs.unlinkSync(fullPath);
      return json(res, 200, { deleted: file, usedBy });
    }

    if (req.method === 'GET' && url.pathname === '/api/presets') return json(res, 200, { presets: listPresets() });

    if (req.method === 'POST' && url.pathname === '/api/presets') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const filename = safeName(body.name, '.json');
      const fullPath = path.join(PRESETS_DIR, filename);
      if (fs.existsSync(fullPath) && !body.overwrite) return json(res, 409, { exists: true, message: 'Такой пресет уже существует' });
      const items = (body.items ?? []).map((item) => ({
        strategy: safeName(item.strategy, '.csv'),
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

    if (req.method === 'POST' && url.pathname === '/api/calculate') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const from = parseTimestamp(body.periodFrom);
      const to = parseTimestamp(body.periodTo);
      if (to < from) throw new Error('Дата окончания расчета должна быть позже даты начала');
      let result;
      if (body.targetType === 'strategy') {
        const file = safeName(body.targetName, '.csv');
        result = calculateStrategy(path.join(STRATEGIES_DIR, file), from, to);
      } else if (body.targetType === 'preset') {
        const file = safeName(body.targetName, '.json');
        const preset = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, file), 'utf8'));
        result = calculatePreset(preset, STRATEGIES_DIR, from, to);
      } else {
        throw new Error('Выберите стратегию или пресет');
      }
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
