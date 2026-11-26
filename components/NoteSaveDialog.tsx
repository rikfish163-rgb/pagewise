'use client';

import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {Check, FilePlus2, NotebookPen, Search, X} from 'lucide-react';
import {
  noteExcerpt, noteNumber, noteSaveChoiceLabel, noteSaveScopeLabel,
  type NoteSaveChoice, type NoteSaveIntent, type StudyNote,
} from '../lib/notebook-model';
import './note-save.css';

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

const dateLabel = (value: number) =>
  Number.isFinite(value) ? new Intl.DateTimeFormat('zh-CN', {month: 'numeric', day: 'numeric'}).format(value) : '';

function sourceLine(source: NoteSaveIntent['sources'][number]): string {
  return [source.project, source.page ? `第 ${source.page} 页` : ''].filter(Boolean).join(' · ') || '未标注来源';
}

export default function NoteSaveDialog({intent, notes, onConfirm, onClose, busy = false, receipt}: NoteSaveDialogProps) {
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
  const targetLabel = mode === 'append' && target ? noteSaveChoiceLabel(choice, notes) : '新建笔记';

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
        <div><NotebookPen size={19} aria-hidden="true"/><h2 id={titleId}>存入笔记</h2></div>
        <button type="button" aria-label="关闭保存笔记" disabled={busy} onClick={onClose}><X size={18}/></button>
      </header>

      <section className="nsd-scope" aria-label="要保存的内容">
        <p className="nsd-scope-label">{noteSaveScopeLabel(intent)}</p>
        <h3>{intent.title || '未命名内容'}</h3>
        <pre className="nsd-preview">{intent.text.trim() || '没有可保存的正文'}</pre>
        {sources.length > 0 && <ul className="nsd-sources" aria-label="内容来源">
          {sources.map(source => <li key={sourceLine(source)}>{sourceLine(source)}</li>)}
        </ul>}
        <p className="nsd-count">{intent.text.trim().length.toLocaleString()} 字符 · 原样保存，不改写回答</p>
      </section>

      <section className="nsd-choice" aria-label="保存方式">
        <div className="nsd-modes" role="group" aria-label="新建或追加">
          <button type="button" aria-pressed={mode === 'create'} disabled={lockDestination} onClick={() => setMode('create')}>
            <FilePlus2 size={16} aria-hidden="true"/>新建笔记
          </button>
          <button type="button" aria-pressed={mode === 'append'} disabled={lockDestination || !notes.length}
            title={!notes.length ? '还没有可追加的笔记' : undefined} onClick={() => setMode('append')}>
            <NotebookPen size={16} aria-hidden="true"/>追加到已有笔记{notes.length ? ` · ${notes.length}` : ''}
          </button>
        </div>

        {mode === 'create'
          ? <p className="nsd-hint">新笔记会以「{intent.title || '未命名笔记'}」为题，并关联上面列出的来源。</p>
          : <div className="nsd-targets">
            <label className="nsd-search" htmlFor={searchId}><Search size={15} aria-hidden="true"/>
              <span className="nsd-sr-only">搜索要追加的笔记</span>
              <input id={searchId} type="search" value={query} placeholder="搜索编号、标题或正文"
                disabled={lockDestination} onChange={event => setQuery(event.target.value)}/>
            </label>
            {matching.length > 0
              ? <ul className="nsd-list" aria-label="选择要追加的笔记">{matching.map(note =>
                <li key={note.id}><button type="button" aria-pressed={note.id === targetId} disabled={lockDestination}
                  onClick={() => setTargetId(note.id)}>
                  <span className="nsd-note-head"><span className="nsd-number">{noteNumber(note.number)}</span>
                    <strong>{note.title || '未命名笔记'}</strong>{note.id === targetId && <Check size={15} aria-hidden="true"/>}</span>
                  <span className="nsd-note-excerpt">{noteExcerpt(note.body) || '还没有正文'}</span>
                  <small>{[...new Set(note.sources.map(source => source.project))].join('、') || '独立笔记'}
                    {dateLabel(note.updatedAt) && ` · ${dateLabel(note.updatedAt)}`}</small>
                </button></li>)}
              </ul>
              : <p className="nsd-empty" role="status">{notes.length ? '没有匹配的笔记。' : '还没有笔记，先新建一条。'}</p>}
            {target && <p className="nsd-hint" role="status">追加到正文末尾，原有内容保持不动：{noteExcerpt(target.body) || '（空白笔记）'}</p>}
          </div>}
      </section>

      {receipt?.status === 'error' && <p className="nsd-receipt is-error" role="alert">
        <strong>未确认保存</strong>{receipt.error || '请重试。'}
      </p>}
      {saved && <p className="nsd-receipt is-saved" role="status">
        <Check size={16} aria-hidden="true"/>已保存到 {receipt?.noteNumber
          ? `${noteNumber(receipt.noteNumber)} · ${receipt.noteTitle ?? '笔记'}`
          : receipt?.noteTitle ?? '笔记'}
      </p>}

      <footer className="nsd-actions">
        {saved
          ? <button type="button" className="nsd-primary" onClick={onClose}><Check size={16} aria-hidden="true"/>完成</button>
          : <>
            <button type="button" disabled={busy} onClick={onClose}>取消</button>
            {receipt?.status === 'error' && <button type="button" className="nsd-primary" disabled={!canConfirm} onClick={confirm}>
              {busy ? '保存中…' : '重试保存'}
            </button>}
            {receipt?.status !== 'error' && <button type="button" className="nsd-primary" disabled={!canConfirm} onClick={confirm}>
              {busy ? '保存中…' : targetLabel}
            </button>}
          </>}
      </footer>
    </div>
  </dialog>;
}
