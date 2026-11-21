import type {MemorySourceRef} from './learning-memory';
import type { TutorProcessing } from './tutor-models';
export type Selection = { page: number; text?: string; image?: string; rect?: number[] };
export type Message = { page?:number; role: string; content: string; createdAt?: number; processing?: TutorProcessing; memorySources?:MemorySourceRef[] };
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

export function questionTime(timestamp?: number): string {
  return timestamp && Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(timestamp)
    : '';
}

export function discussionTitle(discussion: Discussion): string {
  const latestQuestion = discussion.messages.findLast(message => message.role === 'user');
  const time = questionTime(latestQuestion?.createdAt ?? discussion.createdAt);
  const title = latestQuestion?.content.trim().replace(/\s+/g, ' ') || '未发送的问题';
  return time ? `${time} · ${title}` : title;
}

export function latestQuestionTime(discussion: Discussion): number {
  return discussion.messages.findLast(message => message.role === 'user')?.createdAt ?? discussion.createdAt ?? 0;
}
