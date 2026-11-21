import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { learningAccount, persistWithCredit, claimCreditRequest, reserveSiteBudget, settleSiteAnswer, releaseCreditRequest } from '../server/learning-credits.ts';
import { handleStudy, sameOriginWrite } from '../server/study-service.ts';
import { answerSelectionWithMetadata } from '../server/tutor.ts';
import { applyMigrations } from './sqlite-migrations.mjs';

function seedModelExpense(sql, milliCredits) {
  sql.prepare(`INSERT INTO model_credit_expenses(id,owner,request_id,credits_milli,created_at,study_date,source_id,detail)
    VALUES('prior','alice','prior',?,1,'2020-01-01','old','{}')`).run(-milliCredits);
}

// Inject at the Responses HTTP boundary so the real tutor parser supplies the billing metadata.
function openAIResponseFixture(input, {cost, text = '完成', status = 'completed', responseId = 'resp_test'}) {
  return answerSelectionWithMetadata(input, async url => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return Response.json({
      id:responseId, object:'response', model:'gpt-5.4-mini-2026-03-17', status, service_tier:'default',
      output:[{type:'message', role:'assistant', content:[{type:'output_text', text}]}],
      usage:{input_tokens:1200, output_tokens:300, total_tokens:1500,
        input_tokens_details:{cached_tokens:600}, output_tokens_details:{reasoning_tokens:200},
        ...(cost === undefined ? {} : {cost:{amount:cost, currency:'USD'}})},
    });
  });
}

function auditedCalls(sql, operationId) {
  return sql.prepare(`SELECT outcome, detail FROM site_model_usage
    WHERE owner='alice' AND operation_id=? ORDER BY rowid`).all(operationId)
    .map(row => ({outcome:row.outcome, ...JSON.parse(row.detail)}));
}

function setup({beforeFractionalMigration} = {}) {
  const sql = new DatabaseSync(':memory:');
  applyMigrations(sql,{to:4});
  beforeFractionalMigration?.(sql);
  applyMigrations(sql,{from:4});
  const db = { async batch(statements) {sql.exec('BEGIN');try {const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}, prepare(query) { let values=[]; return { bind(...v) { values=v; return this; }, async all() { return {results:sql.prepare(query).all(...values)}; }, async first() { return sql.prepare(query).get(...values) ?? null; }, async run() { return sql.prepare(query).run(...values); } }; } };
  const objects = new Map();
  const bucket = { async put(k,v) { objects.set(k,v); return {etag:"local"}; }, async get(k) { const v=objects.get(k); return v ? { etag:"local", body:v, async arrayBuffer(){return v instanceof ArrayBuffer?v:v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);} } : null; }, async delete(k) { for(const key of Array.isArray(k)?k:[k])objects.delete(key); } };
  let seen;
  const ctx = { db, bucket, probe:async()=>false, owner:'alice', key:'test-not-a-real-key', async answer(v) { seen=v; return '有依据的讲解'; } };
  const req = async (path, method='GET', value) => {
    if (value && value.source !== 'personal' && (path.endsWith('/ask') || path === 'memory/index')) {
      value = {requestId: crypto.randomUUID(), maxCredits: path === 'memory/index' ? 1 : 4, ...value};
    }
    const init={method};
    if(value instanceof FormData) init.body=value;
    else if(value) {init.body=JSON.stringify(value);init.headers={'content-type':'application/json'};}
    const response=await handleStudy(new Request('https://test/api/study/'+path,init),path.split('?')[0].split('/'),ctx);
    return {status:response.status, data:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};
  };
  const doc=async(course='信号处理')=>{ const form=new FormData();form.set('course',course);form.set('file',new File(['%PDF-1.7\ncontent'],'notes.pdf',{type:'application/pdf'}));return (await req('docs','POST',form)).data.id; };
  const thread=async(docId,text='傅里叶变换')=>(await req('threads','POST',{docId,page:1,text})).data.id;
  return {ctx,req,doc,thread,objects,sql,seen:()=>seen};
}

test('owner scoped upload, state, binary and selective deletion', async()=>{
  const s=setup();const d=await s.doc();const t=await s.thread(d);
  assert.equal((await s.req('state')).data.docs.length,1);
  assert.match((await s.req(`docs/${d}/file`)).data,/%PDF/);
  s.ctx.owner='bob';assert.deepEqual((await s.req('state')).data,{projects:[],docs:[],threads:[]});
  assert.equal((await s.req(`docs/${d}/file`)).status,404);
  assert.equal((await s.req(`threads/${t}`,'DELETE')).status,404);
  s.ctx.owner='alice';assert.equal((await s.req(`threads/${t}`,'DELETE')).status,200);
  assert.equal((await s.req('state')).data.docs.length,1);
  await s.thread(d);await s.req(`docs/${d}`,'DELETE');
  assert.deepEqual((await s.req('state')).data,{projects:[],docs:[],threads:[]});assert.equal(s.objects.size,0);
});

test('only relevant same-course owner memory enters tutor; missing keys retain question', async()=>{
  const s=setup();const d=await s.doc();const t=await s.thread(d);await s.req(`threads/${t}/ask`,'POST',{question:'傅里叶变换定义'});
  const unrelated=await s.thread(d,'量化误差');await s.req(`threads/${unrelated}/ask`,'POST',{question:'量化误差'});
  const other=await s.thread(await s.doc('另一门课程'));await s.req(`threads/${other}/ask`,'POST',{question:'傅里叶变换定义'});
  const target=await s.thread(d);const result=await s.req(`threads/${target}/ask`,'POST',{question:'傅里叶变换如何理解'});
  assert.equal(result.status,200);assert.deepEqual(result.data.refs,[t]);assert.equal(s.seen().memories.length,1);
  s.ctx.key=undefined;assert.equal((await s.req(`threads/${target}/ask`,'POST',{question:'继续'})).status,503);
  const saved=(await s.req('state')).data.threads.find(x=>x.id===target);assert.equal(saved.messages.at(-1).content,'继续');
  s.ctx.key='test';s.ctx.answer=async()=>{throw Error('secret upstream detail');};
  const failed=await s.req(`threads/${target}/ask`,'POST',{question:'重试'});assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed).includes('secret upstream'));
  s.ctx.answer=async()=>{throw Error('OpenAI 未完成讲解（429）：上游细节');};
  assert.match((await s.req(`threads/${target}/ask`,'POST',{question:'配额'})).data.error,/配额/);
  await s.req(`threads/${t}`,'DELETE');assert.equal((await s.req(`threads/${t}/ask`,'POST',{question:'已删除'})).status,404);
  assert.deepEqual((await s.req('state')).data.threads.find(x=>x.id===target).refs,[]);
});

test('reject anonymous, malformed selection, oversized or unsupported uploads',async()=>{
 const s=setup();s.ctx.owner='';assert.equal((await s.req('state')).status,401);s.ctx.owner='alice';
 const d=await s.doc();assert.equal((await s.req('threads','POST',{docId:d,page:0,text:'x'})).status,400);
 assert.equal((await s.req('threads','POST',{docId:d,page:1})).status,400);
 const f=new FormData();f.set('course','x');f.set('file',new File(['bad'],'bad.exe'));assert.equal((await s.req('docs','POST',f)).status,400);
 f.set('file',new File(['PKgarbage'],'bad.pptx'));assert.equal((await s.req('docs','POST',f)).status,400);
 f.set('file',new File(['%PDF-content'],'bad.pdf',{type:'text/html'}));assert.equal((await s.req('docs','POST',f)).status,400);
 const res=await handleStudy(new Request('https://test/api/study/docs',{method:'POST',headers:{'content-length':String(22*1024*1024)},body:'x'}),['docs'],s.ctx);assert.equal(res.status,413);
});

test('write origin must be exact and present',()=>{
 assert.equal(sameOriginWrite(new Request('https://test/api',{headers:{origin:'https://test'}})),true);
 for(const origin of [undefined,'https://evil','null'])assert.equal(sameOriginWrite(new Request('https://test/api',{headers:origin?{origin}:{}})),false);
});

test('model metadata route is owner-authenticated, private, and independent of document storage',async()=>{
 const s=setup();let queried=0;
 s.ctx.db=undefined;s.ctx.bucket=undefined;
 s.ctx.models=async key=>{queried++;assert.equal(key,'test-not-a-real-key');return {status:'ready',models:[{id:'gpt-6.2-astra'}],message:'已筛选'};};
 s.ctx.owner='';assert.equal((await s.req('models')).status,401);assert.equal(queried,0);
 s.ctx.owner='alice';const response=await handleStudy(new Request('https://test/api/study/models'),['models'],s.ctx);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal((await response.json()).models[0].id,'gpt-6.2-astra');assert.equal(queried,1);
 s.ctx.key=undefined;assert.equal((await s.req('models')).data.status,'unavailable');assert.equal(queried,1);
});

