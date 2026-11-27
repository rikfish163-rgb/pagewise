'use client';

import { useLocale } from './LocaleProvider';
import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {Check, FilePlus2, NotebookPen, Search, X} from 'lucide-react';
import {
  noteExcerpt, noteNumber, noteSaveChoiceLabel, noteSaveScopeLabel,
  type NoteSaveChoice, type NoteSaveIntent, type StudyNote,
} from '../lib/notebook-model';
import './note-save.css';
import { translate, type Locale } from '../lib/i18n';

export type NoteSaveReceipt = {
  status: 'saving' | 'saved' | 'error';
  noteId?: string;
  noteNumber?: number;
  noteTitle?: string;
  error?: string;
};

export type NoteSaveDialogProps = {
  intent: NoteSaveIntent | null;
  notes: StudyNote[];
  onConfirm: (choice: NoteSaveChoice) => void;
  onClose: () => void;
  busy?: boolean;
  receipt?: NoteSaveReceipt;
};

const dateLabel = (value: number, locale: Locale) =>
  Number.isFinite(value) ? new Intl.DateTimeFormat(locale, {month: locale === 'en' ? 'short' : 'numeric', day: 'numeric'}).format(value) : '';

function sourceLine(source: NoteSaveIntent['sources'][number], locale: Locale = 'zh-CN'): string {
  return [source.project, source.page ? translate(locale, '第 {page} 页', { page: source.page }) : ''].filter(Boolean).join(' · ')
    || translate(locale, '未标注来源');
}

