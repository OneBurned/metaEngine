let portfolios = [];
let presets = [];
let tradingStrategies = [];
let lastResult = null;
let lastResultKey = null;
let pendingResult = null;
let lastStrategyResult = null;
let lastStrategyConfig = null;
let lastOptimizationResult = null;
let activeOptimizationJobId = null;
let optimizationPollTimer = null;
let optimizationSort = { key: 'score', direction: 'desc' };
let lastOptimizationFilters = null;
let strategyChartsSyncing = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const EXPORT_COLUMNS = ['timestamp', 'diff', 'accum', 'hwm', 'dd', 'mdd'];
const VALUE_TYPE_STORAGE_KEY = 'metaEngine.valueType';
const MAX_MDD_ENTRIES = 10;

function exportFileName(prefix, columns) {
  return `${prefix}_${columns.join('_')}.csv`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowValueForColumn(row, column, prefix = '') {
  if (column === 'timestamp') return row.timestamp ?? row.time ?? '';
  return row[`${prefix}${column}`] ?? row[column] ?? '';
}

function rowsToCsv(rows, columns, prefix = '') {
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((column) => csvCell(rowValueForColumn(row, column, prefix))).join(','));
  return `${header}\n${lines.join('\n')}\n`;
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function fmtPct(value) {
  return `${(Number(value) * 100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function normalizeDateInput(value) {
  const normalized = String(value || '').replace('T', ' ').trim();
  if (!normalized) return '';
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2})(?::(\d{2}))?$/);
  return match ? `${match[1]} ${match[2]}:${match[3] || '00'}` : normalized;
}

function zeroMinutes(value) {
  return normalizeDateInput(value);
}

function setDatePair(input, value) {
  if (!input) return;
  input.value = zeroMinutes(value);
}

function defaultDateParts() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, hour: pad(now.getHours()), minute: '00' };
}

function parseDateParts(value) {
  const normalized = normalizeDateInput(value);
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})$/);
  return match ? { date: match[1], hour: match[2], minute: match[3] } : defaultDateParts();
}

function forceZeroMinutes(input) {
  setDatePair(input, input.value);
}

function defaultStrategyName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const type = $('#tradingStrategyType')?.value || 'rsi';
  return `${type}_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) throw new Error(body.error || body.message || text.slice(0, 160) || `Ошибка запроса (${res.status})`);
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
      <td>${strategyParamsLabel(s)}</td>
      <td><button class="danger" data-delete-trading-strategy="${s.name}">Удалить</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function strategyParamsLabel(strategy) {
  if (strategy.type === 'mdd') {
    const count = Number(strategy.entryCount ?? 5);
    const entries = Array.from({ length: count }, (_, index) => `${strategy[`entry${index + 1}`]}@${strategy[`weight${index + 1}`]}%`);
    return `entries ${entries.join('/')}, exit ${strategy.exitLevel}, max ${strategy.maxTotalWeight}%`;
  }
  return `RSI ${strategy.rsiPeriod}, buy ${strategy.buyLevel}, sell ${strategy.sellLevel}`;
}

function portfolioOptions(selected = '') {
  return portfolios.map((p) => `<option value="${p.file}" ${p.file === selected ? 'selected' : ''}>${p.file}</option>`).join('');
}

function portfolioByName(name) {
  return portfolios.find((portfolio) => portfolio.file === name);
}

function targetRange(type, name) {
  if (type === 'portfolio') {
    const portfolio = portfolioByName(name);
    return portfolio ? { start: portfolio.start, end: portfolio.end } : null;
  }
  const preset = presets.find((item) => item.name === name);
  if (!preset) return null;
  const starts = [];
  const ends = [];
  for (const item of preset.items ?? []) {
    if (item.date_from) starts.push(item.date_from);
    if (item.date_to) {
      ends.push(item.date_to);
    } else {
      const portfolio = portfolioByName(item.portfolio ?? item.strategy);
      if (portfolio?.end) ends.push(portfolio.end);
    }
  }
  return {
    start: starts.length ? starts.sort()[0] : '',
    end: ends.length ? ends.sort().at(-1) : ''
  };
}

function applyTargetRange() {
  const range = targetRange($('#targetType').value, $('#targetName').value);
  if (!range) return;
  setDatePair($('#periodFrom'), range.start || '');
  setDatePair($('#periodTo'), range.end || '');
  $('#periodUntilEnd').checked = false;
  $('#periodTo').disabled = false;
}

function renderPresetRowsOptions() {
  $$('.row-portfolio').forEach((select) => {
    const current = select.value;
    select.innerHTML = portfolioOptions(current);
    const row = select.closest('.preset-row');
    if (row) applyPortfolioRangeToPresetRow(row);
  });
}

function renderTargetOptions() {
  const type = $('#targetType').value;
  const items = type === 'portfolio' ? portfolios.map((p) => p.file) : presets.map((p) => p.name);
  $('#targetName').innerHTML = items.map((name) => `<option value="${name}">${name}</option>`).join('');
  applyTargetRange();
}

function applyPortfolioRangeToPresetRow(row, overwrite = false) {
  const portfolio = portfolioByName(row.querySelector('.row-portfolio').value);
  if (!portfolio) return;
  const fromInput = row.querySelector('.row-from');
  const toInput = row.querySelector('.row-to');
  if (overwrite || !fromInput.value) setDatePair(fromInput, portfolio.start || '');
  if (overwrite || !toInput.value) setDatePair(toInput, portfolio.end || '');
}

function addPresetRow() {
  const template = $('#presetRowTemplate').content.cloneNode(true);
  const row = template.querySelector('.preset-row');
  row.querySelector('.row-portfolio').innerHTML = portfolioOptions();
  row.querySelector('.row-portfolio').addEventListener('change', () => applyPortfolioRangeToPresetRow(row, true));
  row.querySelector('.row-until-end').addEventListener('change', (event) => {
    const toInput = row.querySelector('.row-to');
    const toPicker = row.querySelector('.row-to-picker');
    toInput.disabled = event.target.checked;
    if (toPicker) toPicker.disabled = event.target.checked;
    if (event.target.checked) setDatePair(toInput, '');
  });
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  applyPortfolioRangeToPresetRow(row);
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
  localStorage.setItem(VALUE_TYPE_STORAGE_KEY, $('#valueType').value);
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

function calculationKey(body = baseCalculationBody()) {
  return JSON.stringify({
    targetType: body.targetType,
    targetName: body.targetName,
    periodFrom: body.periodFrom,
    periodTo: body.periodTo,
    periodUntilEnd: body.periodUntilEnd
  });
}

function strategyReadinessMessage() {
  const body = baseCalculationBody();
  if (!body.targetName) return 'Сначала выберите портфолио или пресет в блоке “3. Расчет”.';
  if (!lastResult?.rows?.length) return 'Сначала выполните расчет в блоке “3. Расчет”. Стратегия применяется к уже рассчитанному портфолио или пресету.';
  if (lastResultKey !== calculationKey(body)) return 'Расчет в блоке “3. Расчет” изменился. Пересчитайте его перед запуском стратегии.';
  return '';
}

function showStrategyMessage(message, kind = 'strategy-readiness') {
  const box = $('#strategyWarningBox');
  box.dataset.kind = kind;
  box.classList.remove('hidden');
  box.textContent = message;
}

function clearStrategyMessage(kind = '') {
  const box = $('#strategyWarningBox');
  if (kind && box.dataset.kind !== kind) return;
  box.classList.add('hidden');
  box.textContent = '';
  delete box.dataset.kind;
}

function updateStrategyTypeUi() {
  const type = $('#tradingStrategyType').value;
  const isMdd = type === 'mdd';
  $$('.strategy-rsi-field, .optimizer-rsi-field').forEach((node) => node.classList.toggle('hidden', isMdd));
  $$('.strategy-mdd-field, .optimizer-mdd-field').forEach((node) => node.classList.toggle('hidden', !isMdd));
  $('#optimizerTitle').textContent = isMdd ? 'Оптимизация MDD Mean Reversion' : 'Оптимизация RSI';
  $('#optimizeTradingStrategy').textContent = isMdd ? 'Оптимизировать MDD' : 'Оптимизировать RSI';
  $('#strategyTypeHint').textContent = isMdd
    ? 'MDD Mean Reversion добирает позицию по пяти уровням просадки и закрывает ее при восстановлении DD до уровня выхода.'
    : 'RSI считается по equity-кривой. Верхний/нижний уровни берутся из “Продать на” и “Купить на”. Сигнал применяется со следующей точки: без подглядывания в будущее.';
  if (!$('#tradingStrategyName').value || /^(rsi|mdd)_\d{8}_\d{6}$/.test($('#tradingStrategyName').value)) {
    $('#tradingStrategyName').value = defaultStrategyName();
  }
  renderMddEntryFields();
}

function mddEntryCount() {
  const value = Math.floor(Number($('#mddEntryCount')?.value ?? 5));
  return Math.min(MAX_MDD_ENTRIES, Math.max(1, Number.isFinite(value) ? value : 5));
}

function currentInputValue(id, fallback) {
  const input = $(`#${id}`);
  return input ? input.value : fallback;
}

function renderMddEntryFields() {
  const count = mddEntryCount();
  const strategyBox = $('#mddEntryFields');
  const optimizerBox = $('#optMddEntryFields');
  if (!strategyBox || !optimizerBox) return;
  const defaultWeight = (100 / count).toFixed(2).replace(/\.?0+$/, '');

  strategyBox.innerHTML = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const defaultEntry = n * 5;
    return `
      <label>Вход ${n}, DD % <input id="mddEntry${n}" type="number" value="${currentInputValue(`mddEntry${n}`, defaultEntry)}" min="0" step="0.1" /></label>
      <label>Вес ${n}, % <input id="mddWeight${n}" type="number" value="${currentInputValue(`mddWeight${n}`, defaultWeight)}" min="1" max="100" step="0.1" /></label>`;
  }).join('');

  optimizerBox.innerHTML = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const defaultFrom = index * 5;
    const defaultTo = (index + 1) * 10;
    return `
      <div class="mdd-entry-row">
        <strong>Вход ${n}</strong>
        <label>DD от <input id="optMddEntry${n}From" type="number" value="${currentInputValue(`optMddEntry${n}From`, defaultFrom)}" min="0" step="0.1" /></label>
        <label>DD до <input id="optMddEntry${n}To" type="number" value="${currentInputValue(`optMddEntry${n}To`, defaultTo)}" min="0" step="0.1" /></label>
        <label>Шаг DD <input id="optMddEntry${n}Step" type="number" value="${currentInputValue(`optMddEntry${n}Step`, 5)}" min="0.1" step="0.1" /></label>
        <label>Вес от <input id="optMddWeight${n}From" type="number" value="${currentInputValue(`optMddWeight${n}From`, defaultWeight)}" min="0" max="100" step="0.1" /></label>
        <label>Вес до <input id="optMddWeight${n}To" type="number" value="${currentInputValue(`optMddWeight${n}To`, defaultWeight)}" min="0" max="100" step="0.1" /></label>
        <label>Шаг веса <input id="optMddWeight${n}Step" type="number" value="${currentInputValue(`optMddWeight${n}Step`, 10)}" min="0.1" step="0.1" /></label>
      </div>`;
  }).join('');
  updateMddParameterModeUi();
}

