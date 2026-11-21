import {persistWithCredit} from './learning-credits.ts';
type Note = {body:string; revision:number};
export async function notebook(request:Request,db:D1Database,owner:string) {
  await db.prepare('CREATE TABLE IF NOT EXISTS notebooks (owner TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL)').run();
  if(request.method==='GET') return Response.json(await db.prepare('SELECT body,revision FROM notebooks WHERE owner=?').bind(owner).first<Note>() ?? {body:'',revision:0},{headers:{'Cache-Control':'private, no-store'}});
  const value = await request.json() as Note;
  if(typeof value.body!=='string'||value.body.length>250000||!Number.isInteger(value.revision))return Response.json({error:'笔记最多 25 万字。'},{status:400});
  const previous=await db.prepare('SELECT body,revision FROM notebooks WHERE owner=?').bind(owner).first<Note>();
  const query=value.revision===0?db.prepare('INSERT OR IGNORE INTO notebooks(owner,body,revision) VALUES(?,?,1)').bind(owner,value.body):db.prepare('UPDATE notebooks SET body=?, revision=revision+1 WHERE owner=? AND revision=?').bind(value.body,owner,value.revision);
  const saved=await persistWithCredit(db,query,owner,'note_saved','notebook',!!value.body.trim()&&value.body!==previous?.body);
  if(!(saved.meta?.changes??(saved as unknown as {changes:number}).changes))return Response.json({error:'笔记已在其他窗口更新。请先导出当前草稿，再刷新合并。'},{status:409});
  return Response.json({revision:value.revision+1});
}
export async function shelf(db:D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS shelf (doc TEXT PRIMARY KEY, pinned INTEGER DEFAULT 0, visited INTEGER DEFAULT 0)').run();
}
