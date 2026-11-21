import {test} from 'node:test';
import assert from 'node:assert/strict';
import {priceOpenAiUsage} from '../server/openai-usage-pricing.ts';
import {TUTOR_MODELS} from '../lib/tutor-models.ts';

test('all selectable OpenAI models and paid speed levels have a rate',()=>{
  const now=Date.parse('2026-11-21T00:00:00Z');
  for(const model of TUTOR_MODELS){
    for(const speed of model.speeds){
      const tier=['auto','standard'].includes(speed)?'default':speed;
      assert.ok(priceOpenAiUsage(model.id,tier,{inputTokens:1_000,outputTokens:100},now)?.usd>0,model.id+' '+tier);
    }
  }
});
test('Sol rates account for long input, tier aliases, and dated rates',()=>{
  const usage={inputTokens:272_001,outputTokens:400};
  const fast=priceOpenAiUsage('gpt-6.1-sol-2026-07-01','priority',usage);
  assert.deepEqual(fast.rates,{input:8,output:30,cached:.4,write30m:10,write12h:20});
  const cost=priceOpenAiUsage('gpt-6.2-sol','ultrafast',{inputTokens:1_000,outputTokens:100},Date.parse('2027-03-01T07:59:59Z'));
  assert.equal(cost.rates.output,30);
  const after=priceOpenAiUsage('gpt-6.2-sol','ultrafast',{inputTokens:1_000,outputTokens:100},Date.parse('2027-03-01T08:00:00Z'));
  assert.equal(after.rates.output,60);
});
test('unpriced models, inconsistent counters and non-priced tiers produce no invoice price',()=>{
  assert.equal(priceOpenAiUsage('gpt-6.1-sol','scale',{inputTokens:3,outputTokens:2}),undefined);
  assert.equal(priceOpenAiUsage('unknown','default',{inputTokens:3,outputTokens:2}),undefined);
  assert.equal(priceOpenAiUsage('gpt-6.1-sol','default',{inputTokens:3,outputTokens:2,totalTokens:7}),undefined);
  assert.equal(priceOpenAiUsage('gpt-6.1-sol','default',{inputTokens:3,outputTokens:2,cachedTokens:4}),undefined);
});
