import {priceOpenAiUsage} from './openai-usage-pricing.ts';
import {sitePricing} from './site-pricing.ts';
import {claimCreditRequest,requestFingerprint,reserveSiteBudget,validRequestId} from './learning-credits.ts';
import {meterModelCall,ModelResponseError} from './model-usage.ts';
import type {TutorAnswer,TutorInput} from './tutor.ts';
import {DEFAULT_TUTOR_MODEL} from '../lib/tutor-models.ts';

type SitePurpose='answer'|'retrieval'|'index';
type Call=ReturnType<typeof meterModelCall> & {
  chargeable:boolean;
  usagePricing?:NonNullable<ReturnType<typeof priceOpenAiUsage>>;
};
export class UnpricedSiteUsage extends Error {}
type AnswerFunction=(input:TutorInput)=>Promise<string|TutorAnswer>;
export type SiteOperation={id:string;token:string;calls:Call[];cap:number};
type Result={operation:SiteOperation;reply?:never}|{reply:Response;operation?:never};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});

export async function openSiteOperation(db:D1Database,owner:string,id:unknown,requestParts:unknown[],quoted:unknown,kind:'answer'|'index'):Promise<Result>{
  if(!validRequestId(id))return {reply:json({error:'请求标识无效，请刷新后重试。'},400)};
  const maximum=kind==='answer'?sitePricing.answerCap:sitePricing.memoryCap;
  if(quoted!==undefined&&(typeof quoted!=='number'||!Number.isFinite(quoted)||quoted<=0||quoted>maximum||Math.abs(quoted*1000-Math.round(quoted*1000))>1e-8))
    return {reply:json({error:'积分上限无效，请刷新报价。'},400)};
  // Without a quote only pre-migration receipts can be replayed under the original fingerprint.
  const fingerprint=await requestFingerprint(quoted===undefined?requestParts:[...requestParts,quoted]);
  const claim=await claimCreditRequest(db,owner,id,fingerprint);
  if(claim.conflict)return {reply:json({error:'同一请求标识已用于其他内容。'},409)};
  if(claim.response)return {reply:json(JSON.parse(claim.response))};
  if(claim.busy)return {reply:json({error:'请求正在处理，请稍后重试。'},409)};
  return {operation:{id,token:claim.token,cap:0,calls:[]}};
}

export async function holdForOperation(db:D1Database,owner:string,op:SiteOperation,quoted:unknown,maximum:number){
  if(typeof quoted!=='number')return json({error:'计费规则已更新，请刷新后查看本次积分上限。'},428);
  // Reserve the server-calculated maximum. Never subsidize an arbitrary client-provided low cap.
  op.cap=await reserveSiteBudget(db,owner,op.id,op.token,maximum);
  if(!op.cap)return json({error:'可用积分不足，可使用个人模型。',code:'insufficient_credits'},402);
  if(op.cap>quoted)return json({error:'可用积分已变更，请刷新报价后重新提交。',code:'quote_changed'},409);
}

export async function runSiteCall(db:D1Database,owner:string,op:SiteOperation,purpose:SitePurpose,input:TutorInput,answer:AnswerFunction){
  const model=input.model??DEFAULT_TUTOR_MODEL;
  function describe(result:Parameters<typeof meterModelCall>[0],success:boolean):Call {
    const call=meterModelCall(result,model,purpose);
    const pricing=input.siteUsagePricing&&call.modelSource==='reported'
      ?priceOpenAiUsage(call.model,call.serviceTier,call):undefined;
    return {...call,
      ...(pricing?{usagePricing:pricing,meteredCredits:pricing.usd*sitePricing.creditsPerUsd}:{}),
      chargeable:success};
  }
  let result:string|TutorAnswer;
  try {
    result=await answer(input);
  } catch(error) {
    const call=describe(error instanceof ModelResponseError?error:'',false);
    op.calls.push(call);
    await recordCall(db,owner,op.id,call,'failed');
    throw error;
  }
  const call=describe(result,true);
  const unpriced=input.siteUsagePricing&&!call.usagePricing&&call.costUsd===undefined;
  if(unpriced)call.chargeable=false;
  op.calls.push(call);
  await recordCall(db,owner,op.id,call,'completed');
  if(unpriced)throw new UnpricedSiteUsage('本次调用的用量无法核价，请稍后重试。');
  return result;
}
async function recordCall(db:D1Database,owner:string,id:string,call:Call,outcome:'completed'|'failed'){
  await db.prepare('INSERT INTO site_model_usage(id,owner,operation_id,created_at,outcome,detail) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),owner,id,Date.now(),outcome,JSON.stringify({...call,chargeable:undefined,provider:'openai'})).run();
}
export function siteReceipt(op:SiteOperation){
  const creditsPerUsd=sitePricing.creditsPerUsd;
  const costUsd=op.calls.reduce((sum,call)=>sum+(call.chargeable?(call.usagePricing?.usd??call.costUsd??0):0),0);
  // Round once across all calls in this operation. The ledger stores thousandths of a point.
  const milli=Math.round((costUsd*creditsPerUsd+Number.EPSILON)*1000);
  const charged=Math.min(milli,Math.round(op.cap*1000));
  return {calls:op.calls,creditsPerUsd,cap:op.cap,meteredCredits:milli/1000,creditsCharged:charged/1000,sponsoredCredits:(milli-charged)/1000};
}
