import {profilePath,profileFrom,personalModels,publicProfile,probePersonal,checkRuntimeEndpoint,PersonalError,type PersonalProfile} from './personal-api.ts';
import {probeVision} from './vision-probe.ts';

type Dependencies={bucket:R2Bucket;owner:string;probe?:typeof probeVision;diagnose?:typeof probePersonal};
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const conflict=()=>reply({error:'配置已更新，请重新打开模型来源。'},409);
const verified=(p:PersonalProfile)=>p.visionModels??(p.vision?[p.model]:[]);

export function selectedPersonalModel(p:PersonalProfile,id:unknown):PersonalProfile{
 const model=id===undefined?p.model:id;
 if(typeof model!=='string'||!(p.models??[p.model]).includes(model))throw new PersonalError('该模型未选入当前配置。');
 return {...p,model,vision:verified(p).includes(model)};
}

export async function handleProviderSettings(request:Request,path:string[],ctx:Dependencies){
 const action=path.slice(1).join('/'),key=profilePath(ctx.owner);
 if(!action&&request.method==='DELETE'){await ctx.bucket.delete(key);return reply({profile:null});}
 const object=await ctx.bucket.get(key);
 const saved=object?JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as PersonalProfile:null;
 if(!action&&request.method==='GET')return reply({profile:saved?publicProfile(saved):null});
 if(request.method!=='POST'||!['','models','probe','vision','reveal'].includes(action))return reply({error:'不存在的配置操作。'},404);
 const v=await request.json() as Record<string,unknown>;
 if(!v||typeof v!=='object'||Array.isArray(v))throw new PersonalError('无效配置。');
 if((action==='vision'||action==='reveal')&&!saved)return reply({error:'尚未配置自带 API。'},404);
 if(v.revision!==undefined&&v.revision!==saved?.revision)return conflict();
 if(action==='reveal'&&saved)return v.revision===saved.revision?reply({key:saved.key}):conflict();
 const write=async(p:PersonalProfile)=>{
  const updated=await ctx.bucket.put(key,new TextEncoder().encode(JSON.stringify(p)),object?{onlyIf:{etagMatches:object.etag}}:{onlyIf:{etagDoesNotMatch:'*'}});
  return updated?reply({profile:publicProfile(p)}):conflict();
 };
 if(action==='vision'&&saved){
  if(v.revision!==saved.revision)return conflict();
  const target=selectedPersonalModel(saved,v.model);checkRuntimeEndpoint(target,request.url);
  const ok=await (ctx.probe??probeVision)(target);const set=new Set(verified(saved));
  if(ok)set.add(target.model);else set.delete(target.model);
  return write({...saved,vision:set.has(saved.model),visionModels:[...set]});
 }
 const reuse=v.key===undefined||v.key===null||v.key==='';
 if(reuse&&(!saved||v.revision!==saved.revision))throw new PersonalError('请输入当前服务商的 API Key。');
 const p=profileFrom({...v,model:action==='models'||(action==='probe'&&v.kind==='connect'&&!v.model)?'list':v.model,key:reuse?saved!.key:v.key});
 if(reuse&&p.base!==saved!.base)throw new PersonalError('Base URL 已改变，请为新地址重新输入 API Key。');
 // An edit of a v8 endpoint must not silently add a version prefix to its URLs.
 if(saved&&!saved.endpointVersion&&v.revision===saved.revision&&p.base===saved.base&&p.protocol===saved.protocol)delete p.endpointVersion;
 checkRuntimeEndpoint(p,request.url);
 if(action==='models')return reply({models:await personalModels(p)});
 if(action==='probe'){
  if(v.kind!=='connect'&&v.kind!=='model'&&v.kind!=='protocol')throw new PersonalError('请选择有效的检测方式。');
  return reply(await (ctx.diagnose??probePersonal)(p,v.kind));
 }
 const set=new Set(saved&&saved.base===p.base&&saved.key===p.key&&saved.protocol===p.protocol?verified(saved).filter(m=>(p.models??[p.model]).includes(m)):[]);
 p.vision=await (ctx.probe??probeVision)(p);if(p.vision)set.add(p.model);else set.delete(p.model);
 return write({...p,visionModels:[...set]});
}
