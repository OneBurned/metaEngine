let portfolios = [];
let presets = [];
let tradingStrategies = [];
let lastResult = null;
let pendingResult = null;
let lastStrategyResult = null;
let lastStrategyConfig = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function fmtPct(value) {
  return `${(Number(value) * 100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function normalizeDateInput(value) {
  const normalized = String(value || '').replace('T', ' ').trim();
  if (!normalized) return '';
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2} \d{2})(?::\d{2})?$/);
  return match ? `${match[1]}:00` : normalized;
}

function toDateInput(value) {
  const normalized = normalizeDateInput(value);
  return normalized.replace(' ', 'T').slice(0, 16);
}

function zeroMinutes(value) {
  const normalized = String(value || '');
  if (!normalized) return '';
  return `${normalized.slice(0, 13)}:00`;
}

function forceZeroMinutes(input) {
  if (input.value) input.value = zeroMinutes(input.value);
}

function defaultStrategyName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `rsi_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || 'Ошибка запроса');
  return body;
}

async function refreshAll() {
  const [portfolioData, presetData, strategyData] = await Promise.all([api('/api/portfolios'), api('/api/presets'), api('/api/strategies')]);
  portfolios = portfolioData.portfolios;
  presets = presetData.presets;
  tradingStrategies = strategyData.strategies;
  renderPortfolios();
  renderPresets();
  renderTradingStrategies();
  renderPresetRowsOptions();
  renderTargetOptions();
}

