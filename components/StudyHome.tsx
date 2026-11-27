'use client';

import { useLocale } from './LocaleProvider';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, BookOpen, ChevronRight, FileText, FolderOpen, History, MessageSquareText, MoreHorizontal, NotebookPen, PencilLine, Plus, Quote, RotateCcw, Search, X } from 'lucide-react';
import { discussionTitle, type Discussion, type StudyDoc } from '../lib/workspace-model';
import type { StudyNote } from '../lib/notebook-model';
import { noteExcerpt, noteNumber } from '../lib/notebook-model';
import { buildReview } from '../lib/review-model';
import { docTitle, searchStudy, type StudySearchResult } from '../lib/study-search';
import { evidencePageLabel, stageLabels, type ProjectMemoryView } from '../lib/learning-memory';
import './study-home.css';
import { readProgress, subscribeReadingProgress } from './reading-progress';
import PaperLeaves from './PaperLeaves';
import { translate, type Locale } from '../lib/i18n';

export type StudyHomeProps = {
  docs: StudyDoc[];
  savedProjects?: string[];
  onCreateProject: (name:string) => Promise<string>;
  onManageProject: (action:'rename'|'delete',project:string,target?:string) => Promise<void>;
  threads?: Discussion[];
  notes?: StudyNote[];
  onOpenDoc: (doc: StudyDoc, page?: number, threadId?: string) => void;
  onOpenNote?: (noteId:string) => void;
  onPractice?: (doc:StudyDoc, threadId:string) => void;
  loadMemory?: (project:string) => Promise<ProjectMemoryView>;
  onMoveDoc: (doc: StudyDoc) => void;
  onPinDoc: (doc: StudyDoc) => void;
  onRemoveDoc: (doc: StudyDoc) => void;
  active: boolean;
  backgroundPaused: boolean;
  onImport: (course?: string) => void;
  onSample?: () => void;
  onOpenMemory?: (project:string) => void;
  onOpenNotebook?: (project?:string) => void;
  loading?: boolean;
  error?: string;
};

function dateLabel(value?: number, locale: Locale = 'zh-CN') {
  return value && Number.isFinite(value) ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(value) : translate(locale, '尚未阅读');
}
const title = (doc: StudyDoc) => docTitle(doc);

function Highlight({text, term}:{text:string; term:string}) {
  const index = term ? text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>;
}

const resultIcons = {
  project: FolderOpen, doc: FileText, question: MessageSquareText,
  answer: BookOpen, excerpt: Quote, note: NotebookPen,
} as const;

