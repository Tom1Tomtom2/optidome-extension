import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const extension = resolve('dist');
await mkdir('test-results', { recursive: true });
const context = await chromium.launchPersistentContext(resolve('test-results/providers-profile'), {
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--lang=fr'],
  locale: 'fr-FR', viewport: { width: 1000, height: 800 },
});
const fixtures = [
  { name: 'ChatGPT', url: 'https://chatgpt.com/', editor: '<div id="prompt-textarea" role="textbox" contenteditable="true"></div>' },
  { name: 'ChatGPT', url: 'https://chat.openai.com/', editor: '<textarea id="draft-fixture" data-id="root"></textarea>' },
  { name: 'Claude', url: 'https://claude.ai/new', editor: '<div id="draft-fixture" class="ProseMirror" contenteditable="true"><p><br></p></div>' },
  { name: 'Gemini', url: 'https://gemini.google.com/app', editor: '<rich-textarea><div id="draft-fixture" class="ql-editor" role="textbox" contenteditable="true"><p><br></p></div></rich-textarea>' },
  { name: 'Le Chat', url: 'https://chat.mistral.ai/chat', editor: '<div id="draft-fixture" class="tiptap ProseMirror" contenteditable="true"><p><br></p></div>' },
];
const errors = [], requests = [], reports = [];
context.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ trainingShown: true }));
  const before = await sw.evaluate(() => chrome.storage.local.get(null));
  for (const fixture of fixtures) {
    await context.route(fixture.url, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><h1>${fixture.name} composer fixture</h1><textarea id="search" placeholder="Search"></textarea><div hidden>${fixture.editor.replace('id="draft-fixture"', 'id="hidden-draft"').replace('id="prompt-textarea"', 'id="hidden-chatgpt"')}</div>${fixture.editor}<style>[contenteditable],textarea{min-height:60px;border:1px solid #ccc;display:block;margin:20px}</style></body></html>` }));
    const source = await context.newPage();
    await source.goto(fixture.url);
    const field = source.locator('#draft-fixture, #prompt-textarea');
    const text = `Peux-tu traduire en anglais : notre rendez-vous est reporté à vendredi matin ?`;
    await field.fill(text);
    await source.locator('#search').fill('This search box is not the chat draft.');
    await source.waitForTimeout(400);
    assert.equal(source.workers().length, 0);
    const opened = context.waitForEvent('page');
    await source.mouse.click(850, 716);
    const analysis = await opened;
    await analysis.waitForSelector('#draft');
    for (let i = 0; i < 50 && !(await analysis.locator('#draft').inputValue()); i++) await analysis.waitForTimeout(100);
    assert.equal(await analysis.locator('#draft').inputValue(), text, fixture.name + ' imports the actual composer');
    assert.ok((await analysis.locator('label[for="draft"]').textContent()).includes(fixture.name));
    assert.equal(analysis.workers().length, 0, 'Import never starts inference');
    await analysis.locator('#analyse').click();
    await analysis.waitForSelector('#result:not([hidden])', { timeout: 60000 });
    assert.equal(await analysis.locator('#recommendation').textContent(), 'Réflexion légère');
    const actual = await field.evaluate(el => el.tagName === 'TEXTAREA' ? el.value : el.innerText);
    assert.equal(actual, text, 'Original chat unchanged');
    reports.push({ provider: fixture.name, url: fixture.url, import: true, inference: true, noAutomaticAnalysis: true });
    if (fixture.name === 'Claude') await analysis.screenshot({ path: 'test-results/claude-analysis.png', fullPage: true });
    // If this SPA replaces the composer, the launcher must use the new one.
    await analysis.close();
    await field.evaluate(el => { const replacement = el.cloneNode(false); el.replaceWith(replacement); });
    await source.locator('#draft-fixture, #prompt-textarea').fill('Explique les bases de la programmation à un débutant.');
    const reopened = context.waitForEvent('page');
    await source.mouse.click(850, 716);
    const next = await reopened;
    await next.waitForSelector('#draft');
    for (let i = 0; i < 50 && !(await next.locator('#draft').inputValue()); i++) await next.waitForTimeout(100);
    assert.equal(await next.locator('#draft').inputValue(), 'Explique les bases de la programmation à un débutant.');
    assert.equal(next.workers().length, 0);
    await next.close(); await source.close();
  }
  assert.deepEqual(requests.filter(url => !fixtures.some(f => f.url === url)), [], 'No remote model calls');
  assert.deepEqual(await sw.evaluate(() => chrome.storage.local.get(null)), before, 'Analysis saves no prompts or extra counters');
  assert.deepEqual(errors, []);
  await writeFile('test-results/providers-report.json', JSON.stringify({ environment: { platform: process.platform, arch: process.arch, browser: context.browser().version() }, fixtures: reports, caveat: 'Real extension and WASM inference on synthetic provider editor fixtures, not logged-in live accounts.' }, null, 2));
  console.log(`All ${reports.length} provider origins passed import, manual-only inference and composer replacement checks.`);
} finally { await context.close(); }
