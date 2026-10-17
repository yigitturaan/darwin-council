import 'dotenv/config';
import OpenAI from 'openai';
import { config } from './config.js';
import { setState } from './store.js';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing in local .env');
const started = Date.now();
try {
  const result = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 0 })
    .chat.completions.create({ model: config.model, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return exactly one valid JSON object with {"status":"ok"}.' }] });
  const content = JSON.parse(result.choices[0]?.message?.content || '{}');
  if (content.status !== 'ok') throw new Error('Model response was not the required JSON');
  setState('modelLastVerifiedAt', Date.now());
  console.log(JSON.stringify({ mode: 'live', status: 'OK', model: result.model,
    latencyMs: Date.now() - started, usage: result.usage }, null, 2));
} catch (error) {
  const code = Number(error?.status);
  console.error(`OpenAI smoke test failed${Number.isInteger(code) ? ` (HTTP ${code})` : ''}; key value was not logged`);
  process.exitCode = 1;
}
