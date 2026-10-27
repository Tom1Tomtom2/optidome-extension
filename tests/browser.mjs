import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const extension = resolve('dist');
await mkdir('test-results', { recursive: true });
const context = await chromium.launchPersistentContext(resolve('test-results/profile'), {
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--lang=fr'],
  locale: 'fr-FR', viewport: { width: 1000, height: 800 },
});
const errors = [];
const external = [];
context.on('page', p => { p.on('pageerror', error => errors.push(error.message)); p.on('console', msg => { if (msg.type() === 'error') console.log('browser:', msg.text().slice(0, 300)); }); });
context.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  await sw.evaluate(() => chrome.storage.local.set({ trainingShown: true }));
  await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Composer fixture</h1><div id="prompt-textarea" contenteditable="true" role="textbox" style="border:1px solid;padding:20px"></div></body></html>' }));
  const source = await context.newPage();
  await source.goto('https://chatgpt.com/');
  const draft = 'Traduis en anglais : notre prochain rendez-vous aura lieu vendredi.';
  await source.locator('#prompt-textarea').fill(draft);
  await source.waitForTimeout(500);
  assert.equal(source.workers().length, 0, 'No model while typing');
  const opened = context.waitForEvent('page');
  await source.mouse.click(850, 716); // Native click into closed shadow root.
  const page = await opened;
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#draft');
  for (let i = 0; i < 50 && !(await page.locator('#draft').inputValue()); i++) await page.waitForTimeout(100);
  if (!(await page.locator('#draft').inputValue())) console.log('Import state:', page.url(), await page.locator('#snapshot').textContent(), errors);
  assert.equal(await page.locator('#draft').inputValue(), draft);
  assert.equal(page.workers().length, 0, 'Opening does not start inference');
  const before = await sw.evaluate(() => chrome.storage.local.get(null));
  const start = performance.now();
  await page.locator('#analyse').click();
  try { await page.waitForSelector('#result:not([hidden])', { timeout: 60000 }); }
  catch (error) { console.log('Analysis status:', await page.locator('#status').textContent()); throw error; }
  assert.equal(await page.locator('#result').isVisible(), true, await page.locator('#status').textContent());
  const coldMs = Math.round(performance.now() - start);
  await page.setViewportSize({ width: 470, height: 850 });
  await page.screenshot({ path: 'test-results/analysis-abstention.png', fullPage: true });
  const cases = JSON.parse(await readFile('tests/requests.json', 'utf8'));
  const labels = await page.evaluate(() => Object.fromEntries(['quick', 'standard', 'deep', 'unknown'].map(k => [chrome.i18n.getMessage('analysisLevel_' + k), k === 'unknown' ? null : k])));
  const results = [];
  for (const sample of cases) {
    await page.locator('#draft').fill(sample.text);
    assert.equal(await page.locator('#result').isVisible(), false, 'Edited input invalidates result');
    const tick = performance.now();
    await page.locator('#analyse').click();
    await page.waitForSelector('#result:not([hidden])', { timeout: 60000 });
    const level = labels[await page.locator('#recommendation').textContent()];
    results.push({ ...sample, actual: level, ms: Math.round(performance.now() - tick), correct: level === sample.expected });
    if (sample.text.startsWith('Définis une stratégie')) {
      await page.screenshot({ path: 'test-results/analysis.png', fullPage: true });
      await page.setViewportSize({ width: 320, height: 740 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: 'test-results/analysis-dark.png', fullPage: true });
      await page.emulateMedia({ colorScheme: 'light' });
      await page.setViewportSize({ width: 470, height: 850 });
    }
  }
  await writeFile('test-results/cases.json', JSON.stringify(results, null, 2));
  await page.locator('#context').check();
  await page.locator('#analyse').click();
  assert.equal(labels[await page.locator('#recommendation').textContent()], null);
  await page.locator('#context').uncheck();
  await page.locator('#draft').fill('Explique cette demande très longue. ' + 'contenu détaillé '.repeat(180));
  await page.locator('#analyse').click();
  await page.waitForSelector('#result:not([hidden])');
  assert.equal(labels[await page.locator('#recommendation').textContent()], null, 'No silent token truncation');
  // Cancel a live inference; no stale result may reappear.
  await page.reload();
  await page.waitForSelector('#draft');
  await page.locator('#draft').fill(draft);
  const workerStarted = page.waitForEvent('worker');
  await page.locator('#analyse').click();
  const running = await workerStarted;
  const stopped = new Promise(resolve => running.once('close', resolve));
  await page.locator('#cancel').click();
  await stopped;
  assert.equal(page.workers().length, 0);
  assert.equal(await page.locator('#result').isVisible(), false);
  const after = await sw.evaluate(() => chrome.storage.local.get(null));
  assert.equal(JSON.stringify(after).includes(draft), false, 'Draft never stored');
  assert.deepEqual(after, before, 'Analysis writes no counters or prompts');
  assert.equal(await source.locator('#prompt-textarea').innerText(), draft, 'Chat draft unchanged');
  assert.deepEqual(external.filter(url => url !== 'https://chatgpt.com/'), [], 'No remote calls');
  assert.deepEqual(errors, []);
  const answered = results.filter(x => x.actual !== null);
  const scored = results.filter(x => x.expected !== null);
  const report = { environment: { platform: process.platform, arch: process.arch, browser: context.browser().version(), backend: 'CPU/WASM, single thread' }, coldMs, total: results.length, labelledTasks: scored.length, answered: answered.length, correctWhenAnswered: answered.filter(x => x.correct).length, abstentions: results.filter(x => x.actual === null).length, dangerousDowngrades: results.filter(x => x.expected === 'deep' && x.actual === 'quick').length, caveat: 'Small authored development sample, not independently labelled or a comparison of downstream model answers.', results };
  await writeFile('test-results/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
} finally { await context.close(); }
