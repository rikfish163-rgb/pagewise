import {sitePricing} from './site-pricing.ts';
export {sitePricing};
const milliPerPoint = 1000;
const initialCreditGrant = 10;

export function toMilli(points:number) {
  const milli = Math.round(points * milliPerPoint);
  if (!Number.isSafeInteger(milli) || points < 0 || milli / milliPerPoint !== points) {
    throw new RangeError('Credits must be nonnegative points representable in integer milli-points');
  }
  return milli;
}
export const toPoints = (milli:number) => milli / milliPerPoint;

export const creditRules = [
  {kind:'discussion_completed',label:'每日首次保存完整问答',credits:5,dailyLimit:1},
  {kind:'note_saved',label:'每日首次保存非空笔记变更',credits:2,dailyLimit:1},
] as const;
type CreditKind = typeof creditRules[number]['kind'];
export function studyDate(now:number) {
  return new Date(now+8*60*60*1000).toISOString().slice(0,10);
}
/** Place this immediately after the persisted action in the same D1 batch. */
export function learningCreditAward(db:D1Database,owner:string,kind:CreditKind,sourceId:string,eligible=true,now=Date.now()) {
  const rule=creditRules.find(rule=>rule.kind===kind)!;
  return db.prepare(`INSERT INTO learning_credits(id,owner,kind,credits,study_date,created_at,source_id)
    SELECT ?,?,?,?,?,?,? WHERE changes()>0 AND ?
    ON CONFLICT(owner,study_date,kind) DO NOTHING`).bind(crypto.randomUUID(),owner,kind,rule.credits,studyDate(now),now,sourceId,Number(eligible));
}
/** D1 batch is transactional. changes() refers to the preceding persisted action,
 * so a rejected optimistic write cannot earn a reward, even under concurrency. */
