'use client';
import { useLocale } from './LocaleProvider';
import {useCallback,useEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import { Bold, Check, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Eye, FileText, Highlighter, List, Maximize2, PencilLine, Sigma, SpellCheck, SplitSquareVertical } from 'lucide-react';
import {DropdownMenu} from 'radix-ui';
import {notebookNavigation} from '../lib/markdown';
import './notebook.css';
import MarkdownAnswer from './MarkdownAnswer';
import type {LucideIcon} from 'lucide-react';

const fontFamilies: Record<string,string> = {
 '系统黑体': 'var(--font-sans)',
 '霞鹜文楷': 'var(--wenkai), KaiTi, serif',
 '宋体': '"Songti SC", SimSun, "Noto Serif CJK SC", serif',
 '等宽字体': 'var(--font-code)',
};
const preferencesKey='pagewise:note-typography:v1';
type Layout='continuous'|'standard'|'wide';
type Preferences={font:string;size:number;layout:Layout;spacing?:string};
const defaults:Preferences={font:'系统黑体',size:12,layout:'continuous'};

function FormatTool({label,Icon,onAction}:{label:string;Icon:LucideIcon;onAction:()=>void}){
 const { t } = useLocale();
 return <button type="button" title={t(label)} aria-label={t(label)} onMouseDown={event=>event.preventDefault()} onClick={onAction}><Icon size={15} strokeWidth={1.7}/></button>;
}

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

export default function NotebookEditor({body,title,number,status,blocked,onChange,onRetry,onReload,reloading}:{
 body:string;title:string;number:number;status:string;blocked:boolean;
 onChange:(body:string)=>void;onRetry:()=>void;onReload:()=>void;reloading:boolean;
}){
  const { t } = useLocale();
 const [preview,setPreview]=useState(false);
 const [importError,setImportError]=useState('');
 const area=useRef<HTMLTextAreaElement>(null);
 function setBody(value:string|((previous:string)=>string)){onChange(typeof value==='function'?value(body):value);}
 const [prefs,setPrefs]=useState(defaults);
 const [page,setPage]=useState(0);
 const [menu,setMenu]=useState(false);
 const actions=useRef<HTMLDivElement>(null),importFile=useRef<HTMLInputElement>(null),stage=useRef<HTMLDialogElement>(null);
 const [dialogPortal,setDialogPortal]=useState<HTMLElement|null>(null);
 const [expanded,setExpanded]=useState(false);
 const {pages,headings}=useMemo(()=>preview?notebookNavigation(body):{pages:[],headings:[]},[body,preview]);
 const editor=useRef<HTMLDivElement>(null),previewHost=useRef<HTMLDivElement>(null),expandedPreviewHost=useRef<HTMLDivElement>(null);
 const [outlineTarget,setOutlineTarget]=useState<number|null>(null);
 const [previewHostElement,setPreviewHostElement]=useState<HTMLDivElement|null>(null);
 const [expandedPreviewElement,setExpandedPreviewElement]=useState<HTMLDivElement|null>(null);
 useEffect(()=>{
   if(expanded)expandedPreviewHost.current?.focus({preventScroll:true});
 },[expanded]);
 const index=Math.min(page,Math.max(0,pages.length-1));
 useEffect(()=>{
   let frame=0;
   try{
     const saved=JSON.parse(localStorage.getItem(preferencesKey)||'null');
     if(saved && typeof saved.font==='string' && saved.font.length<=100 && Number.isInteger(saved.size)&&saved.size>=8&&saved.size<=72&&['continuous','standard','wide'].includes(saved.layout))frame=requestAnimationFrame(()=>setPrefs(saved));
   }catch{}
   return()=>cancelAnimationFrame(frame);
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
 function wrap(left:string,right:string,h=false){const el=area.current;if(!el)return;const start=h?body.lastIndexOf('\n',el.selectionStart-1)+1:el.selectionStart;const end=el.selectionEnd;const selected=body.slice(start,end);const before=h?selected.replace(/^#{1,6}\s+/,''):selected;setBody(body.slice(0,start)+left+before+right+body.slice(end));requestAnimationFrame(()=>{el.focus();el.setSelectionRange(start+left.length,start+left.length+before.length)});}
 function download(){const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=String(number).padStart(3,'0')+'-'+(title||'未命名笔记').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
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
   return <div key={slide?index:'document'} className={slide?'nb-slide':'nb-flow'}>{content.trim()?<MarkdownAnswer content={content}/>:<p className="nb-empty">{t("在「编辑」中写下第一段笔记。")}</p>}</div>;
 }
 const onOutlineClose=useCallback((event:Event,inDialog:boolean)=>{
   const headingIndex=outlineTarget;
   setOutlineTarget(null);
   const host=inDialog?expandedPreviewElement:previewHostElement;
   if(headingIndex===null||!host)return;
   const position=slide?headings[headingIndex]?.position:headingIndex;
   event.preventDefault();
   host.focus({preventScroll:true});
   if(position!==undefined){
     const headingsInPreview=host.querySelectorAll<HTMLElement>('.markdown-answer :is(h1,h2,h3,h4,h5,h6)');
     headingsInPreview[position]?.scrollIntoView({block:'nearest'});
   }
 },[expandedPreviewElement,headings,outlineTarget,previewHostElement,slide]);
 function outline(inDialog=false){
   if(!headings.length)return null;
   return <DropdownMenu.Root modal={false}>
     <DropdownMenu.Trigger className="nb-outline-trigger" aria-label={t("笔记目录")}>{t("目录")}<ChevronDown size={14} aria-hidden="true"/>
     </DropdownMenu.Trigger>
     <DropdownMenu.Portal container={inDialog?dialogPortal:undefined}>
       <DropdownMenu.Content className="nb-outline-menu" align="end" sideOffset={4} collisionPadding={6}
         onCloseAutoFocus={event=>onOutlineClose(event,inDialog)}>
         {headings.map((heading,headingIndex)=><DropdownMenu.Item
           key={headingIndex}
           className="nb-outline-item"
           textValue={heading.text}
           title={heading.text}
           style={{'--heading-indent':Math.min(heading.level-1,3)*10+'px'} as CSSProperties}
           onSelect={()=>{
             setOutlineTarget(headingIndex);
             if(slide)setPage(heading.slide);
           }}>
           <span>{heading.text}</span>
         </DropdownMenu.Item>)}
       </DropdownMenu.Content>
     </DropdownMenu.Portal>
   </DropdownMenu.Root>;
 }
 function navigation(){
   return <div className="nb-pagination"><button type="button" aria-label={t("上一张")} disabled={index===0} onClick={()=>setPage(index-1)}><ChevronLeft size={16}/></button><span>{index+1} / {pages.length}</span><button type="button" aria-label={t("下一张")} disabled={index+1>=pages.length} onClick={()=>setPage(index+1)}><ChevronRight size={16}/></button></div>;
 }
 return <section className="nb" style={style} aria-label={t("笔记正文")}>
   <header className="nb-header"><div className="nb-title"><FileText size={17} aria-hidden="true"/><strong>{t("笔记正文")}</strong></div>
     <div className="nb-actions" ref={actions}><button className="nb-more" title={t("文件操作")} aria-label={t("文件操作")} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Ellipsis size={18}/></button>
       {menu&&<div className="nb-menu"><button onClick={()=>{setMenu(false);importFile.current?.click()}}>{t("导入 Markdown")}</button><button onClick={()=>{setMenu(false);download()}}>{t("导出 Markdown")}</button><button disabled={blocked} onClick={()=>{setMenu(false);onRetry()}}>{t("保存笔记")}</button></div>}
       <input hidden ref={importFile} type="file" accept=".md,.markdown,text/markdown" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>750000){setImportError('文件过大');return}try{const imported=await f.text();if(body.length+imported.length+2>250000){setImportError('每条笔记最多 25 万字。');return}setImportError('');setBody(v=>[v,imported].filter(Boolean).join('\n\n'));setPreview(false)}catch{setImportError('文件读取失败')}}}/>
     </div>
   </header>
   <div className="nb-editor" ref={editor}>
     <div className="nb-modes" role="group" aria-label={t("笔记视图")}>
       <button aria-pressed={!preview} onClick={()=>setPreview(false)}><PencilLine size={15}/>{t("编辑")}</button>
       <button aria-pressed={preview} onClick={()=>{
         setPreview(true);
         requestAnimationFrame(()=>previewHost.current?.focus({preventScroll:true}));
       }}><Eye size={16}/>{t("预览")}</button>
       {preview&&<button className="nb-expand" aria-label={t("放大预览")} title={t("放大预览")} onClick={()=>{setExpanded(true);stage.current?.showModal()}}><Maximize2 size={15}/></button>}
     </div>
     <details className="nb-typography"><summary>{t("排版设置")}</summary><div className="nb-typebar">
       <label>{t("字体")}<select aria-label={t("笔记字体")} value={Object.hasOwn(fontFamilies,prefs.font)?prefs.font:'custom'} onChange={e=>preference({font:e.target.value==='custom'?'':e.target.value})}>{Object.keys(fontFamilies).map(f=><option key={f} value={f}>{t(f)}</option>)}<option value="custom">{t("自定义字体")}</option></select></label>
       <label>{t("字号")}<span className="nb-number"><input aria-label={t("笔记字号")} type="number" min={8} max={72} key={prefs.size} defaultValue={prefs.size} onBlur={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n))preference({size:Math.min(72,Math.max(8,Math.round(n)))});e.target.value=String(Number.isFinite(n)?Math.min(72,Math.max(8,Math.round(n))):prefs.size)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/><span>pt</span></span></label>
       <label>{t("行距")}<select aria-label={t("笔记行距")} value={prefs.spacing??'normal'} onChange={e=>preference({spacing:e.target.value})}><option value="normal">{t("宽松")}</option><option value="compact">{t("紧凑")}</option></select></label>
       {!Object.hasOwn(fontFamilies,prefs.font)&&<input className="nb-custom" aria-label={t("本机字体名称")} placeholder={t("输入本机已安装的字体名")} maxLength={100} value={prefs.font} onChange={e=>preference({font:e.target.value})}/>}
     </div></details>
     {preview?<div className="nb-layout"><label>{t("版式 ")}<select value={prefs.layout} aria-label={t("预览版式")} onChange={e=>{setPage(0);preference({layout:e.target.value as Layout})}}><option value="continuous">{t("连续文档")}</option><option value="standard">{t("标准幻灯片 · 4:3")}</option><option value="wide">{t("宽屏幻灯片 · 16:9")}</option></select></label>{outline()}{slide&&navigation()}</div>:<fieldset className="nb-format" aria-label={t("Markdown 格式")}>
       <select aria-label={t("插入标题")} value="" onChange={e=>wrap('#'.repeat(Number(e.target.value))+' ','',true)}><option value="" disabled>{t("标题")}</option>{[1,2,3,4,5,6].map(n=><option value={n} key={n}>H{n}</option>)}</select>
       <FormatTool label="加粗" Icon={Bold} onAction={()=>wrap('**','**')}/><FormatTool label="高亮" Icon={Highlighter} onAction={()=>wrap('==','==')}/><FormatTool label="公式" Icon={Sigma} onAction={()=>wrap('$','$')}/><FormatTool label="列表" Icon={List} onAction={()=>wrap('- ','',true)}/><FormatTool label="插入幻灯片分页线" Icon={SplitSquareVertical} onAction={()=>wrap('\n\n---\n\n','')}/><FormatTool label="规范排版" Icon={SpellCheck} onAction={normalize}/>
     </fieldset>}
     {preview?<div ref={node=>{previewHost.current=node;setPreviewHostElement(node)}} className={'nb-preview'+(slide?' paper-stage':'')} tabIndex={0}
       role="region" aria-label={t("笔记预览")} onKeyDown={scrollPreview}>{previewContent()}</div>:
       <textarea ref={area} aria-label={t("Markdown 学习笔记")} maxLength={250000} value={body} onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'){e.preventDefault();wrap('**','**')}}} placeholder={t("写下你的笔记…")}/>}
   </div>
   {importError&&<p className="nb-import-error" role="alert">{t(importError)}</p>}
   {blocked&&<section className="nb-conflict" role="alert"><p>{t("笔记已在其他位置更新。导出当前编辑后，可重新读取已保存版本。")}</p><button type="button" onClick={download}>{t("导出当前编辑")}</button><button type="button" disabled={reloading} onClick={onReload}>{reloading?t("正在读取…"):t("用已保存版本替换当前编辑")}</button></section>}
   <footer className="nb-status"><span role="status" className={status==='已同步'?'nb-status-saved':''}>{status==='已同步'&&<Check size={13}/>} {t(status)}</span><span>{t("{0} 字符", { 0: body.length.toLocaleString() })}</span></footer>
   <dialog ref={node=>{stage.current=node;if(node)setDialogPortal(node)}} className="nb-dialog" onClose={()=>setExpanded(false)}><header><strong>{title||t("未命名笔记")}</strong>{expanded&&outline(true)}{slide&&navigation()}<button aria-label={t("关闭放大预览")} onClick={()=>stage.current?.close()}>{t("关闭")}</button></header>{expanded&&<div ref={node=>{expandedPreviewHost.current=node;setExpandedPreviewElement(node)}} className={'nb-preview'+(slide?' paper-stage':'')}
     tabIndex={0} role="region" aria-label={t("放大的笔记预览")} onKeyDown={scrollPreview}>{previewContent()}</div>}</dialog>
 </section>
}