test('per-question model settings are validated before persistence and forwarded without sticky state',async()=>{
 const s=setup();const t=await s.thread(await s.doc());
 for(const settings of [{model:'arbitrary'},{model:''},{model:null},{reasoningEffort:'minimal'},{reasoningEffort:42},{reasoningEffort:null}]) {
  assert.equal((await s.req(`threads/${t}/ask`,'POST',{question:'解释',...settings})).status,400);
 }
 assert.deepEqual((await s.req('state')).data.threads[0].messages,[]);assert.equal(s.seen(),undefined);
 assert.equal((await s.req(`threads/${t}/ask`,'POST',{question:'推导',model:'gpt-5.4',reasoningEffort:'xhigh'})).status,200);
 assert.equal(s.seen().model,'gpt-5.4');assert.equal(s.seen().reasoningEffort,'xhigh');
 assert.equal((await s.req(`threads/${t}/ask`,'POST',{question:'翻译'})).status,200);
 assert.equal(s.seen().model,'gpt-5.4-mini');assert.equal(s.seen().reasoningEffort,'low');
});

test('ask forwards explicit speed and persists actual processing tier without breaking legacy string adapters',async()=>{
 const s=setup();const t=await s.thread(await s.doc());let seen;
 const processing={requestedSpeed:'fast',serviceTier:'default',fallback:true,message:'请求 Fast，API 实际使用标准档位（已回落）。'};
 s.ctx.answer=async input=>{seen=input;return {answer:'真实讲解',processing};};
 assert.equal((await s.req(`threads/${t}/ask`,'POST',{question:'解释',speed:'invalid'})).status,400);
 assert.deepEqual((await s.req('state')).data.threads[0].messages,[]);
 const result=await s.req(`threads/${t}/ask`,'POST',{question:'解释',speed:'fast'});
 assert.equal(result.status,200);assert.equal(seen.speed,'fast');assert.equal(result.data.answer,'真实讲解');assert.deepEqual(result.data.processing,processing);
 assert.deepEqual((await s.req('state')).data.threads[0].messages.at(-1).processing,processing);
 s.ctx.answer=async()=> '旧适配器';
 const legacy=await s.req(`threads/${t}/ask`,'POST',{question:'继续'});
 assert.equal(legacy.data.answer,'旧适配器');assert.equal(legacy.data.processing,undefined);
});

test('another owner cannot contribute memory; stale response never resurrects deleted thread',async()=>{
 const s=setup();const aliceDoc=await s.doc();const t=await s.thread(aliceDoc);
 s.ctx.owner='bob';const b=await s.thread(await s.doc());await s.req(`threads/${b}/ask`,'POST',{question:'傅里叶变换'});
 s.ctx.owner='alice';await s.req(`threads/${t}/ask`,'POST',{question:'傅里叶变换'});assert.deepEqual(s.seen().memories,[]);
 let finish;let entered;const started=new Promise(r=>{entered=r;});
 s.ctx.answer=async()=>{entered();return new Promise(r=>{finish=r;});};
 const asking=s.req(`threads/${t}/ask`,'POST',{question:'还在回答'});await started;
 await s.req(`threads/${t}`,'DELETE');finish('不会复活');assert.equal((await asking).status,409);
 assert.equal((await s.req('state')).data.threads.length,0);
});

test('selection images live in R2, authorized image URL serves bytes, tutor alone gets data URI',async()=>{
 const s=setup();const d=await s.doc();
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zHkAAAAASUVORK5CYII=';
 const id=(await s.req('threads','POST',{docId:d,page:1,image,text:'傅里叶图形'})).data.id;
 const stored=s.sql.prepare('SELECT image FROM threads WHERE id=?').get(id).image;
 assert.ok(stored.startsWith('selections/'));assert.ok(!stored.includes('base64'));
 const state=(await s.req('state')).data;
 assert.equal(state.threads[0].image,`/api/study/threads/${id}/image`);
 assert.ok(!JSON.stringify(state).includes('base64'));assert.ok(s.objects.has(stored));
 const response=await handleStudy(new Request(`https://test/api/study/threads/${id}/image`),['threads',id,'image'],s.ctx);
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
 assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'),image.split(',')[1]);
 s.ctx.owner='bob';assert.equal((await s.req(`threads/${id}/image`)).status,404);s.ctx.owner='alice';
 assert.equal((await s.req(`threads/${id}/ask`,'POST',{question:'傅里叶图形如何看'})).status,200);
 assert.equal(s.seen().image,image);
 const other=await s.thread(d,'傅里叶图形');await s.req(`threads/${other}/ask`,'POST',{question:'傅里叶图形'});
 assert.ok(s.seen().memories.length);assert.ok(!s.seen().memories.join('').includes('base64'));assert.equal(s.seen().image,undefined);
 await s.req(`threads/${id}`,'DELETE');assert.ok(!s.objects.has(stored));assert.equal((await s.req(`threads/${id}/image`)).status,404);
 const next=(await s.req('threads','POST',{docId:d,page:1,image})).data.id;
 const nextKey=s.sql.prepare('SELECT image FROM threads WHERE id=?').get(next).image;
 await s.req(`docs/${d}`,'DELETE');assert.ok(!s.objects.has(nextKey));assert.equal(s.objects.size,0);
});

test('personal configurations cannot cross accounts or silently fall back when changed',async()=>{
 const s=setup(),t=await s.thread(await s.doc());
 const config={base:'https://api.example.com/v1',model:'example',protocol:'chat',key:'not-a-real-secret',vision:false};
 const saved=await s.req('personal-api','POST',config);assert.equal(saved.status,200);assert.equal(saved.data.profile.key,undefined);
 assert.deepEqual((await s.req('personal-api')).data,saved.data);
 const changed=await s.req('personal-api','POST',config);assert.notEqual(changed.data.profile.revision,saved.data.profile.revision);
 assert.equal((await s.req('threads/'+t+'/ask','POST',{question:'解释',source:'personal',revision:saved.data.profile.revision})).status,409);
 s.ctx.owner='bob';assert.equal((await s.req('personal-api')).data.profile,null);await s.req('personal-api','DELETE');
 s.ctx.owner='alice';assert.deepEqual((await s.req('personal-api')).data,changed.data);
 await s.req('personal-api','DELETE');assert.equal((await s.req('personal-api')).data.profile,null);assert.equal(s.seen(),undefined);
});

test('personal ask uses saved owner configuration when site key is absent, persists answer, never uses site adapter',async(t)=>{
 const s=setup(),id=await s.thread(await s.doc());s.ctx.key=undefined;
 const {data:{profile}}=await s.req('personal-api','POST',{base:'https://api.openai.com/v1',model:'personal-model',models:['personal-model','alternate'],protocol:'chat',key:'test-private-bearer'});
 let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:1,data:'8.8.8.8'}]});
  calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer test-private-bearer');
  assert.equal(JSON.parse(init.body).model,calls===1?'personal-model':'alternate');
  return Response.json({choices:[{message:{content:'个人回复'},finish_reason:'stop'}]});
 });
 const reply=await s.req('threads/'+id+'/ask','POST',{source:'personal',revision:profile.revision,question:'解释'});
 assert.equal(reply.data.answer,'个人回复');assert.equal(calls,1);assert.equal(s.seen(),undefined);
 assert.equal((await s.req('state')).data.threads[0].messages.at(-1).content,'个人回复');
 const next=await s.req('threads/'+id+'/ask','POST',{source:'personal',revision:profile.revision,model:'alternate',question:'换个模型讲一次'});
 assert.equal(next.data.answer,'个人回复');assert.equal(calls,2);
 assert.equal(reply.data.creditsCharged,0);assert.equal(next.data.creditsCharged,0);
 assert.equal((await s.req('account')).data.totalSpent,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM site_model_usage').get().n,0);
});

test('vision flag is probed on save and can be rechecked using own stored key',async()=>{
 const s=setup();let success=false;
 s.ctx.probe=async(p)=>{assert.equal(p.key,'fixture-key');return success;};
 const {data:{profile}}=await s.req('personal-api','POST',{model:'my-vision',base:'https://api.example.com/v1',protocol:'responses',key:'fixture-key',vision:true});
 assert.equal(profile.vision,false);
 success=true;const result=await s.req('personal-api/vision','POST',{revision:profile.revision});assert.equal(result.data.profile.vision,true);
 s.ctx.owner='other';assert.equal((await s.req('personal-api/vision','POST',{revision:profile.revision})).status,404);
});

