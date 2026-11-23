import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleStudy} from '../server/study-service.ts';
import {legacyNoteId} from '../server/study-notes.ts';
import {matchingNotes, noteNumber} from '../lib/notebook-model.ts';
import {applyMigrations} from './sqlite-migrations.mjs';

function setup({legacy} = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  applyMigrations(sql, {to: 7});
  if (legacy) {
    sql.exec('CREATE TABLE notebooks(owner TEXT PRIMARY KEY,body TEXT NOT NULL,revision INTEGER NOT NULL)');
    sql.prepare('INSERT INTO notebooks VALUES(?,?,?)').run('alice', legacy.body, legacy.revision);
  }
  applyMigrations(sql, {from: 7});
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...bindings) {values = bindings; return this;},
        async all() {return {results: sql.prepare(query).all(...values)};},
        async first() {return sql.prepare(query).get(...values) ?? null;},
        async run() {return sql.prepare(query).run(...values);},
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec('COMMIT');
        return results;
      } catch (error) {sql.exec('ROLLBACK'); throw error;}
    },
  };
  const ctx = {db, owner: 'alice', bucket: {async delete() {}}, async answer() {throw Error('Notes must not invoke a model');}};
  const req = async (path, method = 'GET', value) => {
    const response = await handleStudy(new Request(`https://test/api/study/${path}`, {
      method, ...(value === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)}),
    }), path.split('/'), ctx);
    return {status: response.status, data: await response.json(), cache: response.headers.get('cache-control')};
  };
  const doc = (project = '信号处理') => {
    const id = crypto.randomUUID();
    sql.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?)').run(id, ctx.owner, `${project}.pdf`, 'pdf', project, id, 1);
    return id;
  };
  const thread = docId => {
    const id = crypto.randomUUID();
    sql.prepare('INSERT INTO threads(id,owner,doc_id,page,selection_text,messages,refs,created) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, ctx.owner, docId, 3, '卷积与频谱', '[{"role":"user","content":"如何理解卷积？"}]', '[]', 1);
    return id;
  };
  const create = value => req('notes', 'POST', {id: crypto.randomUUID(), title: '卷积笔记', body: '卷积对应频谱相乘。', sources: [], ...value});
  const save = (note, value = {}) => req(`notes/${note.id}`, 'POST', {
    number: note.number, title: note.title, body: note.body, sources: note.sources,
    revision: note.revision, requestId: crypto.randomUUID(), ...value,
  });
  return {sql, ctx, req, doc, thread, create, save};
}

test('numbered notes connect discussions across projects and remain owner scoped', async () => {
  const s = setup();
  const a = s.doc(), ta = s.thread(a), b = s.doc('数学'), tb = s.thread(b);
  const first = (await s.create({sources: [{project: '信号处理', docId: a, threadId: ta}]})).data.note;
  const second = (await s.create({title: '傅里叶笔记'})).data.note;
  assert.equal(first.number, 1); assert.equal(second.number, 2);
  const updated = await s.save(first, {sources: [
    ...first.sources, {project: '数学', docId: b, threadId: tb, documentName: '伪造名称'},
  ]});
  assert.equal(updated.status, 200);
  assert.equal(updated.data.note.sources.length, 2);
  assert.equal(updated.data.note.sources[1].documentName, '数学.pdf');
  assert.equal(updated.data.note.sources[1].discussionTitle, '如何理解卷积？');
  assert.ok(updated.data.note.sources.every(source => source.available));
  const list = await s.req('notes');
  assert.equal(list.cache, 'private, no-store');
  assert.deepEqual(matchingNotes(list.data.notes, {project: '数学'}).map(note => note.id), [first.id]);
  assert.deepEqual(matchingNotes(list.data.notes, {threadId: ta, query: '#001'}).map(note => note.id), [first.id]);
  assert.equal(noteNumber(12), '#012');
  s.ctx.owner = 'bob';
  assert.deepEqual((await s.req('notes')).data, {notes: []});
  assert.equal((await s.req(`notes/${first.id}`)).status, 404);
  assert.equal((await s.save(first)).status, 404);
  assert.equal((await s.req(`notes/${first.id}`, 'DELETE')).status, 404);
  assert.equal((await s.create({sources: [{project: '信号处理', docId: a, threadId: ta}]})).status, 404);
  assert.equal((await s.create()).data.note.number, 1);
});