function updateMddParameterModeUi() {
  const isMdd = $('#tradingStrategyType')?.value === 'mdd';
  const mode = $('#optMddParameterMode')?.value ?? 'simple';
  $$('.optimizer-mdd-simple').forEach((node) => node.classList.toggle('hidden', !isMdd || mode !== 'simple'));
  $$('.optimizer-mdd-detailed').forEach((node) => node.classList.toggle('hidden', !isMdd || mode !== 'detailed'));
}

function updateStrategyCalculateAvailability(showMessage = false) {
  const button = $('#calculateTradingStrategy');
  const optimizeButton = $('#optimizeTradingStrategy');
  if (!button) return false;
  const message = strategyReadinessMessage();
  const ready = !message;
  button.disabled = !ready;
  button.title = message;
  if (optimizeButton) {
    optimizeButton.disabled = !ready || !!activeOptimizationJobId;
    optimizeButton.title = message;
  }
  if (ready) {
    clearStrategyMessage('strategy-readiness');
  } else if (showMessage && !$('#strategyPanel').classList.contains('hidden')) {
    showStrategyMessage(message, 'strategy-readiness');
  }
  return ready;
}

function setOptimizationRunning(isRunning) {
  $('#optimizeTradingStrategy').disabled = isRunning || !updateStrategyCalculateAvailability();
  $('#stopOptimization').classList.toggle('hidden', !isRunning);
  $('#stopOptimization').disabled = false;
}

async function withLoadingButton(button, loadingText, action) {
  const originalText = button.textContent;
  const originalTitle = button.title;
  const originalDisabled = button.disabled;
  let dots = 0;
  button.disabled = true;
  button.title = loadingText;
  button.textContent = `${loadingText}.`;
  const timer = setInterval(() => {
    dots = (dots % 3) + 1;
    button.textContent = `${loadingText}${'.'.repeat(dots)}`;
  }, 450);

  try {
    return await action();
  } finally {
    clearInterval(timer);
    button.textContent = originalText;
    button.title = originalTitle;
    button.disabled = originalDisabled;
    updateStrategyCalculateAvailability();
  }
}

