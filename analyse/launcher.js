// Separate from the existing usage observer. No text is read while typing.
(() => {
  const provider = OptidomeProviders.forUrl(location.href);
  if (!provider) return;
  const SELECTOR = provider.selectors.join(', ');
  const t = key => chrome.i18n.getMessage(key);
  const host = document.createElement('div');
  host.id = 'optidome-analysis-launcher';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `:host{all:initial}button{position:fixed;right:16px;bottom:64px;z-index:2147482999;border:1px solid #d9d8d3;border-radius:24px;padding:10px 16px;background:#fff;color:#131312;font:500 13px system-ui;box-shadow:0 3px 16px #0001;cursor:pointer}button:focus-visible{outline:2px solid #ff6d00;outline-offset:3px}button[hidden]{display:none}@media(prefers-color-scheme:dark){button{background:#26262a;color:#ecebe8;border-color:#45454c}}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('coachLaunch');
  button.title = t('coachLaunch');
  shadow.append(style, button);
  document.documentElement.append(host);
  let lastEditor = null;
  const visible = el => el?.isConnected && el.getClientRects().length &&
    getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert]') &&
    !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true' &&
    el.getAttribute('contenteditable') !== 'false';
  const editor = () => {
    if (visible(lastEditor) && lastEditor.matches(SELECTOR)) return lastEditor;
    // Prefer specific provider selectors. Never choose an arbitrary editable
    // element when several equally plausible composers are visible.
    for (const selector of provider.selectors) {
      const fields = [...document.querySelectorAll(selector)].filter(visible);
      if (fields.length === 1) return fields[0];
      if (fields.length > 1) return null;
    }
    return null;
  };
  document.addEventListener('focusin', event => {
    const field = event.target?.closest?.(SELECTOR);
    if (field && visible(field)) { lastEditor = field; update(); }
  }, true);
  let pending = null;
  let writeGrant = null;
  let expiry;
  let enabled = true;
  let scheduled = false;
  function update() { button.hidden = !enabled || !editor(); scheduled = false; }
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; setTimeout(update, 200); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'contenteditable', 'disabled', 'readonly', 'aria-disabled', 'inert'] });
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
    if (text.length > 200000) { button.textContent = t('analysisTooLong'); return; }
    const token = crypto.randomUUID();
    pending = { token, text, path: location.pathname };
    clearTimeout(expiry);
    expiry = setTimeout(() => { pending = null; }, 30000);
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'optidome-open-coach', token });
      if (!reply?.ok) throw new Error('unavailable');
      button.textContent = t('coachLaunch');
    } catch { pending = null; button.textContent = t('analysisReload'); }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'optidome-write-draft') {
      if(sender.id !== chrome.runtime.id || !writeGrant || message.token !== writeGrant.token ||
          writeGrant.path !== location.pathname || Date.now() > writeGrant.until ||
          typeof message.text !== 'string' || message.text.length > 200000) {respond({ok:false});return;}
      const field=editor();
      const current=field && (field.tagName==='TEXTAREA'?field.value:field.innerText);
      if(!field || current !== writeGrant.text){respond({ok:false});return;}
      field.focus();
      if(field.tagName==='TEXTAREA')field.setSelectionRange(0,field.value.length);
      else {const range=document.createRange();range.selectNodeContents(field);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);}
      const ok=document.execCommand('insertText',false,message.text);
      const actual=field.tagName==='TEXTAREA'?field.value:field.innerText;
      const normal = value => value.replace(/\r\n?/g,'\n').replace(/\n{2,}/g,'\n\n');
      if(ok && normal(actual)===normal(message.text)){writeGrant.text=actual;respond({ok:true});}else {writeGrant=null;respond({ok:false});}
      return;
    }
    if (message?.type !== 'optidome-read-draft') return;
    // tabs.sendMessage may omit sender.url for extension pages. The extension
    // id plus the unguessable, single-use click capability authorises the read.
    if (sender.id !== chrome.runtime.id) return;
    if (!pending || message.token !== pending.token || pending.path !== location.pathname) { respond({ ok: false }); return; }
    const text = pending.text;
    writeGrant = {...pending, until: Date.now()+5*60*1000};
    const grantToken=writeGrant.token;
    setTimeout(()=>{if(writeGrant?.token===grantToken)writeGrant=null;},5*60*1000);
    pending = null;
    clearTimeout(expiry);
    respond({ ok: true, text, provider: provider.name });
  });
})();
