'use client';

import { useLocale } from './LocaleProvider';
import { translate, type Locale } from '../lib/i18n';
import {useCallback, useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {BookOpen, ChevronLeft, FileText, Link2, MessageSquare, NotebookPen, Plus, Search, Trash2, X} from 'lucide-react';
import {discussionTitle, type Discussion, type StudyDoc} from '../lib/workspace-model';
import {
  currentNoteSource, matchingNotes, noteExcerpt, noteNumber, noteSourceKey, notebookInsertMode, notebookInsertRequest,
  type NotebookInsert, type NotebookInsertResult, type NoteSource, type NoteSourceInput, type StudyNote,
} from '../lib/notebook-model';
import {completeNoteSave, editNoteEntry, savedNoteEntry, type NoteEntry} from '../lib/notebook-drafts';
import NotebookEditor from './NotebookEditor';
import './notebook-library.css';

export type NotebookView = {version: number; project?: string; threadId?: string; noteId?: string};
export type NotebookProps = {
  visible: boolean;
  full: boolean;
  panelHost: HTMLElement | null;
  docs: StudyDoc[];
  threads: Discussion[];
  projects: string[];
  currentSource?: NoteSourceInput;
  view: NotebookView;
  inserts: NotebookInsert[];
  retryInsertId: number | null;
  onInsertResult: (result: NotebookInsertResult) => void;
  onNotesChange: (notes: StudyNote[]) => void;
  onExpand: (noteId?: string) => void;
  onClose: () => void;
  onOpenSource: (source: NoteSource) => void;
};
type Store = Record<string, NoteEntry>;
class NoteApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {super(message); this.status = status; this.code = code;}
}

async function noteRequest<T>(path = '', value?: unknown, method = value === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`/api/study/notes${path}`, {
    method, ...(value === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)}),
  });
  const data = await response.json().catch(() => ({error: '笔记服务暂时无法响应，请重试。'})) as T & {error?: string; code?: string};
  if (!response.ok) throw new NoteApiError(data.error || '笔记操作失败，请重试。', response.status, data.code);
  return data as T;
}
const saveLabels = {saved: '已同步', dirty: '待保存', saving: '保存中…', error: '保存失败', conflict: '需要合并'};
const threadLabel = (thread: Discussion, locale: Locale = 'zh-CN') => thread.messages.some(message => message.role === 'user')
  ? discussionTitle(thread, locale)
  : translate(locale, '第 {page} 页 · {title}', {page: thread.page, title: thread.text && thread.text !== '按页提问' ? thread.text.slice(0, 60) : translate(locale, '笔记对话')});

