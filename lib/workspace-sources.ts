import type {MessageSource} from './workspace-model';

export const MAX_MESSAGE_SOURCES = 12;
export const MAX_SOURCE_TEXT = 700;
const SOURCE_KINDS = new Set(['selection', 'page', 'attachment', 'answer']);

export function sourceKey(source: MessageSource): string {
  return `${source.kind ?? 'page'}:${source.docId}:${source.page}:${source.text ?? ''}`;
}

/**
 * Validate evidence supplied with an answer. Returns null when the payload is
 * untrustworthy, so callers can reject it before inference or charging.
 */
export function sanitizeMessageSources(value: unknown, docId: string): MessageSource[] | null {
  if (!Array.isArray(value) || value.length > MAX_MESSAGE_SOURCES) return null;
  const seen = new Set<string>();
  const sources: MessageSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const {docId: sourceDocId, page, text, rect, kind} = item as Record<string, unknown>;
    if (sourceDocId !== docId) return null;
    if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return null;
    if (text !== undefined && (typeof text !== 'string' || text.length > MAX_SOURCE_TEXT)) return null;
    if (rect !== undefined && (!Array.isArray(rect) || rect.length !== 4
      || rect.some(value => typeof value !== 'number' || !Number.isFinite(value)))) return null;
    if (kind !== undefined && (typeof kind !== 'string' || !SOURCE_KINDS.has(kind))) return null;
    const trimmed = typeof text === 'string' ? text.trim() : '';
    const source: MessageSource = {
      docId, page,
      ...(trimmed ? {text: trimmed} : {}),
      ...(rect ? {rect: rect as number[]} : {}),
      ...(kind ? {kind: kind as MessageSource['kind']} : {}),
    };
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

/** Stored sources when present; otherwise the round's own page, never another round's. */
export function messageSources(
  message: {sources?: MessageSource[]}, docId: string, fallbackPage?: number,
): MessageSource[] {
  if (message.sources?.length) return message.sources;
  return fallbackPage && Number.isSafeInteger(fallbackPage) && fallbackPage > 0
    ? [{docId, page: fallbackPage}]
    : [];
}

/** Build answer evidence from reader selections. Image data stays out of storage. */
export function selectionSources(
  items: {page: number; text?: string; rect?: number[]; image?: string}[],
  docId: string,
  kind: 'selection' | 'page' | 'attachment' | 'answer' = 'page',
): MessageSource[] {
  const shaped = items.slice(0, MAX_MESSAGE_SOURCES).map(item => ({
    docId, page: item.page,
    ...(item.text?.trim() ? {text: item.text.trim().slice(0, MAX_SOURCE_TEXT)} : {}),
    ...(item.rect && item.rect.length === 4 && item.rect.every(Number.isFinite) ? {rect: item.rect} : {}),
    kind,
  }));
  return sanitizeMessageSources(shaped, docId) ?? [];
}

export function citationFeedback(added: number, total: number): string {
  return `已添加 ${added} 个引用 · 共 ${total} 个（最多 ${MAX_MESSAGE_SOURCES} 个）`;
}

export function citationLimitFeedback(): string {
  return `最多 ${MAX_MESSAGE_SOURCES} 个引用，请先移除部分引用再添加。`;
}
