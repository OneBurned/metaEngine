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


test('strategy dates are synced from block 3 calculation dates', () => {
  assert.match(app, /function syncStrategyPeriodIfEnabled\(\)/);
  assert.match(app, /setDatePair\(\$\('#strategyPeriodFrom'\), \$\('#periodFrom'\)\.value \|\| ''\)/);
  assert.match(app, /setDatePair\(\$\('#strategyPeriodTo'\), \$\('#periodTo'\)\.value \|\| ''\)/);
  assert.match(app, new RegExp("syncStrategyPeriodIfEnabled\\(\\);\\n\\s*updateStrategyCalculateAvailability\\(true\\)"));
});

test('disabled buttons have an explicit muted style', () => {
  const styles = fs.readFileSync('public/styles.css', 'utf8');
  assert.match(styles, /button:disabled \{ background: #aeb7c8/);
  assert.match(styles, /cursor: not-allowed/);
});


test('strategy loading does not clear its own disabled state before request starts', () => {
  assert.match(app, new RegExp("async function calculateTradingStrategy\\(\\) \\{\\n\\s*const readiness = strategyReadinessMessage\\(\\)"));
  assert.doesNotMatch(app, new RegExp("async function calculateTradingStrategy\\(\\) \\{\\n\\s*if \\(!updateStrategyCalculateAvailability\\(true\\)\\) return;"));
});

test('MDD Mean Reversion strategy UI has type option, grid controls and indicator chart', () => {
  assert.match(html, /value="mdd_mean_reversion"/);
  assert.match(html, /id="mddTakeProfit"/);
  assert.match(html, /id="mddLevels"/);
  assert.match(html, /id="mddChart"/);
  assert.match(app, /function renderMddChart\(\)/);
  assert.match(app, /collectMddLevels/);
  assert.match(app, /Local Accum/);
  assert.match(app, /formatMddSignal/);
  assert.match(app, /Вес \${fmtPct/);
  assert.match(app, /Ждем TP/);
});
