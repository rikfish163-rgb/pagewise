'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowRight, BookOpen, ChevronRight, FileText, FolderOpen, History, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import type { Discussion, StudyDoc } from '../lib/workspace-model';
import './study-home.css';
import { readProgress, subscribeReadingProgress } from './reading-progress';

export type StudyHomeProps = {
  docs: StudyDoc[];
  savedProjects?: string[];
  onCreateProject: (name:string) => Promise<string>;
  onManageProject: (action:'rename'|'delete',project:string,target?:string) => Promise<void>;
  threads?: Discussion[];
  onOpenDoc: (doc: StudyDoc, page?: number, threadId?: string) => void;
  onMoveDoc: (doc: StudyDoc) => void;
  onImport: (course?: string) => void;
  onSample?: () => void;
  onOpenMemory?: (project:string) => void;
  loading?: boolean;
  error?: string;
};

function dateLabel(value?: number) {
  return value && Number.isFinite(value) ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(value) : '尚未阅读';
}
const title = (doc: StudyDoc) => doc.name.replace(/\.(pdf|pptx)$/i, '');

export default function StudyHome({ docs, savedProjects = [], onCreateProject, onManageProject, onMoveDoc, threads = [], onOpenDoc, onImport, onSample, onOpenMemory, loading = false, error }: StudyHomeProps) {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const searchId = useId();
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
  const ordered = [...docs].sort((a, b) => (b.visited || 0) - (a.visited || 0) || a.name.localeCompare(b.name, 'zh-CN'));
  const recent = ordered.find(doc => !!doc.visited);
  const recentPage=useSyncExternalStore(subscribeReadingProgress,()=>recent?readProgress(recent.id)?.page??null:null,()=>null);
  const visible = ordered.filter(doc => (activeProject === null || doc.course === activeProject) && (!search ||
    `${doc.name} ${doc.course}`.toLocaleLowerCase().includes(search) || threads.some(thread => thread.docId === doc.id && thread.messages.some(message => message.role === 'user' && message.content.toLocaleLowerCase().includes(search)))));
  const sortedVisible = sort === 'name'
    ? [...visible].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id))
    : visible;
  const openDocument = (doc: StudyDoc) => onOpenDoc(doc);

  return <section className="study-home" aria-label="学习项目首页" aria-busy={loading}>
    <aside className="sh-sidebar" aria-label="项目导航">
      <div className="sh-space"><span className="sh-space-icon"><BookOpen size={20} /></span><div><strong>我的学习空间</strong></div></div>
      <button type="button" className="sh-nav-item" aria-current={activeProject === null ? 'page' : undefined} onClick={() => setProject(null)}><FolderOpen size={18} /><span>全部项目</span><small>{projects.length}</small></button>
      <div className="sh-project-heading">
        <span>我的项目</span>
        <button type="button" className="sh-create" onClick={()=>{setName('');setCreateError('');createDialog.current?.showModal();}}><Plus size={15} aria-hidden="true"/>新建项目</button>
      </div>
      <nav aria-label="选择学习项目">
        {projects.map((name,index)=><div className="sh-project-row" key={name}>
          <button type="button" className="sh-nav-item" aria-current={activeProject===name?'page':undefined} onClick={()=>setProject(name)}>
            <span className="sh-project-dot" data-tone={index%4}/><span>{name||'未分类项目'}</span><small>{docs.filter(doc=>doc.course===name).length}</small>
          </button>
          {name&&<details className="sh-project-menu" name="study-project-actions">
            <summary aria-label={`管理项目 ${name}`}><MoreHorizontal size={17} aria-hidden="true"/></summary>
            <div className="sh-project-actions">
              <button type="button" onClick={event=>openManage('rename',name,event)}>重命名</button>
              <button type="button" onClick={event=>openManage('delete',name,event)}>删除</button>
            </div>
          </details>}
        </div>)}
      </nav>
    </aside>
    <dialog className="sh-create-dialog" ref={createDialog} aria-labelledby={nameId+'-heading'} onCancel={event=>{if(creating)event.preventDefault();}}>
      <form onSubmit={create}>
        <h2 id={nameId+'-heading'}>新建项目</h2>
        <label htmlFor={nameId}>项目名称</label>
        <input id={nameId} value={name} onChange={event=>setName(event.target.value)} autoFocus maxLength={100} required disabled={creating}/>
        {createError&&<p className="sh-create-error" role="alert">{createError}</p>}
        <div className="sh-create-actions">
          <button type="button" onClick={()=>createDialog.current?.close()} disabled={creating}>取消</button>
          <button className="sh-primary" disabled={creating||!name.trim()}>{creating?'创建中…':'创建项目'}</button>
        </div>
      </form>
    </dialog>
    <dialog ref={manageDialog} className="sh-create-dialog" aria-labelledby={manageId+'-title'} onCancel={event=>{if(creating)event.preventDefault();}}>
      {manage&&<form onSubmit={saveManage}>
        <h2 id={manageId+'-title'}>{manage.action==='rename'?'重命名项目':'删除项目'}</h2>
        {manage.action==='rename'?<>
          <label htmlFor={manageId}>项目名称</label>
          <input id={manageId} maxLength={100} required autoFocus value={destination} disabled={creating} onChange={event=>setDestination(event.target.value)}/>
        </>:<>
          <p>确认删除「{manage.project}」？</p>
          {fileCount>0&&<>
            <p>项目里有 {fileCount} 份资料。请选择移入的项目，资料和讨论会一起保留。</p>
            <label htmlFor={manageId}>移入项目</label>
            <select id={manageId} required disabled={creating} value={destination} onChange={event=>setDestination(event.target.value)}>
              <option value="" disabled hidden>选择目标项目</option>
              {projects.filter(name=>name&&name!==manage.project).map(name=><option key={name} value={name}>{name}</option>)}
            </select>
            {projects.filter(name=>name&&name!==manage.project).length===0&&<p>请先新建一个目标项目，再回来移资料。</p>}
          </>}
        </>}
        {createError&&<p className="sh-create-error" role="alert">{createError}</p>}
        <div className="sh-create-actions">
          <button type="button" disabled={creating} onClick={()=>manageDialog.current?.close()}>取消</button>
          <button className={manage.action==='rename'?'sh-primary':'sh-project-delete'}
            disabled={creating||((manage.action==='rename'||fileCount>0)&&(!destination.trim()||destination.trim()===manage.project))}>
            {creating?'处理中…':manage.action==='rename'?'保存名称':fileCount?'移动资料并删除':'确认删除'}
          </button>
        </div>
      </form>}
    </dialog>
    <div className="sh-main">
      <header className="sh-header"><h1>{activeProject ?? '学习首页'}</h1><button type="button" className="sh-primary" onClick={() => onImport(activeProject ?? undefined)}><Plus size={17} />导入资料</button></header>
      {error && <div className="sh-error" role="alert"><strong>资料暂时未能完整载入</strong><span>{error}</span><span>请刷新页面后重试。</span></div>}
      {loading ? <div className="sh-loading" role="status"><BookOpen size={26} /><p>正在载入你的学习项目…</p></div> : !projects.length ? !error && <div className="sh-empty">
        <span className="sh-empty-icon"><BookOpen size={36} strokeWidth={1.3} /></span><h2>还没有学习资料</h2><p>从右上角导入 PDF 或 PPTX，按课程建立项目。</p><small>单份不超过 20 MiB</small>{onSample && <button type="button" className="sh-sample" onClick={onSample}>打开示例讲义<ArrowRight size={16} /></button>}
      </div> : <>
        {recent && activeProject === null && !search && <section className="sh-resume" aria-labelledby="sh-resume-title"><div className="sh-resume-body"><span className="sh-resume-label"><History size={15} />继续学习</span><p className="sh-resume-course">{recent.course}</p><h2 id="sh-resume-title">{title(recent)}</h2><p><span className="sh-resume-date">{recentPage ? `上次读到第 ${recentPage} 页` : `上次打开 ${dateLabel(recent.visited)}`}</span></p><button type="button" onClick={() => onOpenDoc(recent)} className="sh-resume-button">继续阅读<ArrowRight size={17} /></button></div><div className="sh-page-motif" aria-hidden="true"><FileText size={42} strokeWidth={1} /><span>{recent.kind.toUpperCase()}</span></div></section>}
        <div className="sh-section-heading"><div><h2>{activeProject === null ? '我的项目' : '项目资料'}</h2><span>{activeProject === null ? `${projects.length} 个项目` : `${docs.filter(doc => doc.course === activeProject).length} 份资料`}</span></div><div className="sh-tools">{activeProject&&onOpenMemory&&<button type="button" className="sh-memory-link" onClick={()=>onOpenMemory(activeProject)}>复习主题</button>}<label className="sh-search" htmlFor={searchId}><Search size={17} /><span className="sh-sr-only">搜索项目、资料或提问</span><input id={searchId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目、资料或提问" />{query && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label></div></div>
        {search && <p className="sh-search-status" role="status">{activeProject !== null ? `在「${activeProject}」中` : '全部项目中'}找到 {visible.length} 份相关资料</p>}
        {!search && activeProject === null && <div className="sh-projects" aria-label="我的项目">{projects.map((name, index) => { const projectDocs = docs.filter(doc => doc.course === name); const ids = new Set(projectDocs.map(doc => doc.id)); const count = threads.filter(thread => ids.has(thread.docId) && thread.messages.length).length; return <button type="button" key={name} className="sh-project-card" onClick={() => setProject(name)}><span className="sh-folder" data-tone={index % 4}><FolderOpen size={20} strokeWidth={1.5} /></span><h3>{name || '未分类项目'}</h3><p>{projectDocs.length} 份资料<span>{count} 条讨论</span></p><span className="sh-project-open">进入项目<ChevronRight size={16} /></span></button>; })}</div>}
        {(search || activeProject !== null || ordered.some(doc => !!doc.visited)) && <section className="sh-documents" aria-label={search ? '搜索结果' : activeProject !== null ? '项目资料' : '最近阅读'}>
          {!search && activeProject === null ? <h2>最近阅读</h2> : sortedVisible.length>0 && <div className="sh-document-toolbar"><select className="sh-sort" aria-label="文件排序方式" value={sort} onChange={event => setSort(event.target.value === 'name' ? 'name' : 'recent')}><option value="recent">最近打开</option><option value="name">文件名称</option></select></div>}
          {(activeProject === null && !search ? visible.filter(doc => !!doc.visited).slice(0, 5) : sortedVisible).map(doc => { const matched = search ? threads.filter(thread => thread.docId === doc.id).find(thread => thread.messages.some(message => message.role === 'user' && message.content.toLocaleLowerCase().includes(search))) : undefined; const question = matched?.messages.find(message => message.role === 'user' && message.content.toLocaleLowerCase().includes(search)); return <div className="sh-material-row" key={doc.id}><button type="button" className="sh-document" onClick={() => matched ? onOpenDoc(doc, question?.page ?? matched.page, matched.id) : openDocument(doc)}><span className="sh-file"><FileText size={20} /><small>{doc.kind.toUpperCase()}</small></span><span className="sh-document-copy"><strong>{title(doc)}</strong><span>{doc.course}{question ? ` · 匹配提问：${question.content}` : ''}</span></span><time>{dateLabel(doc.visited)}</time><ChevronRight size={17} /></button>{doc.id!=='sample'&&<details className="sh-project-menu" name="study-material-actions">
            <summary aria-label={`整理 ${doc.name}`}><MoreHorizontal size={17} aria-hidden="true"/></summary>
            <div className="sh-project-actions"><button type="button" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');onMoveDoc(doc);}}>移动到项目</button></div>
          </details>}</div>; })}
        </section>}
        {!visible.length && !search && activeProject!==null && <div className="sh-no-results"><FolderOpen size={25} /><h3>这个项目还没有资料</h3><button type="button" onClick={()=>onImport(activeProject)}>导入第一份资料</button></div>}
        {!visible.length && search && <div className="sh-no-results"><Search size={25} /><h3>没有找到相关资料</h3><p>试试课程名、文件名，或曾经提问中的关键词。</p><button type="button" onClick={() => setQuery('')}>清除搜索</button>{activeProject !== null && <button type="button" onClick={() => setProject(null)}>搜索全部项目</button>}</div>}
      </>}
    </div>
  </section>;
}