test('reuse saved key only for same owner, exact base and revision; draft tests do not save it',async()=>{
 const s=setup();const v={name:'个人模型',key:'test-a',base:'https://api.example.com/v1',protocol:'chat',model:'m'};
 const {data:{profile}}=await s.req('personal-api','POST',v);
 const body={...v,key:'',revision:profile.revision,kind:'model'};
 let seen;s.ctx.diagnose=async(p,kind)=>{seen={key:p.key,kind};return {results:[{protocol:'chat',ok:true,message:'成功'}]};};
 assert.equal((await s.req('personal-api/probe','POST',body)).status,200);
 assert.deepEqual(seen,{key:'test-a',kind:'model'});
 assert.equal((await s.req('personal-api/probe','POST',{...body,base:'https://other.example.com/v1'})).status,400);
 assert.equal((await s.req('personal-api/probe','POST',{...body,base:v.base+'/proxy'})).status,400);
 assert.equal((await s.req('personal-api/probe','POST',{...body,revision:'old'})).status,409);
 assert.deepEqual((await s.req('personal-api')).data.profile,profile);
 s.ctx.owner='bob';assert.notEqual((await s.req('personal-api/probe','POST',body)).status,200);
});
test('image verdict belongs to one selected model, never another; unknown model cannot be billed',async()=>{
 const s=setup();const d=await s.doc();const t=(await s.req('threads','POST',{docId:d,page:1,image:'data:image/png;base64,AAAA'})).data.id;
 s.ctx.probe=async p=>p.model==='camera';
 const v={base:'https://api.example.com/v1',key:'test-b',model:'text',models:['text','camera'],protocol:'chat'};
 const {data:{profile}}=await s.req('personal-api','POST',v);
 const {data:{profile:p}}=await s.req('personal-api/vision','POST',{revision:profile.revision,model:'camera'});
 assert.deepEqual(p.visionModels,['camera']);assert.equal(p.vision,false);
 const ask=model=>s.req('threads/'+t+'/ask','POST',{source:'personal',revision:p.revision,model,question:'读图'});
 assert.match((await ask('other')).data.error,/未选/);assert.match((await ask('text')).data.error,/图片/);
});

test('show key is explicit, owner scoped, never cached, and cannot reveal a site key',async()=>{
 const s=setup();const saved=await s.req('personal-api','POST',{key:'test-user-only',base:'https://api.example.com/v1',model:'text',protocol:'chat'});
 const revision=saved.data.profile.revision;
 assert.equal((await s.req('personal-api/reveal')).status,404);
 assert.equal((await s.req('personal-api/reveal','POST',{revision:'stale'})).status,409);
 const response=await handleStudy(new Request('https://test/api/study/personal-api/reveal',{method:'POST',body:JSON.stringify({revision})}),['personal-api','reveal'],s.ctx);
 assert.match(response.headers.get('cache-control'),/no-store/);
 assert.deepEqual(await response.json(),{key:'test-user-only'});
 s.ctx.owner='other';assert.equal((await s.req('personal-api/reveal','POST',{revision})).status,404);
});

test('editing a v8 root endpoint does not move it under /v1',async()=>{
 const s=setup();const old={base:'https://api.example.com',name:'old',key:'fixture-only',model:'old-model',protocol:'chat',revision:'v8',vision:false};
 s.objects.set('personal-api/alice.json',new TextEncoder().encode(JSON.stringify(old)));
 const result=await s.req('personal-api','POST',{...old,model:'new-model',key:''});
 assert.equal(result.status,200);assert.equal(result.data.profile.base,old.base);
 assert.equal(JSON.parse(new TextDecoder().decode(s.objects.get('personal-api/alice.json'))).endpointVersion,undefined);
});

test('private notebook survives document deletion and rejects stale saves',async()=>{
 const s=setup();const d=await s.doc();
 assert.equal((await s.req('notebook','POST',{body:'我的公式 $x^2$',revision:0})).status,200);
 assert.equal((await s.req('notebook','POST',{body:'旧草稿',revision:0})).status,409);
 s.ctx.owner='bob';assert.deepEqual((await s.req('notebook')).data,{body:'',revision:0});
 s.ctx.owner='alice';await s.req('docs/'+d,'DELETE');assert.equal((await s.req('notebook')).data.body,'我的公式 $x^2$');
});

test('project moves, pins and page context are owner scoped',async()=>{
 const s=setup();const d=await s.doc(),t=await s.thread(d);
 await s.req('docs/'+d+'/organize','POST',{pinned:true,course:'复习',visit:true});
 assert.equal((await s.req('state')).data.docs[0].pinned,1);
 assert.equal((await s.req('state')).data.docs[0].course,'复习');
 s.ctx.owner='bob';assert.equal((await s.req('docs/'+d+'/organize','POST',{course:'其他'})).status,404);
 s.ctx.owner='alice';await s.req('threads/'+t+'/ask','POST',{question:'第 2 页和第 3 页怎么理解？',context:'第 2 页 单位圆\n第 3 页 正弦',attachment:'data:image/jpeg;base64,YQ=='});
 assert.match(s.seen().text,/第 3 页 正弦/);assert.match(s.seen().image,/^data:image/);
});

test('an earlier stated difficulty can be reinforced in a later question on the same document',async()=>{
 const s=setup(),d=await s.doc(),a=await s.thread(d,'抽样定理');
 await s.req('threads/'+a+'/ask','POST',{question:'这个定义我不懂'});
 const b=await s.thread(d,'复习题');const r=await s.req('threads/'+b+'/ask','POST',{question:'怎么开始解题'});
 assert.deepEqual(r.data.refs,[a]);assert.match(s.seen().memories[0],/不懂/);
});

test('local gateway answers persist with optimistic concurrency',async()=>{
 const s=setup(),d=await s.doc(),t=await s.thread(d);
 const turn={question:'怎么推导？',answer:'本机讲解',previous:0};
 assert.equal((await s.req('threads/'+t+'/local-answer','POST',turn)).status,200);
 assert.equal((await s.req('threads/'+t+'/local-answer','POST',turn)).status,409);
 s.ctx.owner='bob';assert.equal((await s.req('threads/'+t+'/local-answer','POST',turn)).status,404);
});

test('removing the primary quotation sends only the remaining context',async()=>{
 const s=setup(),doc=await s.doc(),thread=await s.thread(doc,'第一段选文');
 await s.req('threads/'+thread+'/ask','POST',{question:'请解释',omitPrimaryText:true,context:'第二段选文'});
 assert.equal(s.seen().text,'第二段选文');
 const fresh=await s.req('threads','POST',{docId:doc,page:1,unanchored:true});
 assert.equal(fresh.status,200);
 await s.req('threads/'+fresh.data.id+'/ask','POST',{question:'请解释'});
 assert.equal(s.seen().text,undefined);
});

test('omitting the first crop preserves the remaining references independently',async()=>{
 const s=setup(),doc=await s.doc(),original='data:image/png;base64,YQ==',extra='data:image/jpeg;base64,Yg==';
 const {id}= (await s.req('threads','POST',{docId:doc,page:1,text:'保留文字',image:original})).data;
 const ask=(attachment)=>s.req('threads/'+id+'/ask','POST',{question:'比较',omitPrimaryImage:true,attachment,context:'追加文字'});
 assert.equal((await ask(extra)).status,200);assert.equal(s.seen().image,extra);assert.match(s.seen().text,/保留文字\n追加文字/);
 assert.equal((await ask()).status,200);assert.equal(s.seen().image,undefined);
});

test('site and Magpie get the same project context even without a shared keyword',async()=>{
 const s=setup(), first=await s.doc('化学'), second=await s.doc('化学'), other=await s.doc('其他');
 const earlier=await s.thread(first,'亲核体'), unrelated=await s.thread(other,'不相关资料');
 await s.req('threads/'+earlier+'/ask','POST',{question:'我分不清谁提供电子对'});
 await s.req('threads/'+unrelated+'/ask','POST',{question:'这个概念我没懂'});
 const current=await s.thread(second,'路易斯碱');
 const question='这个反应从哪里开始';
 const local=await s.req('threads/'+current+'/project-memory','POST',{question});
 assert.equal(local.status,200);
 assert.deepEqual(local.data.learningContext.map(entry=>entry.曾表示困惑),['我分不清谁提供电子对']);
 await s.req('threads/'+current+'/ask','POST',{question});
 assert.deepEqual(s.seen().learningContext,local.data.learningContext);
 s.ctx.owner='bob';assert.equal((await s.req('threads/'+current+'/project-memory','POST',{question})).status,404);
});

test('a mastered difficulty persists and stops being a project review cue',async()=>{
 const s=setup(),d=await s.doc(),t=await s.thread(d),next=await s.thread(d,'另一个概念');
 const question='这一步我分不清';
 await s.req('threads/'+t+'/ask','POST',{question});
 assert.equal((await s.req('threads/'+t+'/mastery','POST',{question,mastered:true})).status,200);
 assert.deepEqual((await s.req('state')).data.threads.find(row=>row.id===t).mastered,[question]);
 const getMemory=()=>s.req('threads/'+next+'/project-memory','POST',{question:'请讲解'});
 assert.equal((await getMemory()).data.learningContext[0].曾表示困惑,undefined);
 assert.equal((await getMemory()).data.learningContext[0].已掌握,true);
 await s.req('threads/'+t+'/mastery','POST',{question,mastered:false});
 assert.equal((await getMemory()).data.learningContext[0].曾表示困惑,question);
});

