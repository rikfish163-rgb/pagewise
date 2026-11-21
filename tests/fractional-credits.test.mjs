import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  availableCredits, claimCreditRequest, creditQuote, learningAccount, parseCreditCursor,
  persistWithCredit, releaseCreditRequest, reserveSiteBudget, settleSiteAnswer, settleSiteMemory, sitePricing,
} from '../server/learning-credits.ts';
import { applyMigrations, migration } from './sqlite-migrations.mjs';

const fractional = '0004_fractional_credits';
const pricing = {creditsPerUsd:100, answerCap:4, memoryCap:1};

function setup(t, legacy = false) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  applyMigrations(sql,legacy?{to:4}:undefined);
  const db = {
    prepare(query) {
      const stmt = sql.prepare(query);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        first() { return stmt.get(...args) ?? null; },
        run() { return {meta:stmt.run(...args)}; },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const result = statements.map(s => s.run());
        sql.exec('COMMIT');
        return result;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const claim = async (id, owner = 'alice') => {
    const {token} = await claimCreditRequest(db,owner,id,id);
    return {owner,requestId:id,token};
  };
  return {sql,db,claim};
}
const reserve = (db, c, cap) => reserveSiteBudget(db,c.owner,c.requestId,c.token,cap);
function seedThread(sql) {
  sql.exec(`INSERT INTO documents VALUES('doc','alice','doc','pdf','course','key',1);
    INSERT INTO threads(id,owner,doc_id,page,messages,created) VALUES('thread','alice','doc',1,'pending',1)`);
}
const answer = {threadId:'thread',pending:'pending',messages:'answered',refs:'[]',response:'{"saved":true}'};
const memory = {sourceId:'course',response:'{"indexed":true}',detail:{operation:'index'}};

test('0004 preserves old receipts, cursor boundaries, owner balances, rewards and live holds', async t => {
  const {sql,db} = setup(t,true);
  const future = Date.now()+600000;
  sql.exec(`INSERT INTO credit_income VALUES ('grant','alice',10,1);
    INSERT INTO learning_credits VALUES ('note','alice','note_saved',2,'old',3,'notebook');
    INSERT INTO credit_expenses VALUES ('spent','alice','old-req',-1,3,'old','thread','{"old":true}');
    INSERT INTO credit_requests VALUES ('alice','old-req','same',1,'done',10,'{"saved":true}'),
      ('alice','in-flight','same',1,'active',${future},NULL),
      ('alice','expired','same',1,'expired-token',1,NULL)`);
  const cursor = btoa(JSON.stringify({createdAt:3,id:'spent'}));
  const changes = sql.prepare('SELECT total_changes() n');
  const before = changes.get().n;
  sql.exec(migration(fractional));
  assert.equal(changes.get().n,before);
  applyMigrations(sql,{from:5});
  const account = await learningAccount(db,'alice',Date.now(),parseCreditCursor(cursor));
  assert.deepEqual(account.ledger.map(r=>[r.id,r.credits]),[['note',2],['grant',10]]);
  assert.deepEqual([account.balance,account.availableBalance,account.totalEarned,account.totalSpent],[11,10,12,1]);
  assert.equal(sql.prepare("SELECT credits FROM credit_expenses").get().credits,-1);
  assert.equal(sql.prepare("SELECT reserved FROM credit_requests WHERE request_id='in-flight'").get().reserved,1);
  assert.equal((await claimCreditRequest(db,'alice','old-req','same')).response,'{"saved":true}');
  const expense = (await learningAccount(db,'alice')).ledger.find(r=>r.id==='spent');
  assert.deepEqual([expense.kind,expense.credits,expense.detail],['site_answer',-1,{old:true}]);
  seedThread(sql);
  assert.equal(await settleSiteAnswer(db,{...answer,owner:'alice',requestId:'in-flight',token:'active',charge:0.333,detail:{}}),true);
  assert.equal(await availableCredits(db,'alice'),15.667);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('0004 only creates empty tables and indexes and adds a constant-default hold column', () => {
  const statements = migration(fractional).split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
  const newTables = ['model_credit_expenses','site_model_usage','credit_settlement_guard'];
  for (const statement of statements) {
    const create = /^CREATE TABLE `(\w+)`|^CREATE (?:UNIQUE )?INDEX `\w+` ON `(\w+)`/.exec(statement);
    if (create) assert.ok(newTables.includes(create[1] ?? create[2]));
    else assert.match(statement,/^ALTER TABLE `credit_requests` ADD `reserved_milli` integer DEFAULT 0;$/);
    assert.doesNotMatch(statement,/;\s*\S|\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|RENAME)\b/i);
  }
});

test('legacy writes after migration and fractional writes after cutover share a balance and daily rewards', async t => {
  const {sql,db,claim} = setup(t);
  const now = Date.now();
  // SQL issued by the previous Worker after DDL has been applied.
  sql.prepare("INSERT INTO credit_income(id,owner,credits,created_at) VALUES('old-grant','alice',10,?)").run(now);
  const date = new Date(now + 8*3600000).toISOString().slice(0,10);
  sql.prepare("INSERT INTO learning_credits VALUES('old-note','alice','note_saved',2,?,?,'notebook')").run(date,now);
  const oldClaim = sql.prepare('INSERT INTO credit_requests(owner,request_id,fingerprint,token,expires_at) VALUES(?,?,?,?,?)');
  oldClaim.run('alice','old-answer','old-answer','old-token',now+600000);
  oldClaim.run('alice','old-hold','old-hold','old-hold-token',now+600000);
  sql.exec(`UPDATE credit_requests SET reserved=1 WHERE owner='alice';
    INSERT INTO credit_expenses VALUES('old-charge','alice','old-answer',-1,1,'old','thread','{}');
    UPDATE credit_requests SET response='old receipt' WHERE request_id='old-answer'`);
  assert.equal((await claimCreditRequest(db,'alice','old-answer','old-answer')).response,'old receipt');
  const c = await claim('metered');
  assert.equal(await reserve(db,c,1.125),1.125);
  assert.deepEqual(await creditQuote(db,'alice'),{balance:11,availableBalance:8.875,pricing});
  const hold = sql.prepare("SELECT reserved,reserved_milli FROM credit_requests WHERE request_id='metered'").get();
  assert.deepEqual([hold.reserved,hold.reserved_milli],[0,1125]);
  seedThread(sql);
  assert.equal(await settleSiteAnswer(db,{...answer,...c,charge:0.123,detail:{}}),true);
  await persistWithCredit(db,db.prepare("UPDATE threads SET refs='[]'"),'alice','note_saved','notebook',true,now);
  const a = await learningAccount(db,'alice',now);
  assert.deepEqual([a.balance,a.availableBalance,a.totalEarned,a.totalSpent,a.today.earned],[15.877,14.877,17,1.123,7]);
  assert.deepEqual(sql.prepare('SELECT credits FROM learning_credits ORDER BY credits').all().map(r=>r.credits),[2,5]);
  assert.equal(sql.prepare('SELECT credits_milli FROM model_credit_expenses').get().credits_milli,-123);
  assert.equal(sql.prepare('SELECT credits FROM credit_expenses').get().credits,-1);
  assert.equal(sql.prepare('SELECT credits FROM credit_income').get().credits,10);
  await releaseCreditRequest(db,'alice','old-hold','old-hold-token');
  assert.equal(await availableCredits(db,'alice'),15.877);
});

test('bounded reservations serialize competing claims and retain the last milli-point', async t => {
  const {db,claim} = setup(t);
  const claims = await Promise.all(['one','two','three','four'].map(id=>claim(id)));
  const holds = await Promise.all(claims.map((c,i)=>reserve(db,c,[4,4,1.999,4][i])));
  assert.deepEqual(holds,[4,4,1.999,0.001]);
  assert.deepEqual(sitePricing,pricing);
  assert.deepEqual(await creditQuote(db,'alice'),{balance:10,availableBalance:0,pricing});
  const waiting = await claim('waiting');
  assert.equal(await reserve(db,waiting,4),0);
  assert.equal(await reserve(db,claims[0],4),0);
  assert.equal(await reserve(db,await claim('one','bob'),4),4);
  await releaseCreditRequest(db,'alice','four',claims[3].token);
  assert.equal(await reserve(db,waiting,1),0.001);
  for (const cap of [-1,NaN,Infinity,0.0009]) {
    await assert.rejects(reserve(db,waiting,cap),RangeError);
  }
});

test('answer CAS gates charge and reward; zero supplier price retains detailed audit and receipt', async t => {
  const {sql,db,claim} = setup(t);
  seedThread(sql);
  const c = await claim('answer');
  await reserve(db,c,4);
  const detail = {operation:'answer',pricingStatus:'unreported'};
  const args = {...c,...answer,detail,charge:0};
  assert.equal(await settleSiteAnswer(db,{...args,charge:4.001}),false);
  assert.equal(await settleSiteAnswer(db,{...args,pending:'changed'}),false);
  assert.equal(sql.prepare('SELECT count(*) n FROM model_credit_expenses').get().n,0);
  assert.equal(await settleSiteAnswer(db,args),true);
  assert.equal(await settleSiteAnswer(db,{...args,pending:'answered'}),false);
  assert.equal((await claimCreditRequest(db,'alice','answer','answer')).response,args.response);
  const next = await claim('again');
  await reserve(db,next,4);
  assert.equal(await settleSiteAnswer(db,{...args,...next,pending:'answered',charge:1.001}),true);
  await persistWithCredit(db,db.prepare("UPDATE threads SET refs='[]' WHERE id='thread'"),'alice','note_saved','note');
  const a = await learningAccount(db,'alice');
  assert.deepEqual([a.balance,a.availableBalance,a.totalEarned,a.totalSpent,a.today.earned],[15.999,15.999,17,1.001,7]);
  assert.deepEqual(a.freeSources,['personal','magpie','local']);
  assert.deepEqual(a.pricing,pricing);
  const zero = a.ledger.filter(r=>r.kind==='site_answer' && r.credits===0);
  assert.equal(zero.length,1);
  assert.deepEqual(zero[0].detail,detail);
});

test('memory action is fenced before execution; stale job, rollback and replay never charge twice', async t => {
  const {sql,db,claim} = setup(t);
  sql.exec('CREATE TABLE job (revision INTEGER); INSERT INTO job VALUES(1)');
  const c = await claim('memory');
  await reserve(db,c,1);
  const args = {...memory,...c,charge:0.123,action:db.prepare('UPDATE job SET revision=revision+1')};
  for (const invalid of [{token:'other'},{owner:'other'},{charge:1.001}]) {
    assert.equal(await settleSiteMemory(db,{...args,...invalid}),false);
  }
  for (const charge of [-0.001,0.0001,NaN,Infinity]) {
    await assert.rejects(settleSiteMemory(db,{...args,charge}),RangeError);
  }
  assert.equal(await settleSiteMemory(db,{...args,action:db.prepare('UPDATE job SET revision=3 WHERE revision=2')}),false);
  sql.exec("CREATE TRIGGER fail_receipt BEFORE UPDATE OF response ON credit_requests BEGIN SELECT RAISE(ABORT,'receipt failure'); END");
  await assert.rejects(settleSiteMemory(db,args),/receipt failure/);
  assert.equal(sql.prepare('SELECT revision FROM job').get().revision,1);
  assert.equal(sql.prepare('SELECT count(*) n FROM model_credit_expenses').get().n,0);
  assert.equal(await availableCredits(db,'alice'),9);
  sql.exec('DROP TRIGGER fail_receipt');
  assert.equal(await settleSiteMemory(db,args),true);
  assert.equal(await settleSiteMemory(db,args),false);
  assert.equal(sql.prepare('SELECT revision FROM job').get().revision,2);
  assert.equal((await claimCreditRequest(db,'alice','memory','memory')).response,memory.response);
  const a = await learningAccount(db,'alice');
  assert.deepEqual([a.balance,a.availableBalance,a.totalEarned,a.totalSpent],[9.877,9.877,10,0.123]);
  const entry = a.ledger.find(r=>r.kind==='site_memory');
  assert.deepEqual([entry.credits,entry.sourceId,entry.detail],[-0.123,'course',memory.detail]);
});

test('expired, released and reclaimed memory requests fence workers even on free settlement', async t => {
  const {sql,db,claim} = setup(t);
  let now = Date.now();
  t.mock.method(Date,'now',()=>now);
  const old = await claim('index');
  await reserve(db,old,1);
  now += 600000;
  const args = {...memory,charge:0,detail:{operation:'index',pricingStatus:'pending'}};
  const action = db.prepare("INSERT INTO site_model_usage VALUES('unexpected','alice','index',1,'completed','{}')");
  assert.equal(await settleSiteMemory(db,{...args,...old,action}),false);
  const fresh = await claim('index');
  assert.equal(await reserve(db,fresh,0.001),0.001);
  await releaseCreditRequest(db,'alice','index',old.token);
  assert.equal(await settleSiteMemory(db,{...args,...old,action}),false);
  assert.equal(sql.prepare('SELECT count(*) n FROM site_model_usage').get().n,0);
  assert.equal(await settleSiteMemory(db,{...args,...fresh}),true);
  const a = await learningAccount(db,'alice');
  assert.equal(a.balance,10);
  assert.deepEqual(a.ledger.find(r=>r.kind==='site_memory').detail,args.detail);
  const failed = await claim('failed');
  await reserve(db,failed,1);
  await releaseCreditRequest(db,'alice','failed',failed.token);
  assert.equal(await settleSiteMemory(db,{...args,...failed,action}),false);
  assert.equal(await availableCredits(db,'alice'),10);
});

test('supplier audit supports multiple invocations per operation and validates outcomes', t => {
  const {sql} = setup(t);
  const insert = sql.prepare("INSERT INTO site_model_usage VALUES(?,'alice','index',1,?,'{}')");
  insert.run('a','completed');
  insert.run('b','failed');
  assert.throws(()=>insert.run('invalid','pending'),/site_model_usage_outcome/);
  assert.deepEqual(sql.prepare('PRAGMA index_info(site_model_usage_owner_operation)').all().map(c=>c.name),['owner','operation_id']);
  assert.throws(()=>sql.exec("INSERT INTO model_credit_expenses VALUES('bad','alice','r',-1.5,1,'day','source','{}','site_memory')"),/model_credit_expenses_debit/);
});
