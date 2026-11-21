import {manageProject,projectName} from './study-projects.ts';
import {learningAccount,persistWithCredit,parseCreditCursor,validRequestId,requestFingerprint,claimCreditRequest,releaseCreditRequest,creditQuote,sitePricing,settleSiteMemory,settleSiteAnswer} from './learning-credits.ts';
import {holdForOperation,openSiteOperation,runSiteCall,siteReceipt,UnpricedSiteUsage,type SiteOperation} from './site-billing.ts';
import {makeSearchTask, memoryMatches, memoryPromptData, type ModelTask, type MemorySourceRef} from '../lib/learning-memory.ts';
import {ProjectMemory, memorySourceRefs} from './project-memory.ts';
import {notebook,shelf} from './study-organizer.ts';
import {handleProviderSettings,selectedPersonalModel} from './provider-settings.ts';
import type {probeVision} from './vision-probe.ts';
import { askPersonal, type probePersonal, checkRuntimeEndpoint, loadProfile, PersonalError, type PersonalProfile } from './personal-api.ts';
import { resolveTutorSettings, type TutorModelDiscovery, type TutorProcessing, type TutorSettings } from '../lib/tutor-models.ts';
import type { TutorInput, TutorAnswer } from './tutor.ts';
import { lastAnsweredQuestion, memoryContent, difficultyQuestions, projectLearningContext, retrieveMemories } from './memory-retrieval.ts';

type Message = { requestId?:string; role: string; content: string; processing?:TutorProcessing; createdAt?:number; page?:number; excerpt?:string; memorySources?:MemorySourceRef[] };
type Context = { diagnose?:typeof probePersonal; probe?:typeof probeVision; db:D1Database|undefined; bucket:R2Bucket|undefined; owner:string; displayName?:string|null; key?:string; siteModelPause?:string; siteUsagePricing?:boolean; answer:(input:TutorInput)=>Promise<string|TutorAnswer>; models?:(key:string)=>Promise<TutorModelDiscovery> };
type Doc = {id:string; owner:string; name:string; kind:string; course:string; object_key:string};
type Thread = {mastered?:string;id:string; created:number; owner:string; doc_id:string; page:number; selection_text:string|null; image:string|null; rect:string|null; messages:string; refs:string};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const pausedSiteModel=(message:string)=>json({error:message,code:'site_model_paused'},503);
const MAX_FILE=20*1024*1024;
export function sameOriginWrite(request:Request) {
  return request.headers.get('origin')===new URL(request.url).origin&&request.headers.get('sec-fetch-site')!=='cross-site';
}
async function boundedBody(request:Request,max:number):Promise<Uint8Array|null> {
  const declared=request.headers.get('content-length');
  if(declared&&(!/^\d+$/.test(declared)||Number(declared)>max))return null;
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();return null;}chunks.push(value);}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
/** Inspect ZIP directory without inflating untrusted PPTX entries. */
function safePptx(bytes:ArrayBuffer):boolean {
  const v=new DataView(bytes);const decoder=new TextDecoder();let end=-1;
  for(let p=v.byteLength-22;p>=Math.max(0,v.byteLength-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
  if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))return false;
  const count=v.getUint16(end+10,true);let p=v.getUint32(end+16,true);let total=0;const names=new Set<string>();
  if(!count||count>3000||p>=end)return false;
  for(let i=0;i<count;i++) {
    if(p+46>end||v.getUint32(p,true)!==0x02014b50||(v.getUint16(p+8,true)&1))return false;
    const compressed=v.getUint32(p+20,true),size=v.getUint32(p+24,true),len=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true);
    if(p+46+len+extra+comment>end||size>MAX_FILE||(size>1_000_000&&size>Math.max(1,compressed)*100))return false;
    total+=size;if(total>50*1024*1024)return false;
    const name=decoder.decode(bytes.slice(p+46,p+46+len));
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||names.has(name))return false;
    names.add(name);p+=46+len+extra+comment;
  }
  return names.has('[Content_Types].xml')&&names.has('ppt/presentation.xml');
}
const imageMime=(key:string)=>`image/${key.split('.').pop()}`;
function imageDataUri(key:string,buffer:ArrayBuffer):string {
  const bytes=new Uint8Array(buffer);let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return `data:${imageMime(key)};base64,${btoa(binary)}`;
}
const parseThread=(t:Thread)=>({id:t.id,createdAt:t.created,docId:t.doc_id,page:t.page,...(t.mastered&&t.mastered!=='[]'?{mastered:JSON.parse(t.mastered)}:{}),text:t.selection_text??undefined,image:t.image?`/api/study/threads/${t.id}/image`:undefined,rect:t.rect?JSON.parse(t.rect):undefined,messages:JSON.parse(t.messages),refs:JSON.parse(t.refs)});

