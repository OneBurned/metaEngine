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

test('RSI optimizer shows progress and can be stopped', () => {
  assert.match(html, /id="optimizationProgress"/);
  assert.match(html, /id="stopOptimization"/);
  assert.match(app, /pollOptimizationStatus/);
  assert.match(app, /\/api\/strategies\/optimize\/start/);
  assert.match(app, /\/api\/strategies\/optimize\/status\?jobId=/);
  assert.match(app, /\/api\/strategies\/optimize\/stop/);
  assert.match(app, /completedRuns/);
  assert.match(app, /currentParameters/);
  assert.match(app, /bestRun/);
  assert.match(server, /\/api\/strategies\/optimize\/start/);
  assert.match(server, /\/api\/strategies\/optimize\/status/);
  assert.match(server, /\/api\/strategies\/optimize\/stop/);
  assert.match(server, /stopRequested/);
  assert.match(server, /finishOptimizerJob\(job, 'stopped'\)/);
});

test('RSI optimizer supports sample-based stability results', () => {
  assert.match(html, /id="optSampleCount"/);
  assert.match(app, /sampleCount: \$\('#optSampleCount'\)\.value/);
  assert.match(app, /Семплов: \$\{job\.sampleCount/);
  assert.match(app, /Устойчивость: худший score по семплам/);
  assert.match(app, /Сцепл\. accum/);
  assert.match(app, /run\.summary\.compoundedAccum/);
  assert.match(app, /sampleHeaders/);
  assert.match(app, /run\.samples/);
  assert.match(server, /buildOptimizerSamples/);
  assert.match(server, /aggregateSampleRuns/);
  assert.match(server, /trimOptimizerRuns/);
  assert.match(server, /compoundedAccum = accums\.reduce/);
  assert.match(server, /stability_worst_sample_score/);
  assert.match(server, /completedRuns: job\.completedRuns/);
});

test('strategy result card renders its own RSI chart', () => {
  assert.match(html, /id="strategyRsiPanel"/);
  assert.match(html, /id="strategyRsiChart"/);
  assert.match(html, /RSI стратегии/);
  assert.match(app, /function renderStrategyRsiChart\(\)/);
  assert.match(app, /function strategyRsiRows\(\)/);
  assert.match(app, /renderStrategyRsiChart\(\);\n\s*renderStrategyChart\(\)/);
});

test('strategy result card compares source and strategy on one chart with shared size control', () => {
  assert.match(html, /id="strategyChartSize"/);
  assert.match(html, /Сравнение исходного ряда и результата/);
  assert.match(html, /id="strategySourceToggles"/);
  assert.doesNotMatch(html, /id="strategySourceChart"/);
  assert.match(html, /data-source-line="source_dd"/);
  assert.match(html, /data-source-line="source_mdd"/);
  assert.match(html, /Результат стратегии/);
  assert.match(app, /function enrichSourceRows\(/);
  assert.match(app, /const keys = \[\.\.\.sourceKeys, \.\.\.strategyKeys\]/);
  assert.match(app, /function applyStrategyChartSize\(\)/);
  assert.match(app, /strategy-detail-chart/);
  assert.match(app, /strategy-rsi-chart/);
});

test('line chart avoids spread min max for large histories', () => {
  assert.doesNotMatch(app, /Math\.min\(\.\.\.values/);
  assert.doesNotMatch(app, /Math\.max\(\.\.\.values/);
  assert.match(app, /for \(const row of rows\)/);
});
