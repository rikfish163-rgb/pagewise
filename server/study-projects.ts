export function projectName(value:unknown){
  if(typeof value!=='string')return '';
  const name=value.trim();
  return name.length<=100&&!/[\x00-\x1f\x7f]/.test(name)?name:'';
}

const exists=`(EXISTS(SELECT 1 FROM study_projects WHERE owner=?1 AND name=?2)
  OR EXISTS(SELECT 1 FROM documents WHERE owner=?1 AND course=?2))`;

export async function manageProject(db:D1Database,owner:string,input:unknown){
  const reply=(error:string,status:number)=>({body:{error},status});
  const v=input as {action?:unknown;project?:unknown;target?:unknown}|null;
  const from=projectName(v?.project);
  const target=projectName(v?.target);
  const rename=v?.action==='rename';
  if(!from||(!rename&&v?.action!=='delete')||(v?.target!==undefined&&!target)||(rename&&!target)||from===target)
    return reply('请选择有效的项目或输入不同的项目名。',400);

  const check=(name:string)=>db.prepare('SELECT '+exists+' AS present').bind(owner,name).first<{present:number}>();
  if(!(await check(from))?.present)return reply('这个项目已不存在，请刷新后重试。',404);
  const targetExists=target?Boolean((await check(target))?.present):false;
  if(target&&targetExists===rename)
    return reply(rename?'已有同名项目。':'目标项目已不存在，请重新选择。',409);
  if(!target&&(await db.prepare('SELECT 1 FROM documents WHERE owner=? AND course=? LIMIT 1').bind(owner,from).first()))
    return reply('项目仍有资料，请先选择移入的项目。',409);

  const removeEmpty=db.prepare(`DELETE FROM study_projects WHERE owner=?1 AND name=?2
    AND NOT EXISTS(SELECT 1 FROM documents WHERE owner=?1 AND course=?2)`).bind(owner,from);
  if(!target){
    const abandoned=`NOT ${exists}`;
    await db.batch([removeEmpty,
      db.prepare('DELETE FROM memory_jobs WHERE owner=?1 AND course=?2 AND '+abandoned).bind(owner,from),
      db.prepare('DELETE FROM memory_mastery WHERE owner=?1 AND course=?2 AND '+abandoned).bind(owner,from)]);
    if((await check(from))?.present)return reply('项目仍有资料，请先选择移入的项目。',409);
    return {body:{name:from},status:200};
  }

  // Each statement shares one D1 transaction. A stale source, taken rename, or
  // missing destination fails a NOT NULL/unique constraint and rolls back the move.
  const sourceGuard=rename?db.prepare(`INSERT INTO study_projects(owner,name)
    VALUES(?1,CASE WHEN ${exists}
      AND NOT EXISTS(SELECT 1 FROM documents WHERE owner=?1 AND course=?3)
      THEN ?3 END)`).bind(owner,from,target):
    db.prepare(`INSERT INTO study_projects(owner,name)
      VALUES(?1,CASE WHEN ${exists} THEN ?2 END) ON CONFLICT(owner,name) DO NOTHING`).bind(owner,target);

  try{
    await db.batch([sourceGuard,
      db.prepare('UPDATE documents SET course=? WHERE owner=? AND course=?').bind(target,owner,from),
      db.prepare('UPDATE study_note_sources SET project=? WHERE owner=? AND project=?').bind(target,owner,from),
      db.prepare(`INSERT INTO memory_mastery(owner,course,topic_key)
        SELECT owner,?,topic_key FROM memory_mastery WHERE owner=? AND course=?
        ON CONFLICT(owner,course,topic_key) DO NOTHING`).bind(target,owner,from),
      db.prepare('DELETE FROM memory_mastery WHERE owner=? AND course=?').bind(owner,from),
      db.prepare('DELETE FROM memory_jobs WHERE owner=? AND course IN (?,?)').bind(owner,from,target),
      removeEmpty]);
  }catch(error){
    if(error instanceof Error&&/constraint|unique/i.test(error.message))return reply('项目已变更，请刷新后重试。',409);
    throw error;
  }
  return {body:{name:from,target},status:200};
}
