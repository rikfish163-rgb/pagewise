'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Scan, TextSelect, ZoomIn, ZoomOut } from 'lucide-react';
import { normalizedRect, pixelRect, pageWithin, type Rect } from './reader-geometry';
import 'pdfjs-dist/web/pdf_viewer.css';
import './reader.css';
import {readProgress,recentReader,saveProgress,type ReadingProgress} from './reading-progress';

export type ReaderSelection = { page: number; text?: string; image?: string; rect?: number[]; captureId?:string };
export type ReaderAnnotation = {id:string;page:number;label:string;rect?:number[]};
export type Props = { documentId:string; navigation:{resume:boolean;revision:number}; lookup: React.RefObject<import('./study-context').PageReader|null>; url: string; kind: 'pdf'|'pptx'; page: number; onSelect: (s:ReaderSelection,action?:'ask'|'add'|'save')=>void; onCrop: (s:ReaderSelection)=>boolean; onCropStart:()=>string; onCropState:(pending:boolean,captureId:string)=>void; onPage: (page:number)=>void; onDismiss:()=>void; focusRect?: number[]; focusPage?: number; annotations?:ReaderAnnotation[]; onOpenAnnotation?:(id:string,page:number)=>void };
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

export default function Reader({documentId,navigation,lookup:lookupRef,url,kind,page,onPage,onSelect,onCrop,onCropStart,onCropState,onDismiss,focusRect,focusPage,annotations=[],onOpenAnnotation}: Props) {
  const [pdf, setPdf] = useState<PdfDocument|null>(null);
  const [deck, setDeck] = useState<Deck|null>(null);
  const [count,setCount] = useState(0), [busy,setBusy] = useState(true), [error,setError] = useState('');
  const [zoom,setZoom] = useState(1), [mode,setMode] = useState<'text'|'crop'>('text');
  const [layout,setLayout]=useState<'continuous'|'single'>(kind==='pptx'?'single':'continuous');
  const [selectionAction,setSelectionAction]=useState<ReaderSelection|null>(null);
  const queueSelection=(selection:ReaderSelection)=>setSelectionAction(selection);
  const [cropFeedback,setCropFeedback]=useState<{message:string;rect:number[];page:number}|null>(null);
  const feedbackTimer=useRef<number|null>(null);
  useEffect(()=>()=>{if(feedbackTimer.current!==null)window.clearTimeout(feedbackTimer.current);},[]);
  const [revision,setRevision] = useState(0);
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

  function jump(reader:HTMLDivElement,pages:HTMLDivElement,targetPage:number,fraction=0){
    const anchor=pages.children[targetPage-1] as HTMLElement|undefined;
    const first=pages.children[0] as HTMLElement|undefined;
    if(!first||!anchor)return;
    const next=pages.children[targetPage] as HTMLElement|undefined;
    const span=next?next.offsetTop-anchor.offsetTop:anchor.offsetHeight;
    reader.scrollTop=anchor.offsetTop-first.offsetTop+fraction*span;
    programmaticScroll.current=reader.scrollTop;
  }

  const saveLocation=useCallback((reader:HTMLDivElement,pages:HTMLDivElement,visiblePage:number)=>{
    const first=(pages.children[0] as HTMLElement).offsetTop;
    let low=0,high=pages.children.length-1;
    while(low<high){
      const mid=Math.ceil((low+high)/2);
      if((pages.children[mid] as HTMLElement).offsetTop-first<=reader.scrollTop)low=mid;
      else high=mid-1;
    }
    const anchor=pages.children[low] as HTMLElement;
    const next=pages.children[low+1] as HTMLElement|undefined;
    const span=next?next.offsetTop-anchor.offsetTop:anchor.offsetHeight;
    const offset=reader.scrollTop-(anchor.offsetTop-first);
    saveProgress(documentId,{page:visiblePage,anchorPage:low+1,fraction:Math.max(0,Math.min(1,offset/Math.max(1,span)))});
  },[documentId]);

  function readScroll(){
    const reader=scroll.current,pages=stack.current;
    if(layout==='single'||!reader||!pages||!count||pages.children.length!==count||restoring.current||reader.scrollTop===programmaticScroll.current)return;
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
    if(layout==='continuous'&&reader&&pages){
      jump(reader,pages,next);
      saveLocation(reader,pages,next);
    }
    reported.current=next;
    onPage(next);
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
    reported.current=current;
    if(position){
      restoring.current=position;
      const restore=()=>{
        const saved=restoring.current;
        if(saved)jump(reader,pages,pageWithin(saved.anchorPage,count),saved.fraction);
      };
      restore();
      // The page shells resize when PDF canvases and slides acquire their actual dimensions.
      observer.current=new ResizeObserver(restore);
      observer.current.observe(pages);
      const anchor=pages.children[pageWithin(position.anchorPage,count)-1];
      if(anchor)observer.current.observe(anchor);
    }else{
      jump(reader,pages,current);
      saveLocation(reader,pages,current);
    }
  },[count,current,documentId,navigation.revision,navigation.resume,layout,saveLocation]);

  useEffect(()=>{
    function flush(){if(scrollFrame.current){cancelAnimationFrame(scrollFrame.current);scrollFrame.current=0;readScroll();}}
    window.addEventListener('pagehide',flush);
    return ()=>window.removeEventListener('pagehide',flush);
  });

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
    (async () => {
      const response = await fetch(url,{signal:abort.signal});
      if (!response.ok) throw new Error(`读取文件失败（${response.status}）`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (kind === 'pdf') {
        const lib = await import('pdfjs-dist');
        lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        document = await lib.getDocument({data:bytes, isEvalSupported:false,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'}).promise;
        if (stopped) { await document.destroy(); return; }
        setPdf(document);setCount(document.numPages);setBusy(false);
      } else {
        const lib = await import('@office-kit/pptx');
        const pres = await lib.loadPresentation(bytes), slides = lib.getSlides(pres);
        if (!slides.length) throw new Error('这份 PPTX 没有可显示的幻灯片');
        if (!stopped) {setDeck({pres,slides});setCount(slides.length);setBusy(false);}
      }
    })().catch(e=>{if(!stopped) {setError(e instanceof Error?e.message:'无法读取文件');setBusy(false);}});
    return () => { stopped=true;abort.abort();void document?.destroy(); };
  },[url,kind,revision]);


  useLayoutEffect(()=>{
    if(!pdf&&!deck)return;
    lookupRef.current={count,getLocation:()=>{const saved=readProgress(documentId);return {page:current,scrollTop:scroll.current?.scrollTop??0,anchorPage:saved?.anchorPage??current,fraction:saved?.fraction??0,layout}},restoreLocation:location=>{
      setLayout(location.layout);reported.current=location.page;onPage(location.page);
      requestAnimationFrame(()=>{const reader=scroll.current,pages=stack.current;if(!reader||!pages)return;if(location.layout==='continuous'&&pages.children.length===count){jump(reader,pages,pageWithin(location.anchorPage,count),location.fraction);saveLocation(reader,pages,location.page)}else reader.scrollTop=location.scrollTop});
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
    return ()=>{lookupRef.current=null};
  },[pdf,deck,count,lookupRef,documentId,current,layout,onPage,saveLocation]);


  const visiblePages=layout==='single'?[current]:Array.from({length:count},(_,index)=>index+1);
  const thumbnailPages=Array.from({length:count},(_,index)=>index+1).slice(Math.max(0,current-3),Math.min(count,current+2));
  return <section className="document-reader" aria-label="文档阅读器">
    {selectionAction&&<div className="reader-selection-actions" role="group" aria-label="选区操作"><span title={selectionAction.text||'已框选图片'}>{selectionAction.text||'图表选区'} · 第 {selectionAction.page} 页</span><button type="button" onClick={()=>{onSelect(selectionAction,'ask');setSelectionAction(null)}}>提问</button><button type="button" onClick={()=>{onSelect(selectionAction,'add');setSelectionAction(null)}}>加入当前问题</button>{selectionAction.text&&<button type="button" onClick={()=>{onSelect(selectionAction,'save');setSelectionAction(null)}}>存为摘录</button>}<button type="button" aria-label="取消选区操作" onClick={()=>setSelectionAction(null)}>取消</button></div>}
    <div className="reader-toolbar">
      <div><button aria-label="上一页" disabled={current<=1 || !count} onClick={()=>goToPage(current-1)}><ChevronLeft size={17}/></button>
      <form className="reader-jump" onSubmit={e=>{
        e.preventDefault();const input=e.currentTarget.elements.namedItem('page') as HTMLInputElement;
        const raw=input.value.trim();
        if(!count||!/^\d+$/.test(raw)){input.value=String(current);return;}
        const target=pageWithin(Number(raw),count);
        input.value=String(target);goToPage(target);
      }}>
        <label>第 <input key={current} name="page" aria-label="目标页码" inputMode="numeric" pattern="[0-9]*" maxLength={9} defaultValue={current} disabled={!count} onFocus={e=>e.currentTarget.select()}/></label>
        <span>/ {count || '—'} 页</span>
        <button type="submit" disabled={!count}>跳转</button>
      </form>
      <button aria-label="下一页" disabled={current>=count} onClick={()=>goToPage(current+1)}><ChevronRight size={17}/></button></div>
      <details className="reader-thumbnails"><summary aria-label="打开页面缩略图">缩略图</summary><div role="listbox" aria-label="选择页面">{thumbnailPages.map(number=><button type="button" role="option" aria-selected={current===number} key={number} onClick={()=>goToPage(number)}><span>第 {number} 页</span><div className="reader-thumbnail"><ContinuousPage current={number} pdf={pdf} deck={deck} kind={kind} zoom={1} mode="text" onSelect={()=>{}} onCrop={()=>false} onCropStart={()=>''} onCropState={()=>{}} feedback={null} priority focusRect={undefined}/></div></button>)}</div></details>
      <div><button aria-pressed={mode==='text'} onClick={()=>setMode('text')}><TextSelect size={16}/>选文字</button>
      <button aria-pressed={mode==='crop'} onClick={()=>setMode('crop')}><Scan size={16}/>框选图片</button>
      <button aria-pressed={layout==='continuous'} onClick={()=>setLayout('continuous')}>连续</button>
      <button aria-pressed={layout==='single'} onClick={()=>setLayout('single')}>单页</button>
      <button aria-label="缩小" disabled={zoom<=0.75} onClick={()=>setZoom(z=>Math.max(.75,z-.25))}><ZoomOut size={17}/></button>
      <button aria-label="放大" disabled={zoom>=2} onClick={()=>setZoom(z=>Math.min(2,z+.25))}><ZoomIn size={17}/></button></div>
    </div>
    {error && <div className="reader-error" role="alert">{error} <button onClick={()=>setRevision(r=>r+1)}>重新加载</button></div>}
    <div className="reader-scroll" data-layout={layout} ref={scroll} tabIndex={0} role="region" aria-label="讲义页面" onScroll={syncScroll} onWheel={stopRestoring} onTouchStart={stopRestoring} onPointerDown={stopRestoring}
      onKeyDown={event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))stopRestoring();}}>
      {!count&&busy && <div role="status" className="reader-loading">正在解析文档…</div>}
      <div ref={stack} className="reader-page-stack">{visiblePages.map(pageNumber=><div className="reader-annotated-page" key={pageNumber}><ContinuousPage current={pageNumber} pdf={pdf} deck={deck}
        kind={kind} zoom={zoom} mode={mode} onSelect={queueSelection} onCrop={selection=>{
          const added=onCrop(selection);
          setCropFeedback({message:added?`已加入问题草稿 · 第 ${selection.page} 页`:'引用已满，请在提问框删除后再添加',rect:selection.rect??[],page:selection.page});
          if(feedbackTimer.current!==null)window.clearTimeout(feedbackTimer.current);
          feedbackTimer.current=window.setTimeout(()=>setCropFeedback(null),2400);
          return added;
        }} onCropStart={onCropStart} onCropState={onCropState} feedback={cropFeedback?.page===pageNumber?cropFeedback:null}
        priority={Math.abs(pageNumber-current)<=1}
        focusRect={(focusPage??current)===pageNumber?focusRect:undefined}
        annotations={annotations.filter(item=>item.page===pageNumber)} onOpenAnnotation={onOpenAnnotation}/></div>)}</div>
    </div>
    {count>0&&<div className="reader-pagination">
      <span aria-hidden="true">1</span>
      <input type="range" aria-label="拖动跳页" aria-valuetext={`第 ${current} 页，共 ${count} 页`} min={1} max={count} step={1} value={current} disabled={count===1} onChange={e=>goToPage(e.currentTarget.valueAsNumber)}/>
      <span aria-hidden="true">{count}</span>
    </div>}
    <p className="reader-hint">{mode==='crop'?'拖动框选图表，按 Esc 取消选区。':'划选文字开始讨论，按 Esc 取消选区。'}{kind==='pptx'?' PPTX 为静态预览，复杂版式建议使用 PDF。':''}</p>
  </section>;
}

