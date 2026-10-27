import {chromium} from 'playwright-core';
import {resolve} from 'node:path';
import {mkdir,writeFile,mkdtemp} from 'node:fs/promises';
import assert from 'node:assert/strict';
const extension=resolve('dist');
await mkdir('test-results',{recursive:true});
const ctx=await chromium.launchPersistentContext(await mkdtemp(resolve('test-results/coach-profile-')),{executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--lang=fr'],locale:'fr-FR',viewport:{width:1000,height:800}});
const errors=[],requests=[];ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));ctx.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
try{
 const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');const id=new URL(sw.url()).host;
 await sw.evaluate(()=>chrome.storage.local.clear());
 const fixtures=[['ChatGPT','https://chatgpt.com/','<div id="prompt-textarea" role="textbox" contenteditable="true"></div>'],['ChatGPT','https://chat.openai.com/','<textarea data-id="root" id="draft-fixture"></textarea>'],['Claude','https://claude.ai/new','<div id="draft-fixture" class="ProseMirror" contenteditable="true"></div>'],['Gemini','https://gemini.google.com/app','<rich-textarea><div id="draft-fixture" class="ql-editor" role="textbox" contenteditable="true"></div></rich-textarea>'],['Le Chat','https://chat.mistral.ai/chat','<div id="draft-fixture" class="ProseMirror" contenteditable="true"></div>']];
 // Test the window fallback explicitly: native Chrome side-panel UI is not exposed
 // as a Playwright page in headless Chromium. The handler's setOptions still runs.
 await sw.evaluate(()=>{chrome.sidePanel.open=async()=>{throw new Error('headless test fallback');};});
 for(const [name,url,editor]of fixtures){
  await ctx.route(url,r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><body>${editor}<style>[contenteditable],textarea{min-height:60px;border:1px solid;margin:20px}</style></body></html>`}));
  const source=await ctx.newPage();await source.goto(url);const field=source.locator('#prompt-textarea,#draft-fixture');const original='Peux-tu traduire en anglais : notre rendez-vous est reporté à vendredi matin ?';await field.fill(original);
  const opening=ctx.waitForEvent('page');await source.mouse.click(850,716);const panel=await opening;
  await panel.waitForSelector('[data-go="reasoning"]');assert.equal(panel.workers().length,0);
  await panel.locator('[data-go="clarify"]').click();assert.equal(await panel.locator('[data-form="goal"]').inputValue(),original);
  await panel.locator('[data-form="goal"]').fill('Préparer la réunion');await panel.locator('[data-form="context"]').fill('6 personnes et 30 minutes');await panel.locator('[data-go="preview"]').click();
  await panel.locator('[data-go="apply"]').click();await panel.locator('#notice').filter({hasText:'remplacé'}).waitFor();
  assert.match(await field.evaluate(el=>el.value??el.innerText),/6 personnes/);
  await panel.locator('[data-go="undo"]').click();await panel.waitForTimeout(100);assert.equal(await field.evaluate(el=>el.value??el.innerText),original);
  // Reject stale writes instead of replacing a newly typed draft.
  await field.fill('Nouveau brouillon à conserver');await panel.locator('[data-go="apply"]').click();await panel.locator('#notice').filter({hasText:'changé'}).waitFor();assert.equal(await field.evaluate(el=>el.value??el.innerText),'Nouveau brouillon à conserver');
  await panel.locator('nav [data-go="home"]').click();await panel.locator('[data-go="reasoning"]').click();
  if(await panel.locator('[data-go="enable"]').count())await panel.locator('[data-go="enable"]').click();
  assert.equal(panel.workers().length,0);await panel.locator('#draft').fill(original);await panel.locator('#analyse').click();await panel.waitForSelector('#result:not([hidden])',{timeout:60000});assert.match(await panel.locator('#model-type').textContent(),/Rapide/);
  if(name==='Claude'){
   await panel.locator('#draft').fill('Traduis ce texte en anglais. '+ 'Texte de notes du projet. '.repeat(250)+' Traduis ce texte en anglais.');
   await panel.locator('#analyse').click();await panel.waitForSelector('#result:not([hidden])');assert.match(await panel.locator('#reason').textContent(),/limite/);
   await panel.locator('#excerpts').check();await panel.locator('#analyse').click();await panel.waitForSelector('#result:not([hidden])',{timeout:60000});assert.match(await panel.locator('#scope').textContent(),/partielle/);assert.equal(await panel.locator('#model-type').textContent(),'Pas de recommandation');
   await panel.locator('#task').fill('Traduis en anglais ce texte de présentation.');await panel.locator('#analyse').click();await panel.waitForSelector('#result:not([hidden])',{timeout:60000});assert.match(await panel.locator('#scope').textContent(),/description/);
  }
  await panel.locator('[data-go="settings"]').click();assert.equal(panel.workers().length,0,'Leaving analysis terminates the worker');
  await panel.close();await source.close();console.log(name+' import, preview, replace, undo, stale-write protection and manual inference passed.');
 }
 const page=await ctx.newPage();await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForSelector('#month');
 const date=await page.evaluate(()=>Usage.dateKey()),month=date.slice(0,7);
 await sw.evaluate(({date})=>chrome.storage.local.set({journal:{[date]:{chatgpt:{auto:{turns:4,typed:100,billed:300,output:100}},claude:{auto:{turns:2,typed:50,billed:90,output:100}}}},activity:{[date]:{conversations:{chatgpt:['a'],claude:['b']}}}}),{date});
 await page.locator('.chart-detail').filter({hasText:'6 messages'}).waitFor();
 assert.match(await page.locator('.chart-detail').textContent(),/2 conversations/);
 await page.locator('[data-go="metric-cost"]').click();assert.match(await page.locator('.chart-detail').textContent(),/€/);
 await page.screenshot({path:'test-results/coach-usage.png',fullPage:true});
 await page.locator('nav [data-go="advice"]').click();assert.equal(await page.locator('[data-go="data"]').count(),0);
 await page.locator('nav [data-go="learn"]').click();await page.locator('[data-go="quiz-0"]').click();await page.locator('[data-answer="1"]').click();assert.equal((await sw.evaluate(()=>chrome.storage.local.get('learned'))).learned,undefined);await page.locator('[data-answer="0"]').click();assert.deepEqual((await sw.evaluate(()=>chrome.storage.local.get('learned'))).learned,['effort']);
 await page.locator('[data-go="settings"]').click();await page.locator('#privacy-alerts').uncheck();assert.equal((await sw.evaluate(()=>chrome.storage.local.get('privacyAlerts'))).privacyAlerts,false);
 await page.locator('[data-go="data"]').click();await page.locator('[data-go="erase"]').click();await page.locator('[data-go="data"]').last().click();assert.ok((await sw.evaluate(()=>chrome.storage.local.get('journal'))).journal[date]);
 await page.locator('[data-go="erase"]').click();await page.locator('[data-go="confirm-erase"]').click();await page.locator('#notice').filter({hasText:'effacées'}).waitFor();assert.deepEqual(await sw.evaluate(()=>chrome.storage.local.get(null)),{});
 await page.setViewportSize({width:320,height:850});await page.emulateMedia({colorScheme:'dark'});await page.locator('nav [data-go="home"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/coach-mobile-dark.png',fullPage:true});
 assert.equal(JSON.stringify(await sw.evaluate(()=>chrome.storage.local.get(null))).includes('Traduis'),false);
 assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(u=>!fixtures.some(f=>f[1]===u)),[]);
 await writeFile('test-results/coach-report.json',JSON.stringify({providers:5,checks:['explicit inference','partial analysis','no quick downgrade from excerpts','draft preview/replace/undo','stale-write rejection','daily graph','cost toggle','privacy preference','quiz progress','reset confirmation','320px dark layout','no remote request'],limitations:['Synthetic provider editors, not authenticated accounts.','Native Chrome side-panel rendering needs a manual check; fallback window tested.']},null,2));
 console.log('Coach integration passed.');
}finally{await ctx.close();}
