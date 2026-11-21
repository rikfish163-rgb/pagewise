import { intersectTutorModels, type TutorModelDiscovery } from '../lib/tutor-models.ts';

/** Metadata only; does not run billable inference or return account/owner details. */
export async function discoverTutorModels(key:string,send:typeof fetch=fetch):Promise<TutorModelDiscovery> {
  const unavailable = (message:string):TutorModelDiscovery => ({status:'unavailable',models:[],message});
  if (!key) return unavailable('管理员尚未配置 OpenAI API 密钥，暂无法查询模型。');
  try {
    const response = await send('https://api.openai.com/v1/models',{
      method:'GET',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) return unavailable(response.status===401||response.status===403
      ? '模型列表查询受限，暂无法核实权限；仍可尝试已授权的模型。'
      : '模型列表暂不可用，稍后可重新查询。');
    const data:unknown = await response.json();
    if (!data||typeof data!=='object'||!('data' in data)||!Array.isArray(data.data)
      ||!data.data.every(item=>item&&typeof item==='object'&&typeof item.id==='string')) {
      return unavailable('模型列表响应无效，稍后可重新查询。');
    }
    const models = intersectTutorModels(data.data.map(item=>item.id));
    return models.length
      ? {status:'ready',models,message:'已按本站 API 项目的模型列表筛选。'}
      : {status:'empty',models:[],message:'本站 API 项目暂未列出兼容文字与图片讲解的模型。'};
  } catch {
    return unavailable('无法连接模型列表服务，稍后可重新查询。');
  }
}
