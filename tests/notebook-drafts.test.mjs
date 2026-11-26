import {test} from 'node:test';
import assert from 'node:assert/strict';
import {savedNoteEntry, editNoteEntry, completeNoteSave} from '../lib/notebook-drafts.ts';

const note = {id: 'note-a', number: 1, title: '原标题', body: '原正文', revision: 1, sources: [], createdAt: 1, updatedAt: 1};

test('a confirmed save preserves edits typed while its request was in flight', () => {
  const captured = editNoteEntry(savedNoteEntry(note), {body: '第一段'});
  const pending = {note: captured.note, version: captured.version, revision: 1, requestId: 'request-a'};
  const current = editNoteEntry(captured, {body: '第一段\n第二段', title: '修改后的标题'});
  const result = completeNoteSave(current, pending, {...captured.note, revision: 2});
  assert.equal(result.note.body, '第一段\n第二段');
  assert.equal(result.note.title, '修改后的标题');
  assert.equal(result.saved.body, '第一段');
  assert.equal(result.saved.revision, 2);
  assert.equal(result.status, 'dirty');
  const next = {note: result.note, version: result.version, revision: result.saved.revision, requestId: 'request-b'};
  const confirmed = completeNoteSave(result, next, {...result.note, revision: 3});
  assert.equal(confirmed.status, 'saved');
  assert.equal(confirmed.note.body, '第一段\n第二段');
});

test('switching notes keeps drafts independent and conflicts remain editable for export', () => {
  const a = editNoteEntry(savedNoteEntry(note), {body: 'A 的未保存内容'});
  const b = editNoteEntry(savedNoteEntry({...note, id: 'note-b', number: 2}), {body: 'B 的未保存内容'});
  const pending = {note: a.note, version: a.version, revision: 1, requestId: 'request-a'};
  const savedA = completeNoteSave(a, pending, {...a.note, revision: 2});
  assert.equal(savedA.status, 'saved');
  assert.equal(b.note.body, 'B 的未保存内容');
  assert.equal(b.saved.body, '原正文');
  const conflict = editNoteEntry({...b, status: 'conflict', error: '其他窗口已更新'}, {body: '需要导出的合并稿'});
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.error, '其他窗口已更新');
  assert.equal(conflict.note.body, '需要导出的合并稿');
});

test('a save response landing after a conflict keeps the draft and the merge state', () => {
  const draft = editNoteEntry(savedNoteEntry(note), {body: '冲突后的草稿'});
  const conflicted = {...draft, status: 'conflict', error: '已追加到服务器，但这里有未保存的编辑。'};
  const pending = {note: conflicted.note, version: conflicted.version, revision: 1, requestId: 'request-a'};
  const late = completeNoteSave(conflicted, pending, {...note, body: '服务器较早的版本', revision: 2});
  assert.equal(late.status, 'conflict');
  assert.equal(late.note.body, '冲突后的草稿');
  assert.equal(late.saved.body, '服务器较早的版本');
  assert.equal(late.error, '已追加到服务器，但这里有未保存的编辑。');
});