export async function persistWithCredit(db:D1Database,action:D1PreparedStatement,owner:string,kind:CreditKind,sourceId:string,eligible=true,now=Date.now(),following:D1PreparedStatement[] = []) {
  const [saved]=await db.batch([action,learningCreditAward(db,owner,kind,sourceId,eligible,now),...following]);
  return saved;
}
// Pass only SQL expressions, never request data. The directory previews the
// starter grant for known accounts that have yet to open their credit account.
export function creditBalanceSQL(owner:string, previewInitialGrant=false) {
  return `((SELECT COALESCE(SUM(credits),0) FROM learning_credits WHERE owner=${owner})
    + (SELECT COALESCE(SUM(credits),${previewInitialGrant?initialCreditGrant:0}) FROM credit_income WHERE owner=${owner})
    + (SELECT COALESCE(SUM(credits),0) FROM credit_expenses WHERE owner=${owner})) * ${milliPerPoint}
    + (SELECT COALESCE(SUM(credits_milli),0) FROM model_credit_expenses WHERE owner=${owner})
    + (SELECT COALESCE(SUM(delta_milli),0) FROM admin_credit_adjustments WHERE owner=${owner})`;
}
const balanceSQL=creditBalanceSQL('?');
export const changed=(result:D1Result)=>Number(result.meta?.changes??(result as unknown as {changes:number}).changes??0)>0;
export function creditAccountGrant(db:D1Database,owner:string,now:number,afterChange=false) {
  return db.prepare(`INSERT INTO credit_income(id,owner,credits,created_at) SELECT ?,?,${initialCreditGrant},?
    WHERE ${afterChange?'changes()>0':'1'} ON CONFLICT(owner) DO NOTHING`).bind(crypto.randomUUID(),owner,now);
}
export async function ensureCreditAccount(db:D1Database,owner:string,now=Date.now()) {
  await creditAccountGrant(db,owner,now).run();
}
// The old Worker sets reserved=1 for a one-point hold. Metered reservations use
// reserved_milli alone; a legacy flag, if present, represents exactly one hold.
const requestHoldSQL=`(CASE WHEN reserved=1 THEN ${milliPerPoint} ELSE COALESCE(reserved_milli,0) END)`;
export function creditHoldsSQL(owner:string,now:string) {
  return `(SELECT COALESCE(SUM(${requestHoldSQL}),0) FROM credit_requests WHERE owner=${owner} AND response IS NULL AND expires_at>${now})`;
}
const holdsSQL=creditHoldsSQL('?','?');
export async function availableCredits(db:D1Database,owner:string) {
  return (await creditQuote(db,owner)).availableBalance;
}
/** Small quote avoids downloading question history on frequent balance refreshes. */
export async function creditQuote(db:D1Database,owner:string,now=Date.now()) {
  await ensureCreditAccount(db,owner,now);
  // The numbered parameters share the owner (1) and timestamp (2).
  const row=await db.prepare(`SELECT (${creditBalanceSQL('?1')}) AS balance,${creditHoldsSQL('?1','?2')} AS held`).bind(owner,now).first<{balance:number;held:number}>();
  return {balance:toPoints(row!.balance),availableBalance:toPoints(row!.balance-row!.held),pricing:sitePricing};
}
export const validRequestId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function requestFingerprint(value:unknown) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
/** Expired pending claims may be retried. A fresh token fences the old worker out. */
export async function claimCreditRequest(db:D1Database,owner:string,id:string,fingerprint:string) {
  const now=Date.now(),token=crypto.randomUUID();
  await db.prepare(`INSERT INTO credit_requests(owner,request_id,fingerprint,token,expires_at) VALUES(?,?,?,?,?)
    ON CONFLICT(owner,request_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at,reserved=0,reserved_milli=0
    WHERE credit_requests.response IS NULL AND credit_requests.expires_at<=? AND credit_requests.fingerprint=excluded.fingerprint`)
    .bind(owner,id,fingerprint,token,now+600000,now).run();
  const row=await db.prepare('SELECT * FROM credit_requests WHERE owner=? AND request_id=?').bind(owner,id).first<{fingerprint:string;token:string;response:string|null}>();
  return {token,conflict:row!.fingerprint!==fingerprint,busy:row!.token!==token,response:row!.response};
}
/** Acquire a fresh hold once. A partial hold can be as small as one milli-point. */
export async function reserveSiteBudget(db:D1Database,owner:string,id:string,token:string,capPoints:number):Promise<number> {
  const cap=toMilli(capPoints);
  await ensureCreditAccount(db,owner);
  const now=Date.now();
  // The cap (1), owner (2), timestamp (3), request ID (4), and token (5).
  const row=await db.prepare(`WITH budget AS MATERIALIZED (SELECT MIN(?1,(${creditBalanceSQL('?2')})-${creditHoldsSQL('?2','?3')}) AS amount)
    UPDATE credit_requests SET reserved_milli=(SELECT amount FROM budget)
    WHERE owner=?2 AND request_id=?4 AND token=?5 AND response IS NULL AND ${requestHoldSQL}=0 AND expires_at>?3
    AND (SELECT amount FROM budget)>0 RETURNING reserved_milli`)
    .bind(cap,owner,now,id,token).first<{reserved_milli:number}>();
  return toPoints(row?.reserved_milli??0);
}
export async function releaseCreditRequest(db:D1Database,owner:string,id:string,token:string) {
  await db.prepare('UPDATE credit_requests SET reserved=0,reserved_milli=0,expires_at=0 WHERE owner=? AND request_id=? AND token=? AND response IS NULL').bind(owner,id,token).run();
}
type UsageSettlement = {
  owner:string; requestId:string; token:string; charge:number; detail:unknown; response:string;
};

// All comparisons and writes in a settlement use integer milli-points.
// The guard binds five hold parameters, five ledger owners, and the charge.
const canSettleSQL = `EXISTS(SELECT 1 FROM credit_requests WHERE owner=? AND request_id=? AND token=?
  AND response IS NULL AND expires_at>? AND ${requestHoldSQL}>=?) AND (${balanceSQL})>=?`;