async function calculate() {
  const body = baseCalculationBody();
  if (!body.targetName) return alert('Выберите портфолио или пресет');
  const currentKey = calculationKey(body);
  const result = await api('/api/calculate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  result.calculationKey = currentKey;
  lastStrategyResult = null;
  lastOptimizationResult = null;
  activeOptimizationJobId = null;
  clearOptimizationPoll();
  $('#strategyResultCard').classList.add('hidden');
  $('#optimizationResultCard').classList.add('hidden');
  $('#optimizationProgress').classList.add('hidden');
  $('#stopOptimization').classList.add('hidden');
  $('#strategyOverlayToggle').classList.add('hidden');
  $('#rsiPanel').classList.add('hidden');
  $('#strategyRsiPanel').classList.add('hidden');
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
  $('#continueCalc').onclick = () => { box.classList.add('hidden'); showResult(pendingResult); updateStrategyCalculateAvailability(); };
  $('#showGaps').onclick = () => $('#gapLog').classList.toggle('hidden');
  $('#cancelCalc').onclick = () => { pendingResult = null; box.classList.add('hidden'); };
}

function showStrategyWarnings(warnings) {
  if (!warnings?.length) {
    clearStrategyMessage('strategy-warning');
    return;
  }
  const sample = warnings.slice(0, 15).map((w) => w.display).join('\n');
  showStrategyMessage(`Период стратегии выходит за данные расчета или содержит пропуски. Заполнено по правилу отсутствующих данных: ${warnings.length}.\n${sample}${warnings.length > 15 ? '\n...' : ''}`, 'strategy-warning');
}


function stepLabel(step) {
  if (step === 300000) return '5 минут';
  if (step === 3600000) return '1 час';
  if (step === 86400000) return '1 день';
  return `${Math.round(step / 60000)} минут`;
}

function showResult(result) {
  lastResult = result;
  lastResultKey = result.calculationKey ?? calculationKey();
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
  updateStrategyCalculateAvailability();
}

function renderResultTable(rows) {
  $('#resultTable').innerHTML = `<thead><tr><th>Дата</th><th>Diff</th><th>Accum</th><th>HWM</th><th>DD</th><th>MDD</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${r.time}</td><td>${fmtPct(r.diff)}</td><td>${fmtPct(r.accum)}</td><td>${fmtPct(r.hwm)}</td><td>${fmtPct(r.dd)}</td><td>${fmtPct(r.mdd)}</td></tr>`).join('')}</tbody>`;
}

function renderLineChart(svg, rows, keys, colors, labelAccessor = (key) => key) {
  if (!rows?.length) return;
  const width = 900, height = 360;
  const topPad = 28;
  const bottomPad = 28;
  const plotLeft = 12;
  const plotRight = width - 132;
  const axisX = width - 8;
  let min = 0;
  let max = 0;
  for (const row of rows) {
    for (const key of keys) {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const span = max - min || 1;
  const x = (i) => plotLeft + (i / Math.max(rows.length - 1, 1)) * (plotRight - plotLeft);
  const y = (v) => height - bottomPad - ((v - min) / span) * (height - topPad - bottomPad);
  const zeroY = y(0);
  const lines = keys.map((key) => {
    const points = rows.map((row, i) => `${x(i).toFixed(2)},${y(row[key] ?? 0).toFixed(2)}`).join(' ');
    return `<polyline fill="none" stroke="${colors[key]}" stroke-width="2" points="${points}"/><text x="${plotRight + 8}" y="${y(rows.at(-1)[key] ?? 0).toFixed(2)}" fill="${colors[key]}" font-size="12">${labelAccessor(key)}</text>`;
  }).join('');
  svg.innerHTML = `<line x1="${plotLeft}" x2="${plotRight}" y1="${zeroY}" y2="${zeroY}" stroke="#cfd6e3"/><line x1="${plotRight}" x2="${plotRight}" y1="${topPad}" y2="${height - bottomPad}" stroke="#d7deea"/><text x="${axisX}" y="${topPad}" font-size="12" text-anchor="end">${fmtPct(max)}</text><text x="${axisX}" y="${height - bottomPad}" font-size="12" text-anchor="end">${fmtPct(min)}</text>${lines}`;
}

function enrichSourceRows(rows) {
  let hwm = 0;
  let mdd = 0;
  return rows.map((row, index) => {
    const sourceAccum = Number(row.source_accum ?? 0);
    hwm = index === 0 ? sourceAccum : Math.max(hwm, sourceAccum);
    const dd = (1 + sourceAccum) / (1 + hwm) - 1;
    mdd = Math.min(mdd, dd);
    return {
      ...row,
      source_hwm: hwm,
      source_dd: dd,
      source_mdd: mdd
    };
  });
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
  renderRsiSvg($('#rsiChart'));
}

function renderStrategyRsiChart() {
  const rsiRows = strategyRsiRows();
  if (!rsiRows.length) {
    $('#strategyRsiPanel').classList.add('hidden');
    return;
  }
  $('#strategyRsiPanel').classList.remove('hidden');
  renderStrategyRsiPlot(rsiRows);
}

function strategyRsiRows() {
  if (lastStrategyResult?.rsi?.length) return lastStrategyResult.rsi;
  if (!lastStrategyResult?.rows?.length) return [];
  return lastStrategyResult.rows
    .filter((row) => row.rsi !== undefined)
    .map((row) => ({ timestamp: row.timestamp, time: row.time, rsi: row.rsi }));
}

function renderRsiSvg(svg, rows = lastStrategyResult.rsi) {
  const width = 900, height = 220;
  const topPad = 26;
  const bottomPad = 24;
  const plotLeft = 12;
  const plotRight = width - 74;
  const axisX = width - 8;
  const cfg = lastStrategyResult.config;
  const x = (i) => plotLeft + (i / Math.max(rows.length - 1, 1)) * (plotRight - plotLeft);
  const y = (v) => height - bottomPad - (v / 100) * (height - topPad - bottomPad);
  const rsiPoints = rows.map((row, i) => row.rsi === null ? null : `${x(i).toFixed(2)},${y(row.rsi).toFixed(2)}`).filter(Boolean).join(' ');
  const levelLine = (value, color, label) => `<line x1="${plotLeft}" x2="${plotRight}" y1="${y(value)}" y2="${y(value)}" stroke="${color}" stroke-dasharray="6 5"/><text x="${axisX}" y="${y(value) + 4}" font-size="12" fill="${color}" text-anchor="end">${label}</text>`;
  const baselineLine = Number.isFinite(Number(cfg.baseline)) ? levelLine(cfg.baseline, '#687386', cfg.baseline) : '';
  svg.innerHTML = `<line x1="${plotRight}" x2="${plotRight}" y1="${topPad}" y2="${height - bottomPad}" stroke="#d7deea"/>${levelLine(cfg.upperLevel, '#cf3341', cfg.upperLevel)}${baselineLine}${levelLine(cfg.lowerLevel, '#16a56f', cfg.lowerLevel)}<polyline fill="none" stroke="#8e44ad" stroke-width="2" points="${rsiPoints}"/>`;
}

function plotlyReady() {
  return window.Plotly && typeof window.Plotly.react === 'function';
}

function strategyChartHeight() {
  const size = $('#strategyChartSize')?.value || 'normal';
  return { compact: 260, normal: 360, large: 520, xlarge: 720 }[size] || 360;
}

function strategyRsiHeight() {
  const size = $('#strategyChartSize')?.value || 'normal';
  return { compact: 180, normal: 220, large: 320, xlarge: 420 }[size] || 220;
}

function plotlyStrategyLayout(height, yTitle = '') {
  return {
    height,
    margin: { l: 18, r: 72, t: 12, b: 34 },
    paper_bgcolor: '#fbfcff',
    plot_bgcolor: '#fbfcff',
    hovermode: 'x unified',
    dragmode: 'zoom',
    showlegend: true,
    legend: { orientation: 'h', x: 0, y: 1.12 },
    xaxis: {
      type: 'date',
      rangeslider: { visible: false },
      showgrid: true,
      gridcolor: '#e7ebf2',
      zeroline: false
    },
    yaxis: {
      side: 'right',
      title: yTitle,
      tickformat: '.2%',
      showgrid: true,
      gridcolor: '#e7ebf2',
      zerolinecolor: '#cfd6e3'
    }
  };
}

function plotlyStrategyConfig() {
  return {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    doubleClick: 'reset',
    modeBarButtonsToRemove: ['lasso2d', 'select2d']
  };
}

function syncStrategyChartRange(sourceId, eventData) {
  if (strategyChartsSyncing || !eventData) return;
  const reset = eventData['xaxis.autorange'];
  const from = eventData['xaxis.range[0]'];
  const to = eventData['xaxis.range[1]'];
  if (!reset && (from === undefined || to === undefined)) return;

  strategyChartsSyncing = true;
  const update = reset ? { 'xaxis.autorange': true } : { 'xaxis.range': [from, to] };
  const targets = ['strategyChart', 'strategyRsiChart'].filter((id) => id !== sourceId && $(`#${id}`)?._fullLayout);
  Promise.all(targets.map((id) => Plotly.relayout(id, update))).finally(() => {
    strategyChartsSyncing = false;
  });
}

