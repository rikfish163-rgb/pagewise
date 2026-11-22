import { requestedPages } from '../lib/page-references.ts';
import {makeIndexTask, readModelObject, type Evidence, type IndexJob, type IndexSample, type MemoryKind, type MemorySourceRef, type TopicCard} from '../lib/learning-memory.ts';

const batchSize=5;
const normalize=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}]+/gu,'');
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,max):'';

type StoredEvidence=Evidence & {topicKey:string; topic:string; legacyMastered:number};
type TopicIdentity=Pick<TopicCard,'key'|'topic'>;
type JobSnapshot={
  samples: Pick<IndexSample,'threadId'|'turn'|'askedAt'>[];
  existing: TopicIdentity[];
};
type CompletedRecord={threadId:string;turn:number;askedAt:number;topicKey?:string;topic?:string;detail?:string;kind?:MemoryKind};

const unindexedFrom = `
  FROM threads t JOIN documents d ON d.id=t.doc_id AND d.owner=t.owner
  JOIN json_each(t.messages) msg
  LEFT JOIN memory_evidence e ON e.owner=t.owner AND e.thread_id=t.id AND e.turn=CAST(msg.key AS INTEGER)
  WHERE t.owner=? AND d.course=? AND e.turn IS NULL AND msg.key>0
    AND json_extract(msg.value,'$.role')='assistant'
    AND json_extract(t.messages,'$['||(msg.key-1)||'].role')='user'`;

const affected=(result:D1Result)=>result.meta?.changes??(result as unknown as {changes:number}).changes;

function evidencePages(question:string,fallback:number):number[]{
  try {
    const named=requestedPages(question);
    if(named.length)return named;
  } catch { /* Keep the recorded page for invalid or unsupported page ranges. */ }
  return [fallback];
}

export class ProjectMemory {
  private db:D1Database;
  private owner:string;

  constructor(db:D1Database,owner:string){
    this.db=db;
    this.owner=owner;
  }

  async topics(course:string):Promise<TopicCard[]> {
    const query=`
      SELECT e.thread_id AS threadId, e.topic_key AS topicKey, e.topic, e.detail, e.kind,
        e.asked_at AS askedAt, d.id AS documentId, d.name AS file,
        COALESCE(json_extract(t.messages,'$['||(e.turn-1)||'].page'),t.page) AS page,
        json_extract(t.messages,'$['||(e.turn-1)||'].content') AS question,
        EXISTS(SELECT 1 FROM study_mastery m WHERE m.owner=e.owner AND m.thread_id=t.id
          AND m.question=json_extract(t.messages,'$['||(e.turn-1)||'].content')) AS legacyMastered
      FROM memory_evidence e JOIN threads t ON t.id=e.thread_id AND t.owner=e.owner
      JOIN documents d ON d.id=t.doc_id AND d.owner=t.owner
      WHERE e.owner=? AND d.course=? AND e.topic_key IS NOT NULL
      ORDER BY e.asked_at DESC, e.turn DESC`;
    const [stored, mastered]=await Promise.all([
      this.db.prepare(query).bind(this.owner,course).all<StoredEvidence>(),
      this.db.prepare('SELECT topic_key FROM memory_mastery WHERE owner=? AND course=?').bind(this.owner,course).all<{topic_key:string}>(),
    ]);
    const marked=new Set(mastered.results.map(row=>row.topic_key));
    const groups=new Map<string,TopicCard>();
    const decided=new Set<string>();
    for(const row of stored.results){
      const pages=evidencePages(row.question,row.page);
      const evidence:Evidence={pages,documentId:row.documentId,threadId:row.threadId,file:row.file,page:pages[0],question:row.question,askedAt:row.askedAt,detail:row.detail,kind:row.kind};
      const card=groups.get(row.topicKey)??{key:row.topicKey,topic:row.topic,stage:'practice',count:0,evidence:[]};
      groups.set(row.topicKey,card);
      card.count++;
      if(card.evidence.length<6)card.evidence.push(evidence);
      if(marked.has(row.topicKey)){
        card.stage='mastered';
      }else if(!decided.has(row.topicKey)&&(row.legacyMastered||row.kind!=='practice')){
        card.stage=row.legacyMastered?'mastered':row.kind==='progress'?'practice':'review';
        decided.add(row.topicKey);
      }
    }
    return [...groups.values()];
  }

