// One allowlist for the launcher, background and provider integration tests.
// No model names: subscriptions and menus change independently of the analyser.
const OptidomeProviders = (() => {
  const definitions = [
    { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'], selectors: ['#prompt-textarea', 'textarea[data-id="root"]'] },
    { id: 'claude', name: 'Claude', hosts: ['claude.ai'], selectors: ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]'] },
    { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'], selectors: ['rich-textarea [contenteditable="true"]', '.ql-editor[contenteditable="true"][role="textbox"]'] },
    { id: 'mistral', name: 'Mistral', hosts: ['chat.mistral.ai'], selectors: ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea[data-testid="chat-input"]'] },
  ];
  for (const definition of definitions) {
    Object.freeze(definition.hosts); Object.freeze(definition.selectors); Object.freeze(definition);
  }
  function forUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.port) return null;
      return definitions.find(provider => provider.hosts.includes(url.hostname)) ?? null;
    } catch { return null; }
  }
  return Object.freeze({ definitions: Object.freeze(definitions), forUrl });
})();
if (typeof module !== 'undefined') module.exports = OptidomeProviders;
