'use client';
import { useEffect, useRef } from 'react';
import './desk-divider.css';

type Drag={pointer:number; x:number; width:number};

/** Width belongs to the reading desk, not to a document or a discussion. */
export default function DeskDivider({side='right'}:{side?:'left'|'right'}){
  const left=side==='left',minimum=left?144:280;
  const preference=left?'pagewise:library-width':'pagewise:discussion-width',variable=left?'--shelf-width':'--panel-width';
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const handle=ref.current!, desk=handle.parentElement!, panel=desk.querySelector<HTMLElement>(left?'.library':'.margin-panel')!;
    let drag:Drag|null=null;
    const width=()=>Math.round(panel.getBoundingClientRect().width);
    function maximum(){
      const css=getComputedStyle(desk);
      if(left)return Math.max(minimum,Math.min(420,desk.clientWidth-280-parseFloat(css.getPropertyValue('--page-floor'))));
      return Math.max(minimum,desk.clientWidth-(matchMedia('(max-width:950px)').matches?0:desk.querySelector('.library')!.getBoundingClientRect().width)-parseFloat(css.getPropertyValue('--page-floor')));
    }
    function setWidth(px:number){
      desk.style.setProperty(variable,Math.min(maximum(),Math.max(minimum,Math.round(px)))+'px');
    }
    function save(reset=false){
      try{if(reset)localStorage.removeItem(preference);else localStorage.setItem(preference,String(width()));}catch{/* session still works */}
    }
    try {const px=Number(localStorage.getItem(preference));if(Number.isFinite(px)&&px>=minimum)desk.style.setProperty(variable,px+'px');}catch{/* no storage */}
    const observer=new ResizeObserver(()=>{
      if(!handle.getClientRects().length)return;
      handle.setAttribute('aria-valuemax',String(maximum()));
      handle.setAttribute('aria-valuenow',String(width()));
      handle.setAttribute('aria-valuetext',width()+' 像素');
    });observer.observe(panel);observer.observe(desk);
    function down(e:PointerEvent){
      if(!e.isPrimary||e.button!==0)return;
      e.preventDefault();handle.focus({preventScroll:true});handle.setPointerCapture(e.pointerId);
      drag={pointer:e.pointerId,x:e.clientX,width:width()};desk.dataset.resizing='true';
    }
    function move(e:PointerEvent){if(drag?.pointer===e.pointerId)setWidth(drag.width+(e.clientX-drag.x)*(left?1:-1));}
    function end(e:PointerEvent){
      if(drag?.pointer!==e.pointerId)return;
      drag=null;delete desk.dataset.resizing;save();
    }
    function key(e:KeyboardEvent){
      const step=e.shiftKey?64:16;
      const target=e.key==='ArrowLeft'?width()+(left?-step:step):e.key==='ArrowRight'?width()+(left?step:-step):e.key==='Home'?minimum:e.key==='End'?maximum():null;
      if(target===null)return;
      e.preventDefault();setWidth(target);save();
    }
    function reset(){desk.style.removeProperty(variable);save(true);}
    handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('lostpointercapture',end);
    handle.addEventListener('keydown',key);handle.addEventListener('dblclick',reset);
    return ()=>{observer.disconnect();delete desk.dataset.resizing;handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('lostpointercapture',end);handle.removeEventListener('keydown',key);handle.removeEventListener('dblclick',reset);};
  },[left,minimum,preference,variable]);
  return <div ref={ref} role="separator" aria-label={left?"调整资料库和讲义宽度":"调整讲义和讨论栏宽度"} aria-controls={left?"study-library":"discussion-panel"} aria-orientation="vertical" aria-valuemin={minimum} aria-valuenow={left?208:360} tabIndex={0} title="拖动调整列宽，双击恢复默认" className={left?"desk-divider shelf-divider":"desk-divider"}/>;
}