function settlementValues(args:UsageSettlement, now:number, milli:number) {
  return [args.owner,args.requestId,args.token,now,Math.max(1,milli),args.owner,args.owner,args.owner,args.owner,args.owner,milli];
}

function usageExpense(db:D1Database, args:UsageSettlement, kind:'site_answer'|'site_memory',
  sourceId:string, milli:number, now:number, condition:string, values:(string|number)[]=[]) {
  return db.prepare(`INSERT INTO model_credit_expenses(id,owner,request_id,kind,credits_milli,created_at,study_date,source_id,detail)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${condition}`).bind(crypto.randomUUID(),args.owner,args.requestId,kind,
      -milli,now,studyDate(now),sourceId,JSON.stringify(args.detail),...values);
}

function settlementReceipt(db:D1Database, args:UsageSettlement) {
  return db.prepare(`UPDATE credit_requests SET response=?,reserved=0,reserved_milli=0
    WHERE owner=? AND request_id=? AND token=? AND changes()>0`).bind(args.response,args.owner,args.requestId,args.token);
}

export async function settleSiteAnswer(db:D1Database,args:UsageSettlement & {
  threadId:string; pending:string; messages:string; refs:string;
}) {
  const now=Date.now();
  const milli=toMilli(args.charge);
  const saved=db.prepare(`UPDATE threads SET messages=?,refs=? WHERE id=? AND owner=? AND messages=? AND ${canSettleSQL}`)
    .bind(args.messages,args.refs,args.threadId,args.owner,args.pending,...settlementValues(args,now,milli));
  const expense=usageExpense(db,args,'site_answer',args.threadId,milli,now,'changes()>0');
  const reward=db.prepare(`INSERT INTO learning_credits(id,owner,kind,credits,study_date,created_at,source_id)
    SELECT ?,?,'discussion_completed',?,?,?,? WHERE changes()>0 ON CONFLICT(owner,study_date,kind) DO NOTHING`)
    .bind(crypto.randomUUID(),args.owner,creditRules[0].credits,studyDate(now),now,args.threadId);
  const [result]=await db.batch([saved,expense,settlementReceipt(db,args),reward]);
  return changed(result);
}

