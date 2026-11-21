import test from 'node:test';
import assert from 'node:assert/strict';
import {profileFrom,publicProfile,askPersonal,personalModels,probePersonal} from '../server/personal-api.ts';
const input={base:'https://models.example.com/v1/',model:'my-model',key:'test-only',protocol:'chat',vision:false};
test('validates destination and never returns key',()=>{
 const p=profileFrom(input);assert.equal(publicProfile(p).base,'https://models.example.com/v1');assert(!JSON.stringify(publicProfile(p)).includes(input.key));
 for(const base of ['http://models.example.com','https://localhost','https://127.1','https://[::1]','https://a.local','https://user:pass@api.example.com','https://m.example.com/v1?key=x']) assert.throws(()=>profileFrom({...input,base}));
});

test('preserves saved base URLs and normalizes only new request endpoints',async()=>{
 for(const [protocol,base,expected] of [
  ['chat','https://api.example.com','https://api.example.com/v1'],
  ['anthropic','https://anyrouter.top/','https://anyrouter.top/v1'],
  ['gemini','https://generativelanguage.googleapis.com','https://generativelanguage.googleapis.com/v1beta'],
  ['responses','https://api.example.com/custom/v2/responses','https://api.example.com/custom/v2'],
  ['gemini','https://api.example.com/proxy/v1beta/','https://api.example.com/proxy/v1beta'],
 ]) {
  const p=profileFrom({...input,protocol,base});assert.equal(p.base,base.replace(/\/+$/,''));assert.equal(p.endpointVersion,2);
  await askPersonal(p,{...q,image:undefined},async(url)=>{
   const suffix=protocol==='chat'?'/chat/completions':protocol==='responses'?'/responses':protocol==='anthropic'?'/messages':'/models/my-model:generateContent';
   assert.equal(url,expected+suffix);return Response.json(echoReply(protocol,'PW-12345678'));
  },async()=>{});
 }
});

test('new root probes choose per-protocol versions while legacy root/custom paths retain v8 request semantics',async()=>{
 const p=profileFrom({...input,base:'https://api.example.com/'});const urls=[];
 await probePersonal(p,'protocol',async(url,req)=>{
  urls.push(url);const protocol=url.endsWith('/chat/completions')?'chat':url.endsWith('/responses')?'responses':url.endsWith('/messages')?'anthropic':'gemini';return Response.json(echoReply(protocol,req.body));
 },async()=>{});
 assert.deepEqual(urls,['https://api.example.com/v1/chat/completions','https://api.example.com/v1/responses','https://api.example.com/v1/messages','https://api.example.com/v1beta/models/my-model:generateContent']);
 for(const base of ['https://api.example.com','https://api.example.com/custom']) {
  await askPersonal({...p,base,endpointVersion:undefined},{...q,image:undefined},async(url)=>{
   assert.equal(url,base+'/chat/completions');return Response.json(echoReply('chat','PW-12345678'));
  },async()=>{});
 }
});

test('selected models preserve current model, deduplicate safely, and never trust vision declarations',()=>{
 const p=profileFrom({...input,models:['other','my-model','other'],vision:true,visionModels:['other']});
 assert.deepEqual(publicProfile(p).models,['my-model','other']);assert.deepEqual(publicProfile(p).visionModels,[]);assert.equal(p.vision,false);
 assert.deepEqual(publicProfile({...p,models:undefined,visionModels:undefined,vision:true}).visionModels,['my-model']);
 assert.deepEqual(publicProfile({...p,models:undefined}).models,['my-model']);
 assert.throws(()=>profileFrom({...input,models:['bad model']}));
});

const q={question:'为什么',history:[{role:'assistant',content:'上一条'}],memories:['相关'],text:'波形',image:'data:image/png;base64,AAAA'};
test('native Anthropic and Gemini encode images, history and only their documented authentication',async()=>{
 for(const protocol of ['anthropic','gemini']) {
  const p={...profileFrom({...input,protocol}),vision:true};
  const answer=await askPersonal(p,q,async(url,req)=>{
   const body=JSON.parse(req.body);assert.equal(req.redirect,'error');assert.ok(!url.includes('test-only'));
   if(protocol==='anthropic') {
    assert.equal(url,p.base+'/messages');assert.equal(req.headers['x-api-key'],'test-only');assert.equal(req.headers.Authorization,undefined);assert.equal(req.headers['anthropic-version'],'2023-06-01');
    assert.equal(body.max_tokens,1800);assert.equal(body.messages[1].content[1].source.data,'AAAA');assert.equal(body.messages[1].content[1].source.media_type,'image/png');
    return Response.json({content:[{type:'text',text:'回答'}],stop_reason:'end_turn'});
   }
   assert.equal(url,p.base+'/models/my-model:generateContent');assert.equal(req.headers['x-goog-api-key'],'test-only');assert.equal(req.headers.Authorization,undefined);
   assert.equal(body.contents[0].role,'model');assert.equal(body.contents[1].parts[1].inlineData.data,'AAAA');assert.equal(body.contents[1].parts[1].inlineData.mimeType,'image/png');
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'回答'}]}}]});
  },async()=>{});assert.equal(answer,'回答');
 }
});

