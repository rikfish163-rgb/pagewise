import {noteSourceKey, type NoteSource, type NoteSourceInput, type StudyNote} from '../lib/notebook-model.ts';
import {changed, persistWithCredit, validRequestId} from './learning-credits.ts';
import {projectName} from './study-projects.ts';

type NoteRow = {
  id: string; owner: string; number: number; title: string; body: string;
  revision: number; write_token: string; created_at: number; updated_at: number;
};
type SourceRow = {
  note_id: string; source_key: string; project: string; doc_id: string | null;
  document_name: string | null; thread_id: string | null;
  discussion_title: string | null; page: number | null;
};
type DocRow = {id: string; name: string; course: string};
type ThreadRow = {id: string; doc_id: string; page: number; selection_text: string | null; messages: string};
type Catalog = {docs: Map<string, DocRow>; threads: Map<string, ThreadRow>; projects: Set<string>};

class NoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {super(message); this.status = status;}
}
const reply = (body: unknown, status = 200) =>
  Response.json(body, {status, headers: {'Cache-Control': 'private, no-store'}});
export const legacyNoteId = (owner: string) => `legacy-notebook:${owner}`;

function sourceSnapshot(row: SourceRow): NoteSource {
  return {
    key: row.source_key, project: row.project,
    ...(row.doc_id ? {docId: row.doc_id} : {}),
    ...(row.document_name ? {documentName: row.document_name} : {}),
    ...(row.thread_id ? {threadId: row.thread_id} : {}),
    ...(row.discussion_title ? {discussionTitle: row.discussion_title} : {}),
    ...(row.page ? {page: row.page} : {}),
    available: false,
  };
}

function sourceView(source: NoteSource, catalog: Catalog): NoteSource {
  if (!source.docId) return {...source, available: catalog.projects.has(source.project)};
  const doc = catalog.docs.get(source.docId);
  const thread = source.threadId ? catalog.threads.get(source.threadId) : undefined;
  return {
    ...source,
    ...(doc ? {project: doc.course, documentName: doc.name} : {}),
    ...(thread ? {
      discussionTitle: discussionLabel(thread),
      page: source.page ?? thread.page,
    } : {}),
    available: !!doc && (!source.threadId || thread?.doc_id === doc.id),
  };
}

function discussionLabel(thread: ThreadRow): string {
  const messages = JSON.parse(thread.messages) as {role: string; content: string}[];
  return (messages.findLast(message => message.role === 'user')?.content.trim()
    || (thread.selection_text === '按页提问' ? '' : thread.selection_text?.trim())
    || `第 ${thread.page} 页的对话`).replace(/\s+/g, ' ').slice(0, 120);
}
const sourceIdentity = (source: NoteSource) =>
  [noteSourceKey(source), source.project, source.docId ?? null, source.threadId ?? null, source.page ?? null];

