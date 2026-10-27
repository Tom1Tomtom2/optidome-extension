// Opens a trusted extension page; the usage service worker never receives text.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'optidome-open-analysis') return;
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) ||
      !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(sender.url ?? '') ||
      !/^[0-9a-f-]{36}$/.test(message.token ?? '')) return;
  const query = new URLSearchParams({ tab: String(sender.tab.id), token: message.token });
  chrome.windows.create({ url: chrome.runtime.getURL(`analyse/index.html?${query}`), type: 'popup', width: 470, height: 740 })
    .then(() => respond({ ok: true })).catch(() => respond({ ok: false }));
  return true;
});
