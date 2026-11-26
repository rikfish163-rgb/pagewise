import {discussionTitle, type Discussion, type StudyDoc} from './workspace-model.ts';
import type {StudyNote} from './notebook-model.ts';

export type ReviewEntry = {
  key: string;
  docId: string;
  page: number;
  title: string;
  threadId: string;
  answered: boolean;
  noteIds: string[];
};

export type ReviewDocument = {doc: StudyDoc; entries: ReviewEntry[]; noteIds: string[]};

export type ReviewNote = {
  note: StudyNote;
  docId?: string;
  threadId?: string;
  page?: number;
  project: string;
};

export type ReviewModel = {documents: ReviewDocument[]; notes: ReviewNote[]; total: number};

// Review is derived from saved discussions and notes only. Nothing here invents
// a chapter, a topic or a mastery state; a page appears because a real question
// was asked on it.
export function buildReview({docs, threads, notes}:
  {docs: StudyDoc[]; threads: Discussion[]; notes: StudyNote[]}): ReviewModel {
  const documents = new Map(docs.map(doc => [doc.id, doc]));
  const grouped = new Map<string, Map<number, ReviewEntry[]>>();
  for (const thread of threads) {
    if (thread.id.startsWith('draft-') || !documents.has(thread.docId)) continue;
    if (!thread.messages.some(message => message.role === 'user')) continue;
    const noteIds = notes.filter(note => note.sources.some(source =>
      source.threadId === thread.id || (source.docId === thread.docId && source.page === thread.page)))
      .map(note => note.id);
    const entry: ReviewEntry = {
      key: `review:${thread.id}`, docId: thread.docId, page: thread.page,
      title: discussionTitle(thread), threadId: thread.id,
      answered: thread.messages.some(message => message.role === 'assistant'), noteIds,
    };
    const pages = grouped.get(thread.docId) ?? new Map<number, ReviewEntry[]>();
    pages.set(thread.page, [...(pages.get(thread.page) ?? []), entry]);
    grouped.set(thread.docId, pages);
  }
  const reviewDocuments = docs.flatMap(doc => {
    const pages = grouped.get(doc.id);
    if (!pages) return [];
    const entries = [...pages.entries()].sort(([a], [b]) => a - b).flatMap(([, list]) => list);
    return [{doc, entries, noteIds: [...new Set(entries.flatMap(entry => entry.noteIds))]}];
  });
  const reviewNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).map(note => {
    const source = note.sources.find(item => item.docId) ?? note.sources[0];
    return {
      note,
      project: source?.project ?? '',
      ...(source?.docId ? {docId: source.docId} : {}),
      ...(source?.threadId ? {threadId: source.threadId} : {}),
      ...(source?.page ? {page: source.page} : {}),
    };
  });
  return {
    documents: reviewDocuments,
    notes: reviewNotes,
    total: reviewDocuments.reduce((sum, item) => sum + item.entries.length, 0) + reviewNotes.length,
  };
}