function bindStrategyPlotlySync(id) {
  const chart = $(`#${id}`);
  if (!chart || chart.dataset.plotlySyncBound) return;
  chart.on('plotly_relayout', (eventData) => syncStrategyChartRange(id, eventData));
  chart.dataset.plotlySyncBound = '1';
}

function resetStrategyZoom() {
  if (!plotlyReady()) return;
  ['strategyChart', 'strategyRsiChart'].forEach((id) => {
    if ($(`#${id}`)?._fullLayout) Plotly.relayout(id, { 'xaxis.autorange': true });
  });
}

function collectStrategyBody() {
  const type = $('#tradingStrategyType').value;
  if (type === 'mdd') {
    const count = mddEntryCount();
    const body = {
      name: $('#tradingStrategyName').value || defaultStrategyName(),
      type,
      entryCount: count,
      maxTotalWeight: $('#mddMaxTotalWeight').value,
      exitLevel: $('#mddExitLevel').value,
      periodFrom: normalizeDateInput($('#strategyPeriodFrom').value),
      periodTo: normalizeDateInput($('#strategyPeriodTo').value)
    };
    for (let i = 1; i <= count; i += 1) {
      body[`entry${i}`] = $(`#mddEntry${i}`).value;
      body[`weight${i}`] = $(`#mddWeight${i}`).value;
    }
    return body;
  }
  const buyLevel = $('#buyLevel').value;
  const sellLevel = $('#sellLevel').value;
  return {
    name: $('#tradingStrategyName').value || defaultStrategyName(),
    type,
    rsiPeriod: $('#rsiPeriod').value,
    upperLevel: sellLevel,
    lowerLevel: buyLevel,
    buyLevel,
    sellLevel,
    periodFrom: normalizeDateInput($('#strategyPeriodFrom').value),
    periodTo: normalizeDateInput($('#strategyPeriodTo').value)
  };
}

function collectOptimizationBody() {
  const type = $('#tradingStrategyType').value;
  const count = mddEntryCount();
  const mddParameterMode = $('#optMddParameterMode')?.value ?? 'simple';
  const ranges = type === 'mdd'
    ? {
      entryCount: count,
      maxTotalWeight: $('#mddMaxTotalWeight').value,
      parameterMode: mddParameterMode,
      exitLevel: { from: $('#optMddExitFrom').value, to: $('#optMddExitTo').value, step: $('#optMddExitStep').value }
    }
    : {
      rsiPeriod: {
        from: $('#optRsiPeriodFrom').value,
        to: $('#optRsiPeriodTo').value,
        step: $('#optRsiPeriodStep').value
      },
      buyLevel: {
        from: $('#optBuyFrom').value,
        to: $('#optBuyTo').value,
        step: $('#optBuyStep').value
      },
      sellLevel: {
        from: $('#optSellFrom').value,
        to: $('#optSellTo').value,
        step: $('#optSellStep').value
      }
    };
  if (type === 'mdd' && mddParameterMode === 'simple') {
    ranges.entry = { from: $('#optMddEntryFrom').value, to: $('#optMddEntryTo').value, step: $('#optMddEntryStep').value };
    ranges.weight = { from: $('#optMddWeightFrom').value, to: $('#optMddWeightTo').value, step: $('#optMddWeightStep').value };
    ranges.minEntryDelta = $('#optMddMinEntryDelta').value;
  }
  if (type === 'mdd' && mddParameterMode === 'detailed') {
    for (let i = 1; i <= count; i += 1) {
      ranges[`entry${i}`] = { from: $(`#optMddEntry${i}From`).value, to: $(`#optMddEntry${i}To`).value, step: $(`#optMddEntry${i}Step`).value };
      ranges[`weight${i}`] = { from: $(`#optMddWeight${i}From`).value, to: $(`#optMddWeight${i}To`).value, step: $(`#optMddWeight${i}Step`).value };
    }
  }
  return {
    sampleCount: $('#optSampleCount').value,
    ranges,
    search: type === 'mdd' ? {
      mode: $('#optMddSearchMode').value,
      maxCandidates: $('#optMddMaxCandidates').value,
      seed: $('#optMddSeed').value
    } : {},
    maxResults: $('#optMaxResults').value,
    filters: {
      maxDrawdownPercent: $('#optMaxDrawdownPercent').value,
      minTrades: $('#optMinTrades').value,
      minProfitableSamples: $('#optMinProfitableSamples').value
    }
  };
}

function normalizeOptimizationFilters(filters = {}) {
  const maxDrawdownPercent = filters.maxDrawdownPercent === '' || filters.maxDrawdownPercent === null || filters.maxDrawdownPercent === undefined
    ? null
    : Math.abs(Number(filters.maxDrawdownPercent));
  const minTrades = filters.minTrades === '' || filters.minTrades === null || filters.minTrades === undefined
    ? 0
    : Math.max(0, Math.floor(Number(filters.minTrades)));
  const minProfitableSamples = filters.minProfitableSamples === '' || filters.minProfitableSamples === null || filters.minProfitableSamples === undefined
    ? 0
    : Math.max(0, Math.floor(Number(filters.minProfitableSamples)));
  return {
    maxDrawdownPercent: Number.isFinite(maxDrawdownPercent) ? maxDrawdownPercent : null,
    minTrades: Number.isFinite(minTrades) ? minTrades : 0,
    minProfitableSamples: Number.isFinite(minProfitableSamples) ? minProfitableSamples : 0,
    enabled: maxDrawdownPercent !== null || minTrades > 0 || minProfitableSamples > 0
  };
}

function optimizationRunPassesFilters(run, filters) {
  if (!filters?.enabled) return true;
  if (filters.maxDrawdownPercent !== null && run.summary.worstDrawdown < -(filters.maxDrawdownPercent / 100)) return false;
  const trades = (run.summary.buyCount ?? 0) + (run.summary.sellCount ?? 0);
  if (trades < filters.minTrades) return false;
  if (run.summary.profitableSamples < filters.minProfitableSamples) return false;
  return true;
}