  async searchCatalog(course:string,query:string,threadId:string){
    const cards=(await this.topics(course)).flatMap(card=>{
      const evidence=card.evidence.filter(source=>source.threadId!==threadId);
      return evidence.length?[{...card,evidence}]:[];
    });
    return selectMemoryCandidates(cards,query);
  }

  async view(course:string){
    const [cards,remaining,indexed]=await Promise.all([
      this.topics(course),
      this.db.prepare('SELECT COUNT(*) AS total '+unindexedFrom).bind(this.owner,course).first<{total:number}>(),
      this.db.prepare(`SELECT COUNT(*) AS total FROM memory_evidence e JOIN threads t ON t.id=e.thread_id AND t.owner=e.owner
        JOIN documents d ON d.id=t.doc_id AND d.owner=t.owner WHERE e.owner=? AND d.course=?`).bind(this.owner,course).first<{total:number}>(),
    ]);
    return {cards,remaining:remaining?.total??0,indexed:indexed?.total??0};
  }

  async start(course:string,priorityThread?:string):Promise<{job:IndexJob|null;busy?:boolean}> {
    const now=Date.now();
    const current=await this.db.prepare('SELECT expires_at FROM memory_jobs WHERE owner=? AND course=?').bind(this.owner,course).first<{expires_at:number}>();
    if(current&&current.expires_at>now)return {job:null,busy:true};
    const query=`SELECT t.id AS threadId, CAST(msg.key AS INTEGER) AS turn, d.name AS file,
      COALESCE(json_extract(t.messages,'$['||(msg.key-1)||'].page'),t.page) AS page,
      SUBSTR(json_extract(t.messages,'$['||(msg.key-1)||'].content'),1,1200) AS question,
      SUBSTR(json_extract(msg.value,'$.content'),1,1700) AS answer,
      SUBSTR(COALESCE(json_extract(t.messages,'$['||(msg.key-1)||'].excerpt'),t.selection_text,''),1,700) AS excerpt,
      CASE WHEN msg.key>=3 THEN COALESCE(SUBSTR(json_extract(t.messages,'$['||(msg.key-3)||'].content'),1,500),'') ELSE '' END AS previous,
      COALESCE(json_extract(t.messages,'$['||(msg.key-1)||'].createdAt'),t.created) AS askedAt
      ${unindexedFrom} ORDER BY (t.id=?) DESC, askedAt DESC, turn DESC, t.id LIMIT ${batchSize}`;
    const {results}=await this.db.prepare(query).bind(this.owner,course,priorityThread??'').all<IndexSample>();
    if(!results.length)return {job:null};
    const cards=selectMemoryCandidates(await this.topics(course),results.map(sample=>sample.question+' '+sample.excerpt).join(' '));
    const token=crypto.randomUUID();
    const snapshot:JobSnapshot={
      samples:results.map(({threadId,turn,askedAt})=>({threadId,turn,askedAt})),
      existing:cards.map(({key,topic})=>({key,topic})),
    };
    const lease=await this.db.prepare(`
      INSERT INTO memory_jobs(owner,course,token,expires_at,samples) VALUES(?,?,?,?,?)
      ON CONFLICT(owner,course) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at,samples=excluded.samples
      WHERE memory_jobs.expires_at<=?`)
      .bind(this.owner,course,token,now+75_000,JSON.stringify(snapshot),now).run();
    if(!affected(lease))return {job:null,busy:true};
    return {job:{token,task:makeIndexTask(results.map(sample=>({...sample,page:evidencePages(sample.question,sample.page)[0]})),cards)}};
  }

  async cancel(course:string,token:string) {
    await this.db.prepare('DELETE FROM memory_jobs WHERE owner=? AND course=? AND token=?').bind(this.owner,course,token).run();
  }

  async finish(course:string,token:string,output:string) {
    try {
      const write=await this.evidenceWrite(course,token,output);
      await write.run();
    } finally {
      await this.cancel(course,token);
    }
  }