type ContinuousPageProps=Pick<Props,'kind'|'onSelect'|'focusRect'|'annotations'|'onOpenAnnotation'> & {
  onCrop:(selection:ReaderSelection)=>boolean;onCropStart:()=>string;onCropState:(pending:boolean,captureId:string)=>void;feedback:{message:string;rect:number[];page:number}|null;
  current:number;zoom:number;mode:'text'|'crop';pdf:PdfDocument|null;deck:Deck|null;priority:boolean;
};

function ContinuousPage({current,zoom,mode,kind,pdf,deck,priority,onSelect,onCrop,onCropStart,onCropState,feedback,focusRect,annotations=[],onOpenAnnotation}:ContinuousPageProps){
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  const [ratio,setRatio]=useState(kind==='pdf'?1.414:16/9);
  const [visible,setVisible]=useState(false);
  const nearby=priority||visible;
  const [drag,setDrag]=useState<Rect|null>(null);
  const surface=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  const start=useRef<number[]|null>(null),svg=useRef(''),rendered=useRef(0);
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
    setBusy(true); setError(''); rendered.current=0; setDrag(null);
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
  },[pdf,deck,current,nearby]);

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
        onPointerDown={e=>{cancelled.current=false;gesture.current++;if(mode==='crop' && nearby && !busy){cropId.current=onCropStart();onCropState(true,cropId.current);start.current=[e.clientX,e.clientY];e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();}}}
        onPointerMove={e=>{if(start.current) setDrag(normalizedRect(start.current,[e.clientX,e.clientY],e.currentTarget.getBoundingClientRect()));}}
        onPointerCancel={()=>{if(cropId.current)onCropState(false,cropId.current);cropId.current=null;start.current=null;setDrag(null);}}
        onPointerUp={e=>{
          if(cancelled.current){window.getSelection()?.removeAllRanges();return;}
          if(start.current) {const rect=normalizedRect(start.current,[e.clientX,e.clientY],e.currentTarget.getBoundingClientRect());const captureId=cropId.current;start.current=null;cropId.current=null;setDrag(null);if(rect&&captureId) void crop(rect,captureId);else if(captureId)onCropState(false,captureId);return;}
          if(mode!=='text'||busy||!nearby)return;
          const selected=window.getSelection();if(!selected?.rangeCount || selected.isCollapsed)return;
          const range=selected.getRangeAt(0);if(!surface.current?.contains(range.commonAncestorContainer))return;
          const value=selected.toString().trim();if(!value)return;
          onSelect({page:current,text:value});selected.removeAllRanges();
        }}>
        {nearby&&<>
          <canvas ref={canvas} hidden={kind!=='pdf'||busy}/>
          <div ref={text} className={kind==='pdf'?'textLayer':'slideLayer'} style={{visibility:busy?'hidden':'visible'}}/>
        </>}
        {error&&nearby&&<div className="reader-error" role="alert">{error}</div>}
        {(highlight) && <div className="reader-highlight" style={{left:`${highlight[0]*100}%`,top:`${highlight[1]*100}%`,width:`${highlight[2]*100}%`,height:`${highlight[3]*100}%`}}/>}
        {feedback&&<div className="reader-crop-feedback" role="status" aria-live="polite" style={{left:`${Math.min(72,Math.max(4,feedback.rect[0]*100))}%`,top:`${Math.min(82,Math.max(4,(feedback.rect[1]+feedback.rect[3])*100+2))}%`}}>{feedback.message}</div>}
        {annotations.map((annotation,index)=><button type="button" className="reader-page-annotation" key={annotation.id} title={annotation.label} style={annotation.rect?{left:`${annotation.rect[0]*100}%`,top:`${annotation.rect[1]*100}%`}:{right:8,top:8+index*38}} onClick={()=>onOpenAnnotation?.(annotation.id,annotation.page)}>{annotation.label}</button>)}
      </div>;
}
