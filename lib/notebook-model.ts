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

export type NotebookInsert = {
  id: number;
  noteId: string;
  title: string;
  text: string;
  sources: NoteSourceInput[];
};

export type NotebookInsertResult = {
  id: number;
  noteId: string;
  status: 'saving' | 'saved' | 'error';
  error?: string;
};

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
