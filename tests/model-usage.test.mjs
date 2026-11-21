import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSelectionWithMetadata, ModelResponseError } from '../server/tutor.ts';
import { meterModelCall } from '../server/model-usage.ts';

const question = {question: 'Explain.', history: [], memories: [], key: 'openai-only'};
const response = {
  object: 'response', status: 'completed', id: 'resp_example',
  output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Explanation.'}]}],
};
const reply = fields =>
  answerSelectionWithMetadata(question, async () => Response.json({...response, ...fields}));

test('Responses model, response ID and token breakdown survive without a price', async () => {
  for (const model of ['gpt-5.4-mini-2026-03-17', 'gpt-5.4-nano-2026-03-17']) {
    const result = await reply({model, usage: {
      input_tokens: 481, input_tokens_details: {cached_tokens: 400},
      output_tokens: 39, output_tokens_details: {reasoning_tokens: 18}, total_tokens: 520,
    }});
    assert.deepEqual(meterModelCall(result, 'gpt-5.4-mini', 'answer'), {
      purpose: 'answer', provider: 'openai', model, modelSource: 'reported', responseId: response.id,
      meteredCredits: 0, inputTokens: 481, cachedTokens: 400, outputTokens: 39, reasoningTokens: 18, totalTokens: 520,
    });
  }
});

test('OpenAI Responses preserves the requested model and raw USD fee, including zero', async () => {
  for (const [model, amount] of [['gpt-5.4-mini', 0], ['gpt-5.4-nano', 0.0000037]]) {
    const result = await answerSelectionWithMetadata({...question, model}, async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.Authorization, 'Bearer openai-only');
      assert.equal(JSON.parse(options.body).model, model);
      return Response.json({...response, model, usage: {input_tokens: 10, output_tokens: 25,
        total_tokens: 35, cost: {amount, currency: 'USD'}}});
    });
    const call = meterModelCall(result, model, 'retrieval');
    assert.equal(call.model, model);
    assert.equal(call.costUsd, amount);
    assert.equal(call.meteredCredits, amount * 100);
  }
});

test('missing usage preserves reported identity and legacy strings carry only requested identity', async () => {
  const result = await reply({model: 'actual-model'});
  assert.equal(result.usage, undefined);
  assert.deepEqual(meterModelCall(result, 'alias', 'index'), {
    purpose: 'index', model: 'actual-model', modelSource: 'reported', provider: 'openai',
    responseId: response.id, meteredCredits: 0,
  });
  assert.deepEqual(meterModelCall('{"costUsd":15}', 'alias', 'answer'),
    {purpose: 'answer', model: 'alias', modelSource: 'requested', meteredCredits: 0});
});

test('token validation retains partial counts, distinguishes zero, and derives only safe complete totals', async () => {
  for (const [raw, expected] of [
    [{input_tokens: 0, output_tokens: 0}, {inputTokens: 0, outputTokens: 0, totalTokens: 0}],
    [{input_tokens: 10, output_tokens: 7}, {inputTokens: 10, outputTokens: 7, totalTokens: 17}],
    [{total_tokens: 5, input_tokens: 1, output_tokens: 1}, {totalTokens: 5, inputTokens: 1, outputTokens: 1}],
    [{output_tokens: 0}, {outputTokens: 0}],
    [{input_tokens: '3', output_tokens: -1, total_tokens: 1.5, input_tokens_details: {cached_tokens: 4}}, {cachedTokens: 4}],
    [{input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1}, {inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1}],
    [{total_tokens: Number.MAX_SAFE_INTEGER + 1, input_tokens: 5, output_tokens: 0}, {inputTokens: 5, outputTokens: 0}],
  ]) {
    assert.deepEqual((await reply({usage: raw})).usage, expected);
  }
});

test('all supported USD labels and consistent duplicate totals yield one fee', async () => {
  for (const usage of [
    {cost_usd: 0.125},
    {cost_usd: '0.12500'},
    {cost: 0.125, cost_currency: 'usd'},
    {cost: '0.125', currency: 'USD'},
    {cost: {amount: '0.125', currency: 'usd'}},
    {cost_usd: '0.125', cost: {amount: 0.125, currency: 'USD'}, cost_currency: 'usd'},
  ]) {
    const call = meterModelCall(await reply({usage}), 'alias', 'answer');
    assert.equal(call.costUsd, 0.125);
    assert.equal(call.meteredCredits, 12.5);
  }
});

test('ambiguous, invalid and conflicting fees preserve independent usage metadata', async () => {
  for (const fields of [
    {cost: 1}, {cost: '0.2'}, {cost: 0}, {cost: 1, unit: 'USD'},
    {cost: 1, currency: 'EUR'}, {cost: 1, currency: 'uſd'}, {cost: {amount: 1, currency: 'CNY'}},
    {cost: {amount: 1}, currency: 'USD'}, {cost_usd: 1, cost_unit: 'quota'},
    {cost: 1, currency: 'usd', cost_currency: 'EUR'}, {cost_usd: 0.2, cost: {amount: 0.2, currency: 'EUR'}},
    {cost_usd: 0, cost: 0.1, currency: 'USD'}, {cost_usd: 1, cost: 'bad', currency: 'USD'},
    {cost_usd: null, cost: 0.5, currency: 'USD'}, {cost_usd: -1}, {cost_usd: Number.MAX_VALUE},
    {cost_usd: false}, {cost_usd: '1e9'}, {cost_usd: ' 0.5'}, {cost_usd: '0.5 '}, {cost_usd: '0x20'},
    {cost_usd: 'NaN'}, {cost_usd: '9'.repeat(50)}, {cost_usd: '0.12345678901234567'},
    {cost_details: {upstream_inference_cost: 20}}, {quota: 6000},
  ]) {
    const result = await reply({usage: {input_tokens: 12, ...fields}, cost_usd: 90, metadata: {cost_usd: 90},
      output: [{type: 'message', content: [{type: 'output_text', text: '{"usage":{"cost_usd":15}}'}]}]});
    const call = meterModelCall(result, 'alias', 'answer');
    assert.equal(call.costUsd, undefined, JSON.stringify(fields));
    assert.equal(call.meteredCredits, 0);
    assert.equal(call.inputTokens, 12);
  }
});

test('incomplete, empty and HTTP error replies retain provider accounting for audit', async () => {
  for (const [fields, status] of [
    [{status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}}, 200],
    [{output: []}, 200], [{output: [null, {type: 'message', content: [null]}]}, 200],
    [{error: {message: 'private error details'}}, 429],
  ]) {
    const body = {...response, ...fields, model: 'gpt-5.4-mini', usage: {output_tokens: 12, cost: {amount: 0.0012, currency: 'USD'}}};
    await assert.rejects(answerSelectionWithMetadata(question, async () => Response.json(body, {status})), error => {
      assert.ok(error instanceof ModelResponseError);
      assert.equal(error.responseId, response.id);
      assert.doesNotMatch(error.message, /private error details/);
      assert.deepEqual(meterModelCall(error, 'alias', 'index'), meterModelCall(error.modelCallMetadata, 'alias', 'index'));
      const call = meterModelCall(error, 'alias', 'index');
      assert.equal(call.responseId, response.id);
      assert.equal(call.model, body.model);
      assert.equal(call.costUsd, 0.0012);
      assert.equal(call.outputTokens, 12);
      assert.equal(call.totalTokens, undefined);
      return true;
    });
  }
});
