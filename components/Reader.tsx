'use client';

import { useLocale } from './LocaleProvider';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlignLeft, ChevronLeft, ChevronRight, Scan, TextSelect, ZoomIn, ZoomOut } from 'lucide-react';
import { normalizedRect, pixelRect, pageWithin, type Rect } from './reader-geometry';
import { locateAnchor, scrollTopFor, type PageBox } from './reading-position';
import { annotationsVisible, pageRenderState } from './reader-page-state';
import { snapTextSelection, textMarginCaret, type TextCaret } from './reader-selection';
import { isSparseText, layoutPdfText, type PdfTextItem } from './reader-text';
import 'pdfjs-dist/web/pdf_viewer.css';
import './reader.css';
import {readProgress,recentReader,saveProgress,type ReadingProgress} from './reading-progress';

export type ReaderSelection = { page: number; text?: string; image?: string; rect?: number[]; captureId?:string };
export type ReaderAnnotation = {id:string;page:number;label:string;rect?:number[]};
export type ReaderLocation = {page:number;scrollTop:number;anchorPage:number;fraction:number;layout:'continuous'|'single';zoom:number};
export type Props = { documentId:string; navigation:{resume:boolean;revision:number;temporary?:boolean}; lookup: React.RefObject<import('./study-context').PageReader|null>; url: string; kind: 'pdf'|'pptx'; page: number; onSelect: (s:ReaderSelection,action?:'ask'|'add'|'save')=>void; onCrop: (s:ReaderSelection)=>boolean; onCropStart:()=>string; onCropState:(pending:boolean,captureId:string)=>void; onPage: (page:number)=>void; onDismiss:()=>void; onReady?:()=>void; focusRect?: number[]; focusPage?: number; annotations?:ReaderAnnotation[]; onOpenAnnotation?:(id:string,page:number)=>void };
type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;
type Deck = { pres: Awaited<ReturnType<typeof import('@office-kit/pptx').loadPresentation>>; slides: ReturnType<typeof import('@office-kit/pptx').getSlides> };