export default function Notebook({
  visible, full, panelHost, docs, threads, projects, currentSource, view, inserts, retryInsertId,
  onInsertResult, onNotesChange, onExpand, onClose, onOpenSource,
}: NotebookProps) {
  const { t, locale } = useLocale();
  const [store, setStore] = useState<Store>({});
  const storeRef = useRef<Store>({});
  const changeStore = useCallback((update: (value: Store) => Store) => {
    const next = update(storeRef.current);
    storeRef.current = next;
    setStore(next);
  }, []);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const loadingRef = useRef(false), mounted = useRef(true);
  const [project, setProject] = useState(''), [threadId, setThreadId] = useState(''), [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState(''), [mobileEditing, setMobileEditing] = useState(false);
  const [creating, setCreating] = useState(false), [operationError, setOperationError] = useState('');
  const [reloading, setReloading] = useState(false);
  const saving = useRef(new Set<string>());
  const manualCreate = useRef<{id: string; title: string; body: string; sources: NoteSourceInput[]} | null>(null);
  const [queueTick, setQueueTick] = useState(0);
  const processing = useRef(false), processed = useRef(new Set<number>()), failed = useRef(new Set<number>());
  const [sourceProject, setSourceProject] = useState(''), [sourceDoc, setSourceDoc] = useState(''), [sourceThread, setSourceThread] = useState('');
  const [sourceError, setSourceError] = useState('');
  const sourceDialog = useRef<HTMLDialogElement>(null), deleteDialog = useRef<HTMLDialogElement>(null);
  const [removing, setRemoving] = useState<StudyNote | null>(null), [deleting, setDeleting] = useState(false);
  const indexHost = useRef<HTMLElement>(null);

  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true; setLoading(true); setLoadError('');
    const startedAt = Date.now();
    try {
      const {notes} = await noteRequest<{notes: StudyNote[]}>();
      if (!mounted.current) return;
      changeStore(previous => {
        const next: Store = {};
        for (const note of notes) next[note.id] = previous[note.id]?.status !== undefined && previous[note.id].status !== 'saved'
          ? previous[note.id] : savedNoteEntry(note);
        for (const [id, entry] of Object.entries(previous)) {
          if (next[id]) continue;
          if (entry.saved.createdAt >= startedAt) next[id] = entry;
          else if (entry.status !== 'saved') next[id] = {...entry, status: 'conflict', error: '这条笔记已在其他窗口删除。请导出当前编辑。'};
        }
        return next;
      });
      setLoaded(true);
    } catch (error) {if (mounted.current) setLoadError((error as Error).message);}
    finally {loadingRef.current = false; if (mounted.current) setLoading(false);}
  }, [changeStore]);
  useEffect(() => {void load();}, [load]);
  useEffect(() => {
    if (!visible) return;
    void load();
    const refresh = () => {void load();};
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [visible, load]);
  useEffect(() => {onNotesChange(Object.values(store).map(entry => entry.note));}, [store, onNotesChange]);
  useEffect(() => {
    setProject(view.project ?? ''); setThreadId(view.threadId ?? ''); setQuery('');
    setActiveId(view.noteId ?? ''); setMobileEditing(!!view.noteId);
  }, [view]);

  const save = useCallback(async (id: string) => {
    const entry = storeRef.current[id];
    if (!entry || saving.current.has(id) || entry.status === 'saved' || entry.status === 'conflict') return;
    saving.current.add(id);
    const pending = entry.pending ?? {note: entry.note, version: entry.version, revision: entry.saved.revision, requestId: crypto.randomUUID()};
    changeStore(previous => ({...previous, [id]: {...previous[id], pending, status: 'saving', error: undefined}}));
    try {
      const {note} = await noteRequest<{note: StudyNote}>(`/${encodeURIComponent(id)}`, {
        title: pending.note.title, number: pending.note.number, body: pending.note.body,
        sources: pending.note.sources, revision: pending.revision, requestId: pending.requestId,
      });
      if (!mounted.current) return;
      changeStore(previous => previous[id] ? {...previous, [id]: completeNoteSave(previous[id], pending, note)} : previous);
      window.dispatchEvent(new Event('pagewise:credits-changed'));
    } catch (error) {
      if (!mounted.current) return;
      const failure = error as NoteApiError;
      changeStore(previous => previous[id] ? {...previous, [id]: {
        ...previous[id], status: failure.code === 'note_changed' || failure.status === 404 ? 'conflict' : 'error',
        error: failure.message,
        pending: failure.status >= 400 && failure.status < 500 ? undefined : pending,
      }} : previous);
    } finally {saving.current.delete(id);}
  }, [changeStore]);
  useEffect(() => {
    const timers = Object.values(store).filter(entry => entry.status === 'dirty')
      .map(entry => setTimeout(() => {void save(entry.note.id);}, 600));
    return () => timers.forEach(clearTimeout);
  }, [store, save]);
  useEffect(() => {
    if (!Object.values(store).some(entry => entry.status !== 'saved') && !inserts.some(item => !processed.current.has(item.id))) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [store, inserts, queueTick]);

  const acceptCreated = useCallback((note: StudyNote) => {
    changeStore(previous => previous[note.id] && previous[note.id].status !== 'saved' ? previous : {...previous, [note.id]: savedNoteEntry(note)});
    setActiveId(note.id); setMobileEditing(true); setQuery('');
    setProject(previous => !previous || note.sources.some(source => source.project === previous) ? previous : '');
    setThreadId(previous => !previous || note.sources.some(source => source.threadId === previous) ? previous : '');
    setOperationError('');
    window.dispatchEvent(new Event('pagewise:credits-changed'));
  }, [changeStore]);
  // An append lands on the server against the note's saved text. A local draft
  // typed meanwhile is kept, marked for merge, and can never overwrite it.
  const acceptAppended = useCallback((note: StudyNote) => {
    changeStore(previous => {
      const entry = previous[note.id];
      if (!entry || entry.status === 'saved') return {...previous, [note.id]: savedNoteEntry(note)};
      return {...previous, [note.id]: {...entry, saved: note, pending: undefined, status: 'conflict',
        error: '已追加到服务器，但这里有未保存的编辑。导出后重新读取已保存版本。'}};
    });
    setOperationError('');
    window.dispatchEvent(new Event('pagewise:credits-changed'));
  }, [changeStore]);
  useEffect(() => {
    if (retryInsertId === null || !failed.current.delete(retryInsertId)) return;
    setOperationError('');
    setQueueTick(value => value + 1);
  }, [retryInsertId]);
  useEffect(() => {
    if (!loaded || processing.current) return;
    const item = inserts.find(insert => !processed.current.has(insert.id) && !failed.current.has(insert.id));
    if (!item) return;
    processing.current = true;
    const mode = notebookInsertMode(item);
    onInsertResult({id: item.id, noteId: item.noteId, mode, status: 'saving'});
    const request = notebookInsertRequest(item);
    noteRequest<{note: StudyNote}>(request.path, request.body)
      .then(({note}) => {
        if (!mounted.current) return;
        processed.current.add(item.id);
        if (mode === 'append') acceptAppended(note); else acceptCreated(note);
        onInsertResult({id: item.id, noteId: note.id, mode, noteTitle: note.title, noteNumber: note.number, status: 'saved'});
      }).catch(error => {
        if (!mounted.current) return;
        failed.current.add(item.id); setOperationError(error.message);
        onInsertResult({id: item.id, noteId: item.noteId, mode, status: 'error', error: error.message});
      }).finally(() => {processing.current = false; if (mounted.current) setQueueTick(value => value + 1);});
  }, [inserts, loaded, queueTick, acceptCreated, acceptAppended, onInsertResult]);

  const notes = Object.values(store).map(entry => entry.note);
  const filtered = matchingNotes(notes, {project, threadId, query});
  const entry = store[activeId] ?? (filtered[0] ? store[filtered[0].id] : undefined);
  const note = entry?.note;
  const allProjects = [...new Set([...projects, ...notes.flatMap(item => item.sources.map(source => source.project))])];
  const scopeThreads = threads.filter(thread => !thread.id.startsWith('draft-') &&
    (!project || docs.some(doc => doc.id === thread.docId && doc.course === project)));
  const displaySources = (note?.sources ?? []).map(source => {
    const doc = docs.find(item => item.id === source.docId);
    const thread = threads.find(item => item.id === source.threadId);
    return {...source, ...(doc ? {project: doc.course, documentName: doc.name} : {}),
      available: source.available && (!source.docId || !!doc) && (!source.threadId || !!thread)};
  });

  function edit(change: Partial<StudyNote>) {
    if (!note) return;
    changeStore(previous => ({...previous, [note.id]: editNoteEntry(previous[note.id], change)}));
  }
  async function create() {
    if (creating || !loaded) return;
    const chosenThread = scopeThreads.find(thread => thread.id === threadId);
    const chosenDoc = chosenThread ? docs.find(doc => doc.id === chosenThread.docId) : undefined;
    const sources = full
      ? chosenDoc && chosenThread ? [currentNoteSource(chosenDoc, chosenThread)] : project ? [{project}] : []
      : currentSource ? [currentSource] : [];
    const attempt = manualCreate.current ?? {id: crypto.randomUUID(), title: '未命名笔记', body: '', sources};
    manualCreate.current = attempt; setCreating(true); setOperationError('');
    try {
      const {note: created} = await noteRequest<{note: StudyNote}>('', attempt);
      if (mounted.current) {acceptCreated(created); manualCreate.current = null;}
    } catch (error) {
      if (mounted.current) {
        if (error instanceof NoteApiError && error.status >= 400 && error.status < 500) manualCreate.current = null;
        setOperationError((error as Error).message);
      }
    }
    finally {if (mounted.current) setCreating(false);}
  }
  async function reloadSaved() {
    if (!note || reloading) return;
    const id = note.id;
    setReloading(true);
    try {
      const {note: saved} = await noteRequest<{note: StudyNote}>(`/${encodeURIComponent(id)}`);
      changeStore(previous => ({...previous, [id]: savedNoteEntry(saved)}));
    } catch (error) {setOperationError((error as Error).message);}
    finally {setReloading(false);}
  }
  function openSources() {
    const candidate = currentSource?.project || project;
    setSourceProject(candidate && projects.includes(candidate) ? candidate : projects[0] ?? '');
    setSourceDoc(''); setSourceThread(''); setSourceError('');
    sourceDialog.current?.showModal();
  }
  function addCurrentSource() {
    if (!note || !currentSource) return;
    const key = noteSourceKey(currentSource);
    if (note.sources.some(source => source.key === key)) return;
    if (note.sources.length >= 50) {setOperationError('每条笔记最多关联 50 个来源。'); return;}
    const doc = docs.find(item => item.id === currentSource.docId);
    const thread = threads.find(item => item.id === currentSource.threadId);
    edit({sources: [...note.sources, {key, ...currentSource, available: true,
        ...(doc ? {documentName: doc.name} : {}), ...(thread ? {discussionTitle: threadLabel(thread)} : {})}]});
  }
  function addSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note || !sourceProject) return;
    const thread = threads.find(item => item.id === sourceThread);
    const doc = docs.find(item => item.id === (thread?.docId ?? sourceDoc));
    const input: NoteSourceInput = {project: sourceProject, ...(doc ? {docId: doc.id} : {}),
      ...(thread ? {threadId: thread.id, page: thread.page} : {})};
    const key = noteSourceKey(input);
    if (note.sources.some(source => source.key === key)) {setSourceError('这条笔记已经关联了该来源。'); return;}
    if (note.sources.length >= 50) {setSourceError('每条笔记最多关联 50 个来源。'); return;}
    edit({sources: [...note.sources, {key, ...input, available: true,
      ...(doc ? {documentName: doc.name} : {}), ...(thread ? {discussionTitle: threadLabel(thread)} : {})}]});
    sourceDialog.current?.close();
  }
  async function deleteNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!removing || deleting || saving.current.has(removing.id)) return;
    setDeleting(true); setOperationError('');
    try {
      await noteRequest(`/${encodeURIComponent(removing.id)}`, undefined, 'DELETE').catch(error => {
        if (!(error instanceof NoteApiError) || error.status !== 404) throw error;
      });
      changeStore(previous => {const next = {...previous}; delete next[removing.id]; return next;});
      if (activeId === removing.id) setActiveId('');
      setMobileEditing(false); deleteDialog.current?.close(); setRemoving(null);
    } catch (error) {setOperationError((error as Error).message);}
    finally {setDeleting(false);}
  }
  function retryOperations() {
    failed.current.clear(); setQueueTick(value => value + 1); setOperationError('');
    if (manualCreate.current) void create();
  }
  const sourceDocs = docs.filter(doc => doc.course === sourceProject);
  const sourceThreads = threads.filter(thread => !thread.id.startsWith('draft-') &&
    sourceDocs.some(doc => doc.id === thread.docId) && (!sourceDoc || thread.docId === sourceDoc));

  function noteList() {
    return <>
      <label className="nl-search"><Search size={16}/><input type="search" aria-label={t("搜索笔记")} placeholder={t("搜索编号、标题或正文")} value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="nl-filters">
        <select aria-label={t("按项目筛选笔记")} value={project} onChange={event => {setProject(event.target.value); setThreadId(''); setActiveId(''); setMobileEditing(false);}}>
          <option value="">{t("全部项目")}</option>{allProjects.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label={t("按对话筛选笔记")} value={threadId} onChange={event => {setThreadId(event.target.value); setActiveId(''); setMobileEditing(false);}}>
          <option value="">{t("全部对话")}</option>{scopeThreads.map(thread => <option key={thread.id} value={thread.id}>{threadLabel(thread, locale)}</option>)}
          {threadId && !scopeThreads.some(thread => thread.id === threadId) && <option value={threadId}>{t("原对话已删除")}</option>}
        </select>
      </div>
      <p className="nl-count" role="status">{t("{0} 条笔记{1}", { 0: filtered.length, 1: loading ? t('，正在同步…') : '' })}</p>
      <nav className="nl-note-list" aria-label={t("笔记列表")}>{filtered.map(item =>
        <button type="button" key={item.id} className="nl-note" aria-current={note?.id === item.id ? 'page' : undefined}
          onClick={() => {setActiveId(item.id); setMobileEditing(true);}}>
          <span className="nl-note-heading"><span className="nl-number">{noteNumber(item.number)}</span><strong>{item.title || t("未命名笔记")}</strong>
            {store[item.id].status !== 'saved' && <span className="nl-unsaved" aria-label={t(saveLabels[store[item.id].status])}/>}</span>
          <span className="nl-note-excerpt">{noteExcerpt(item.body) || t("还没有正文")}</span>
          <small>{[...new Set(item.sources.map(source => source.project))].join('、') || t("独立笔记")}
            {item.sources.filter(source => source.threadId).length > 0 && t(" · {0} 个对话", { 0: item.sources.filter(source => source.threadId).length })}</small>
        </button>,
      )}</nav>
      {loaded && !filtered.length && <div className="nl-list-empty"><NotebookPen size={26}/><p>{notes.length ? t("没有匹配的笔记") : t("还没有笔记")}</p>
        <span>{query || project || threadId ? t("调整筛选条件，或在这里新建。") : t("在对话中记录想法，或新建一条独立笔记。")}</span></div>}
    </>;
  }
  const content = <section className={`notebook-library ${full ? 'nl-full' : 'nl-compact'} ${mobileEditing ? 'nl-editing' : ''}`}
    hidden={!visible} aria-label={t("学习笔记本")}>
    <header className="nl-header"><div><NotebookPen size={21}/><h1>{t("笔记本")}</h1></div><div className="nl-header-actions">
      {full ? <button type="button" onClick={onClose}><BookOpen size={16}/>{t("返回")}</button> : <button type="button" onClick={() => onExpand(note?.id)}>{t("全部笔记本")}</button>}
      <button type="button" className="nl-create" disabled={!loaded || creating} onClick={() => {void create();}}><Plus size={16}/>{creating ? t("创建中…") : t("新建笔记")}</button>
    </div></header>
    {loadError && <div className="nl-error" role="alert"><span>{t(loadError)}</span><button type="button" disabled={loading} onClick={() => {void load();}}>{t("重新读取")}</button></div>}
    {operationError && <div className="nl-error" role="alert"><span>{t(operationError)}</span>
      {manualCreate.current||failed.current.size>0?<button type="button" disabled={creating} onClick={retryOperations}>{t("重试")}</button>:<button type="button" onClick={()=>setOperationError('')}>{t("关闭")}</button>}</div>}
    {!loaded && !loadError && <p className="nl-loading" role="status">{t("正在读取笔记本…")}</p>}
    <div className="nl-body">
      {full ? <aside className="nl-index" ref={indexHost}>{noteList()}</aside> : <details className="nl-switcher" open={!note}>
        <summary><FileText size={15}/><span>{note ? `${noteNumber(note.number)} ${note.title}` : t("选择笔记")}</span><small>{t("{0} 条", { 0: notes.length })}</small></summary>
        <div className="nl-index">{noteList()}</div>
      </details>}
      {entry && note ? <article className="nl-document">
        <div className="nl-document-header">
          {full && <button type="button" className="nl-back-list" onClick={() => {setMobileEditing(false); indexHost.current?.querySelector<HTMLButtonElement>('[aria-current=page]')?.focus();}}><ChevronLeft size={17}/>{t("笔记列表")}</button>}
          <label className="nl-number-field">{t("编号")}<input type="number" aria-label={t("笔记编号")} min={1} max={999999999} key={`${note.id}:${note.number}`} defaultValue={note.number}
            onBlur={event => {const value = event.currentTarget.valueAsNumber; if (Number.isInteger(value) && value >= 1 && value <= 999999999) {if (value !== note.number) edit({number: value});} else event.currentTarget.value = String(note.number);}}
            onKeyDown={event => {if (event.key === 'Enter') event.currentTarget.blur();}}/></label>
          <button type="button" className="nl-delete" aria-label={t("删除这条笔记")} disabled={entry.status === 'saving'}
            onClick={() => {setRemoving(note); deleteDialog.current?.showModal();}}><Trash2 size={16}/></button>
        </div>
        <input className="nl-note-title" aria-label={t("笔记标题")} placeholder={t("未命名笔记")} maxLength={120} value={note.title} onChange={event => edit({title: event.target.value})}/>
        <div className="nl-sources">
          <div className="nl-sources-heading"><span><Link2 size={14}/>{t("关联来源")}</span>
            {currentSource?.threadId&&!note.sources.some(source=>source.threadId===currentSource.threadId)&&<button type="button" onClick={addCurrentSource}><MessageSquare size={14}/>{t("关联当前对话")}</button>}
            <button type="button" onClick={openSources}><Plus size={14}/>{t("关联项目或对话")}</button></div>
          {displaySources.length > 0 ? <ul>{displaySources.map(source => <li key={source.key}>
            <button type="button" className="nl-source-link" disabled={!source.available || !source.docId} title={source.discussionTitle}
              onClick={() => onOpenSource(source)}>{source.threadId ? <MessageSquare size={14}/> : <FileText size={14}/>}
              <span><strong>{source.project}</strong><span>{source.discussionTitle ?? source.documentName ?? t("整个项目")}</span>
                {!source.available && <small>{t("来源已删除，笔记仍保留")}</small>}</span></button>
            <button type="button" className="nl-source-remove" aria-label={t("移除关联：{0}", { 0: source.discussionTitle ?? source.documentName ?? source.project })}
              onClick={() => edit({sources: note.sources.filter(item => item.key !== source.key)})}><X size={14}/></button>
          </li>)}</ul> : <p>{t("可关联多个项目和对话，在同一条笔记里整理。")}</p>}
        </div>
        <NotebookEditor key={note.id} body={note.body} title={note.title} number={note.number}
          status={entry.error ?? saveLabels[entry.status]} blocked={entry.status === 'conflict'}
          onChange={body => edit({body})} onRetry={() => {void save(note.id);}} onReload={() => {void reloadSaved();}} reloading={reloading}/>
        {entry.status === 'error' && <button type="button" className="nl-retry-save" onClick={() => {void save(note.id);}}>{t("重试保存")}</button>}
      </article> : full && loaded && <div className="nl-document-empty"><NotebookPen size={38}/><h2>{t("把思考留在笔记里")}</h2><p>{t("选择一条笔记继续写，或新建一条。")}<br/>{t("笔记可以关联来自不同项目的对话。")}</p><button type="button" disabled={creating} onClick={() => {void create();}}><Plus size={16}/>{t("新建笔记")}</button></div>}
    </div>
    <dialog className="nl-dialog" ref={sourceDialog} aria-labelledby="note-source-title">
      <form onSubmit={addSource}><h2 id="note-source-title">{t("关联项目或对话")}</h2><p>{t("选择来源，同一条笔记可以关联多个项目。")}</p>
        <label>{t("项目")}<select required value={sourceProject} onChange={event => {setSourceProject(event.target.value); setSourceDoc(''); setSourceThread('');}}>
          <option value="" disabled>{t("选择项目")}</option>{projects.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>{t("资料")}<select value={sourceDoc} onChange={event => {setSourceDoc(event.target.value); setSourceThread('');}}><option value="">{t("整个项目")}</option>{sourceDocs.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select></label>
        <label>{t("对话")}<select value={sourceThread} onChange={event => setSourceThread(event.target.value)}><option value="">{t("仅关联项目或资料")}</option>{sourceThreads.map(thread => <option key={thread.id} value={thread.id}>{threadLabel(thread, locale)}</option>)}</select></label>
        {!projects.length && <p>{t("先新建项目或导入资料，即可关联来源。")}</p>}
        {sourceError && <p className="nl-error" role="alert">{sourceError}</p>}
        <div className="nl-dialog-actions"><button type="button" onClick={() => sourceDialog.current?.close()}>{t("取消")}</button><button type="submit" disabled={!sourceProject}><Link2 size={15}/>{t("添加关联")}</button></div>
      </form>
    </dialog>
    <dialog className="nl-dialog" ref={deleteDialog} aria-labelledby="note-delete-title" onCancel={event => {if (deleting) event.preventDefault();}}>
      <form onSubmit={deleteNote}><h2 id="note-delete-title">{t("删除笔记")}</h2><p>{t("确认删除 {0}？", { 0: removing ? `${noteNumber(removing.number)}「${removing.title}」` : '这条笔记' })}</p><p>{t("删除后无法恢复，来源项目和对话会保留。")}</p>
        {operationError && <p className="nl-error" role="alert">{operationError}</p>}
        <div className="nl-dialog-actions"><button type="button" disabled={deleting} onClick={() => deleteDialog.current?.close()}>{t("取消")}</button><button type="submit" className="nl-danger" disabled={deleting}>{deleting ? t("删除中…") : t("删除笔记")}</button></div>
      </form>
    </dialog>
  </section>;
  return full ? content : panelHost ? createPortal(content, panelHost) : null;
}