test('custom numbers are unique per owner and deleted numbers are not allocated again', async () => {
  const s = setup();
  const first = (await s.create()).data.note, second = (await s.create()).data.note;
  const numbered = await s.save(first, {number: 12});
  assert.equal(numbered.status, 200);
  const duplicate = await s.save(second, {number: 12});
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.code, 'note_number_taken');
  assert.equal((await s.req(`notes/${second.id}`)).data.note.number, 2);
  await s.req(`notes/${first.id}`, 'DELETE');
  assert.equal((await s.create()).data.note.number, 13);
  for (const number of [0, -1, 1.5, '3', 1000000000])
    assert.equal((await s.create({number})).status, 400);
});

test('lost responses can replay without duplicating notes, revisions or study rewards', async () => {
  const s = setup();
  const id = crypto.randomUUID(), input = {id, title: '原笔记', body: '原文', sources: []};
  const note = (await s.create(input)).data.note;
  assert.equal((await s.create(input)).data.note.id, id);
  assert.equal((await s.req('notes')).data.notes.length, 1);
  const requestId = crypto.randomUUID(), edit = {requestId, body: '修订正文'};
  const first = await s.save(note, edit), replay = await s.save(note, edit);
  assert.equal(first.status, 200); assert.deepEqual(replay.data, first.data);
  assert.equal(first.data.note.revision, 2);
  const stale = await s.save(note, {body: '过期正文'});
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'note_changed');
  assert.equal((await s.req(`notes/${id}`)).data.note.body, '修订正文');
  assert.equal(s.sql.prepare("SELECT COUNT(*) n FROM learning_credits WHERE kind='note_saved'").get().n, 1);
  assert.equal((await s.save(first.data.note, {requestId, body: '改变重试内容'})).status, 409);
});

test('deleted discussions and documents leave readable notes and source snapshots', async () => {
  const s = setup(), docId = s.doc(), threadId = s.thread(docId);
  const note = (await s.create({sources: [{project: '信号处理', docId, threadId}]})).data.note;
  await s.req(`threads/${threadId}`, 'DELETE');
  const detached = (await s.req(`notes/${note.id}`)).data.note;
  assert.equal(detached.body, note.body);
  assert.equal(detached.sources[0].available, false);
  assert.equal(detached.sources[0].discussionTitle, '如何理解卷积？');
  assert.equal((await s.save(detached, {body: '删除来源后继续写'})).status, 200);
  await s.req(`docs/${docId}`, 'DELETE');
  const deleted = (await s.req(`notes/${note.id}`)).data.note;
  assert.equal(deleted.sources[0].documentName, '信号处理.pdf');
  assert.equal(deleted.sources[0].available, false);
  assert.equal((await s.save(deleted, {title: '独立保留的笔记'})).status, 200);
  await s.req(`notes/${note.id}`, 'DELETE');
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM study_note_sources').get().n, 0);
});

test('legacy notebook migration preserves text and versions without another reward', async () => {
  const body = '# 原笔记\n\n公式 $x^2$ 与 [来源](https://example.com)。';
  const s = setup({legacy: {body, revision: 7}});
  const note = (await s.req('notes')).data.notes[0];
  assert.equal(note.id, legacyNoteId('alice')); assert.equal(note.number, 1);
  assert.equal(note.body, body); assert.equal(note.revision, 7);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM learning_credits').get().n, 0);
  const modern = await s.save(note, {body: '新编辑器写入', title: '保留标题'});
  assert.equal(modern.status, 200);
  assert.equal((await s.req('notebook')).data.body, '新编辑器写入');
  assert.equal((await s.req('notebook', 'POST', {body: '旧窗口写入', revision: 8})).status, 200);
  const merged = (await s.req(`notes/${note.id}`)).data.note;
  assert.equal(merged.body, '旧窗口写入'); assert.equal(merged.revision, 9);
  assert.equal(merged.title, '保留标题');
  assert.equal((await s.save(modern.data.note, {body: '过期新编辑'})).status, 409);
  assert.equal((await s.create()).data.note.number, 2);
  await s.req(`notes/${note.id}`, 'DELETE');
  assert.equal((await s.req('notes')).data.notes.length, 1);
  assert.equal((await s.req('notebook')).data.body, '');
});

