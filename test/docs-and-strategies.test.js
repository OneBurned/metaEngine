const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const server = fs.readFileSync('server.js', 'utf8');
const agents = fs.readFileSync('AGENTS.md', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const projectContext = fs.readFileSync('docs/PROJECT_CONTEXT.md', 'utf8');
const strategiesDoc = fs.readFileSync('docs/STRATEGIES.md', 'utf8');
const csvExportDoc = fs.readFileSync('docs/CSV_EXPORT.md', 'utf8');

test('project documentation uses uppercase docs and module-specific files', () => {
  assert.equal(fs.existsSync('docs/PROJECT_CONTEXT.md'), true);
  assert.equal(fs.existsSync('docs/STRATEGIES.md'), true);
  assert.equal(fs.existsSync('docs/CSV_EXPORT.md'), true);
  assert.equal(fs.existsSync('docs/agent-handoff-local-lab.md'), false);
  assert.match(readme, /docs\/PROJECT_CONTEXT\.md/);
  assert.match(readme, /docs\/STRATEGIES\.md/);
  assert.match(readme, /docs\/CSV_EXPORT\.md/);
});

test('AGENTS documents the solo PR and documentation update workflow', () => {
  assert.match(agents, /один активный PR/);
  assert.match(agents, /После каждого функционального изменения/);
  assert.match(agents, /docs\/PROJECT_CONTEXT\.md/);
});

test('strategy code is separate from saved strategy configs', () => {
  assert.equal(fs.existsSync('strategies/rsi.js'), true);
  assert.equal(fs.existsSync('strategies/index.js'), true);
  assert.match(strategiesDoc, /strategies\/\s+Code modules/);
  assert.match(strategiesDoc, /samples\/strategies\/\s+User-saved JSON configs/);
  assert.match(projectContext, /docs\/STRATEGIES\.md/);
});

test('server uses strategy registry instead of importing RSI directly from calculations', () => {
  assert.match(server, /require\('\.\/strategies'\)/);
  assert.match(server, /tradingStrategies\.calculateTradingStrategy/);
  assert.doesNotMatch(server, /calculateRsiTradingStrategy/);
});

test('CSV export docs are split into a focused module document', () => {
  assert.match(csvExportDoc, /GET \/api\/portfolios\/portfolio_a\.csv\/export\?columns=timestamp,mdd/);
  assert.match(csvExportDoc, /Do not replace this with a fixed dropdown/);
});

test('AGENTS requires concrete terminal and browser check instructions after changes', () => {
  assert.match(agents, /Финальные инструкции пользователю после изменений/);
  assert.match(agents, /команды для терминала/);
  assert.match(agents, /ручных сценариев/);
});
