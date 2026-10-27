// Separate from the existing usage observer. No text is read while typing.
(() => {
  const SELECTOR = '#prompt-textarea, textarea[data-id="root"]';
  const t = key => chrome.i18n.getMessage(key);
  const host = document.createElement('div');
  host.id = 'optidome-analysis-launcher';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial}button{position:fixed;right:16px;bottom:64px;z-index:2147482999;border:1px solid #d9d8d3;border-radius:24px;padding:10px 16px;background:#fff;color:#131312;font:500 13px system-ui;box-shadow:0 3px 16px #0001;cursor:pointer}button:focus-visible{outline:2px solid #ff6d00;outline-offset:3px}button[hidden]{display:none}@media(prefers-color-scheme:dark){button{background:#26262a;color:#ecebe8;border-color:#45454c}}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('analysisLaunch');
  button.title = t('analysisOptional');
  shadow.append(style, button);
  document.documentElement.append(host);
  const editor = () => [...document.querySelectorAll(SELECTOR)].find(el => el.isConnected && el.getClientRects().length && el.getAttribute('contenteditable') !== 'false');
  let pending = null;
  let expiry;
  let enabled = true;
  let scheduled = false;
  function update() { button.hidden = !enabled || !editor(); scheduled = false; }
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; setTimeout(update, 200); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.local.get('analysisButtonHidden').then(data => { enabled = !data.analysisButtonHidden; update(); }).catch(() => { button.hidden = true; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.analysisButtonHidden) { enabled = !changes.analysisButtonHidden.newValue; update(); }
  });
  button.addEventListener('click', async event => {
    if (!event.isTrusted) return;
    const field = editor();
    if (!field) return;
    // The snapshot is held in memory for one read, with a short expiry.
    const text = field.tagName === 'TEXTAREA' ? field.value : field.innerText;
    if (text.length > 8000) { button.textContent = t('analysisTooLong'); return; }
    const token = crypto.randomUUID();
    pending = { token, text, path: location.pathname };
    clearTimeout(expiry);
    expiry = setTimeout(() => { pending = null; }, 30000);
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'optidome-open-analysis', token });
      if (!reply?.ok) throw new Error('unavailable');
      button.textContent = t('analysisLaunch');
    } catch { pending = null; button.textContent = t('analysisReload'); }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'optidome-read-draft') return;
    // tabs.sendMessage may omit sender.url for extension pages. The extension
    // id plus the unguessable, single-use click capability authorises the read.
    if (sender.id !== chrome.runtime.id) return;
    if (!pending || message.token !== pending.token || pending.path !== location.pathname) { respond({ ok: false }); return; }
    const text = pending.text;
    pending = null;
    clearTimeout(expiry);
    respond({ ok: true, text });
  });
})();