test('legacy writes during deployment are reconciled before a modern note can save', async () => {
  const s = setup({legacy: {body: '发布前的笔记', revision: 7}});
  const migrated = (await s.req('notes')).data.notes[0];
  // Simulate the previous Worker saving after D1 migrations, before the new
  // Worker takes over. It only knows the original notebooks table.
  s.sql.prepare('UPDATE notebooks SET body=?,revision=? WHERE owner=?')
    .run('旧页面在发布期间保存', 8, 'alice');
  const refreshed = (await s.req(`notes/${migrated.id}`)).data.note;
  assert.equal(refreshed.body, '旧页面在发布期间保存');
  assert.equal(refreshed.revision, 8);
  s.sql.prepare('UPDATE notebooks SET body=?,revision=? WHERE owner=?')
    .run('旧页面的最后一次保存', 9, 'alice');
  assert.equal((await s.save(refreshed, {body: '过期的新页面草稿'})).status, 409);
  let latest = (await s.req(`notes/${migrated.id}`)).data.note;
  assert.equal(latest.body, '旧页面的最后一次保存');
  assert.equal(latest.revision, 9);
  const batch = s.ctx.db.batch;
  s.ctx.db.batch = async statements => {
    s.ctx.db.batch = batch;
    // The legacy write lands after the new handler reads, before its batch.
    s.sql.prepare('UPDATE notebooks SET body=?,revision=? WHERE owner=?')
      .run('两次读取之间的旧页面保存', 10, 'alice');
    return batch(statements);
  };
  assert.equal((await s.save(latest, {body: '不能覆盖旧页面的草稿'})).status, 409);
  latest = (await s.req(`notes/${migrated.id}`)).data.note;
  assert.equal(latest.body, '两次读取之间的旧页面保存');
  assert.equal(latest.revision, 10);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM learning_credits').get().n, 0);
  assert.equal((await s.save(latest, {body: '新笔记本继续编辑'})).status, 200);
  assert.equal((await s.req('notebook')).data.body, '新笔记本继续编辑');
  s.sql.prepare('UPDATE notebooks SET body=?,revision=? WHERE owner=?').run('', 12, 'alice');
  assert.equal((await s.req(`notes/${migrated.id}`)).data.note.body, '');
});

test('note and source writes roll back together when a source insert fails', async () => {
  const s = setup(), docId = s.doc(), threadId = s.thread(docId);
  s.sql.exec("CREATE TRIGGER reject_note_source BEFORE INSERT ON study_note_sources BEGIN SELECT RAISE(ABORT,'source failure'); END");
  const result = await s.create({sources: [{project: '信号处理', docId, threadId}]});
  assert.equal(result.status, 503);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM study_notes').get().n, 0);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM learning_credits').get().n, 0);
  s.sql.exec('DROP TRIGGER reject_note_source');
  assert.equal((await s.create({sources: [{project: '信号处理', docId, threadId}]})).status, 200);
});

test('notes reject anonymous and malformed requests before writing', async () => {
  const s = setup();
  s.ctx.owner = '';
  assert.equal((await s.req('notes')).status, 401);
  s.ctx.owner = 'alice';
  assert.equal((await s.create({body: 'x'.repeat(250001)})).status, 400);
  assert.equal((await s.create({title: 'x'.repeat(121)})).status, 400);
  assert.equal((await s.create({sources: [{project: ''}]})).status, 400);
  assert.equal((await s.create({sources: [{project: '另一个用户的项目'}]})).status, 404);
  assert.equal((await s.create({sources: new Array(51).fill({project: '数学'})})).status, 400);
});

test('project renames and document moves update notebook sources and their deletion snapshots', async () => {
  const s = setup(), docId = s.doc(), threadId = s.thread(docId);
  const linked = (await s.create({sources: [{project: '信号处理', docId, threadId}]})).data.note;
  const projectNote = (await s.create({sources: [{project: '信号处理'}]})).data.note;
  assert.equal((await s.req('projects/manage', 'POST', {action: 'rename', project: '信号处理', target: '信号与系统'})).status, 200);
  let notes = (await s.req('notes')).data.notes;
  assert.equal(notes.find(note => note.id === linked.id).sources[0].project, '信号与系统');
  assert.equal(notes.find(note => note.id === projectNote.id).sources[0].project, '信号与系统');
  // The still-open editor has the old name. Saving must resolve the renamed
  // project without reverting it or discarding the user's text.
  assert.equal((await s.save(projectNote, {body: '项目改名后继续编辑'})).status, 200);
  await s.req('projects', 'POST', {name: '数学'});
  assert.equal((await s.req(`docs/${docId}/organize`, 'POST', {course: '数学', existingProject: true})).status, 200);
  await s.req(`docs/${docId}`, 'DELETE');
  notes = (await s.req('notes')).data.notes;
  const source = notes.find(note => note.id === linked.id).sources[0];
  assert.equal(source.project, '数学');
  assert.equal(source.available, false);
  assert.equal(notes.find(note => note.id === projectNote.id).sources[0].project, '信号与系统');
});
