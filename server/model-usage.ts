import {sitePricing} from './site-pricing.ts';
import type { TutorAnswer } from './tutor.ts';

export type ModelCallPurpose = 'answer' | 'retrieval' | 'index';
export type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  cacheWrite30mTokens?: number;
  cacheWrite12hTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
};
export type ModelCallMetadata = {
  provider?: 'openai';
  model?: string;
  responseId?: string;
  serviceTier?: string;
  usage?: ModelUsage;
};

export class ModelResponseError extends Error {
  readonly modelCallMetadata: ModelCallMetadata;

  get responseId(): string | undefined {
    return this.modelCallMetadata.responseId;
  }

  constructor(message: string, metadata: ModelCallMetadata) {
    super(message);
    this.name = 'ModelResponseError';
    this.modelCallMetadata = metadata;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[-\w./:@+]{1,256}$/.test(value) ? value : undefined;
}

function tokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

const {creditsPerUsd}=sitePricing;

function usd(value: unknown): number | undefined {
  // The aggregate ledger rounds to thousandths of a credit.
  return typeof value === 'number' && value >= 0 && value * creditsPerUsd * 1000 <= Number.MAX_SAFE_INTEGER
    ? value : undefined;
}

function feeAmount(value: unknown): number | undefined {
  if (typeof value !== 'string') return usd(value);
  if (value.length > 48 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return undefined;
  // Bound significant digits before converting a provider's decimal string to a JS number.
  const digits = value.replace('.', '').replace(/^0+|0+$/g, '');
  return digits.length <= 15 ? usd(Number(value)) : undefined;
}

function isUsd(unit: unknown): boolean {
  return typeof unit === 'string' && unit.toLowerCase() === 'usd';
}

function reportedFee(usage: Record<string, unknown>): number | undefined {
  const cost = record(usage.cost);
  const units = [usage.currency, usage.cost_currency, usage.unit, usage.cost_unit, cost.currency, cost.unit];
  if (units.some(unit => unit !== undefined && !isUsd(unit))) return undefined;

  const explicitUsd = feeAmount(usage.cost_usd);
  if (usage.cost_usd !== undefined && explicitUsd === undefined) return undefined;
  if (usage.cost === undefined) return explicitUsd;

  let amount: number | undefined;
  if ((typeof usage.cost === 'number' || typeof usage.cost === 'string') && (isUsd(usage.currency) || isUsd(usage.cost_currency))) {
    amount = feeAmount(usage.cost);
  } else if (isUsd(cost.currency)) {
    amount = feeAmount(cost.amount);
  }
  if (explicitUsd !== undefined && explicitUsd !== amount) return undefined;
  return amount;
}

export function readModelCallMetadata(response: unknown): ModelCallMetadata {
  const data = record(response);
  const raw = record(data.usage);
  const inputTokens = tokens(raw.input_tokens);
  const outputTokens = tokens(raw.output_tokens);
  let totalTokens = tokens(raw.total_tokens);
  if (raw.total_tokens == null && inputTokens !== undefined && outputTokens !== undefined) {
    totalTokens = tokens(inputTokens + outputTokens);
  }
  const details=record(raw.input_tokens_details);
  const writes=record(details.cache_write_tokens_details);
  const cachedTokens=tokens(details.cached_tokens);
  const cacheWriteTokens=tokens(details.cache_write_tokens);
  const cacheWrite30mTokens=tokens(writes.ttl_30m_tokens);
  const cacheWrite12hTokens=tokens(writes.ttl_12h_tokens);
  const reasoningTokens = tokens(record(raw.output_tokens_details).reasoning_tokens);
  const costUsd = reportedFee(raw);
  const usage: ModelUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (cachedTokens !== undefined) usage.cachedTokens = cachedTokens;
  if (cacheWriteTokens !== undefined) usage.cacheWriteTokens = cacheWriteTokens;
  if (cacheWrite30mTokens !== undefined) usage.cacheWrite30mTokens = cacheWrite30mTokens;
  if (cacheWrite12hTokens !== undefined) usage.cacheWrite12hTokens = cacheWrite12hTokens;
  if (reasoningTokens !== undefined) usage.reasoningTokens = reasoningTokens;
  if (costUsd !== undefined) usage.costUsd = costUsd;

  const metadata: ModelCallMetadata = {provider: 'openai'};
  const model = identifier(data.model);
  const responseId = identifier(data.id);
  const serviceTier=identifier(data.service_tier);
  if (serviceTier) metadata.serviceTier=serviceTier;
  if (model) metadata.model = model;
  if (responseId) metadata.responseId = responseId;
  if (Object.keys(usage).length) metadata.usage = usage;
  return metadata;
}

export type MeteredModelCall = ModelUsage & {
  purpose: ModelCallPurpose;
  model: string;
  modelSource: 'reported' | 'requested';
  provider?: 'openai';
  responseId?: string;
  serviceTier?: string;
  meteredCredits: number;
};

/** Per-call credits retain precision. Round once after summing an operation's fees. */
export function meterModelCall(
  result: string | TutorAnswer | ModelCallMetadata | ModelResponseError,
  requestedModel: string,
  purpose: ModelCallPurpose,
): MeteredModelCall {
  const metadata = result instanceof ModelResponseError ? result.modelCallMetadata
    : typeof result === 'string' ? {} : result;
  const model = identifier(metadata.model);
  const usage = metadata.usage ?? {};
  const costUsd = usd(usage.costUsd);
  const call: MeteredModelCall = {
    purpose, model: model ?? requestedModel, modelSource: model ? 'reported' : 'requested',
    meteredCredits: (costUsd ?? 0) * creditsPerUsd,
  };
  if (metadata.provider === 'openai') call.provider = metadata.provider;
  if (metadata.responseId) call.responseId = metadata.responseId;
  if (metadata.serviceTier) call.serviceTier=metadata.serviceTier;
  if (costUsd !== undefined) call.costUsd = costUsd;
  for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedTokens', 'cacheWriteTokens', 'cacheWrite30mTokens', 'cacheWrite12hTokens', 'reasoningTokens'] as const) {
    const count = tokens(usage[field]);
    if (count !== undefined) call[field] = count;
  }
  return call;
}
