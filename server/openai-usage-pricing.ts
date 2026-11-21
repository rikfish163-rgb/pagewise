import {TUTOR_MODELS} from '../lib/tutor-models.ts';

const priceVersion='2026-11-21';

// OpenAI synchronous Responses rates in USD per million tokens, verified on 2026-11-21.
// https://developers.openai.com/api/docs/pricing
// Fast and Ultrafast availability is restricted by the tutor model catalog.
type RateRow = [input:number, output:number, cached:number];
const standard:Record<string,RateRow>={
  'gpt-6.2-astra':[8,40,.4],
  'gpt-6.2-sol':[2,10,.1],
  'gpt-6.1-sol':[2,10,.1],
  'gpt-6.1-terra':[1,5,.05],
  'gpt-6-astra':[10,50,1],
  'gpt-6-sol':[2,10,.2],
  'gpt-6-luna':[.1,.5,.01],
  'gpt-5.6-sol':[4,20,.4],
  'gpt-5.6-terra':[2,12,.2],
  'gpt-5.6-luna':[.2,1.2,.02],
  'gpt-5.5':[5,30,.5],
  'gpt-5.4':[2.5,15,.25],
  'gpt-5.4-mini':[.75,4.5,.075],
  'gpt-5.4-nano':[.2,1.25,.02],
};

type Usage = {
  inputTokens?:number; outputTokens?:number; totalTokens?:number; cachedTokens?:number;
  cacheWriteTokens?:number; cacheWrite30mTokens?:number; cacheWrite12hTokens?:number;
};
export function priceOpenAiUsage(model:string,serviceTier:string|undefined,usage:Usage,now=Date.now()){
  const config=TUTOR_MODELS.find(item=>model===item.id||item.snapshots.includes(model)||
    (model.startsWith(item.id+'-')&&/^\d{4}-\d{2}-\d{2}$/.test(model.slice(item.id.length+1))));
  if(!config)return;
  const tier=serviceTier==='priority'?'fast':serviceTier;
  const {inputTokens,outputTokens,totalTokens,cachedTokens=0,cacheWriteTokens,cacheWrite30mTokens,cacheWrite12hTokens}=usage;
  if(inputTokens==null||outputTokens==null||(totalTokens!=null&&totalTokens!==inputTokens+outputTokens))return;
  const cacheWrite30m=cacheWrite30mTokens??0;
  const cacheWrite12h=cacheWrite12hTokens??0;
  const cacheWrites=cacheWrite30m+cacheWrite12h;
  if((cacheWriteTokens!=null&&cacheWriteTokens!==cacheWrites)||cachedTokens+cacheWrites>inputTokens)return;

  const base=standard[config.id];
  if(!base)return;
  const longContext=inputTokens>272_000&&!['gpt-5.4-mini','gpt-5.4-nano'].includes(config.id);
  const nextGen=config.id.startsWith('gpt-6.2-');
  const older=config.id.startsWith('gpt-5.4')||config.id==='gpt-5.5';
  if(cacheWrites&&older)return;
  let multiplier:number;
  if(tier==='default')multiplier=1;
  else if(tier==='flex'&&!nextGen)multiplier=.5;
  else if(tier==='fast'&&config.speeds.includes('fast')&&!(longContext&&older))multiplier=config.id==='gpt-5.5'?2.5:2;
  else if(tier==='ultrafast'&&config.speeds.includes('ultrafast')) {
    multiplier=nextGen&&now<Date.parse('2027-03-01T08:00:00Z')?3:6;
  }else return;

  const [input,output,cached]=base;
  const rates={
    input:input*multiplier*(longContext?2:1),
    output:output*multiplier*(longContext?1.5:1),
    cached:cached*multiplier*(longContext?2:1),
    write30m:older?0:input*multiplier*(longContext?2:1)*1.25,
    write12h:older?0:input*multiplier*(longContext?2:1)*2.5,
  };
  const uncached=inputTokens-cachedTokens-cacheWrites;
  const usd=(uncached*rates.input+cachedTokens*rates.cached+cacheWrite30m*rates.write30m+
    cacheWrite12h*rates.write12h+outputTokens*rates.output)/1_000_000;
  return {usd,tier,model:config.id,rateVersion:priceVersion,rates};
}
