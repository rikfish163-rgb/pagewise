'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import { Bold, Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Eye, FileText, Highlighter, List, Maximize2, PencilLine, Sigma, SpellCheck, SplitSquareVertical } from 'lucide-react';
import {DropdownMenu} from 'radix-ui';
import {notebookNavigation} from '../lib/markdown';
import './notebook.css';
import MarkdownAnswer from './MarkdownAnswer';

const fontFamilies: Record<string,string> = {
 '系统黑体': 'system-ui, "Microsoft YaHei", "PingFang SC", sans-serif',
 '霞鹜文楷': 'var(--wenkai), KaiTi, serif',
 '宋体': '"Songti SC", SimSun, "Noto Serif CJK SC", serif',
 '等宽字体': 'var(--font-code)',
};
const preferencesKey='pagewise:note-typography:v1';
type Layout='continuous'|'standard'|'wide';
type Preferences={font:string;size:number;layout:Layout;spacing?:string};
const defaults:Preferences={font:'系统黑体',size:12,layout:'standard'};

function scrollPreview(event:ReactKeyboardEvent<HTMLDivElement>){
 if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
 if(event.defaultPrevented||event.nativeEvent.isComposing||event.altKey||event.ctrlKey||
    event.metaKey||event.shiftKey||event.target!==event.currentTarget)return;
 const preview=event.currentTarget;
 const slide=preview.querySelector<HTMLElement>('.nb-slide');
 const down=event.key==='ArrowDown';
 const canScrollSlide=slide&&(down?slide.scrollHeight-slide.clientHeight-slide.scrollTop>1:slide.scrollTop>0);
 const surface=canScrollSlide?slide:preview;
 event.preventDefault();
 surface.scrollTop+=down?48:-48;
}