test('AnyRouter documented Anthropic auth-token flow uses one Bearer header',async()=>{
 const p=profileFrom({...input,base:'https://anyrouter.top',protocol:'anthropic'});
 await askPersonal(p,{...q,image:undefined},async(url,req)=>{
  assert.equal(url,'https://anyrouter.top/v1/messages');assert.equal(req.headers.Authorization,'Bearer test-only');assert.equal(req.headers['x-api-key'],undefined);
  return Response.json({content:[{type:'text',text:'ok'}],stop_reason:'end_turn'});
 },async()=>{});
});

test('protocol-specific model listing filters non-generating Gemini models and follows bounded metadata pagination',async()=>{
 for(const protocol of ['chat','responses','anthropic','gemini']){
  const p=profileFrom({...input,protocol});let calls=0;
  const models=await personalModels(p,async(url,req)=>{
   calls++;assert.equal(req.method,'GET');assert.equal(req.redirect,'error');
   if(protocol==='gemini')return Response.json(calls===1?{models:[{name:'models/gemini-a',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']}],nextPageToken:'next'}:{models:[{name:'models/gemini-b',supportedGenerationMethods:['generateContent']}]});
   if(protocol==='anthropic')return Response.json(calls===1?{data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'}:{data:[{id:'claude-b'}],has_more:false});
   return Response.json({data:[{id:'one'},{id:'bad model'},{id:'one'},{id:'two'}]});
  },async()=>{});
  assert.deepEqual(models,protocol==='gemini'?['gemini-a','gemini-b']:protocol==='anthropic'?['claude-a','claude-b']:['one','two']);
 }
});

function echoReply(protocol,body){
 const marker=body.match(/PW-[a-f0-9]{8}/)?.[0]??'wrong';
 return protocol==='chat'?{choices:[{finish_reason:'stop',message:{content:marker}}]}
  :protocol==='responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text:marker}]}]}
  :protocol==='anthropic'?{content:[{type:'text',text:marker}],stop_reason:'end_turn'}
  :{candidates:[{finishReason:'STOP',content:{parts:[{text:marker}]}}]};
}

test('connect uses metadata only and reports when endpoint/auth cannot be confirmed',async()=>{
 const p=profileFrom(input);let calls=0;
 const result=await probePersonal(p,'connect',async(url,req)=>{calls++;assert.equal(req.method,'GET');assert.ok(url.endsWith('/models'));return Response.json({data:[]});},async()=>{});
 assert.equal(calls,1);assert.equal(result.ok,true);assert.match(result.message,/不能|不代表|未验证/);
 const restricted=await probePersonal(p,'connect',async()=>new Response('KEY PRIVATE',{status:404}),async()=>{});
 assert.equal(restricted.ok,false);assert.match(restricted.message,/无法|不能|未能/);assert.doesNotMatch(JSON.stringify(restricted),/KEY PRIVATE|test-only/);
});

test('model performs a real short reply and protocol detection independently validates the selected model across four wire formats',async()=>{
 const p=profileFrom(input);let calls=0;
 const send=async(url,req)=>{
  calls++;const protocol=url.endsWith('/chat/completions')?'chat':url.endsWith('/responses')?'responses':url.endsWith('/messages')?'anthropic':'gemini';
  assert.equal(req.method,'POST');return Response.json(echoReply(protocol,req.body));
 };
 const model=await probePersonal(p,'model',send,async()=>{});assert.equal(model.ok,true);assert.equal(calls,1);
 const protocols=await probePersonal(p,'protocol',send,async()=>{});assert.equal(calls,5);assert.equal(protocols.results.length,4);assert.ok(protocols.results.every(r=>r.ok));
 const wrong=await probePersonal(p,'model',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'HTTP200 is not enough'}}]}),async()=>{});assert.equal(wrong.ok,false);
});

test('diagnostics fail closed before credentials are sent and sanitize network/upstream bodies',async()=>{
 const p=profileFrom(input);
 await assert.rejects(askPersonal(p,{...q,image:undefined},()=>assert.fail('no network'),async()=>{throw Error('private');}),/公网/);
 const result=await probePersonal(p,'protocol',async()=>{throw Error('test-only PRIVATE');},async()=>{});
 assert.ok(result.results.every(r=>!r.ok));assert.doesNotMatch(JSON.stringify(result),/test-only|PRIVATE/);
 for(const protocol of ['anthropic','gemini']){
  const selected=profileFrom({...input,protocol});
  await assert.rejects(askPersonal(selected,{...q,image:undefined},async()=>Response.json(protocol==='anthropic'?{content:[{type:'text',text:'partial'}],stop_reason:'max_tokens'}:{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'partial'}]}}]}),async()=>{}),/完整/);
 }
});