test('model index groups learning evidence across files and semantic search supplies source links',async()=>{
 const s=setup(),first=await s.doc('信号'),second=await s.doc('信号'),other=await s.doc('另一个项目');
 const a=await s.thread(first,'采样'),b=await s.thread(second,'数字频谱'),c=await s.thread(other,'线性代数');
 const q='为什么取样之后不同频率看起来一样？';
 const modelTasks=[];
 s.ctx.answer=async input=>{
   if(!input.modelTask)return '先比较它们在离散时间上的相位增量。';
   const task=JSON.parse(input.modelTask.input);
   modelTasks.push(task);
   if(task.samples)return JSON.stringify({records:task.samples.map(sample=>({
     n:sample.n,topic:'频谱混叠',detail:'把离散采样结果相同误当作原信号相同',kind:'gap',
   }))});
   return JSON.stringify({matches:[1]});
 };
 const ask=(id,question)=>s.req('threads/'+id+'/ask','POST',{question,sourcePage:4});
 await ask(a,q);
 await ask(c,'推导特征向量');
 const course='信号';
 assert.equal((await s.req('memory?course='+encodeURIComponent(course))).data.remaining,1);
 const indexed=await s.req('memory/index','POST',{course});
 assert.equal(indexed.status,200);assert.equal(indexed.data.indexed,true);
 const view=()=>s.req('memory?course='+encodeURIComponent(course));
 const [card]=(await view()).data.cards;
 assert.equal(card.stage,'review');assert.equal(card.evidence[0].page,4);assert.equal(card.evidence[0].question,q);
 assert.equal((await view()).data.remaining,0);
 assert.equal((await s.req('memory/index','POST',{course})).data.indexed,false);
 const answer=await ask(b,'低频和高频在这里为什么分不出来？');
 assert.deepEqual(answer.data.memorySources,[{topic:'频谱混叠',page:4,threadId:a}]);
 assert.equal(modelTasks.at(-1).candidates.length,1);
 assert.equal(modelTasks.at(-1).candidates[0].topic,'频谱混叠');
 assert.equal((await s.req('memory/status','POST',{course,topic:card.key,mastered:true})).status,200);
 assert.equal((await view()).data.cards[0].stage,'mastered');
 const local=await s.req('threads/'+b+'/project-memory','POST',{question:'重复谱线'});
 assert.equal(local.data.catalog[0].stage,'mastered');
 s.ctx.owner='bob';assert.deepEqual((await view()).data,{cards:[],remaining:0,indexed:0});
 assert.equal((await s.req('memory/status','POST',{course,topic:card.key,mastered:false})).status,404);
});