export default function NoteSaveDialog({intent, notes, onConfirm, onClose, busy = false, receipt}: NoteSaveDialogProps) {
  const { t, locale } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId(), searchId = useId();
  const [mode, setMode] = useState<'create' | 'append'>('create');
  const [targetId, setTargetId] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setMode('create');
    setTargetId('');
    setQuery('');
  }, [intent]);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (intent && !node.open) node.showModal();
    if (!intent && node.open) node.close();
  }, [intent]);

  const term = query.trim().toLocaleLowerCase();
  const matching = useMemo(() => notes.filter(note => !term || `${noteNumber(note.number)} ${note.number} ${
    note.title} ${note.body} ${note.sources.map(source => source.project).join(' ')}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => b.updatedAt - a.updatedAt), [notes, term]);
  const target = notes.find(note => note.id === targetId);
  const sources = intent ? [...new Map(intent.sources.map(source => [sourceLine(source), source])).values()] : [];
  const choice: NoteSaveChoice = mode === 'create' ? {mode: 'create'} : {mode: 'append', noteId: targetId};
  const saved = receipt?.status === 'saved';
  const retrying = receipt?.status === 'error' && !!receipt.noteId;
  const lockDestination = busy || saved || retrying;
  const canConfirm = !!intent && !busy && !saved && (retrying || mode === 'create' || !!target);
  const targetLabel = mode === 'append' && target ? noteSaveChoiceLabel(choice, notes, locale) : t('新建笔记');

  function confirm() {
    if (!canConfirm) return;
    onConfirm(choice);
  }

  if (!intent) return null;
  return <dialog ref={dialog} className="nsd" aria-labelledby={titleId}
    onCancel={event => {if (busy) event.preventDefault(); else onClose();}}
    onClick={event => {if (event.target === event.currentTarget && !busy) onClose();}}>
    <div className="nsd-sheet">
      <header className="nsd-header">
        <div><NotebookPen size={19} aria-hidden="true"/><h2 id={titleId}>{t("存入笔记")}</h2></div>
        <button type="button" aria-label={t("关闭保存笔记")} disabled={busy} onClick={onClose}><X size={18}/></button>
      </header>

      <section className="nsd-scope" aria-label={t("要保存的内容")}>
        <p className="nsd-scope-label">{noteSaveScopeLabel(intent, locale)}</p>
        <h3>{intent.title || t("未命名内容")}</h3>
        <pre className="nsd-preview">{intent.text.trim() || t("没有可保存的正文")}</pre>
        {sources.length > 0 && <ul className="nsd-sources" aria-label={t("内容来源")}>
          {sources.map(source => <li key={sourceLine(source)}>{sourceLine(source, locale)}</li>)}
        </ul>}
        <p className="nsd-count">{t("{0} 字符 · 原样保存，不改写回答", { 0: intent.text.trim().length.toLocaleString() })}</p>
      </section>

      <section className="nsd-choice" aria-label={t("保存方式")}>
        <div className="nsd-modes" role="group" aria-label={t("新建或追加")}>
          <button type="button" aria-pressed={mode === 'create'} disabled={lockDestination} onClick={() => setMode('create')}>
            <FilePlus2 size={16} aria-hidden="true"/>{t("新建笔记")}</button>
          <button type="button" aria-pressed={mode === 'append'} disabled={lockDestination || !notes.length}
            title={!notes.length ? t("还没有可追加的笔记") : undefined} onClick={() => setMode('append')}>
            <NotebookPen size={16} aria-hidden="true"/>{t("追加到已有笔记")}{notes.length ? ` · ${notes.length}` : ''}
          </button>
        </div>

        {mode === 'create'
          ? <p className="nsd-hint">{t("新笔记会以「{0}」为题，并关联上面列出的来源。", { 0: intent.title || t('未命名笔记') })}</p>
          : <div className="nsd-targets">
            <label className="nsd-search" htmlFor={searchId}><Search size={15} aria-hidden="true"/>
              <span className="nsd-sr-only">{t("搜索要追加的笔记")}</span>
              <input id={searchId} type="search" value={query} placeholder={t("搜索编号、标题或正文")}
                disabled={lockDestination} onChange={event => setQuery(event.target.value)}/>
            </label>
            {matching.length > 0
              ? <ul className="nsd-list" aria-label={t("选择要追加的笔记")}>{matching.map(note =>
                <li key={note.id}><button type="button" aria-pressed={note.id === targetId} disabled={lockDestination}
                  onClick={() => setTargetId(note.id)}>
                  <span className="nsd-note-head"><span className="nsd-number">{noteNumber(note.number)}</span>
                    <strong>{note.title || t("未命名笔记")}</strong>{note.id === targetId && <Check size={15} aria-hidden="true"/>}</span>
                  <span className="nsd-note-excerpt">{noteExcerpt(note.body) || t("还没有正文")}</span>
                  <small>{[...new Set(note.sources.map(source => source.project))].join('、') || t("独立笔记")}
                    {dateLabel(note.updatedAt, locale) && ` · ${dateLabel(note.updatedAt, locale)}`}</small>
                </button></li>)}
              </ul>
              : <p className="nsd-empty" role="status">{notes.length ? t("没有匹配的笔记。") : t("还没有笔记，先新建一条。")}</p>}
            {target && <p className="nsd-hint" role="status">{t("追加到正文末尾，原有内容保持不动：{0}", { 0: noteExcerpt(target.body) || t('（空白笔记）') })}</p>}
          </div>}
      </section>

      {receipt?.status === 'error' && <p className="nsd-receipt is-error" role="alert">
        <strong>{t("未确认保存")}</strong>{receipt.error ? t(receipt.error) : t("请重试。")}
      </p>}
      {saved && <p className="nsd-receipt is-saved" role="status">
        <Check size={16} aria-hidden="true"/>{t("已保存到 ")}{receipt?.noteNumber
          ? t("{0} · {1}", { 0: noteNumber(receipt.noteNumber), 1: receipt.noteTitle ?? t('笔记') })
          : receipt?.noteTitle ?? t("笔记")}
      </p>}

      <footer className="nsd-actions">
        {saved
          ? <button type="button" className="nsd-primary" onClick={onClose}><Check size={16} aria-hidden="true"/>{t("完成")}</button>
          : <>
            <button type="button" disabled={busy} onClick={onClose}>{t("取消")}</button>
            {receipt?.status === 'error' && <button type="button" className="nsd-primary" disabled={!canConfirm} onClick={confirm}>
              {busy ? t("保存中…") : t("重试保存")}
            </button>}
            {receipt?.status !== 'error' && <button type="button" className="nsd-primary" disabled={!canConfirm} onClick={confirm}>
              {busy ? t("保存中…") : targetLabel}
            </button>}
          </>}
      </footer>
    </div>
  </dialog>;
}
