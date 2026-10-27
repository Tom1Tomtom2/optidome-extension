import { inspect } from './policy.mjs';
const $ = id => document.getElementById(id);
const t = key => chrome.i18n.getMessage(key);
document.documentElement.lang = chrome.i18n.getUILanguage().startsWith('fr') ? 'fr' : 'en';
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
document.title = `optidome · ${t('analysisTitle')}`;
let worker;
let serial = 0;
let deadline;
let idle;
let busy = false;
function release() {
  worker?.terminate(); worker = null;
  clearTimeout(deadline); clearTimeout(idle);
}
function ready() { busy = false; $('analyse').disabled = !$('draft').value.trim(); $('cancel').hidden = true; clearTimeout(deadline); }
function cancel() { serial++; release(); ready(); $('status').textContent = ''; }
function show(result) {
  $('result').hidden = false;
  $('recommendation').textContent = t(`analysisLevel_${result.level ?? 'unknown'}`);
  $('reason').textContent = t(`analysisReason_${result.reason}`);
  $('model').textContent = result.level ? t(`analysisModel_${result.level}`) : t('analysisNoChange');
  $('notes').replaceChildren();
  for (const note of result.notes ?? []) {
    const li = document.createElement('li'); li.textContent = t(`analysisNote_${note}`); $('notes').append(li);
  }
}
function invalidate() {
  if (busy) cancel();
  else { serial++; ready(); $('status').textContent = ''; }
  // A completed worker may stay warm until its existing idle deadline. Editing
  // invalidates the result but never triggers another analysis.
  $('result').hidden = true;
}
$('draft').addEventListener('input', invalidate);
$('context').addEventListener('change', invalidate);
$('cancel').addEventListener('click', () => { cancel(); $('status').textContent = t('analysisCancelled'); });
$('analyse').addEventListener('click', () => {
  if (busy) return;
  const text = $('draft').value;
  const reason = $('context').checked ? 'context' : inspect(text);
  $('result').hidden = true;
  if (reason) { show({ level: null, reason }); return; }
  clearTimeout(idle);
  const id = ++serial;
  busy = true; $('analyse').disabled = true; $('cancel').hidden = false;
  $('status').textContent = t('analysisLoading');
  try {
    if (!worker) worker = new Worker('worker.js', { type: 'module' });
    const fail = () => { cancel(); $('status').textContent = t('analysisError'); };
    worker.onerror = event => { event.preventDefault(); fail(); };
    worker.onmessage = ({ data }) => {
      if (data.id !== serial) return;
      if (data.type === 'status') { $('status').textContent = t(data.stage === 'loading' ? 'analysisLoading' : 'analysisWorking'); return; }
      if (data.type === 'error') { fail(); return; }
      if (data.type === 'result') {
        ready(); $('status').textContent = t('analysisDone'); show(data.result);
        idle = setTimeout(release, 60000);
      }
    };
    deadline = setTimeout(fail, 60000);
    worker.postMessage({ type: 'analyse', id, text });
  } catch { cancel(); $('status').textContent = t('analysisError'); }
});

const params = new URLSearchParams(location.search);
const tab = Number(params.get('tab'));
if (params.has('tab') && Number.isInteger(tab) && params.get('token')) {
  try {
    const response = await chrome.tabs.sendMessage(tab, { type: 'optidome-read-draft', token: params.get('token') });
    if (!response?.ok || typeof response.text !== 'string') throw new Error('no draft');
    $('draft').value = response.text;
  } catch { $('snapshot').textContent = t('analysisPaste'); }
} else { $('snapshot').textContent = t('analysisPaste'); }
// Keep capability tokens out of reloads and navigation history.
history.replaceState(null, '', 'index.html');
const settings = await chrome.storage.local.get('analysisButtonHidden');
$('hide-launcher').checked = Boolean(settings.analysisButtonHidden);
$('hide-launcher').addEventListener('change', () => {
  chrome.storage.local.set({ analysisButtonHidden: $('hide-launcher').checked }).catch(() => {});
});
ready();
window.addEventListener('pagehide', () => { release(); $('draft').value = ''; });
