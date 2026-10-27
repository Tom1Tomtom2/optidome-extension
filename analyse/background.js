// Opens a trusted extension page; the usage service worker never receives text.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'optidome-open-analysis') return;
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) ||
      sender.frameId !== 0 || !OptidomeProviders.forUrl(sender.url) ||
      !/^[0-9a-f-]{36}$/.test(message.token ?? '')) return;
  const query = new URLSearchParams({ tab: String(sender.tab.id), token: message.token });
  chrome.windows.create({ url: chrome.runtime.getURL(`analyse/index.html?${query}`), type: 'popup', width: 470, height: 740 })
    .then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(message?.type !== 'optidome-open-coach') return;
  if(sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
      !OptidomeProviders.forUrl(sender.url) || !/^[0-9a-f-]{36}$/.test(message.token??'')) return;
  const query=new URLSearchParams({tab:String(sender.tab.id),token:message.token});
  const path=`popup.html?${query}`;
  const fallback=()=>chrome.windows.create({url:chrome.runtime.getURL(path),type:'popup',width:470,height:850});
  // A native user click reaches this handler. Unsupported side panels fall back
  // to an extension window; no extra host permissions or network requests.
  const open=chrome.sidePanel ? chrome.sidePanel.setOptions({tabId:sender.tab.id,path,enabled:true})
    .then(()=>chrome.sidePanel.open({tabId:sender.tab.id})).catch(fallback) : fallback();
  open.then(()=>respond({ok:true})).catch(()=>respond({ok:false}));
  return true;
});
