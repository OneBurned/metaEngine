let portfolios = [];
let presets = [];
let tradingStrategies = [];
let lastResult = null;
let lastResultKey = null;
let pendingResult = null;
let lastStrategyResult = null;
let lastStrategyConfig = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const EXPORT_COLUMNS = ['timestamp', 'diff', 'accum', 'hwm', 'dd', 'mdd'];
const VALUE_TYPE_STORAGE_KEY = 'metaEngine.valueType';
const TIMEFRAME_ORDER = ['1m', '5m', '15m', '1h', '1d', '1M', '1Y'];
const FIXED_TIMEFRAME_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '1d': 86400000 };

function compareTimeframes(source, target) {
  return TIMEFRAME_ORDER.indexOf(target) - TIMEFRAME_ORDER.indexOf(source);
}

function allowedDisplayTimeframes(sourceTimeframe) {
  const index = Math.max(TIMEFRAME_ORDER.indexOf(sourceTimeframe), 0);
  return TIMEFRAME_ORDER.slice(index);
}

function syncTimeframeOptions(select, sourceTimeframe) {
  if (!select) return;
  const allowed = new Set(allowedDisplayTimeframes(sourceTimeframe));
  [...select.options].forEach((option) => { option.disabled = !allowed.has(option.value); });
  if (!allowed.has(select.value)) select.value = sourceTimeframe;
}

function resetSelectValue(select, value) {
  if (select && select.querySelector(`option[value="${value}"]`)) select.value = value;
}

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
  return `${$('#tradingStrategyType')?.value === 'mdd_mean_reversion' ? 'mdd' : 'rsi'}_${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
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
      <td>${strategyParamsText(s)}</td>
      <td><button class="danger" data-delete-trading-strategy="${s.name}">Удалить</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function strategyParamsText(strategy) {
  if (strategy.type === 'mdd_mean_reversion') {
    const levels = (strategy.levels ?? []).map((level) => `${fmtPct(level.drawdown)} → ${fmtPct(level.weight)}`).join(', ');
    return `TP ${fmtPct(strategy.takeProfit ?? 0)}; ${levels}`;
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

function sourceTimeframeForTarget(type, name) {
  if (type === 'portfolio') return portfolioByName(name)?.timeframe ?? '1h';
  const preset = presets.find((item) => item.name === name);
  return preset?.timeframe ?? '1h';
}

function syncTimeframeToTarget() {
  const timeframe = sourceTimeframeForTarget($('#targetType').value, $('#targetName').value);
  if ($(`#timeframe option[value="${timeframe}"]`)) $('#timeframe').value = timeframe;
}

function checkedLine(selector, checked = true) {
  const input = $(selector);
  if (input) input.checked = checked;
}

function applyChartModeSideEffects(mode, scope = 'base') {
  if (scope === 'strategy') {
    checkedLine('[data-strategy-line="strategy_diff"]', mode === 'bar');
    checkedLine('[data-strategy-line="strategy_accum"]', mode === 'line');
    checkedLine('[data-strategy-line="strategy_hwm"]', mode === 'line');
    checkedLine('[data-strategy-line="strategy_dd"]', mode === 'line');
    checkedLine('[data-strategy-line="strategy_mdd"]', mode === 'line');
  } else {
    checkedLine('[data-line="diff"]', mode === 'bar');
    checkedLine('[data-line="accum"]', mode === 'line');
    checkedLine('[data-line="hwm"]', mode === 'line');
    checkedLine('[data-line="dd"]', mode === 'line');
    checkedLine('[data-line="mdd"]', mode === 'line');
  }
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
  syncTimeframeToTarget();
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
    periodUntilEnd: $('#periodUntilEnd').checked,
    timeframe: $('#timeframe').value
  };
}

function calculationKey(body = baseCalculationBody()) {
  return JSON.stringify({
    targetType: body.targetType,
    targetName: body.targetName,
    periodFrom: body.periodFrom,
    periodTo: body.periodTo,
    periodUntilEnd: body.periodUntilEnd,
    timeframe: body.timeframe
  });
}