test('Magpie indexes leased batches once and merges progress into an existing topic',async()=>{
 const s=setup(),course='电路',d1=await s.doc(course),d2=await s.doc(course);
 const a=await s.thread(d1),b=await s.thread(d2);
 const save=(id,question)=>s.req('threads/'+id+'/local-answer','POST',{question,answer:'讲解',previous:0});
 await save(a,'输出相位是不是永远一样？');
 const start=()=>s.req('memory/start','POST',{course});
 const finish=(job,record)=>s.req('memory/finish','POST',{course,token:job.token,output:JSON.stringify({records:[record]})});
 const view=()=>s.req('memory?course='+encodeURIComponent(course));
 let first=(await start()).data.job;
 assert.equal((await start()).data.busy,true);
 assert.equal((await finish(first,{n:2,kind:'skip'})).status,422);
 assert.equal((await view()).data.remaining,1);
 first=(await start()).data.job;
 assert.equal((await finish(first,{n:1,kind:'gap',topic:'相位差',detail:'把不同频率的相位差看作常数'})).status,200);
 assert.equal((await finish(first,{n:1,kind:'skip'})).status,422);
 await save(b,'我用角频率差乘时间算相位差，这样推对吗？');
 const second=(await start()).data.job;
 const existing=JSON.parse(second.task.input).existing;
 assert.equal(existing[0].topic,'相位差');
 assert.equal((await finish(second,{n:1,kind:'progress',existing:1,detail:'能自己用角频率之差算相位差'})).status,200);
 const {cards,remaining,indexed}=(await view()).data;
 assert.equal(remaining,0);assert.equal(indexed,2);assert.equal(cards.length,1);
 assert.equal((await s.req('account')).data.totalSpent,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM site_model_usage').get().n,0);
 assert.equal(cards[0].stage,'practice');
 assert.deepEqual(new Set(cards[0].evidence.map(item=>item.threadId)),new Set([a,b]));
});

test('historical page mentions override the old reader position in memory evidence and citation links',async()=>{
 const s=setup(),course='页码回归',oldDoc=await s.doc(course),newDoc=await s.doc(course);
 const old=await s.thread(oldDoc),current=await s.thread(newDoc);
 await s.req('threads/'+old+'/local-answer','POST',{question:'第八页和第 12 页怎么看？',answer:'旧问答',previous:0});
 const {job}= (await s.req('memory/start','POST',{course})).data;
 assert.equal(JSON.parse(job.task.input).samples[0].page,8);
 await s.req('memory/finish','POST',{course,token:job.token,output:JSON.stringify({records:[{n:1,kind:'practice',topic:'对照',detail:'比较两页'}]})});
 const card=(await s.req('memory?course='+encodeURIComponent(course))).data.cards[0];
 assert.deepEqual(card.evidence[0].pages,[8,12]);
 assert.equal(card.evidence[0].page,8);
 const reply=await s.req('threads/'+current+'/local-answer','POST',{question:'怎么联系起来？',answer:'回答',previous:0,memoryKeys:[card.key]});
 assert.equal(reply.data.memorySources[0].page,8);
});

test('learning credits reward persisted actions once per owner and day without model access checks',async()=>{
 const s=setup(),d=await s.doc(),id=await s.thread(d);
 assert.equal((await s.req('account')).data.balance,10);
 s.ctx.displayName='学习者';
 assert.equal((await s.req('account?owner=bob&displayName=forged')).data.displayName,'学习者');
 s.ctx.key=undefined;
 assert.equal((await s.req(`threads/${id}/ask`,'POST',{question:'保存失败的问答'})).status,503);
 assert.equal((await s.req('account')).data.balance,10);
 const save=async previous=>s.req(`threads/${id}/local-answer`,'POST',{question:'真实问题',answer:'真实回答',previous});
 assert.equal((await save(1)).status,200);
 assert.equal((await save(1)).status,409);
 assert.equal((await save(3)).status,200);
 assert.equal((await s.req('account')).data.balance,15);
 assert.equal((await s.req('notebook','POST',{body:'   ',revision:0})).status,200);
 assert.equal((await s.req('account')).data.balance,15);
 assert.equal((await s.req('notebook','POST',{body:'我的笔记',revision:1})).status,200);
 assert.equal((await s.req('notebook','POST',{body:'过期笔记',revision:1})).status,409);
 assert.equal((await s.req('notebook','POST',{body:'我的笔记',revision:2})).status,200);
 const account=(await s.req('account')).data;
 assert.equal(account.balance,17);assert.equal(account.today.earned,7);assert.equal(account.ledger.length,3);
 assert.ok(account.rules.every(rule=>rule.earnedToday));assert.ok(account.ledger.every(row=>row.label&&row.createdAt&&row.studyDate));
 assert.equal(account.modelAccess,'credits');
 s.ctx.owner='bob';assert.equal((await save(5)).status,404);assert.equal((await s.req('account?owner=alice')).data.balance,10);
 await s.req('notebook','POST',{body:'另一个人的笔记',revision:0});assert.equal((await s.req('account')).data.balance,12);
 s.ctx.owner='alice';await s.req(`docs/${d}`,'DELETE');assert.equal((await s.req('account')).data.balance,17);
 s.ctx.bucket=undefined;assert.equal((await s.req('account')).status,200);
 s.ctx.owner='';assert.equal((await s.req('account')).status,401);
});

test('credits use Shanghai midnight, reject unchanged notes on next day and preserve lifetime totals',async(t)=>{
 const s=setup();let now=Date.parse('2026-11-21T15:59:59.999Z');t.mock.method(Date,'now',()=>now);
 await s.req('notebook','POST',{body:'笔记',revision:0});
 assert.equal((await s.req('account')).data.today.date,'2026-11-21');
 now++;
 assert.equal((await s.req('account')).data.today.date,'2026-11-22');
 await s.req('notebook','POST',{body:'笔记',revision:1});
 assert.equal((await s.req('account')).data.today.earned,0);
 await s.req('notebook','POST',{body:'新笔记',revision:2});
 const account=(await s.req('account')).data;
 assert.equal(account.balance,14);assert.equal(account.today.earned,2);
 assert.deepEqual(account.ledger.filter(row=>row.kind!=='initial_grant').map(row=>row.studyDate),['2026-11-22','2026-11-21']);
});

test('credit uniqueness survives repeated database statements and rolls back failed reward writes',async()=>{
 const s=setup(),db=s.ctx.db;
 const action=()=>db.prepare('INSERT OR REPLACE INTO notebooks(owner,body,revision) VALUES(?,?,?)').bind('alice','saved',1);
 await s.req('notebook');
 const now=Date.parse('2026-11-21T16:00:00Z');
 await persistWithCredit(db,action(),'alice','note_saved','notebook',true,now);
 // Sequential retry also proves the database uniqueness independently of application checks.
 await persistWithCredit(db,action(),'alice','note_saved','notebook',true,now);
 assert.equal((await learningAccount(db,'alice',now)).balance,12);
 s.sql.exec("CREATE TRIGGER fail_credit BEFORE INSERT ON learning_credits WHEN NEW.kind='discussion_completed' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
 await assert.rejects(persistWithCredit(db,db.prepare("UPDATE notebooks SET body='must roll back' WHERE owner='alice'"),'alice','discussion_completed','thread',true,now));
 assert.equal(s.sql.prepare("SELECT body FROM notebooks WHERE owner='alice'").get().body,'saved');
});

test('credit migration can follow a pre-existing compatible table and can be rerun',()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE learning_credits(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,credits INTEGER NOT NULL CHECK(credits>0),study_date TEXT NOT NULL,created_at INTEGER NOT NULL,source_id TEXT NOT NULL,UNIQUE(owner,study_date,kind))');
 const migration=readFileSync(new URL('../drizzle/0002_sharp_sunset_bain.sql',import.meta.url),'utf8');
 sql.exec(migration);sql.exec(migration);
 sql.prepare('INSERT INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('one','alice','note_saved',2,'2026-11-21',1,'notebook');
 assert.throws(()=>sql.prepare('INSERT INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('two','alice','note_saved',2,'2026-11-21',1,'notebook'));
});

test('discussion rewards reset at Shanghai midnight and lifetime balance includes older ledger pages',async(t)=>{
 const s=setup();let now=Date.parse('2026-11-21T15:59:59.999Z');t.mock.method(Date,'now',()=>now);
 const id=await s.thread(await s.doc());
 s.ctx.answer=async()=>({answer:'回答',usage:{costUsd:0.01}});
 const ask=()=>s.req(`threads/${id}/ask`,'POST',{question:'问题'});
 assert.equal((await ask()).status,200);now++;
 assert.equal((await ask()).status,200);
 assert.equal((await s.req('account')).data.balance,18);
 for(let i=1;i<=30;i++){
  const date=new Date(now-i*86400000).toISOString().slice(0,10);
  s.sql.prepare('INSERT OR IGNORE INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('old'+i,'alice','note_saved',2,date,now-i*86400000,'notebook');
  s.sql.prepare('INSERT OR IGNORE INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('discussion'+i,'alice','discussion_completed',5,date,now-i*86400000,'old-thread');
 }
 const response=await handleStudy(new Request('https://test/api/study/account'),['account'],s.ctx);
 assert.match(response.headers.get('cache-control'),/private, no-store/);
 const account=await response.json();
 assert.equal(account.ledger.length,50);assert.equal(account.balance,228);assert.equal(account.totalEarned,230);
 assert.equal(account.today.earned,5);assert.equal(account.rules[0].earnedToday,true);
});

test('site answer charges once, replays lost response, binds request payload, and stores safe provenance',async()=>{
 const s=setup(),id=await s.thread(await s.doc());let calls=0;
 s.ctx.answer=async()=>{calls++;return {answer:'完成',usage:{costUsd:0.01234}};};
 const body={question:'为什么',requestId:crypto.randomUUID()};
 const first=await s.req(`threads/${id}/ask`,'POST',body);
 assert.equal(first.status,200);assert.equal(first.data.creditsCharged,1.234);
 const replay=await s.req(`threads/${id}/ask`,'POST',body);assert.deepEqual(replay,first);assert.equal(calls,1);
 assert.equal((await s.req(`threads/${id}/ask`,'POST',{...body,question:'改问题'})).status,409);
 const account=(await s.req('account')).data;
 assert.equal(account.balance,13.766);assert.equal(account.totalEarned,15);assert.equal(account.totalSpent,1.234);
 const expense=account.ledger.find(row=>row.kind==='site_answer');assert.equal(expense.credits,-1.234);
 assert.partialDeepStrictEqual(expense.detail,{course:'信号处理',documentId:(await s.req('state')).data.docs[0].id,documentName:'notes.pdf',threadId:id,question:'为什么',page:1,model:'gpt-5.4-mini',source:'site'});
 assert.ok(!JSON.stringify(account).includes('test-not-a-real-key'));
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n,1);
 assert.equal((await s.req('state')).data.threads[0].messages.filter(m=>m.role==='assistant').length,1);
 s.ctx.owner='bob';assert.equal((await s.req('account')).data.balance,10);assert.equal((await s.req('account')).data.totalSpent,0);
});

test('failure and empty answer release hold; same key retries without duplicate saved question',async()=>{
 const s=setup(),id=await s.thread(await s.doc()),body={question:'重试',requestId:crypto.randomUUID()};
 s.ctx.answer=async()=>{throw Error('private');};assert.equal((await s.req(`threads/${id}/ask`,'POST',body)).status,502);
 assert.equal((await s.req('account')).data.balance,10);
 s.ctx.answer=async()=>'';assert.equal((await s.req(`threads/${id}/ask`,'POST',body)).status,502);
 assert.equal((await s.req('account')).data.totalSpent,0);
 s.ctx.answer=async()=>({answer:'完整',usage:{costUsd:0.01}});assert.equal((await s.req(`threads/${id}/ask`,'POST',body)).status,200);
 const messages=(await s.req('state')).data.threads[0].messages;
 assert.equal(messages.length,2);assert.equal(messages[1].content,'完整');
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n,1);
});

test('a fractional remaining balance is held before inference and caps the debit across concurrent requests',async()=>{
 const s=setup(),d=await s.doc(),a=await s.thread(d),b=await s.thread(d);await s.req('account');
 seedModelExpense(s.sql,9789);
 const partial=(await s.req('account?view=quote')).data;
 assert.equal(partial.availableBalance,0.211);
 let finish,started,calls=0;const entered=new Promise(resolve=>{started=resolve;});
 s.ctx.answer=async()=>{calls++;started();return new Promise(resolve=>{finish=resolve;});};
 const body={question:'竞争',requestId:crypto.randomUUID(),maxCredits:partial.availableBalance};
 const first=s.req(`threads/${a}/ask`,'POST',body);await entered;
 assert.equal((await s.req('account')).data.availableBalance,0);
 assert.equal((await s.req('account?view=quote')).data.availableBalance,0);
 assert.equal((await s.req('account?view=quote')).data.balance,0.211);
 assert.equal((await s.req(`threads/${a}/ask`,'POST',body)).status,409);
 const rejected=await s.req(`threads/${b}/ask`,'POST',{question:'第二个'});
 assert.equal(rejected.status,402);assert.equal(rejected.data.code,'insufficient_credits');assert.equal(calls,1);
 finish({answer:'完成',usage:{costUsd:0.04}});
 const settled=await first;assert.equal(settled.status,200);assert.equal(settled.data.creditsCharged,0.211);
 assert.equal((await s.req('account')).data.balance,5);
 assert.equal(s.sql.prepare("SELECT COUNT(*) n FROM model_credit_expenses WHERE request_id NOT LIKE 'prior%'").get().n,1);
});

test('answer CAS conflict and ledger write failure never charge or persist an assistant',async()=>{
 for(const mode of ['conflict','debit','receipt','reward']){
  const s=setup(),id=await s.thread(await s.doc());
  if(mode!=='conflict')s.sql.exec(mode==='debit'?"CREATE TRIGGER fail BEFORE INSERT ON model_credit_expenses BEGIN SELECT RAISE(ABORT,'failure'); END":mode==='receipt'?"CREATE TRIGGER fail BEFORE UPDATE OF response ON credit_requests WHEN NEW.response IS NOT NULL BEGIN SELECT RAISE(ABORT,'failure'); END":"CREATE TRIGGER fail BEFORE INSERT ON learning_credits BEGIN SELECT RAISE(ABORT,'failure'); END");
  s.ctx.answer=async()=>{if(mode==='conflict')s.sql.prepare('UPDATE threads SET messages=? WHERE id=?').run('[]',id);return {answer:'完整回答',usage:{costUsd:0.01}};};
  const reply=await s.req(`threads/${id}/ask`,'POST',{question:'原子提交'});
  assert.equal(reply.status,mode==='conflict'?409:502);
  assert.equal((await s.req('account')).data.balance,10);assert.equal((await s.req('account')).data.totalSpent,0);
  assert.ok(!(await s.req('state')).data.threads[0].messages.some(m=>m.role==='assistant'));
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM credit_requests WHERE response IS NOT NULL').get().n,0);
 }
});

test('account initialization and full ledger pagination preserve legacy rewards and owner isolation',async()=>{
 const s=setup();await Promise.all([s.req('account'),s.req('account'),s.req('account')]);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM credit_income').get().n,1);
 for(let i=0;i<125;i++)s.sql.prepare('INSERT INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('row'+String(i).padStart(3,'0'),'alice','note_saved',2,'day'+i,100,'notebook');
 const ids=[];let cursor;do{const page=await s.req('account'+(cursor?'?cursor='+encodeURIComponent(cursor):''));assert.equal(page.status,200);assert.equal(page.data.balance,260);ids.push(...page.data.ledger.map(x=>x.id));cursor=page.data.nextCursor;}while(cursor);
 assert.equal(ids.length,126);assert.equal(new Set(ids).size,126);
 assert.equal((await s.req('account?cursor=bad')).status,400);
 s.ctx.owner='bob';assert.equal((await s.req('account')).data.ledger.length,1);
});

test('creation request UUID survives lost response and rejects changed payload',async()=>{
 const s=setup(),docId=await s.doc(),body={docId,page:1,text:'选区',requestId:crypto.randomUUID()};
 const first=await s.req('threads','POST',body),replay=await s.req('threads','POST',body);
 assert.equal(first.status,200);assert.deepEqual(replay,first);
 assert.equal((await s.req('state')).data.threads.length,1);
 assert.equal((await s.req('threads','POST',{...body,text:'changed'})).status,409);
 const ask=await s.req(`threads/${first.data.id}/ask`,'POST',{question:'解释',requestId:body.requestId});assert.equal(ask.status,200);
});

test('generated credit migration upgrades populated previous schema without changing rewards',()=>{
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_study','0001_project_memory','0002_sharp_sunset_bain'])sql.exec(readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('old','alice','note_saved',2,'2026-11-21',1,'notebook');
 sql.exec(readFileSync(new URL('../drizzle/0003_spendable_credits.sql',import.meta.url),'utf8'));
 assert.equal(sql.prepare('SELECT credits FROM learning_credits').get().credits,2);
 assert.throws(()=>sql.prepare('INSERT INTO learning_credits VALUES(?,?,?,?,?,?,?)').run('negative','alice','note_saved',-1,'other',2,'notebook'));
 assert.throws(()=>sql.prepare('INSERT INTO credit_expenses VALUES(?,?,?,?,?,?,?,?)').run('bad','alice','bad',-2,1,'day','thread','{}'));
 const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
 assert.equal(journal.entries.find(entry=>entry.idx===3).tag,'0003_spendable_credits');
 const snapshot=JSON.parse(readFileSync(new URL('../drizzle/meta/0003_snapshot.json',import.meta.url),'utf8'));
 for(const table of ['credit_income','credit_requests','credit_expenses'])assert.ok(snapshot.tables[table]);
});

test('quote is small, authenticated, private, and excludes ledger/provenance and forged owner',async()=>{
 const s=setup();s.ctx.displayName='私密姓名';
 const result=await s.req('account?view=quote&owner=bob');
 assert.deepEqual(result.data,{balance:10,availableBalance:10,pricing:{creditsPerUsd:100,answerCap:4,memoryCap:1}});
 s.ctx.owner='';assert.equal((await s.req('account?view=quote')).status,401);
});

test('invalid UUID cannot infer; exhausted accounts may still save local answers and run memory',async()=>{
 const s=setup(),id=await s.thread(await s.doc());let calls=0;s.ctx.answer=async()=>{calls++;return '回答';};
 for(const requestId of [null,'',12,'not-uuid'])assert.equal((await s.req(`threads/${id}/ask`,'POST',{question:'解释',requestId})).status,400);
 assert.equal(calls,0);await s.req('account');
 seedModelExpense(s.sql,10000);
 const rejected=await s.req(`threads/${id}/ask`,'POST',{question:'没余额'});assert.equal(rejected.status,402);assert.equal(calls,0);
 const local=await s.req(`threads/${id}/local-answer`,'POST',{question:'本地',answer:'免费',previous:0});assert.equal(local.status,200);assert.equal(local.data.creditsCharged,0);
 assert.equal((await s.req('account')).data.totalSpent,10);assert.equal((await s.req('account')).data.balance,5);
});

test('expired claims release holds and fence old workers; only current token can settle once',async(t)=>{
 const s=setup(),id=await s.thread(await s.doc());let now=Date.parse('2026-11-21T00:00:00Z');t.mock.method(Date,'now',()=>now);
 const requestId=crypto.randomUUID(),db=s.ctx.db;
 const old=await claimCreditRequest(db,'alice',requestId,'fingerprint');assert.equal(await reserveSiteBudget(db,'alice',requestId,old.token,4),4);
 assert.equal((await s.req('account?view=quote')).data.availableBalance,6);
 now+=600000;
 const fresh=await claimCreditRequest(db,'alice',requestId,'fingerprint');assert.notEqual(fresh.token,old.token);assert.equal(fresh.busy,false);
 assert.equal(await reserveSiteBudget(db,'alice',requestId,fresh.token,4),4);
 const args={owner:'alice',requestId,token:old.token,threadId:id,pending:'[]',messages:'[{"role":"assistant","content":"完成"}]',refs:'[]',response:'{"answer":"完成","creditsCharged":1.003}',charge:1.003,detail:{}};
 assert.equal(await settleSiteAnswer(db,args),false);
 await releaseCreditRequest(db,'alice',requestId,old.token);
 assert.equal((await s.req('account?view=quote')).data.availableBalance,6);
 assert.equal(await settleSiteAnswer(db,{...args,token:fresh.token}),true);
 assert.equal(await settleSiteAnswer(db,{...args,token:fresh.token,pending:args.messages}),false);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n,1);
 assert.equal((await s.req('account?view=quote')).data.availableBalance,13.997);
});

test('OpenAI Responses with identical token counts debit only the reported USD amount', async () => {
  const s = setup(), id = await s.thread(await s.doc());
  for (const [cost, milli] of [[0.00123,123], [0.01678,1678], [undefined,0], [0.09123,4000]]) {
    const requestId = crypto.randomUUID();
    s.ctx.answer = input => openAIResponseFixture(input, {cost, responseId:'resp_' + requestId});
    const reply = await s.req(`threads/${id}/ask`, 'POST', {question:'解释', requestId});
    assert.equal(reply.status, 200);
    assert.equal(reply.data.creditsCharged, milli / 1000);
    const expense = s.sql.prepare('SELECT credits_milli,detail FROM model_credit_expenses WHERE request_id=?').get(requestId);
    assert.equal(expense.credits_milli, milli === 0 ? 0 : -milli);
    const [ledgerCall] = JSON.parse(expense.detail).calls;
    const audit = auditedCalls(s.sql, requestId);
    assert.equal(audit.length, 1);
    for (const call of [ledgerCall, audit[0]]) {
      assert.equal(call.totalTokens, 1500);
      assert.equal(call.costUsd, cost);
      assert.equal(call.purpose, 'answer');
      assert.equal(call.provider, 'openai');
      assert.equal(call.responseId, 'resp_' + requestId);
      assert.equal(call.model, 'gpt-5.4-mini-2026-03-17');
      assert.equal(call.meteredCredits, (cost ?? 0) * 100);
    }
    assert.equal(audit[0].outcome, 'completed');
  }
  const account = (await s.req('account')).data;
  assert.equal(account.totalSpent, 5.801);
  assert.equal(account.balance, 9.199);
});

test('site asks and index jobs reject missing, arbitrary and stale caps before inference', async () => {
  const s = setup(), course = '物理', id = await s.thread(await s.doc(course));
  await s.req(`threads/${id}/local-answer`, 'POST', {question:'索引', answer:'种子', previous:0});
  seedModelExpense(s.sql, 14789);
  const quoteBeforeReward = (await s.req('account?view=quote')).data;
  assert.equal(quoteBeforeReward.availableBalance, 0.211);
  assert.equal((await s.req('notebook','POST',{body:'新笔记', revision:0})).status, 200);
  const ask = `threads/${id}/ask`, index = 'memory/index';
  let calls = 0;
  s.ctx.answer = async () => { calls++; throw Error('unexpected inference'); };
  for (const [path, payload, cap] of [[ask, {question:'解释'}, 4], [index, {course}, 1]]) {
    const post = overrides => s.req(path, 'POST', {...payload, ...overrides});
    assert.equal((await post({requestId:undefined})).status, 400);
    assert.equal((await post({requestId:'malformed'})).status, 400);
    assert.equal((await post({maxCredits:undefined})).status, 428);
    for (const maxCredits of [null, '1', 0, -1, cap + 1, 0.0101]) {
      assert.equal((await post({maxCredits})).status, 400);
    }
    const stale = await post({maxCredits:quoteBeforeReward.availableBalance});
    assert.equal(stale.status, 409);
    assert.equal(stale.data.code, 'quote_changed');
  }
  assert.equal(calls, 0);
  assert.equal((await s.req('account?view=quote')).data.availableBalance, 2.211);
  assert.equal((await s.req('state')).data.threads[0].messages.length, 2);
  assert.equal((await s.req('memory?course=' + encodeURIComponent(course))).data.remaining, 1);
});

test('fractional migration preserves old holds, debits, rewards and an uncapped ask receipt', async () => {
  const id = crypto.randomUUID(), requestId = crypto.randomUUID(), question = '历史问题';
  // Hash the actual pre-0004 payload independently of the current service fingerprint.
  const legacyParts = [id, question, null, null, false, false, null, {model:'gpt-5.4-mini', reasoningEffort:'low'}];
  const fingerprint = createHash('sha256').update(JSON.stringify(legacyParts)).digest('hex');
  const receipt = {answer:'原回复', refs:[], creditsCharged:1};
  const s = setup({beforeFractionalMigration(sql) {
    sql.exec(`INSERT INTO documents VALUES('doc','alice','notes.pdf','pdf','物理','key',1);
      INSERT INTO credit_income VALUES('grant','alice',10,1);
      INSERT INTO learning_credits VALUES('reward','alice','discussion_completed',5,'2020-01-01',1,'old');`);
    sql.prepare("INSERT INTO threads(id,owner,doc_id,page,created) VALUES(?,'alice','doc',1,1)").run(id);
    sql.prepare('INSERT INTO credit_expenses VALUES(?,?,?,?,?,?,?,?)')
      .run('old','alice',requestId,-1,1,'2020-01-01',id,'{}');
    const claim = sql.prepare('INSERT INTO credit_requests VALUES(?,?,?,?,?,?,?)');
    claim.run('alice', requestId, fingerprint, 1, 'done', 1, JSON.stringify(receipt));
    claim.run('alice', crypto.randomUUID(), 'another', 1, 'live', Date.now()+600000, null);
  }});
  assert.equal(s.sql.prepare('SELECT credits FROM credit_income').get().credits, 10);
  assert.equal(s.sql.prepare('SELECT credits FROM learning_credits').get().credits, 5);
  assert.equal(s.sql.prepare('SELECT credits FROM credit_expenses').get().credits, -1);
  const hold = s.sql.prepare('SELECT reserved, reserved_milli FROM credit_requests WHERE token=?');
  assert.deepEqual({...hold.get('live')}, {reserved:1, reserved_milli:0});
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n, 0);
  assert.deepEqual(await s.req(`threads/${id}/ask`, 'POST', {question, requestId, maxCredits:undefined}),
    {status:200, data:receipt});
  assert.equal(s.seen(), undefined);
  const account = (await s.req('account')).data;
  assert.equal(account.balance, 14);
  assert.equal(account.availableBalance, 13);
  assert.equal(account.totalSpent, 1);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM site_model_usage').get().n, 0);

  const newId = crypto.randomUUID();
  let pendingHold, pendingQuote;
  s.ctx.answer = async () => {
    pendingHold = s.sql.prepare('SELECT reserved,reserved_milli FROM credit_requests WHERE request_id=?').get(newId);
    pendingQuote = (await s.req('account?view=quote')).data;
    return {answer:'新回答', usage:{costUsd:0.01234}};
  };
  const answer = await s.req(`threads/${id}/ask`, 'POST', {question:'新问题', requestId:newId});
  assert.equal(answer.status, 200);
  assert.equal(answer.data.creditsCharged, 1.234);
  assert.deepEqual({...pendingHold}, {reserved:0, reserved_milli:4000});
  assert.equal(pendingQuote.availableBalance, 9);
  assert.deepEqual({...hold.get('live')}, {reserved:1, reserved_milli:0});
  assert.deepEqual(s.sql.prepare('SELECT credits FROM credit_expenses').all().map(row => row.credits), [-1]);
  const debit = s.sql.prepare('SELECT credits_milli FROM model_credit_expenses WHERE request_id=?').get(newId);
  assert.equal(debit.credits_milli, -1234);
  const mixed = (await s.req('account')).data;
  assert.equal(mixed.totalSpent, 2.234);
  assert.equal(mixed.balance, 17.766);
  assert.equal(mixed.availableBalance, 16.766);
  assert.deepEqual(mixed.ledger.filter(row => row.kind === 'site_answer').map(row => row.credits), [-1.234,-1]);
});

test('site index settles once; retrieval and answer share one charge only on a saved answer', async () => {
  const s = setup(), course = '信号', doc = await s.doc(course);
  const earlier = await s.thread(doc, '相位'), current = await s.thread(doc, '相位差');
  await s.req(`threads/${earlier}/local-answer`, 'POST', {question:'相位', answer:'定义', previous:0});
  let failAnswer = true, failRetrieval = false;
  s.ctx.answer = input => {
    if (input.modelTask) {
      const task = JSON.parse(input.modelTask.input);
      if (task.samples) return openAIResponseFixture(input, {responseId:'resp_index', cost:0.02012,
        text:JSON.stringify({records:[{n:1, kind:'gap', topic:'相位', detail:'区分相位差'}]})});
      return openAIResponseFixture(input, {responseId:'resp_search', cost:0.005004, text:'{"matches":[1]}',
        status:failRetrieval ? 'incomplete' : 'completed'});
    }
    return openAIResponseFixture(input, {responseId:'resp_answer', cost:0.002004, status:failAnswer ? 'incomplete' : 'completed'});
  };
  const indexId = crypto.randomUUID();
  const index = () => s.req('memory/index', 'POST', {course, requestId:indexId});
  const indexed = await index();
  assert.deepEqual(indexed, {status:200, data:{indexed:true, creditsCharged:1}});
  assert.deepEqual(await index(), indexed);
  const audit = auditedCalls(s.sql, indexId);
  assert.equal(audit.length, 1);
  assert.partialDeepStrictEqual(audit[0], {outcome:'completed', purpose:'index', costUsd:0.02012});
  const expense = s.sql.prepare('SELECT kind,credits_milli,detail FROM model_credit_expenses WHERE request_id=?');
  const indexRow = expense.get(indexId);
  assert.equal(indexRow.kind, 'site_memory');
  assert.equal(indexRow.credits_milli, -1000);
  assert.partialDeepStrictEqual(JSON.parse(indexRow.detail), {cap:1, meteredCredits:2.012, sponsoredCredits:1.012});
  const requestId = crypto.randomUUID();
  const ask = () => s.req(`threads/${current}/ask`, 'POST', {requestId, question:'怎么计算相位差？'});
  assert.equal((await ask()).status, 502);
  const failed = auditedCalls(s.sql, requestId);
  assert.deepEqual(failed.map(call => [call.purpose, call.outcome, call.costUsd, call.responseId]), [
    ['retrieval','completed',0.005004,'resp_search'], ['answer','failed',0.002004,'resp_answer'],
  ]);
  assert.equal(expense.get(requestId), undefined);
  assert.equal((await s.req('account?view=quote')).data.availableBalance, 14);

  failAnswer = false;
  const saved = await ask();
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.memorySources, [{topic:'相位', page:1, threadId:earlier}]);
  // 0.5004 + 0.2004 is rounded once to 0.701 points.
  assert.equal(saved.data.creditsCharged, 0.701);
  assert.deepEqual(await ask(), saved);
  const answerRow = expense.get(requestId);
  assert.equal(answerRow.credits_milli, -701);
  assert.deepEqual(JSON.parse(answerRow.detail).calls.map(call => call.purpose), ['retrieval','answer']);
  assert.equal(auditedCalls(s.sql, requestId).length, 4);
  const account = (await s.req('account')).data;
  assert.equal(account.totalSpent, 1.701);
  assert.equal(account.balance, 13.299);

  failRetrieval = true;
  const fallbackId = crypto.randomUUID();
  const fallback = await s.req(`threads/${current}/ask`, 'POST', {requestId:fallbackId, question:'再解释一次'});
  assert.equal(fallback.status, 200);
  assert.equal(fallback.data.creditsCharged, 0.200);
  assert.deepEqual(auditedCalls(s.sql, fallbackId).map(call => [call.purpose,call.outcome,call.costUsd]), [
    ['retrieval','failed',0.005004], ['answer','completed',0.002004],
  ]);
});

test('invalid index output and failed index settlement leave evidence pending and release the hold', async () => {
  const s = setup(), course = '信号', id = await s.thread(await s.doc(course));
  await s.req(`threads/${id}/local-answer`, 'POST', {question:'相位', answer:'定义', previous:0});
  const requestId = crypto.randomUUID();
  const index = () => s.req('memory/index', 'POST', {requestId, course});
  let output = '{"records":[]}';
  s.ctx.answer = async () => ({answer:output, usage:{costUsd:0.00456}});
  for (const reason of ['invalid output', 'ledger failure']) {
    if (reason === 'ledger failure') {
      output = '{"records":[{"n":1,"kind":"skip"}]}';
      s.sql.exec("CREATE TRIGGER fail_index BEFORE INSERT ON model_credit_expenses BEGIN SELECT RAISE(ABORT,'fixture'); END");
    }
    assert.equal((await index()).status, 502);
    assert.equal((await s.req('memory?course=' + encodeURIComponent(course))).data.remaining, 1);
    assert.equal((await s.req('account?view=quote')).data.availableBalance, 15);
    assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n, 0);
  }
  assert.deepEqual(auditedCalls(s.sql, requestId).map(call => call.costUsd), [0.00456, 0.00456]);
  s.sql.exec('DROP TRIGGER fail_index');
  assert.deepEqual((await index()).data, {indexed:true, creditsCharged:0.456});
  assert.equal((await s.req('memory?course=' + encodeURIComponent(course))).data.remaining, 0);
  assert.equal((await s.req('account')).data.totalSpent, 0.456);
});

test('personal indexing, retrieval and answer work at zero available credits', async t => {
  const s = setup(), course = '物理', doc = await s.doc(course), first = await s.thread(doc), next = await s.thread(doc);
  await s.req(`threads/${first}/local-answer`, 'POST', {question:'相位', answer:'角度', previous:0});
  seedModelExpense(s.sql, 15000);
  assert.equal((await s.req('account?view=quote')).data.availableBalance, 0);
  const profile = (await s.req('personal-api','POST',{base:'https://api.openai.com/v1', model:'mine', protocol:'chat', key:'fixture'})).data.profile;
  const own = {source:'personal', revision:profile.revision};
  const responses = ['{"records":[{"n":1,"kind":"gap","topic":"相位","detail":"相位差"}]}', '{"matches":[1]}', '个人回答'];
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.startsWith('https://cloudflare-dns.com/')) return Response.json({Status:0, Answer:[{type:1,data:'8.8.8.8'}]});
    return Response.json({choices:[{finish_reason:'stop',message:{content:responses.shift()}}], usage:{cost:1}});
  });
  s.ctx.key = undefined;
  assert.deepEqual((await s.req('memory/index','POST',{...own, course})).data, {indexed:true, creditsCharged:0});
  const answer = await s.req(`threads/${next}/ask`, 'POST', {...own, question:'怎么理解相位？'});
  assert.equal(answer.status, 200);
  assert.equal(answer.data.answer, '个人回答');
  assert.equal(answer.data.creditsCharged, 0);
  assert.deepEqual(answer.data.memorySources, [{topic:'相位', threadId:first, page:1}]);
  assert.deepEqual(responses, []);
  assert.equal((await s.req('account')).data.totalSpent, 15);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM site_model_usage').get().n, 0);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM model_credit_expenses').get().n, 1);
});