function renderPortfolios() {
  const el = $('#portfolios');
  if (!portfolios.length) {
    el.innerHTML = '<p class="hint">Пока портфолио нет.</p>';
    return;
  }
  el.innerHTML = `<table><thead><tr><th>Портфолио</th><th>Точки</th><th>Период</th><th>Шаг</th><th>Пропуски</th><th></th></tr></thead><tbody>${portfolios.map((p) => `
    <tr>
      <td><strong>${p.file}</strong></td>
      <td>${p.points}</td>
      <td>${p.start || '-'} — ${p.end || '-'}</td>
      <td>${p.stepLabel}</td>
      <td>${p.gaps ? `<span class="badge">${p.gaps}</span>` : 'нет'}</td>
      <td><button class="danger" data-delete-portfolio="${p.file}">Удалить</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function renderPresets() {
  const el = $('#presets');
  if (!presets.length) {
    el.innerHTML = '<p class="hint">Пока пресетов нет.</p>';
    return;
  }
  el.innerHTML = `<table><thead><tr><th>Пресет</th><th>Строки</th><th>Состав</th><th></th></tr></thead><tbody>${presets.map((p) => `
    <tr>
      <td><strong>${p.name}</strong></td>
      <td>${p.items?.length ?? 0}</td>
      <td>${(p.items ?? []).map((i) => `${i.portfolio ?? i.strategy}: ${i.weightPercent}% (${i.date_from} → ${i.date_to ?? 'до конца'})`).join('<br>')}</td>
      <td><button class="danger" data-delete-preset="${p.name}">Удалить</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function renderTradingStrategies() {
  const el = $('#tradingStrategies');
  if (!tradingStrategies.length) {
    el.innerHTML = '<p class="hint">Сохраненных торговых стратегий пока нет.</p>';
    return;
  }
  el.innerHTML = `<table><thead><tr><th>Стратегия</th><th>Тип</th><th>Параметры</th><th></th></tr></thead><tbody>${tradingStrategies.map((s) => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.type}</td>
      <td>RSI ${s.rsiPeriod}, buy ${s.buyLevel}, sell ${s.sellLevel}</td>
      <td><button class="danger" data-delete-trading-strategy="${s.name}">Удалить</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function portfolioOptions(selected = '') {
  return portfolios.map((p) => `<option value="${p.file}" ${p.file === selected ? 'selected' : ''}>${p.file}</option>`).join('');
}

function renderPresetRowsOptions() {
  $$('.row-portfolio').forEach((select) => {
    const current = select.value;
    select.innerHTML = portfolioOptions(current);
  });
}

function renderTargetOptions() {
  const type = $('#targetType').value;
  const items = type === 'portfolio' ? portfolios.map((p) => p.file) : presets.map((p) => p.name);
  $('#targetName').innerHTML = items.map((name) => `<option value="${name}">${name}</option>`).join('');
}

function addPresetRow() {
  const template = $('#presetRowTemplate').content.cloneNode(true);
  const row = template.querySelector('.preset-row');
  row.querySelector('.row-portfolio').innerHTML = portfolioOptions();
  row.querySelector('.row-until-end').addEventListener('change', (event) => {
    row.querySelector('.row-to').disabled = event.target.checked;
    if (event.target.checked) row.querySelector('.row-to').value = '';
  });
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  $('#presetRows').appendChild(template);
}

async function uploadPortfolio(event) {
  event.preventDefault();
  const file = $('#portfolioFile').files[0];
  if (!file) return alert('Выберите CSV-файл');
  const form = new FormData();
  form.append('file', file);
  form.append('name', $('#portfolioName').value || file.name.replace(/\.csv$/i, ''));
  form.append('valueType', $('#valueType').value);
  const result = await api('/api/portfolios', { method: 'POST', body: form });
  const gapText = result.gaps?.length ? `\nНайдены пропуски: ${result.gaps.length}` : '';
  const renameText = result.renamed ? `\nИмя уже было занято, поэтому сохранено как: ${result.file}` : '';
  alert(`Портфолио сохранено: ${result.file}${renameText}\nШаг определен: ${result.stepLabel}${gapText}`);
  event.target.reset();
  await refreshAll();
}

async function deletePortfolio(file) {
  const usedBy = presets.filter((p) => (p.items ?? []).some((i) => (i.portfolio ?? i.strategy) === file)).map((p) => p.name);
  let message = `Удалить портфолио ${file}?`;
  if (usedBy.length) message += `\n\nОно используется в пресетах:\n- ${usedBy.join('\n- ')}\n\nПресеты НЕ будут удалены. В расчетах по этому портфолио будут нули, пока ты не загрузишь портфолио с таким же именем снова.`;
  if (!confirm(message)) return;
  await api(`/api/portfolios/${encodeURIComponent(file)}`, { method: 'DELETE' });
  await refreshAll();
}

async function deletePreset(name) {
  if (!confirm(`Удалить пресет ${name}?\n\nПортфолио при этом НЕ удаляются.`)) return;
  await api(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
  await refreshAll();
}

async function deleteTradingStrategy(name) {
  if (!confirm(`Удалить торговую стратегию ${name}?`)) return;
  await api(`/api/strategies/${encodeURIComponent(name)}`, { method: 'DELETE' });
  await refreshAll();
}

async function savePreset(overwrite = false) {
  const rows = $$('#presetRows .preset-row');
  const body = {
    name: $('#presetName').value,
    overwrite,
    items: rows.map((row) => ({
      portfolio: row.querySelector('.row-portfolio').value,
      weightPercent: row.querySelector('.row-weight').value,
      date_from: normalizeDateInput(row.querySelector('.row-from').value),
      date_to: normalizeDateInput(row.querySelector('.row-to').value),
      untilEnd: row.querySelector('.row-until-end').checked
    }))
  };
  if (!body.name) return alert('Введите название пресета');
  if (!body.items.length) return alert('Добавьте хотя бы одну строку пресета');
  try {
    await api('/api/presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    alert('Пресет сохранен');
    await refreshAll();
  } catch (err) {
    if (String(err.message).includes('существует') && confirm('Такой пресет уже существует. Перезаписать?')) {
      return savePreset(true);
    }
    alert(err.message);
  }
}

function baseCalculationBody() {
  return {
    targetType: $('#targetType').value,
    targetName: $('#targetName').value,
    periodFrom: normalizeDateInput($('#periodFrom').value),
    periodTo: normalizeDateInput($('#periodTo').value),
    periodUntilEnd: $('#periodUntilEnd').checked
  };
}

async function calculate() {
  const body = baseCalculationBody();
  if (!body.targetName) return alert('Выберите портфолио или пресет');
  const result = await api('/api/calculate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  lastStrategyResult = null;
  $('#strategyResultCard').classList.add('hidden');
  $('#strategyOverlayToggle').classList.add('hidden');
  $('#rsiPanel').classList.add('hidden');
  if (result.warnings?.length) {
    pendingResult = result;
    showWarning(result);
  } else {
    showResult(result);
  }
  syncStrategyPeriodToCalculation();
}

function showWarning(result) {
  const box = $('#warningBox');
  box.classList.remove('hidden');
  const sample = result.warnings.slice(0, 15).map((w) => `${w.portfolio ? `${w.portfolio}: ` : ''}${w.display}`).join('\n');
  box.innerHTML = `Шаг определен как ${stepLabel(result.step)}, но найдены пропуски: ${result.warnings.length}.\n\n<button id="continueCalc">Продолжить расчет</button> <button id="showGaps" class="secondary">Показать пропуски</button> <button id="cancelCalc" class="danger">Отменить</button><pre class="hidden" id="gapLog">${sample}${result.warnings.length > 15 ? '\n...' : ''}</pre>`;
  $('#continueCalc').onclick = () => { box.classList.add('hidden'); showResult(pendingResult); };
  $('#showGaps').onclick = () => $('#gapLog').classList.toggle('hidden');
  $('#cancelCalc').onclick = () => { pendingResult = null; box.classList.add('hidden'); };
}

function showStrategyWarnings(warnings) {
  const box = $('#strategyWarningBox');
  if (!warnings?.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  const sample = warnings.slice(0, 15).map((w) => w.display).join('\n');
  box.textContent = `Период стратегии выходит за данные расчета или содержит пропуски. Заполнено по правилу отсутствующих данных: ${warnings.length}.\n${sample}${warnings.length > 15 ? '\n...' : ''}`;
}

function stepLabel(step) {
  if (step === 300000) return '5 минут';
  if (step === 3600000) return '1 час';
  if (step === 86400000) return '1 день';
  return `${Math.round(step / 60000)} минут`;
}

function showResult(result) {
  lastResult = result;
  $('#resultCard').classList.remove('hidden');
  $('#summary').innerHTML = `<table><tbody>
    <tr><th>Начало</th><td>${result.summary.start}</td></tr>
    <tr><th>Конец</th><td>${result.summary.end}</td></tr>
    <tr><th>Точек</th><td>${result.summary.points}</td></tr>
    <tr><th>Accum</th><td>${fmtPct(result.summary.finalAccum)}</td></tr>
    <tr><th>HWM</th><td>${fmtPct(result.summary.hwm)}</td></tr>
    <tr><th>MDD</th><td>${fmtPct(result.summary.maxDrawdown)}</td></tr>
  </tbody></table>`;
  renderChart();
  renderRsiChart();
  renderResultTable(result.rows);
}

function renderResultTable(rows) {
  $('#resultTable').innerHTML = `<thead><tr><th>Дата</th><th>Diff</th><th>Accum</th><th>HWM</th><th>DD</th><th>MDD</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${r.time}</td><td>${fmtPct(r.diff)}</td><td>${fmtPct(r.accum)}</td><td>${fmtPct(r.hwm)}</td><td>${fmtPct(r.dd)}</td><td>${fmtPct(r.mdd)}</td></tr>`).join('')}</tbody>`;
}

function renderLineChart(svg, rows, keys, colors, labelAccessor = (key) => key) {
  if (!rows?.length) return;
  const width = 900, height = 360, pad = 42;
  const values = rows.flatMap((row) => keys.map((key) => row[key])).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i) => pad + (i / Math.max(rows.length - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const zeroY = y(0);
  const lines = keys.map((key) => {
    const points = rows.map((row, i) => `${x(i).toFixed(2)},${y(row[key] ?? 0).toFixed(2)}`).join(' ');
    return `<polyline fill="none" stroke="${colors[key]}" stroke-width="2" points="${points}"/><text x="${width - pad + 4}" y="${y(rows.at(-1)[key] ?? 0).toFixed(2)}" fill="${colors[key]}" font-size="12">${labelAccessor(key)}</text>`;
  }).join('');
  svg.innerHTML = `<line x1="${pad}" x2="${width - pad}" y1="${zeroY}" y2="${zeroY}" stroke="#cfd6e3"/><text x="8" y="${pad}" font-size="12">${fmtPct(max)}</text><text x="8" y="${height - pad}" font-size="12">${fmtPct(min)}</text>${lines}`;
}

function renderChart() {
  const svg = $('#chart');
  if (!lastResult?.rows?.length) return;
  const active = new Set($$('.toggles input:checked').map((input) => input.dataset.line).filter(Boolean));
  const keys = ['diff', 'accum', 'hwm', 'dd', 'mdd'].filter((key) => active.has(key));
  const colors = { diff: '#7c8a9b', accum: '#315efb', hwm: '#16a56f', dd: '#e28a00', mdd: '#cf3341' };
  renderLineChart(svg, lastResult.rows, keys, colors);
}

function renderRsiChart() {
  const overlayEnabled = $('[data-strategy-overlay]')?.checked;
  if (!lastStrategyResult?.rsi?.length || !overlayEnabled) {
    $('#rsiPanel').classList.add('hidden');
    return;
  }
  $('#rsiPanel').classList.remove('hidden');
  const svg = $('#rsiChart');
  const width = 900, height = 220, pad = 36;
  const rows = lastStrategyResult.rsi;
  const cfg = lastStrategyResult.config;
  const x = (i) => pad + (i / Math.max(rows.length - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - (v / 100) * (height - pad * 2);
  const rsiPoints = rows.map((row, i) => row.rsi === null ? null : `${x(i).toFixed(2)},${y(row.rsi).toFixed(2)}`).filter(Boolean).join(' ');
  const levelLine = (value, color, label) => `<line x1="${pad}" x2="${width - pad}" y1="${y(value)}" y2="${y(value)}" stroke="${color}" stroke-dasharray="6 5"/><text x="8" y="${y(value) + 4}" font-size="12" fill="${color}">${label}</text>`;
  svg.innerHTML = `${levelLine(cfg.upperLevel, '#cf3341', cfg.upperLevel)}${levelLine(cfg.baseline, '#687386', cfg.baseline)}${levelLine(cfg.lowerLevel, '#16a56f', cfg.lowerLevel)}<polyline fill="none" stroke="#8e44ad" stroke-width="2" points="${rsiPoints}"/>`;
}

function collectStrategyBody() {
  return {
    name: $('#tradingStrategyName').value || defaultStrategyName(),
    type: $('#tradingStrategyType').value,
    rsiPeriod: $('#rsiPeriod').value,
    upperLevel: $('#rsiUpper').value,
    lowerLevel: $('#rsiLower').value,
    baseline: $('#rsiBaseline').value,
    buyLevel: $('#buyLevel').value,
    sellLevel: $('#sellLevel').value,
    periodFrom: normalizeDateInput($('#strategyPeriodFrom').value),
    periodTo: normalizeDateInput($('#strategyPeriodTo').value)
  };
}


function validateStrategyLevels(strategy) {
  if (Number(strategy.buyLevel) >= Number(strategy.sellLevel)) {
    throw new Error('Уровень покупки должен быть ниже уровня продажи');
  }
}

async function saveTradingStrategy(overwrite = false) {
  const body = { ...collectStrategyBody(), overwrite };
  if (!body.name) return alert('Введите название стратегии');
  try {
    validateStrategyLevels(body);
    await api('/api/strategies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    alert('Стратегия сохранена');
    await refreshAll();
  } catch (err) {
    if (String(err.message).includes('существует') && confirm('Такая стратегия уже существует. Перезаписать?')) {
      return saveTradingStrategy(true);
    }
    alert(err.message);
  }
}

async function calculateTradingStrategy() {
  const base = baseCalculationBody();
  if (!base.targetName) return alert('Сначала выберите портфолио или пресет в блоке расчета');
  const strategy = collectStrategyBody();
  validateStrategyLevels(strategy);
  lastStrategyConfig = strategy;
  const result = await api('/api/strategies/calculate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...base, strategy })
  });
  lastResult = result.baseResult;
  lastStrategyResult = result.strategyResult;
  showResult(result.baseResult);
  showStrategyResult(result.strategyResult, result.strategy.name);
  showStrategyWarnings(result.strategyResult.warnings);
}

function showStrategyResult(result, name) {
  $('#strategyResultCard').classList.remove('hidden');
  $('#strategyOverlayToggle').classList.remove('hidden');
  $('#strategyOverlayName').textContent = name || 'RSI';
  $('#strategySummary').innerHTML = `<table><tbody>
    <tr><th>Начало</th><td>${result.summary.start}</td></tr>
    <tr><th>Конец</th><td>${result.summary.end}</td></tr>
    <tr><th>Точек</th><td>${result.summary.points}</td></tr>
    <tr><th>Accum</th><td>${fmtPct(result.summary.finalAccum)}</td></tr>
    <tr><th>HWM</th><td>${fmtPct(result.summary.hwm)}</td></tr>
    <tr><th>MDD</th><td>${fmtPct(result.summary.maxDrawdown)}</td></tr>
    <tr><th>Покупок</th><td>${result.summary.buyCount}</td></tr>
    <tr><th>Продаж</th><td>${result.summary.sellCount}</td></tr>
  </tbody></table>`;
  renderRsiChart();
  renderStrategyChart();
  renderStrategyTable(result.rows);
}

function renderStrategyChart() {
  const svg = $('#strategyChart');
  if (!lastStrategyResult?.rows?.length) return;
  const active = new Set($$('#strategyToggles input:checked').map((input) => input.dataset.strategyLine));
  const keys = ['strategy_diff', 'strategy_accum', 'strategy_hwm', 'strategy_dd', 'strategy_mdd'].filter((key) => active.has(key));
  const colors = { strategy_diff: '#7c8a9b', strategy_accum: '#315efb', strategy_hwm: '#16a56f', strategy_dd: '#e28a00', strategy_mdd: '#cf3341' };
  renderLineChart(svg, lastStrategyResult.rows, keys, colors);
}

function renderStrategyTable(rows) {
  $('#strategyResultTable').innerHTML = `<thead><tr><th>Дата</th><th>RSI</th><th>Сигнал</th><th>Позиция</th><th>Source Diff</th><th>Diff</th><th>Accum</th><th>HWM</th><th>DD</th><th>MDD</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${r.time}</td><td>${r.rsi === null ? '-' : r.rsi.toFixed(2)}</td><td>${r.signal || '-'}</td><td>${r.position}</td><td>${fmtPct(r.source_diff)}</td><td>${fmtPct(r.strategy_diff)}</td><td>${fmtPct(r.strategy_accum)}</td><td>${fmtPct(r.strategy_hwm)}</td><td>${fmtPct(r.strategy_dd)}</td><td>${fmtPct(r.strategy_mdd)}</td></tr>`).join('')}</tbody>`;
}

function syncStrategyPeriodToCalculation() {
  if ($('#periodFrom').value && !$('#strategyPeriodFrom').value) $('#strategyPeriodFrom').value = zeroMinutes($('#periodFrom').value);
  if ($('#periodTo').value && !$('#strategyPeriodTo').value) $('#strategyPeriodTo').value = zeroMinutes($('#periodTo').value);
}

$('#uploadForm').addEventListener('submit', (event) => uploadPortfolio(event).catch((err) => alert(err.message)));
$('#portfolios').addEventListener('click', (event) => {
  const file = event.target.dataset.deletePortfolio;
  if (file) deletePortfolio(file).catch((err) => alert(err.message));
});
$('#presets').addEventListener('click', (event) => {
  const name = event.target.dataset.deletePreset;
  if (name) deletePreset(name).catch((err) => alert(err.message));
});
$('#tradingStrategies').addEventListener('click', (event) => {
  const name = event.target.dataset.deleteTradingStrategy;
  if (name) deleteTradingStrategy(name).catch((err) => alert(err.message));
});
$('#addPresetRow').addEventListener('click', addPresetRow);
$('#savePreset').addEventListener('click', () => savePreset(false));
$('#targetType').addEventListener('change', renderTargetOptions);
$('#periodUntilEnd').addEventListener('change', (event) => {
  $('#periodTo').disabled = event.target.checked;
  if (event.target.checked) $('#periodTo').value = '';
});
$('#calculate').addEventListener('click', () => calculate().catch((err) => alert(err.message)));
$('#enableStrategies').addEventListener('change', (event) => {
  $('#strategyPanel').classList.toggle('hidden', !event.target.checked);
  if (event.target.checked && !$('#tradingStrategyName').value) $('#tradingStrategyName').value = defaultStrategyName();
  if (event.target.checked) syncStrategyPeriodToCalculation();
});
$('#saveTradingStrategy').addEventListener('click', () => saveTradingStrategy(false));
$('#calculateTradingStrategy').addEventListener('click', () => calculateTradingStrategy().catch((err) => alert(err.message)));
$$('.toggles input').forEach((input) => input.addEventListener('change', () => { renderChart(); renderRsiChart(); renderStrategyChart(); }));
document.addEventListener('change', (event) => {
  if (event.target.matches('input[type="datetime-local"]')) forceZeroMinutes(event.target);
});
$('#baseToggles').addEventListener('change', () => { renderChart(); renderRsiChart(); });
$('#strategyToggles').addEventListener('change', renderStrategyChart);

addPresetRow();
$('#tradingStrategyName').value = defaultStrategyName();
refreshAll().catch((err) => alert(err.message));
