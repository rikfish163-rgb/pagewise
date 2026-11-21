import type {SiteAccount} from '../app/site-account.ts';
import {creditAccountGrant,creditBalanceSQL,creditHoldsSQL,toMilli,toPoints,validRequestId} from './learning-credits.ts';
import {sameOriginWrite} from './study-service.ts';

const userPageSize = 25;
const historyLimit = 30;
const maxReasonLength = 500;
const ownerTables = [
  'site_accounts','documents','learning_credits','credit_income','credit_expenses','model_credit_expenses','credit_requests',
] as const;

// Owner expressions below are fixed SQL. User IDs are bound parameters.
const knownOwnerSQL = (owner:string) => ownerTables.map(table =>
  `EXISTS(SELECT 1 FROM ${table} WHERE owner=${owner})`).join(' OR ');
// D1 limits the number of terms in a compound select. The outer UNION also
// deduplicates owners who occur in both groups before sorting and paging.
const directorySQL = [ownerTables.slice(0,4),ownerTables.slice(4)].map(tables =>
  `SELECT owner FROM (${tables.map(table => `SELECT owner FROM ${table} WHERE owner>?1`).join('\nUNION\n')})`,
).join('\nUNION\n');
const adjustmentColumns = 'id,owner AS targetUserId,admin_owner AS adminUserId,request_id AS requestId,delta_milli AS deltaMilli,reason,created_at AS createdAt';

type AdjustmentRow = {
  id:string; targetUserId:string; adminUserId:string; requestId:string; deltaMilli:number; reason:string; createdAt:number;
};
type Adjustment = AdjustmentRow & {delta:number};
type AdjustmentInput = {targetUserId:string; requestId:string; deltaMilli:number; reason:string};
type AccountRow = {userId:string; displayName:string|null; balanceMilli:number; heldMilli:number};
type Actor = Pick<SiteAccount,'userId'|'admin'|'source'>;

function formatAdjustment(row:AdjustmentRow):Adjustment {
  const {id,targetUserId,adminUserId,requestId,deltaMilli,reason,createdAt}=row;
  return {id,targetUserId,adminUserId,requestId,deltaMilli,delta:toPoints(deltaMilli),reason,createdAt};
}

function displayName(row:AccountRow) {
  const name=row.displayName?.trim();
  if(name&&!name.includes('@'))return name.slice(0,100);
  const id=row.userId;
  return `用户 ${id.length<=10?id:`${id.slice(0,5)}…${id.slice(-4)}`}`;
}

const validOwner = (value:unknown):value is string =>
  typeof value==='string'&&value.length>0&&value.length<=512&&!/[\s\p{Cc}]/u.test(value);

