import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchSnippet, searchStudy} from '../lib/study-search.ts';
import {discussionTitle} from '../lib/workspace-model.ts';

const doc = {id: 'doc-1', name: '小红书广告业务平台.pdf', kind: 'pdf', course: '广告投放'};
const otherDoc = {id: 'doc-2', name: '信号处理.pdf', kind: 'pdf', course: '信号处理'};
const threads = [
  {
    id: 'thread-1', docId: 'doc-1', page: 21, text: '广告归因窗口用于把转化归到触点',
    createdAt: 1000, messages: [
      {role: 'user', content: '归因窗口为什么按天设置？', page: 21, createdAt: 1000},
      {role: 'assistant', content: '归因窗口决定转化回看的时间范围，按天设置便于按日结算。'},
    ],
  },
  {
    id: 'thread-2', docId: 'doc-2', page: 3, text: '卷积与频谱',
    createdAt: 2000, messages: [
      {role: 'user', content: '卷积怎么理解？', page: 3, createdAt: 2000},
      {role: 'assistant', content: '卷积对应频域相乘。'},
    ],
  },
  {id: 'draft-abc', docId: 'doc-1', page: 22, messages: [{role: 'user', content: '还没发送的归因草稿'}]},
  {id: 'thread-3', docId: 'deleted-doc', page: 9, messages: [{role: 'user', content: '归因孤儿线程'}]},
];
const notes = [
  {
    id: 'note-1', number: 3, title: '归因窗口笔记', body: '结算周期按天，归因窗口按点击时间回看。',
    revision: 1, createdAt: 1, updatedAt: 3000,
    sources: [{key: 'thread:thread-1', project: '广告投放', docId: 'doc-1', threadId: 'thread-1', page: 21, available: true}],
  },
  {
    id: 'note-2', number: 4, title: '卷积笔记', body: '卷积对应频域相乘。',
    revision: 1, createdAt: 1, updatedAt: 2000,
    sources: [{key: 'project:信号处理', project: '信号处理', available: true}],
  },
];

test('answers, excerpts and notes are searchable with a matched snippet and a real destination', () => {
  const groups = searchStudy({docs: [doc, otherDoc], threads, notes, query: '归因窗口'});
  const all = groups.flatMap(group => group.results);
  const answer = all.find(item => item.kind === 'answer');
  assert.ok(answer, 'an assistant answer containing the term is returned');
  assert.equal(answer.docId, 'doc-1');
  assert.equal(answer.threadId, 'thread-1');
  assert.equal(answer.page, 21);
  assert.match(answer.snippet, /归因窗口/);
  assert.equal(answer.title, discussionTitle(threads[0]));
  const excerpt = all.find(item => item.kind === 'excerpt');
  assert.ok(excerpt, 'the real lecture selection is searchable');
  assert.equal(excerpt.threadId, 'thread-1');
  assert.equal(excerpt.page, 21);
  const note = all.find(item => item.kind === 'note');
  assert.ok(note, 'saved note bodies are searchable');
  assert.equal(note.noteId, 'note-1');
  assert.match(note.snippet, /归因窗口/);
  assert.match(note.title, /#003/);
});

test('search never surfaces drafts, unknown documents or other projects when scoped', () => {
  const all = searchStudy({docs: [doc, otherDoc], threads, notes, query: '归因'}).flatMap(group => group.results);
  assert.ok(all.every(item => item.threadId !== 'draft-abc' && item.threadId !== 'thread-3'));
  const scoped = searchStudy({docs: [doc, otherDoc], threads, notes, query: '卷积', project: '广告投放'});
  assert.deepEqual(scoped.flatMap(group => group.results).filter(item => item.kind === 'answer' || item.kind === 'note'), []);
  const signal = searchStudy({docs: [doc, otherDoc], threads, notes, query: '卷积', project: '信号处理'});
  assert.equal(signal.flatMap(group => group.results).filter(item => item.kind === 'answer').length, 1);
  assert.equal(signal.flatMap(group => group.results).filter(item => item.kind === 'note').length, 1);
});

test('empty and unmatched queries return nothing instead of every record', () => {
  assert.deepEqual(searchStudy({docs: [doc], threads, notes, query: '   '}), []);
  assert.deepEqual(searchStudy({docs: [doc], threads, notes, query: '不存在的词'}), []);
});

test('snippets stay short and mark where text was cut', () => {
  const long = `${'前'.repeat(80)}目标词${'后'.repeat(80)}`;
  const snippet = matchSnippet(long, '目标词');
  assert.ok(snippet.length < 120);
  assert.match(snippet, /目标词/);
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
  assert.equal(matchSnippet('短文本', '不存在'), '短文本');
});

test('per-round lecture excerpts are searchable even when the thread text is a placeholder', () => {
  const pageDocs = [{id: 'doc-a', name: '广告投放.pdf', kind: 'pdf', course: '广告'}];
  const pageThreads = [{id: 'thread-1', docId: 'doc-a', page: 21, text: '按页提问', messages: [
    {role: 'user', content: '这段怎么理解？', page: 22, excerpt: '第 22 页：归因窗口的三种口径'},
    {role: 'assistant', content: '分别按点击、曝光和互动计算。'},
  ]}];
  const groups = searchStudy({docs: pageDocs, threads: pageThreads, notes: [], query: '三种口径'});
  const excerpt = groups.flatMap(group => group.results).find(item => item.kind === 'excerpt');
  assert.ok(excerpt, 'the real excerpt saved on the user message is searchable');
  assert.equal(excerpt.docId, 'doc-a');
  assert.equal(excerpt.threadId, 'thread-1');
  assert.equal(excerpt.page, 22);
  assert.match(excerpt.snippet, /三种口径/);
  // The placeholder is not lecture text and must not be searchable as one.
  assert.deepEqual(searchStudy({docs: pageDocs, threads: pageThreads, notes: [], query: '按页提问'}), []);
});
