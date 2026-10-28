import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Usage=require('../usage.js');
test('daily conversation membership survives a month change and marks legacy gaps',async()=>{
 let store={journal:{'2026-09-30':{chatgpt:{auto:{turns:7}}}}}, day='2026-09-30';
 const handlers=[];
 const context=vm.createContext({console,Date,Number,Object,Promise,importScripts:()=>{},Usage:{...Usage,dateKey:()=>day},chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>handlers.push(f)}},storage:{local:{get:async()=>structuredClone(store),set:async v=>Object.assign(store,structuredClone(v)),clear:async()=>{store={};}}}}});
 vm.runInContext(readFileSync(new URL('../background.js',import.meta.url),'utf8'),context);
 const measure={provider:'chatgpt',conversation:'one',model:'auto',firstTurn:true,tokensSent:10,tokensReceived:20};
 context.measure=measure;
 await vm.runInContext('record(measure)',context);
 assert.equal(store.activity[day].complete,false,'old daily data cannot reconstruct all conversation IDs');
 day='2026-10-01';await vm.runInContext('record(measure)',context);await vm.runInContext('record(measure)',context);
 assert.deepEqual(store.activity[day].conversations.chatgpt,['one']);assert.equal(store.activity[day].complete,true);
 assert.deepEqual(store.activity['2026-09-30'].conversations.chatgpt,['one']);assert.equal(store.journal[day].chatgpt.auto.turns,2);
 const reply=await new Promise(resolve=>handlers.at(-1)({type:'optidome-reset'},{id:'test',url:'chrome-extension://test/popup.html',tab:{id:12}},resolve));
 assert.equal(reply.ok,true);assert.deepEqual(store,{});
});

test('tips after sending: quick mode once a week, redone answers, missing format',async()=>{
 let store={};
 const context=vm.createContext({console,Date,Number,Object,Promise,importScripts:()=>{},Usage,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:()=>{}}},storage:{local:{get:async()=>structuredClone(store),set:async v=>Object.assign(store,structuredClone(v)),clear:async()=>{store={};}}}}});
 vm.runInContext(readFileSync(new URL('../background.js',import.meta.url),'utf8'),context);
 const send=async extra=>{context.measure={provider:'chatgpt',conversation:'c',model:'auto',firstTurn:false,tokensSent:8,tokensReceived:20,...extra};return vm.runInContext('record(measure)',context);};
 assert.equal((await send({deep:true}))?.id,'mode','one line with deep reasoning');
 assert.equal(await send({deep:true}),null,'not twice in a week');
 assert.equal(await send({deep:true,tokensSent:200}),null,'a long message may need deep reasoning');
 const day=store.journal[Usage.dateKey()].chatgpt.auto;
 assert.equal(day.shortDeep,2);assert.equal(day.turns,3);
 assert.equal(await send({regenerated:true}),null);assert.equal(await send({regenerated:true}),null);
 assert.equal((await send({regenerated:true}))?.id,'regenerate','third answer redone');
 assert.equal(await send({regenerated:true}),null,'once per conversation');
 assert.equal((await send({followUpFix:true}))?.id,'fix');
 assert.equal(await send({followUpFix:true}),null,'once a month');
});

test('test mode: tips at every occasion, a log of numbers and shapes',async()=>{
 let store={testMode:true};
 const context=vm.createContext({console,Date,Number,Object,Promise,JSON,importScripts:()=>{},Usage,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:()=>{}}},storage:{local:{get:async()=>structuredClone(store),set:async v=>Object.assign(store,structuredClone(v)),clear:async()=>{store={};}}}}});
 vm.runInContext(readFileSync(new URL('../background.js',import.meta.url),'utf8'),context);
 const send=async extra=>{context.measure={provider:'claude',conversation:'c',model:'m',firstTurn:false,tokensSent:8,tokensReceived:20,deep:null,regenerated:null,...extra};return vm.runInContext('record(measure)',context);};
 assert.equal((await send({followUpFix:true}))?.id,'fix');
 assert.equal((await send({followUpFix:true}))?.id,'fix','again, no monthly limit in test mode');
 assert.equal((await send({regenerated:true}))?.id,'regenerate','from the first redone answer');
 assert.equal((await send({tokensSent:3500}))?.id,'long','long after a page of text');
 assert.equal(store.testLog.length,4);
 assert.equal(store.testLog[0].deep,null,'not read stays null');
 assert.equal(store.testLog[0].source,undefined);
 store.testMode=false;
 await send({followUpFix:true});
 assert.equal(store.testLog.length,4,'nothing logged once the test mode is off');
});
