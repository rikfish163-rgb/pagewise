import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  appendNoteBody, noteSaveChoiceLabel, noteSaveScopeLabel, notebookInsertMode, notebookInsertRequest,
} from '../lib/notebook-model.ts';

const note = {id: 'note-3', number: 3, title: '卷积与频谱', body: '已有正文', revision: 2, sources: [], createdAt: 1, updatedAt: 2};

test('appending keeps the existing note text and separates the new block', () => {
  assert.equal(appendNoteBody('已有正文', '## 第 21 页\n\n> 新摘录'), '已有正文\n\n## 第 21 页\n\n> 新摘录');
  assert.equal(appendNoteBody('已有正文\n\n', '新内容'), '已有正文\n\n新内容');
  assert.equal(appendNoteBody('', '第一条内容'), '第一条内容');
  assert.equal(appendNoteBody('   ', '第一条内容'), '第一条内容');
  assert.equal(appendNoteBody('已有正文', ''), '已有正文');
  // Existing trailing newlines are content, not noise; only the gap is filled.
  assert.equal(appendNoteBody('已有正文\n', '新内容'), '已有正文\n\n新内容');
  assert.equal(appendNoteBody('已有正文\n\n\n', '新内容'), '已有正文\n\n\n新内容');
});

test('save choices name the real target note and scope', () => {
  const intent = {kind: 'answer', title: '卷积为什么对应相乘', text: '回答', sources: [{project: '信号处理', page: 21}]};
  assert.equal(noteSaveScopeLabel(intent), '一轮回答');
  assert.equal(noteSaveScopeLabel({...intent, kind: 'selection'}), '讲义选区');
  assert.equal(noteSaveScopeLabel({...intent, kind: 'discussion'}), '整段讨论');
  assert.equal(noteSaveChoiceLabel({mode: 'create'}, [note]), '新建笔记');
  assert.equal(noteSaveChoiceLabel({mode: 'append', noteId: 'note-3'}, [note]), '追加到 #003 · 卷积与频谱');
  // A note deleted in another window must not be presented as a valid target.
  assert.equal(noteSaveChoiceLabel({mode: 'append', noteId: 'missing'}, [note]), '追加到已删除的笔记');
});

test('old inserts without a mode still create, append never sends a whole body', () => {
  const base = {id: 7, noteId: 'note-3', title: '摘录', text: '新内容', sources: [{project: '信号处理', page: 21}]};
  assert.equal(notebookInsertMode(base), 'create');
  const insert = {...base, mode: 'append', requestId: 'request-b'};
  assert.equal(notebookInsertMode(insert), 'append');
  assert.deepEqual(notebookInsertRequest(base), {
    path: '', body: {id: 'note-3', title: '摘录', body: '新内容', sources: [{project: '信号处理', page: 21}]},
  });
  const append = notebookInsertRequest(insert);
  assert.equal(append.path, '/note-3');
  assert.deepEqual(append.body, {mode: 'append', text: '新内容', sources: [{project: '信号处理', page: 21}], requestId: 'request-b'});
  assert.ok(!('body' in append.body), 'append must not send a replacement body');
  assert.ok(!('title' in append.body), 'append must not rename the target note');
});
