import { discussionTopic, type Discussion, type Message } from './workspace-model.ts';
import { messageSources } from './workspace-sources.ts';

export type NoteLink = (page?: number) => string;

/** Provenance for one answered round. Legacy rounds name their own question page. */
export function roundSourceLines(
  message: Message, docId: string, previousPage: number | undefined, link: NoteLink,
): string[] {
  const stored = !!message.sources?.length;
  const sources = messageSources(message, docId, previousPage);
  if (!sources.length) return [];
  return [
    stored ? '#### 本轮引用' : '#### 本轮引用（本轮起点页）',
    ...sources.map(source => `- ${link(source.page)}${source.text ? ` · ${source.text}` : ''}`),
  ];
}

/** Full discussion transcript with each round's actual evidence, not only the conclusion. */
export function discussionNoteBlocks(
  discussion: Discussion, docId: string, {heading, link}: {heading: string; link: NoteLink},
): string[] {
  const blocks = [`## ${heading} · 讨论笔记`, link(discussion.page), `主题：${discussionTopic(discussion)}`];
  discussion.messages.forEach((message, index) => {
    if (message.role === 'user') {
      blocks.push(`### 问题\n\n${message.content}`);
      return;
    }
    blocks.push(`### 回答\n\n${message.content}`);
    blocks.push(...roundSourceLines(message, docId, discussion.messages[index - 1]?.page, link));
  });
  return blocks;
}