test('paused site model rejects new answers and indexing before inference and preserves settled replays', async () => {
  const s=setup(), doc=await s.doc(), thread=await s.thread(doc);
  const path=`threads/${thread}/ask`;
  const first={requestId:crypto.randomUUID(),question:'已结算的问题'};
  const settled=await s.req(path,'POST',first);
  assert.equal(settled.status,200);
  s.ctx.siteModelPause='站点模型暂时停用。';
  s.ctx.answer=()=>assert.fail('paused site model must not invoke Responses');
  s.ctx.models=()=>assert.fail('paused catalog must not call the provider');
  assert.deepEqual((await s.req('models')).data,{status:'empty',models:[],message:s.ctx.siteModelPause});
  assert.deepEqual(await s.req(path,'POST',first),settled);
  const next=await s.req(path,'POST',{requestId:crypto.randomUUID(),question:'新问题'});
  assert.equal(next.status,503);
  assert.equal(next.data.code,'site_model_paused');
  const index=await s.req('memory/index','POST',{course:'信号处理',threadId:thread,requestId:crypto.randomUUID()});
  assert.equal(index.status,503);
  assert.equal(index.data.code,'site_model_paused');
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM memory_jobs').get().n,0);
  assert.equal((await s.req(`threads/${thread}/local-answer`,'POST',{question:'Magpie 提问',answer:'本地回答',previous:2})).status,200);
});

