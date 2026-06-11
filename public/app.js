let strategies = [];
let presets = [];
let lastResult = null;
let pendingResult = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function fmtPct(value) {
  return `${(Number(value) * 100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function normalizeDateInput(value) {
  return String(value || '').replace('T', ' ').trim();
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || body.message || 'Ошибка запроса');
  return body;
}

async function refreshAll() {
  const [strategyData, presetData] = await Promise.all([api('/api/strategies'), api('/api/presets')]);
  strategies = strategyData.strategies;
  presets = presetData.presets;
  renderStrategies();
  renderPresets();
  renderPresetRowsOptions();
  renderTargetOptions();
}

function renderStrategies() {
  const el = $('#strategies');
  if (!strategies.length) {
    el.innerHTML = '<p class="hint">Пока стратегий нет.</p>';
    return;
  }
  el.innerHTML = `<table><thead><tr><th>Стратегия</th><th>Точки</th><th>Период</th><th>Шаг</th><th>Пропуски</th><th></th></tr></thead><tbody>${strategies.map((s) => `
    <tr>
      <td><strong>${s.file}</strong></td>
      <td>${s.points}</td>
      <td>${s.start || '-'} — ${s.end || '-'}</td>
      <td>${s.stepLabel}</td>
      <td>${s.gaps ? `<span class="badge">${s.gaps}</span>` : 'нет'}</td>
      <td><button class="danger" data-delete-strategy="${s.file}">Удалить</button></td>
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
      <td>${(p.items ?? []).map((i) => `${i.strategy}: ${i.weightPercent}% (${i.date_from} → ${i.date_to ?? 'до конца'})`).join('<br>')}</td>
      <td><button class="danger" data-delete-preset="${p.name}">Удалить</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function strategyOptions(selected = '') {
  return strategies.map((s) => `<option value="${s.file}" ${s.file === selected ? 'selected' : ''}>${s.file}</option>`).join('');
}

function renderPresetRowsOptions() {
  $$('.row-strategy').forEach((select) => {
    const current = select.value;
    select.innerHTML = strategyOptions(current);
  });
}

function renderTargetOptions() {
  const type = $('#targetType').value;
  const items = type === 'strategy' ? strategies.map((s) => s.file) : presets.map((p) => p.name);
  $('#targetName').innerHTML = items.map((name) => `<option value="${name}">${name}</option>`).join('');
}

function addPresetRow() {
  const template = $('#presetRowTemplate').content.cloneNode(true);
  const row = template.querySelector('.preset-row');
  row.querySelector('.row-strategy').innerHTML = strategyOptions();
  row.querySelector('.row-until-end').addEventListener('change', (event) => {
    row.querySelector('.row-to').disabled = event.target.checked;
    if (event.target.checked) row.querySelector('.row-to').value = '';
  });
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  $('#presetRows').appendChild(template);
}

async function uploadStrategy(event) {
  event.preventDefault();
  const file = $('#strategyFile').files[0];
  if (!file) return alert('Выберите CSV-файл');
  const form = new FormData();
  form.append('file', file);
  form.append('name', $('#strategyName').value || file.name.replace(/\.csv$/i, ''));
  form.append('valueType', $('#valueType').value);
  const result = await api('/api/strategies', { method: 'POST', body: form });
  const gapText = result.gaps?.length ? `\nНайдены пропуски: ${result.gaps.length}` : '';
  const renameText = result.renamed ? `\nИмя уже было занято, поэтому сохранено как: ${result.file}` : '';
  alert(`Стратегия сохранена: ${result.file}${renameText}\nШаг определен: ${result.stepLabel}${gapText}`);
  event.target.reset();
  await refreshAll();
}

async function deleteStrategy(file) {
  const usedBy = presets.filter((p) => (p.items ?? []).some((i) => i.strategy === file)).map((p) => p.name);
  let message = `Удалить стратегию ${file}?`;
  if (usedBy.length) message += `\n\nОна используется в пресетах:\n- ${usedBy.join('\n- ')}\n\nПресеты НЕ будут удалены. В расчетах по этой стратегии будут нули, пока ты не загрузишь стратегию с таким же именем снова.`;
  if (!confirm(message)) return;
  await api(`/api/strategies/${encodeURIComponent(file)}`, { method: 'DELETE' });
  await refreshAll();
}

async function deletePreset(name) {
  if (!confirm(`Удалить пресет ${name}?\n\nСтратегии при этом НЕ удаляются.`)) return;
  await api(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
  await refreshAll();
}

async function savePreset(overwrite = false) {
  const rows = $$('#presetRows .preset-row');
  const body = {
    name: $('#presetName').value,
    overwrite,
    items: rows.map((row) => ({
      strategy: row.querySelector('.row-strategy').value,
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

async function calculate() {
  const body = {
    targetType: $('#targetType').value,
    targetName: $('#targetName').value,
    periodFrom: normalizeDateInput($('#periodFrom').value),
    periodTo: normalizeDateInput($('#periodTo').value)
  };
  if (!body.targetName) return alert('Выберите стратегию или пресет');
  const result = await api('/api/calculate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (result.warnings?.length) {
    pendingResult = result;
    showWarning(result);
  } else {
    showResult(result);
  }
}

function showWarning(result) {
  const box = $('#warningBox');
  box.classList.remove('hidden');
  const sample = result.warnings.slice(0, 15).map((w) => `${w.strategy ? `${w.strategy}: ` : ''}${w.display}`).join('\n');
  box.innerHTML = `Шаг определен как ${stepLabel(result.step)}, но найдены пропуски: ${result.warnings.length}.\n\n<button id="continueCalc">Продолжить расчет</button> <button id="showGaps" class="secondary">Показать пропуски</button> <button id="cancelCalc" class="danger">Отменить</button><pre class="hidden" id="gapLog">${sample}${result.warnings.length > 15 ? '\n...' : ''}</pre>`;
  $('#continueCalc').onclick = () => { box.classList.add('hidden'); showResult(pendingResult); };
  $('#showGaps').onclick = () => $('#gapLog').classList.toggle('hidden');
  $('#cancelCalc').onclick = () => { pendingResult = null; box.classList.add('hidden'); };
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
    <tr><th>Итоговый accum</th><td>${fmtPct(result.summary.finalAccum)}</td></tr>
    <tr><th>Худший MDD</th><td>${fmtPct(result.summary.maxDrawdown)}</td></tr>
  </tbody></table>`;
  renderChart();
  renderResultTable(result.rows);
}

function renderResultTable(rows) {
  $('#resultTable').innerHTML = `<thead><tr><th>Дата</th><th>diff</th><th>accum</th><th>hwm</th><th>dd</th><th>mdd</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${r.time}</td><td>${fmtPct(r.diff)}</td><td>${fmtPct(r.accum)}</td><td>${fmtPct(r.hwm)}</td><td>${fmtPct(r.dd)}</td><td>${fmtPct(r.mdd)}</td></tr>`).join('')}</tbody>`;
}

function renderChart() {
  const svg = $('#chart');
  if (!lastResult?.rows?.length) return;
  const active = new Set($$('.toggles input:checked').map((input) => input.dataset.line));
  const rows = lastResult.rows;
  const keys = ['diff', 'accum', 'hwm', 'dd', 'mdd'].filter((key) => active.has(key));
  const colors = { diff: '#7c8a9b', accum: '#315efb', hwm: '#16a56f', dd: '#e28a00', mdd: '#cf3341' };
  const width = 900, height = 360, pad = 42;
  const values = rows.flatMap((row) => keys.map((key) => row[key]));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i) => pad + (i / Math.max(rows.length - 1, 1)) * (width - pad * 2);
  const y = (v) => height - pad - ((v - min) / span) * (height - pad * 2);
  const zeroY = y(0);
  const lines = keys.map((key) => {
    const points = rows.map((row, i) => `${x(i).toFixed(2)},${y(row[key]).toFixed(2)}`).join(' ');
    return `<polyline fill="none" stroke="${colors[key]}" stroke-width="2" points="${points}"/><text x="${width - pad + 4}" y="${y(rows.at(-1)[key]).toFixed(2)}" fill="${colors[key]}" font-size="12">${key}</text>`;
  }).join('');
  svg.innerHTML = `<line x1="${pad}" x2="${width - pad}" y1="${zeroY}" y2="${zeroY}" stroke="#cfd6e3"/><text x="8" y="${pad}" font-size="12">${fmtPct(max)}</text><text x="8" y="${height - pad}" font-size="12">${fmtPct(min)}</text>${lines}`;
}

$('#uploadForm').addEventListener('submit', (event) => uploadStrategy(event).catch((err) => alert(err.message)));
$('#strategies').addEventListener('click', (event) => {
  const file = event.target.dataset.deleteStrategy;
  if (file) deleteStrategy(file).catch((err) => alert(err.message));
});
$('#presets').addEventListener('click', (event) => {
  const name = event.target.dataset.deletePreset;
  if (name) deletePreset(name).catch((err) => alert(err.message));
});
$('#addPresetRow').addEventListener('click', addPresetRow);
$('#savePreset').addEventListener('click', () => savePreset(false));
$('#targetType').addEventListener('change', renderTargetOptions);
$('#calculate').addEventListener('click', () => calculate().catch((err) => alert(err.message)));
$$('.toggles input').forEach((input) => input.addEventListener('change', renderChart));

addPresetRow();
refreshAll().catch((err) => alert(err.message));
