import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {combineExcerpts} from '../analyse/policy.mjs';
const require=createRequire(import.meta.url), U=require('../usage.js');
test('calendar preserves unknown days, zero observations and future days',()=>{
 const d=U.days({'2026-02-02':{chatgpt:{auto:{turns:2,typed:100,billed:200,output:50}}}},{'2026-02-01':{conversations:{}}},'2026-02',new Date(2026,1,3,12));
 assert.equal(d.length,28);assert.equal(d[0].state,'observed');assert.equal(d[0].messages,0);
 assert.equal(d[1].messages,2);assert.equal(d[1].conversations,null);assert.equal(d[2].state,'missing');assert.equal(d[3].state,'future');
 assert.equal(U.days({}, {},'2024-02',new Date(2024,1,29)).length,29);
});
test('prices add across providers and do not fabricate unknown-provider estimates',()=>{
 const d=U.aggregate({chatgpt:{auto:{turns:1,typed:1e6,billed:2e6,output:1e6}},claude:{auto:{turns:2,typed:1e6,billed:1e6,output:0}}});
 assert.equal(d.messages,3);assert.ok(Math.abs(d.low-14.1/U.usdPerEuro)<1e-8);assert.ok(Math.abs(d.high-16/U.usdPerEuro)<1e-8);
 assert.equal(U.aggregate({unknown:{x:{turns:2}}}).unpriced,2);
});
test('partial analysis never downgrades to quick or resolves a disagreement',()=>{
 const r=level=>({level,reason:level,notes:[]});
 assert.equal(combineExcerpts([r('quick'),r('quick')]).level,null);
 assert.equal(combineExcerpts([r('standard'),r('deep')]).level,null);
 assert.equal(combineExcerpts([r('deep'),r('deep')]).level,'deep');
 assert.equal(combineExcerpts([r('standard'),r('standard')],['stakes']).level,null);
});