test('OpenAI token billing uses returned tier and caches, settles atomically, and replays once', async () => {
  const s=setup(), thread=await s.thread(await s.doc()), route=`threads/${thread}/ask`;
  s.ctx.siteUsagePricing=true;
  let calls=0;
  s.ctx.answer=input=>answerSelectionWithMetadata(input,async (_url,options)=>{
    calls++;
    assert.equal(JSON.parse(options.body).service_tier,'fast');
    return Response.json({
      object:'response',id:'resp_token_billing',status:'completed',
      model:'gpt-6.1-sol',service_tier:'default',
      output:[{type:'message',content:[{type:'output_text',text:'完成'}]}],
      usage:{input_tokens:2_000,output_tokens:400,total_tokens:2_400,
        input_tokens_details:{cached_tokens:400,cache_write_tokens:500,
          cache_write_tokens_details:{ttl_30m_tokens:300,ttl_12h_tokens:200}},
        output_tokens_details:{reasoning_tokens:200}},
    });
  });
  const body={requestId:crypto.randomUUID(),question:'按实际用量',model:'gpt-6.1-sol',speed:'fast'};
  const response=await s.req(route,'POST',body);
  assert.equal(response.status,200,JSON.stringify(response.data));
  // 1,100 regular at $2; 400 cached at $0.10; writes at $2.50/$5; 400 output at $10.
  assert.equal(response.data.creditsCharged,.799);
  assert.deepEqual(await s.req(route,'POST',body),response);
  assert.equal(calls,1);
  const account=(await s.req('account')).data;
  const ledger=account.ledger.find(row=>row.kind==='site_answer');
  assert.equal(ledger.credits,-.799);
  assert.equal(ledger.detail.calls[0].costUsd,undefined);
  assert.equal(ledger.detail.calls[0].usagePricing.tier,'default');
  assert.equal(ledger.detail.calls[0].usagePricing.usd,.00799);
  assert.equal(account.balance,14.201);
  assert.equal(auditedCalls(s.sql,body.requestId)[0].usagePricing.usd,.00799);
});

