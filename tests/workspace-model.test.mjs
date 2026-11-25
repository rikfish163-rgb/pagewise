import test from 'node:test';
import assert from 'node:assert/strict';
import { updateThread, documentThreads, selectionLabel, dismissSelection, discussionTitle } from '../lib/workspace-model.ts';
test('Escape discards only an empty unsent selection; keeps typed drafts, in-flight and saved conversations',()=>{
 const rows=[{id:'draft-a'},{id:'draft-b'},{id:'saved'}];
 assert.deepEqual(dismissSelection(rows,'draft-a',false,''),rows.slice(1));
 assert.equal(dismissSelection(rows,'draft-a',true,''),rows);
 assert.equal(dismissSelection(rows,'draft-a',false,'保留我的问题'),rows);
 assert.equal(dismissSelection(rows,'saved',false,''),rows);
});
test('concurrent reply changes only its own discussion', () => {
 const threads = [{id:'a',docId:'d',page:1,messages:[]},{id:'b',docId:'d',page:2,messages:[]}];
 const next=updateThread(threads,'a',t=>({...t,messages:[{role:'assistant',content:'answer'}]}));
 assert.equal(next[0].messages.length,1); assert.equal(next[1],threads[1]);
});
test('document discussion list cannot leak other documents',()=> {
 assert.deepEqual(documentThreads([{id:'a',docId:'x'},{id:'b',docId:'y'}],'x').map(t=>t.id),['a']);
});
test('image-only selection receives a readable label',()=>assert.equal(selectionLabel({page:3,image:'data:image/png;base64,x'}),'第 3 页 · 框选区域'));

test('named page questions handle Chinese numerals, ranges and multiple references',async()=>{
 const {requestedPages}=await import('../components/study-context.ts');
 assert.deepEqual(requestedPages('第一页到第三页，还有第十二页我不会'),[1,2,3,12]);
 assert.deepEqual(requestedPages('第 3、5、8 页'),[3,5,8]);
 assert.throws(()=>requestedPages('第999999999999999999页'));
 assert.throws(()=>requestedPages('第1到9页'));
});

test('short follow-ups keep the discussion topic instead of renaming it to 1/q',()=>{
 const at=(hour)=>Date.UTC(2026,10,25,hour);
 const thread={id:'t',docId:'d',page:1,messages:[
   {role:'user',content:'傅里叶变换为什么能分解信号？',createdAt:at(1)},
   {role:'assistant',content:'因为它把信号投影到正交基上。',createdAt:at(1)},
 ]};
 const before=discussionTitle(thread);
 assert.match(before,/傅里叶变换为什么能分解信号/);
 const followUp={...thread,messages:[...thread.messages,{role:'user',content:'1',createdAt:at(2)}]};
 const after=discussionTitle(followUp);
 assert.match(after,/傅里叶变换为什么能分解信号/);
 assert.doesNotMatch(after,/· 1$/);
 assert.match(after,/11\/25|11月25日|25\/11/);
 const answerMarker={...thread,messages:[...thread.messages,{role:'user',content:'1/q',createdAt:at(2)}]};
 assert.match(discussionTitle(answerMarker),/傅里叶变换为什么能分解信号/);
 const qOnly={...thread,messages:[{role:'user',content:'q',createdAt:at(3)}]};
 assert.match(discussionTitle({...qOnly,text:'采样定理的适用条件'}),/采样定理的适用条件/);
 assert.match(discussionTitle({...qOnly,text:undefined}),/q/);
 assert.equal(discussionTitle({id:'empty',docId:'d',page:2,messages:[]}),'未发送的问题');
});

test('overview uses page-labelled excerpts and samples pages without text for vision',async()=>{
 const {documentOverview,isOverview,requestedPages}=await import('../components/study-context.ts');
 assert.equal(isOverview('梳理整份课件的大纲'),true);
 assert.deepEqual(requestedPages('2页到4页的公式'),[2,3,4]);
 const reader={count:4,async read(page,image=true){return {page,text:page===2?'':`内容${page}`,image:image?'image':undefined}}};
 const result=await documentOverview(reader);
 assert.match(result.text,/第 4 页：内容4/);assert.deepEqual(result.images.map(s=>s.page),[2]);
});
