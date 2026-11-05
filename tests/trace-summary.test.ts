import test from 'node:test';import assert from 'node:assert/strict';import {summarizeTraceMeasurements}from '../src/index.js';const t=(id:string,tokens?:number)=>({traceId:id,startTime:'2026-11-05T00:00:00Z',endTime:'2026-11-05T00:00:01Z',attributes:tokens===undefined?{}:{'gen_ai.usage.input_tokens':tokens}});
test('unknown usage never becomes zero',()=>{const x=summarizeTraceMeasurements([t('a',10),t('b')]);assert.equal(x.knownInputTokens,10);assert.equal(x.totalInputTokens,null);assert.equal(x.latencyP95Ms,1000);});
test('duplicate trace cannot inflate counters',()=>assert.throws(()=>summarizeTraceMeasurements([t('a',10),t('a',10)])));
test('empty latency unknown',()=>assert.equal(summarizeTraceMeasurements([]).latencyP50Ms,null));
