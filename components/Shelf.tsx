'use client';
import { useLocale } from './LocaleProvider';
import {useState} from 'react';
import type {StudyDoc} from '../lib/workspace-model';
type Change={course?:string;pinned?:boolean;visit?:boolean};
type Props={docs:StudyDoc[];current:string;open:(doc:StudyDoc)=>void;organize:(d:StudyDoc,v:Change)=>void;remove:(d:StudyDoc)=>void;move:(d:StudyDoc)=>void;drop:(f:File,course?:string)=>void};
export default function Shelf({docs,current,open,organize,remove,move,drop}:Props){
  const { t } = useLocale();
 const [view,setView]=useState('recent'),[menu,setMenu]=useState('');
 const sorted=[...docs].sort((a,b)=>(b.visited||0)-(a.visited||0));
 const groups:{name:string;docs:StudyDoc[];project?:boolean}[]=[];
 if(sorted.some(d=>d.pinned))groups.push({name:'已置顶',docs:sorted.filter(d=>d.pinned)});
 if(view==='recent')groups.push({name:'最近访问',docs:sorted.filter(d=>!d.pinned)});
 else for(const course of new Set(sorted.map(d=>d.course)))groups.push({name:course,docs:sorted.filter(d=>d.course===course),project:true});
 function receive(e:React.DragEvent,course?:string){e.preventDefault();e.stopPropagation();const f=e.dataTransfer.files[0];if(f){drop(f,course);return}const d=docs.find(d=>d.id===e.dataTransfer.getData('text/x-pagewise'));if(d&&course)organize(d,{course});}
 return <div className="shelf-content" onDragOver={e=>e.preventDefault()} onDrop={e=>receive(e)}><div className="shelf-views">{[['recent','最近'],['projects','项目']].map(([id,label])=><button aria-pressed={id===view} key={id} onClick={()=>setView(id)}>{t(label)}</button>)}</div>{groups.map(g=><section className="shelf-group" key={g.name+String(g.project)} onDragOver={e=>e.preventDefault()} onDrop={e=>receive(e,g.project?g.name:undefined)}><h2>{g.project ? g.name : t(g.name)}</h2>{g.docs.map(d=><div key={d.id}><div className={'shelf-row '+(d.id===current?'current':'')} draggable={d.id!=='sample'} onDragStart={e=>e.dataTransfer.setData('text/x-pagewise',d.id)}><button onClick={()=>open(d)} title={d.name}>{d.name}</button>{d.id!=='sample'&&<button aria-label={t("整理 ")+d.name} onClick={()=>{setMenu(menu===d.id?'':d.id)}}>···</button>}</div>{menu===d.id&&<div className="shelf-menu"><button onClick={()=>{organize(d,{pinned:!d.pinned});setMenu('')}}>{d.pinned?t("取消置顶"):t("置顶资料")}</button><button onClick={()=>{move(d);setMenu('')}}>{t("移动到项目")}</button><button onClick={()=>{remove(d);setMenu('')}}>{t("删除")}</button></div>}</div>)}</section>)}</div>
}
