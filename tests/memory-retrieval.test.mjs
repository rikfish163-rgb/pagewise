import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleStudy } from '../server/study-service.ts';
import { applyMigrations } from './sqlite-migrations.mjs';

const explain = '请结合讲义上下文，解释这个选区的内容，并给出直观例子。';
const translate = '请把选区内容翻译成中文；如果原文已经是中文，请翻译成英文。保留公式与术语。';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6zHkAAAAASUVORK5CYII=';

function setup() {
  const sql = new DatabaseSync(':memory:');
  applyMigrations(sql);
  const db = { async batch(statements) {sql.exec('BEGIN');try {const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}, prepare(query) { let values=[]; return { bind(...v) { values=v; return this; }, async all() { return {results:sql.prepare(query).all(...values)}; }, async first() { return sql.prepare(query).get(...values) ?? null; }, async run() { return sql.prepare(query).run(...values); } }; } };
  const objects = new Map();
  const bucket = { async put(k,v) { objects.set(k,v); }, async get(k) { const v=objects.get(k); return v ? {body:v,async arrayBuffer(){return v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);}} : null; } };
  let seen;
  const ctx={db,bucket,owner:'alice',key:'not-a-real-key',async answer(input){seen=input;return '测试讲解，不请求模型';}};
  const req=async(path,method='GET',value)=>{
    if (value && value.source !== 'personal' && (path.endsWith('/ask') || path === 'memory/index')) {
      value = {requestId: crypto.randomUUID(), maxCredits: path === 'memory/index' ? 1 : 4, ...value};
    }
    const init={method};
    if(value instanceof FormData)init.body=value;
    else if(value){init.body=JSON.stringify(value);init.headers={'content-type':'application/json'};}
    const response=await handleStudy(new Request('https://test/api/study/'+path,init),path.split('/'),ctx);
    assert.equal(response.status,200);return response.json();
  };
  const doc=async(course='同一门课程')=>{const form=new FormData();form.set('course',course);form.set('file',new File(['%PDF-test'],'notes.pdf',{type:'application/pdf'}));return (await req('docs','POST',form)).id;};
  const thread=async(docId,text,image)=> (await req('threads','POST',{docId,page:1,text,image})).id;
  const ask=(id,question)=>req(`threads/${id}/ask`,'POST',{question});
  return {sql,ctx,req,doc,thread,ask,seen:()=>seen};
}

for(const prompt of [explain,translate]) test(`generic prompt cannot retrieve unrelated same-course cross-document memory: ${prompt}`,async()=>{
  const s=setup();const radar=await s.thread(await s.doc(),'雷达不承担路牌语义识别');await s.ask(radar,prompt);
  const wave=await s.thread(await s.doc(),'反相的1 Hz正弦波');
  assert.deepEqual((await s.ask(wave,prompt)).refs,[]);assert.deepEqual(s.seen().memories,[]);
});

test('real shared selection topics remain available, without answer-text or generic-question pollution',async()=>{
  const s=setup();const d=await s.doc();const relevant=await s.thread(d,'正弦波的反相与相位偏移');await s.ask(relevant,explain);
  const unrelated=await s.thread(await s.doc(),'雷达不承担路牌语义识别');await s.ask(unrelated,translate);
  s.sql.prepare('UPDATE threads SET messages=? WHERE id=?').run(JSON.stringify([{role:'user',content:explain},{role:'assistant',content:'反相的1 Hz正弦波 '+explain}]),unrelated);
  const wave=await s.thread(await s.doc(),'反相的1 Hz正弦波');
  assert.deepEqual((await s.ask(wave,explain)).refs,[relevant]);
  assert.equal(s.seen().memories.length,1);assert.ok(!s.seen().memories[0].includes('雷达'));
});

test('image-only generic requests and sparse text abstain; a specific image question can match',async()=>{
  const s=setup();const d=await s.doc();const previous=await s.thread(d,'反相正弦波与相位偏移');await s.ask(previous,explain);
  const picture=await s.thread(d,undefined,image);
  assert.deepEqual((await s.ask(picture,explain)).refs,[]);
  assert.deepEqual((await s.ask(picture,translate)).refs,[]);
  assert.deepEqual((await s.ask(picture,'图中的正弦波为什么发生相位偏移？')).refs,[previous]);
  const sparse=await s.thread(d,'图');assert.deepEqual((await s.ask(sparse,explain)).refs,[]);
});