export async function settleSiteMemory(db:D1Database,args:UsageSettlement & {sourceId:string; action?:D1PreparedStatement}) {
  const now=Date.now(), milli=toMilli(args.charge);
  const values=settlementValues(args,now,milli);
  if (!args.action) {
    const expense=usageExpense(db,args,'site_memory',args.sourceId,milli,now,canSettleSQL,values);
    const [result]=await db.batch([expense,settlementReceipt(db,args)]);
    return changed(result);
  }

  // D1 batches cannot branch around an opaque prepared statement. A failed CHECK
  // aborts the batch before the action on a stale claim, even if the action is unconditional.
  const guard=db.prepare(`INSERT INTO credit_settlement_guard(rejected) SELECT 1 WHERE NOT (${canSettleSQL})`).bind(...values);
  const expense=usageExpense(db,args,'site_memory',args.sourceId,milli,now,'changes()>0');
  try {
    const [, , debit]=await db.batch([guard,args.action,expense,settlementReceipt(db,args)]);
    return changed(debit);
  } catch (error) {
    if (error instanceof Error && /CHECK constraint failed: credit_settlement_requires_live_hold/.test(error.message)) return false;
    throw error;
  }
}
export function parseCreditCursor(cursor:string|null):{createdAt:number;id:string}|undefined {
  if(!cursor)return undefined;
  try {const v=JSON.parse(atob(cursor));if(Number.isSafeInteger(v.createdAt)&&typeof v.id==='string'&&v.id.length<=100)return v;}catch{}
  throw new TypeError('Invalid credit cursor');
}
export async function learningAccount(db:D1Database,owner:string,now=Date.now(),cursor?:{createdAt:number;id:string}) {
  await ensureCreditAccount(db,owner,now);
  const date=studyDate(now);
  const snapshot=await db.prepare(`WITH ledger AS (
    SELECT id,kind,credits*${milliPerPoint} AS credits,study_date,created_at,source_id,NULL AS detail FROM learning_credits WHERE owner=?
    UNION ALL SELECT id,'initial_grant',credits*${milliPerPoint},substr(datetime(created_at/1000,'unixepoch','+8 hours'),1,10),created_at,'account',NULL FROM credit_income WHERE owner=?
    UNION ALL SELECT id,'site_answer',credits*${milliPerPoint},study_date,created_at,source_id,detail FROM credit_expenses WHERE owner=?
    UNION ALL SELECT id,kind,credits_milli,study_date,created_at,source_id,detail FROM model_credit_expenses WHERE owner=?
    UNION ALL SELECT id,'admin_adjustment',delta_milli,substr(datetime(created_at/1000,'unixepoch','+8 hours'),1,10),created_at,'account',json_object('reason',reason) FROM admin_credit_adjustments WHERE owner=?
  ) SELECT COALESCE(SUM(credits),0) AS balance,${holdsSQL} AS held,
    COALESCE(SUM(CASE WHEN credits>0 THEN credits ELSE 0 END),0) AS totalEarned,
    COALESCE(-SUM(CASE WHEN credits<0 THEN credits ELSE 0 END),0) AS totalSpent,
    COALESCE(SUM(CASE WHEN study_date=? AND kind IN ('note_saved','discussion_completed') THEN credits ELSE 0 END),0) AS today,
    EXISTS(SELECT 1 FROM ledger WHERE study_date=? AND kind='discussion_completed') AS discussion,
    EXISTS(SELECT 1 FROM ledger WHERE study_date=? AND kind='note_saved') AS note,
    (SELECT json_group_array(json_object('id',id,'kind',kind,'credits',credits,'studyDate',study_date,'createdAt',created_at,'sourceId',source_id,'detail',json(detail)))
      FROM (SELECT * FROM ledger WHERE (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 51)) AS ledger
    FROM ledger`).bind(owner,owner,owner,owner,owner,owner,now,date,date,date,cursor?.createdAt??null,cursor?.createdAt??null,cursor?.createdAt??null,cursor?.id??null)
    .first<{balance:number;held:number;totalEarned:number;totalSpent:number;today:number;discussion:number;note:number;ledger:string}>();
  const rows=JSON.parse(snapshot?.ledger??'[]') as {id:string;kind:string;credits:number;createdAt:number;detail?:unknown}[];
  const more=rows.length>50;const page=rows.slice(0,50),last=page.at(-1);
  return {balance:toPoints(snapshot?.balance??0),availableBalance:toPoints((snapshot?.balance??0)-(snapshot?.held??0)),
    totalEarned:toPoints(snapshot?.totalEarned??0),totalSpent:toPoints(snapshot?.totalSpent??0),pricing:sitePricing,
    today:{date,earned:toPoints(snapshot?.today??0),dailyLimit:7},timezone:'Asia/Shanghai',modelAccess:'credits',freeSources:['personal','magpie','local'],
    rules:creditRules.map(rule=>({...rule,earnedToday:!!(rule.kind==='note_saved'?snapshot?.note:snapshot?.discussion)})),
    ledger:page.map(row=>({...row,credits:toPoints(row.credits),label:row.kind==='initial_grant'?'首次登录赠送':row.kind==='site_answer'?'站点模型问答':row.kind==='site_memory'?'站点记忆索引':row.kind==='admin_adjustment'?'管理员调整':creditRules.find(rule=>rule.kind===row.kind)?.label??'学习奖励'})),ledgerLimit:50,
    ...(more&&last?{nextCursor:btoa(JSON.stringify({createdAt:last.createdAt,id:last.id}))}:{}),};
}
