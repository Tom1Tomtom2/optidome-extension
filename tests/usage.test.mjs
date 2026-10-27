import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url), U=require('../usage.js');
test('prices add across providers and do not fabricate unknown-provider estimates',()=>{
 const d=U.aggregate({chatgpt:{auto:{turns:1,typed:1e6,billed:2e6,output:1e6}},claude:{auto:{turns:2,typed:1e6,billed:1e6,output:0}}});
 assert.equal(d.messages,3);assert.ok(Math.abs(d.low-14.1/U.usdPerEuro)<1e-8);assert.ok(Math.abs(d.high-16/U.usdPerEuro)<1e-8);
 assert.equal(U.aggregate({unknown:{x:{turns:2}}}).unpriced,2);
});