function formatRunLine(run) {
  if (!run) return '-';
  return `score ${Number(run.score).toFixed(6)}, accum ${fmtPct(run.summary.finalAccum)}, MDD ${fmtPct(run.summary.maxDrawdown)}`;
}

function formatParameters(parameters = {}) {
  if (parameters.entry1 !== undefined) {
    const count = Math.min(MAX_MDD_ENTRIES, Math.max(1, Math.floor(Number(parameters.entryCount ?? 5)) || 5));
    const entries = Array.from({ length: count }, (_, index) => {
      const n = index + 1;
      return `${parameters[`entry${n}`]}@${parameters[`weight${n}`]}%`;
    });
    return `entry ${entries.join('/')}, exit ${parameters.exitLevel}`;
  }
  return `RSI ${parameters.rsiPeriod}, buy ${parameters.buyLevel}, sell ${parameters.sellLevel}`;
}

function showOptimizationProgress(job) {
  const box = $('#optimizationProgress');
  box.classList.remove('hidden');
  const current = job.currentParameters
    ? formatParameters(job.currentParameters)
    : '-';
  const statusLabel = job.status === 'stopped' ? 'Остановлено' : job.status === 'done' ? 'Готово' : job.status === 'error' ? 'Ошибка' : 'Оптимизация';
  const sample = job.currentSample ? `<br>Текущий семпл: ${job.currentSample}` : '';
  const selected = job.acceptedCombinations === undefined ? '' : `<br>Отобрано: ${job.acceptedCombinations}, отсечено: ${job.filteredCombinations ?? 0}`;
  const search = job.search?.mode === 'random' ? `<br>Поиск: случайный, кандидатов ${job.totalCombinations}, seed ${job.search.seed}` : '';
  box.innerHTML = `<strong>${statusLabel}: ${job.completedRuns} / ${job.totalRuns} прогонов</strong><br>Комбинаций: ${job.completedCombinations ?? 0} / ${job.totalCombinations ?? job.totalRuns}${selected}${search}<br>Семплов: ${job.sampleCount ?? 1}<br>Текущий набор: ${current}${sample}<br>Лучший результат сейчас: ${formatRunLine(job.bestRun)}`;
}

function clearOptimizationPoll() {
  if (optimizationPollTimer) clearTimeout(optimizationPollTimer);
  optimizationPollTimer = null;
}

async function pollOptimizationStatus(jobId) {
  const job = await api(`/api/strategies/optimize/status?jobId=${encodeURIComponent(jobId)}`);
  showOptimizationProgress(job);

  if (job.status === 'running') {
    optimizationPollTimer = setTimeout(() => pollOptimizationStatus(jobId).catch((err) => showStrategyMessage(err.message, 'optimizer-error')), 350);
    return;
  }

  clearOptimizationPoll();
  activeOptimizationJobId = null;
  setOptimizationRunning(false);

  if (job.status === 'error') {
    showStrategyMessage(job.error || 'Оптимизация завершилась с ошибкой', 'optimizer-error');
    return;
  }

  if (job.optimization) {
    lastOptimizationResult = job.optimization;
    showOptimizationResult(job.optimization);
  }
}



async function saveTradingStrategy(overwrite = false) {
  const body = { ...collectStrategyBody(), overwrite };
  if (!body.name) return alert('Введите название стратегии');
  try {
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
  const readiness = strategyReadinessMessage();
  if (readiness) {
    showStrategyMessage(readiness, 'strategy-readiness');
    updateStrategyCalculateAvailability();
    return;
  }
  const base = baseCalculationBody();
  const strategy = collectStrategyBody();
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
  updateStrategyCalculateAvailability();
}

async function optimizeTradingStrategy() {
  const readiness = strategyReadinessMessage();
  if (readiness) {
    showStrategyMessage(readiness, 'strategy-readiness');
    updateStrategyCalculateAvailability();
    return;
  }
  const base = baseCalculationBody();
  const strategy = collectStrategyBody();
  const optimizationBody = collectOptimizationBody();
  lastOptimizationFilters = normalizeOptimizationFilters(optimizationBody.filters);
  optimizationSort = { key: 'score', direction: 'desc' };
  const job = await api('/api/strategies/optimize/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...base, strategy, ...optimizationBody })
  });
  activeOptimizationJobId = job.jobId;
  $('#optimizationResultCard').classList.add('hidden');
  showOptimizationProgress(job);
  setOptimizationRunning(true);
  pollOptimizationStatus(job.jobId).catch((err) => showStrategyMessage(err.message, 'optimizer-error'));
  updateStrategyCalculateAvailability();
}

async function stopOptimization() {
  if (!activeOptimizationJobId) return;
  $('#stopOptimization').disabled = true;
  await api('/api/strategies/optimize/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: activeOptimizationJobId })
  });
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
  applyStrategyChartSize();
  renderStrategyRsiChart();
  renderStrategyChart();
  renderStrategyTable(result.rows);
}

function optimizationColumnValue(run, key) {
  const trades = (run.summary.buyCount ?? 0) + (run.summary.sellCount ?? 0);
  if (/^(entry|weight)\d+$/.test(key)) return Number(run.parameters[key] ?? 0);
  const values = {
    rsiPeriod: run.parameters.rsiPeriod,
    buyLevel: run.parameters.buyLevel,
    sellLevel: run.parameters.sellLevel,
    exitLevel: run.parameters.exitLevel,
    score: run.score,
    profitableSamples: run.summary.profitableSamples,
    averageScore: run.summary.averageScore,
    worstScore: run.summary.worstScore,
    compoundedAccum: run.summary.compoundedAccum ?? run.summary.finalAccum ?? run.summary.averageAccum,
    averageAccum: run.summary.averageAccum,
    worstAccum: run.summary.worstAccum,
    worstDrawdown: run.summary.worstDrawdown,
    trades
  };
  return Number(values[key] ?? 0);
}

function sortedOptimizationRuns(result) {
  const direction = optimizationSort.direction === 'asc' ? 1 : -1;
  return [...(result.runs ?? [])].sort((a, b) => {
    const left = optimizationColumnValue(a, optimizationSort.key);
    const right = optimizationColumnValue(b, optimizationSort.key);
    return ((left > right ? 1 : left < right ? -1 : 0) * direction) || (b.score - a.score);
  });
}

