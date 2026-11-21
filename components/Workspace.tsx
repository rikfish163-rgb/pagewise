'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Reader from './Reader';
import Notebook from './Notebook';
import Shelf from './Shelf';
import {MagpieModelPicker,localAnswer,localMemoryTask,type Gateway} from './Magpie';
import {combineImages,documentOverview,isOverview,requestedPages,type PageReader} from './study-context';
import './study-desk.css';
import PersonalModelPicker from './PersonalModelPicker';
import PersonalApi,{type PublicProfile} from './PersonalApi';
import DeskDivider from './DeskDivider';
import type { TutorProcessing } from '@/lib/tutor-models';
import MarkdownAnswer from './MarkdownAnswer';
import ProjectMemory, {type MemoryRun} from './ProjectMemory';
import {makeSearchTask,memoryMatches,memoryPromptData,type Evidence,type IndexJob,type MemorySourceRef,type ProjectMemoryView,type TopicCard} from '@/lib/learning-memory';
import 'katex/dist/katex.min.css';
import './markdown-answer.css';
import { TutorControls, useTutorSettings } from './TutorControls';
import StudyHome from './StudyHome';
import {readProgress,recentReader} from './reading-progress';
import StudyAccount from './StudyAccount';
import { chargeLimit, creditNumber, useStudyCredits } from './useStudyCredits';
import {CircleUserRound, LibraryBig, NotebookPen} from 'lucide-react';
import './workspace-nav.css';
/* Selection previews are local data URLs, not remotely optimized images. */
import { dismissSelection, discussionTitle, latestQuestionTime, questionTime, documentThreads, selectionLabel, updateThread, type Discussion, type Selection, type StudyDoc } from '@/lib/workspace-model';

