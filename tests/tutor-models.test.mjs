import test from 'node:test';
import assert from 'node:assert/strict';
import { TUTOR_MODELS, intersectTutorModels, resolveTutorSettings, reconcileTutorSettings } from '../lib/tutor-models.ts';
import { discoverTutorModels } from '../server/tutor-models.ts';

test('official multimodal catalog includes current flagship, efficient tiers, mini and nano, with model-specific efforts',()=>{
 for(const id of ['gpt-6.2-astra','gpt-6.2-sol','gpt-6.1-terra','gpt-6-luna','gpt-5.4-mini','gpt-5.4-nano'])assert.ok(TUTOR_MODELS.some(m=>m.id===id),id);
 assert.throws(()=>resolveTutorSettings({model:'gpt-6.2-astra',reasoningEffort:'none'}),/思考强度/);
 assert.throws(()=>resolveTutorSettings({model:'gpt-5.4-mini',reasoningEffort:'max'}),/思考强度/);
 assert.equal(resolveTutorSettings({model:'gpt-6-luna',reasoningEffort:'max'}).reasoningEffort,'max');
 assert.equal(resolveTutorSettings({model:'gpt-6.2-sol',reasoningEffort:'high'}).model,'gpt-6.2-sol');
});

test('metadata intersection drops unknown, audio, fine-tuned models and deduplicates documented snapshots',()=>{
 const models=intersectTutorModels(['gpt-6.2-astra','gpt-5.4-mini-2026-03-17','gpt-5.4-mini','gpt-audio-1.5','ft:gpt-5.4:private','gpt-unpublished']);
 assert.deepEqual(models.map(m=>m.id),['gpt-6.2-astra','gpt-5.4-mini']);
 assert.equal(intersectTutorModels(['gpt-5.4-mini-2026-03-17'])[0].id,'gpt-5.4-mini-2026-03-17');
 assert.equal(resolveTutorSettings({model:'gpt-5.4-mini-2026-03-17'}).model,'gpt-5.4-mini-2026-03-17');
});

test('reconcile saved settings against actual choices and reset only unsupported effort',()=>{
 const models=intersectTutorModels(['gpt-6.2-astra','gpt-6-luna']);
 assert.deepEqual(reconcileTutorSettings({model:'gpt-6.2-astra',reasoningEffort:'none'},models),{model:'gpt-6.2-astra',reasoningEffort:'low'});
 assert.equal(reconcileTutorSettings({model:'gpt-5.4-mini',reasoningEffort:'low'},models).model,'gpt-6.2-astra');
 assert.equal(reconcileTutorSettings({model:'gpt-6-luna',reasoningEffort:'max'},models).reasoningEffort,'max');
 assert.equal(reconcileTutorSettings({model:'gpt-5.4-mini',reasoningEffort:'low'},[]),null);
});

test('speed is independent of reasoning, opt-in, and constrained to documented model tiers',()=>{
 assert.deepEqual(resolveTutorSettings({model:'gpt-5.4-mini',reasoningEffort:'high'}),{model:'gpt-5.4-mini',reasoningEffort:'high'});
 assert.equal(resolveTutorSettings({model:'gpt-5.4-mini',speed:'fast',reasoningEffort:'none'}).speed,'fast');
 assert.equal(resolveTutorSettings({model:'gpt-6.2-sol',speed:'ultrafast',reasoningEffort:'low'}).speed,'ultrafast');
 for(const settings of [{model:'gpt-5.4-nano',speed:'fast'},{model:'gpt-6-luna',speed:'ultrafast'},{speed:null},{speed:'priority'}])assert.throws(()=>resolveTutorSettings(settings),/速度/);
 const nano=intersectTutorModels(['gpt-5.4-nano']);
 assert.deepEqual(reconcileTutorSettings({model:'gpt-5.4-mini',reasoningEffort:'high',speed:'fast'},nano),{model:'gpt-5.4-nano',reasoningEffort:'high',speed:'standard'});
});

test('server requests official metadata with only server authorization and exposes curated fields',async()=>{
 const result=await discoverTutorModels('fixture-secret',async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer fixture-secret');
  return Response.json({object:'list',data:[{id:'gpt-6.2-astra',owned_by:'PRIVATE OWNER'},{id:'gpt-5.4-nano'},{id:'gpt-audio-1.5'}]});
 });
 assert.equal(result.status,'ready');assert.deepEqual(result.models.map(m=>m.id),['gpt-6.2-astra','gpt-5.4-nano']);
 assert.doesNotMatch(JSON.stringify(result),/fixture-secret|PRIVATE OWNER|gpt-audio/);
});

test('empty intersection differs from restricted, malformed and failed metadata; no secret or upstream details leak',async()=>{
 assert.equal((await discoverTutorModels('fixture',async()=>Response.json({data:[{id:'gpt-audio-1.5'}]}))).status,'empty');
 for(const send of [async()=>new Response('PRIVATE',{status:403}),async()=>Response.json({private:'PRIVATE'}),async()=>{throw Error('PRIVATE');}]) {
  const result=await discoverTutorModels('fixture-secret',send);assert.equal(result.status,'unavailable');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|fixture-secret/);
 }
 assert.equal((await discoverTutorModels('',()=>assert.fail('no network'))).status,'unavailable');
});
