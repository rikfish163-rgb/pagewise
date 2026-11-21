import { env } from 'cloudflare:workers';
import { getSiteAccount } from '@/app/site-account';
import { handleStudy, sameOriginWrite } from '@/server/study-service';
import { answerSelectionWithMetadata, projectKey } from '@/server/tutor';
import { discoverTutorModels } from '@/server/tutor-models';

export const dynamic='force-dynamic';
async function handle(request:Request,context:{params:Promise<{path:string[]}>}) {
  const bindings=env as Cloudflare.Env;
  if(request.method!=='GET') {
    if(!sameOriginWrite(request))return Response.json({error:'跨站请求已拒绝。'},{status:403});
  }
  const user=await getSiteAccount();
  return handleStudy(request,(await context.params).path,{db:bindings.DB,bucket:bindings.BUCKET,owner:user?.userId??'',displayName:user?.displayName??null,siteUsagePricing:true,key:projectKey(bindings),answer:answerSelectionWithMetadata,models:discoverTutorModels});
}
export {handle as GET,handle as POST,handle as DELETE};