function encodeCursor(owner:string) {
  return btoa(encodeURIComponent(owner)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
}

function parseCursor(cursor:string|null) {
  if(!cursor)return '';
  if(!/^[A-Za-z0-9_-]{1,8192}$/.test(cursor))throw new TypeError('Invalid cursor');
  const owner=decodeURIComponent(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')));
  if(!validOwner(owner)||encodeCursor(owner)!==cursor)throw new TypeError('Invalid cursor');
  return owner;
}

async function listCredits(db:D1Database,q:string,after:string,targetUserId:string|null,now=Date.now()) {
  const accounts=db.prepare(`WITH known_owners AS (${directorySQL}), page AS MATERIALIZED (
    SELECT known.owner,profile.display_name FROM known_owners AS known
    LEFT JOIN site_accounts AS profile ON profile.owner=known.owner
    WHERE ?2='' OR instr(lower(known.owner),lower(?2))>0
      OR (instr(profile.display_name,'@')=0 AND instr(lower(profile.display_name),lower(?2))>0)
      OR lower(profile.email)=lower(?2)
    ORDER BY known.owner LIMIT ?3
  ) SELECT page.owner AS userId,page.display_name AS displayName,
      (${creditBalanceSQL('page.owner',true)}) AS balanceMilli,${creditHoldsSQL('page.owner','?4')} AS heldMilli
    FROM page ORDER BY page.owner`).bind(after,q,userPageSize+1,now);
  const history=targetUserId===null
    ?db.prepare(`SELECT ${adjustmentColumns} FROM admin_credit_adjustments ORDER BY created_at DESC,id DESC LIMIT ?`).bind(historyLimit)
    :db.prepare(`SELECT ${adjustmentColumns} FROM admin_credit_adjustments WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT ?`).bind(targetUserId,historyLimit);
  const [accountResult,historyResult]=await db.batch<AccountRow|AdjustmentRow>([accounts,history]);
  const page=(accountResult.results as AccountRow[]).slice(0,userPageSize);
  return {
    users:page.map(row=>({
      userId:row.userId,displayName:displayName(row),balance:toPoints(row.balanceMilli),
      availableBalance:toPoints(row.balanceMilli-row.heldMilli),heldBalance:toPoints(row.heldMilli),
    })),
    nextCursor:accountResult.results.length>userPageSize?encodeCursor(page[page.length-1].userId):null,
    adjustments:(historyResult.results as AdjustmentRow[]).map(formatAdjustment),
  };
}

async function adjustCredits(db:D1Database,adminOwner:string,input:AdjustmentInput,now=Date.now()) {
  const {targetUserId,requestId,deltaMilli,reason}=input;
  const id=crypto.randomUUID();
  // The guarded insert, optional starter grant, and receipt run as one D1 transaction.
  // Parameters are ID (1), target (2), admin (3), request ID (4), delta (5), reason (6), and time (7).
  const insert=db.prepare(`WITH funds AS MATERIALIZED (
    SELECT (${creditBalanceSQL('?2',true)}) AS balance,${creditHoldsSQL('?2','?7')} AS held
  ) INSERT INTO admin_credit_adjustments(id,owner,admin_owner,request_id,delta_milli,reason,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7 FROM funds
    WHERE (${knownOwnerSQL('?2')})
      AND NOT EXISTS(SELECT 1 FROM admin_credit_adjustments WHERE admin_owner=?3 AND request_id=?4)
      AND balance+?5>=held AND balance+?5 BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}`)
    .bind(id,targetUserId,adminOwner,requestId,deltaMilli,reason,now);
  const receipt=db.prepare(`SELECT ${adjustmentColumns},(${knownOwnerSQL('?3')}) AS targetExists
    FROM (SELECT 1) LEFT JOIN admin_credit_adjustments ON admin_owner=?1 AND request_id=?2`)
    .bind(adminOwner,requestId,targetUserId);
  const [,,result]=await db.batch<AdjustmentRow & {targetExists:number}>([insert,creditAccountGrant(db,targetUserId,now,true),receipt]);
  const row=result.results[0];

  if(!row.id)return row.targetExists
    ?fail('积分余额无法完成该调整。请检查可用积分等限制。','insufficient_credits',409)
    :fail('未找到该用户。','user_not_found',404);
  if(row.targetUserId!==targetUserId||row.deltaMilli!==deltaMilli||row.reason!==reason) {
    return fail('该请求编号已用于其他积分调整。','idempotency_conflict',409);
  }
  return json({adjustment:formatAdjustment(row),replayed:row.id!==id});
}

function parseAdjustment(value:unknown):AdjustmentInput|null {
  if(!value||typeof value!=='object')return null;
  const {targetUserId,requestId,delta,reason}=value as Record<string,unknown>;
  if(!validOwner(targetUserId)||!validRequestId(requestId)||requestId.length!==36||typeof delta!=='number'||!delta||typeof reason!=='string')return null;
  const trimmed=reason.trim();
  if(!trimmed||trimmed.length>maxReasonLength||trimmed.includes('\0'))return null;
  try {
    return {targetUserId,requestId:requestId.toLowerCase(),deltaMilli:Math.sign(delta)*toMilli(Math.abs(delta)),reason:trimmed};
  } catch {
    return null;
  }
}

const json = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
const fail = (error:string,code:string,status:number) => json({error,code},status);

export async function handleAdminCredits(request:Request,db:D1Database|undefined,getAccount:()=>Promise<Actor|null>):Promise<Response> {
  try {
    const account=await getAccount();
    if(!account)return fail('请先登录。','unauthenticated',401);
    if(account.admin!==true||account.source!=='chatgpt')return fail('需要站点管理员权限。','forbidden',403);
    if(!db)return fail('积分存储暂时不可用。','unavailable',503);

    if(request.method==='GET') {
      const params=new URL(request.url).searchParams;
      const q=(params.get('q')??'').trim(),targetUserId=params.get('targetUserId');
      let after:string;
      try {after=parseCursor(params.get('cursor'));}
      catch {return fail('用户列表游标无效。','invalid_cursor',400);}
      if(q.length>320||q.includes('\0')||(targetUserId!==null&&!validOwner(targetUserId))) {
        return fail('查询参数无效。','invalid_query',400);
      }
      return json(await listCredits(db,q,after,targetUserId));
    }

    if(request.method!=='POST')return fail('请求方法无效。','method_not_allowed',405);
    if(!sameOriginWrite(request))return fail('跨站请求已拒绝。','invalid_origin',403);
    const input=parseAdjustment(await request.json().catch(()=>null));
    if(!input)return fail('请输入用户、有效的请求编号、非零积分（最多三位小数）和调整原因。','invalid_adjustment',400);
    return await adjustCredits(db,account.userId,input);
  } catch {
    return fail('积分管理暂时不可用，请稍后重试。','unavailable',503);
  }
}