  // Site billing commits this evidence with its receipt in a single D1 transaction.
  async evidenceWrite(course:string,token:string,output:string) {
    const lease=await this.db.prepare('SELECT samples FROM memory_jobs WHERE owner=? AND course=? AND token=? AND expires_at>?')
    .bind(this.owner,course,token,Date.now()).first<{samples:string}>();
    if(!lease)throw Error('这批整理已过期，请重试。');
    const snapshot=JSON.parse(lease.samples) as JobSnapshot;
    const completed=readEvidence(output,snapshot);
    // Recheck ownership, project, and lease in the write. Deleted or moved sources stay out.
    return this.db.prepare(`
      INSERT OR IGNORE INTO memory_evidence(owner,thread_id,turn,topic_key,topic,detail,kind,asked_at)
      SELECT t.owner,t.id,value->>'$.turn',value->>'$.topicKey',value->>'$.topic',value->>'$.detail',value->>'$.kind',value->>'$.askedAt'
      FROM json_each(?) AS record
      JOIN threads t ON t.id=record.value->>'$.threadId'
      JOIN documents d ON d.id=t.doc_id AND d.owner=t.owner
      JOIN memory_jobs j ON j.owner=t.owner AND j.course=d.course
      WHERE t.owner=? AND d.course=? AND j.token=? AND j.expires_at>?`)
      .bind(JSON.stringify(completed),this.owner,course,token,Date.now());
  }

  async setMastered(course:string,key:string,mastered:boolean) {
    if(!(await this.topics(course)).some(card=>card.key===key))return false;
    if(mastered){
      await this.db.prepare('INSERT OR IGNORE INTO memory_mastery(owner,course,topic_key) VALUES(?,?,?)').bind(this.owner,course,key).run();
    }else{
      await this.db.prepare(`DELETE FROM study_mastery WHERE owner=? AND (thread_id,question) IN (
        SELECT e.thread_id,json_extract(t.messages,'$['||(e.turn-1)||'].content') FROM memory_evidence e
        JOIN threads t ON t.id=e.thread_id AND t.owner=e.owner JOIN documents d ON d.id=t.doc_id AND d.owner=t.owner
        WHERE e.owner=? AND d.course=? AND e.topic_key=?)`).bind(this.owner,this.owner,course,key).run();
      await this.db.prepare('DELETE FROM memory_mastery WHERE owner=? AND course=? AND topic_key=?').bind(this.owner,course,key).run();
    }
    return true;
  }
}

function readEvidence(raw:string,snapshot:JobSnapshot):CompletedRecord[] {
  const {records}=readModelObject(raw);
  if(!Array.isArray(records)||records.length!==snapshot.samples.length)throw Error('模型返回的整理结果不完整。');
  const indexed=new Set<number>();
  return records.map(record=>{
    const i=record?.n-1;
    if(!Number.isInteger(record?.n)||!snapshot.samples[i]||indexed.has(i))throw Error('模型返回了无效的记录编号。');
    indexed.add(i);
    const sample=snapshot.samples[i];
    if(record.kind==='skip')return sample;
    if(!['gap','practice','progress'].includes(record.kind))throw Error('模型返回了无效的学习证据。');
    const linked=Number.isInteger(record.existing)?snapshot.existing[record.existing-1]:undefined;
    const topic=linked?.topic??clean(record.topic,64);
    const topicKey=linked?.key??normalize(topic);
    const detail=clean(record.detail,230);
    if(!topicKey||!detail)throw Error('模型未返回主题或具体学习线索。');
    return {...sample,topicKey,topic,detail,kind:record.kind};
  });
}

/** Keep a bounded semantic catalog with recent, difficult, and older concepts represented. */
export function selectMemoryCandidates(cards:TopicCard[],query:string) {
  if(cards.length<=40)return cards;
  const normalized=normalize(query).slice(0,5500);
  const score=(card:TopicCard)=>{
    const topic=normalize(card.topic);
    if(normalized.includes(topic))return 100+topic.length;
    let shared=0;
    for(let i=0;i+2<=topic.length;i++)if(normalized.includes(topic.slice(i,i+2)))shared++;
    return shared/Math.max(1,topic.length);
  };
  const exact=cards.map(card=>({card,score:score(card)})).filter(item=>item.score>0)
    .sort((a,b)=>b.score-a.score).slice(0,12).map(item=>item.card);
  const shortlist=new Map<string,TopicCard>();
  for(const card of [...exact,...cards.filter(card=>card.stage==='review').slice(0,12),...cards.slice(0,10)])shortlist.set(card.key,card);
  const older=cards.filter(card=>!shortlist.has(card.key));
  const free=40-shortlist.size;
  for(let i=0;i<free;i++){
    const card=older[Math.floor(i*older.length/free)];
    if(card)shortlist.set(card.key,card);
  }
  return [...shortlist.values()];
}

export function memorySourceRefs(cards:TopicCard[]):MemorySourceRef[] {
  return cards.map(({topic,evidence:[source]})=>({threadId:source.threadId,topic,page:source.page}));
}
