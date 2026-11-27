'use client';

import { useLocale } from './LocaleProvider';
import {BookOpen, CircleCheck, FileText, PencilLine, RotateCcw} from 'lucide-react';
import './project-memory.css';
import {creditNumber} from './useStudyCredits';
import {useEffect,useState} from 'react';
import {evidencePageLabel, stageLabels, type Evidence, type MemoryStage, type ProjectMemoryView, type TopicCard} from '../lib/learning-memory';

export type MemoryRun = {loading:boolean; error?:string; busy?:boolean; creditsCharged?:number; retryCap?:number; signature?:string};
const stages:MemoryStage[]=['review','practice','mastered'];

type Props = {
  course:string;
  courses:string[];
  changeCourse:(course:string)=>void;
  automatic:boolean;
  site:boolean;
  priceLabel:string;
  automaticPriceLabel:string;
  canEnableAutomatic:boolean;
  retryQuote?:()=>void;
  toggleAutomatic:()=>void;
  canAnalyze:boolean;
  run?:MemoryRun;
  revision:number;
  load:(course:string)=>Promise<ProjectMemoryView>;
  analyze:(course:string)=>void;
  mark:(course:string,card:TopicCard,mastered:boolean)=>Promise<void>;
  openSource:(source:Evidence)=>void;
  startReview:(card:TopicCard)=>void;
};

const stageIcons = {review: RotateCcw, practice: PencilLine, mastered: CircleCheck};

function SourceList({evidence, openSource}: {evidence: Evidence[]; openSource: Props['openSource']}) {
  const { t } = useLocale();
  const files = new Map<string, {name: string; pages: Map<number, Evidence>}>();
  for (const source of evidence) {
    const id = source.documentId ?? source.threadId;
    const file = files.get(id) ?? {name: source.file, pages: new Map<number, Evidence>()};
    for (const page of source.pages?.length ? source.pages : [source.page]) {
      if (!file.pages.has(page)) file.pages.set(page, source);
    }
    files.set(id, file);
  }
  return <div className="memory-sources">
    <p className="sources-label"><BookOpen size={14} aria-hidden="true"/>{t("来源讲义")}</p>
    <ul>{Array.from(files, ([id, file]) => <li key={id}>
      <FileText size={15} aria-hidden="true"/>
      <div>
        <span className="source-name">{file.name}</span>
        <div className="source-pages">{Array.from(file.pages.keys()).sort((a,b)=>a-b).map(page =>
          <button type="button" key={page} aria-label={t("查看 {0} 第 {1} 页", { 0: file.name, 1: page })}
            onClick={()=>openSource({...file.pages.get(page)!, page})}>{t("第 {0} 页", { 0: page })}</button>
        )}</div>
      </div>
    </li>)}</ul>
  </div>;
}

