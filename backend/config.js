import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 8787),
  instrument: process.env.INSTRUMENT || 'AVAX-USDT',
  model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  autoRounds: process.env.AUTO_ROUNDS !== 'false',
  fastRoundMinutes: Number(process.env.DARWIN_FAST_INTERVAL_MINUTES || 10),
  steadyRoundMinutes: Number(process.env.DARWIN_STEADY_INTERVAL_MINUTES || 30),
  fujiRpc: process.env.FUJI_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
  contractAddress: process.env.FUJI_CONTRACT_ADDRESS || '',
  lineageAddress: process.env.FUJI_LINEAGE_ADDRESS || '',
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid PORT');
if (config.instrument !== 'AVAX-USDT') throw new Error('This council requires INSTRUMENT=AVAX-USDT');
if (process.env.AUTO_ROUNDS && !['true','false'].includes(process.env.AUTO_ROUNDS)) throw new Error('AUTO_ROUNDS must be true or false');
for (const value of [config.fastRoundMinutes, config.steadyRoundMinutes]) {
  if (!Number.isInteger(value) || value < 1 || 60 % value !== 0)
    throw new Error('Round interval must be a positive whole-minute divisor of 60');
}

export function roundCadence(decisionCount = 0) {
  const phase = decisionCount > 0 ? 'STEADY_AFTER_DARWIN_DECISION' : 'FAST_UNTIL_DARWIN_DECISION';
  const intervalMinutes = decisionCount > 0 ? config.steadyRoundMinutes : config.fastRoundMinutes;
  return { phase, intervalMinutes, intervalMs: intervalMinutes * 60_000 };
}

export function credentialStatus() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    fujiSigner: Boolean(process.env.FUJI_PRIVATE_KEY),
    fujiContract: Boolean(config.contractAddress),
  };
}