test('protocol probes run at most two at once and report timeout as unverified, not unsupported',async()=>{
 const p=profileFrom(input);let active=0,max=0;
 const result=await probePersonal(p,'protocol',async()=>{
  active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;
  throw new DOMException('upstream timeout PRIVATE','TimeoutError');
 },async()=>{});
 assert.equal(max,2);assert.ok(result.results.every(r=>!r.ok&&/超时/.test(r.message)&&/未.*验证|未.*确认/.test(r.message)));assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});

test('invalid successful envelopes, oversized bodies and remote image URLs are rejected safely',async()=>{
 for(const protocol of ['responses','anthropic','gemini']) {
  const p={...profileFrom({...input,protocol}),vision:true};
  await assert.rejects(askPersonal(p,{...q,image:undefined},async()=>Response.json({output:'PRIVATE',content:'PRIVATE',candidates:'PRIVATE'}),async()=>{}),/格式|完整/);
  await assert.rejects(askPersonal(p,{...q,image:'https://private.example/image'},()=>assert.fail('no network'),async()=>{}),/图片/);
 }
 await assert.rejects(askPersonal(profileFrom(input),{...q,image:undefined},async()=>new Response('x'.repeat(2_000_001)),async()=>{}),/过大/);
});
test('both protocols use only personal bearer, selected model and compatible parameters',async()=>{
 for(const protocol of ['chat','responses']){
 const p=profileFrom({...input,protocol});const answer=await askPersonal(p,{question:'为什么',history:[],memories:['相关'],text:'波形'},async(url,req)=>{
 assert.equal(url,p.base+(protocol==='chat'?'/chat/completions':'/responses'));assert.equal(req.headers.Authorization,'Bearer test-only');assert.equal(req.redirect,'error');const body=JSON.parse(req.body);assert.equal(body.model,'my-model');assert(!body.reasoning&&!body.service_tier);assert.match(req.body,/波形/);
 return Response.json(protocol==='chat'?{choices:[{finish_reason:'stop',message:{content:'回答'}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'回答'}]}]});
 },async()=>{});assert.equal(answer,'回答');}
});
import {assertPublicProvider} from '../server/public-provider.ts';
test('DNS validation rejects mixed public/private addresses before sending credentials',async()=>{
 const query=async()=>Response.json({Status:0,Answer:[{type:1,data:'8.8.8.8'},{type:28,data:'::1'}]});
 await assert.rejects(()=>assertPublicProvider('models.example.com',query));
});

import {probeVision} from '../server/vision-probe.ts';
import {inflateSync} from 'node:zlib';
test('vision is established by reading the random image, not by an accepted HTTP response or user declaration',async()=>{
 const p=profileFrom({...input,vision:true});assert.equal(p.vision,false);
 assert.equal(await probeVision(p,async(_p,q)=>{
  const png=Buffer.from(q.image.split(',')[1],'base64');let pos=8,rows;
  while(pos<png.length){const n=png.readUInt32BE(pos);if(png.toString('ascii',pos+4,pos+8)==='IDAT')rows=inflateSync(png.subarray(pos+8,pos+8+n));pos+=n+12;}
  return Array.from({length:6},(_,i)=>({220:'红',20:rows[2+120*i+15]===180?'绿':'蓝',250:rows[2+120*i+15]===220?'黄':'白',15:'黑'})[rows[1+120*i+15]]).join('');
 }),true);
 assert.equal(await probeVision(p,async()=>'图片已收到'),false);
 assert.equal(await probeVision(p,async()=>{throw Error('vision not supported')}),false);
});
