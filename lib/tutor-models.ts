// Curated from the official model pages on 2026-11-21. This is a capability
// directory, not an account-access list; the server intersects it with /v1/models.
// https://developers.openai.com/api/docs/models
// https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
export const REASONING_LABELS:Record<ReasoningEffort,string>={none:'无',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};
const fifthGeneration = ['none', 'low', 'medium', 'high', 'xhigh'] as const;
const reasoningOnly = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const TUTOR_SPEEDS = ['auto','standard','fast','ultrafast'] as const;
export type TutorSpeed = typeof TUTOR_SPEEDS[number];
export type TutorProcessing = {
  requestedSpeed: TutorSpeed;
  serviceTier: 'default'|'fast'|'priority'|'ultrafast'|'flex'|'scale'|null;
  fallback: boolean|null;
  message: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  tps?: number;
  answerTokens?: number;
  durationMs?: number;
  timingSource?: 'provider'|'request';
};
export type TutorModel = {
  id: string;
  label: string;
  description: string;
  reasoningEfforts: readonly ReasoningEffort[];
  speeds: readonly TutorSpeed[];
  documentation: string;
  snapshots: readonly string[];
  deprecated?: boolean;
};
function model(id:string,label:string,description:string,reasoningEfforts:readonly ReasoningEffort[],snapshots:readonly string[]=[],deprecated=false):TutorModel {
  // Official Fast price table includes all these models except nano; Ultrafast
  // supports the four models named in its guide. Listing is not an access grant.
  // https://developers.openai.com/api/docs/pricing#latest-models
  // https://developers.openai.com/api/docs/guides/ultrafast-mode
  const speeds:TutorSpeed[]=['auto','standard'];
  if(id!=='gpt-5.4-nano')speeds.push('fast');
  if(['gpt-6.2-astra','gpt-6.2-sol','gpt-6-astra','gpt-6.1-sol'].includes(id))speeds.push('ultrafast');
  return { id,label,description,reasoningEfforts,speeds,snapshots,deprecated,documentation:`https://developers.openai.com/api/docs/models/${id}` };
}
// Exclude audio/image-generation/Cyber/Pro-only models: every entry here has
// documented Responses + text/image input support and configurable reasoning.
export const TUTOR_MODELS: readonly TutorModel[] = [
  model('gpt-6.2-astra','GPT-6.2 Astra','旗舰 · 复杂推理',reasoningOnly),
  model('gpt-6.2-sol','GPT-6.2 Sol','通用 · 能力与成本均衡',reasoningOnly),
  model('gpt-6.1-sol','GPT-6.1 Sol','复杂任务',reasoningOnly),
  model('gpt-6.1-terra','GPT-6.1 Terra','视觉理解',REASONING_EFFORTS),
  model('gpt-6-astra','GPT-6 Astra','深度推理',reasoningOnly),
  model('gpt-6-sol','GPT-6 Sol','通用任务',REASONING_EFFORTS),
  model('gpt-6-luna','GPT-6 Luna','轻量 · 高效低成本',REASONING_EFFORTS),
  model('gpt-5.6-sol','GPT-5.6 Sol','通用任务',REASONING_EFFORTS,['gpt-5.6']),
  model('gpt-5.6-terra','GPT-5.6 Terra','均衡任务',REASONING_EFFORTS),
  model('gpt-5.6-luna','GPT-5.6 Luna','轻量任务',REASONING_EFFORTS),
  model('gpt-5.5','GPT-5.5','复杂任务',fifthGeneration,['gpt-5.5-2026-04-23']),
  model('gpt-5.4','GPT-5.4','复杂推导与图表',fifthGeneration,['gpt-5.4-2026-03-05']),
  model('gpt-5.4-mini','GPT-5.4 mini','翻译与日常讲解',fifthGeneration,['gpt-5.4-mini-2026-03-17']),
  model('gpt-5.4-nano','GPT-5.4 nano','轻量任务 · 官方已弃用',fifthGeneration,['gpt-5.4-nano-2026-03-17'],true),
];
export type TutorModelId = string;
export type TutorSettings = { model: TutorModelId; reasoningEffort: ReasoningEffort; speed?: TutorSpeed };
export const DEFAULT_TUTOR_MODEL: TutorModelId = 'gpt-5.4-mini';
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low';

/** Omission preserves the original mini/low contract; malformed values never silently downgrade. */
export function resolveTutorSettings(input: { model?: unknown; reasoningEffort?: unknown; speed?:unknown }): TutorSettings {
  const model = input.model === undefined ? DEFAULT_TUTOR_MODEL : input.model;
  const configuration = TUTOR_MODELS.find(item => item.id === model || item.snapshots.includes(model as string));
  if (!configuration) throw new Error('请选择受支持的讲解模型。');
  const reasoningEffort = input.reasoningEffort === undefined ? DEFAULT_REASONING_EFFORT : input.reasoningEffort;
  if (!configuration.reasoningEfforts.some(effort => effort === reasoningEffort)) {
    throw new Error('请选择该模型支持的思考强度。');
  }
  if(input.speed!==undefined&&!configuration.speeds.some(speed=>speed===input.speed))throw new Error('请选择该模型支持的速度档位。');
  return { model: model as string, reasoningEffort: reasoningEffort as ReasoningEffort,
    ...(input.speed===undefined?{}:{speed:input.speed as TutorSpeed}),
  };
}

/** Prefer a canonical alias, or a documented snapshot if only that ID is listed. */
export function intersectTutorModels(ids:readonly string[]):TutorModel[] {
  const available = new Set(ids);
  return TUTOR_MODELS.flatMap(item => {
    const id = [item.id,...item.snapshots].find(id => available.has(id));
    return id ? [{...item,id}] : [];
  });
}

export function reconcileTutorSettings(settings:TutorSettings,models:readonly TutorModel[]):TutorSettings|null {
  const configuration = models.find(item=>item.id===settings.model)
    ?? models.find(item=>item.id===DEFAULT_TUTOR_MODEL)
    ?? models[0];
  if (!configuration) return null;
  return {
    model: configuration.id,
    reasoningEffort: configuration.reasoningEfforts.includes(settings.reasoningEffort)
      ? settings.reasoningEffort : DEFAULT_REASONING_EFFORT,
    ...(settings.speed===undefined?{}:{speed:configuration.speeds.includes(settings.speed)?settings.speed:'standard' as const}),
  };
}

export type TutorModelDiscovery = {
  status: 'ready'|'empty'|'unavailable';
  models: TutorModel[];
  message: string;
};
