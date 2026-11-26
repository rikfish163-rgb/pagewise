import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMessageSources, messageSources, citationFeedback, citationLimitFeedback, selectionSources, MAX_MESSAGE_SOURCES } from '../lib/workspace-sources.ts';

const doc='doc-a';
const valid=[
  {docId:doc,page:3,text:'傅里叶变换的定义',kind:'selection'},
  {docId:doc,page:5,text:'频谱图',rect:[0.1,0.2,0.3,0.4],kind:'attachment'},
];

test('server-shaped sources accept only the owning document, real pages and bounded text',()=>{
  assert.deepEqual(sanitizeMessageSources(valid,doc),valid);
  assert.deepEqual(sanitizeMessageSources([],doc),[]);
  assert.equal(sanitizeMessageSources(undefined,doc),null);
  assert.equal(sanitizeMessageSources([{docId:'other',page:1}],doc),null);
  assert.equal(sanitizeMessageSources([{docId:doc,page:0}],doc),null);
  assert.equal(sanitizeMessageSources([{docId:doc,page:1.5}],doc),null);
  assert.equal(sanitizeMessageSources([{docId:doc,page:1,text:'x'.repeat(701)}],doc),null);
  assert.equal(sanitizeMessageSources([{docId:doc,page:1,rect:[1,2,3]}],doc),null);
  assert.equal(sanitizeMessageSources([{docId:doc,page:1,kind:'invented'}],doc),null);
  assert.equal(sanitizeMessageSources(Array.from({length:MAX_MESSAGE_SOURCES+1},(_,i)=>({docId:doc,page:i+1})),doc),null);
});

test('duplicate evidence collapses without inventing pages',()=>{
  const sources=sanitizeMessageSources([valid[0],{...valid[0]},valid[1]],doc);
  assert.equal(sources.length,2);
  assert.deepEqual(sources.map(source=>source.page),[3,5]);
});

test('an answer without stored sources falls back to its own page, never another round',()=>{
  assert.deepEqual(messageSources({sources:valid},doc,9),valid);
  assert.deepEqual(messageSources({},doc,4),[{docId:doc,page:4}]);
  assert.deepEqual(messageSources({},doc,undefined),[]);
  assert.deepEqual(messageSources({sources:[]},doc,4),[{docId:doc,page:4}]);
});

test('answer evidence records pages and text but never image data URLs',()=>{
  const sources=selectionSources([
    {page:1,text:'  选区原文  ',kind:'selection'},
    {page:2,image:'data:image/png;base64,secret',rect:[0,0,1,1]},
    {page:1,text:'选区原文'},
  ],doc,'selection');
  assert.deepEqual(sources,[
    {docId:doc,page:1,text:'选区原文',kind:'selection'},
    {docId:doc,page:2,rect:[0,0,1,1],kind:'selection'},
  ]);
  assert.ok(!JSON.stringify(sources).includes('base64'));
  assert.equal(selectionSources(Array.from({length:20},(_,i)=>({page:i+1,text:`p${i}`})),doc).length,MAX_MESSAGE_SOURCES);
});

test('adding a citation reports what changed and when the limit is reached',()=>{
  assert.match(citationFeedback(2,5),/已添加 2 个引用/);
  assert.match(citationFeedback(2,5),/共 5 个/);
  assert.match(citationFeedback(2,5),/12/);
  assert.match(citationLimitFeedback(),/最多 12 个引用/);
  assert.match(citationLimitFeedback(),/移除/);
});