async function sourceCatalog(db: D1Database, owner: string): Promise<Catalog> {
  const [docs, threads, projects] = await Promise.all([
    db.prepare('SELECT id,name,course FROM documents WHERE owner=?').bind(owner).all<DocRow>(),
    db.prepare(`SELECT t.id,t.doc_id,t.page,t.selection_text,t.messages
      FROM threads t JOIN documents d ON d.id=t.doc_id
      WHERE t.owner=? AND d.owner=?`).bind(owner, owner).all<ThreadRow>(),
    db.prepare(`SELECT name FROM study_projects WHERE owner=?
      UNION SELECT course AS name FROM documents WHERE owner=?`).bind(owner, owner).all<{name: string}>(),
  ]);
  return {
    docs: new Map(docs.results.map(doc => [doc.id, doc])),
    threads: new Map(threads.results.map(thread => [thread.id, thread])),
    projects: new Set(projects.results.map(project => project.name)),
  };
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 250 && !/[\x00-\x1f\x7f]/.test(value);
const validNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999999999;

function resolveSources(input: unknown, catalog: Catalog, previous: NoteSource[] = []): NoteSource[] {
  if (!Array.isArray(input) || input.length > 50) throw new NoteError('每条笔记最多关联 50 个项目或对话。');
  const sources = new Map<string, NoteSource>();
  for (const item of input) {
    if (!item || typeof item !== 'object') throw new NoteError('请选择有效的笔记来源。');
    const value = item as NoteSourceInput;
    const project = projectName(value.project);
    if (!project || (value.docId !== undefined && !validId(value.docId))
      || (value.threadId !== undefined && !validId(value.threadId))
      || (value.page !== undefined && (!Number.isSafeInteger(value.page) || value.page <= 0)))
      throw new NoteError('请选择有效的项目、对话和页码。');
    const key = noteSourceKey(value);
    const old = previous.find(source => source.key === key);
    const thread = value.threadId ? catalog.threads.get(value.threadId) : undefined;
    const doc = catalog.docs.get(thread?.doc_id ?? value.docId ?? '');
    if (value.threadId && (!thread || !doc)) {
      if (!old) throw new NoteError('来源对话已不存在，或不属于当前账户。', 404);
      sources.set(key, sourceView(old, catalog));
    } else if (value.docId && (!doc || (thread && thread.doc_id !== value.docId))) {
      if (!old || doc) throw new NoteError('来源资料已不存在，或不属于当前账户。', 404);
      sources.set(key, sourceView(old, catalog));
    } else if (doc) {
      sources.set(key, {
        key, project: doc.course, docId: doc.id, documentName: doc.name, available: true,
        ...(thread ? {threadId: thread.id, discussionTitle: discussionLabel(thread)} : {}),
        ...(value.page !== undefined || thread ? {page: value.page ?? thread!.page} : {}),
      });
    } else if (catalog.projects.has(project)) {
      sources.set(key, {key, project, available: true});
    } else if (old) {
      sources.set(key, sourceView(old, catalog));
    } else {
      throw new NoteError('来源项目已不存在，或不属于当前账户。', 404);
    }
  }
  return [...sources.values()];
}

async function allocateNumber(db: D1Database, owner: string, requested?: number): Promise<number> {
  const row = await db.prepare(`INSERT INTO study_note_counters(owner,last_number) VALUES(?1,COALESCE(?2,1))
    ON CONFLICT(owner) DO UPDATE SET last_number=CASE WHEN ?2 IS NULL THEN last_number+1
      ELSE MAX(last_number,?2) END RETURNING last_number`).bind(owner, requested ?? null)
    .first<{last_number: number}>();
  const number = requested ?? row!.last_number;
  if (!validNumber(number)) throw new NoteError('笔记编号须为 1 到 999999999 的整数。');
  return number;
}

// The previous Worker may write after migrations and before the new Worker
// takes over. Reconcile its newer revision without granting another reward.
async function importLegacyNotebook(db: D1Database, owner: string) {
  const id = legacyNoteId(owner);
  const existing = await db.prepare('SELECT revision FROM study_notes WHERE id=? AND owner=?')
    .bind(id, owner).first<{revision: number}>();
  const old = await db.prepare('SELECT body,revision FROM notebooks WHERE owner=?').bind(owner)
    .first<{body: string; revision: number}>();
  if (existing) {
    if (old && old.revision > existing.revision) {
      await db.prepare(`UPDATE study_notes SET body=?,revision=?,write_token=?,updated_at=?
        WHERE id=? AND owner=? AND revision<?
          AND EXISTS(SELECT 1 FROM notebooks WHERE owner=? AND revision=? AND body=?)`)
        .bind(old.body, old.revision, crypto.randomUUID(), Date.now(), id, owner, old.revision,
          owner, old.revision, old.body).run();
    }
    return;
  }
  if (!old?.body) return;
  const number = await allocateNumber(db, owner);
  await db.prepare(`INSERT INTO study_notes(id,owner,number,title,body,revision,write_token,created_at,updated_at)
    VALUES(?,?,?,'原学习笔记',?,?,?,0,0) ON CONFLICT(id) DO NOTHING`)
    .bind(id, owner, number, old.body, Math.max(1, old.revision), crypto.randomUUID()).run();
}

async function readNotes(db: D1Database, owner: string, id?: string): Promise<StudyNote[]> {
  const [rows, sources, catalog] = await Promise.all([
    db.prepare(`SELECT * FROM study_notes WHERE owner=?${id ? ' AND id=?' : ''}
      ORDER BY updated_at DESC,number DESC`).bind(owner, ...(id ? [id] : [])).all<NoteRow>(),
    db.prepare(`SELECT s.* FROM study_note_sources s JOIN study_notes n ON n.id=s.note_id
      WHERE s.owner=? AND n.owner=?${id ? ' AND n.id=?' : ''} ORDER BY s.rowid`)
      .bind(owner, owner, ...(id ? [id] : [])).all<SourceRow>(),
    sourceCatalog(db, owner),
  ]);
  const byNote = new Map<string, NoteSource[]>();
  for (const row of sources.results) {
    const list = byNote.get(row.note_id) ?? [];
    list.push(sourceView(sourceSnapshot(row), catalog));
    byNote.set(row.note_id, list);
  }
  return rows.results.map(row => ({
    id: row.id, number: row.number, title: row.title, body: row.body, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at, sources: byNote.get(row.id) ?? [],
  }));
}

function sourceWrites(db: D1Database, owner: string, id: string, token: string, sources: NoteSource[]) {
  const guard = 'EXISTS(SELECT 1 FROM study_notes WHERE id=? AND owner=? AND write_token=?)';
  return [
    db.prepare(`DELETE FROM study_note_sources WHERE note_id=? AND owner=? AND ${guard}`)
      .bind(id, owner, id, owner, token),
    ...sources.map(source => db.prepare(`INSERT INTO study_note_sources
      (note_id,source_key,owner,project,doc_id,document_name,thread_id,discussion_title,page)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`)
      .bind(id, source.key, owner, source.project, source.docId ?? null, source.documentName ?? null,
        source.threadId ?? null, source.discussionTitle ?? null, source.page ?? null, id, owner, token)),
  ];
}

export async function handleNotes(request: Request, path: string[], db: D1Database, owner: string): Promise<Response> {
  try {
    if (path.length > 2 || (path[1] && !validId(path[1]))) return reply({error: '找不到这条笔记。'}, 404);
    await importLegacyNotebook(db, owner);
    const id = path[1];
    if (request.method === 'GET') {
      const notes = await readNotes(db, owner, id);
      return id ? notes[0] ? reply({note: notes[0]}) : reply({error: '找不到这条笔记。'}, 404) : reply({notes});
    }
    const previous = id ? await db.prepare('SELECT * FROM study_notes WHERE id=? AND owner=?')
      .bind(id, owner).first<NoteRow>() : null;
    if (id && !previous) return reply({error: '找不到这条笔记。'}, 404);
    if (request.method === 'DELETE' && previous) {
      // No document/discussion is deleted with a note.
      await db.batch([
        db.prepare('DELETE FROM study_note_sources WHERE note_id=? AND owner=?').bind(id, owner),
        ...(id === legacyNoteId(owner) ? [db.prepare('DELETE FROM notebooks WHERE owner=?').bind(owner)] : []),
        db.prepare('DELETE FROM study_notes WHERE id=? AND owner=?').bind(id, owner),
      ]);
      return reply({ok: true});
    }
    if (request.method !== 'POST') return reply({error: '不支持此笔记操作。'}, 405);
    const input = await request.json() as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NoteError('笔记格式无效。');
    const noteId = id ?? (input.id === undefined ? crypto.randomUUID() : input.id);
    if (!id && !validRequestId(noteId)) throw new NoteError('笔记标识无效。');
    if (!id) {
      // Check before resolving sources: a saved source may have been deleted
      // between the original create and a retry of its lost response.
      const existing = (await readNotes(db, owner, noteId as string))[0];
      if (existing) return reply({note: existing});
    }
    const body = input.body;
    const title = input.title === undefined ? previous?.title ?? '未命名笔记' : input.title;
    if (typeof body !== 'string' || body.length > 250000) throw new NoteError('每条笔记最多 25 万字。');
    if (typeof title !== 'string' || title.trim().length > 120) throw new NoteError('笔记标题最多 120 字。');
    if (input.number !== undefined && !validNumber(input.number)) throw new NoteError('笔记编号须为 1 到 999999999 的整数。');
    const token = input.requestId === undefined ? crypto.randomUUID() : input.requestId;
    if (!validRequestId(token)) throw new NoteError('笔记保存标识无效，请重试。');
    const oldSources = previous ? (await readNotes(db, owner, previous.id))[0].sources : [];
    const sources = resolveSources(input.sources ?? oldSources, await sourceCatalog(db, owner), oldSources);
    if (previous && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1))
      throw new NoteError('请提供笔记的已保存版本。');
    const number = input.number as number | undefined ?? previous?.number ?? await allocateNumber(db, owner);
    const cleanTitle = title.trim() || '未命名笔记';
    if (previous?.write_token === token) {
      if (previous.body !== body || previous.title !== cleanTitle || previous.number !== number
        || JSON.stringify(oldSources.map(sourceIdentity)) !== JSON.stringify(sources.map(sourceIdentity)))
        throw new NoteError('请使用新的保存标识提交修改。', 409);
      return reply({note: (await readNotes(db, owner, previous.id))[0]});
    }
    const now = Date.now();
    const legacy = noteId === legacyNoteId(owner);
    if (input.number !== undefined) await allocateNumber(db, owner, number);
    const action = previous
      ? db.prepare(`UPDATE study_notes SET number=?,title=?,body=?,revision=revision+1,write_token=?,updated_at=?
        WHERE id=? AND owner=? AND revision=?${legacy
          ? ' AND NOT EXISTS(SELECT 1 FROM notebooks WHERE owner=? AND revision>?)' : ''}`)
        .bind(number, cleanTitle, body, token, now, noteId, owner, input.revision,
          ...(legacy ? [owner, input.revision] : []))
      : db.prepare(`INSERT INTO study_notes(id,owner,number,title,body,revision,write_token,created_at,updated_at)
        VALUES(?,?,?,?,?,1,?,?,?) ON CONFLICT(id) DO NOTHING`)
        .bind(noteId, owner, number, cleanTitle, body, token, now, now);
    const following = sourceWrites(db, owner, noteId as string, token, sources);
    if (legacy) following.push(db.prepare(`UPDATE notebooks SET body=?,revision=?
      WHERE owner=? AND EXISTS(SELECT 1 FROM study_notes WHERE id=? AND owner=? AND write_token=?)`)
      .bind(body, Number(input.revision) + 1, owner, noteId, owner, token));
    const saved = await persistWithCredit(db, action, owner, 'note_saved', noteId as string,
      !!body.trim() && body !== previous?.body, now, following);
    if (!changed(saved)) {
      if (!previous) {
        const existing = (await readNotes(db, owner, noteId as string))[0];
        if (existing) return reply({note: existing});
      }
      return reply({error: '笔记已在其他窗口更新。请先导出当前编辑，再读取已保存版本。', code: 'note_changed'}, 409);
    }
    return reply({note: (await readNotes(db, owner, noteId as string))[0]});
  } catch (error) {
    if (error instanceof NoteError) return reply({error: error.message}, error.status);
    if (error instanceof SyntaxError) return reply({error: '笔记格式无效。'}, 400);
    if (error instanceof Error && /UNIQUE constraint failed: study_notes.owner, study_notes.number/i.test(error.message))
      return reply({error: '已有相同编号的笔记，请换一个编号。', code: 'note_number_taken'}, 409);
    throw error;
  }
}
