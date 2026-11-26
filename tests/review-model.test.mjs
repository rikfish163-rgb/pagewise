import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReview} from '../lib/review-model.ts';
import {discussionTitle} from '../lib/workspace-model.ts';

const docs = [
  {id: 'doc-1', name: '小红书广告业务平台.pdf', kind: 'pdf', course: '广告投放'},
  {id: 'doc-2', name: '信号处理.pdf', kind: 'pdf', course: '信号处理'},
];
const threads = [
  {id: 'thread-1', docId: 'doc-1', page: 21, text: '归因窗口', createdAt: 1000, messages: [
    {role: 'user', content: '归因窗口为什么按天设置？', page: 21, createdAt: 1000},
    {role: 'assistant', content: '按天结算便于核对。'},
  ]},
  {id: 'thread-2', docId: 'doc-1', page: 23, text: '出价策略', createdAt: 2000, messages: [
    {role: 'user', content: '出价和预算如何配合？', page: 23, createdAt: 2000},
  ]},
  {id: 'thread-3', docId: 'doc-2', page: 3, text: '卷积', createdAt: 3000, messages: [
    {role: 'user', content: '卷积怎么理解？', page: 3, createdAt: 3000},
    {role: 'assistant', content: '对应频域相乘。'},
  ]},
  {id: 'draft-x', docId: 'doc-1', page: 22, messages: [{role: 'user', content: '未发送草稿'}]},
  {id: 'thread-gone', docId: 'doc-missing', page: 1, messages: [{role: 'user', content: '孤儿'}]},
];
const notes = [
  {id: 'note-1', number: 3, title: '归因笔记', body: '正文', revision: 1, createdAt: 1, updatedAt: 3000,
    sources: [{key: 'thread:thread-1', project: '广告投放', docId: 'doc-1', threadId: 'thread-1', page: 21, available: true}]},
  {id: 'note-2', number: 4, title: '第 23 页笔记', body: '正文', revision: 1, createdAt: 1, updatedAt: 2000,
    sources: [{key: 'document:doc-1', project: '广告投放', docId: 'doc-1', page: 23, available: true}]},
  {id: 'note-3', number: 5, title: '独立笔记', body: '正文', revision: 1, createdAt: 1, updatedAt: 1000, sources: []},
];

test('review groups real answered material by document and page, never by invented chapters', () => {
  const review = buildReview({docs, threads, notes});
  assert.deepEqual(review.documents.map(item => item.doc.id), ['doc-1', 'doc-2']);
  const advertising = review.documents[0];
  assert.deepEqual(advertising.entries.map(entry => entry.page), [21, 23]);
  assert.equal(advertising.entries[0].title, discussionTitle(threads[0]));
  assert.equal(advertising.entries[0].answered, true);
  assert.equal(advertising.entries[1].answered, false);
  assert.ok(review.documents.flatMap(item => item.entries).every(entry => entry.threadId !== 'draft-x' && entry.threadId !== 'thread-gone'));
});

test('notes attach to the page or discussion they actually came from', () => {
  const review = buildReview({docs, threads, notes});
  const [attribution, pricing] = review.documents[0].entries;
  assert.deepEqual(attribution.noteIds, ['note-1']);
  assert.deepEqual(pricing.noteIds, ['note-2']);
  const note = review.notes.find(item => item.note.id === 'note-1');
  assert.equal(note?.docId, 'doc-1');
  assert.equal(note?.page, 21);
  assert.equal(note?.threadId, 'thread-1');
  assert.equal(note?.project, '广告投放');
  assert.equal(review.notes.find(item => item.note.id === 'note-3')?.docId, undefined);
});

test('review counts only real material and stays empty without saved work', () => {
  assert.equal(buildReview({docs: [], threads: [], notes: []}).total, 0);
  const review = buildReview({docs, threads, notes});
  assert.equal(review.total, 3 + 3);
  const unsaved = buildReview({docs, threads: threads.filter(thread => thread.id.startsWith('draft-')), notes: []});
  assert.deepEqual(unsaved.documents, []);
  assert.equal(unsaved.total, 0);
});
