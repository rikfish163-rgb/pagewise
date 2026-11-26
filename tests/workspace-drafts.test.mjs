import test from 'node:test';
import assert from 'node:assert/strict';
import {
  draftStorageKey, emptyDraftBook, parseDraftBook, saveDraft, removeDraft, draftsForDoc, draftForThread,
} from '../lib/workspace-drafts.ts';
import { parseWorkspaceRoute, workspaceReaderStart, workspaceRouteUrl } from '../lib/workspace-route.ts';

const draft={
  docId:'doc-a',threadId:'draft-1',text:'我还没想明白的问题',
  selection:{page:3,text:'傅里叶变换'},
  citations:[{page:3,text:'傅里叶变换',kind:'selection'},{page:5,text:'频谱图',kind:'page'}],
  omitPrimary:false,omitImage:false,imageLost:false,updatedAt:10,
};

test('drafts are namespaced by account, so two accounts never share unsent text',()=>{
  assert.notEqual(draftStorageKey('alice'),draftStorageKey('bob'));
  assert.match(draftStorageKey('alice'),/^pagewise:drafts:v1:/);
  assert.ok(!draftStorageKey('alice').includes('cookie'));
});

test('a stored draft keeps text, selection, pages and an explicit image limitation',()=>{
  const book=saveDraft(emptyDraftBook(),{...draft,imageLost:true});
  const parsed=parseDraftBook(JSON.stringify(book));
  assert.deepEqual(draftForThread(parsed,'draft-1'),{...draft,imageLost:true});
  assert.deepEqual(draftsForDoc(parsed,'doc-a').map(item=>item.threadId),['draft-1']);
  assert.deepEqual(draftsForDoc(parsed,'doc-b'),[]);
});

test('image data URLs and credentials never enter draft storage',()=>{
  const raw=JSON.stringify({version:1,drafts:{
    'draft-1':{...draft,selection:{page:3,image:'data:image/png;base64,secret'},citations:[
      {page:3,text:'x',image:'data:image/png;base64,secret'},
    ],token:'session-secret'},
  }});
  const parsed=parseDraftBook(raw);
  const stored=JSON.stringify(parsed);
  assert.ok(!stored.includes('base64'));
  assert.ok(!stored.includes('session-secret'));
  assert.deepEqual(draftForThread(parsed,'draft-1').selection,{page:3});
  assert.deepEqual(draftForThread(parsed,'draft-1').citations,[]);
});

test('drafts already saved with stripped attachments still warn after reopening and editing',()=>{
  const stored={...draft,citations:[draft.citations[0],{page:3,text:'截图',kind:'attachment'}]};
  const parsed=parseDraftBook(JSON.stringify({version:1,drafts:{'draft-1':stored}}));
  const restored=draftForThread(parsed,'draft-1');
  assert.equal(restored.imageLost,true);
  assert.deepEqual(restored.citations,[draft.citations[0]]);
  const edited=saveDraft(parsed,{...restored,text:'修改后的问题'});
  assert.equal(draftForThread(edited,'draft-1').imageLost,true);
});

test('a removed primary image does not leave a missing-image warning',()=>{
  const book=saveDraft(emptyDraftBook(),{
    ...draft,omitImage:true,selection:{page:3,image:'data:image/png;base64,removed'},
  });
  assert.equal(draftForThread(book,'draft-1').imageLost,false);
});

test('malformed drafts and empty drafts are discarded instead of resurrecting stale state',()=>{
  assert.deepEqual(parseDraftBook('not json'),emptyDraftBook());
  assert.deepEqual(parseDraftBook(null),emptyDraftBook());
  assert.deepEqual(parseDraftBook(JSON.stringify({version:2,drafts:{}})),emptyDraftBook());
  const empty=saveDraft(emptyDraftBook(),{...draft,text:'  ',citations:[],selection:undefined});
  assert.deepEqual(empty.drafts,{});
  const removed=removeDraft(saveDraft(emptyDraftBook(),draft),'draft-1');
  assert.deepEqual(removed.drafts,{});
});

test('newer drafts sort first and drafts from another document stay separate',()=>{
  let book=saveDraft(emptyDraftBook(),{...draft,updatedAt:5});
  book=saveDraft(book,{...draft,threadId:'draft-2',updatedAt:9});
  book=saveDraft(book,{...draft,threadId:'draft-3',docId:'doc-b',updatedAt:7});
  assert.deepEqual(draftsForDoc(book,'doc-a').map(item=>item.threadId),['draft-2','draft-1']);
});

test('the reader route keeps document, discussion and page across reload and copy',()=>{
  const route=parseWorkspaceRoute('?document=doc-a&discussion=t-1&page=7');
  assert.deepEqual(route,{document:'doc-a',discussion:'t-1',page:7});
  const url=workspaceRouteUrl({pathname:'/',hash:'#reader'},route);
  assert.match(url,/document=doc-a/);
  assert.match(url,/discussion=t-1/);
  assert.match(url,/page=7/);
  assert.equal(parseWorkspaceRoute(url.split('?')[1]).page,7);
});

test('reloading a saved page resumes its anchor while opening its link starts at the page top',()=>{
  assert.deepEqual(workspaceReaderStart(7,7,'reload'),{page:7,resume:true});
  assert.deepEqual(workspaceReaderStart(7,7,'navigate'),{page:7,resume:false});
  assert.deepEqual(workspaceReaderStart(7,4,'reload'),{page:7,resume:false});
  assert.deepEqual(workspaceReaderStart(undefined,7,'navigate'),{page:7,resume:true});
});

test('invalid or hostile route values are ignored, not copied into the reader',()=>{
  assert.deepEqual(parseWorkspaceRoute('?document=&page=0'),{});
  assert.deepEqual(parseWorkspaceRoute('?page=1.5&document='+encodeURIComponent('x'.repeat(120))),{});
  assert.deepEqual(parseWorkspaceRoute('?document=doc-a&discussion='+encodeURIComponent('<script>')),{document:'doc-a'});
});