test('state only conservatively filters stored refs using the last answered question, never rewrites data',async()=>{
  const s=setup();const d=await s.doc();const radar=await s.thread(d,'雷达不承担路牌语义识别');await s.ask(radar,explain);
  const related=await s.thread(d,'正弦波的反相与相位偏移');await s.ask(related,translate);
  const foreign=await s.thread(await s.doc('另一门课程'),'正弦波的反相');await s.ask(foreign,explain);
  const wave=await s.thread(d,'反相的1 Hz正弦波');await s.ask(wave,explain);
  const originalMessages=JSON.stringify([{role:'user',content:explain},{role:'assistant',content:'历史回答误提到了雷达；保留原文。'},{role:'user',content:'尚未回答的新问题'}]);
  const originalRefs=JSON.stringify([radar,related,foreign,'missing']);
  s.sql.prepare('UPDATE threads SET messages=?,refs=? WHERE id=?').run(originalMessages,originalRefs,wave);
  const state=(await s.req('state')).threads.find(t=>t.id===wave);
  assert.deepEqual(state.refs,[related]);assert.deepEqual(state.messages,JSON.parse(originalMessages));
  const stored=s.sql.prepare('SELECT refs,messages FROM threads WHERE id=?').get(wave);
  assert.equal(stored.refs,originalRefs);assert.equal(stored.messages,originalMessages);
});

test('state image refs use the last completed turn rather than a pending generic follow-up',async()=>{
  const s=setup();const d=await s.doc();const related=await s.thread(d,'正弦波的反相与相位偏移');await s.ask(related,explain);
  const picture=await s.thread(d,undefined,image);await s.ask(picture,'这个正弦波为什么有相位偏移？');
  const messages=s.sql.prepare('SELECT messages FROM threads WHERE id=?').get(picture).messages;
  s.sql.prepare('UPDATE threads SET messages=? WHERE id=?').run(JSON.stringify([...JSON.parse(messages),{role:'user',content:explain}]),picture);
  assert.deepEqual((await s.req('state')).threads.find(t=>t.id===picture).refs,[related]);
  const unknown=await s.thread(d,undefined,image);await s.ask(unknown,explain);
  s.sql.prepare('UPDATE threads SET refs=? WHERE id=?').run(JSON.stringify([related]),unknown);
  assert.deepEqual((await s.req('state')).threads.find(t=>t.id===unknown).refs,[]);
});

test('an exact complete two-character term is recallable, not an arbitrary shared bigram',async()=>{
  const s=setup();const d=await s.doc();const phase=await s.thread(d,'相位');await s.ask(phase,explain);
  const broader=await s.thread(d,'相位在雷达传感器中的作用');await s.ask(broader,explain);
  const current=await s.thread(await s.doc(),'相位');
  assert.deepEqual((await s.ask(current,explain)).refs,[phase]);
  assert.deepEqual((await s.req('state')).threads.find(t=>t.id===current).refs,[phase]);
});

test('English function words and academic question phrasing cannot supply topic evidence',async()=>{
  const s=setup();const old=await s.thread(await s.doc(),'The radar identifies distant objects with reflections and estimates their range.');
  await s.ask(old,'Please explain this figure and give an example.');
  const current=await s.thread(await s.doc(),'The sine wave oscillates with a phase shift and negative amplitude.');
  assert.deepEqual((await s.ask(current,'Please explain this figure and give an example.')).refs,[]);
  const imageOnly=await s.thread(await s.doc(),undefined,image);
  assert.deepEqual((await s.ask(imageOnly,'Please explain this figure and give an example.')).refs,[]);
});

test('an image history with a specific answered topic can be recalled, but a generic one cannot',async()=>{
  const s=setup();const d=await s.doc();const precise=await s.thread(d,undefined,image);await s.ask(precise,'反相正弦波与相位偏移如何理解？');
  const saved=JSON.parse(s.sql.prepare('SELECT messages FROM threads WHERE id=?').get(precise).messages);
  s.sql.prepare('UPDATE threads SET messages=? WHERE id=?').run(JSON.stringify([...saved,...Array.from({length:5},()=>({role:'user',content:explain}))]),precise);
  const generic=await s.thread(d,undefined,image);await s.ask(generic,explain);
  const wave=await s.thread(await s.doc(),'反相的1 Hz正弦波');
  assert.deepEqual((await s.ask(wave,explain)).refs,[precise]);
  assert.ok(s.seen().memories[0].includes('反相正弦波与相位偏移'));
  assert.deepEqual((await s.req('state')).threads.find(t=>t.id===wave).refs,[precise]);
});