test('completed site response with no verifiable cost does not produce a free answer or a debit',async()=>{
  const s=setup(), thread=await s.thread(await s.doc());
  s.ctx.siteUsagePricing=true;
  s.ctx.answer=async()=>({answer:'缺少用量的答案',model:'gpt-6.1-sol',serviceTier:'default'});
  const requestId=crypto.randomUUID();
  const result=await s.req(`threads/${thread}/ask`,'POST',{requestId,question:'调用没有用量'});
  assert.equal(result.status,502);
  assert.match(result.data.error,/无法核算用量/);
  assert.equal((await s.req('account')).data.totalSpent,0);
  assert(!JSON.stringify((await s.req('state')).data).includes('缺少用量的答案'));
  assert.equal(auditedCalls(s.sql,requestId).length,1);
});

test('an empty project persists for its owner and repeated creation keeps one entry',async()=>{
  const s=setup();
  assert.equal((await s.req('projects','POST',{name:'  '})).status,400);
  assert.deepEqual((await s.req('projects','POST',{name:'  数字信号处理  '})).data,{name:'数字信号处理'});
  assert.equal((await s.req('projects','POST',{name:'数字信号处理'})).status,200);
  assert.deepEqual((await s.req('state')).data,{projects:['数字信号处理'],docs:[],threads:[]});
  s.ctx.owner='bob';
  assert.deepEqual((await s.req('state')).data.projects,[]);
});

test('renaming a legacy project preserves its material and moving is required before deleting it',async()=>{
  const s=setup();
  const doc=await s.doc('原有项目');
  await s.req('projects','POST',{name:'目标项目'});
  const manage=body=>s.req('projects/manage','POST',body);
  assert.equal((await manage({action:'rename',project:'原有项目',target:'目标项目'})).status,409);
  assert.equal((await manage({action:'rename',project:'原有项目',target:'新项目名'})).status,200);
  assert.equal((await s.req('state')).data.docs[0].course,'新项目名');
  assert.equal((await manage({action:'delete',project:'新项目名'})).status,409);
  assert.equal((await manage({action:'delete',project:'新项目名',target:'不存在'})).status,409);
  assert.equal((await manage({action:'delete',project:'新项目名',target:'目标项目'})).status,200);
  const state=(await s.req('state')).data;
  assert.deepEqual(state.projects,['目标项目']);
  assert.equal(state.docs[0].id,doc);
  assert.equal(state.docs[0].course,'目标项目');
  await s.req('projects','POST',{name:'空项目'});
  assert.equal((await manage({action:'delete',project:'空项目'})).status,200);
  assert.deepEqual((await s.req('state')).data.projects,['目标项目']);
  s.ctx.owner='bob';
  assert.equal((await manage({action:'delete',project:'目标项目'})).status,404);
});

test('moving one document into an empty project keeps its original project and discussion',async()=>{
  const s=setup();
  const doc=await s.doc('原项目');
  const thread=await s.thread(doc);
  const route='docs/'+doc+'/organize';
  assert.equal((await s.req(route,'POST',{course:'已移除的目标',existingProject:true})).status,409);
  assert.deepEqual((await s.req('state')).data.projects,[]);
  await s.req('projects','POST',{name:'目标项目'});
  assert.equal((await s.req(route,'POST',{course:'目标项目',existingProject:true})).status,200);
  const state=(await s.req('state')).data;
  assert.deepEqual(state.projects.sort(),['原项目','目标项目'].sort());
  assert.equal(state.docs[0].course,'目标项目');
  assert.deepEqual(state.threads.map(t=>[t.id,t.docId]),[[thread,doc]]);
});
