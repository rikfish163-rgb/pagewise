import { translate, type Locale } from './i18n.ts';

import type {Discussion, StudyDoc} from './workspace-model';

export type NoteSourceInput = {
  project: string;
  docId?: string;
  threadId?: string;
  page?: number;
};

export type NoteSource = NoteSourceInput & {
  key: string;
  documentName?: string;
  discussionTitle?: string;
  available: boolean;
};

export type StudyNote = {
  id: string;
  number: number;
  title: string;
  body: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  sources: NoteSource[];
};

// A save starts from what the student actually selected or read. The dialog
// shows this intent before anything is written.
export type NoteSaveIntent = {
  kind: 'selection' | 'answer' | 'discussion';
  title: string;
  text: string;
  sources: NoteSourceInput[];
};

export type NoteSaveChoice = {mode: 'create'} | {mode: 'append'; noteId: string};

export type NotebookInsert = {
  id: number;
  noteId: string;
  title: string;
  text: string;
  sources: NoteSourceInput[];
} & ({mode?: 'create'} | {mode: 'append'; requestId: string});

export type NotebookInsertResult = {
  id: number;
  noteId: string;
  mode: 'create' | 'append';
  noteTitle?: string;
  noteNumber?: number;
  status: 'saving' | 'saved' | 'error';
  error?: string;
};

const saveScopeLabels: Record<NoteSaveIntent['kind'], string> = {
  selection: '讲义选区', answer: '一轮回答', discussion: '整段讨论',
};

export function noteSaveScopeLabel(intent: NoteSaveIntent, locale: Locale = 'zh-CN'): string {
  return translate(locale, saveScopeLabels[intent.kind]);
}

export function noteSaveChoiceLabel(choice: NoteSaveChoice, notes: StudyNote[], locale: Locale = 'zh-CN'): string {
  if (choice.mode === 'create') return translate(locale, '新建笔记');
  const note = notes.find(item => item.id === choice.noteId);
  return note ? translate(locale, '追加到 {number} · {title}', {
    number: noteNumber(note.number), title: note.title || translate(locale, '未命名笔记'),
  }) : translate(locale, '追加到已删除的笔记');
}

// One definition for both the client preview and the server write, so the
// append never rewrites or reorders the text already in the note. Existing
// trailing newlines stay exactly as written; only a missing gap is filled.
export function appendNoteBody(body: string, text: string): string {
  const addition = text.replace(/^\s+/, '').replace(/\s+$/, '');
  if (!addition) return body;
  if (!body.trim()) return addition;
  const existing = body.replace(/[ \t]+$/, '');
  const trailing = existing.match(/\n*$/)?.[0].length ?? 0;
  return `${existing}${'\n'.repeat(Math.max(0, 2 - trailing))}${addition}`;
}

export function notebookInsertMode(insert: NotebookInsert): 'create' | 'append' {
  return insert.mode === 'append' ? 'append' : 'create';
}

export function notebookInsertRequest(insert: NotebookInsert) {
  if (insert.mode === 'append') {
    return {
      path: `/${encodeURIComponent(insert.noteId)}`,
      body: {mode: 'append' as const, text: insert.text, sources: insert.sources, requestId: insert.requestId},
    };
  }
  return {
    path: '',
    body: {id: insert.noteId, title: insert.title, body: insert.text, sources: insert.sources},
  };
}

export function noteSourceKey(source: NoteSourceInput): string {
  return source.threadId ? `thread:${source.threadId}`
    : source.docId ? `document:${source.docId}` : `project:${source.project}`;
}

export function currentNoteSource(doc: StudyDoc, thread?: Discussion): NoteSourceInput {
  return {
    project: doc.course,
    docId: doc.id,
    ...(thread && !thread.id.startsWith('draft-') ? {threadId: thread.id} : {}),
    ...(thread ? {page: thread.page} : {}),
  };
}

export function noteNumber(number: number): string {
  return `#${String(number).padStart(3, '0')}`;
}

export function noteExcerpt(body: string): string {
  return body.replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/[#>*_`=~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export function matchingNotes(notes: StudyNote[], {
  project = '', threadId = '', query = '',
}: {project?: string; threadId?: string; query?: string}): StudyNote[] {
  const term = query.trim().toLocaleLowerCase();
  return notes.filter(note =>
    (!project || note.sources.some(source => source.project === project)) &&
    (!threadId || note.sources.some(source => source.threadId === threadId)) &&
    (!term || `${noteNumber(note.number)} ${note.number} ${note.title} ${note.body} ${
      note.sources.map(source => `${source.project} ${source.documentName ?? ''} ${source.discussionTitle ?? ''}`).join(' ')
    }`.toLocaleLowerCase().includes(term)),
  ).sort((a, b) => b.updatedAt - a.updatedAt || b.number - a.number);
}
