import type {StudyNote} from './notebook-model';

export type NoteSave = {note: StudyNote; version: number; requestId: string; revision: number};
export type NoteEntry = {
  note: StudyNote;
  saved: StudyNote;
  version: number;
  status: 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
  error?: string;
  pending?: NoteSave;
};

export function savedNoteEntry(note: StudyNote): NoteEntry {
  return {note, saved: note, version: 0, status: 'saved'};
}

export function editNoteEntry(entry: NoteEntry, change: Partial<StudyNote>): NoteEntry {
  return {
    ...entry, note: {...entry.note, ...change, updatedAt: Date.now()}, version: entry.version + 1,
    status: entry.status === 'conflict' ? 'conflict' : 'dirty',
    error: entry.status === 'conflict' ? entry.error : undefined,
  };
}

// A response confirms only its captured edit. Text typed while it was in flight
// remains a draft and will be saved against the new server revision.
export function completeNoteSave(entry: NoteEntry, pending: NoteSave, saved: StudyNote): NoteEntry {
  // A conflict already holds text the student must merge. A response that was
  // in flight when the conflict appeared must not clear that draft.
  if (entry.status === 'conflict') return {...entry, saved, pending: undefined};
  const unchanged = entry.version === pending.version;
  return {
    note: unchanged ? saved : {...entry.note, revision: saved.revision},
    saved, version: entry.version, status: unchanged ? 'saved' : 'dirty',
  };
}
