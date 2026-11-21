import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { handleAdminCredits } from '../server/admin-credits.ts';
import { claimCreditRequest, creditQuote, learningAccount, reserveSiteBudget, settleSiteMemory } from '../server/learning-credits.ts';
import { applyMigrations } from './sqlite-migrations.mjs';

const origin = 'https://site.example';
const admin = {userId:'trusted-admin',admin:true,source:'chatgpt'};

function setup(t, {to}={}) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  applyMigrations(sql,{to});
  const db = {
    prepare(query) {
      const statement = sql.prepare(query);
      let args = [];
      return {
        bind(...values) { args=values; return this; },
        first() { return statement.get(...args)??null; },
        all() {
          if(statement.columns().length===0)return {results:[],meta:statement.run(...args)};
          return {results:statement.all(...args)};
        },
        run() { return {meta:statement.run(...args)}; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results=statements.map(statement=>statement.all());
        sql.exec('COMMIT');
        return results;
      } catch(error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const request = async (path='', {actor=admin,body,headers={}}={}) => {
    const response=await handleAdminCredits(new Request(`${origin}/api/admin/credits${path}`,{
      method:body===undefined?'GET':'POST',
      headers:{origin,'Content-Type':'application/json',...headers},
      body:body===undefined?undefined:JSON.stringify(body),
    }),db,async()=>actor);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    return {status:response.status,body:await response.json()};
  };
  const profile = (id, name=id, email=null) => sql.prepare('INSERT INTO site_accounts VALUES(?,?,?,1,1)').run(id,name,email);
  const post = (input={}) => request('',{body:{targetUserId:'alice',requestId:crypto.randomUUID(),delta:1,reason:'Credit correction',...input}});
  const count = () => sql.prepare('SELECT count(*) AS n FROM admin_credit_adjustments').get().n;
  return {sql,db,request,profile,post,count};
}

test('only trusted legacy admins may read or write; writes require a same-origin request', async t => {
  const {request,profile,count}=setup(t);
  profile('alice');
  const payload={targetUserId:'alice',requestId:crypto.randomUUID(),delta:50,reason:'Attempt',admin:true};
  for(const actor of [null,{...admin,admin:false},{...admin,source:'oidc'}]) {
    const expected=actor===null?401:403;
    assert.equal((await request('',{actor,headers:{'oai-authenticated-user-id':admin.userId}})).status,expected);
    assert.equal((await request('',{actor,body:payload})).status,expected);
  }
  for(const headers of [{origin:'https://cross.example'},{origin:''},{'Sec-Fetch-Site':'cross-site'}]) {
    assert.equal((await request('',{body:payload,headers})).status,403);
  }
  assert.equal(count(),0);
});

test('directory finds registry and legacy credit/document owners with stable pages and private responses', async t => {
  const {sql,request,profile}=setup(t);
  profile('registered-1','小明','private@example.com');
  profile('registered-2','another@example.com','another@example.com');
  sql.exec(`INSERT INTO documents VALUES('sensitive-id','legacy-opaque-id','sensitive-filename','pdf','sensitive-course','sensitive-object-key',1);
    INSERT INTO learning_credits VALUES('reward','legacy-reward','note_saved',2,'old',1,'sensitive-source');
    INSERT INTO credit_income VALUES('grant','legacy-opaque-id',10,1);
    INSERT INTO credit_expenses VALUES('expense','legacy-opaque-id','req',-1,1,'old','sensitive-thread','{}')`);
  for(let i=0;i<31;i++)profile(`page-${String(i).padStart(2,'0')}`,'Test account');
  const first=await request('?q=PAGE-');
  assert.equal(first.status,200);
  assert.equal(first.body.users.length,25);
  assert.ok(first.body.nextCursor);
  const second=await request(`?q=PAGE-&cursor=${encodeURIComponent(first.body.nextCursor)}`);
  assert.equal(second.body.users.length,6);
  assert.equal(second.body.nextCursor,null);
  const ids=[...first.body.users,...second.body.users].map(user=>user.userId);
  assert.equal(new Set(ids).size,31);
  assert.deepEqual(ids,ids.toSorted());

  const legacy=(await request('?q=legacy')).body.users;
  assert.deepEqual(legacy.map(row=>[row.userId,row.balance,row.availableBalance]),[['legacy-opaque-id',9,9],['legacy-reward',12,12]]);
  assert.match(legacy[0].displayName,/^用户 .+…/);
  const named=await request(`?q=${encodeURIComponent('小明')}`);
  assert.equal(named.body.users[0].displayName,'小明');
  assert.equal((await request('?q=PRIVATE%40EXAMPLE.COM')).body.users[0].userId,'registered-1');
  const directory=(await request('?q=registered')).body.users;
  assert.doesNotMatch(JSON.stringify([legacy,directory]),/example\.com|sensitive-/);
  for(const q of ["' OR 1=1",'%', 'private@','another@']) {
    assert.deepEqual((await request(`?q=${encodeURIComponent(q)}`)).body.users,[]);
  }
  assert.equal((await request('?cursor=***')).status,400);
  assert.equal((await request(`?q=${'x'.repeat(321)}`)).status,400);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM credit_income').get().n,1);
});

test('signed changes are replayable by admin and UUID, persist immutably, and appear on the user ledger', async t => {
  const {db,sql,request,profile,post,count}=setup(t);
  profile('alice');
  profile('bob');
  const id=crypto.randomUUID();
  const input={requestId:id.toUpperCase(),delta:2.125,reason:'  Manual reward  '};
  const first=await post(input);
  assert.equal(first.status,200);
  assert.equal(first.body.replayed,false);
  const entry=first.body.adjustment;
  assert.deepEqual([entry.targetUserId,entry.adminUserId,entry.requestId,entry.delta,entry.deltaMilli,entry.reason],
    ['alice',admin.userId,id,2.125,2125,'Manual reward']);
  assert.ok(Number.isSafeInteger(entry.createdAt));
  const retry=await post({...input,requestId:id,reason:'Manual reward'});
  assert.deepEqual(retry.body,{adjustment:entry,replayed:true});
  for(const conflict of [{targetUserId:'bob'},{delta:2.124},{reason:'different'}]) {
    assert.equal((await post({...input,...conflict})).body.code,'idempotency_conflict');
  }
  assert.equal((await post({targetUserId:'bob',delta:3})).status,200);
  assert.equal((await post({delta:-0.375,reason:'Correction'})).body.adjustment.deltaMilli,-375);
  assert.equal(count(),3);
  const results=(await request('?targetUserId=alice')).body;
  assert.deepEqual(results.adjustments.map(change=>change.deltaMilli).sort((a,b)=>a-b),[-375,2125]);
  assert.equal(results.users.find(user=>user.userId==='alice').balance,11.75);
  assert.equal((await request()).body.adjustments.length,3);

  const account=await learningAccount(db,'alice');
  assert.deepEqual([account.balance,account.availableBalance,account.totalEarned,account.totalSpent,account.today.earned],[11.75,11.75,12.125,0.375,0]);
  const personalEntry=account.ledger.find(change=>change.id===entry.id);
  assert.deepEqual([personalEntry.kind,personalEntry.credits,personalEntry.detail],['admin_adjustment',2.125,{reason:'Manual reward'}]);
  assert.doesNotMatch(JSON.stringify(personalEntry),/trusted-admin/);
  for(const mutation of [
    'UPDATE admin_credit_adjustments SET reason=? WHERE id=?',
    'DELETE FROM admin_credit_adjustments WHERE reason!=? AND id=?',
    'INSERT OR REPLACE INTO admin_credit_adjustments SELECT id,owner,admin_owner,request_id,delta_milli,?,created_at FROM admin_credit_adjustments WHERE id=?',
  ]) {
    assert.throws(()=>sql.prepare(mutation).run('tampered',entry.id),/immutable/);
  }
  assert.equal(count(),3);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM credit_income').get().n,2);
});

test('missing users and invalid inputs never create accounts or adjustments', async t => {
  const {profile,post,sql,count}=setup(t);
  profile('alice');
  for(const input of [{delta:0},{delta:'2.5'},{delta:0.0001},{delta:1e20},{reason:' '},{reason:'a'.repeat(501)},
    {requestId:'not-a-uuid'},{requestId:`${crypto.randomUUID()}\n`},{targetUserId:'including space'},{targetUserId:'alice\n'}]) {
    assert.equal((await post(input)).status,400);
  }
  assert.equal((await post({targetUserId:'unknown'})).status,404);
  assert.equal((await post({delta:-10.001})).status,409);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM credit_income').get().n,0);
  assert.equal(count(),0);
});

test('competing deductions respect legacy and fractional holds and metered settlement', async t => {
  const {db,sql,profile,post,request,count}=setup(t);
  profile('alice');
  profile('bob');
  const now=Date.now();
  const seed=sql.prepare('INSERT INTO credit_requests VALUES(?,?,?,?,?,?,?,?)');
  seed.run('alice','legacy','f',1,'t',now+600000,null,0);
  seed.run('alice','expired','f',1,'t',now-1,null,0);
  seed.run('alice','closed','f',1,'t',now+600000,'done',0);
  seed.run('bob','other','f',0,'t',now+600000,null,9999);
  const {token}=await claimCreditRequest(db,'alice','metered','metered');
  assert.equal(await reserveSiteBudget(db,'alice','metered',token,1.125),1.125);
  const account=(await request('?q=alice')).body.users[0];
  assert.deepEqual([account.balance,account.heldBalance,account.availableBalance],[10,2.125,7.875]);
  const both=await Promise.all([post({delta:-7.875}),post({delta:-7.875})]);
  assert.deepEqual(both.map(result=>result.status).sort(),[200,409]);
  assert.equal(count(),1);
  assert.equal((await creditQuote(db,'alice')).availableBalance,0);

  const waiting=await claimCreditRequest(db,'alice','waiting','waiting');
  assert.equal(await reserveSiteBudget(db,'alice','waiting',waiting.token,1),0);
  assert.equal(await settleSiteMemory(db,{owner:'alice',requestId:'metered',token,charge:1.124,detail:{},response:'done',sourceId:'course'}),true);
  assert.equal((await creditQuote(db,'alice')).availableBalance,0.001);
  assert.equal(await reserveSiteBudget(db,'alice','waiting',waiting.token,1),0.001);

  const sharedId=crypto.randomUUID();
  const retries=await Promise.all([post({requestId:sharedId}),post({requestId:sharedId})]);
  assert.deepEqual(retries.map(result=>result.body.replayed).sort(),[false,true]);
  assert.equal(count(),2);
  assert.equal((await creditQuote(db,'alice')).availableBalance,1);
});

test('failed initial-grant write rolls back the adjustment and permits a retry', async t => {
  const {sql,profile,post,count}=setup(t);
  profile('alice');
  sql.exec("CREATE TRIGGER fail_grant BEFORE INSERT ON credit_income BEGIN SELECT RAISE(ABORT,'internal detail'); END");
  const input={requestId:crypto.randomUUID()};
  const rejected=await post(input);
  assert.equal(rejected.status,503);
  assert.doesNotMatch(JSON.stringify(rejected),/internal detail/);
  assert.equal(count(),0);
  sql.exec('DROP TRIGGER fail_grant');
  assert.equal((await post(input)).body.replayed,false);
  assert.equal(count(),1);
});

test('combined auth and adjustment migration adds empty tables while preserving legacy rows and holds', async t => {
  const {db,sql}=setup(t,{to:5});
  sql.exec(`INSERT INTO credit_income VALUES('grant','alice',10,1);
    INSERT INTO credit_expenses VALUES('debit','alice','request',-1,1,'old','thread','{}');
    INSERT INTO credit_requests VALUES('alice','active','f',1,'t',${Date.now()+600000},NULL,0)`);
  const original=sql.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const changes=sql.prepare('SELECT total_changes() AS n').get().n;
  applyMigrations(sql,{from:5,to:6});
  assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,changes);
  const current=sql.prepare('SELECT sql FROM sqlite_schema WHERE name=?');
  for(const entry of original)assert.equal(current.get(entry.name).sql,entry.sql);
  for(const table of ['admin_credit_adjustments','site_accounts','site_sessions','site_external_identities','site_login_transactions']) {
    assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  }
  assert.equal((await creditQuote(db,'alice')).availableBalance,8);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});