function strategyReadinessMessage() {
  const body = baseCalculationBody();
  if (!body.targetName) return 'Сначала выберите портфолио или пресет в блоке “3. Расчет”.';
  if (!lastResult?.rows?.length) return 'Сначала выполните расчет в блоке “3. Расчет”. Стратегия применяется к уже рассчитанному портфолио или пресету.';
  if (lastResultKey !== calculationKey(body)) return 'Расчет в блоке “3. Расчет” изменился. Пересчитайте его перед запуском стратегии.';
  if (compareTimeframes(lastResult.step ?? lastResult.timeframe ?? body.timeframe, $('#strategyTimeframe').value) < 0) return 'Вы выбрали ТФ ниже чем имеется в расчетах';
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

function updateStrategyCalculateAvailability(showMessage = false) {
  const button = $('#calculateTradingStrategy');
  if (!button) return false;
  const message = strategyReadinessMessage();
  const ready = !message;
  button.disabled = !ready;
  button.title = message;
  if (ready) {
    clearStrategyMessage('strategy-readiness');
  } else if (showMessage && !$('#strategyPanel').classList.contains('hidden')) {
    showStrategyMessage(message, 'strategy-readiness');
  }
  return ready;
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
  $('#strategyResultCard').classList.add('hidden');
  $('#strategyOverlayToggle').classList.add('hidden');
  $('#rsiPanel').classList.add('hidden');
  $('#mddPanel').classList.add('hidden');
  if (result.warnings?.length) {
    pendingResult = result;
    showWarning(result);
  } else {
    showResult(result, { resetDisplayTimeframe: true });
  }
  syncStrategyPeriodToCalculation();
}

function showWarning(result) {
  const box = $('#warningBox');
  box.classList.remove('hidden');
  const sample = result.warnings.slice(0, 15).map((w) => `${w.portfolio ? `${w.portfolio}: ` : ''}${w.display}`).join('\n');
  box.innerHTML = `Шаг определен как ${stepLabel(result.step)}, но найдены пропуски: ${result.warnings.length}.\n\n<button id="continueCalc">Продолжить расчет</button> <button id="showGaps" class="secondary">Показать пропуски</button> <button id="cancelCalc" class="danger">Отменить</button><pre class="hidden" id="gapLog">${sample}${result.warnings.length > 15 ? '\n...' : ''}</pre>`;
  $('#continueCalc').onclick = () => { box.classList.add('hidden'); showResult(pendingResult, { resetDisplayTimeframe: true }); updateStrategyCalculateAvailability(); };
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
  const labels = { '1m': '1 минута', '5m': '5 минут', '15m': '15 минут', '1h': '1 час', '1d': '1 день', '1M': '1 месяц', '1Y': '1 год' };
  if (labels[step]) return labels[step];
  if (step === 60000) return '1 минута';
  if (step === 300000) return '5 минут';
  if (step === 900000) return '15 минут';
  if (step === 3600000) return '1 час';
  if (step === 86400000) return '1 день';
  return `${Math.round(Number(step) / 60000)} минут`;
}

function calculateRowsFromDiffs(rows, diffKey = 'diff', prefix = '') {
  let accum = 0;
  let hwm = 0;
  let mdd = 0;
  return rows.map((row, index) => {
    const diff = row[diffKey] ?? 0;
    accum = index === 0 ? 0 : (1 + diff) * (1 + accum) - 1;
    hwm = Math.max(hwm, accum);
    const dd = (1 + accum) / (1 + hwm) - 1;
    mdd = Math.min(mdd, dd);
    return { ...row, [`${prefix}diff`]: diff, [`${prefix}accum`]: accum, [`${prefix}hwm`]: hwm, [`${prefix}dd`]: dd, [`${prefix}mdd`]: mdd };
  });
}

function summarizeRows(rows, prefix = '') {
  return {
    start: rows[0]?.time ?? null,
    end: rows.at(-1)?.time ?? null,
    points: rows.length,
    finalAccum: rows.at(-1)?.[`${prefix}accum`] ?? 0,
    hwm: rows.at(-1)?.[`${prefix}hwm`] ?? 0,
    maxDrawdown: rows.at(-1)?.[`${prefix}mdd`] ?? 0
  };
}

function sameUtcMinute(timestamp, minuteMs) {
  return Math.floor(timestamp / minuteMs) * minuteMs === timestamp;
}

function isBoundary(timestamp, timeframe) {
  const d = new Date(timestamp);
  if (FIXED_TIMEFRAME_MS[timeframe]) return sameUtcMinute(timestamp, FIXED_TIMEFRAME_MS[timeframe]);
  if (timeframe === '1M') return d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  if (timeframe === '1Y') return d.getUTCMonth() === 0 && d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return false;
}

function displayRowsForResult(result, timeframe, prefix = '') {
  if (!result?.rows?.length) return [];
  const calculationTimeframe = result.step ?? result.timeframe ?? '1h';
  if (compareTimeframes(calculationTimeframe, timeframe) < 0) return result.rows;
  const accumKey = `${prefix}accum`;
  const diffKey = `${prefix}diff`;
  const checkpoints = result.rows.filter((row) => isBoundary(row.timestamp, timeframe));
  const diffs = checkpoints.map((row, index) => {
    if (index === 0) return 0;
    return (1 + (row[accumKey] ?? 0)) / (1 + (checkpoints[index - 1][accumKey] ?? 0)) - 1;
  });
  return calculateRowsFromDiffs(checkpoints.map((row, index) => ({ ...row, [diffKey]: diffs[index] })), diffKey, prefix);
}

function resultForDisplay(result, timeframe, prefix = '') {
  const rows = displayRowsForResult(result, timeframe, prefix);
  return { ...result, rows, summary: { ...summarizeRows(rows, prefix), buyCount: result.summary?.buyCount, sellCount: result.summary?.sellCount }, displayTimeframe: timeframe };
}

function showResult(result, options = {}) {
  lastResult = result;
  lastResultKey = result.calculationKey ?? calculationKey();
  const calculationTimeframe = result.step ?? result.timeframe ?? '1h';
  syncTimeframeOptions($('#displayTimeframe'), calculationTimeframe);
  syncTimeframeOptions($('#strategyTimeframe'), calculationTimeframe);
  if (options.resetDisplayTimeframe) {
    resetSelectValue($('#displayTimeframe'), calculationTimeframe);
    resetSelectValue($('#strategyTimeframe'), calculationTimeframe);
  }
  const display = resultForDisplay(result, $('#displayTimeframe').value);
  $('#resultCard').classList.remove('hidden');
  $('#summary').innerHTML = `<table><tbody>
    <tr><th>ТФ для расчета</th><td>${stepLabel(result.step ?? result.timeframe)}</td></tr>
    <tr><th>ТФ для отображения</th><td>${stepLabel(display.displayTimeframe)}</td></tr>
    <tr><th>Начало</th><td>${display.summary.start}</td></tr>
    <tr><th>Конец</th><td>${display.summary.end}</td></tr>
    <tr><th>Точек</th><td>${display.summary.points}</td></tr>
    <tr><th>Accum</th><td>${fmtPct(display.summary.finalAccum)}</td></tr>
    <tr><th>HWM</th><td>${fmtPct(display.summary.hwm)}</td></tr>
    <tr><th>MDD</th><td>${fmtPct(display.summary.maxDrawdown)}</td></tr>
  </tbody></table>`;
  renderChart();
  renderRsiChart();
  renderMddChart();
  renderResultTable(display.rows);
  updateStrategyCalculateAvailability();
}

function renderResultTable(rows) {
  $('#resultTable').innerHTML = `<thead><tr><th>Дата</th><th>OUT Diff</th><th>OUT Accum</th><th>OUT HWM</th><th>OUT DD</th><th>OUT MDD</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${r.time}</td><td>${fmtPct(r.diff)}</td><td>${fmtPct(r.accum)}</td><td>${fmtPct(r.hwm)}</td><td>${fmtPct(r.dd)}</td><td>${fmtPct(r.mdd)}</td></tr>`).join('')}</tbody>`;
}

function renderLineChart(svg, rows, keys, colors, labelAccessor = (key) => key, mode = 'line') {
  if (!rows?.length || !keys.length) { svg.innerHTML = ''; return; }
  const width = 900, height = 360, pad = 42;
  const values = rows.flatMap((row) => keys.map((key) => row[key])).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i) => pad + (i / Math.max(rows.length - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const zeroY = y(0);
  const barKey = mode === 'bar' ? keys.find((key) => key.endsWith('diff') || key === 'diff') : null;
  const barWidth = Math.max(2, ((width - pad * 2) / Math.max(rows.length, 1)) * 0.68);
  const barColor = (value) => value > 0 ? '#16a56f' : value < 0 ? '#cf3341' : colors[barKey];
  const bars = barKey ? rows.map((row, i) => {
    const value = row[barKey] ?? 0;
    const top = Math.min(y(value), zeroY);
    const heightValue = Math.max(Math.abs(y(value) - zeroY), 1);
    return `<rect x="${(x(i) - barWidth / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${heightValue.toFixed(2)}" fill="${barColor(value)}" opacity="0.68"/>`;
  }).join('') : '';
  const lineKeys = keys.filter((key) => key !== barKey);
  const lines = lineKeys.map((key) => {
    const points = rows.map((row, i) => `${x(i).toFixed(2)},${y(row[key] ?? 0).toFixed(2)}`).join(' ');
    return `<polyline fill="none" stroke="${colors[key]}" stroke-width="2" points="${points}"/><text x="${width - pad + 4}" y="${y(rows.at(-1)[key] ?? 0).toFixed(2)}" fill="${colors[key]}" font-size="12">${labelAccessor(key)}</text>`;
  }).join('');
  svg.innerHTML = `<line x1="${pad}" x2="${width - pad}" y1="${zeroY}" y2="${zeroY}" stroke="#cfd6e3"/><text x="8" y="${pad}" font-size="12">${fmtPct(max)}</text><text x="8" y="${height - pad}" font-size="12">${fmtPct(min)}</text>${bars}${lines}`;
}

function renderChart() {
  const svg = $('#chart');
  if (!lastResult?.rows?.length) return;
  applyChartModeSideEffects($('#chartMode').value);
  const display = resultForDisplay(lastResult, $('#displayTimeframe').value);
  const active = new Set($$('.toggles input:checked').map((input) => input.dataset.line).filter(Boolean));
  const keys = ['diff', 'accum', 'hwm', 'dd', 'mdd'].filter((key) => active.has(key));
  const colors = { diff: '#7c8a9b', accum: '#315efb', hwm: '#16a56f', dd: '#e28a00', mdd: '#cf3341' };
  renderLineChart(svg, display.rows, keys, colors, (key) => key, $('#chartMode').value);
  renderResultTable(display.rows);
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



function renderMddChart() {
  const overlayEnabled = $('[data-strategy-overlay]')?.checked;
  if (lastStrategyResult?.type !== 'mdd_mean_reversion' || !lastStrategyResult?.mdd?.length || !overlayEnabled) {
    $('#mddPanel')?.classList.add('hidden');
    return;
  }
  $('#mddPanel').classList.remove('hidden');
  const svg = $('#mddChart');
  const width = 900, height = 220, pad = 36;
  const rows = lastStrategyResult.mdd;
  const levels = lastStrategyResult.config?.levels ?? [];
  const values = rows.flatMap((row) => [row.dd, row.localMdd]).concat(levels.map((level) => level.drawdown), [0]);
  const min = Math.min(...values);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i) => pad + (i / Math.max(rows.length - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = (key, color, label) => `<polyline fill="none" stroke="${color}" stroke-width="2" points="${rows.map((row, i) => `${x(i).toFixed(2)},${y(row[key] ?? 0).toFixed(2)}`).join(' ')}"/><text x="${width - pad + 4}" y="${y(rows.at(-1)[key] ?? 0).toFixed(2)}" fill="${color}" font-size="12">${label}</text>`;
  const levelLines = levels.map((level) => `<line x1="${pad}" x2="${width - pad}" y1="${y(level.drawdown)}" y2="${y(level.drawdown)}" stroke="#9aa4b2" stroke-dasharray="6 5"/><text x="8" y="${y(level.drawdown) + 4}" font-size="12" fill="#687386">${fmtPct(level.drawdown)}</text>`).join('');
  svg.innerHTML = `<line x1="${pad}" x2="${width - pad}" y1="${y(0)}" y2="${y(0)}" stroke="#cfd6e3"/>${levelLines}${line('dd', '#e28a00', 'DD')}${line('localMdd', '#cf3341', 'local MDD')}`;
}

function addMddLevel(drawdownPercent = -10, weightPercent = 10) {
  const template = $('#mddLevelTemplate').content.cloneNode(true);
  const row = template.querySelector('.mdd-level-row');
  row.querySelector('.mdd-level-drawdown').value = drawdownPercent;
  row.querySelector('.mdd-level-weight').value = weightPercent;
  row.querySelector('.remove-mdd-level').addEventListener('click', () => row.remove());
  $('#mddLevels').appendChild(template);
}

function collectMddLevels() {
  return $$('#mddLevels .mdd-level-row').map((row) => ({
    drawdown: Number(row.querySelector('.mdd-level-drawdown').value) / 100,
    weight: Number(row.querySelector('.mdd-level-weight').value) / 100
  }));
}

function syncStrategyTypeUi() {
  const type = $('#tradingStrategyType').value;
  $$('.rsi-params').forEach((el) => el.classList.toggle('hidden', type !== 'rsi'));
  $$('.mdd-params').forEach((el) => el.classList.toggle('hidden', type !== 'mdd_mean_reversion'));
  if (!$('#tradingStrategyName').value || /^rsi_|^mdd_/.test($('#tradingStrategyName').value)) $('#tradingStrategyName').value = defaultStrategyName();
}

function collectStrategyBody() {
  const common = {
    name: $('#tradingStrategyName').value || defaultStrategyName(),
    type: $('#tradingStrategyType').value,
    periodFrom: normalizeDateInput($('#strategyPeriodFrom').value),
    periodTo: normalizeDateInput($('#strategyPeriodTo').value),
    timeframe: $('#strategyTimeframe').value
  };
  if (common.type === 'mdd_mean_reversion') {
    return {
      ...common,
      takeProfit: Number($('#mddTakeProfit').value) / 100,
      levels: collectMddLevels()
    };
  }
  return {
    ...common,
    rsiPeriod: $('#rsiPeriod').value,
    upperLevel: $('#rsiUpper').value,
    lowerLevel: $('#rsiLower').value,
    baseline: $('#rsiBaseline').value,
    buyLevel: $('#buyLevel').value,
    sellLevel: $('#sellLevel').value
  };
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
    body: JSON.stringify({ ...base, timeframe: strategy.timeframe, strategy })
  });
  lastStrategyResult = result.strategyResult;
  showStrategyResult(result.strategyResult, result.strategy.name, { resetDisplayTimeframe: true });
  showStrategyWarnings(result.strategyResult.warnings);
  updateStrategyCalculateAvailability();
}

function showStrategyResult(result, name, options = {}) {
  $('#strategyResultCard').classList.remove('hidden');
  $('#strategyOverlayToggle').classList.remove('hidden');
  $('#strategyOverlayName').textContent = result.type === 'mdd_mean_reversion' ? 'MDD' : (name || 'RSI');
  const calculationTimeframe = result.step ?? result.timeframe ?? '1h';
  syncTimeframeOptions($('#strategyDisplayTimeframe'), calculationTimeframe);
  if (options.resetDisplayTimeframe) resetSelectValue($('#strategyDisplayTimeframe'), calculationTimeframe);
  const display = resultForDisplay(result, $('#strategyDisplayTimeframe').value, 'strategy_');
  $('#strategySummary').innerHTML = `<table><tbody>
    <tr><th>ТФ для расчета</th><td>${stepLabel(result.step ?? result.timeframe)}</td></tr>
    <tr><th>ТФ для отображения</th><td>${stepLabel(display.displayTimeframe)}</td></tr>
    <tr><th>Начало</th><td>${display.summary.start}</td></tr>
    <tr><th>Конец</th><td>${display.summary.end}</td></tr>
    <tr><th>Точек</th><td>${display.summary.points}</td></tr>
    <tr><th>Accum</th><td>${fmtPct(display.summary.finalAccum)}</td></tr>
    <tr><th>HWM</th><td>${fmtPct(display.summary.hwm)}</td></tr>
    <tr><th>MDD</th><td>${fmtPct(display.summary.maxDrawdown)}</td></tr>
    <tr><th>Покупок</th><td>${result.summary.buyCount}</td></tr>
    <tr><th>Продаж</th><td>${result.summary.sellCount}</td></tr>
  </tbody></table>`;
  renderRsiChart();
  renderMddChart();
  renderStrategyChart();
  renderStrategyTable(display.rows);
}

function renderStrategyChart() {
  const svg = $('#strategyChart');
  if (!lastStrategyResult?.rows?.length) return;
  applyChartModeSideEffects($('#strategyChartMode').value, 'strategy');
  const display = resultForDisplay(lastStrategyResult, $('#strategyDisplayTimeframe').value, 'strategy_');
  const active = new Set($$('#strategyToggles input:checked').map((input) => input.dataset.strategyLine));
  const keys = ['strategy_diff', 'strategy_accum', 'strategy_hwm', 'strategy_dd', 'strategy_mdd'].filter((key) => active.has(key));
  const colors = { strategy_diff: '#7c8a9b', strategy_accum: '#315efb', strategy_hwm: '#16a56f', strategy_dd: '#e28a00', strategy_mdd: '#cf3341' };
  renderLineChart(svg, display.rows, keys, colors, (key) => key.replace('strategy_', ''), $('#strategyChartMode').value);
  renderStrategyTable(display.rows);
}


function fmtMaybePct(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : fmtPct(value);
}

function fmtEquity(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '—' : Number(value).toFixed(4);
}

function formatMddSignal(value) {
  if (!value) return '—';
  if (value === 'take_profit_close') return 'TP';
  const weight = String(value).match(/^target_weight:(.+)$/);
  return weight ? `Вес ${fmtPct(Number(weight[1]))}` : value;
}

function formatMddExecution(value) {
  if (!value) return '—';
  const weight = String(value).match(/^weight:(.+)$/);
  return weight ? `Вес ${fmtPct(Number(weight[1]))}` : value;
}

function formatMddTpState(value) {
  const labels = { waiting: 'Ждем TP', hit: 'TP', cancelled: 'TP отменен' };
  return labels[value] ?? '—';
}

function renderStrategyTable(rows) {
  const isMdd = lastStrategyResult?.type === 'mdd_mean_reversion';
  const indicatorHeaders = isMdd ? '<th>IN Diff</th><th>IN Accum</th><th>IN DD</th><th>Local MDD</th><th>Local Accum</th><th>TP статус</th>' : '<th>RSI</th>';
  const sourceHeader = isMdd ? '' : '<th>Source Diff</th>';
  $('#strategyResultTable').innerHTML = `<thead><tr><th>Дата</th>${indicatorHeaders}<th>Сигнал</th><th>Исполнение</th><th>Вес</th>${sourceHeader}<th>OUT Diff</th><th>OUT Accum</th><th>OUT HWM</th><th>OUT DD</th><th>OUT MDD</th></tr></thead><tbody>${rows.map((r) => {
    const indicatorCells = isMdd
      ? `<td>${fmtPct(r.source_diff)}</td><td>${fmtPct(r.source_accum)}</td><td>${fmtPct(r.base_dd)}</td><td>${fmtPct(r.local_mdd)}</td><td>${fmtMaybePct(r.local_accum)}</td><td>${formatMddTpState(r.tp_state)}</td>`
      : `<td>${r.rsi === null ? '-' : r.rsi.toFixed(2)}</td>`;
    const signal = isMdd ? formatMddSignal(r.signal) : (r.signal || '-');
    const execution = isMdd ? formatMddExecution(r.execution) : (r.execution || '-');
    const sourceCells = isMdd ? '' : `<td>${fmtPct(r.source_diff)}</td>`;
    return `<tr><td>${r.time}</td>${indicatorCells}<td>${signal}</td><td>${execution}</td><td>${fmtPct(r.position)}</td>${sourceCells}<td>${fmtPct(r.strategy_diff)}</td><td>${fmtPct(r.strategy_accum)}</td><td>${fmtPct(r.strategy_hwm)}</td><td>${fmtPct(r.strategy_dd)}</td><td>${fmtPct(r.strategy_mdd)}</td></tr>`;
  }).join('')}</tbody>`;
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

function rerenderWithStatus(statusSelector, render) {
  const status = $(statusSelector);
  status?.classList.remove('hidden');
  requestAnimationFrame(() => {
    setTimeout(() => {
      render();
      status?.classList.add('hidden');
    }, 80);
  });
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
$('#targetType').addEventListener('change', () => { renderTargetOptions(); syncTimeframeToTarget(); syncStrategyPeriodIfEnabled(); updateStrategyCalculateAvailability(true); });
$('#targetName').addEventListener('change', () => { applyTargetRange(); syncTimeframeToTarget(); syncStrategyPeriodIfEnabled(); updateStrategyCalculateAvailability(true); });
$('#timeframe').addEventListener('change', () => {
  updateStrategyCalculateAvailability(true);
});
$('#displayTimeframe').addEventListener('change', () => {
  if (lastResult) rerenderWithStatus('#displayRecalcStatus', () => showResult(lastResult));
});
$('#chartMode').addEventListener('change', () => { applyChartModeSideEffects($('#chartMode').value); renderChart(); });
$('#strategyTimeframe').addEventListener('change', () => updateStrategyCalculateAvailability(true));
$('#tradingStrategyType').addEventListener('change', syncStrategyTypeUi);
$('#addMddLevel').addEventListener('click', () => addMddLevel(-10, 10));
$('#strategyDisplayTimeframe').addEventListener('change', () => {
  if (lastStrategyResult) rerenderWithStatus('#strategyDisplayRecalcStatus', () => showStrategyResult(lastStrategyResult, lastStrategyConfig?.name));
});
$('#strategyChartMode').addEventListener('change', () => { applyChartModeSideEffects($('#strategyChartMode').value, 'strategy'); renderStrategyChart(); });
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
$('#saveTradingStrategy').addEventListener('click', () => saveTradingStrategy(false));
$('#calculateTradingStrategy').addEventListener('click', () => withLoadingButton($('#calculateTradingStrategy'), 'Рассчитывается', calculateTradingStrategy).catch((err) => showStrategyMessage(err.message, 'strategy-error')));
$('#openCsvExport').addEventListener('click', openCsvExportPopup);
$('#csvExportSource').addEventListener('change', updateCsvExportPopupState);
$('#csvExportApply').addEventListener('click', () => exportCsv().catch((err) => alert(err.message)));
$('#csvExportCancel').addEventListener('click', closeCsvExportPopup);
$('#csvExportPopup').addEventListener('click', (event) => { if (event.target.id === 'csvExportPopup') closeCsvExportPopup(); });
$$('.toggles input').forEach((input) => input.addEventListener('change', () => { renderChart(); renderRsiChart(); renderMddChart(); renderStrategyChart(); }));
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
$('#baseToggles').addEventListener('change', () => { renderChart(); renderRsiChart(); renderMddChart(); });
$('#strategyToggles').addEventListener('change', renderStrategyChart);

const savedValueType = localStorage.getItem(VALUE_TYPE_STORAGE_KEY);
if (savedValueType && $('#valueType')) $('#valueType').value = savedValueType;
$('#valueType').addEventListener('change', () => localStorage.setItem(VALUE_TYPE_STORAGE_KEY, $('#valueType').value));
addPresetRow();
[-10, -20, -30, -40, -50].forEach((dd, index) => addMddLevel(dd, (index + 1) * 10));
syncStrategyTypeUi();
$('#tradingStrategyName').value = defaultStrategyName();
refreshAll().then(() => updateStrategyCalculateAvailability()).catch((err) => alert(err.message));
