import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionNoteBlocks, roundSourceLines } from '../lib/workspace-notes.ts';

const doc='doc-a';
const link=page=>page?`[第 ${page} 页](https://pagewise.test/?document=${doc}&page=${page}#reader)`:'[来源讲义](https://pagewise.test/?document='+doc+'#reader)';
const discussion={
  id:'t',docId:doc,page:1,text:'卷积核',messages:[
    {role:'user',content:'感受野和池化的关系？',createdAt:1,page:2},
    {role:'assistant',content:'池化扩大感受野。',createdAt:2,sources:[
      {docId:doc,page:2,text:'感受野定义',kind:'page'},
      {docId:doc,page:5,text:'池化层图示',kind:'page'},
    ]},
    {role:'user',content:'1/q',createdAt:3,page:5},
    {role:'assistant',content:'第二段讲解。',createdAt:4,sources:[
      {docId:doc,page:7,text:'跨页结论',kind:'page'},
    ]},
  ],
};

test('each answered round keeps its own pages, original text and page links',()=>{
  const blocks=discussionNoteBlocks(discussion,doc,{heading:'讲义',link});
  const body=blocks.join('\n\n');
  for(const text of ['感受野定义','池化层图示','跨页结论','第 2 页','第 5 页','第 7 页'])assert.ok(body.includes(text),text);
  assert.match(body,/主题：感受野和池化的关系/);
  assert.equal((body.match(/### 回答/g)||[]).length,2);
  assert.equal((body.match(/#### 本轮引用/g)||[]).length,2);
});

test('legacy rounds without stored evidence point back to their own question page, not the discussion start',()=>{
  const legacy={...discussion,page:1,messages:[
    {role:'user',content:'问题',createdAt:1,page:6},
    {role:'assistant',content:'旧回答',createdAt:2},
  ]};
  const lines=roundSourceLines(legacy.messages[1],doc,legacy.messages[0].page,link).join('\n');
  assert.match(lines,/第 6 页/);
  assert.match(lines,/本轮起点/);
  assert.doesNotMatch(lines,/第 1 页/);
});

test('a note never embeds raw image data',()=>{
  const withImage={...discussion,messages:[
    {role:'user',content:'看图',createdAt:1,page:2},
    {role:'assistant',content:'答',createdAt:2,sources:[{docId:doc,page:2,text:'截图',kind:'attachment'}]},
  ]};
  assert.doesNotMatch(discussionNoteBlocks(withImage,doc,{heading:'讲义',link}).join('\n'),/data:image/);
});
