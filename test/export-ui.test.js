const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');

test('CSV export popup exists with source selector and column toggles', () => {
  assert.match(html, /id="openCsvExport"[^>]*>Экспорт CSV/);
  assert.match(html, /id="csvExportPopup"/);
  assert.match(html, /id="csvExportSource"/);
  assert.match(html, /value="portfolio"/);
  assert.match(html, /value="base_result"/);
  assert.match(html, /value="strategy_result"/);

  for (const column of ['timestamp', 'diff', 'accum', 'hwm', 'dd', 'mdd']) {
    assert.match(html, new RegExp(`data-export-column="${column}"`));
  }
});

test('CSV export date column is always enabled in selected columns', () => {
  assert.match(html, /data-export-column="timestamp" checked disabled/);
  assert.match(app, /function selectedExportColumns\(\)/);
  assert.match(app, /column === 'timestamp'/);
});

test('client CSV export builds selected columns without fixed export formats', () => {
  assert.match(app, /const EXPORT_COLUMNS = \['timestamp', 'diff', 'accum', 'hwm', 'dd', 'mdd'\]/);
  assert.match(app, /selectedExportColumns\(\)/);
  assert.match(app, /columns\.join\(','\)/);
  assert.doesNotMatch(app, /exportFormat/);
  assert.doesNotMatch(html, /exportFormat/);
});

test('server CSV export uses columns query and not fixed format presets', () => {
  assert.match(server, /parseCsvExportColumns/);
  assert.match(server, /url\.searchParams\.get\('columns'\)/);
  assert.match(server, /\/api\/portfolios\//);
  assert.doesNotMatch(server, /exportFormat/);
  assert.doesNotMatch(server, /searchParams\.get\('format'\)/);
});

test('strategy calculation requires a current base result and explains disabled state', () => {
  assert.match(app, /function strategyReadinessMessage\(\)/);
  assert.match(app, /Сначала выполните расчет в блоке “3\. Расчет”/);
  assert.match(app, /Расчет в блоке “3\. Расчет” изменился/);
  assert.match(app, /button\.disabled = !ready/);
  assert.match(app, /button\.title = message/);
  assert.match(app, /showStrategyMessage\(message, 'strategy-readiness'\)/);
});

test('strategy calculation button shows animated loading text while running', () => {
  assert.match(app, /function withLoadingButton\(/);
  assert.match(app, /Рассчитывается/);
  assert.match(app, /setInterval/);
  assert.match(app, /'\.'\.repeat\(dots\)/);
  assert.match(app, /clearInterval\(timer\)/);
  assert.match(app, /button\.disabled = originalDisabled/);
});


test('main calculation button uses the shared loading text', () => {
  assert.match(app, /withLoadingButton\(\$\('#calculate'\), 'Рассчитывается', calculate\)/);
});

test('CSV export card is rendered after strategy result card without a fixed number in the heading', () => {
  assert.match(html, /<h2>Экспорт CSV<\/h2>/);
  assert.doesNotMatch(html, /<h2>7\. Экспорт CSV<\/h2>/);

  const strategyIndex = html.indexOf('id="strategyResultCard"');
  const exportIndex = html.indexOf('id="exportCard"');
  assert.ok(strategyIndex >= 0);
  assert.ok(exportIndex > strategyIndex);
});
