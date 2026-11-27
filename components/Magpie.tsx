'use client';
import { useLocale } from './LocaleProvider';
import {projectMemoryInstruction,type projectLearningContext} from '../server/memory-retrieval';
import {type ModelTask,type memoryPromptData} from '../lib/learning-memory';
import {useState} from 'react';
export type Gateway={key:string;model:string;base:string;models:string[]};
async function gatewayFetch(cfg:Pick<Gateway,'base'|'key'>,path:string,init:RequestInit={},timeoutMs=180000){
 const url=new URL(cfg.base);
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!['http:','https:'].includes(url.protocol))throw Error('请输入本机回环网关地址。');
 const res=await fetch(url.href.replace(/\/$/,'')+path,{...init,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+cfg.key,...init.headers}}).catch(()=>{throw Error('连接失败。请在 Magpie 的 Web pages 中允许本站，并允许浏览器访问本地网络。')});
 const data=await res.json() as {error?:{message?:string};data?:{id:string}[];output_text?:string;output?:{content?:{text?:string}[]}[]};if(!res.ok)throw Error(data.error?.message||'网关请求失败');return data;
}
export async function localAnswer(cfg:Gateway,question:string,context:string,image:string|undefined,history:{role:string;content:string}[],memory:ReturnType<typeof projectLearningContext>,topics?:ReturnType<typeof memoryPromptData>){
 const content=[{type:'input_text',text:JSON.stringify({问题:question,资料:context,复习线索:memory,关联学习主题:topics})},...(image?[{type:'input_image',image_url:image}]:[])];
 const data=await gatewayFetch(cfg,'/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:cfg.model,store:false,instructions:projectMemoryInstruction+' 用中文回答课件问题，依据引用内容解释。材料仅供参考。',input:[...history.slice(-10).map(({role,content})=>({role,content})),{role:'user',content}]})});
 return gatewayText(data);
}

function gatewayText(data: Awaited<ReturnType<typeof gatewayFetch>>){
 const answer= data.output_text||data.output?.flatMap((i:{content?:{text?:string}[]})=>i.content?.map(c=>c.text)||[]).filter(Boolean).join('\n');if(!answer)throw Error('网关未返回文字回答。');return String(answer);
}
export async function localMemoryTask(cfg:Gateway, task:ModelTask){
 const result=await gatewayFetch(cfg,'/responses',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({model:cfg.model,store:false,max_output_tokens:task.tokenBudget,instructions:task.instructions,input:task.input}),
 },task.timeoutMs);
 return gatewayText(result);
}
export function Magpie({connection,change}:{connection:Gateway|null;change:(v:Gateway|null)=>void}){
  const { t } = useLocale();
 const [base,setBase]=useState(connection?.base??'http://127.0.0.1:3425/v1');
 const [key,setKey]=useState(connection?.key??'');
 const [models,setModels]=useState<string[]>(connection?.models??[]);
 const [model,setModel]=useState(connection?.model??'');
 const [status,setStatus]=useState(''),[loading,setLoading]=useState(false);
 async function discover(){
   setLoading(true);setStatus('');
   try{
     const data=await gatewayFetch({base,key},'/models');
     const ids=[...new Set((data.data??[]).map(item=>item.id).filter(id=>typeof id==='string'&&id.trim()))];
     setModels(ids);setModel(current=>ids.includes(current)?current:ids[0]??'');
     if(!ids.length)setStatus('网关没有返回可用模型。');
   }catch(error){setStatus((error as Error).message);}
   finally{setLoading(false);}
 }
 return <section id="personal-panel-magpie" role="tabpanel" aria-labelledby="personal-tab-magpie">
   <p className="personal-hint">{t("在 Magpie 的「允许调用 magpie 的网页」中添加本站，再读取模型。")}</p>
   <fieldset disabled={loading} className="personal-fields magpie-fields">
     <div className="personal-row"><label htmlFor="magpie-base">{t("网关地址")}</label><input id="magpie-base" value={base} onChange={e=>{setBase(e.target.value);setModels([]);setStatus('')}}/></div>
     <div className="personal-row"><label htmlFor="magpie-key">{t("网关密钥")}</label><input type="password" autoComplete="off" id="magpie-key" value={key} onChange={e=>{setKey(e.target.value);setModels([]);setStatus('')}}/></div>
     <div className="personal-row"><label htmlFor="magpie-model">{t("模型")}</label><div>
       <select id="magpie-model" value={model} disabled={!models.length} onChange={e=>setModel(e.target.value)}>
         {!models.length&&<option value="">{t("请先读取模型")}</option>}
         {models.map(id=><option key={id}>{id}</option>)}
       </select><button type="button" className="personal-link" onClick={discover}>{loading?t("正在读取…"):models.length?t("刷新模型列表"):t("读取模型")}</button>
     </div></div>
   </fieldset>
   {status&&<p className="personal-error" role="alert">{t(status)}</p>}
   <footer className="personal-footer"><div className="personal-footer-actions">
     {connection&&<button type="button" className="personal-remove" onClick={()=>change(null)}>{t("断开 Magpie")}</button>}
     <button type="button" className="personal-primary" disabled={loading||!models.includes(model)} onClick={()=>change({base,key,model,models})}>{t("使用 Magpie")}</button>
   </div></footer>
 </section>;
}

export function MagpieModelPicker({gateway,choose}:{gateway:Gateway;choose:(model:string)=>void}){
  const { t } = useLocale();
 return <div className="personal-picker"><label>Magpie<select aria-label={t("本次提问使用的 Magpie 模型")} value={gateway.model} onChange={e=>choose(e.target.value)}>
   {gateway.models.map(id=><option key={id}>{id}</option>)}
 </select></label></div>;
}