/** Request identity is provided exclusively by the Sites server auth helper. */
export async function handleStudy(request:Request,path:string[],ctx:Context):Promise<Response> {
  if(!ctx.owner)return json({error:'请先使用 ChatGPT 登录。'},401);
  if(path.join('/')==='models'&&request.method==='GET') {
    if(ctx.siteModelPause)return json({status:'empty',models:[],message:ctx.siteModelPause});
    if(!ctx.key||!ctx.models)return json({status:'unavailable',models:[],message:'管理员尚未配置模型列表查询。'},503);
    return json(await ctx.models(ctx.key));
  }
  if(path.join('/')==='account'&&request.method==='GET') {
    if(!ctx.db)return json({error:'学习账户存储尚未配置。'},503);
    try {if(new URL(request.url).searchParams.get('view')==='quote')return json(await creditQuote(ctx.db,ctx.owner));const cursor=parseCreditCursor(new URL(request.url).searchParams.get('cursor'));return json({displayName:ctx.displayName??null,...await learningAccount(ctx.db,ctx.owner,Date.now(),cursor)});}
    catch(error) {return error instanceof TypeError?json({error:'积分记录游标无效。'},400):json({error:'学习账户暂时不可用，请稍后重试。'},503);}
  }
  if(!ctx.db||!ctx.bucket)return json({error:'学习资料存储尚未配置。'},503);
  const {db,bucket,owner}=ctx;
  const getDoc=(id:string)=>db.prepare('SELECT * FROM documents WHERE id=? AND owner=?').bind(id,owner).first<Doc>();
  const getThread=(id:string)=>db.prepare('SELECT * FROM threads WHERE id=? AND owner=?').bind(id,owner).first<Thread>();
  const masteryColumn="(SELECT json_group_array(m.question) FROM study_mastery m WHERE m.thread_id=t.id AND m.owner=t.owner) AS mastered";
  const ensureMastery=()=>db.prepare('CREATE TABLE IF NOT EXISTS study_mastery (owner TEXT NOT NULL, thread_id TEXT NOT NULL, question TEXT NOT NULL, PRIMARY KEY(owner, thread_id, question), FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE)').run();
  async function projectCandidates(thread:Thread,course:string){
    await ensureMastery();
    return (await db.prepare('SELECT t.*, '+masteryColumn+', d.name AS document_name FROM threads t JOIN documents d ON d.id=t.doc_id WHERE t.owner=? AND d.owner=? AND d.course=? AND t.id<>? AND NOT EXISTS (SELECT 1 FROM memory_evidence e WHERE e.owner=t.owner AND e.thread_id=t.id) ORDER BY t.created DESC LIMIT 100').bind(owner,owner,course,thread.id).all<Thread & {document_name:string}>()).results;
  }
  const projectMemory=new ProjectMemory(db,owner);
  async function personalFor(source:unknown,revision:unknown,model:unknown){
    if(source===undefined)return null;
    if(source!=='personal')throw new PersonalError('模型来源无效。');
    const profile=await loadProfile(bucket,owner);
    if(!profile||profile.revision!==revision)throw new PersonalError('自带 API 配置已变更，请重新打开模型来源。',409);
    const selected=selectedPersonalModel(profile,model);
    checkRuntimeEndpoint(selected,request.url);
    return selected;
  }
  async function runMemoryModel(task:ModelTask,personal:PersonalProfile|null,settings:Partial<TutorSettings>,purpose:'retrieval'|'index',operation?:SiteOperation){
    const input={question:'整理项目学习记录',history:[],memories:[],modelTask:task};
    if(personal)return askPersonal(personal,input);
    if(!ctx.key||!operation)throw Error('站点模型未配置。');
    const result=await runSiteCall(db!,owner,operation,purpose,{...input,key:ctx.key,siteUsagePricing:ctx.siteUsagePricing,model:settings.model,reasoningEffort:'low'},ctx.answer);
    return typeof result==='string'?result:result.answer;
  }
  function questionMessage(question:string,page:unknown,excerpt:unknown):Message{
    return {role:'user',content:question,createdAt:Date.now(),
      ...(typeof page==='number'&&Number.isSafeInteger(page)&&page>0?{page}:{}),
      ...(typeof excerpt==='string'?{excerpt:excerpt.slice(0,700)}:{}),
    };
  }
  try {
    if(request.method==='POST') {
      const body=await boundedBody(request,path.join('/')==='docs'?MAX_FILE+128*1024:path[0]==='personal-api'?64*1024:3_100_000);
      if(!body)return json({error:'请求过大，请缩小文件或选区。'},413);
      request=new Request(request.url,{method:request.method,headers:request.headers,body:body as BodyInit});
    }
    if(path.join('/')==='notebook' && ['GET','POST'].includes(request.method))return notebook(request,db,owner);
    if(path[0]==='personal-api')return await handleProviderSettings(request,path,{bucket,owner,probe:ctx.probe,diagnose:ctx.diagnose});
    if(path[0]==='memory') {
      const payload=request.method==='POST' ? await request.json() as {
        course?:string; threadId?:string; token?:string; requestId?:unknown; maxCredits?:unknown; output?:string; topic?:string; mastered?:boolean;
        source?:unknown; revision?:unknown; model?:unknown; reasoningEffort?:unknown; speed?:unknown;
      } : undefined;
      const course=payload?.course??new URL(request.url).searchParams.get('course');
      if(typeof course!=='string'||!course||course.length>100)return json({error:'请选择项目。'},400);
      await ensureMastery();
      if(path.length===1&&request.method==='GET')return json(await projectMemory.view(course));
      if(payload&&path.length===2&&request.method==='POST'){
        if(path[1]==='status'&&typeof payload.topic==='string'&&typeof payload.mastered==='boolean'){
          const updated=await projectMemory.setMastered(course,payload.topic,payload.mastered);
          return updated?json({ok:true}):json({error:'找不到这个学习主题。'},404);
        }
        if(path[1]==='start')return json(await projectMemory.start(course,typeof payload.threadId==='string'?payload.threadId:undefined));
        if(path[1]==='index'){
          const personal=await personalFor(payload.source,payload.revision,payload.model);
          if(!personal&&!ctx.key)return json({error:'请先选择可用的模型来整理记忆。'},503);
          const settings=personal?{}:resolveTutorSettings(payload);
          const priority=typeof payload.threadId==='string'?payload.threadId:undefined;
          let operation:SiteOperation|undefined,jobToken:string|undefined;
          if(!personal){
            const opened=await openSiteOperation(db,owner,payload.requestId,['index',course,priority??null,settings],payload.maxCredits,'index');
            if(opened.reply)return opened.reply;
            operation=opened.operation;
          }
          try{
            if(operation&&ctx.siteModelPause)return pausedSiteModel(ctx.siteModelPause);
            const {job,busy}=await projectMemory.start(course,priority);
            if(!job)return json({indexed:false,busy:!!busy,creditsCharged:0});
            jobToken=job.token;
            if(operation){
              const rejected=await holdForOperation(db,owner,operation,payload.maxCredits,sitePricing.memoryCap);
              if(rejected)return rejected;
            }
            const output=await runMemoryModel(job.task,personal,settings,'index',operation);
            if(!operation){
              await projectMemory.finish(course,job.token,output);
              return json({indexed:true,creditsCharged:0});
            }
            const action=await projectMemory.evidenceWrite(course,job.token,output);
            const usage=siteReceipt(operation);
            const response={indexed:true,creditsCharged:usage.creditsCharged};
            const detail={course,operation:'index',source:'site',model:usage.calls.at(-1)?.model,...usage};
            const settled=await settleSiteMemory(db,{owner,requestId:operation.id,token:operation.token,charge:usage.creditsCharged,
              sourceId:course,detail,response:JSON.stringify(response),action});
            return settled?json(response):json({error:'整理状态已变更，本次未扣费，请重试。'},409);
          }catch(error){
            if(error instanceof UnpricedSiteUsage)return json({error:'站点模型本次无法核算用量，整理未保存，未扣积分。'},502);
            return json({error:'当前模型未能完成整理，可以稍后重试。'},502);
          }finally{
            if(jobToken)await projectMemory.cancel(course,jobToken);
            if(operation)await releaseCreditRequest(db,owner,operation.id,operation.token);
          }
        }
        if(typeof payload.token==='string'&&payload.token.length<=40) {
          if(path[1]==='cancel'){await projectMemory.cancel(course,payload.token);return json({ok:true});}
          if(path[1]==='finish'&&typeof payload.output==='string'&&payload.output.length<=24_000){
            try{await projectMemory.finish(course,payload.token,payload.output);}
            catch(error){return json({error:error instanceof Error?error.message:'未能整理记忆。'},422);}
            return json({ok:true});
          }
        }
      }
      return json({error:'找不到这个操作。'},404);
    }
    if(path.join('/')==='projects'&&request.method==='POST') {
      const body=await request.json() as {name?:unknown}|null;
      const name=projectName(body?.name);
      if(!name)return json({error:'请输入 1 到 100 字的项目名称。'},400);
      await db.prepare('INSERT INTO study_projects(owner,name) VALUES(?,?) ON CONFLICT(owner,name) DO NOTHING').bind(owner,name).run();
      return json({name});
    }
    if(path.join('/')==='projects/manage'&&request.method==='POST'){
      const result=await manageProject(db,owner,await request.json());
      return json(result.body,result.status);
    }
    if(path.join('/')==='state'&&request.method==='GET') {
      await shelf(db);
      const docs=await db.prepare('SELECT id,name,kind,course,coalesce(s.pinned,0) pinned,coalesce(nullif(s.visited,0),created) visited FROM documents LEFT JOIN shelf s ON s.doc=id WHERE owner=? ORDER BY visited DESC').bind(owner).all<Pick<Doc,'id'|'name'|'kind'|'course'>>();
      await ensureMastery();
      const threads=await db.prepare('SELECT t.*, '+masteryColumn+' FROM threads t WHERE owner=? ORDER BY created').bind(owner).all<Thread>();
      const courses=new Map(docs.results.map(doc=>[doc.id,doc.course]));
      const saved=await db.prepare('SELECT name FROM study_projects WHERE owner=? ORDER BY name').bind(owner).all<{name:string}>();
      return json({projects:saved.results.map(row=>row.name),docs:docs.results,threads:threads.results.map(thread=>{
        const parsed=parseThread(thread);
        if(!parsed.refs.length)return parsed;
        const question=lastAnsweredQuestion(parsed.messages);
        const course=courses.get(thread.doc_id);
        const storedRefs=new Set<string>(parsed.refs);
        const candidates=threads.results.filter(candidate=>candidate.id!==thread.id&&storedRefs.has(candidate.id)&&course!==undefined&&courses.get(candidate.doc_id)===course);
        const valid=new Set(question===undefined?[]:retrieveMemories({selection:thread.selection_text,question},candidates).map(candidate=>candidate.id));
        for(const candidate of candidates)if(candidate.doc_id===thread.doc_id&&/没懂|不懂|不会|不理解|搞不清|困惑/.test(lastAnsweredQuestion(JSON.parse(candidate.messages))??''))valid.add(candidate.id);
        return {...parsed,refs:parsed.refs.filter((id:string)=>valid.has(id))};
      })});
    }
    if(path.length===1&&path[0]==='docs'&&request.method==='POST') {
      const form=await request.formData();const file=form.get('file');const course=String(form.get('course')??'').trim();
      if(!(file instanceof File)||!course||course.length>100||file.name.length>200||!file.size||file.size>MAX_FILE)return json({error:'请选择不超过 20 MB 的文件，并填写课程（最多 100 字）。'},400);
      const kind=file.name.toLowerCase().split('.').pop();
      if(!['pdf','pptx'].includes(kind??''))return json({error:'仅支持 PDF 和 PPTX 文件。'},400);
      const bytes=await file.arrayBuffer();const magic=new Uint8Array(bytes,0,Math.min(5,bytes.byteLength));
      const mime=kind==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      if((file.type&&file.type!==mime&&file.type!=='application/octet-stream')||(kind==='pdf'?!new TextDecoder().decode(magic).startsWith('%PDF-'):!safePptx(bytes)))return json({error:'文件格式不符，或 PPTX 压缩包超过安全限制。'},400);
      const id=crypto.randomUUID();const objectKey=`documents/${id}`;
      await bucket.put(objectKey,bytes);
      try {await db.prepare('INSERT INTO documents (id,owner,name,kind,course,object_key,created) VALUES (?,?,?,?,?,?,?)').bind(id,owner,file.name,kind,course,objectKey,Date.now()).run();}
      catch(e){await bucket.delete(objectKey);throw e;}
      return json({id});
    }
    if(path[0]==='docs'&&path[1]) {
      const doc=await getDoc(path[1]);if(!doc)return json({error:'找不到这份资料。'},404);
      if(path.length===3 && path[2]==='organize' && request.method==='POST'){
        const v=await request.json() as {pinned?:boolean;course?:string;visit?:boolean;existingProject?:boolean};
        await shelf(db);
        if(v.course!==undefined){
          const target=projectName(v.course);
          if(!target)return json({error:'请选择有效的目标项目。'},400);
          if(target!==doc.course){
            const [,,updated]=await db.batch([
              db.prepare(`INSERT INTO study_projects(owner,name)
                SELECT ?,? WHERE (?=0 OR EXISTS(SELECT 1 FROM documents WHERE owner=? AND course=?))
                AND EXISTS(SELECT 1 FROM documents WHERE owner=? AND id=?)
                ON CONFLICT(owner,name) DO NOTHING`).bind(owner,target,Number(v.existingProject===true),owner,target,owner,doc.id),
              db.prepare(`INSERT INTO study_projects(owner,name)
                SELECT owner,course FROM documents WHERE owner=? AND id=?
                AND EXISTS(SELECT 1 FROM study_projects WHERE owner=? AND name=?)
                ON CONFLICT(owner,name) DO NOTHING`).bind(owner,doc.id,owner,target),
              db.prepare(`UPDATE documents SET course=? WHERE owner=? AND id=?
                AND EXISTS(SELECT 1 FROM study_projects WHERE owner=? AND name=?)`).bind(target,owner,doc.id,owner,target)
            ]);
            const changes=updated.meta?.changes??(updated as unknown as {changes:number}).changes;
            if(!changes)return json({error:'资料或目标项目已变更，请刷新后重试。'},409);
          }
        }
        if(typeof v.pinned==='boolean')await db.prepare('INSERT INTO shelf(doc,pinned) VALUES(?,?) ON CONFLICT(doc) DO UPDATE SET pinned=excluded.pinned').bind(doc.id,Number(v.pinned)).run();
        if(v.visit===true)await db.prepare('INSERT INTO shelf(doc,visited) VALUES(?,?) ON CONFLICT(doc) DO UPDATE SET visited=excluded.visited').bind(doc.id,Date.now()).run();
        return json({ok:true});
      }
      if(path.length===3&&path[2]==='file'&&request.method==='GET') {
        const object=await bucket.get(doc.object_key);if(!object)return json({error:'资料文件不可用。'},404);
        const mime=doc.kind==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        return new Response(object.body,{headers:{'Content-Type':mime,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(path.length===2&&request.method==='DELETE') {
        // Delete the binary first: a storage failure leaves the record available for retry.
        const images=await db.prepare('SELECT image FROM threads WHERE doc_id=? AND owner=? AND image IS NOT NULL').bind(doc.id,owner).all<{image:string}>();
        for(const {image} of images.results)await bucket.delete(image);
        await bucket.delete(doc.object_key);
        await db.prepare('UPDATE threads SET refs=(SELECT json_group_array(value) FROM json_each(threads.refs) WHERE value NOT IN (SELECT id FROM threads WHERE doc_id=? AND owner=?)) WHERE owner=?').bind(doc.id,owner,owner).run();
        await db.prepare('DELETE FROM threads WHERE doc_id=? AND owner=?').bind(doc.id,owner).run();
        await db.prepare('DELETE FROM documents WHERE id=? AND owner=?').bind(doc.id,owner).run();
        return json({ok:true});
      }
    }
    if(path.length===1&&path[0]==='threads'&&request.method==='POST') {
      const v=await request.json() as Record<string,unknown>;
      const text=typeof v.text==='string'?v.text.trim():undefined;const image=typeof v.image==='string'?v.image:undefined;
      if(typeof v.docId!=='string'||!Number.isInteger(v.page)||Number(v.page)<1||(!text&&!image&&v.unanchored!==true)||(text?.length??0)>20000||(image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)||image.length>3_000_000)))return json({error:'请选择有效页码和文字或图片区域。'},400);
      if(v.rect!==undefined&&(!v.rect||typeof v.rect!=='object'||Object.values(v.rect).some(x=>typeof x!=='number'||!Number.isFinite(x))))return json({error:'图片区域无效。'},400);
      if(!await getDoc(v.docId))return json({error:'找不到这份资料。'},404);
      const creationId=v.requestId;
      if(creationId!==undefined&&!validRequestId(creationId))return json({error:'requestId 必须是 UUID。'},400);
      const creationKey=creationId?'create:'+creationId:undefined;
      let creationClaim:Awaited<ReturnType<typeof claimCreditRequest>>|undefined;
      if(creationKey){
        const payload={...v};delete payload.requestId;
        creationClaim=await claimCreditRequest(db,owner,creationKey,await requestFingerprint(payload));
        if(creationClaim.conflict)return json({error:'requestId 已用于其他选区。'},409);
        if(creationClaim.response)return json(JSON.parse(creationClaim.response));
        if(creationClaim.busy)return json({error:'选区正在保存，请稍后重试。'},409);
      }
      const id=crypto.randomUUID();let imageKey:string|null=null;
      try {
        if(image) {
          const [header,base64]=image.split(',');const extension=header.match(/^data:image\/(png|jpeg|webp);base64$/)![1];
          let binary:string;try{binary=atob(base64);}catch{return json({error:'图片数据无效。'},400);}
          imageKey=`selections/${id}.${extension}`;
          await bucket.put(imageKey,Uint8Array.from(binary,c=>c.charCodeAt(0)));
        }
        const values=[id,owner,v.docId,v.page,text??null,imageKey,v.rect?JSON.stringify(v.rect):null,'[]','[]',Date.now()];
        if(creationKey){
          const [inserted]=await db.batch([
            db.prepare('INSERT INTO threads (id,owner,doc_id,page,selection_text,image,rect,messages,refs,created) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM credit_requests WHERE owner=? AND request_id=? AND token=? AND response IS NULL)').bind(...values,owner,creationKey,creationClaim!.token),
            db.prepare('UPDATE credit_requests SET response=? WHERE owner=? AND request_id=? AND token=? AND changes()>0').bind(JSON.stringify({id}),owner,creationKey,creationClaim!.token),
          ]);
          if((inserted.meta?.changes??(inserted as unknown as {changes:number}).changes)===0){if(imageKey)await bucket.delete(imageKey);return json({error:'选区保存冲突，请重试。'},409);}
        }else await db.prepare('INSERT INTO threads (id,owner,doc_id,page,selection_text,image,rect,messages,refs,created) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(...values).run();
        return json({id});
      }catch(e){if(imageKey)await bucket.delete(imageKey);throw e;}
      finally{if(creationKey&&creationClaim)await releaseCreditRequest(db,owner,creationKey,creationClaim.token);}
    }
    if(path[0]==='threads'&&path[1]) {
      const thread=await getThread(path[1]);if(!thread)return json({error:'找不到这个问题线程。'},404);
      if(path.length===3&&path[2]==='image'&&request.method==='GET') {
        if(!thread.image)return json({error:'这个线程没有图片选区。'},404);
        const object=await bucket.get(thread.image);if(!object)return json({error:'图片选区不可用。'},404);
        return new Response(object.body,{headers:{'Content-Type':imageMime(thread.image),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if(path.length===2&&request.method==='DELETE') {
        if(thread.image)await bucket.delete(thread.image);
        await db.prepare('UPDATE threads SET refs=(SELECT json_group_array(value) FROM json_each(threads.refs) WHERE value<>?) WHERE owner=?').bind(thread.id,owner).run();
        await db.prepare('DELETE FROM threads WHERE id=? AND owner=?').bind(thread.id,owner).run();return json({ok:true});
      }
      if(path.length===3&&path[2]==='mastery'&&request.method==='POST'){
        const {question,mastered}=await request.json() as {question:string;mastered:boolean};
        if(typeof mastered!=='boolean'||!difficultyQuestions(JSON.parse(thread.messages)).includes(question))return json({error:'找不到这条待巩固记录。'},400);
        await ensureMastery();
        await db.prepare(mastered?'INSERT OR IGNORE INTO study_mastery(owner,thread_id,question) VALUES(?,?,?)':'DELETE FROM study_mastery WHERE owner=? AND thread_id=? AND question=?').bind(owner,thread.id,question).run();
        return json({ok:true});
      }
      if(path.length===3&&path[2]==='project-memory'&&request.method==='POST'){
        const {question,omitPrimaryText,context}=await request.json() as {question?:string;omitPrimaryText?:boolean;context?:string};
        if(typeof question!=='string'||question.length>4000)return json({error:'问题长度无效'},400);
        const doc=await getDoc(thread.doc_id);if(!doc)return json({error:'资料已删除。'},404);
        const candidates=await projectCandidates(thread,doc.course);
        const preferred=retrieveMemories({selection:omitPrimaryText?null:thread.selection_text,question},candidates);
        const excerpt=[omitPrimaryText?null:thread.selection_text,typeof context==='string'?context.slice(0,3000):''].filter(Boolean).join('\n');
        const catalog=await projectMemory.searchCatalog(doc.course,question+' '+excerpt,thread.id);
        return json({learningContext:projectLearningContext(candidates,preferred),catalog});
      }
      if(path.length===3&&path[2]==='local-answer'&&request.method==='POST'){
        const {question,answer,previous,sourcePage,excerpt,memoryKeys}=await request.json() as {question:string;answer:string;previous:number;sourcePage?:number;excerpt?:string;memoryKeys?:string[]};
        const history=JSON.parse(thread.messages);
        if(typeof question!=='string'||typeof answer!=='string'||!answer.trim()||!question.trim()||answer.length>100000||question.length>4000)return json({error:'问答长度无效'},400);
        if(previous!==history.length)return json({error:'讨论已更新，请刷新'},409);
        let memorySources:MemorySourceRef[]|undefined;
        if(Array.isArray(memoryKeys)&&memoryKeys.length&&memoryKeys.length<=4){
          const doc=await getDoc(thread.doc_id);
          if(doc){await ensureMastery();const cards=await projectMemory.topics(doc.course);
            const matched=cards.filter(card=>memoryKeys.includes(card.key)).flatMap(card=>{
              const evidence=card.evidence.filter(source=>source.threadId!==thread.id);
              return evidence.length?[{...card,evidence}]:[];
            });
            memorySources=memorySourceRefs(matched);
          }
        }
        history.push(questionMessage(question,sourcePage,excerpt),{role:'assistant',content:answer,...(memorySources?.length?{memorySources}:{})});
        const result=await persistWithCredit(db,db.prepare('UPDATE threads SET messages=? WHERE id=? AND owner=? AND messages=?').bind(JSON.stringify(history),thread.id,owner,thread.messages),owner,'discussion_completed',thread.id);
        return (result.meta?.changes??(result as unknown as {changes:number}).changes)?json({answer,refs:[],memorySources,creditsCharged:0}):json({error:'讨论已更新，请刷新'},409);
      }
      if(path.length===3&&path[2]==='ask'&&request.method==='POST') {
        const v=await request.json() as {requestId?:unknown;maxCredits?:unknown;sourcePage?:number;omitPrimaryImage?:boolean; omitPrimaryText?:boolean; context?:string; attachment?:string; source?:unknown; revision?:unknown; question?:unknown; model?:unknown; reasoningEffort?:unknown; speed?:unknown};const question=typeof v.question==='string'?v.question.trim():'';
        if(!question||question.length>4000)return json({error:'问题不能为空，且不超过 4000 字。'},400);
        if(v.context!==undefined&&(typeof v.context!=='string'||v.context.length>40000))return json({error:'引用过长，请减少页数。'},400);
        if(v.attachment!==undefined&&(typeof v.attachment!=='string'||v.attachment.length>2800000||!/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(v.attachment)))return json({error:'附图格式无效'},400);
        const primaryImage=v.omitPrimaryImage===true?null:thread.image;
        const personal=await personalFor(v.source,v.revision,v.model);
        if(personal&&(primaryImage||v.attachment)&&!personal.vision)return json({error:'自带模型未启用图片输入。'},400);
        let settings;
        try { settings=personal?{}:resolveTutorSettings(v); }
        catch(error) { return json({error:(error as Error).message},400); }
        let operation:SiteOperation|undefined;
        const requestId=typeof v.requestId==='string'?v.requestId:'';
        if(!personal){
          const parts=[thread.id,question,v.context??null,v.attachment??null,v.omitPrimaryImage??false,v.omitPrimaryText??false,v.sourcePage??null,settings];
          const opened=await openSiteOperation(db,owner,requestId,parts,v.maxCredits,'answer');
          if(opened.reply)return opened.reply;
          operation=opened.operation;
        }
        try {
          if(operation){
            if(ctx.siteModelPause)return pausedSiteModel(ctx.siteModelPause);
            const rejected=await holdForOperation(db,owner,operation,v.maxCredits,sitePricing.answerCap);
            if(rejected)return rejected;
          }
          const history:Message[]=JSON.parse(thread.messages);
          if(!personal&&history.at(-1)?.role==='user'&&history.at(-1)?.requestId===requestId)history.pop();
          const updated=[...history,{...questionMessage(question,v.sourcePage,v.context??(v.omitPrimaryText?'':thread.selection_text)),...(!personal?{requestId}:{})}];
          const pending=JSON.stringify(updated);
          const saved=await db.prepare('UPDATE threads SET messages=? WHERE id=? AND owner=? AND messages=?').bind(pending,thread.id,owner,thread.messages).run();
          if((saved.meta?.changes??(saved as unknown as {changes:number}).changes)===0)return json({error:'线程刚刚更新，请刷新后重新提问。'},409);
          if(!personal&&!ctx.key)return json({error:'问题已保存。管理员尚未配置站点模型密钥，请稍后重试。'},503);
          const doc=await getDoc(thread.doc_id);if(!doc)return json({error:'资料已删除。'},404);
          const candidates=await projectCandidates(thread,doc.course);
          const primaryText=v.omitPrimaryText===true?null:thread.selection_text;
          const relevant=retrieveMemories({selection:primaryText,question},candidates);
          const learningContext=projectLearningContext(candidates,relevant);
          const difficulty=candidates.find(t=>t.doc_id===doc.id&&!relevant.some(r=>r.id===t.id)&&difficultyQuestions(JSON.parse(t.messages)).some(q=>!JSON.parse(t.mastered??'[]').includes(q)));
          if(difficulty && relevant.length<3)relevant.push(difficulty);
          const text=[primaryText,v.context].filter(Boolean).join("\n")||undefined;
          let matching:ReturnType<typeof memoryMatches>|undefined;
          try{
            const catalog=await projectMemory.searchCatalog(doc.course,question+' '+(text??''),thread.id);
            if(catalog.length){
              const task=makeSearchTask(question,text??'',history.findLast(message=>message.role==='user')?.content??'',catalog);
              matching=memoryMatches(await runMemoryModel(task,personal,settings,'retrieval',operation),catalog);
            }
           }catch{
            // An unusable model search can fall back to the existing context free of charge.
            const search=operation?.calls.find(call=>call.purpose==='retrieval');
            if(search)search.chargeable=false;
          }
          const refs=matching?[]:relevant.map(t=>t.id);
          const memories=matching?[]:relevant.map(memoryContent);
          const memorySources=matching?.length?memorySourceRefs(matching):undefined;
          try {
            let image:string|undefined;
            if(primaryImage&&!v.attachment) {
              const object=await bucket.get(primaryImage);
              if(!object)return json({error:'问题已保存，但图片选区不可用，请重新框选。'},404);
              image=imageDataUri(primaryImage,await object.arrayBuffer());
            }
            const input={text,image:v.attachment??image,question,history:history.slice(-20),memories,learningContext:matching?undefined:learningContext,studyTopics:matching?memoryPromptData(matching):undefined};
            const result=personal?await askPersonal(personal,input):await runSiteCall(db,owner,operation!,'answer',{...input,key:ctx.key!,siteUsagePricing:ctx.siteUsagePricing,...settings},ctx.answer);
            const {answer,processing}=typeof result==='string'?{answer:result,processing:undefined}:result;
            if(typeof answer!=='string'||!answer.trim())throw new Error('Empty answer');
            updated.push({role:'assistant',content:answer,...(processing?{processing}:{}),...(memorySources?{memorySources}:{})});
            const usage=operation?siteReceipt(operation):undefined;
            const response={answer,refs,creditsCharged:usage?.creditsCharged??0,...(processing?{processing}:{}),...(memorySources?{memorySources}:{})};
            const finished=personal
              ?await persistWithCredit(db,db.prepare('UPDATE threads SET messages=?,refs=? WHERE id=? AND owner=? AND messages=?').bind(JSON.stringify(updated),JSON.stringify(refs),thread.id,owner,pending),owner,'discussion_completed',thread.id)
              :await settleSiteAnswer(db,{owner,requestId,token:operation!.token,charge:usage!.creditsCharged,threadId:thread.id,pending,messages:JSON.stringify(updated),refs:JSON.stringify(refs),response:JSON.stringify(response),detail:{course:doc.course,documentId:doc.id,documentName:doc.name,threadId:thread.id,question,page:typeof v.sourcePage==='number'&&Number.isSafeInteger(v.sourcePage)&&v.sourcePage>0?v.sourcePage:thread.page,model:usage!.calls.at(-1)?.model??settings.model,source:'site',operation:'answer',...usage}});
            const committed=typeof finished==='boolean'?finished:(finished.meta?.changes??(finished as unknown as {changes:number}).changes)>0;
            if(!committed){
              return json({error:'线程在回答期间发生变更，本次未扣费，请刷新后重试。'},409);
            }
            return json(response);
          }catch(error){
            if(personal)return json({error:'问题已保存。'+(error instanceof PersonalError?error.message:'自带 API 连接失败，请检查地址、接口格式或稍后重试。')},502);
            if(error instanceof UnpricedSiteUsage)return json({error:'问题已保存。站点模型本次无法核算用量，回答未保存，未扣积分。'},502);
            const status=error instanceof Error?error.message.match(/^OpenAI 未完成讲解（(\d{3})）/)?.[1]:undefined;
            const message=status==='401'||status==='403'?'问题已保存。请管理员检查站点密钥及模型权限。':status==='429'?'问题已保存。API 配额或速率受限，请检查余额或稍后重试。':'问题已保存，但 AI 暂时无法回答。请稍后重试。';
            return json({error:message},502);
          }
        }finally{if(operation)await releaseCreditRequest(db,owner,requestId,operation.token);}
      }
    }
    return json({error:'找不到这个操作。'},404);
  } catch(error) {
    if(error instanceof PersonalError)return json({error:error.message},error.status===409?409:400);
    if(error instanceof SyntaxError||error instanceof TypeError)return json({error:'请求内容无效。'},400);
    return json({error:'资料服务暂时不可用，请稍后重试。'},503);
  }
}
