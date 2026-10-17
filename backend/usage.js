import { listRounds } from './store.js';

// OpenAI public standard text-token price on 2026-10-17, USD per million tokens.
// Unknown models are counted but never assigned a guessed cost.
const prices = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-mini-2025-04-14': { input: 0.4, output: 1.6 },
};

export function recordedModelUsage() {
  const calls = [];
  for (const round of listRounds(1000)) {
    if (!round.council) continue;
    for (const forecast of [...(round.council.initial || []), ...(round.council.final || [])]) {
      if (!forecast.usage) continue;
      calls.push({ model: forecast.model, input: forecast.usage.inputTokens || 0,
        output: forecast.usage.outputTokens || 0 });
    }
    const chair = round.council.chair;
    if (chair?.usage) calls.push({ model: chair.model, input: chair.usage.prompt_tokens || 0,
      output: chair.usage.completion_tokens || 0 });
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedUsd = 0;
  let unpricedCalls = 0;
  for (const call of calls) {
    inputTokens += call.input;
    outputTokens += call.output;
    const price = prices[call.model];
    if (price) estimatedUsd += (call.input * price.input + call.output * price.output) / 1_000_000;
    else unpricedCalls++;
  }
  return { source: 'RECORDED_DARWIN_ROUNDS_ONLY', calls: calls.length,
    inputTokens, outputTokens,
    estimatedUsd: unpricedCalls ? null : Number(estimatedUsd.toFixed(8)),
    unpricedCalls, priceAsOf: '2026-10-17',
    accountBalanceUsd: null,
    note: 'Excludes smoke tests, other applications, interrupted or failed calls without saved usage, and changes to OpenAI pricing.' };
}