export default function ProjectMemory(props:Props){
  const { t, locale } = useLocale();
  const {course,revision,load,analyze,automatic,canAnalyze,run}=props;
  const [view,setView]=useState<ProjectMemoryView|null>(null);
  const [loadError,setLoadError]=useState('');
  const [filter,setFilter]=useState<MemoryStage|'all'>('all');
  const [search,setSearch]=useState('');
  const [changing,setChanging]=useState<string|null>(null);
  const [actionError,setActionError]=useState('');
  const [requestCount,reload]=useState(0);

  useEffect(()=>{
    let current=true;
    load(course).then(value=>{if(current){setView(value);setLoadError('');}})
      .catch(error=>{if(current)setLoadError(error.message);});
    return()=>{current=false;};
  },[course,revision,requestCount,load]);

  useEffect(()=>{
    if(!automatic||!canAnalyze||run?.loading||run?.error||!view?.remaining||loadError)return;
    const timer=setTimeout(()=>analyze(course),run?.busy?10_000:900);
    return()=>clearTimeout(timer);
  },[analyze,automatic,canAnalyze,course,loadError,run,view]);

  async function mark(card:TopicCard){
    setChanging(card.key);
    setActionError('');
    try{
      await props.mark(course,card,card.stage!=='mastered');
      setView(await load(course));
    }catch(error){setActionError((error as Error).message);}
    finally{setChanging(null);}
  }

  const retryCap=run?.retryCap;
  const cards=view?.cards??[];
  const phrase=search.trim().toLowerCase();
  const visible=cards.filter(card=>(filter==='all'||filter===card.stage)&&(!phrase||
    [card.topic,...card.evidence.flatMap(source=>[source.detail,source.file,source.question])].some(text=>text.toLowerCase().includes(phrase))));
  return <div className="memory-list project-memory">
    <div className="memory-control">
      <label>{t("项目 ")}<select value={course} onChange={e=>props.changeCourse(e.target.value)}>
        {props.courses.map(name=><option key={name}>{name}</option>)}
      </select></label>
      <label><input type="checkbox" checked={automatic} disabled={!automatic&&!props.canEnableAutomatic} aria-describedby="memory-pricing" onChange={props.toggleAutomatic}/>
        {props.site?t("本次使用站点积分自动整理"):t("自动整理")}
      </label>
    </div>
    <div className="memory-feedback" id="memory-pricing">
      <span>{t(props.priceLabel)} {props.site&&t(props.automaticPriceLabel)}</span>
      {props.retryQuote&&<button type="button" className="text-button" onClick={props.retryQuote}>{t("重新读取报价")}</button>}
    </div>
    <div className="memory-feedback" aria-live="polite">
      {typeof run?.creditsCharged==='number'&&<span>{t("上次整理扣 {0} 分", { 0: creditNumber.format(run.creditsCharged) })}</span>}
      {loadError?<><span role="alert">{t(loadError)}</span><button className="text-button" onClick={()=>reload(n=>n+1)}>{t("重新加载")}</button></>
        :run?.loading?<span>{t("正在整理问答…")}</span>
        :run?.busy?<span>{t("这个项目正在整理中…")}</span>
        :run?.error?<><span role="alert">{t(run.error)} {retryCap!==undefined&&t("重试沿用上限 {0} 分。", { 0: creditNumber.format(retryCap) })}</span><button className="text-button" disabled={!canAnalyze&&retryCap===undefined} onClick={()=>analyze(course)}>{t("重试")}</button></>
        :!view?<span>{t("正在读取记忆…")}</span>
        :view.remaining>0?<><span>{t("还有 {0} 轮问答待整理", { 0: view.remaining })}</span>{!automatic&&<button disabled={!canAnalyze} className="text-button" onClick={()=>analyze(course)}>{t("整理一批")}</button>}</>
        :cards.length>0?<span>{t("{0} 个主题 · 来自 {1} 轮已整理问答", { 0: cards.length, 1: view.indexed })}</span>:null}
      {actionError&&<span role="alert">{t(actionError)}</span>}
    </div>
    {cards.length>0&&<>
      <input className="memory-search" type="search" placeholder={t("搜索主题、问题或讲义")} aria-label={t("搜索项目记忆")} value={search} onChange={e=>setSearch(e.target.value)}/>
      <div className="memory-filters" role="group" aria-label={t("学习阶段")}>
        {(['all',...stages] as const).map(stage=><button type="button" key={stage} aria-pressed={filter===stage} onClick={()=>setFilter(stage)}>
          {stage==='all'?t("全部"):t(stageLabels[stage])} <small>{stage==='all'?cards.length:cards.filter(card=>card.stage===stage).length}</small>
        </button>)}
      </div>
    </>}
    {view&&cards.length===0&&!view.remaining&&<p className="empty-memory">{t("完成一轮课件问答后，学习线索会整理到这里。")}</p>}
    {cards.length>0&&visible.length===0&&<p className="empty-memory">{t("没有匹配的主题。")}</p>}
    {stages.map(stage=>{
      const group=visible.filter(card=>card.stage===stage);
      const StageIcon=stageIcons[stage];
      return group.length>0&&<section key={stage} className="memory-stage" aria-label={t(stageLabels[stage])}>

        {group.map(card=>{
          const focus=(stage==='review'?card.evidence.find(source=>source.kind==='gap'):null)??card.evidence[0];
          return <article className="learning-card" data-stage={stage} key={card.key}>
            <span className="memory-stage-label"><StageIcon size={14} aria-hidden="true"/>{t(stageLabels[stage])}</span>
            <h3>{card.topic}</h3>
            <p>{focus.detail}</p>
            <SourceList evidence={card.evidence} openSource={props.openSource}/>
            <details className="learning-evidence">
              <summary>{t("提问记录{0}", { 0: card.count>1?' · '+card.count:'' })}</summary>
              {card.evidence.map((source,i)=><div key={source.threadId+i}>
                <p>{source.question}</p>
                <button type="button" className="text-button" onClick={()=>props.openSource(source)}>{source.file} · {evidencePageLabel(source, locale)}</button>
              </div>)}
            </details>
            <div className="learning-actions">
              {stage!=='mastered'&&<button type="button" className="text-button" onClick={()=>props.startReview(card)}>{t("自测一下")}</button>}
              <button className="memory-status" type="button" aria-pressed={stage==='mastered'} disabled={changing!==null} onClick={()=>void mark(card)}>
                {stage==='mastered'?t("撤销已掌握"):t("标记为已掌握")}
              </button>
            </div>
          </article>;
        })}
      </section>;
    })}
  </div>;
}