// Strip active markup and non-embedded resources before displaying private documents.
async function safeSvg(markup: string) {
  const { default: purifier } = await import('dompurify');
  const clean = purifier.sanitize(markup, { USE_PROFILES: { svg:true, svgFilters:true }, FORBID_TAGS: ['a', 'foreignObject', 'style'] });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      if (/href$/i.test(attr.name) && !/^(#|data:image\/)/i.test(attr.value)) el.removeAttribute(attr.name);
      if (/url\(\s*['"]?(?!#|data:image\/)/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  const bounds=doc.documentElement.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
  if(bounds?.length===4 && bounds[2]>0 && bounds[3]>0) {
    // Explicit intrinsic dimensions prevent Image's 300×150 default and crop letterboxing.
    doc.documentElement.setAttribute('width',String(bounds[2]));
    doc.documentElement.setAttribute('height',String(bounds[3]));
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}

function addSlideTextLayer(layer: HTMLDivElement) {
  const base=layer.getBoundingClientRect();
  const overlay=document.createElement('div');overlay.className='pptx-text-overlay';
  layer.appendChild(overlay);
  layer.querySelectorAll('svg text').forEach(line=> {
    const box=line.getBoundingClientRect(), run=line.querySelector('tspan');
    if(!box.width || !box.height || !line.textContent) return;
    const span=document.createElement('span');span.textContent=line.textContent;
    const svgWidth=layer.querySelector('svg')!.viewBox.baseVal.width;
    const size=Number(run?.getAttribute('font-size') || 16);
    Object.assign(span.style,{
      left:`${(box.left-base.left)/base.width*100}%`,top:`${(box.top-base.top)/base.height*100}%`,
      fontSize:`${size/svgWidth*100}cqw`,lineHeight:`${box.height/base.width*100}cqw`,
      fontFamily:run?.getAttribute('font-family') || 'sans-serif',fontWeight:run?.getAttribute('font-weight') || '400',
    });
    overlay.appendChild(span);
    span.style.transform=`scaleX(${box.width/span.getBoundingClientRect().width})`;
  });
}

// Measure every page in scroll-content coordinates. Using live geometry instead
// of cached offsets keeps jumps and returns correct while canvases and slides
// acquire their real aspect ratios after the first paint.
function pageBoxes(reader: HTMLDivElement, pages: HTMLDivElement): PageBox[] {
  const viewport = reader.getBoundingClientRect();
  return Array.from(pages.children, child => {
    const rect = (child as HTMLElement).getBoundingClientRect();
    return { top: rect.top - viewport.top + reader.scrollTop, height: rect.height };
  });
}

export default function Reader({documentId,navigation,lookup:lookupRef,url,kind,page,onPage,onSelect,onCrop,onCropStart,onCropState,onDismiss,onReady,focusRect,focusPage,annotations=[],onOpenAnnotation}: Props) {
  const { t } = useLocale();
  const [pdf, setPdf] = useState<PdfDocument|null>(null);
  const [deck, setDeck] = useState<Deck|null>(null);
  const [count,setCount] = useState(0), [busy,setBusy] = useState(true), [error,setError] = useState('');
  const [zoom,setZoom] = useState(1), [mode,setMode] = useState<'text'|'crop'>('text');
  const [layout,setLayout]=useState<'continuous'|'single'>(kind==='pptx'?'single':'continuous');
  const [pageRatio,setPageRatio]=useState(kind==='pdf'?1/Math.SQRT2:16/9);
  const [thumbnailsOpen,setThumbnailsOpen]=useState(false);
  const thumbnailsMenu=useRef<HTMLDetailsElement>(null);
  const toolsMenu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const media=window.matchMedia('(min-width: 768px)');
    const sync=()=>{if(toolsMenu.current)toolsMenu.current.open=media.matches;};
    sync();
    media.addEventListener('change',sync);
    return ()=>media.removeEventListener('change',sync);
  },[]);
  const [selectionAction,setSelectionAction]=useState<ReaderSelection|null>(null);
  const selectionTools=useRef<HTMLDivElement>(null);
  const queueSelection=(selection:ReaderSelection)=>setSelectionAction(selection);
  const [cropFeedback,setCropFeedback]=useState<{message:string;rect:number[];page:number}|null>(null);
  const feedbackTimer=useRef<number|null>(null);
  useEffect(()=>()=>{if(feedbackTimer.current!==null)window.clearTimeout(feedbackTimer.current);},[]);
  const [revision,setRevision] = useState(0);
  const [textReading,setTextReading]=useState(false);
  const [restoreToken,setRestoreToken]=useState(0);
  const pendingRestore=useRef<ReaderLocation|null>(null);
  const zoomAnchor=useRef<{anchorPage:number;fraction:number}|null>(null);
  const alignAfterText=useRef(false);
  const scroll=useRef<HTMLDivElement>(null);
  const stack=useRef<HTMLDivElement>(null);
  const current=pageWithin(page,count);
  const reported=useRef(0);
  const navigationSeen=useRef(-1);
  const layoutSeen=useRef(layout);
  const restoring=useRef<ReadingProgress|null>(null);
  const observer=useRef<ResizeObserver|null>(null);
  const programmaticScroll=useRef<number|null>(null);
  const scrollFrame=useRef(0);

  function stopRestoring(){
    restoring.current=null;
    observer.current?.disconnect();
    observer.current=null;
  }

  const alignTo=useCallback((reader:HTMLDivElement,pages:HTMLDivElement,targetPage:number,fraction=0)=>{
    const boxes=pageBoxes(reader,pages);
    if(!boxes.length)return;
    reader.scrollTop=scrollTopFor(boxes,pageWithin(targetPage,count||boxes.length),fraction);
    programmaticScroll.current=reader.scrollTop;
  },[count]);

  const startRestoring=useCallback((position:{anchorPage:number;fraction:number},reader:HTMLDivElement,pages:HTMLDivElement)=>{
    const anchorPage=pageWithin(position.anchorPage,count||1);
    const fraction=Math.max(0,Math.min(1,position.fraction));
    restoring.current={page:anchorPage,anchorPage,fraction};
    const restore=()=>{
      const saved=restoring.current;
      if(saved)alignTo(reader,pages,saved.anchorPage,saved.fraction);
    };
    restore();
    // Page shells resize when PDF canvases and slides acquire their real
    // dimensions; keep the same anchor instead of drifting to a neighbour.
    observer.current?.disconnect();
    observer.current=new ResizeObserver(restore);
    observer.current.observe(pages);
    const anchor=pages.children[anchorPage-1];
    if(anchor)observer.current.observe(anchor);
  },[alignTo,count]);

  const saveLocation=useCallback((reader:HTMLDivElement,pages:HTMLDivElement,visiblePage:number)=>{
    const anchor=locateAnchor(pageBoxes(reader,pages),reader.scrollTop);
    if(!navigation.temporary)saveProgress(documentId,{page:visiblePage,anchorPage:anchor.anchorPage,fraction:anchor.fraction});
  },[documentId,navigation.temporary]);

  function readScroll(){
    const reader=scroll.current,pages=stack.current;
    if(layout==='single'||!reader||!pages||!count||pages.children.length!==count)return;
    const programmatic=programmaticScroll.current;
    if(programmatic!==null&&Math.abs(reader.scrollTop-programmatic)<0.5)return;
    // A scroll produced by page shells changing height must not disconnect the
    // anchor observer. Explicit input ends the restore; scrollend catches a
    // scrollbar drag that produced no pointer/wheel event.
    if(restoring.current)return;
    programmaticScroll.current=null;
    const line=reader.getBoundingClientRect().top+Math.min(72,reader.clientHeight*.2);
    let first=0,last=count-1;
    while(first<last){
      const middle=(first+last)>>>1;
      if(pages.children[middle].getBoundingClientRect().bottom<=line)first=middle+1;
      else last=middle;
    }
    const atEnd=reader.scrollHeight>reader.clientHeight&&reader.scrollTop+reader.clientHeight>=reader.scrollHeight-2;
    const selected=atEnd?count:first+1;
    saveLocation(reader,pages,selected);
    if(selected!==current){reported.current=selected;onPage(selected);}
  }

  function syncScroll(){
    if(scrollFrame.current)return;
    scrollFrame.current=requestAnimationFrame(()=>{scrollFrame.current=0;readScroll();});
  }

  function goToPage(next:number){
    stopRestoring();
    const reader=scroll.current,pages=stack.current;
    if(layout==='continuous'&&reader&&pages&&count&&pages.children.length===count){
      startRestoring({anchorPage:next,fraction:0},reader,pages);
      saveLocation(reader,pages,next);
    }
    if(textReading)scroll.current?.scrollTo({top:0});
    reported.current=next;
    onPage(next);
  }

  function chooseThumbnail(event:React.MouseEvent<HTMLButtonElement>){
    goToPage(Number(event.currentTarget.value));
    const menu=thumbnailsMenu.current;
    if(menu){menu.open=false;menu.querySelector('summary')?.focus();}
  }

  function changeZoom(next:number){
    const reader=scroll.current,pages=stack.current;
    if(layout==='continuous'&&reader&&pages&&count&&pages.children.length===count){
      zoomAnchor.current=locateAnchor(pageBoxes(reader,pages),reader.scrollTop);
    }
    setZoom(next);
  }

  useLayoutEffect(()=>{
    recentReader(documentId);
    return ()=>{cancelAnimationFrame(scrollFrame.current);stopRestoring();};
  },[documentId]);

  useLayoutEffect(()=>{
    const reader=scroll.current,pages=stack.current;
    if(!reader||!pages||!count)return;
    const explicit=navigationSeen.current!==navigation.revision;
    const layoutChanged=layoutSeen.current!==layout;
    if(!explicit&&!layoutChanged&&reported.current===current)return;
    navigationSeen.current=navigation.revision;
    layoutSeen.current=layout;
    stopRestoring();
    if(layout==='single'){reported.current=current;return;}
    const position=explicit&&navigation.resume?readProgress(documentId):null;
    const target=position?pageWithin(position.anchorPage,count):current;
    reported.current=position?pageWithin(position.page,count):current;
    startRestoring({anchorPage:target,fraction:position?.fraction??0},reader,pages);
    if(position){if(reported.current!==current)onPage(reported.current);}
    else saveLocation(reader,pages,current);
  },[count,current,documentId,navigation.revision,navigation.resume,layout,saveLocation,startRestoring]);

  useEffect(()=>{
    function flush(){if(scrollFrame.current){cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;readScroll();}}
    window.addEventListener('pagehide',flush);
    return ()=>window.removeEventListener('pagehide',flush);
  });

  useEffect(()=>{
    const reader=scroll.current;
    if(!reader)return;
    const settle=()=>{
      if(!restoring.current)return;
      const target=programmaticScroll.current;
      if(target===null||Math.abs(reader.scrollTop-target)>2)stopRestoring();
    };
    reader.addEventListener('scrollend',settle);
    return ()=>reader.removeEventListener('scrollend',settle);
  },[]);

  useEffect(()=>{
    function dismiss(e:KeyboardEvent) {
      if(e.key!=='Escape'||e.defaultPrevented||e.isComposing||document.querySelector('dialog[open], [aria-modal="true"]')) return;
      setSelectionAction(null);
      if(mode==='crop') { setMode('text'); return; }
      setMode('text');
      const range=window.getSelection();
      if(range?.anchorNode && scroll.current?.contains(range.anchorNode)) range.removeAllRanges();
      onDismiss();
    }
    document.addEventListener('keydown',dismiss);
    return ()=>document.removeEventListener('keydown',dismiss);
  },[mode,onDismiss]);

  useEffect(()=>{
    if(!count||error)return;
    function navigateByKeyboard(event:KeyboardEvent){
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
      if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      const target=event.target;
      if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,[role="textbox"],[role="slider"],[role="menu"]')))return;
      if(document.querySelector('dialog[open], [aria-modal="true"]'))return;
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){
        const reader=scroll.current;
        if(!reader||(target!==document.body&&target!==document.documentElement))return;
        event.preventDefault();
        stopRestoring();
        reader.scrollTop+=event.key==='ArrowDown'?48:-48;
        return;
      }
      const next=pageWithin(current+(event.key==='ArrowLeft'?-1:1),count);
      if(next===current)return;
      event.preventDefault();
      goToPage(next);
    }
    document.addEventListener('keydown',navigateByKeyboard);
    return ()=>document.removeEventListener('keydown',navigateByKeyboard);
  });

  useEffect(() => {
    let stopped = false; const abort = new AbortController(); let document: PdfDocument|undefined;
    // The external document changes here; reset its asynchronous loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy(true); setError(''); setCount(0); setPdf(null); setDeck(null); reported.current=0;
    setPageRatio(kind==='pdf'?1/Math.SQRT2:16/9);
    (async () => {
      const response = await fetch(url,{signal:abort.signal});
      if (!response.ok) throw new Error(`读取文件失败（${response.status}）`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (kind === 'pdf') {
        const lib = await import('pdfjs-dist');
        lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        document = await lib.getDocument({data:bytes, isEvalSupported:false,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'}).promise;
        if (stopped) { await document.destroy(); return; }
        // The first page sets the shell ratio before canvases arrive. A4
        // portrait is 0.707, not 1.414; guessing landscape made every shell
        // half height and pulled early restores to the wrong anchor.
        try {
          const first=await document.getPage(1);
          const viewport=first.getViewport({scale:1});
          if(!stopped&&viewport.height>0)setPageRatio(viewport.width/viewport.height);
        } catch { /* Per-page render still sets the real ratio. */ }
        if (stopped) { await document.destroy(); return; }
        setPdf(document);setCount(document.numPages);setBusy(false);
      } else {
        const lib = await import('@office-kit/pptx');
        const pres = await lib.loadPresentation(bytes), slides = lib.getSlides(pres);
        if (!slides.length) throw new Error('这份 PPTX 没有可显示的幻灯片');
        if (!stopped) {setDeck({pres,slides});setCount(slides.length);setBusy(false);}
      }
    })().catch(e=>{if(!stopped) {const message=e instanceof Error?e.message:'';setError(message&&!/failed to fetch|networkerror|load failed/i.test(message)?message:'无法读取文件，请检查网络后重新加载。');setBusy(false);}});
    return () => { stopped=true;abort.abort();void document?.destroy(); };
  },[url,kind,revision]);


  useLayoutEffect(()=>{
    if(!pdf&&!deck)return;
    lookupRef.current={count,getLocation:()=>{
      const reader=scroll.current,pages=stack.current;
      const live=layout==='continuous'&&reader&&pages&&count&&pages.children.length===count
        ?locateAnchor(pageBoxes(reader,pages),reader.scrollTop)
        :{anchorPage:current,fraction:0};
      return {page:current,scrollTop:reader?.scrollTop??0,anchorPage:live.anchorPage,fraction:live.fraction,layout,zoom};
    },restoreLocation:location=>{
      pendingRestore.current=location;
      setTextReading(false);
      setLayout(location.layout);setZoom(location.zoom);
      const target=pageWithin(location.page,count||1);
      reported.current=target;onPage(target);
      setRestoreToken(token=>token+1);
    },read:async(n,includeImage=true)=>{
      if(!pdf&&!deck)throw Error('课件正在加载，请稍后重试。');
      if(n<1||n>count)throw Error(`讲义共 ${count} 页，找不到第 ${n} 页。`);
      let image:string|undefined,content:string;
      if(pdf){const p=await pdf.getPage(n);const data=await p.getTextContent();content=data.items.map(item=>'str' in item?item.str:'').join(' ');
        if(!includeImage)return {page:n,text:content.slice(0,4500)};
        const viewport=p.getViewport({scale:Math.min(1.5,1200/p.getViewport({scale:1}).width)});const c=document.createElement('canvas');c.width=viewport.width;c.height=viewport.height;await p.render({canvas:c,viewport}).promise;image=c.toDataURL('image/jpeg',.75);
      }else{const {renderSlideToSvg}=await import('@office-kit/pptx-preview');const markup=await safeSvg(renderSlideToSvg(deck!.pres,deck!.slides[n-1],{textLayout:'svg',eastAsianFamily:'sans-serif'}));content=Array.from(new DOMParser().parseFromString(markup,'image/svg+xml').querySelectorAll('text'),t=>t.textContent).join(' ');if(includeImage)image='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);}
      return {page:n,text:content.slice(0,4500),image};
    }};
    onReady?.();
    return ()=>{lookupRef.current=null};
  },[pdf,deck,count,lookupRef,documentId,current,layout,zoom,onPage,onReady,saveLocation]);

  useLayoutEffect(()=>{
    const location=pendingRestore.current;
    if(!location)return;
    pendingRestore.current=null;
    const reader=scroll.current,pages=stack.current;
    if(!reader||!pages)return;
    stopRestoring();
    if(location.layout==='continuous'&&count&&pages.children.length===count){
      startRestoring({anchorPage:location.anchorPage,fraction:location.fraction},reader,pages);
    }else{
      reader.scrollTop=Math.max(0,location.scrollTop);
    }
    // Persist the returned anchor so a later resume (no page param) does not
    // fall back to the page top written during the temporary navigation.
    if(!navigation.temporary){
      saveProgress(documentId,{
        page:pageWithin(location.page,count||1),
        anchorPage:pageWithin(location.anchorPage,count||1),
        fraction:Math.max(0,Math.min(1,location.fraction)),
      });
    }
  },[restoreToken,count,layout,startRestoring,documentId,navigation.temporary]);

  useLayoutEffect(()=>{
    if(!alignAfterText.current)return;
    alignAfterText.current=false;
    if(textReading||layout!=='continuous')return;
    const reader=scroll.current,pages=stack.current;
    if(!reader||!pages||!count||pages.children.length!==count)return;
    startRestoring({anchorPage:current,fraction:0},reader,pages);
  },[textReading,layout,current,count,startRestoring]);

  useLayoutEffect(()=>{
    const anchor=zoomAnchor.current;
    if(!anchor)return;
    zoomAnchor.current=null;
    const reader=scroll.current,pages=stack.current;
    if(!reader||!pages||!count||pages.children.length!==count)return;
    startRestoring(anchor,reader,pages);
  },[zoom,count,startRestoring]);


  const visiblePages=layout==='single'?[current]:Array.from({length:count},(_,index)=>index+1);
  const thumbnailPages=Array.from({length:count},(_,index)=>index+1).slice(Math.max(0,current-3),Math.min(count,current+2));
  const textMode=textReading&&!!pdf&&kind==='pdf';

  // Give the document enough trailing desk that the last pages can still be
  // aligned to the top after an explicit jump, instead of stopping short.
  useEffect(()=>{
    if(layout!=='continuous'||!count||textMode)return;
    const reader=scroll.current,pages=stack.current;
    if(!reader||!pages)return;
    const sync=()=>{
      const last=pages.lastElementChild as HTMLElement|null;
      if(!last)return;
      const needed=Math.max(0,Math.round(reader.clientHeight-last.getBoundingClientRect().height));
      const value=needed?`${needed}px`:'';
      if(pages.style.paddingBottom!==value)pages.style.paddingBottom=value;
    };
    sync();
    const observer=new ResizeObserver(sync);
    observer.observe(reader);
    observer.observe(pages);
    return ()=>observer.disconnect();
  },[layout,count,textMode,zoom]);
  useLayoutEffect(()=>{
    const tools=selectionTools.current;
    const viewport=scroll.current;
    const root=tools?.parentElement;
    const bounds=selectionAction?.rect;
    const page=stack.current?.querySelector<HTMLElement>(`[data-page="${selectionAction?.page}"]`);
    if(!tools||!viewport||!root||!page||!bounds)return;
    const position=()=>{
      const parent=root.getBoundingClientRect();
      const visible=viewport.getBoundingClientRect();
      const sheet=page.getBoundingClientRect();
      const y=sheet.top+(bounds[1]+bounds[3])*sheet.height;
      const before=sheet.top+bounds[1]*sheet.height-tools.offsetHeight-8;
      const desired=y+tools.offsetHeight+8<=visible.bottom?y+8:before;
      tools.style.top=Math.max(visible.top+4,Math.min(desired,visible.bottom-tools.offsetHeight-4))-parent.top+'px';
      const x=sheet.left+bounds[0]*sheet.width-parent.left;
      tools.style.left=Math.max(6,Math.min(x,parent.width-tools.offsetWidth-6))+'px';
    };
    position();
    const observer=new ResizeObserver(position);
    observer.observe(viewport);
    viewport.addEventListener('scroll',position,{passive:true});
    return ()=>{observer.disconnect();viewport.removeEventListener('scroll',position);};
  },[selectionAction]);

  return <section className="document-reader" aria-label={t("文档阅读器")}>
    {selectionAction&&<div ref={selectionTools} className="reader-selection-actions" role="group" aria-label={t("选区操作")}><span title={selectionAction.text||t("已框选图片")}>{t("{0} · 第 {1} 页", { 0: selectionAction.text||t('图表选区'), 1: selectionAction.page })}</span><button type="button" onClick={()=>{onSelect(selectionAction,'ask');setSelectionAction(null)}}>{t("提问")}</button><button type="button" onClick={()=>{onSelect(selectionAction,'add');setSelectionAction(null)}}>{t("加入当前问题")}</button>{selectionAction.text&&<button type="button" onClick={()=>{onSelect(selectionAction,'save');setSelectionAction(null)}}>{t("存为摘录")}</button>}<button type="button" aria-label={t("取消选区操作")} onClick={()=>setSelectionAction(null)}>{t("取消")}</button></div>}
    <div className="reader-toolbar">
      <div className="reader-pager"><button aria-label={t("上一页")} disabled={current<=1 || !count} onClick={()=>goToPage(current-1)}><ChevronLeft size={17}/></button>
      <form className="reader-jump" onSubmit={e=>{
        e.preventDefault();const input=e.currentTarget.elements.namedItem('page') as HTMLInputElement;
        const raw=input.value.trim();
        if(!count||!/^\d+$/.test(raw)){input.value=String(current);return;}
        const target=pageWithin(Number(raw),count);
        input.value=String(target);goToPage(target);
      }}>
        <label>{t("第 ")}<input key={current} name="page" aria-label={t("目标页码")} inputMode="numeric" pattern="[0-9]*" maxLength={9} defaultValue={current} disabled={!count} onFocus={e=>e.currentTarget.select()}/></label>
        <span>{t("/ {0} 页", { 0: count || '—' })}</span>
        <button type="submit" disabled={!count}>{t("跳转")}</button>
      </form>
      <button aria-label={t("下一页")} disabled={current>=count} onClick={()=>goToPage(current+1)}><ChevronRight size={17}/></button></div>
      {kind==='pdf'&&<div className="reader-quick"><button type="button" className="reader-text-toggle" aria-pressed={textReading} aria-label={t("文字阅读")} onClick={()=>{if(textReading){alignAfterText.current=true;setTextReading(false);}else{stopRestoring();setTextReading(true);scroll.current?.scrollTo({top:0});}}}><AlignLeft size={16}/>{t("文字阅读")}</button></div>}
      <details ref={toolsMenu} className="reader-tools">
        <summary aria-label={t("更多阅读工具")}>{t("工具")}</summary>
        <div className="reader-tools-body">
          <details ref={thumbnailsMenu} className="reader-thumbnails" onToggle={event=>setThumbnailsOpen(event.currentTarget.open)}><summary aria-label={t("打开页面缩略图")}>{t("缩略图")}</summary><div role="listbox" aria-label={t("选择页面")}>{thumbnailsOpen&&thumbnailPages.map(number=><button type="button" role="option" aria-selected={current===number} key={number} value={number} onClick={chooseThumbnail}><span>{t("第 {0} 页", { 0: number })}</span><div className="reader-thumbnail"><ContinuousPage current={number} pdf={pdf} deck={deck} kind={kind} zoom={1} defaultRatio={pageRatio} mode="text" onSelect={()=>{}} onCrop={()=>false} onCropStart={()=>''} onCropState={()=>{}} feedback={null} priority focusRect={undefined}/></div></button>)}</div></details>
          {annotations.some(item=>item.page===current)&&<details className="reader-annotation-list"><summary>{t("本页批注 · {0}", { 0: annotations.filter(item=>item.page===current).length })}</summary><div>{annotations.filter(item=>item.page===current).map(item=><button type="button" key={item.id} onClick={()=>onOpenAnnotation?.(item.id,item.page)}>{item.label}</button>)}</div></details>}
          <div className="reader-mode"><button aria-pressed={mode==='text'} onClick={()=>setMode('text')}><TextSelect size={16}/>{t("选文字")}</button>
          <button aria-pressed={mode==='crop'} onClick={()=>setMode('crop')}><Scan size={16}/>{t("框选图片")}</button>
          </div>
          <details className="reader-display" onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
          <summary>{t("显示")}</summary><div>
          <button aria-pressed={layout==='continuous'} onClick={()=>setLayout('continuous')}>{t("连续")}</button>
          <button aria-pressed={layout==='single'} onClick={()=>setLayout('single')}>{t("单页")}</button>
          <button type="button" aria-label={t("适应宽度")} onClick={()=>changeZoom(1)}>{t("适应")}</button>
          <button aria-label={t("缩小")} disabled={zoom<=0.75} onClick={()=>changeZoom(Math.max(.75,zoom-.25))}><ZoomOut size={17}/></button>
          <button aria-label={t("放大")} disabled={zoom>=3} onClick={()=>changeZoom(Math.min(3,zoom+.25))}><ZoomIn size={17}/></button></div>
          </details>
        </div>
      </details>
    </div>
    {error && <div className="reader-error" role="alert">{t(error)} <button onClick={()=>setRevision(r=>r+1)}>{t("重新加载")}</button></div>}
    <div className="reader-scroll" data-layout={layout} ref={scroll} tabIndex={0} role="region" aria-label={t("讲义页面")} onScroll={syncScroll} onWheel={stopRestoring} onTouchStart={stopRestoring} onPointerDown={stopRestoring}
      onKeyDown={event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))stopRestoring();}}>
      {!count&&busy && <div role="status" className="reader-loading">{t("正在解析文档…")}</div>}
      {textMode
        ? <TextReading pdf={pdf!} page={current} count={count} onExit={()=>{alignAfterText.current=true;setTextReading(false);}}/>
        : <div ref={stack} className="reader-page-stack">{visiblePages.map(pageNumber=><div className="reader-annotated-page" key={pageNumber}><ContinuousPage current={pageNumber} pdf={pdf} deck={deck}
        kind={kind} zoom={zoom} defaultRatio={pageRatio} mode={mode} onSelect={queueSelection} onCrop={selection=>{
          const added=onCrop(selection);
          setCropFeedback({message:added?`已加入问题草稿 · 第 ${selection.page} 页`:'引用已满，请在提问框删除后再添加',rect:selection.rect??[],page:selection.page});
          if(feedbackTimer.current!==null)window.clearTimeout(feedbackTimer.current);
          feedbackTimer.current=window.setTimeout(()=>setCropFeedback(null),2400);
          return added;
        }} onCropStart={onCropStart} onCropState={onCropState} feedback={cropFeedback?.page===pageNumber?cropFeedback:null}
        priority={Math.abs(pageNumber-current)<=1}
        focusRect={(focusPage??current)===pageNumber?focusRect:undefined}
        annotations={annotations.filter(item=>item.page===pageNumber)} onOpenAnnotation={onOpenAnnotation}/></div>)}</div>}
    </div>
    {count>0&&<div className="reader-pagination">
      <span aria-hidden="true">1</span>
      <input type="range" aria-label={t("拖动跳页")} aria-valuetext={t("第 {0} 页，共 {1} 页", { 0: current, 1: count })} min={1} max={count} step={1} value={current} disabled={count===1} onChange={e=>goToPage(e.currentTarget.valueAsNumber)}/>
      <span aria-hidden="true">{count}</span>
    </div>}
    <p className="reader-hint">{textMode?t("文字阅读来自 PDF 文本层，查看原文图像可回到版式与图表。"):mode==='crop'?t("拖动框选图表，按 Esc 取消选区。"):t("划选文字开始讨论，按 Esc 取消选区。")}{kind==='pptx'?t(" PPTX 为静态预览，复杂版式建议使用 PDF。"):''}</p>
  </section>;
}

type ContinuousPageProps=Pick<Props,'kind'|'onSelect'|'focusRect'|'annotations'|'onOpenAnnotation'> & {
  onCrop:(selection:ReaderSelection)=>boolean;onCropStart:()=>string;onCropState:(pending:boolean,captureId:string)=>void;feedback:{message:string;rect:number[];page:number}|null;
  current:number;zoom:number;mode:'text'|'crop';pdf:PdfDocument|null;deck:Deck|null;priority:boolean;defaultRatio:number;
};

function ContinuousPage({current,zoom,mode,kind,pdf,deck,priority,defaultRatio,onSelect,onCrop,onCropStart,onCropState,feedback,focusRect,annotations=[],onOpenAnnotation}:ContinuousPageProps){
  const { t } = useLocale();
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  const [hasText,setHasText]=useState(kind!=='pdf'),[attempt,setAttempt]=useState(0);
  const [ratio,setRatio]=useState(defaultRatio);
  const [visible,setVisible]=useState(false);
  const nearby=priority||visible;
  const renderState=pageRenderState({busy,error,hasText});
  const [drag,setDrag]=useState<Rect|null>(null);
  const surface=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  const start=useRef<number[]|null>(null),svg=useRef(''),rendered=useRef(0);
  const selectionFrame=useRef(0);
  const marginAnchor=useRef<TextCaret|undefined>(undefined);
  const cropId=useRef<string|null>(null);
  const gesture=useRef(0),cancelled=useRef(false);
  useEffect(()=>{
    const element=surface.current;
    if(!element)return;
    const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),
      {root:element.closest('.reader-scroll'),rootMargin:'240px 0px'});
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(mode==='crop')return;
    gesture.current++;cancelled.current=true;start.current=null;
    if(cropId.current){onCropState(false,cropId.current);cropId.current=null;}
  },[mode,onCropState]);
  useEffect(()=>{
    function cancelGesture(event:KeyboardEvent){
      if(event.key!=='Escape'||!start.current)return;
      start.current=null;setDrag(null);
      if(cropId.current){onCropState(false,cropId.current);cropId.current=null;}
    }
    document.addEventListener('keydown',cancelGesture);
    return ()=>{
      document.removeEventListener('keydown',cancelGesture);
      cancelAnimationFrame(selectionFrame.current);
      if(cropId.current){onCropState(false,cropId.current);cropId.current=null;}
    };
  },[onCropState]);
  useEffect(()=> {
    if(!nearby||!surface.current) return;
    const resize = new ResizeObserver(()=> {
      if(kind==='pdf' && text.current && canvas.current?.width) {
        const scale=surface.current!.getBoundingClientRect().width/canvas.current.width*1.5;
        text.current.style.setProperty('--total-scale-factor',String(scale));
      }
    });
    resize.observe(surface.current);return ()=>resize.disconnect();
  },[kind,pdf,current,nearby]);

  useEffect(()=> {
    if(!nearby||(!pdf&&!deck))return;
    let stopped=false; let task: {cancel:()=>void}|undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset status for this external renderer task.
    setBusy(true); setError(''); setHasText(kind!=='pdf'); rendered.current=0; setDrag(null);
    const layer=text.current;
    if(layer)layer.replaceChildren();
    (async()=> {
      if(pdf) {
        const lib = await import('pdfjs-dist'), p = await pdf.getPage(current);
        const viewport = p.getViewport({scale:1.5});
        if(!stopped)setRatio(viewport.width/viewport.height);
        const buffer = document.createElement('canvas'); buffer.width=viewport.width;buffer.height=viewport.height;
        const render = p.render({canvas:buffer,viewport});task=render;
        await render.promise;
        const content = await p.getTextContent();
        if(stopped || !canvas.current || !layer) return;
        canvas.current.width=buffer.width;canvas.current.height=buffer.height;
        canvas.current.getContext('2d')!.drawImage(buffer,0,0);
        const temporary=document.createElement('div');
        temporary.style.setProperty('--scale-factor','1.5');
        temporary.style.setProperty('--total-scale-factor','1.5');
        const tl = new lib.TextLayer({textContentSource:content,container:temporary,viewport});
        await tl.render();
        if(stopped) {tl.cancel();return;}
        layer.replaceChildren(...temporary.childNodes);layer.style.cssText=temporary.style.cssText;layer.style.width='100%';layer.style.height='100%';
        layer.style.setProperty('--total-scale-factor',String(surface.current!.getBoundingClientRect().width/buffer.width*1.5));
        if(!stopped)setHasText(content.items.some(item=>'str' in item&&item.str.trim().length>0));
        svg.current='';
      } else if(deck && layer) {
        const {renderSlideToSvg} = await import('@office-kit/pptx-preview');
        const markup = await safeSvg(renderSlideToSvg(deck.pres,deck.slides[current-1],{textLayout:'svg',eastAsianFamily:'sans-serif'}));
        if(stopped) return;
        layer.innerHTML=markup;
        const element = layer.querySelector('svg')!;
        const view = element.viewBox.baseVal;
        const width=view.width||Number(element.getAttribute('width'));
        const height=view.height||Number(element.getAttribute('height'));
        if(width>0&&height>0)setRatio(width/height);
        addSlideTextLayer(layer);
        svg.current=markup;
      }
      if(!stopped) {rendered.current=current;setBusy(false);}
    })().catch(e=> {if(!stopped){setError(e instanceof Error?e.message:'页面渲染失败');setBusy(false);}});
    return ()=>{stopped=true;task?.cancel();};
  },[pdf,deck,current,nearby,attempt,kind]);

  async function crop(rect:Rect,captureId:string) {
    const token=gesture.current;
    try {
      if(rendered.current!==current) return;
      const selectedPage=current; let source: CanvasImageSource; let width:number,height:number;
      if(kind==='pdf') {source=canvas.current!;width=canvas.current!.width;height=canvas.current!.height;}
      else {
        const image=new Image(), object=URL.createObjectURL(new Blob([svg.current],{type:'image/svg+xml'}));
        try { image.src=object;await image.decode(); } finally { URL.revokeObjectURL(object); }
        width=image.naturalWidth;height=image.naturalHeight;source=image;
      }
      const [x,y,w,h]=pixelRect(rect,width,height);
      if(w<12||h<12){setError('选区太小，请重新框选更大的区域。');return;}
      const output=document.createElement('canvas');
      output.width=w;output.height=h;output.getContext('2d')!.drawImage(source,x,y,w,h,0,0,w,h);
      if(token===gesture.current) onCrop({page:selectedPage,image:output.toDataURL('image/png'),rect,captureId});
    } catch {setError('选区图片生成失败，请重新框选或将文档导出为 PDF 后重试。');}
    finally {onCropState(false,captureId);}
  }

  const highlight=(mode==='crop'?drag:null)??focusRect;
  return <div ref={surface} data-page={current} className={`reader-page ${kind==='pdf'?'reader-pdf':'reader-pptx'} ${mode==='crop'?'reader-cropping':''}`} style={{width:`${zoom*100}%`,aspectRatio:ratio}}
        onPointerDown={event=>{
          cancelAnimationFrame(selectionFrame.current);
          marginAnchor.current=undefined;
          cancelled.current=false;gesture.current++;
          if(!nearby||busy||error)return;
          if(mode==='crop'){
            cropId.current=onCropStart();onCropState(true,cropId.current);
            start.current=[event.clientX,event.clientY];
            event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
          }else if(text.current&&event.pointerType==='mouse'&&event.button===0&&!event.shiftKey){
            marginAnchor.current=textMarginCaret(text.current,event.target,event.clientX,event.clientY);
          }
        }}
        onPointerMove={e=>{if(start.current) setDrag(normalizedRect(start.current,[e.clientX,e.clientY],e.currentTarget.getBoundingClientRect()));}}
        onMouseMove={event=>{
          if(mode!=='text'||busy||error||event.buttons!==1)return;
          cancelAnimationFrame(selectionFrame.current);
          const {target,clientX,clientY}=event;
          // Chromium updates the native range after mousemove handlers run.
          selectionFrame.current=requestAnimationFrame(()=>{
            const selected=window.getSelection();
            if(selected&&text.current)snapTextSelection(selected,text.current,target,clientX,clientY,marginAnchor.current);
          });
        }}
        onPointerCancel={()=>{cancelAnimationFrame(selectionFrame.current);marginAnchor.current=undefined;if(cropId.current)onCropState(false,cropId.current);cropId.current=null;start.current=null;setDrag(null);}}
        onPointerUp={e=>{
          cancelAnimationFrame(selectionFrame.current);
          const anchor=marginAnchor.current;
          marginAnchor.current=undefined;
          if(cancelled.current){window.getSelection()?.removeAllRanges();return;}
          if(start.current) {const rect=normalizedRect(start.current,[e.clientX,e.clientY],e.currentTarget.getBoundingClientRect());const captureId=cropId.current;start.current=null;cropId.current=null;setDrag(null);if(rect&&captureId) void crop(rect,captureId);else if(captureId)onCropState(false,captureId);return;}
          if(mode!=='text'||busy||error||!nearby)return;
          const selected=window.getSelection();if(!selected?.rangeCount||selected.isCollapsed)return;
          if(e.pointerType==='mouse'&&e.button===0&&!e.shiftKey&&text.current)snapTextSelection(selected,text.current,e.target,e.clientX,e.clientY,anchor);
          if(selected.isCollapsed)return;
          const range=selected.getRangeAt(0);if(!surface.current?.contains(range.commonAncestorContainer))return;
          const value=selected.toString().trim();if(!value)return;
          onSelect({page:current,text:value});selected.removeAllRanges();
        }}>
        {nearby&&<>
          <canvas ref={canvas} hidden={kind!=='pdf'||busy}/>
          <div ref={text} className={kind==='pdf'?'textLayer':'slideLayer'} style={{visibility:busy?'hidden':'visible'}}/>
        </>}
        {nearby&&renderState==='loading'&&<div className="reader-page-status" role="status">{t("正在渲染第 {0} 页…", { 0: current })}</div>}
        {nearby&&renderState==='empty-text'&&<div className="reader-page-status is-empty" role="status">{t("本页没有可选择的文字，可用文字阅读或框选图片。")}</div>}
        {error&&nearby&&<div className="reader-error" role="alert" title={error}>{/[一-鿿]/.test(error)?t(error):t("第 {0} 页渲染失败，请重试。", { 0: current })}<button type="button" onClick={()=>setAttempt(n=>n+1)}>{t("重试")}</button></div>}
        {(highlight&&annotationsVisible(renderState)) && <div className="reader-highlight" style={{left:`${highlight[0]*100}%`,top:`${highlight[1]*100}%`,width:`${highlight[2]*100}%`,height:`${highlight[3]*100}%`}}/>}
        {feedback&&<div className="reader-crop-feedback" role="status" aria-live="polite" style={{left:`${Math.min(72,Math.max(4,feedback.rect[0]*100))}%`,top:`${Math.min(82,Math.max(4,(feedback.rect[1]+feedback.rect[3])*100+2))}%`}}>{t(feedback.message)}</div>}
        {annotationsVisible(renderState)&&annotations.map((annotation,index)=><button type="button" className="reader-page-annotation" key={annotation.id} title={annotation.label} style={annotation.rect?{left:`${annotation.rect[0]*100}%`,top:`${annotation.rect[1]*100}%`}:{right:8,top:8+index*38}} onClick={()=>onOpenAnnotation?.(annotation.id,annotation.page)}>{annotation.label}</button>)}
      </div>;
}

function TextReading({pdf,page,count,onExit}:{pdf:PdfDocument;page:number;count:number;onExit:()=>void}){
  const { t } = useLocale();
  const [state,setState]=useState<{status:'loading'|'error'|'ready';text:string;error:string}>({status:'loading',text:'',error:''});
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let stopped=false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset status for this page's text extraction.
    setState({status:'loading',text:'',error:''});
    (async()=>{
      const p=await pdf.getPage(page);
      const content=await p.getTextContent();
      if(stopped)return;
      setState({status:'ready',text:layoutPdfText(content.items as PdfTextItem[]),error:''});
    })().catch((e:unknown)=>{if(!stopped)setState({status:'error',text:'',error:e instanceof Error?e.message:'无法读取本页文字'});});
    return ()=>{stopped=true;};
  },[pdf,page,attempt]);
  const sparse=state.status==='ready'&&isSparseText(state.text);
  return <div className="reader-text-reading" role="region" aria-label={t("第 {0} 页文字阅读", { 0: page })}>
    <div className="reader-text-heading">
      <span>{t("第 {0} 页 · 文字阅读", { 0: page })}</span>
      <span className="reader-text-total">{t("共 {0} 页", { 0: count })}</span>
      <button type="button" onClick={onExit}>{t("查看原文图像")}</button>
    </div>
    {state.status==='loading'&&<div className="reader-text-status" role="status">{t("正在读取第 {0} 页文字…", { 0: page })}</div>}
    {state.status==='error'&&<div className="reader-text-status is-error" role="alert">{t(state.error)}<button type="button" onClick={()=>setAttempt(n=>n+1)}>{t("重试")}</button><button type="button" onClick={onExit}>{t("查看原文图像")}</button></div>}
    {state.status==='ready'&&(sparse
      ? <div className="reader-text-status" role="status">{t("本页没有足够的可提取文字（可能是扫描页或纯图表）。")}<button type="button" onClick={onExit}>{t("查看原文图像")}</button></div>
      : <div className="reader-text-body">{state.text}</div>)}
  </div>;
}
