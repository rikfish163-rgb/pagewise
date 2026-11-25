import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { register } from 'tsx/esm/api';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

registerHooks({resolve(specifier,context,next){if(specifier.endsWith('.css'))return {url:'data:text/javascript,export {};',shortCircuit:true};return next(specifier,context);}});
register();
const { CitationChips, AnswerSources }=await import('../components/Workspace.tsx');

const items=[
  {page:3,text:'傅里叶变换的定义',attachmentId:'a'},
  {page:5,text:'频谱图',image:'data:image/png;base64,YQ==',attachmentId:'b'},
];
const render=(props={})=>renderToStaticMarkup(React.createElement(CitationChips,{items,docId:'doc-a',disabled:false,onLocate(){},onRemove(){},onPreview(){},...props}));

test('every appended text citation is visible with page, locate and remove controls',()=>{
 const html=render();
 assert.equal((html.match(/class="citation-chip"/g)||[]).length,1);
 assert.match(html,/P3/);
 assert.match(html,/傅里叶变换的定义/);
 assert.match(html,/aria-label="定位第 3 页：傅里叶变换的定义"/);
 assert.match(html,/aria-label="移除引用：傅里叶变换的定义"/);
});

test('image citations keep a page-labelled preview and can be removed',()=>{
 const html=render();
 assert.equal((html.match(/class="screenshot-attachments"/g)||[]).length,1);
 assert.match(html,/aria-label="预览第 5 页截图"/);
 assert.match(html,/aria-label="删除第 5 页截图"/);
 assert.match(html,/第 5 页/);
});

test('a failed or capped add shows an accessible status instead of silence',()=>{
 assert.match(render({notice:'已添加 1 个引用 · 共 3 个（最多 12 个）'}),/role="status"[^>]*>已添加 1 个引用/);
 assert.match(render({notice:'最多 12 个引用，请先移除部分引用再添加。'}),/最多 12 个引用/);
});

test('citations cannot be removed while a reply is in flight',()=>{
 const html=render({disabled:true});
 const removeText=html.match(/<button[^>]*aria-label="移除引用：傅里叶变换的定义"[^>]*>/)?.[0]??'';
 const removeImage=html.match(/<button[^>]*aria-label="删除第 5 页截图"[^>]*>/)?.[0]??'';
 assert.match(removeText,/disabled=""/);
 assert.match(removeImage,/disabled=""/);
});

test('each answer lists its own referenced pages instead of one discussion start',()=>{
 const stored=renderToStaticMarkup(React.createElement(AnswerSources,{sources:[
   {docId:'doc-a',page:2,text:'感受野定义',kind:'page'},
   {docId:'doc-a',page:5,text:'池化层图示',kind:'page'},
 ],legacy:false,onLocate(){}}));
 assert.match(stored,/本轮引用页/);
 assert.match(stored,/P2/);assert.match(stored,/P5/);
 assert.match(stored,/感受野定义/);assert.match(stored,/池化层图示/);
 assert.doesNotMatch(stored,/本轮起点/);
 const legacy=renderToStaticMarkup(React.createElement(AnswerSources,{sources:[{docId:'doc-a',page:4}],legacy:true,onLocate(){}}));
 assert.match(legacy,/本轮起点页/);
 assert.match(legacy,/P4/);
 assert.doesNotMatch(legacy,/P1/);
});
