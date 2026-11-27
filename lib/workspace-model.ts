import { type Locale } from './i18n.ts';

import type {MemorySourceRef} from './learning-memory';
import type { TutorProcessing } from './tutor-models';
export type Selection = { page: number; text?: string; image?: string; rect?: number[] };
/** Structured evidence for one answer round. Older messages may omit it. */
export type MessageSource = {
  docId: string;
  page: number;
  text?: string;
  rect?: number[];
  kind?: 'selection' | 'page' | 'attachment' | 'answer';
};
export type Message = { page?:number; role: string; content: string; createdAt?: number; processing?: TutorProcessing; memorySources?:MemorySourceRef[]; sources?:MessageSource[] };
export type Discussion = Selection & { id: string; docId: string; createdAt?: number; messages: Message[]; refs?: string[]; mastered?: string[] };
export type StudyDoc = { id: string; name: string; kind: 'pdf' | 'pptx'; course: string; pinned?:number; visited?:number };
export function dismissSelection<T extends {id:string}>(threads:T[],id:string,pending:boolean,draft:string):T[] {
  return id.startsWith('draft-') && !pending && !draft.trim() ? threads.filter(t=>t.id!==id) : threads;
}
export function updateThread<T extends {id:string}>(threads:T[],id:string,update:(thread:T)=>T):T[] {
  return threads.map(thread=>thread.id===id?update(thread):thread);
}
export function documentThreads<T extends {docId:string}>(threads:T[],docId:string):T[] {
  return threads.filter(thread=>thread.docId===docId);
}
export function selectionLabel(selection:Selection):string {
  return selection.text?.trim() || (selection.image ? `第 ${selection.page} 页 · 框选区域` : `第 ${selection.page} 页 · 自由提问`);
}

export function questionTime(timestamp?: number, locale: Locale = 'zh-CN'): string {
  return timestamp && Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(locale, {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(timestamp)
    : '';
}

/** Short replies such as "1", "q" or "继续" carry no topic of their own. */
export function lowInformationQuestion(text: string): boolean {
  const words = text.trim().replace(/[\s\p{P}\p{S}]/gu, '');
  if (!words) return true;
  if (/^\d+$/.test(words)) return true;
  if (/^[a-z]{1,2}$/i.test(words)) return true;
  // Answer markers such as "1/q", "1q" or "q2" survive punctuation stripping.
  if (/^\d+[a-z]?$/i.test(words) || /^[a-z]\d+$/i.test(words)) return true;
  return /^(继续|然后呢|为什么|为啥|啥|啥意思|什么意思|嗯|哦|好|可以|是的|不对|再来|下一个|详细点|展开|再说说|懂了|没懂|不懂)$/.test(words);
}

/** The latest substantive question, else the selection, else the first question. */
export function discussionTopic(discussion: Discussion): string {
  const questions = discussion.messages
    .filter(message => message.role === 'user')
    .map(message => message.content.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const substantive = questions.filter(question => !lowInformationQuestion(question));
  const selection = discussion.text?.trim().replace(/\s+/g, ' ');
  return substantive.at(-1)
    || (selection && selection !== '按页提问' ? selection : '')
    || questions[0]
    || '未发送的问题';
}

export function discussionTitle(discussion: Discussion, locale: Locale = 'zh-CN'): string {
  const latestQuestion = discussion.messages.findLast(message => message.role === 'user');
  const time = questionTime(latestQuestion?.createdAt ?? discussion.createdAt, locale);
  const title = discussionTopic(discussion);
  return time ? `${time} · ${title}` : title;
}

export function latestQuestionTime(discussion: Discussion): number {
  return discussion.messages.findLast(message => message.role === 'user')?.createdAt ?? discussion.createdAt ?? 0;
}
