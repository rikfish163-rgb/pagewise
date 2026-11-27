import {discussionTitle, type Discussion, type StudyDoc} from './workspace-model.ts';
import { translate, type Locale } from './i18n.ts';
import type {StudyNote} from './notebook-model';

export type StudySearchKind = 'project' | 'doc' | 'question' | 'answer' | 'excerpt' | 'note';

export type StudySearchResult = {
  key: string;
  kind: StudySearchKind;
  title: string;
  snippet: string;
  meta: string;
  docId?: string;
  threadId?: string;
  page?: number;
  noteId?: string;
};

export type StudySearchGroup = {kind: StudySearchKind; label: string; results: StudySearchResult[]};

const groupLabels: Record<StudySearchKind, Record<Locale, string>> = {
  project: { 'zh-CN': '项目', en: 'Projects' },
  doc: { 'zh-CN': '资料', en: 'Documents' },
  question: { 'zh-CN': '提问', en: 'Questions' },
  answer: { 'zh-CN': '回答', en: 'Answers' },
  excerpt: { 'zh-CN': '讲义摘录', en: 'Document excerpts' },
  note: { 'zh-CN': '笔记', en: 'Notes' },
};
const groupOrder: StudySearchKind[] = ['project', 'doc', 'question', 'answer', 'excerpt', 'note'];
const perGroup = 10;

export const docTitle = (doc: StudyDoc): string => doc.name.replace(/\.(pdf|pptx)$/i, '');

export function matchSnippet(text: string, query: string, radius = 48): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const term = query.trim().toLocaleLowerCase();
  if (!term) return clean.slice(0, radius * 2);
  const index = clean.toLocaleLowerCase().indexOf(term);
  if (index < 0) return clean.length > radius * 2 ? `${clean.slice(0, radius * 2)}…` : clean;
  const start = Math.max(0, index - radius);
  const end = Math.min(clean.length, index + term.length + radius);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

const matches = (text: string | undefined, term: string) =>
  !!text && text.toLocaleLowerCase().includes(term);

function questionPage(thread: Discussion, index: number): number {
  for (let at = index; at >= 0; at -= 1) {
    const page = thread.messages[at]?.page;
    if (thread.messages[at]?.role === 'user' && page) return page;
  }
  return thread.page;
}

// Search runs only over material this account already loaded. Draft threads and
// threads whose document is gone are not reviewable sources, so they never
// appear as results.
export function searchStudy({docs, threads, notes, query, project = '', locale = 'zh-CN'}:
  {docs: StudyDoc[]; threads: Discussion[]; notes: StudyNote[]; query: string; project?: string; locale?: Locale}): StudySearchGroup[] {
  const t = (message: string, values?: Record<string, string | number>) => translate(locale, message, values);
  const term = query.trim().toLocaleLowerCase();
  if (!term) return [];
  const documents = new Map(docs.map(doc => [doc.id, doc]));
  const inScope = (doc: StudyDoc) => !project || doc.course === project;
  const groups: Record<StudySearchKind, StudySearchResult[]> = {
    project: [], doc: [], question: [], answer: [], excerpt: [], note: [],
  };

  const courses = [...new Set(docs.filter(inScope).map(doc => doc.course).filter(Boolean))];
  for (const course of courses) {
    if (!matches(course, term)) continue;
    groups.project.push({
      key: `project:${course}`, kind: 'project', title: course,
      snippet: '', meta: t('{count} 份资料', { count: docs.filter(doc => doc.course === course).length }),
    });
  }

  for (const doc of docs) {
    if (!inScope(doc) || !matches(doc.name, term)) continue;
    groups.doc.push({
      key: `doc:${doc.id}`, kind: 'doc', title: docTitle(doc), snippet: '',
      meta: `${doc.course} · ${doc.kind.toUpperCase()}`, docId: doc.id,
    });
  }

  for (const thread of threads) {
    if (thread.id.startsWith('draft-')) continue;
    const doc = documents.get(thread.docId);
    if (!doc || !inScope(doc)) continue;
    const title = discussionTitle(thread);
    const meta = (page: number) => `${docTitle(doc)} · ${t('第 {page} 页', { page })}`;
    thread.messages.forEach((message, index) => {
      if (message.role !== 'user' && message.role !== 'assistant') return;
      if (!matches(message.content, term)) return;
      const page = message.role === 'user' ? message.page ?? thread.page : questionPage(thread, index);
      const kind = message.role === 'user' ? 'question' as const : 'answer' as const;
      groups[kind].push({
        key: `${kind}:${thread.id}:${index}`, kind,
        title, snippet: matchSnippet(message.content, query), meta: meta(page),
        docId: doc.id, threadId: thread.id, page,
      });
    });
    // A "按页提问" round keeps the actual lecture text on its message excerpt,
    // not on thread.text. Search must cover the same text the student read.
    thread.messages.forEach((message, index) => {
      const excerpt = (message as {excerpt?: unknown}).excerpt;
      if (message.role !== 'user' || typeof excerpt !== 'string' || !matches(excerpt, term)) return;
      const page = message.page ?? thread.page;
      groups.excerpt.push({
        key: `excerpt:${thread.id}:${index}`, kind: 'excerpt',
        title: t('第 {page} 页 · 讲义摘录', { page }),
        snippet: matchSnippet(excerpt, query), meta: meta(page),
        docId: doc.id, threadId: thread.id, page,
      });
    });
    if (thread.text && thread.text !== '按页提问' && matches(thread.text, term)) {
      groups.excerpt.push({
        key: `excerpt:${thread.id}`, kind: 'excerpt',
        title: t('第 {page} 页 · 讲义摘录', { page: thread.page }),
        snippet: matchSnippet(thread.text, query), meta: meta(thread.page),
        docId: doc.id, threadId: thread.id, page: thread.page,
      });
    }
  }

  for (const note of [...notes].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const noteProjects = [...new Set(note.sources.map(source => source.project))];
    if (project && !noteProjects.includes(project)) continue;
    const sourceText = note.sources.map(source =>
      `${source.project} ${source.documentName ?? ''} ${source.discussionTitle ?? ''}`).join(' ');
    if (!matches(`${note.title} ${note.body} ${sourceText}`, term)) continue;
    const page = note.sources.find(source => source.page)?.page;
    const docId = note.sources.find(source => source.docId)?.docId;
    const threadId = note.sources.find(source => source.threadId)?.threadId;
    groups.note.push({
      key: `note:${note.id}`, kind: 'note',
      title: `#${String(note.number).padStart(3, '0')} ${note.title || t('未命名笔记')}`,
      snippet: matchSnippet(`${note.title} ${note.body}`.trim(), query),
      meta: [noteProjects.join(locale === 'en' ? ', ' : '、') || t('独立笔记'), page ? t('第 {page} 页', { page }) : ''].filter(Boolean).join(' · '),
      noteId: note.id, ...(docId ? {docId} : {}), ...(threadId ? {threadId} : {}), ...(page ? {page} : {}),
    });
  }

  return groupOrder
    .map(kind => ({kind, label: groupLabels[kind][locale], results: groups[kind].slice(0, perGroup)}))
    .filter(group => group.results.length > 0);
}