const sample: StudyDoc = { id:'sample',name:'采样与混叠.pdf',kind:'pdf',course:'信号与系统' };
const paths: Record<string,string> = { book:'M3 4h6c2 0 3 1 3 2v15c0-2-1-3-3-3H3z M21 4h-6c-2 0-3 1-3 2v15c0-2 1-3 3-3h6z', plus:'M12 5v14M5 12h14', close:'m6 6 12 12M18 6 6 18', send:'m5 12 7-7 7 7M12 5v15', file:'M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h5', trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7', chevron:'m9 5 7 7-7 7', chat:'M4 4h16v13H9l-5 4zM8 9h8M8 13h5', lock:'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3', menu:'M4 6h16M4 12h16M4 18h16', back:'m14 5-7 7 7 7', arrow:'M5 12h14m-6-6 6 6-6 6', upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6' };
function Icon({name,size=18}:{name:string;size?:number}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.file}/></svg>; }
class QuoteChangedError extends Error {}
async function request<T>(url:string, init?:RequestInit):Promise<T> {
 const res=await fetch(`/api/study${url}`,init); const data=await res.json().catch(()=>({error:'服务暂时无法响应，请稍后重试。'})) as {error?:string|{message?:string};message?:string;code?:string};
 if(res.status===401)throw new Error('请先登录，以保存讲义和讨论。');
 if(res.status===409&&data.code==='quote_changed')throw new QuoteChangedError('报价已变更，请核对最新上限后重试。');
 if(!res.ok) throw new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||'操作失败，请重试。'); return data as T;
}
const json=(body:unknown)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const loadProjectMemory=(project:string)=>request<ProjectMemoryView>('/memory?course='+encodeURIComponent(project));
const memoryPreference='pagewise:automatic-memory';
export default function Workspace({showAdmin=false,accountSource='chatgpt'}:{showAdmin?:boolean;accountSource?:'chatgpt'|'oidc'}){
 const credits=useStudyCredits();
 const [failedAsks,setFailedAsks]=useState<Record<string,{question:string;signature:string;cap:number;sent:boolean}>>({});
 const [receipts,setReceipts]=useState<Record<string,string>>({});
 const sending=useRef(new Set<string>());
 const attempts=useRef(new Map<string,{requestId:string;question:string;signature:string;threadId?:string;body?:Record<string,unknown>;creation?:Record<string,unknown>;optimistic?:boolean;history?:Discussion['messages'];localBody?:Record<string,unknown>}>());
 const [home,setHome]=useState(true);
 const [account,setAccount]=useState(false);
 const [libraryLoaded,setLibraryLoaded]=useState(false);
 const [libraryError,setLibraryError]=useState('');
 const [loadAttempt,reloadLibrary]=useState(0);
 useEffect(()=>{
   const update=()=>setHome(window.location.hash!=='#reader');
   update();
   window.addEventListener('hashchange',update);
   return ()=>window.removeEventListener('hashchange',update);
 },[]);
 function navigate(reading:boolean){
   setHome(!reading);
   const hash=reading?'#reader':'#home';
   if(window.location.hash!==hash)window.location.hash=hash;
   setLibrary(false);
 }
 const [readerRequest,setReaderRequest]=useState({resume:true,revision:0});
 function lastPage(id:string){
   const checkpoint=readProgress(id);
   if(checkpoint)return checkpoint.page;
   try{return Math.max(1,Number(localStorage.getItem('pagewise:page:'+id))||1)}catch{return 1}
 }
 function requestReaderPage(value:number,resume=false){
   setReaderRequest(request=>({resume,revision:request.revision+1}));
   setPage(value);
 }
 function openDocument(item:StudyDoc, sourcePage?:number, threadId?:string){
   if(docId!==item.id||home){
     setDocId(item.id);
     requestReaderPage(sourcePage??lastPage(item.id),sourcePage===undefined);
     newQuestion();
   }else if(sourcePage!==undefined){requestReaderPage(sourcePage);}
   if(threadId)setActive(threadId);
   setMobilePanel(!!threadId);navigate(true);void organize(item,{visit:true});
 }
 function openImport(project?:string){
   setCourse(project??'');setFile(null);
   setError('');setUpload(true);
 }
 const [personal,setPersonal]=useState<PublicProfile|null>(null);
 const [personalChoice,choosePersonal]=useState({revision:'',model:''});
 const personalModel=personal&&personalChoice.revision===personal.revision&&(personal.models??[personal.model]).includes(personalChoice.model)?personalChoice.model:personal?.model;
 const personalVision=!!(personal&&personalModel&&(personal.visionModels??(personal.vision?[personal.model]:[])).includes(personalModel));
 const [settings,changeSettings,availability]=useTutorSettings();
 const [savedProjects,setSavedProjects]=useState<string[]>([]);
 const [docs,setDocs]=useState<StudyDoc[]>([]),[threads,setThreads]=useState<Discussion[]>([]),[docId,setDocId]=useState('sample'),[active,setActive]=useState('draft-initial'),[page,setPage]=useState(1);
 const [questions,setQuestions]=useState<Record<string,string>>({}),[pending,setPending]=useState<Record<string,boolean>>({}),[errors,setErrors]=useState<Record<string,string>>({});
 const [tab,setTab]=useState<'discussions'|'memory'|'note'>('discussions'),[upload,setUpload]=useState(false),[uploading,setUploading]=useState(false),[course,setCourse]=useState('信号与系统'),[file,setFile]=useState<File|null>(null),[error,setError]=useState(''),[library,setLibrary]=useState(false),[mobilePanel,setMobilePanel]=useState(false);
 const [remove,setRemove]=useState<{kind:'doc'|'thread';id:string;name:string}|null>(null),[deleting,setDeleting]=useState(false);
 const [quote,setQuote]=useState('');useEffect(()=>setQuote(''),[active]);
 const lookup=useRef<PageReader|null>(null);
 const [connection,setConnection]=useState<Gateway|null>(null),[gatewayActive,setGatewayActive]=useState(false),[collapsed,collapse]=useState(false);
 const gateway=gatewayActive?connection:null;
 const [memoryProject,setMemoryProject]=useState<string|null>(null);
 const freeQuestion=!!(gateway||personal);
 const modelSignature=JSON.stringify(gateway?{gateway:gateway.model}:personal?{source:'personal',revision:personal.revision,model:personalModel}:settings);
 const currentModel=useRef(modelSignature);
 useLayoutEffect(()=>{
   currentModel.current=modelSignature;
   return ()=>{currentModel.current='';};
 },[modelSignature]);
 const [personalAutomatic,setPersonalAutomatic]=useState(true);
 // Site consent is scoped to this open workspace. A legacy preference only covers personal sources.
 const [siteAutomatic,setSiteAutomatic]=useState(false);
 const siteAutomaticRef=useRef(false);
 const automaticMemory=freeQuestion?personalAutomatic:siteAutomatic;
 const answerLimit=chargeLimit(credits.account,'answerCap');
 const memoryLimit=chargeLimit(credits.account,'memoryCap');
 const insufficientCredits=!freeQuestion&&!!credits.account&&answerLimit===0;
 const creditBlocked=!freeQuestion&&(credits.loading||!credits.account||insufficientCredits);
 const sourceLabel=gateway?'Magpie':personal?'个人 API':'站点模型';
 const pricing=credits.account?.pricing;
 const pricePending=credits.loading?'正在读取积分报价…':credits.error;
 const rateLabel=pricing?`每 1 美元折合 ${creditNumber.format(pricing.creditsPerUsd)} 分`:'';
 const newAnswerPrice=freeQuestion?`${sourceLabel} · 0.000 站内积分`:credits.account?'':pricePending;
 const memoryPriceLabel=freeQuestion?`${sourceLabel}整理 · 0.000 站内积分`:availability.status==='empty'?availability.message:pricing?
   `站点整理按实际用量和 OpenAI 官方单价计费（${rateLabel}）。当前每批最多 ${creditNumber.format(memoryLimit)} 分。` :pricePending;
 const automaticPriceLabel=pricing?
   `自动整理单独计费，每批最多 ${creditNumber.format(pricing.memoryCap)} 分，以整理时的可用余额为限。`:'';
 const refreshQuote=credits.refresh;
 const [memoryRevision,refreshMemory]=useState(0);
 const [memoryRuns,setMemoryRuns]=useState<Record<string,MemoryRun>>({});
 const memoryInFlight=useRef(new Set<string>());
 const personalAutomaticRef=useRef(true);
 useEffect(()=>{
   try{personalAutomaticRef.current=localStorage.getItem(memoryPreference)!=='off';}catch{ /* Use the session preference when storage is unavailable. */ }
   setPersonalAutomatic(personalAutomaticRef.current);
 },[]);
 function toggleAutomaticMemory(){
   if(!freeQuestion){
     siteAutomaticRef.current=!siteAutomaticRef.current;
     setSiteAutomatic(siteAutomaticRef.current);
     return;
   }
   personalAutomaticRef.current=!personalAutomaticRef.current;
   try{localStorage.setItem(memoryPreference,personalAutomaticRef.current?'on':'off');}catch{ /* The current session still updates. */ }
   setPersonalAutomatic(personalAutomaticRef.current);
 }
 const personalRevision=personal?.revision;
 const memoryReady=freeQuestion||!!(availability.ready&&!credits.loading&&memoryLimit>0);
 const failedIndexes=useRef(new Map<string,{signature:string;body:{requestId:string;course:string;model?:string;threadId?:string;maxCredits?:number}}>());
 // An interrupted request can replay its receipt even after the available balance changes.
 const indexProject=useCallback(async(project:string,priorityThread?:string,limit=memoryLimit)=>{
   const previous=failedIndexes.current.get(project);
   const replay=previous?.signature===modelSignature&&(!priorityThread||previous.body.threadId===priorityThread)?previous.body:undefined;
   if(currentModel.current!==modelSignature||memoryInFlight.current.has(project))return;
   if(!replay&&(!memoryReady||(!freeQuestion&&limit<=0)))return;
   memoryInFlight.current.add(project);
   setMemoryRuns(runs=>({...runs,[project]:{loading:true}}));
   let token:string|undefined;
   try{
     let busy=false,charged:number|undefined;
     if(gateway){
       const result=await request<{job:IndexJob|null;busy?:boolean}>('/memory/start',json({course:project,threadId:priorityThread}));
       busy=!!result.busy;
       if(result.job){
         token=result.job.token;
         const output=await localMemoryTask(gateway,result.job.task);
         await request('/memory/finish',json({course:project,token,output}));
       }
     }else{
       const body=replay??{
         requestId:crypto.randomUUID(),course:project,threadId:priorityThread,
         ...(personalRevision?{source:'personal',revision:personalRevision,model:personalModel}:{...settings,maxCredits:limit}),
       };
       failedIndexes.current.set(project,{signature:modelSignature,body});
       const result=await request<{busy:boolean;creditsCharged?:number}>('/memory/index',json(body));
       failedIndexes.current.delete(project);
       busy=result.busy;
       charged=result.creditsCharged;
     }
     setMemoryRuns(runs=>({...runs,[project]:{loading:false,busy,creditsCharged:charged}}));
   }catch(error){
     if(error instanceof QuoteChangedError)failedIndexes.current.delete(project);
     const retryCap=failedIndexes.current.get(project)?.body.maxCredits;
     if(token)void request('/memory/cancel',json({course:project,token})).catch(()=>{});
     setMemoryRuns(runs=>({...runs,[project]:{loading:false,error:(error as Error).message,retryCap,signature:modelSignature}}));
   }finally{
     if(!freeQuestion)await refreshQuote();
     memoryInFlight.current.delete(project);
     refreshMemory(value=>value+1);
   }
 },[gateway,memoryReady,memoryLimit,modelSignature,freeQuestion,refreshQuote,personalRevision,personalModel,settings]);
 const [insert,setInsert]=useState<{id:number;text:string}|null>(null);
 const [extras,setExtras]=useState<Record<string,Selection[]>>({});
 const citations=extras[active]||[];
 const [omitPrimary,setOmitPrimary]=useState<Record<string,boolean>>({});
 const [omitImage,setOmitImage]=useState<Record<string,boolean>>({});
 function addCitation(id:string,selection:Selection){setExtras(v=>({...v,[id]:[...(v[id]||[]),selection].slice(0,12)}));}
 const [movingDoc,setMovingDoc]=useState<StudyDoc|null>(null);
 const moveDialog=useRef<HTMLDialogElement>(null);
 const [moveTarget,setMoveTarget]=useState('');
 const [moveError,setMoveError]=useState('');
 const [moving,setMoving]=useState(false);
 useEffect(()=>{if(movingDoc&&!moveDialog.current?.open)moveDialog.current?.showModal();},[movingDoc]);
 function chooseMove(item:StudyDoc){
   setMoveTarget('');setMoveError('');setMovingDoc(item);
 }
 async function changeDocument(item:StudyDoc,change:{course?:string;pinned?:boolean;visit?:boolean;existingProject?:boolean}){
   if(item.id==='sample')return;
   await request('/docs/'+item.id+'/organize',json(change));
   setDocs(all=>all.map(doc=>doc.id!==item.id?doc:{...doc,course:change.course??doc.course,pinned:change.pinned===undefined?doc.pinned:Number(change.pinned),visited:change.visit?Date.now():doc.visited}));
   if(change.course&&change.course!==item.course){
     const target=change.course;
     setSavedProjects(all=>[...new Set([...all,item.course,target])]);
     refreshMemory(value=>value+1);
   }
 }
 async function organize(item:StudyDoc,change:{course?:string;pinned?:boolean;visit?:boolean;existingProject?:boolean}){
   try{await changeDocument(item,change);}
   catch(error){setError((error as Error).message);}
 }
 async function submitMove(event:React.FormEvent){
   event.preventDefault();
   if(!movingDoc||!moveTarget||moving)return;
   setMoving(true);setMoveError('');
   try{await changeDocument(movingDoc,{course:moveTarget,existingProject:true});moveDialog.current?.close();}
   catch(error){setMoveError((error as Error).message);}
   finally{setMoving(false);}
 }
 function dropped(f:File,c?:string){if(!/\.(pdf|pptx)$/i.test(f.name)||f.size>20*1024*1024){setError('请选择 20 MiB 以内的 PDF 或 PPTX');return}setError('');setFile(f);if(c)setCourse(c);setUpload(true);}
 const samplePromise=useRef<Promise<string>|null>(null), savedDoc=useRef(''), bottom=useRef<HTMLDivElement>(null);
 const question=questions[active]||''; const setQuestion=(value:string)=>setQuestions(v=>({...v,[active]:value}));
 const doc=docs.find(d=>d.id===docId)||sample; const items=documentThreads(threads,doc.id); const existing=items.find(t=>t.id===active); const thread:Discussion=existing??{id:active,docId:doc.id,page,messages:[]}; const currentPending=!!pending[active];
 const primaryImage=omitImage[active]?undefined:thread?.image;
 const primaryTextVisible=!!thread.text&&thread.text!=='按页提问'&&!omitPrimary[active];
 const failedAsk=failedAsks[active]?.signature===modelSignature?failedAsks[active]:undefined;
 const replayQuestion=!!failedAsk&&failedAsk.question===question.trim();
 const replayLabel=failedAsk?`重试原问题沿用上限 ${creditNumber.format(failedAsk.cap)} 分，已结算的请求不重复扣分。`:'';
 const priceLabel=replayQuestion?replayLabel:newAnswerPrice;
 const ready=!!gateway||(personal?(!primaryImage||personalVision):availability.ready);
 function removePrimaryImage(){setOmitImage(value=>({...value,[active]:true}));}

 useEffect(()=>{
   let current=true;
   setLibraryError('');
   request<{docs:StudyDoc[];threads:Discussion[];projects?:string[]}>('/state').then(state=>{
     if(!current)return;
     setDocs(state.docs);setThreads(state.threads);setSavedProjects(state.projects??[]);
     const params=new URLSearchParams(window.location.search);
     const source=params.get('document');
     const recent=[...state.docs].sort((a,b)=>(b.visited||0)-(a.visited||0))[0];
     const readerId=source??(window.location.hash==='#reader'?recentReader():null);
     const previous=readerId==='sample'?sample:state.docs.find(item=>item.id===readerId);
     const target=source?previous:previous??recent;
     if(target){
       const sheet=Number(params.get('page'));
       setDocId(target.id);
       const deepLink=!!source&&Number.isSafeInteger(sheet)&&sheet>0;
       requestReaderPage(deepLink?sheet:lastPage(target.id),!deepLink);
       if(source){
         const linked=state.threads.find(t=>t.docId===target.id&&t.id===params.get('discussion'));
         if(linked)setActive(linked.id);
         window.history.replaceState(null,'',window.location.pathname+'#reader');setHome(false);
       }
     }else if(source){
       window.history.replaceState(null,'',window.location.pathname+'#home');setHome(true);
       setError('当前账户的资料库中找不到这份讲义。');
     }
     setLibraryLoaded(true);
   }).catch(e=>{if(current)setLibraryError(e.message)});
   return ()=>{current=false};
 },[loadAttempt]);
 useEffect(()=>{if(!upload&&!remove)return;const previous=document.activeElement as HTMLElement|null;const dialog=document.querySelector<HTMLElement>('[role=dialog], [role=alertdialog]');if(!dialog)return;const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], textarea, select')).filter(el=>el.offsetParent!==null);focusable()[0]?.focus();function handle(e:KeyboardEvent){if(e.key==='Escape'&&!uploading&&!deleting){setUpload(false);setRemove(null);setError('');}if(e.key==='Tab'){const list=focusable();const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);previous?.focus();};},[upload,remove,uploading,deleting]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[thread?.messages.length,currentPending]);
 function noteSource(sourcePage?:number){
   const link=new URL('/',window.location.origin);
   link.searchParams.set('document',doc.id);
   if(sourcePage)link.searchParams.set('page',String(sourcePage));
   if(!thread.id.startsWith('draft-'))link.searchParams.set('discussion',thread.id);
   link.hash='reader';
   return '['+(sourcePage?'查看第 '+sourcePage+' 页原文':'打开来源讲义')+']('+link.href+')';
 }
 const excerpts=[...(primaryTextVisible&&!thread.image?[{page:thread.page,text:thread.text}]:[]),...citations]
   .filter((item):item is Selection & {text:string}=>!('image' in item && item.image)&&!!item.text?.trim());
 function saveExcerpts(){
   const blocks=excerpts.map(item=>noteSource(item.page)+'\n\n'+item.text.split(/\r?\n/).map(line=>'> '+line).join('\n'));
   setInsert({id:Date.now(),text:['## '+doc.name,...blocks].join('\n\n')});
   setTab('note');
 }
 function newQuestion(){setActive('draft-'+crypto.randomUUID());setTab('discussions');}
 function select(s:Selection){
   if(existing&&!currentPending)addCitation(active,s);
   else{
     const id=currentPending?'draft-'+crypto.randomUUID():active;
     setThreads(v=>[...v,{...s,id,docId:doc.id,messages:[]}]);setActive(id);
   }
   setTab('discussions');setMobilePanel(true);
 }
 function openThread(t:Discussion,sourcePage=t.page){setDocId(t.docId);requestReaderPage(sourcePage);setActive(t.id);setTab('discussions');setMobilePanel(true);}
 async function ensureSample(){if(savedDoc.current)return savedDoc.current;if(!samplePromise.current){samplePromise.current=(async()=>{const response=await fetch('/lesson.pdf');if(!response.ok)throw new Error('示例讲义未能载入，请上传自己的讲义。');const form=new FormData();form.append('file',new File([await response.blob()],sample.name,{type:'application/pdf'}));form.append('course',sample.course);const result=await request<{id:string}>('/docs',{method:'POST',body:form});savedDoc.current=result.id;setDocs(v=>[...v,{...sample,id:result.id}]);setThreads(v=>v.map(t=>t.docId==='sample'?{...t,docId:result.id}:t));setDocId(current=>current==='sample'?result.id:current);return result.id;})().catch(e=>{samplePromise.current=null;throw e;});}return samplePromise.current;}
 async function ask(value=question){
 if(!ready||!value.trim()||pending[thread.id]||sending.current.has(thread.id))return;
 const snapshot=thread, key=snapshot.id, q=value.trim();
 const signature=modelSignature;
 const previous=attempts.current.get(key);
 const retry=previous?.question===q&&previous.signature===signature;
 if(creditBlocked&&!(retry&&failedAsk?.sent&&failedAsk.question===q))return;
 const operation=retry?previous:{requestId:crypto.randomUUID(),question:q,signature,history:snapshot.messages};
 attempts.current.set(key,operation);
 sending.current.add(key);
 setPending(v=>({...v,[key]:true}));setErrors(v=>({...v,[key]:''}));setReceipts(v=>({...v,[key]:''}));let id=operation.threadId??key;

 let sentPaidAsk=false;
 let savedAnswer=false;
 const primaryText=omitPrimary[key]?undefined:snapshot.text;
 try{
 let context='',sourcePage=snapshot.page,visual:string|undefined;
 if(!operation.body){
 const pages=requestedPages(q);
 const reader=lookup.current;
 const hasSelection=!!citations.length||!!primaryImage||!!(primaryText&&primaryText!=='按页提问');
 const asksCurrent=/本页|当前页|这一?页/.test(q);
 const overview=!pages.length&&!asksCurrent&&isOverview(q)&&(!hasSelection||/全文|整份|整篇|整本|课件|讲义/.test(q));
 const needsCurrent=asksCurrent||(!hasSelection&&!snapshot.messages.length);
 if(!existing)setThreads(v=>v.some(t=>t.id===key)?v:[...v,snapshot]);
 if(!pages.length&&!overview&&(needsCurrent||snapshot.text==='按页提问'))pages.push(page);
 if((pages.length||overview)&&!reader)throw Error('请等待讲义载入。');
 const extracts:Selection[]=[];for(const n of pages)extracts.push(await reader!.read(n));
 const outline=overview?await documentOverview(reader!):undefined;
 if(outline)extracts.push(...outline.images);
 const references=[...citations,...extracts];
 context=[outline?.text,...references.map(s=>'第 '+s.page+' 页 · '+(s.text||'图片'))].filter(Boolean).join('\n').slice(0,39500);
 sourcePage=pages[0]??(hasSelection?snapshot.page:page);
 const pictures=references.flatMap(s=>s.image?[s.image]:[]);
 const attachment=await combineImages([...(primaryImage&&(pictures.length||gateway)?[primaryImage]:[]),...pictures]);
 if(personal&&!gateway&&!personalVision&&attachment&&(citations.some(s=>s.image)||extracts.some(s=>!s.text?.trim())))throw Error('请选用支持图片输入的模型。');
 visual=personal&&!gateway&&!personalVision?undefined:attachment;
 operation.body={requestId:operation.requestId,question:q,context,sourcePage,omitPrimaryText:!!omitPrimary[key],omitPrimaryImage:!!omitImage[key],attachment:visual,...(!freeQuestion&&{maxCredits:answerLimit}),...(personal?{source:'personal',revision:personal.revision,model:personalModel}:settings)};
 }
 context=operation.body.context as string;sourcePage=operation.body.sourcePage as number;visual=operation.body.attachment as string|undefined;
 if(key.startsWith('draft-')&&!operation.threadId){
   if(!operation.creation){
     const documentId=snapshot.docId==='sample'?await ensureSample():snapshot.docId;
     operation.creation={requestId:operation.requestId,docId:documentId,page:snapshot.page,text:primaryText,unanchored:!primaryText&&!primaryImage,image:primaryImage,rect:primaryImage||(!snapshot.image&&primaryText)?snapshot.rect:undefined};
   }
   const created=await request<{id:string}>('/threads',json(operation.creation));
   operation.threadId=created.id;id=created.id;
   attempts.current.set(id,operation);
   sending.current.add(id);
   setThreads(v=>updateThread(v,key,t=>({...t,id,text:operation.creation!.text as string|undefined,image:operation.creation!.image as string|undefined,rect:operation.creation!.rect as Discussion['rect'],docId:operation.creation!.docId as string})));
   setActive(v=>v===key?id:v);setPending(v=>({...v,[key]:false,[id]:true}));
   setQuestions(v=>({...v,[id]:v[key]||q}));
 }
 if(!operation.optimistic){
   operation.optimistic=true;
   setThreads(v=>updateThread(v,id,t=>({...t,messages:[...t.messages,{role:'user',content:q,createdAt:Date.now(),page:sourcePage}]})));
 }
 let reply:{answer:string;refs:string[];creditsCharged?:number;processing?:TutorProcessing;memorySources?:MemorySourceRef[]};
 if(gateway){
   if(!operation.localBody){
   const {learningContext,catalog}=await request<{learningContext:Parameters<typeof localAnswer>[5];catalog:TopicCard[]}>('/threads/'+id+'/project-memory',json({question:q,context,omitPrimaryText:!!omitPrimary[key]}));
   const excerpt=[primaryText,context].filter(Boolean).join('\n');
   let matches:TopicCard[]|undefined;
   if(catalog?.length){
     try{
       const task=makeSearchTask(q,excerpt,(operation.history??snapshot.messages).findLast(message=>message.role==='user')?.content??'',catalog);
       matches=memoryMatches(await localMemoryTask(gateway,task),catalog);
     }catch { /* Fall back to existing project context if retrieval is unavailable. */ }
   }
   const answer=await localAnswer(gateway,q,excerpt,visual,operation.history??snapshot.messages,matches?[]:learningContext,matches?memoryPromptData(matches):undefined);
   operation.localBody={requestId:operation.requestId,question:q,answer,previous:(operation.history??snapshot.messages).length,sourcePage,excerpt,memoryKeys:matches?.map(card=>card.key)};
   }
   reply=await request('/threads/'+id+'/local-answer',json(operation.localBody));
 }else{
   sentPaidAsk=!freeQuestion;
   reply=await request('/threads/'+id+'/ask',json(operation.body));
 }
 if(typeof reply.answer!=='string'||!reply.answer.trim())throw Error('未收到完整回答，请重试原问题。');
 savedAnswer=true;
 attempts.current.delete(key);attempts.current.delete(id);
 setFailedAsks(v=>{const next={...v};delete next[key];delete next[id];return next;});
 setQuestions(v=>({...v,[key]:v[key]?.trim()===q?'':v[key]||'',[id]:v[id]?.trim()===q?'':v[id]||''}));
 setReceipts(v=>({...v,[id]:typeof reply.creditsCharged==='number'?`回答已保存 · 本次扣 ${creditNumber.format(reply.creditsCharged)} 积分`:freeQuestion?'回答已保存 · 0.000 站内积分':'回答已保存 · 查看账户积分明细'}));
 setExtras(v=>({...v,[key]:[],[id]:[]}));setThreads(v=>updateThread(v,id,t=>({...t,messages:[...t.messages,{role:'assistant',content:reply.answer,processing:reply.processing,memorySources:reply.memorySources}],refs:reply.refs})));
 refreshMemory(value=>value+1);
 if(freeQuestion&&personalAutomaticRef.current)void indexProject(doc.course,id);
 }catch(e){
   if(e instanceof QuoteChangedError){
     attempts.current.delete(key);attempts.current.delete(id);
     setFailedAsks(v=>{const next={...v};delete next[key];delete next[id];return next;});
     if(operation.optimistic)setThreads(v=>updateThread(v,id,t=>({...t,messages:t.messages.slice(0,-1)})));
   }else if(typeof operation.body?.maxCredits==='number'){
     const cap=operation.body.maxCredits;
     setFailedAsks(v=>({...v,[id]:{question:q,signature,cap,sent:sentPaidAsk}}));
   }
   setQuestions(v=>({...v,[id]:v[id]||q}));
   if(id!==key)setExtras(v=>({...v,[id]:citations}));
   setErrors(v=>({...v,[id]:e instanceof Error?e.message:'发送失败，请重试。'}));
 }finally{
   sending.current.delete(key);sending.current.delete(id);
   setPending(v=>({...v,[key]:false,[id]:false}));
   const updated=await refreshQuote();
   if(savedAnswer&&!freeQuestion&&siteAutomatic&&siteAutomaticRef.current&&updated){
     void indexProject(doc.course,id,chargeLimit(updated,'memoryCap'));
   }
 }}
 async function uploadFile(e:React.FormEvent){e.preventDefault();if(!file||!course.trim())return;setUploading(true);setError('');try{const form=new FormData();form.append('file',file);form.append('course',course.trim());const r=await request<{id:string}>('/docs',{method:'POST',body:form});const d:StudyDoc={id:r.id,name:file.name,course:course.trim(),kind:file.name.toLowerCase().endsWith('.pptx')?'pptx':'pdf'};setDocs(v=>[...v,{...d,visited:Date.now()}]);void organize(d,{visit:true});setDocId(r.id);requestReaderPage(1);newQuestion();navigate(true);setMobilePanel(false);setUpload(false);setLibrary(false);setFile(null);}catch(e){setError(e instanceof Error?e.message:'上传失败');}finally{setUploading(false);}}
 async function confirmDelete(){if(!remove)return;setDeleting(true);try{if(!remove.id.startsWith('draft-'))await request(`/${remove.kind==='doc'?'docs':'threads'}/${remove.id}`,{method:'DELETE'});if(remove.kind==='doc'){if(remove.id===savedDoc.current){savedDoc.current='';samplePromise.current=null;}setDocs(v=>v.filter(d=>d.id!==remove.id));setThreads(v=>v.filter(t=>t.docId!==remove.id));if(docId===remove.id){setDocId('sample');newQuestion();setPage(1);}}else{setThreads(v=>v.filter(t=>t.id!==remove.id));if(active===remove.id)newQuestion();}setRemove(null);refreshMemory(value=>value+1);}catch(e){setError(e instanceof Error?e.message:'删除失败');}finally{setDeleting(false);}}
 const projects=[...new Set([doc.course,...docs.map(item=>item.course),...savedProjects])];
 const openProject=memoryProject&&projects.includes(memoryProject)?memoryProject:doc.course;
 const lastRun=memoryRuns[openProject];
 const projectRun=lastRun?.error&&lastRun.signature!==modelSignature?undefined:lastRun;
 function openMemorySource(source:Pick<Evidence,'threadId'|'page'>){
   const discussion=threads.find(item=>item.id===source.threadId);
   if(discussion)openThread(discussion,source.page);
   else setError('这条对话已移除，请重新打开项目记忆。');
 }
 function startMemoryReview(card:TopicCard){
   const source=card.evidence.find(item=>item.kind==='gap')??card.evidence[0];
   const discussion=threads.find(item=>item.id===source.threadId);
   if(!discussion){setError('这条对话已移除，请重新打开项目记忆。');return;}
   const draft='draft-'+crypto.randomUUID();
   setDocId(discussion.docId);requestReaderPage(source.page);setActive(draft);setTab('discussions');setMobilePanel(true);
   setQuestions(values=>({...values,[draft]:`请围绕「${card.topic}」给我一道自测题，重点检查「${source.detail}」。等我作答后再给提示和解析。`}));
 }
 const allDocs=docs.length?docs:[sample];
 return <main className="workspace">
 <header className="masthead">{!home&&<button className="icon-button" aria-label="切换资料库" onClick={()=>{if(window.innerWidth>950)collapse(!collapsed);else setLibrary(!library)}}><Icon name="menu"/></button>}<a className="brand" href="#home" aria-label="页边首页"><span className="brand-mark"><Icon name="book" size={24}/></span><span>页边<span className="brand-en">MARGIN</span></span></a>{!home&&<a className="hub-link" href="#home" title="学习首页"><LibraryBig size={16}/><span>学习首页</span></a>}<PersonalApi active={personal} connection={connection} gatewayActive={gatewayActive}
 onGateway={value=>{setConnection(value);setGatewayActive(!!value);if(value)setPersonal(null)}}
 onChange={profile=>{setGatewayActive(false);setPersonal(profile)}}/>{!home&&<button className="import-button" onClick={()=>openImport(doc.course)}><span>导入讲义</span></button>}<button className="account-trigger" type="button" title="我的账户与学习积分" aria-label="我的账户与学习积分" onClick={()=>setAccount(true)}><CircleUserRound size={19}/><span>我的账户</span></button></header>
 {account&&<StudyAccount showAdmin={showAdmin} accountSource={accountSource} onClose={()=>{setAccount(false);void credits.refresh();}}/>}
 <div className="home-surface" hidden={!home}>{libraryLoaded?<StudyHome docs={docs} savedProjects={savedProjects} onCreateProject={async name=>{
   const created=await request<{name:string}>('/projects',json({name}));
   setSavedProjects(values=>[...new Set([...values,created.name])]);
   return created.name;
 }} onManageProject={async (action,project,target)=>{
   await request('/projects/manage',json({action,project,target}));
   if(target)setDocs(values=>values.map(item=>item.course===project?{...item,course:target}:item));
   setSavedProjects(values=>[...new Set([...values.filter(name=>name!==project),...(target?[target]:[])])]);
   setMemoryProject(current=>current===project?(target??null):current);
   refreshMemory(value=>value+1);
 }} onMoveDoc={chooseMove} threads={threads} onOpenDoc={openDocument} onImport={openImport} onSample={()=>openDocument(sample)}/>:<section className="hub-loading" role="status">{libraryError||'正在读取资料库…'}{libraryError&&<button onClick={()=>reloadLibrary(n=>n+1)}>重试</button>}{libraryError.includes('登录')&&<a href="/login">登录</a>}</section>}</div>
 <div className="desk" hidden={home} data-folded={collapsed}>
 <aside id="study-library" className={`library ${library?'is-open':''}`} aria-label="资料库"><div className="library-heading"><span>我的资料库</span><button className="icon-button mobile-only" aria-label="关闭资料库" onClick={()=>setLibrary(false)}><Icon name="close"/></button></div><Shelf docs={allDocs} current={doc.id} organize={organize} move={chooseMove} drop={dropped} remove={d=>setRemove({kind:'doc',id:d.id,name:d.name})} open={openDocument}/><button className="add-document" onClick={()=>openImport(doc.course)}><Icon name="plus" size={16}/>添加课程资料</button></aside>
 <DeskDivider side="left"/><section className="reader-column" aria-label="讲义阅读区"><div className="document-heading"><div><h1>{doc.name.replace(/\.(pdf|pptx)$/i,'')}</h1><span className="document-course" title={doc.course}>{doc.course}</span></div><span className="file-type">{doc.kind.toUpperCase()}</span></div><div className="reader-hint"><button className="mobile-only text-button" onClick={()=>setMobilePanel(true)}>页边讨论{items.length?` · ${items.length}`:''}</button></div><div className="reader-stage">{!home&&libraryLoaded&&<Reader lookup={lookup} key={doc.id} documentId={doc.id} navigation={readerRequest} url={doc.id==='sample'?'/lesson.pdf':`/api/study/docs/${doc.id}/file`} kind={doc.kind} page={page} onPage={next=>{setPage(next);try{localStorage.setItem('pagewise:page:'+doc.id,String(next))}catch{}}} onSelect={select} onDismiss={()=>{setThreads(v=>dismissSelection(v,active,currentPending,question));newQuestion();setMobilePanel(false);}} focusPage={thread?.page} focusRect={thread?.docId===doc.id&&!omitImage[active]?thread.rect:undefined}/>}</div></section>
 <DeskDivider/><aside id="discussion-panel" data-empty-question={!thread.messages.length&&!primaryImage&&!primaryTextVisible&&!citations.length&&!currentPending&&!errors[active]} className={`margin-panel ${mobilePanel?'is-open':''}`} aria-label="页边讨论"><div className="margin-header"><div className="panel-tabs"><button className={tab==='discussions'?'active':''} onClick={()=>setTab('discussions')}>页边讨论<span>{items.length}</span></button><button className={tab==='memory'?'active':''} onClick={()=>{setMemoryProject(doc.course);setTab('memory')}}>项目记忆</button><button className={tab==='note'?'active':''} onClick={()=>setTab('note')}>笔记</button></div><button className="icon-button mobile-only" aria-label="返回讲义" onClick={()=>setMobilePanel(false)}><Icon name="close"/></button></div>
 <Notebook visible={tab==='note'} insert={insert}/>{tab==='note'?null:tab==='memory'?<ProjectMemory key={openProject} course={openProject} courses={projects} changeCourse={setMemoryProject}
   automatic={automaticMemory} toggleAutomatic={toggleAutomaticMemory} canAnalyze={memoryReady}
   site={!freeQuestion} priceLabel={memoryPriceLabel} automaticPriceLabel={automaticPriceLabel}
   canEnableAutomatic={memoryReady} retryQuote={!freeQuestion&&credits.error?refreshQuote:undefined}
   run={projectRun} revision={memoryRevision} load={loadProjectMemory}
   analyze={indexProject} mark={async(project,card,mastered)=>{await request('/memory/status',json({course:project,topic:card.key,mastered}));}}
   openSource={openMemorySource} startReview={startMemoryReview}/>:<>{items.length>0&&<div className="thread-strip"><button type="button" className="thread-add" aria-label="新提问" title="新提问" onClick={newQuestion}><Icon name="plus" size={18}/></button><details className="thread-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false}} onKeyDown={e=>{if(e.key==='Escape'&&e.currentTarget.open){e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus()}}}>
 <summary title={existing?discussionTitle(existing):undefined}><span>{existing?discussionTitle(existing):'历史对话'}</span><Icon name="chevron" size={13}/></summary>
 <div className="thread-options" aria-label="历史对话">
  {[...items].sort((a,b)=>latestQuestionTime(b)-latestQuestionTime(a)).map(t=><button type="button" key={t.id} title={discussionTitle(t)} aria-current={active===t.id} onClick={e=>{const picker=e.currentTarget.closest('details');if(picker){picker.open=false;picker.querySelector('summary')?.focus()}openThread(t)}}>{pending[t.id]?'回答中 · ':''}{discussionTitle(t)}</button>)}
 </div>
 </details><button className="icon-button" aria-label="删除当前讨论" disabled={!existing||currentPending} onClick={()=>thread&&setRemove({kind:'thread',id:thread.id,name:selectionLabel(thread)})}><Icon name="trash" size={15}/></button></div>}
 <div className="conversation">{primaryImage&&<div className="selected-passage"><div><span>第 {thread.page} 页 · 图像选区</span><button className="text-button" onClick={()=>{requestReaderPage(thread.page);setMobilePanel(false);}}>定位原文<Icon name="chevron" size={12}/></button><button type="button" className="image-remove" disabled={currentPending} onClick={removePrimaryImage} aria-label="移除首次框选的图片" title="移除图片">×</button></div><img src={primaryImage} alt={`第 ${thread.page} 页框选内容`}/></div>}{!errors[active]&&thread.messages.length===0&&(primaryImage||citations.length>0||(primaryTextVisible))&&<div className="start-discussion"><p>这段内容，你想弄懂什么？</p>{newAnswerPrice&&<p className="quick-question-price">{newAnswerPrice}</p>}<div className="quick-actions"><button aria-describedby="question-price" disabled={currentPending||!ready||creditBlocked} onClick={()=>ask('请结合讲义上下文，解释这个选区的内容，并给出直观例子。')}>解释一下</button><button aria-describedby="question-price" disabled={currentPending||!ready||creditBlocked} onClick={()=>ask('请把选区内容翻译成中文；如果原文已经是中文，请翻译成英文。保留公式与术语。')}>翻译选区</button></div></div>}{thread.messages.map((m,i)=><div className={`message ${m.role==='user'?'user-message':'assistant-message'}`} key={i}><span className="message-label">{m.role==='user'?['我的问题',questionTime(m.createdAt)].filter(Boolean).join(' · '):'页边'}</span>{m.role==='assistant'?<><div onMouseUp={e=>{const sel=window.getSelection();if(sel?.rangeCount&&e.currentTarget.contains(sel.getRangeAt(0).commonAncestorContainer)&&sel.toString().trim()){setQuote(sel.toString().trim().slice(0,5000));}}}><MarkdownAnswer content={m.content}/></div>{thread.messages[i-1]?.page&&<button type="button" className="answer-source" onClick={()=>{setPage(thread.messages[i-1].page!);setMobilePanel(false)}}>查看第 {thread.messages[i-1].page} 页原文</button>}<button type="button" className="save-answer" onClick={()=>{
 const prompt=thread.messages.slice(0,i).findLast(item=>item.role==='user');
 setInsert({id:Date.now(),text:['## '+doc.name+(prompt?.page?' · 第 '+prompt.page+' 页':''),noteSource(prompt?.page),prompt&&'### '+prompt.content,m.content].filter(Boolean).join('\n\n')});
 setTab('note');
 }}><NotebookPen size={14}/>存入笔记</button>{!!m.memorySources?.length&&<div className="references"><span>参考的学习主题</span>{m.memorySources.map(source=><button type="button" key={source.topic} onClick={()=>openMemorySource(source)}>{source.topic} · 第 {source.page} 页</button>)}</div>}{m.processing&&<small className="processing-receipt">{m.processing.message}</small>}</>:<div>{m.content}</div>}</div>)}{currentPending&&<div className="thinking" role="status"><span/><span/><span/>正在沿着你的问题思考</div>}{receipts[active]&&<p className="question-receipt" role="status">{receipts[active]}</p>}{errors[active]&&<div className="thread-error" role="alert">{errors[active]} {failedAsk&&replayLabel}<button type="button" className="text-button" disabled={currentPending||!ready||(creditBlocked&&!failedAsk?.sent)} onClick={()=>void ask(attempts.current.get(active)?.question||question)}>重试原问题</button><button className="text-button" onClick={()=>setQuestion(thread.messages.filter(m=>m.role==='user').at(-1)?.content||'请解释选区内容。')}>重新编辑问题</button></div>}{!!thread.refs?.length&&<div className="references"><span>参考了你的课程记忆</span>{thread.refs.map(id=>{const ref=threads.find(t=>t.id===id);return ref?<button key={id} onClick={()=>openThread(ref)}><Icon name="chat" size={13}/>第 {ref.page} 页 · {selectionLabel(ref).slice(0,24)}<Icon name="chevron" size={12}/></button>:<span key={id}>历史讨论 {id.slice(0,8)}</span>;})}</div>}<div ref={bottom}/></div><div className="citation-tools">{excerpts.length>0&&<button type="button" onClick={saveExcerpts} title="保留页码，直接写入学习笔记">摘录文字到笔记</button>}{quote&&<button onClick={()=>{addCitation(active,{page,text:'引自讲解：'+quote});setQuote('')}}>引用选中的回答</button>}{thread.messages.some(m=>m.role==='assistant')&&<button onClick={()=>{setInsert({id:Date.now(),text:'## '+doc.name+' · 第 '+thread.page+' 页\n\n'+noteSource(thread.page)+'\n\n'+thread.messages.map(m=>(m.role==='user'?'### 问题\n\n':'### 讲解\n\n')+m.content).join('\n\n')});setTab('note')}}>对话转笔记</button>}<label className="attach-file" title="支持 PNG、JPEG、WebP 图片">添加文件<input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={async e=>{const files=Array.from(e.target.files||[]);e.target.value='';for(const f of files.slice(0,12-citations.length)){if(f.size>8*1024*1024){setError('每张图片最多 8 MiB');continue}const r=new FileReader();r.onload=()=>addCitation(active,{page,image:String(r.result),text:f.name});r.readAsDataURL(f)}}}/></label>{((thread.text&&!omitPrimary[active]&&thread.text!=='按页提问')||primaryImage||citations.length>0)&&<div className="citation-list" aria-label="本次引用">
 {thread.text&&!omitPrimary[active]&&thread.text!=='按页提问'&&<div className="citation-chip" title={thread.text}><button type="button" className="citation-locate" aria-label={`定位第 ${thread.page} 页：${thread.text}`} onClick={()=>{requestReaderPage(thread.page);setMobilePanel(false)}}><small>P{thread.page}</small><span>{thread.text}</span></button><button type="button" className="citation-remove" disabled={currentPending} aria-label={`移除引用：${thread.text}`} onClick={()=>setOmitPrimary(v=>({...v,[active]:true}))}>×</button></div>}
 {primaryImage&&<div className="citation-chip"><small>P{thread.page}</small><span>图片</span><button type="button" className="citation-remove" disabled={currentPending} onClick={removePrimaryImage} aria-label="移除引用：首次框选的图片">×</button></div>}
 {citations.map((c,i)=><div className="citation-chip" key={i} title={c.text||'图片'}><small>P{c.page}</small><span>{c.text||'图片'}</span><button type="button" className="citation-remove" disabled={currentPending} aria-label={`移除引用：${c.text||'图片'}`} onClick={()=>setExtras(v=>({...v,[active]:(v[active]||[]).filter((_,j)=>i!==j)}))}>×</button></div>)}</div>}</div><form className="composer" onSubmit={e=>{e.preventDefault();void ask();}}><div className="question-price" id="question-price" role="status">{priceLabel&&<span>{priceLabel}</span>}{!freeQuestion&&automaticMemory&&pricing&&<span>{automaticPriceLabel}</span>}<button type="button" className="question-account-link" onClick={()=>setAccount(true)}>积分账户</button>{!freeQuestion&&!!credits.error&&<button type="button" disabled={credits.loading} onClick={()=>void credits.refresh()}>重新读取</button>}{insufficientCredits&&<><strong>新提问的可用积分不足。保存学习笔记可获得积分，或改用 Magpie / 个人 API，站内扣分为 0.000。</strong><button type="button" onClick={()=>setTab('note')}>写笔记赚积分</button><button type="button" onClick={()=>document.querySelector<HTMLButtonElement>('.source-trigger')?.click()}>切换模型来源</button></>}{!freeQuestion&&credits.error?.includes('登录')&&<a href="/login">登录</a>}</div><label className="sr-only" htmlFor="question">向课件提问</label><textarea id="question" aria-describedby="question-price" value={question} onChange={e=>setQuestion(e.target.value)} placeholder={thread.messages.length?'继续追问，或换一种角度…':'输入问题，例如「第 3、5 页有什么联系？」或「梳理整份课件的大纲」'} rows={3}/><div className="composer-actions">{gateway?<MagpieModelPicker gateway={gateway} choose={model=>setConnection({...gateway,model})}/>:personal&&personalModel?<PersonalModelPicker profile={personal} model={personalModel} choose={model=>choosePersonal({model,revision:personal.revision})} image={!!primaryImage||citations.some(c=>!!c.image)}/>:<TutorControls value={settings} onChange={changeSettings} availability={availability}/>}<button title="发送问题" className="send-button" disabled={!question.trim()||currentPending||!ready||(creditBlocked&&!(replayQuestion&&failedAsk?.sent))} aria-describedby="question-price" aria-label="发送问题" type="submit"><Icon name="send" size={17}/></button></div></form></>}
 </aside></div>
 <dialog className="move-document-dialog" ref={moveDialog} aria-labelledby="move-document-title"
   onCancel={event=>{if(moving)event.preventDefault();}} onClose={()=>setMovingDoc(null)}>
   {movingDoc&&<form onSubmit={submitMove}>
     <h2 id="move-document-title">移动到项目</h2>
     <p className="delete-name">{movingDoc.name}</p>
     <label htmlFor="move-document-target">目标项目</label>
     <select id="move-document-target" value={moveTarget} onChange={event=>setMoveTarget(event.target.value)} required disabled={moving}>
       <option value="" disabled hidden>选择目标项目</option>
       {[...new Set([...docs.map(item=>item.course),...savedProjects])].filter(name=>name&&name!==movingDoc.course).map(name=><option key={name}>{name}</option>)}
     </select>
     {![...docs.map(item=>item.course),...savedProjects].some(name=>name&&name!==movingDoc.course)&&<p>请先在学习首页新建目标项目。</p>}
     {moveError&&<p className="form-error" role="alert">{moveError}</p>}
     <div className="dialog-actions">
       <button type="button" onClick={()=>moveDialog.current?.close()} disabled={moving}>取消</button>
       <button className="primary-button" disabled={!moveTarget||moving}>{moving?'移动中…':'确认移动'}</button>
     </div>
   </form>}
 </dialog>
 {error&&!upload&&<div className="global-error" role="alert">{error}{error.includes('登录')&&<a href="/login">登录</a>}<button className="icon-button" aria-label="关闭提示" onClick={()=>setError('')}><Icon name="close" size={15}/></button></div>}
 {upload&&<div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title"><button className="dialog-close icon-button" aria-label="关闭导入" disabled={uploading} onClick={()=>setUpload(false)}><Icon name="close"/></button><span className="dialog-kicker">我的资料库</span><h2 id="upload-title">把讲义放到页边</h2><p>PDF 或 PowerPoint，按课程收好。</p><form onSubmit={uploadFile}><label htmlFor="course">归入项目</label><input list="import-projects" id="course" autoFocus maxLength={100} required value={course} onChange={e=>setCourse(e.target.value)} placeholder="选择已有项目或输入新项目名"/><datalist id="import-projects">{[...new Set([...docs.map(d=>d.course),...savedProjects])].map(name=><option key={name} value={name}/>)}</datalist><label className="file-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files[0])dropped(e.dataTransfer.files[0])}} htmlFor="file-upload"><Icon name="upload" size={26}/><strong>{file?file.name:'选择一份讲义'}</strong><span>支持 .pdf、.pptx · 最多 20 MiB</span><input id="file-upload" type="file" accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={e=>{const f=e.target.files?.[0]||null;if(f&&f.size>20*1024*1024){setError('文件超过 20 MiB，请选择较小的文件。');setFile(null);}else{setError('');setFile(f);}}}/></label>{error&&<p className="form-error" role="alert">{error}{error.includes('登录')&&<a href="/login"> 登录</a>}</p>}<button className="primary-button" disabled={!file||!course.trim()||uploading}>{uploading?'正在导入…':'导入并开始阅读'}</button><small className="upload-privacy"><Icon name="lock" size={12}/>资料与讨论保存在你的账户下</small></form></section></div>}
 {remove&&<div className="modal-backdrop"><section className="dialog delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">删除这{remove.kind==='doc'?'份讲义':'条讨论'}？</h2><p className="delete-name">{remove.name}</p><p>{remove.kind==='doc'?'这份讲义及其全部讨论和课程记忆将被删除。':'这条讨论及其课程记忆将被删除。'}此操作无法撤销。</p><div className="dialog-actions"><button disabled={deleting} onClick={()=>setRemove(null)}>保留</button><button className="danger-button" disabled={deleting} onClick={()=>void confirmDelete()}>{deleting?'正在删除…':'确认删除'}</button></div></section></div>}
 </main>;
}
