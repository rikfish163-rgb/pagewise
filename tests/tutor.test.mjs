import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSelection, answerSelectionWithMetadata, projectKey } from '../server/tutor.ts';
import { TUTOR_MODELS } from '../lib/tutor-models.ts';

test('the hosted Secret and the standard local binding both supply the tutor',()=>{
 assert.equal(projectKey({hts01:'host-fixture'}),'host-fixture');
 assert.equal(projectKey({OPENAI_API_KEY:'local-fixture'}),'local-fixture');
 assert.equal(projectKey({}),undefined);
});

const base={text:'sampling',question:'翻译',key:'fixture',history:[],memories:[]};
test('only the selected material, bounded conversation and course memories enter Responses',async()=>{
 let sent;
 const answer=await answerSelection({...base, unselectedPage:'PRIVATE REMAINDER', image:'data:image/png;base64,AAAA', memories:['sample frequency']},async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'采样'}]}]});
 });
 assert.equal(answer,'采样');assert.equal(sent.store,false);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE REMAINDER|fixture/);assert.match(JSON.stringify(sent),/input_image/);assert.match(JSON.stringify(sent),/sample frequency/);
});
test('incomplete and unavailable upstream do not become explanations or leak upstream text',async()=>{
 await assert.rejects(answerSelection(base,async()=>Response.json({status:'incomplete',output:[]})),/不完整/);
 await assert.rejects(answerSelection(base,async()=>new Response('PRIVATE',{status:401})),/密钥/);
 await assert.rejects(answerSelection({...base,key:''},()=>assert.fail('no network')),/密钥/);
});

test('each whitelisted model and reasoning effort reaches Responses with a usable output budget',async()=>{
 const budgets={none:1800,low:1800,medium:8192,high:25000,xhigh:32768,max:32768};
 for(const configuration of TUTOR_MODELS)for(const reasoningEffort of configuration.reasoningEfforts) {
  const model=configuration.id;
  await answerSelection({...base,model,reasoningEffort,image:'data:image/png;base64,AAAA'},async(_url,options)=>{
   const body=JSON.parse(options.body);
   assert.equal(body.model,model);assert.equal(body.reasoning.effort,reasoningEffort);
   assert.equal(body.max_output_tokens,budgets[reasoningEffort]);assert.match(JSON.stringify(body.input),/input_image/);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]});
  });
 }
});

test('legacy tutor callers keep mini/low and adapter rejects unsupported settings before networking',async()=>{
 await answerSelection(base,async(_url,options)=>{
  const body=JSON.parse(options.body);assert.equal(body.model,'gpt-5.4-mini');assert.equal(body.reasoning.effort,'low');
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]});
 });
 for(const settings of [{model:'arbitrary'},{model:null},{reasoningEffort:'minimal'},{reasoningEffort:null}]) {
  await assert.rejects(answerSelection({...base,...settings},()=>assert.fail('no network')),/模型|思考强度/);
 }
});

test('only explicit speed selection sends a processing tier, without changing reasoning',async()=>{
 for(const [speed,tier] of [[undefined,undefined],['auto',undefined],['standard','default'],['fast','fast'],['ultrafast','ultrafast']]) {
  const result=await answerSelectionWithMetadata({...base,model:'gpt-6.2-sol',reasoningEffort:'high',speed},async(_url,options)=>{
   const body=JSON.parse(options.body);assert.equal(body.service_tier,tier);assert.equal(body.reasoning.effort,'high');
   return Response.json({status:'completed',service_tier:'default',output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]});
  });
  assert.equal(result.answer,'ok');assert.equal(result.processing.serviceTier,'default');
  assert.equal(result.processing.fallback,speed==='fast'||speed==='ultrafast');
 }
});

test('actual tier handles legacy priority alias, downgrades and missing metadata honestly',async()=>{
 const reply=tier=>async()=>Response.json({status:'completed',service_tier:tier,output:[{type:'message',content:[{type:'output_text',text:'ok'}]}]});
 const fast=await answerSelectionWithMetadata({...base,speed:'fast'},reply('priority'));
 assert.equal(fast.processing.fallback,false);assert.match(fast.processing.message,/Fast/);
 const fallback=await answerSelectionWithMetadata({...base,speed:'fast'},reply('default'));
 assert.equal(fallback.processing.fallback,true);assert.match(fallback.processing.message,/回落/);
 for(const tier of [undefined,'PRIVATE UNTRUSTED']) {
  const missing=await answerSelectionWithMetadata({...base,speed:'fast'},reply(tier));
  assert.equal(missing.processing.serviceTier,null);assert.equal(missing.processing.fallback,null);assert.match(missing.processing.message,/未返回|无法确认/);assert.doesNotMatch(missing.processing.message,/PRIVATE/);
 }
 await assert.rejects(answerSelectionWithMetadata({...base,model:'gpt-5.4-nano',speed:'fast'},()=>assert.fail('no network')),/速度/);
});
test('answer TPS deducts reasoning tokens and requires usable metering',async()=>{
 const input={key:'fixture',question:'测试',history:[],memories:[],reasoningEffort:'low'};
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'答案'}]}]};
 async function measure(reasoning){
   const details=reasoning===undefined?{}:{reasoning_tokens:reasoning};
   return (await answerSelectionWithMetadata(input,async()=>Response.json({
     ...response,usage:{output_tokens:100,output_tokens_details:details}
   },{headers:{'openai-processing-ms':'2000'}}))).processing;
 }
 const result=await measure(60);
 assert.equal(result.tps,20);
 assert.equal(result.answerTokens,40);
 assert.equal(result.durationMs,2000);
 assert.equal(result.timingSource,'provider');
 assert.equal((await measure(undefined)).tps,undefined);
 assert.equal((await measure(100)).tps,undefined);
 assert.equal((await measure(101)).tps,undefined);
});