export default function StudyHome({ docs, savedProjects = [], onCreateProject, onManageProject, onMoveDoc, onPinDoc, onRemoveDoc, active, backgroundPaused, threads = [], notes = [], onOpenDoc, onOpenNote, onPractice, loadMemory, onImport, onSample, onOpenMemory, onOpenNotebook, loading = false, error }: StudyHomeProps) {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [surface, setSurface] = useState<'library' | 'review'>('library');
  const [mobileProjects, setMobileProjects] = useState(false);
  const projectTrigger=useRef<HTMLButtonElement>(null);
  const projectClose=useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const searchId = useId();
  const searchDialog=useRef<HTMLDialogElement>(null);
  const searchButton=useRef<HTMLButtonElement>(null);
  const searchInput=useRef<HTMLInputElement>(null);
  const returningToSearch=useRef(false);
  const [searching,setSearching]=useState(false);
  const [searchAll,setSearchAll]=useState(false);
  const [composing,setComposing]=useState(false);
  const [name,setName]=useState('');
  const [creating,setCreating]=useState(false);
  const [createError,setCreateError]=useState('');
  const createDialog=useRef<HTMLDialogElement>(null);
  const nameId=useId();
  const projects = [...new Set([...docs.map(doc => doc.course),...savedProjects])];

  async function create(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!name.trim()||creating)return;
    setCreating(true);
    setCreateError('');
    try{
      const created=await onCreateProject(name.trim());
      setProject(created);
      setQuery('');
      createDialog.current?.close();
    }catch(error){
      setCreateError(error instanceof Error?error.message:'创建项目失败，请重试。');
    }finally{
      setCreating(false);
    }
  }
  const [manage,setManage]=useState<{action:'rename'|'delete';project:string}|null>(null);
  const [destination,setDestination]=useState('');
  const manageDialog=useRef<HTMLDialogElement>(null);
  const manageId=useId();
  useEffect(()=>{if(manage&&!manageDialog.current?.open)manageDialog.current?.showModal();},[manage]);
  const fileCount=manage?docs.filter(doc=>doc.course===manage.project).length:0;

  function openManage(action:'rename'|'delete',projectName:string,event:React.MouseEvent<HTMLButtonElement>){
    event.currentTarget.closest('details')?.removeAttribute('open');
    setManage({action,project:projectName});
    setDestination(action==='rename'?projectName:'');
    setCreateError('');
  }

  async function saveManage(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!manage||creating)return;
    const target=destination.trim();
    if((manage.action==='rename'||fileCount>0)&&(!target||target===manage.project))return;
    setCreating(true);
    setCreateError('');
    try{
      await onManageProject(manage.action,manage.project,target||undefined);
      setProject(previous=>previous===manage.project?(target||null):previous);
      setQuery('');
      manageDialog.current?.close();
    }catch(error){
      setCreateError(error instanceof Error?error.message:'项目更新失败，请重试。');
    }finally{
      setCreating(false);
    }
  }

  const activeProject = project !== null && projects.includes(project) ? project : null;
  const search = query.trim().toLocaleLowerCase();
  const ordered = useMemo(() => [...docs].sort((a, b) => (b.visited || 0) - (a.visited || 0) || a.name.localeCompare(b.name, locale)), [docs, locale]);
  const checkpointState=useSyncExternalStore(subscribeReadingProgress,()=>ordered.flatMap(doc=>{
    const progress=readProgress(doc.id);
    return progress?[`${doc.id}:${progress.page}`]:[];
  }).join('|'),()=> '');
  const checkpoints=new Map(checkpointState.split('|').filter(Boolean).map(entry=>{
    const separator=entry.lastIndexOf(':');
    return [entry.slice(0,separator),Number(entry.slice(separator+1))] as const;
  }));
  const recent=ordered.find(doc=>checkpoints.has(doc.id));
  const recentPage=recent?checkpoints.get(recent.id):null;
  const visible = ordered.filter(doc=>activeProject===null||doc.course===activeProject);
  const searchScope=searchAll?null:activeProject;
  const searchGroups = useMemo(() => search
    ? searchStudy({docs: ordered, threads, notes, query, project: searchScope ?? '', locale})
    : [], [ordered, threads, notes, search, searchScope, query, locale]);
  const recentDocs=ordered.slice(0,5);
  const sortedVisible = sort === 'name'
    ? [...visible].sort((a, b) => a.name.localeCompare(b.name, locale, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id))
    : [...visible].sort((a,b)=>Number(b.pinned??false)-Number(a.pinned??false));

  const review = useMemo(()=>buildReview({docs: ordered, threads, notes}), [ordered, threads, notes]);
  const [memoryTick,setMemoryTick]=useState(0);
  const [memory,setMemory]=useState<{course:string; loading:boolean; view?:ProjectMemoryView; error?:string}|null>(null);
  useEffect(()=>{
    if(surface!=='review'||!activeProject||!loadMemory){setMemory(null);return;}
    let current=true;
    setMemory({course:activeProject,loading:true});
    loadMemory(activeProject)
      .then(view=>{if(current)setMemory({course:activeProject,loading:false,view});})
      .catch(reason=>{if(current)setMemory({course:activeProject,loading:false,error:reason instanceof Error?reason.message:'主题暂时无法读取。'});});
    return()=>{current=false;};
  },[surface,activeProject,loadMemory,memoryTick]);

  function openSearchResult(doc:StudyDoc,page?:number,threadId?:string){
    returningToSearch.current=true;
    searchDialog.current?.close();
    onOpenDoc(doc,page,threadId);
  }
  function openNoteResult(note:StudyNote,docId?:string,page?:number,threadId?:string){
    if(onOpenNote){returningToSearch.current=true;searchDialog.current?.close();onOpenNote(note.id);return;}
    const doc=ordered.find(item=>item.id===docId);
    if(doc)openSearchResult(doc,page,threadId);
  }
  function openSearchHit(result:StudySearchResult){
    if(result.kind==='project'){setProject(result.title);setSurface('library');searchDialog.current?.close();return;}
    const doc=ordered.find(item=>item.id===result.docId);
    if(result.kind==='note'){
      const note=notes.find(item=>item.id===result.noteId);
      if(note)openNoteResult(note,result.docId,result.page,result.threadId);
      return;
    }
    if(doc)openSearchResult(doc,result.page,result.threadId);
  }
  function openReviewNote(note:StudyNote,docId?:string,page?:number,threadId?:string){
    if(onOpenNote){onOpenNote(note.id);return;}
    const doc=ordered.find(item=>item.id===docId);
    if(doc)onOpenDoc(doc,page,threadId);
  }
  function closeProjects(){setMobileProjects(false);projectTrigger.current?.focus();}

  useEffect(()=>{
    if(!active)return;
    const open=()=>{
      const dialog=searchDialog.current;
      if(dialog&&!dialog.open){dialog.showModal();searchInput.current?.focus();setSearching(true);}
    };
    if(returningToSearch.current){returningToSearch.current=false;open();}
    function shortcut(event:KeyboardEvent){
      if(!event.isComposing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){
        event.preventDefault();
        open();
      }
    }
    window.addEventListener('keydown',shortcut);
    return ()=>window.removeEventListener('keydown',shortcut);
  },[active]);

  const reviewDocs = activeProject ? review.documents.filter(item=>item.doc.course===activeProject) : review.documents;
  const reviewNotes = activeProject ? review.notes.filter(item=>item.project===activeProject) : review.notes;
  const reviewCards = memory?.course===activeProject ? memory.view?.cards ?? [] : [];
  const reviewEmpty = !reviewDocs.length && !reviewNotes.length && !reviewCards.length;

  function reviewSurface(){
    if(reviewEmpty && !memory?.loading && !memory?.error) return <div className="sh-review-empty">
      <span className="sh-empty-icon"><RotateCcw size={32} strokeWidth={1.3}/></span>
      <h2>{t("还没有可复习的内容")}</h2>
      <p>{t("在资料里提出一个问题，或把选区存入笔记。这里会按真实页码和主题整理复习入口，不生成虚构章节。")}</p>
      <button type="button" onClick={()=>onImport(activeProject??undefined)}>{t("导入资料")}</button>
    </div>;
    return <div className="sh-review">
      {reviewDocs.length>0&&<section className="sh-review-docs" aria-labelledby="sh-review-docs-title">
        <div className="sh-document-toolbar"><h2 id="sh-review-docs-title">{t("按资料和页码")}</h2><span className="sh-review-meta">{t("来自真实提问")}</span></div>
        {reviewDocs.map(({doc,entries})=><article className="sh-review-doc" key={doc.id}>
          <header><button type="button" onClick={()=>onOpenDoc(doc)}><FileText size={16} aria-hidden="true"/><strong>{title(doc)}</strong><small>{doc.course}</small></button></header>
          <ul>{entries.map(entry=><li className="sh-review-entry" key={entry.key} data-answered={entry.answered}>
            <button type="button" className="sh-review-page" onClick={()=>onOpenDoc(doc,entry.page,entry.threadId)}>{t("第 {0} 页", { 0: entry.page })}</button>
            <div className="sh-review-copy"><strong>{entry.title}</strong>
              <span>{entry.answered?t("已讲解"):t("还没有回答")}{entry.noteIds.length?t(" · {0} 条笔记", { 0: entry.noteIds.length }):''}</span></div>
            <div className="sh-review-actions">
              {entry.answered&&onPractice&&<button type="button" onClick={()=>onPractice(doc,entry.threadId)}><PencilLine size={14} aria-hidden="true"/>{t("自测")}</button>}
              <button type="button" onClick={()=>onOpenDoc(doc,entry.page,entry.threadId)}>{t("回到原文")}<ChevronRight size={14} aria-hidden="true"/></button>
            </div>
            {entry.noteIds.length>0&&<div className="sh-review-note-links">{entry.noteIds.map(id=>{
              const note=notes.find(item=>item.id===id);
              return note?<button type="button" key={id} onClick={()=>openReviewNote(note,doc.id,entry.page,entry.threadId)}>{noteNumber(note.number)} {note.title||t("未命名笔记")}</button>:null;
            })}</div>}
          </li>)}</ul>
        </article>)}
      </section>}
      {activeProject&&loadMemory&&<section className="sh-review-topics" aria-labelledby="sh-review-topics-title">
        <div className="sh-document-toolbar"><h2 id="sh-review-topics-title">{t("知识主题")}</h2>
          {onOpenMemory&&<button type="button" className="sh-memory-link" onClick={()=>onOpenMemory(activeProject)}>{t("在项目记忆中查看")}</button>}</div>
        {memory?.loading?<p className="sh-review-hint" role="status">{t("正在读取项目主题…")}</p>
          :memory?.error?<div className="sh-review-error" role="alert"><span>{t(memory.error)}</span><button type="button" onClick={()=>setMemoryTick(value=>value+1)}>{t("重新读取")}</button></div>
          :reviewCards.length>0?<ul className="sh-topic-list">{reviewCards.map(card=>{
            const evidence=card.evidence.find(source=>source.kind==='gap')??card.evidence[0];
            const thread=evidence?threads.find(item=>item.id===evidence.threadId):undefined;
            const doc=thread?ordered.find(item=>item.id===thread.docId):undefined;
            return <li key={card.key} data-stage={card.stage}>
              <span className="sh-topic-stage">{t(stageLabels[card.stage])}</span>
              <strong>{card.topic}</strong>
              {evidence&&<small>{evidence.file} · {evidencePageLabel(evidence, locale)}</small>}
              <div className="sh-review-actions">
                {doc&&evidence&&onPractice&&card.stage!=='mastered'&&<button type="button" onClick={()=>onPractice(doc,evidence.threadId)}><PencilLine size={14} aria-hidden="true"/>{t("自测")}</button>}
                {doc&&evidence&&<button type="button" onClick={()=>onOpenDoc(doc,evidence.page,evidence.threadId)}>{t("回到来源")}</button>}
              </div>
            </li>;
          })}</ul>
          :<p className="sh-review-hint">{t("完成一轮课件问答后，学习主题会整理到这里。已掌握状态在项目记忆中切换。")}</p>}
      </section>}
      {reviewNotes.length>0&&<section className="sh-review-notebook" aria-labelledby="sh-review-notebook-title">
        <div className="sh-document-toolbar"><h2 id="sh-review-notebook-title">{t("笔记")}</h2><span className="sh-review-meta">{t("{0} 条已保存", { 0: reviewNotes.length })}</span></div>
        <ul className="sh-note-review">{reviewNotes.map(item=><li key={item.note.id}>
          <button type="button" onClick={()=>openReviewNote(item.note,item.docId,item.page,item.threadId)}>
            <span className="sh-review-number">{noteNumber(item.note.number)}</span>
            <span className="sh-review-copy"><strong>{item.note.title||t("未命名笔记")}</strong><span>{noteExcerpt(item.note.body)||t("还没有正文")}</span></span>
            <small>{[item.project,item.page?t('第 {page} 页', { page: item.page }):''].filter(Boolean).join(' · ')||t("独立笔记")}</small>
          </button>
        </li>)}</ul>
      </section>}
    </div>;
  }

  return <section className="study-home" aria-label={t("学习项目首页")} aria-busy={loading}>
    <PaperLeaves active={active&&activeProject===null} paused={backgroundPaused||searching}/>
    {mobileProjects&&<button type="button" className="sh-project-backdrop" tabIndex={-1} aria-label={t("关闭项目目录")} onClick={closeProjects}/>}
    <aside id="home-projects" className={`sh-sidebar${mobileProjects?' is-open':''}`} aria-label={t("项目导航")} onKeyDown={event=>{if(event.key==='Escape'&&mobileProjects)closeProjects();}}>
      <div className="sh-space"><span className="sh-space-icon"><BookOpen size={20} /></span><div><strong>{t("我的学习空间")}</strong></div></div>
      <div className="sh-project-drawer-heading"><strong>{t("我的项目")}</strong><button ref={projectClose} type="button" aria-label={t("关闭项目目录")} onClick={closeProjects}><X size={18}/></button></div>
      <button type="button" className="sh-nav-item" aria-current={activeProject === null && surface==='library' ? 'page' : undefined} onClick={() => {setProject(null);setSurface('library');setMobileProjects(false)}}><FolderOpen size={18} /><span>{t("全部项目")}</span><small>{projects.length}</small></button>
      <button type="button" className="sh-nav-item" aria-current={surface==='review'?'page':undefined} onClick={()=>{setSurface('review');setMobileProjects(false);}}><RotateCcw size={17}/><span>{t("复习")}</span><small>{review.total}</small></button>
      {onOpenNotebook&&<button type="button" className="sh-nav-item" onClick={()=>{setMobileProjects(false);onOpenNotebook();}}><NotebookPen size={17}/><span>{t("笔记本")}</span></button>}
      <div className="sh-project-heading">
        <span>{t("我的项目")}</span>
        <button type="button" className="sh-create" onClick={()=>{setName('');setCreateError('');createDialog.current?.showModal();}}><Plus size={15} aria-hidden="true"/>{t("新建项目")}</button>
      </div>
      <nav aria-label={t("选择学习项目")}>
        {projects.map((name,index)=><div className="sh-project-row" key={name}>
          <button type="button" className="sh-nav-item" aria-current={activeProject===name?'page':undefined} onClick={()=>{setProject(name);setMobileProjects(false)}}>
            <span className="sh-project-dot" data-tone={index%4}/><span>{name||t("未分类项目")}</span><small>{docs.filter(doc=>doc.course===name).length}</small>
          </button>
          {name&&<details className="sh-project-menu" name="study-project-actions">
            <summary aria-label={t("管理项目 {0}", { 0: name })}><MoreHorizontal size={17} aria-hidden="true"/></summary>
            <div className="sh-project-actions">
              <button type="button" onClick={event=>openManage('rename',name,event)}>{t("重命名")}</button>
              <button type="button" onClick={event=>openManage('delete',name,event)}>{t("删除")}</button>
            </div>
          </details>}
        </div>)}
      </nav>
    </aside>
    <dialog className="sh-create-dialog" ref={createDialog} aria-labelledby={nameId+'-heading'} onCancel={event=>{if(creating)event.preventDefault();}}>
      <form onSubmit={create}>
        <h2 id={nameId+'-heading'}>{t("新建项目")}</h2>
        <label htmlFor={nameId}>{t("项目名称")}</label>
        <input id={nameId} value={name} onChange={event=>setName(event.target.value)} autoFocus maxLength={100} required disabled={creating}/>
        {createError&&<p className="sh-create-error" role="alert">{t(createError)}</p>}
        <div className="sh-create-actions">
          <button type="button" onClick={()=>createDialog.current?.close()} disabled={creating}>{t("取消")}</button>
          <button className="sh-primary" disabled={creating||!name.trim()}>{creating?t("创建中…"):t("创建项目")}</button>
        </div>
      </form>
    </dialog>
    <dialog ref={manageDialog} className="sh-create-dialog" aria-labelledby={manageId+'-title'} onCancel={event=>{if(creating)event.preventDefault();}}>
      {manage&&<form onSubmit={saveManage}>
        <h2 id={manageId+'-title'}>{manage.action==='rename'?t("重命名项目"):t("删除项目")}</h2>
        {manage.action==='rename'?<>
          <label htmlFor={manageId}>{t("项目名称")}</label>
          <input id={manageId} maxLength={100} required autoFocus value={destination} disabled={creating} onChange={event=>setDestination(event.target.value)}/>
        </>:<>
          <p>{t("确认删除「{0}」？", { 0: manage.project })}</p>
          {fileCount>0&&<>
            <p>{t("项目里有 {0} 份资料。请选择移入的项目，资料和讨论会一起保留。", { 0: fileCount })}</p>
            <label htmlFor={manageId}>{t("移入项目")}</label>
            <select id={manageId} required disabled={creating} value={destination} onChange={event=>setDestination(event.target.value)}>
              <option value="" disabled hidden>{t("选择目标项目")}</option>
              {projects.filter(name=>name&&name!==manage.project).map(name=><option key={name} value={name}>{name}</option>)}
            </select>
            {projects.filter(name=>name&&name!==manage.project).length===0&&<p>{t("请先新建一个目标项目，再回来移资料。")}</p>}
          </>}
        </>}
        {createError&&<p className="sh-create-error" role="alert">{t(createError)}</p>}
        <div className="sh-create-actions">
          <button type="button" disabled={creating} onClick={()=>manageDialog.current?.close()}>{t("取消")}</button>
          <button className={manage.action==='rename'?'sh-primary':'sh-project-delete'}
            disabled={creating||((manage.action==='rename'||fileCount>0)&&(!destination.trim()||destination.trim()===manage.project))}>
            {creating?t("处理中…"):manage.action==='rename'?t("保存名称"):fileCount?t("移动资料并删除"):t("确认删除")}
          </button>
        </div>
      </form>}
    </dialog>
    <div className="sh-main">
      <header className="sh-header"><h1>{activeProject ?? (surface==='review'?t("复习"):t("学习首页"))}</h1><div className="sh-header-actions">
        <button ref={projectTrigger} type="button" className="sh-project-switch" aria-controls="home-projects" aria-expanded={mobileProjects} onClick={()=>{setMobileProjects(true);requestAnimationFrame(()=>projectClose.current?.focus());}}><FolderOpen size={16}/>{activeProject??t("全部项目")}</button>
        <button ref={searchButton} type="button" className="sh-search-trigger" aria-label={t("搜索资料库")} aria-haspopup="dialog" onClick={()=>{setSearchAll(false);searchDialog.current?.showModal();searchInput.current?.focus();setSearching(true);}}><Search size={17}/><span>{t("搜索")}</span><kbd className="sh-search-shortcut" aria-hidden="true">⌘K</kbd></button>
        <button type="button" className="sh-primary" onClick={()=>onImport(activeProject??undefined)}><Plus size={17}/>{t("导入资料")}</button>
      </div></header>
      {error && <div className="sh-error" role="alert"><strong>{t("资料暂时未能完整载入")}</strong><span>{t(error)}</span><span>{t("请刷新页面后重试。")}</span></div>}
      {loading ? <div className="sh-loading" role="status"><BookOpen size={26} /><p>{t("正在载入你的学习项目…")}</p></div> : !projects.length ? !error && <div className="sh-empty">
        <span className="sh-empty-icon"><BookOpen size={36} strokeWidth={1.3} /></span><h2>{t("还没有学习资料")}</h2><p>{t("从右上角导入 PDF 或 PPTX，按课程建立项目。")}</p><small>{t("单份不超过 20 MiB")}</small>{onSample && <button type="button" className="sh-sample" onClick={onSample}>{t("打开示例讲义")}<ArrowRight size={16} /></button>}
      </div> : surface==='review' ? reviewSurface() : <>
        {recent && activeProject === null && !search && <section className="sh-resume" aria-labelledby="sh-resume-title"><div className="sh-resume-body"><span className="sh-resume-label"><History size={15} />{t("继续学习")}</span><p className="sh-resume-course">{recent.course}</p><h2 id="sh-resume-title">{title(recent)}</h2><p><span className="sh-resume-date">{t("上次读到第 {0} 页", { 0: recentPage })}</span></p><button type="button" onClick={() => onOpenDoc(recent)} className="sh-resume-button">{t("继续阅读")}<ArrowRight size={17} /></button></div><div className="sh-page-motif-wrap" aria-hidden="true"><div className="sh-page-motif"><FileText size={42} strokeWidth={1} /><span>{recent.kind.toUpperCase()}</span></div></div></section>}
        <section className="sh-documents" aria-label={activeProject === null ? t("最近资料") : t("项目资料")}>
          <div className="sh-document-toolbar"><h2>{activeProject === null ? t("最近资料") : t("项目资料")}</h2>{activeProject!==null&&<>{onOpenNotebook&&<button type="button" className="sh-memory-link" onClick={()=>onOpenNotebook(activeProject)}>{t("项目笔记")}</button>}<button type="button" className="sh-memory-link" onClick={()=>onOpenMemory?.(activeProject)}>{t("复习主题")}</button><select className="sh-sort" aria-label={t("文件排序方式")} value={sort} onChange={event=>setSort(event.target.value==='name'?'name':'recent')}><option value="recent">{t("最近活动")}</option><option value="name">{t("文件名称")}</option></select></>}</div>
          {(activeProject === null ? recentDocs : sortedVisible).map(doc => <div className="sh-material-row" key={doc.id}>
            <button type="button" className="sh-document" title={doc.name} onClick={()=>onOpenDoc(doc)}>
              <span className="sh-file"><FileText size={20}/><small>{doc.kind.toUpperCase()}</small></span>
              <span className="sh-document-copy"><strong>{title(doc)}</strong><span>{doc.course}{checkpoints.has(doc.id)?t(" · 第 {0} 页", { 0: checkpoints.get(doc.id) }):''}</span></span>
              <time>{dateLabel(doc.visited, locale)}</time><ChevronRight size={17}/>
            </button>
            <details className="sh-project-menu" name="study-material-actions">
              <summary aria-label={t("整理 {0}", { 0: doc.name })}><MoreHorizontal size={17} aria-hidden="true"/></summary>
              <div className="sh-project-actions">
                <button type="button" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onMoveDoc(doc);}}>{t("移动到项目")}</button>
                <button type="button" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onPinDoc(doc);}}>{doc.pinned?t("取消置顶"):t("置顶")}</button>
                <button type="button" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onRemoveDoc(doc);}}>{t("删除")}</button>
              </div>
            </details>
          </div>)}
        </section>
        {!visible.length && activeProject!==null && <div className="sh-no-results"><FolderOpen size={25}/><h3>{t("这个项目还没有资料")}</h3><button type="button" onClick={()=>onImport(activeProject)}>{t("导入第一份资料")}</button></div>}
      </>}
    </div>
    <dialog ref={searchDialog} className="sh-search-dialog" aria-labelledby={searchId+'-title'}
      onClose={()=>{setSearching(false);if(active)searchButton.current?.focus();}}
      onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();searchDialog.current?.close();}}}
      onClick={event=>{if(event.target===event.currentTarget)searchDialog.current?.close();}}>
      <div className="sh-search-sheet">
        <header><h2 id={searchId+'-title'}>{t("搜索资料库")}</h2><button type="button" aria-label={t("关闭搜索")} onClick={()=>searchDialog.current?.close()}><X size={18}/></button></header>
        <div className="sh-search-tools">
          <label className="sh-search" htmlFor={searchId}><Search size={17}/><span className="sh-sr-only">{t("搜索项目、资料、提问、回答、摘录或笔记")}</span>
            <input ref={searchInput} id={searchId} type="search" autoFocus value={query} placeholder={t("搜索项目、资料、提问、回答、摘录或笔记")}
              onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={event=>setQuery(event.target.value)}/>
            {query&&<button type="button" aria-label={t("清除搜索")} onClick={()=>{setQuery('');searchInput.current?.focus();}}><X size={16}/></button>}
          </label>
          {activeProject!==null&&<select aria-label={t("搜索范围")} value={searchAll?'all':'project'} onChange={event=>setSearchAll(event.target.value==='all')}><option value="project">{t("当前项目")}</option><option value="all">{t("全部项目")}</option></select>}
        </div>
        {search&&!composing&&<div className="sh-search-results">
          {searchGroups.map(group=><section key={group.kind} aria-label={group.label}><h3>{group.label}</h3>{group.results.map(result=>{
            const Icon=resultIcons[result.kind];
            return <button type="button" key={result.key} title={result.title} onClick={()=>openSearchHit(result)}>
              <Icon size={16} aria-hidden="true" className="sh-result-icon"/>
              <span className="sh-result-copy">
                <span><Highlight text={result.title} term={query.trim()}/></span>
                {result.snippet&&<span className="sh-result-snippet"><Highlight text={result.snippet} term={query.trim()}/></span>}
                <small>{result.meta}</small>
              </span>
            </button>;
          })}</section>)}
          {!searchGroups.length&&<p role="status">{t("没有找到匹配的项目、资料、提问、回答、摘录或笔记。")}</p>}
        </div>}
        <footer className="sh-search-footer"><kbd>Esc</kbd><span>{t("关闭")}</span></footer>
      </div>
    </dialog>
  </section>;
}
