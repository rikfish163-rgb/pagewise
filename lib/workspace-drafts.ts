import type {MessageSource} from './workspace-model';

export type DraftCitation = {
  page: number;
  text?: string;
  rect?: number[];
  kind?: MessageSource['kind'];
  /** Present only while writing; never persisted. */
  image?: string;
};
export type DraftSelection = {page: number; text?: string; rect?: number[]; image?: string};
export type WorkspaceDraft = {
  docId: string;
  threadId: string;
  text: string;
  selection?: {page: number; text?: string; rect?: number[]};
  citations: Omit<DraftCitation, 'image'>[];
  omitPrimary: boolean;
  omitImage: boolean;
  /** The draft referenced images that cannot be restored from local storage. */
  imageLost: boolean;
  updatedAt: number;
};
export type DraftBook = {version: 1; drafts: Record<string, WorkspaceDraft>};

const MAX_DRAFT_TEXT = 4000;
const MAX_CITATIONS = 12;
const MAX_SOURCE_TEXT = 700;
const KINDS = new Set(['selection', 'page', 'attachment', 'answer']);
const validPage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100000;
const validRect = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === 4 && value.every(number => typeof number === 'number' && Number.isFinite(number));

/** Account isolation lives in the storage key; no credential is ever stored. */
export function draftStorageKey(accountKey: string): string {
  return `pagewise:drafts:v1:${accountKey}`;
}

export function emptyDraftBook(): DraftBook {
  return {version: 1, drafts: {}};
}

function cleanCitation(value: unknown): Omit<DraftCitation, 'image'> | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  // A filename or screenshot label cannot substitute for the missing image.
  if (item.kind === 'attachment' || item.image) return null;
  if (!validPage(item.page)) return null;
  if (item.text !== undefined && (typeof item.text !== 'string' || item.text.length > MAX_SOURCE_TEXT)) return null;
  if (item.rect !== undefined && !validRect(item.rect)) return null;
  if (item.kind !== undefined && (typeof item.kind !== 'string' || !KINDS.has(item.kind))) return null;
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  return {
    page: item.page,
    ...(text ? {text} : {}),
    ...(item.rect ? {rect: item.rect as number[]} : {}),
    ...(item.kind ? {kind: item.kind as MessageSource['kind']} : {}),
  };
}

function cleanDraft(value: unknown): WorkspaceDraft | null {
  if (!value || typeof value !== 'object') return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.docId !== 'string' || !draft.docId || draft.docId.length > 100) return null;
  if (typeof draft.threadId !== 'string' || !draft.threadId || draft.threadId.length > 100) return null;
  const text = typeof draft.text === 'string' ? draft.text.slice(0, MAX_DRAFT_TEXT) : '';
  const rawSelection = draft.selection as Record<string, unknown> | undefined;
  const selection = rawSelection && validPage(rawSelection.page)
    ? {
        page: rawSelection.page,
        ...(typeof rawSelection.text === 'string' && rawSelection.text.trim() ? {text: rawSelection.text.trim()} : {}),
        ...(validRect(rawSelection.rect) ? {rect: rawSelection.rect} : {}),
      }
    : undefined;
  const rawCitations = Array.isArray(draft.citations) ? draft.citations : [];
  const citations = rawCitations.map(cleanCitation).filter((item): item is Omit<DraftCitation, 'image'> => !!item).slice(0, MAX_CITATIONS);
  const imageLost = draft.imageLost === true || (draft.omitImage !== true && !!rawSelection?.image)
    || rawCitations.some(item => item?.kind === 'attachment' || !!item?.image);
  if (!text.trim() && !citations.length && !selection && !imageLost) return null;
  return {
    docId: draft.docId, threadId: draft.threadId, text, citations,
    omitPrimary: draft.omitPrimary === true, omitImage: draft.omitImage === true,
    imageLost, updatedAt: Number.isFinite(draft.updatedAt) ? Number(draft.updatedAt) : 0,
    ...(selection ? {selection} : {}),
  };
}

export function parseDraftBook(raw: string | null): DraftBook {
  try {
    const value = JSON.parse(raw ?? 'null') as Record<string, unknown> | null;
    if (!value || value.version !== 1 || !value.drafts || typeof value.drafts !== 'object') return emptyDraftBook();
    const drafts: Record<string, WorkspaceDraft> = {};
    for (const draft of Object.values(value.drafts as Record<string, unknown>)) {
      const cleaned = cleanDraft(draft);
      if (cleaned) drafts[cleaned.threadId] = cleaned;
    }
    return {version: 1, drafts};
  } catch {
    return emptyDraftBook();
  }
}

export function saveDraft(book: DraftBook, draft: WorkspaceDraft & {selection?: DraftSelection}): DraftBook {
  const cleaned = cleanDraft(draft);
  const drafts = {...book.drafts};
  if (cleaned) drafts[cleaned.threadId] = cleaned;
  else delete drafts[draft.threadId];
  return {version: 1, drafts};
}

export function removeDraft(book: DraftBook, threadId: string): DraftBook {
  const drafts = {...book.drafts};
  delete drafts[threadId];
  return {version: 1, drafts};
}

export function draftForThread(book: DraftBook, threadId: string): WorkspaceDraft | undefined {
  return book.drafts[threadId];
}

export function draftsForDoc(book: DraftBook, docId: string): WorkspaceDraft[] {
  return Object.values(book.drafts)
    .filter(draft => draft.docId === docId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
