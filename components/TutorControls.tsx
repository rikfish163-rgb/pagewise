'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_TUTOR_MODEL, DEFAULT_REASONING_EFFORT, TUTOR_MODELS, reconcileTutorSettings, resolveTutorSettings, type TutorSettings, type ReasoningEffort, type TutorSpeed, type TutorModel, type TutorModelDiscovery } from '@/lib/tutor-models';
import './tutor-controls.css';

const initial:TutorSettings={model:DEFAULT_TUTOR_MODEL,reasoningEffort:DEFAULT_REASONING_EFFORT};
const storageKey='pagewise:tutor-settings:v1';
const labels:Record<ReasoningEffort,string>={none:'无',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};
const speedLabels:Record<TutorSpeed,string>={auto:'项目默认',standard:'标准',fast:'Fast',ultrafast:'Ultrafast'};
export type TutorAvailability = {
  models:readonly TutorModel[];
  status:TutorModelDiscovery['status']|'loading';
  message:string;
  ready:boolean;
  reload:()=>void;
};

export function useTutorSettings(){
  const [settings,setSettings]=useState<TutorSettings>(initial);
  const [discovery,setDiscovery]=useState<TutorModelDiscovery|{status:'loading';models:TutorModel[];message:string}>({status:'loading',models:[],message:'正在查询可用模型…'});
  const request=useRef<AbortController|null>(null);
  const reload=useCallback(async()=>{
    request.current?.abort();
    const controller=new AbortController();request.current=controller;
    setDiscovery({status:'loading',models:[],message:'正在查询可用模型…'});
    try {
      const response=await fetch('/api/study/models',{cache:'no-store',signal:controller.signal});
      const data=await response.json() as TutorModelDiscovery;
      if(!['ready','empty','unavailable'].includes(data.status)||!Array.isArray(data.models))throw new Error('invalid metadata');
      if(controller.signal.aborted)return;
      setDiscovery(data);
      if(data.status==='ready')setSettings(current=>reconcileTutorSettings(current,data.models)??current);
    } catch {
      if(!controller.signal.aborted)setDiscovery({status:'unavailable',models:[],message:'暂无法查询模型权限，可尝试目录中的模型。'});
    }
  },[]);
  useEffect(()=>{
    try {
      const value=JSON.parse(localStorage.getItem(storageKey)||'null');
      if(value) {
        // Hydrate only non-sensitive display preferences after the server render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettings(resolveTutorSettings(value));
      }
    } catch { /* Storage is optional, including in restricted browsers. */ }
    void reload();
    return ()=>request.current?.abort();
  },[reload]);
  function change(value:TutorSettings){
    setSettings(value);
    try {localStorage.setItem(storageKey,JSON.stringify(value));} catch { /* Still applies to this session. */ }
  }
  const availability:TutorAvailability={
    ...discovery,
    // A restricted Models permission is not a denied Responses permission.
    // Keep documented choices usable and explicitly mark them as unverified.
    models:discovery.status==='unavailable'
      ? TUTOR_MODELS.map(model=>model.snapshots.includes(settings.model)?{...model,id:settings.model}:model)
      : discovery.models,
    ready:discovery.status==='ready'||discovery.status==='unavailable',
    reload:()=>{void reload();},
  };
  return [settings,change,availability] as const;
}

export function TutorControls({value,onChange,availability}:{value:TutorSettings;onChange:(s:TutorSettings)=>void;availability:TutorAvailability}){
  const models=availability.models;
  const selected=models.find(m=>m.id===value.model);
  const disabled=!availability.ready;
  return <div className="tutor-controls" role="group" aria-label="下次提问设置">
    <label className="tutor-model"><span>模型{availability.status==='unavailable'?' · 待核实':''}</span><select aria-label="模型" disabled={disabled} value={selected?value.model:''} title={selected?.description} onChange={e=>{
      const next=reconcileTutorSettings({...value,model:e.target.value},models);if(next)onChange(next);
    }}>
      {!selected&&<option value="">{availability.status==='loading'?'查询中…':'暂无可用模型'}</option>}
      {models.map(m=><option key={m.id} value={m.id}>{m.label}{m.deprecated?'（已弃用）':''}</option>)}
    </select></label>
    <label className="tutor-effort"><span>思考强度</span><select aria-label="思考强度" disabled={disabled||!selected} value={selected?value.reasoningEffort:''} onChange={e=>onChange({...value,reasoningEffort:e.target.value as ReasoningEffort})}>
      {!selected&&<option value="">—</option>}
      {selected?.reasoningEfforts.map(e=><option key={e} value={e}>{labels[e]}</option>)}
    </select></label>
    <label className="tutor-speed"><span>速度</span><select aria-label="速度" disabled={disabled||!selected} value={selected?(value.speed??'auto'):''} title={value.speed==='fast'||value.speed==='ultrafast'?'该档按 API 加价计费，实际档位以回复为准。':undefined} onChange={e=>onChange({...value,speed:e.target.value as TutorSpeed})}>
      {!selected&&<option value="">—</option>}
      {selected?.speeds.map(speed=><option key={speed} value={speed}>{speedLabels[speed]}</option>)}
    </select></label>
    {availability.status!=='ready'&&<div className="tutor-model-status" role="status"><span>{availability.message}</span>{availability.status!=='loading'&&<button type="button" onClick={availability.reload}>重查</button>}</div>}
  </div>;
}