export default function Notebook({visible,insert}:{visible:boolean;insert:{text:string;id:number}|null}){
 const [body,setBody]=useState(''),[revision,setRevision]=useState(-1),[preview,setPreview]=useState(false),[status,setStatus]=useState('正在读取…');
 const area=useRef<HTMLTextAreaElement>(null),last=useRef(''),saving=useRef(false),inserted=useRef(0),[attempt,retry]=useState(0),[blocked,setBlocked]=useState(false);
 const [prefs,setPrefs]=useState(defaults);
 const [page,setPage]=useState(0);
 const [menu,setMenu]=useState(false);
 const actions=useRef<HTMLDivElement>(null),importFile=useRef<HTMLInputElement>(null),stage=useRef<HTMLDialogElement>(null);
 const [expanded,setExpanded]=useState(false);
 const {pages,headings}=useMemo(()=>preview?notebookNavigation(body):{pages:[],headings:[]},[body,preview]);
 const editor=useRef<HTMLDivElement>(null),previewHost=useRef<HTMLDivElement>(null),expandedPreviewHost=useRef<HTMLDivElement>(null);
 useEffect(()=>{
   if(expanded)expandedPreviewHost.current?.focus({preventScroll:true});
 },[expanded]);
 const index=Math.min(page,Math.max(0,pages.length-1));
 useEffect(()=>{
   try{
     const saved=JSON.parse(localStorage.getItem(preferencesKey)||'null');
     if(saved && typeof saved.font==='string' && saved.font.length<=100 && Number.isInteger(saved.size)&&saved.size>=8&&saved.size<=72&&['continuous','standard','wide'].includes(saved.layout))setPrefs(saved);
   }catch{}
 },[]);
 function preference(change:Partial<Preferences>){
   const next={...prefs,...change};setPrefs(next);
   try{localStorage.setItem(preferencesKey,JSON.stringify(next))}catch{}
 }
 useEffect(()=>{
   if(!menu)return;
   function outside(e:PointerEvent){if(!actions.current?.contains(e.target as Node))setMenu(false)}
   function escape(e:KeyboardEvent){if(e.key==='Escape')setMenu(false)}
   document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
   return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 },[menu]);
 useEffect(()=>{let live=true;fetch('/api/study/notebook').then(async r=>{const data=await r.json() as {body:string;revision:number;error?:string};if(!r.ok)throw Error(data.error);if(live){setBody(data.body);last.current=data.body;setRevision(data.revision);setStatus('已同步');}}).catch(e=>{if(live)setStatus(e.message)});return()=>{live=false}},[]);
 useEffect(()=>{if(insert&&inserted.current!==insert.id&&revision>=0){inserted.current=insert.id;setBody(v=>[v.trimEnd(),insert.text].filter(Boolean).join('\n\n'));setPreview(false);}},[insert,revision]);
 useEffect(()=>{if(revision<0||blocked||last.current===body)return;
  setStatus('待保存');const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);
  const timer=setTimeout(async()=>{if(saving.current)return;saving.current=true;setStatus('保存中…');try{const r=await fetch('/api/study/notebook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,revision})});const data=await r.json() as {body:string;revision:number;error?:string};if(!r.ok){if(r.status===409)setBlocked(true);throw Error(data.error||'保存失败');}last.current=body;setStatus('已同步');setRevision(data.revision);window.dispatchEvent(new Event('pagewise:credits-changed'));}catch(e){setStatus(e instanceof Error?e.message:'保存失败');}finally{saving.current=false;}},500);
  return()=>{clearTimeout(timer);window.removeEventListener('beforeunload',warn);};},[body,revision,attempt,blocked]);
 function wrap(left:string,right:string,h=false){const el=area.current;if(!el)return;const start=h?body.lastIndexOf('\n',el.selectionStart-1)+1:el.selectionStart;const end=el.selectionEnd;const selected=body.slice(start,end);const before=h?selected.replace(/^#{1,6}\s+/,''):selected;setBody(body.slice(0,start)+left+before+right+body.slice(end));requestAnimationFrame(()=>{el.focus();el.setSelectionRange(start+left.length,start+left.length+before.length)});}
 function download(){const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='我的学习笔记.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
 function normalize(){
   let fence='';
   setBody(body.split('\n').map(line=>{
     const marker=line.trimStart().match(/^(`{3,}|~{3,}|\$\$)/)?.[0];
     if(marker){if(!fence)fence=marker;else if(marker.startsWith(fence))fence='';return line;}
     return fence?line:line.replace(/^(#{1,6})([^#\s])/,'$1 $2').replace(/^([*+-])\s+/, '- ');
   }).join('\n'));
 }
 const font=fontFamilies[prefs.font]||(`"${prefs.font.replace(/["\\]/g,'')}", system-ui, sans-serif`);
 const style={'--note-font':font,'--note-size':prefs.size+'pt','--note-leading':prefs.spacing==='compact'?1.45:1.75,'--slide-ratio-number':prefs.layout==='wide'?16/9:4/3,'--slide-ratio':prefs.layout==='wide'?'16 / 9':'4 / 3'} as CSSProperties;
 const slide=prefs.layout!=='continuous';
 function previewContent(){
   const content=slide?pages[index]||'':body;
   return <div key={slide?index:'document'} className={slide?'nb-slide':'nb-flow'}>{content.trim()?<MarkdownAnswer content={content}/>:<p className="nb-empty">在「编辑」中写下第一段笔记。</p>}</div>;
 }
 function outline(inDialog=false){
   if(!headings.length)return null;
   return <DropdownMenu.Root modal={false}>
     <DropdownMenu.Trigger className="nb-outline-trigger" aria-label="笔记目录">
       目录<ChevronDown size={14} aria-hidden="true"/>
     </DropdownMenu.Trigger>
     <DropdownMenu.Portal container={inDialog?stage.current:undefined}>
       <DropdownMenu.Content className="nb-outline-menu" align="end" sideOffset={4} collisionPadding={6}
         collisionBoundary={inDialog?stage.current:editor.current}>
         {headings.map((heading,headingIndex)=><DropdownMenu.Item
           key={headingIndex}
           className="nb-outline-item"
           textValue={heading.text}
           title={heading.text}
           style={{'--heading-indent':Math.min(heading.level-1,3)*10+'px'} as CSSProperties}
           onSelect={()=>{
             if(slide)setPage(heading.slide);
             requestAnimationFrame(()=>{
               const host=inDialog?stage.current:previewHost.current;
               const target=host?.querySelectorAll<HTMLElement>('.markdown-answer :is(h1,h2,h3,h4,h5,h6)')[slide?heading.position:headingIndex];
               target?.scrollIntoView({block:'nearest'});
             });
           }}>
           <span>{heading.text}</span>
         </DropdownMenu.Item>)}
       </DropdownMenu.Content>
     </DropdownMenu.Portal>
   </DropdownMenu.Root>;
 }
 function navigation(){
   return <div className="nb-pagination"><button type="button" aria-label="上一张" disabled={index===0} onClick={()=>setPage(index-1)}><ChevronLeft size={16}/></button><span>{index+1} / {pages.length}</span><button type="button" aria-label="下一张" disabled={index+1>=pages.length} onClick={()=>setPage(index+1)}><ChevronRight size={16}/></button></div>;
 }
 function tool(label:string,Icon:typeof Bold,act:()=>void){
   return <button type="button" title={label} aria-label={label} onMouseDown={e=>e.preventDefault()} onClick={act}><Icon size={15} strokeWidth={1.7}/></button>;
 }
 return <section className="nb" hidden={!visible} style={style} aria-label="我的学习笔记">
   <header className="nb-header"><div className="nb-title"><FileText size={18} aria-hidden="true"/><strong>学习笔记<span>.md</span></strong></div>
     <div className="nb-actions" ref={actions}><button className="nb-more" title="文件操作" aria-label="文件操作" aria-expanded={menu} onClick={()=>setMenu(!menu)}><Ellipsis size={18}/></button>
       {menu&&<div className="nb-menu"><button disabled={revision<0} onClick={()=>{setMenu(false);importFile.current?.click()}}>导入 Markdown</button><button onClick={()=>{setMenu(false);download()}}>导出 Markdown</button><button disabled={blocked||revision<0} onClick={()=>{setMenu(false);retry(n=>n+1)}}>保存笔记</button></div>}
       <input hidden ref={importFile} type="file" accept=".md,.markdown,text/markdown" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>750000){setStatus('文件过大');return}try{const imported=await f.text();setBody(v=>[v,imported].filter(Boolean).join('\n\n'));setPreview(false)}catch{setStatus('文件读取失败')}}}/>
     </div>
   </header>
   <div className="nb-editor" ref={editor}>
     <div className="nb-modes" role="group" aria-label="笔记视图">
       <button aria-pressed={!preview} onClick={()=>setPreview(false)}><PencilLine size={15}/>编辑</button>
       <button aria-pressed={preview} onClick={()=>{
         setPreview(true);
         requestAnimationFrame(()=>previewHost.current?.focus({preventScroll:true}));
       }}><Eye size={16}/>预览</button>
       {preview&&<button className="nb-expand" aria-label="放大预览" title="放大预览" onClick={()=>{setExpanded(true);stage.current?.showModal()}}><Maximize2 size={15}/></button>}
     </div>
     <details className="nb-typography"><summary>排版<span>{prefs.font||'自定义字体'} · {prefs.size} pt · {prefs.spacing==='compact'?'紧凑':'宽松'}</span></summary><div className="nb-typebar">
       <label>字体<select aria-label="笔记字体" value={Object.hasOwn(fontFamilies,prefs.font)?prefs.font:'custom'} onChange={e=>preference({font:e.target.value==='custom'?'':e.target.value})}>{Object.keys(fontFamilies).map(f=><option key={f}>{f}</option>)}<option value="custom">自定义字体</option></select></label>
       <label>字号<span className="nb-number"><input aria-label="笔记字号" type="number" min={8} max={72} key={prefs.size} defaultValue={prefs.size} onBlur={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))preference({size:Math.min(72,Math.max(8,Math.round(n)))});e.target.value=String(Number.isFinite(n)?Math.min(72,Math.max(8,Math.round(n))):prefs.size)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/><span>pt</span></span></label>
       <label>行距<select aria-label="笔记行距" value={prefs.spacing??'normal'} onChange={e=>preference({spacing:e.target.value})}><option value="normal">宽松</option><option value="compact">紧凑</option></select></label>
       {!Object.hasOwn(fontFamilies,prefs.font)&&<input className="nb-custom" aria-label="本机字体名称" placeholder="输入本机已安装的字体名" maxLength={100} value={prefs.font} onChange={e=>preference({font:e.target.value})}/>}
     </div></details>
     {preview?<div className="nb-layout"><label>版式 <select value={prefs.layout} aria-label="预览版式" onChange={e=>{setPage(0);preference({layout:e.target.value as Layout})}}><option value="continuous">连续文档</option><option value="standard">标准幻灯片 · 4:3</option><option value="wide">宽屏幻灯片 · 16:9</option></select></label>{outline()}{slide&&navigation()}</div>:<fieldset className="nb-format" aria-label="Markdown 格式" disabled={revision<0}>
       <select aria-label="插入标题" value="" onChange={e=>wrap('#'.repeat(Number(e.target.value))+' ','',true)}><option value="" disabled>标题</option>{[1,2,3,4,5,6].map(n=><option value={n} key={n}>H{n}</option>)}</select>
       {tool('加粗',Bold,()=>wrap('**','**'))}{tool('高亮',Highlighter,()=>wrap('==','=='))}{tool('公式',Sigma,()=>wrap('$','$'))}{tool('列表',List,()=>wrap('- ','',true))}{tool('插入幻灯片分页线',SplitSquareVertical,()=>wrap('\n\n---\n\n',''))}{tool('规范排版',SpellCheck,normalize)}
     </fieldset>}
     {preview?<div ref={previewHost} className={'nb-preview'+(slide?' paper-stage':'')} tabIndex={0}
       role="region" aria-label="笔记预览" onKeyDown={scrollPreview}>{previewContent()}</div>:
       <textarea ref={area} disabled={revision<0} aria-label="Markdown 学习笔记" value={body} onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'){e.preventDefault();wrap('**','**')}}} placeholder="写下你的笔记…"/>}
   </div>
   <footer className="nb-status"><span role="status">{status==='已同步'&&<Check size={13}/>} {status}</span><span>{body.length.toLocaleString()} 字符</span></footer>
   <dialog ref={stage} className="nb-dialog" onClose={()=>setExpanded(false)}><header><strong>学习笔记</strong>{expanded&&outline(true)}{slide&&navigation()}<button aria-label="关闭放大预览" onClick={()=>stage.current?.close()}>关闭</button></header>{expanded&&<div ref={expandedPreviewHost} className={'nb-preview'+(slide?' paper-stage':'')}
     tabIndex={0} role="region" aria-label="放大的笔记预览" onKeyDown={scrollPreview}>{previewContent()}</div>}</dialog>
 </section>
}