function sortHeader(key, label) {
  const marker = optimizationSort.key === key ? (optimizationSort.direction === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th><button type="button" class="sort-header" data-optimizer-sort="${key}">${label}${marker}</button></th>`;
}

function bindOptimizationSortHeaders() {
  $$('[data-optimizer-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.optimizerSort;
      optimizationSort = {
        key,
        direction: optimizationSort.key === key && optimizationSort.direction === 'desc' ? 'asc' : 'desc'
      };
      showOptimizationResult(lastOptimizationResult);
    });
  });
}

function showOptimizationResult(result) {
  $('#optimizationResultCard').classList.remove('hidden');
  const statusRow = result.stopped ? '<tr><th>Статус</th><td>Остановлено пользователем</td></tr>' : '';
  const sampleCount = result.sampleCount ?? result.runs[0]?.summary?.sampleCount ?? 1;
  const filters = (result.filters?.enabled ? result.filters : lastOptimizationFilters) ?? {};
  const displayRuns = (result.runs ?? []).filter((run) => optimizationRunPassesFilters(run, filters));
  const filterRow = filters.enabled
    ? `<tr><th>Отсечение</th><td>MDD ${filters.maxDrawdownPercent ?? '-'}%, трейдов ${filters.minTrades ?? 0}, прибыльных семплов ${filters.minProfitableSamples ?? 0}</td></tr>`
    : '';
  const searchRow = result.search?.mode === 'random'
    ? `<tr><th>Поиск</th><td>Случайный: ${result.totalCombinations} кандидатов, seed ${result.search.seed}</td></tr>`
    : '';
  $('#optimizationSummary').innerHTML = `<table><tbody>
    ${statusRow}
    <tr><th>Метрика</th><td>Устойчивость: худший score по семплам</td></tr>
    <tr><th>Всего прогонов</th><td>${result.totalRuns}</td></tr>
    <tr><th>Семплов</th><td>${sampleCount}</td></tr>
    <tr><th>Выполнено</th><td>${result.completedRuns ?? result.totalRuns}</td></tr>
    <tr><th>Отобрано</th><td>${result.acceptedCombinations ?? result.runs.length}</td></tr>
    <tr><th>Отсечено</th><td>${result.filteredCombinations ?? 0}</td></tr>
    ${searchRow}
    ${filterRow}
    <tr><th>Показано</th><td>${displayRuns.length}</td></tr>
  </tbody></table>`;
  const sampleHeaders = Array.from({ length: sampleCount }, (_, index) => `<th>Семпл ${index + 1}</th>`).join('');
  const mddEntryColumnCount = result.type === 'mdd'
    ? Math.min(MAX_MDD_ENTRIES, Math.max(1, ...((result.runs ?? []).map((run) => Math.floor(Number(run.parameters.entryCount ?? 5)) || 5))))
    : 0;
  const parameterHeaders = result.type === 'mdd'
    ? [
      ...Array.from({ length: mddEntryColumnCount }, (_, index) => [
        sortHeader(`entry${index + 1}`, `Вход ${index + 1}`),
        sortHeader(`weight${index + 1}`, `Вес ${index + 1}`)
      ]).flat(),
      sortHeader('exitLevel', 'Выход')
    ]
    : [
      sortHeader('rsiPeriod', 'RSI период'),
      sortHeader('buyLevel', 'Купить'),
      sortHeader('sellLevel', 'Продать')
    ];
  const parameterCells = (run) => result.type === 'mdd'
    ? `${Array.from({ length: mddEntryColumnCount }, (_, index) => {
      const n = index + 1;
      return `<td>${run.parameters[`entry${n}`] ?? '-'}</td><td>${run.parameters[`weight${n}`] ?? '-'}</td>`;
    }).join('')}<td>${run.parameters.exitLevel}</td>`
    : `<td>${run.parameters.rsiPeriod}</td><td>${run.parameters.buyLevel}</td><td>${run.parameters.sellLevel}</td>`;
  const headers = [
    '<th>#</th>',
    ...parameterHeaders,
    sortHeader('score', 'Устойчивость'),
    sortHeader('profitableSamples', 'Прибыльных'),
    sortHeader('trades', 'Трейдов'),
    sortHeader('averageScore', 'Ср. score'),
    sortHeader('worstScore', 'Худш. score'),
    sortHeader('compoundedAccum', 'Сцепл. accum'),
    sortHeader('averageAccum', 'Ср. accum'),
    sortHeader('worstAccum', 'Худш. accum'),
    sortHeader('worstDrawdown', 'Худш. MDD'),
    sampleHeaders
  ].join('');
  const rows = sortedOptimizationRuns({ ...result, runs: displayRuns });
  const emptyRow = `<tr><td colspan="${1 + parameterHeaders.length + 9 + sampleCount}">Нет результатов, прошедших отсечение.</td></tr>`;
  $('#optimizationResultTable').innerHTML = `<thead><tr>${headers}</tr></thead><tbody>${rows.length ? rows.map((run, index) => `
    <tr>
      <td>${index + 1}</td>
      ${parameterCells(run)}
      <td>${Number(run.score).toFixed(6)}</td>
      <td>${run.summary.profitableSamples}/${run.summary.sampleCount}</td>
      <td>${(run.summary.buyCount ?? 0) + (run.summary.sellCount ?? 0)}</td>
      <td>${Number(run.summary.averageScore).toFixed(6)}</td>
      <td>${Number(run.summary.worstScore).toFixed(6)}</td>
      <td>${fmtPct(run.summary.compoundedAccum ?? run.summary.finalAccum ?? run.summary.averageAccum)}</td>
      <td>${fmtPct(run.summary.averageAccum)}</td>
      <td>${fmtPct(run.summary.worstAccum)}</td>
      <td>${fmtPct(run.summary.worstDrawdown)}</td>
      ${(run.samples ?? []).map((sample) => `<td>${sample.name}<br>${sample.periodFrom} → ${sample.periodTo}<br>accum ${fmtPct(sample.summary.finalAccum)}<br>MDD ${fmtPct(sample.summary.maxDrawdown)}<br>score ${Number(sample.score).toFixed(4)}</td>`).join('')}
    </tr>`).join('') : emptyRow}</tbody>`;
  bindOptimizationSortHeaders();
}

function renderStrategyChart() {
  const chart = $('#strategyChart');
  if (!lastStrategyResult?.rows?.length) return;
  if (!plotlyReady()) {
    chart.innerHTML = '<p class="hint">Plotly не загружен. Обновите страницу или выполните npm install.</p>';
    return;
  }
  const rows = enrichSourceRows(lastStrategyResult.rows);
  const activeSource = new Set($$('#strategySourceToggles input:checked').map((input) => input.dataset.sourceLine));
  const activeStrategy = new Set($$('#strategyToggles input:checked').map((input) => input.dataset.strategyLine));
  const sourceKeys = ['source_diff', 'source_accum', 'source_hwm', 'source_dd', 'source_mdd'].filter((key) => activeSource.has(key));
  const strategyKeys = ['strategy_diff', 'strategy_accum', 'strategy_hwm', 'strategy_dd', 'strategy_mdd'].filter((key) => activeStrategy.has(key));
  const keys = [...sourceKeys, ...strategyKeys];
  const colors = {
    source_diff: '#94a3b8',
    source_accum: '#60a5fa',
    source_hwm: '#34d399',
    source_dd: '#f59e0b',
    source_mdd: '#fb7185',
    strategy_diff: '#475569',
    strategy_accum: '#315efb',
    strategy_hwm: '#059669',
    strategy_dd: '#d97706',
    strategy_mdd: '#dc2626'
  };
  const labels = {
    source_diff: 'source_diff',
    source_accum: 'source_accum',
    source_hwm: 'source_hwm',
    source_dd: 'source_dd',
    source_mdd: 'source_mdd',
    strategy_diff: 'strategy_diff',
    strategy_accum: 'strategy_accum',
    strategy_hwm: 'strategy_hwm',
    strategy_dd: 'strategy_dd',
    strategy_mdd: 'strategy_mdd'
  };
  const x = rows.map((row) => row.timestamp);
  const hoverTime = rows.map((row) => row.time);
  const traces = keys.map((key) => ({
    type: 'scatter',
    mode: 'lines',
    name: labels[key],
    x,
    y: rows.map((row) => row[key] ?? 0),
    customdata: hoverTime,
    line: { color: colors[key], width: 2 },
    hovertemplate: '%{customdata}<br>%{fullData.name}: %{y:.4%}<extra></extra>'
  }));
  const layout = {
    ...plotlyStrategyLayout(strategyChartHeight()),
    uirevision: 'strategy-result-chart'
  };
  Plotly.react(chart, traces, layout, plotlyStrategyConfig()).then(() => bindStrategyPlotlySync('strategyChart'));
}

function renderStrategyRsiPlot(rows) {
  const chart = $('#strategyRsiChart');
  if (!plotlyReady()) {
    chart.innerHTML = '<p class="hint">Plotly не загружен. Обновите страницу или выполните npm install.</p>';
    return;
  }
  const cfg = lastStrategyResult.config;
  const x = rows.map((row) => row.timestamp);
  const hoverTime = rows.map((row) => row.time);
  const traces = [{
    type: 'scatter',
    mode: 'lines',
    name: 'RSI',
    x,
    y: rows.map((row) => row.rsi),
    customdata: hoverTime,
    line: { color: '#8e44ad', width: 1.4 },
    connectgaps: false,
    hovertemplate: '%{customdata}<br>RSI: %{y:.2f}<extra></extra>'
  }];
  const levelShape = (value, color) => ({
    type: 'line',
    xref: 'paper',
    x0: 0,
    x1: 1,
    y0: value,
    y1: value,
    line: { color, width: 1, dash: 'dash' }
  });
  const levelAnnotation = (value, color, text) => ({
    xref: 'paper',
    x: 1,
    xanchor: 'left',
    y: value,
    yanchor: 'middle',
    text,
    showarrow: false,
    font: { color, size: 12 }
  });
  const shapes = [
    levelShape(cfg.upperLevel, '#cf3341'),
    levelShape(cfg.lowerLevel, '#16a56f')
  ];
  const annotations = [
    levelAnnotation(cfg.upperLevel, '#cf3341', String(cfg.upperLevel)),
    levelAnnotation(cfg.lowerLevel, '#16a56f', String(cfg.lowerLevel))
  ];
  if (Number.isFinite(Number(cfg.baseline))) {
    shapes.splice(1, 0, levelShape(cfg.baseline, '#687386'));
    annotations.splice(1, 0, levelAnnotation(cfg.baseline, '#687386', String(cfg.baseline)));
  }
  const layout = {
    ...plotlyStrategyLayout(strategyRsiHeight()),
    uirevision: 'strategy-rsi-chart',
    showlegend: false,
    yaxis: {
      side: 'right',
      range: [0, 100],
      showgrid: true,
      gridcolor: '#e7ebf2',
      zeroline: false
    },
    shapes,
    annotations
  };
  Plotly.react(chart, traces, layout, plotlyStrategyConfig()).then(() => bindStrategyPlotlySync('strategyRsiChart'));
}

function applyStrategyChartSize() {
  const chartHeight = strategyChartHeight();
  const rsiHeight = strategyRsiHeight();
  $$('.strategy-detail-chart').forEach((chart) => { chart.style.height = `${chartHeight}px`; });
  $$('.strategy-rsi-chart').forEach((chart) => { chart.style.height = `${rsiHeight}px`; });
  if (plotlyReady()) {
    if ($('#strategyChart')?._fullLayout) Plotly.relayout('strategyChart', { height: chartHeight });
    if ($('#strategyRsiChart')?._fullLayout) Plotly.relayout('strategyRsiChart', { height: rsiHeight });
  }
}

function renderStrategyTable(rows) {
  $('#strategyResultTable').innerHTML = `<thead><tr><th>Дата</th><th>RSI</th><th>Сигнал</th><th>Исполнение</th><th>Позиция</th><th>Source Diff</th><th>Diff</th><th>Accum</th><th>HWM</th><th>DD</th><th>MDD</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${r.time}</td><td>${r.rsi === null || r.rsi === undefined ? '-' : r.rsi.toFixed(2)}</td><td>${r.signal || '-'}</td><td>${r.execution || '-'}</td><td>${r.position}</td><td>${fmtPct(r.source_diff)}</td><td>${fmtPct(r.strategy_diff)}</td><td>${fmtPct(r.strategy_accum)}</td><td>${fmtPct(r.strategy_hwm)}</td><td>${fmtPct(r.strategy_dd)}</td><td>${fmtPct(r.strategy_mdd)}</td></tr>`).join('')}</tbody>`;
}

function renderCsvPortfolioOptions() {
  const select = $('#csvPortfolioName');
  if (!select) return;
  select.innerHTML = portfolios.map((p) => `<option value="${p.file}">${p.file}</option>`).join('');
}

function selectedExportColumns() {
  return EXPORT_COLUMNS.filter((column) => column === 'timestamp' || $(`[data-export-column="${column}"]`)?.checked);
}

function updateCsvExportPopupState() {
  const source = $('#csvExportSource').value;
  const portfolioMode = source === 'portfolio';
  $('#csvPortfolioLabel').classList.toggle('hidden', !portfolioMode);
  const hasPortfolio = portfolios.length > 0;
  const canExport = (source === 'portfolio' && hasPortfolio) || (source === 'base_result' && !!lastResult?.rows?.length) || (source === 'strategy_result' && !!lastStrategyResult?.rows?.length);
  $('#csvExportApply').disabled = !canExport;
  const hints = {
    portfolio: hasPortfolio ? 'Сервер экспортирует выбранное портфолио и пересчитает accum/HWM/DD/MDD из timestamp,diff.' : 'Сначала загрузите портфолио.',
    base_result: lastResult?.rows?.length ? 'CSV будет собран из текущего исходного результата расчета.' : 'Сначала выполните расчет.',
    strategy_result: lastStrategyResult?.rows?.length ? 'CSV будет собран из текущего результата торговой стратегии.' : 'Сначала рассчитайте торговую стратегию.'
  };
  $('#csvExportHint').textContent = hints[source];
}

function openCsvExportPopup() {
  renderCsvPortfolioOptions();
  updateCsvExportPopupState();
  $('#csvExportPopup').classList.remove('hidden');
}

function closeCsvExportPopup() {
  $('#csvExportPopup').classList.add('hidden');
}

async function exportCsv() {
  const source = $('#csvExportSource').value;
  const columns = selectedExportColumns();
  if (!columns.includes('timestamp')) columns.unshift('timestamp');

  if (source === 'portfolio') {
    const portfolio = $('#csvPortfolioName').value;
    if (!portfolio) return alert('Выберите сохраненное портфолио');
    const url = `/api/portfolios/${encodeURIComponent(portfolio)}/export?columns=${encodeURIComponent(columns.join(','))}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Не удалось экспортировать портфолио');
    }
    downloadCsv(exportFileName('portfolio', columns), await res.text());
    closeCsvExportPopup();
    return;
  }

  if (source === 'base_result') {
    if (!lastResult?.rows?.length) return alert('Сначала выполните расчет');
    downloadCsv(exportFileName('base_result', columns), rowsToCsv(lastResult.rows, columns));
    closeCsvExportPopup();
    return;
  }

  if (source === 'strategy_result') {
    if (!lastStrategyResult?.rows?.length) return alert('Сначала рассчитайте торговую стратегию');
    downloadCsv(exportFileName('strategy_result', columns), rowsToCsv(lastStrategyResult.rows, columns, 'strategy_'));
    closeCsvExportPopup();
  }
}

function syncStrategyPeriodToCalculation() {
  setDatePair($('#strategyPeriodFrom'), $('#periodFrom').value || '');
  setDatePair($('#strategyPeriodTo'), $('#periodTo').value || '');
}

function syncStrategyPeriodIfEnabled() {
  if (!$('#strategyPanel').classList.contains('hidden')) syncStrategyPeriodToCalculation();
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
$('#targetType').addEventListener('change', () => { renderTargetOptions(); syncStrategyPeriodIfEnabled(); updateStrategyCalculateAvailability(true); });
$('#targetName').addEventListener('change', () => { applyTargetRange(); syncStrategyPeriodIfEnabled(); updateStrategyCalculateAvailability(true); });
$('#periodUntilEnd').addEventListener('change', (event) => {
  $('#periodTo').disabled = event.target.checked;
  const pair = $('#periodTo').closest('.date-pair');
  pair?.querySelectorAll('.date-open').forEach((item) => { item.disabled = event.target.checked; });
  if (event.target.checked) setDatePair($('#periodTo'), '');
  syncStrategyPeriodIfEnabled();
  updateStrategyCalculateAvailability(true);
});
$('#calculate').addEventListener('click', () => withLoadingButton($('#calculate'), 'Рассчитывается', calculate).catch((err) => alert(err.message)));
$('#enableStrategies').addEventListener('change', (event) => {
  $('#strategyPanel').classList.toggle('hidden', !event.target.checked);
  if (event.target.checked && !$('#tradingStrategyName').value) $('#tradingStrategyName').value = defaultStrategyName();
  if (event.target.checked) syncStrategyPeriodToCalculation();
  updateStrategyCalculateAvailability(event.target.checked);
});
$('#tradingStrategyType').addEventListener('change', () => {
  updateStrategyTypeUi();
  renderStrategyRsiChart();
  renderStrategyChart();
});
$('#mddEntryCount').addEventListener('change', renderMddEntryFields);
$('#optMddParameterMode').addEventListener('change', updateMddParameterModeUi);
$('#saveTradingStrategy').addEventListener('click', () => saveTradingStrategy(false));
$('#calculateTradingStrategy').addEventListener('click', () => withLoadingButton($('#calculateTradingStrategy'), 'Рассчитывается', calculateTradingStrategy).catch((err) => showStrategyMessage(err.message, 'strategy-error')));
$('#optimizeTradingStrategy').addEventListener('click', () => optimizeTradingStrategy().catch((err) => showStrategyMessage(err.message, 'optimizer-error')));
$('#stopOptimization').addEventListener('click', () => stopOptimization().catch((err) => showStrategyMessage(err.message, 'optimizer-error')));
$('#openCsvExport').addEventListener('click', openCsvExportPopup);
$('#csvExportSource').addEventListener('change', updateCsvExportPopupState);
$('#csvExportApply').addEventListener('click', () => exportCsv().catch((err) => alert(err.message)));
$('#csvExportCancel').addEventListener('click', closeCsvExportPopup);
$('#csvExportPopup').addEventListener('click', (event) => { if (event.target.id === 'csvExportPopup') closeCsvExportPopup(); });
$$('.toggles input').forEach((input) => input.addEventListener('change', () => { renderChart(); renderRsiChart(); renderStrategyChart(); }));
let activeDateInput = null;

function fillDatePickerOptions() {
  const hourSelect = $('#datePickerHour');
  if (hourSelect && !hourSelect.children.length) {
    hourSelect.innerHTML = Array.from({ length: 24 }, (_, hour) => {
      const value = String(hour).padStart(2, '0');
      return `<option value="${value}">${value}</option>`;
    }).join('');
  }
  const minuteSelect = $('#datePickerMinute');
  if (minuteSelect && !minuteSelect.children.length) {
    minuteSelect.innerHTML = Array.from({ length: 60 }, (_, minute) => {
      const value = String(minute).padStart(2, '0');
      return `<option value="${value}">${value}</option>`;
    }).join('');
  }
}

function openDatePopup(input) {
  activeDateInput = input;
  fillDatePickerOptions();
  const parts = parseDateParts(input.value);
  $('#datePickerDate').value = parts.date;
  $('#datePickerHour').value = parts.hour;
  $('#datePickerMinute').value = parts.minute || '00';
  $('#datePickerPopup').classList.remove('hidden');
}

function closeDatePopup() {
  $('#datePickerPopup').classList.add('hidden');
  activeDateInput = null;
}

document.addEventListener('click', (event) => {
  if (event.target.matches('.date-open')) {
    const input = event.target.closest('.date-pair')?.querySelector('.date-input');
    if (input && !input.disabled) openDatePopup(input);
  }
});

$('#datePickerApply').addEventListener('click', () => {
  if (!activeDateInput) return;
  setDatePair(activeDateInput, `${$('#datePickerDate').value} ${$('#datePickerHour').value}:${$('#datePickerMinute').value || '00'}`);
  if (activeDateInput.closest('#strategyPanel') === null) {
    syncStrategyPeriodIfEnabled();
    updateStrategyCalculateAvailability(true);
  }
  closeDatePopup();
});
$('#datePickerCancel').addEventListener('click', closeDatePopup);
$('#datePickerPopup').addEventListener('click', (event) => {
  if (event.target.id === 'datePickerPopup') closeDatePopup();
});

document.addEventListener('change', (event) => {
  if (event.target.matches('.date-input')) {
    forceZeroMinutes(event.target);
    if (event.target.closest('#strategyPanel') === null) {
      syncStrategyPeriodIfEnabled();
      updateStrategyCalculateAvailability(true);
    }
  }
});
$('#baseToggles').addEventListener('change', () => { renderChart(); renderRsiChart(); });
$('#strategyToggles').addEventListener('change', () => { renderStrategyRsiChart(); renderStrategyChart(); });
$('#strategySourceToggles').addEventListener('change', renderStrategyChart);
$('#strategyChartSize').addEventListener('change', () => {
  applyStrategyChartSize();
  renderStrategyRsiChart();
  renderStrategyChart();
});
$('#resetStrategyZoom').addEventListener('click', resetStrategyZoom);

const savedValueType = localStorage.getItem(VALUE_TYPE_STORAGE_KEY);
if (savedValueType && $('#valueType')) $('#valueType').value = savedValueType;
$('#valueType').addEventListener('change', () => localStorage.setItem(VALUE_TYPE_STORAGE_KEY, $('#valueType').value));
addPresetRow();
$('#tradingStrategyName').value = defaultStrategyName();
updateStrategyTypeUi();
refreshAll().then(() => updateStrategyCalculateAvailability()).catch((err) => alert(err.message));
