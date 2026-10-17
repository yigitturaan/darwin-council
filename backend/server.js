import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { config, credentialStatus, roundCadence } from './config.js';
import { privateKeyToAccount } from 'viem/accounts';
import { getRoles } from './analysts.js';
import { evolutionState } from './roles.js';
import { publicClient } from './chain/index.js';
import { event, getRound, getState, setState, listEvents, listRounds, roundsWithStatus } from './store.js';
import { marketState, refreshMarket, startRound, resolveDueRounds, recoverInterrupted, publicRound, publicRoundSummary,
  stopAcceptingRounds, isWorking } from './coordinator.js';
import { recordedModelUsage } from './usage.js';
import { actualPerformance } from './performance.js';
import { publicLineage, syncLineage } from './lineage.js';
import { startTradeIntent, tradeIntent, tradeIntents, markInterruptedTradeIntents } from './trade-intents.js';
import { okxCredentialsReady } from './okx-private.js';
import { readAccountStatus } from './okx-orders.js';

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2048) throw new Error('REQUEST_TOO_LARGE');
  }
  try { return JSON.parse(raw); } catch { throw new Error('INVALID_JSON'); }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
const staticFiles = new Map([
  ['/', ['../frontend/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['../frontend/app.js', 'text/javascript; charset=utf-8']],
  ['/sprites.js', ['../frontend/sprites.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['../frontend/styles.css', 'text/css; charset=utf-8']],
]);
function analystStats() {
  const rounds = roundsWithStatus('RESOLVED','REVEALED').filter((r) => r.resolution);
  return getRoles().map((role) => {
    const scores = rounds.map((r) => r.resolution.analystBrier[role.id]).filter((x) => typeof x === 'number');
    const effective = rounds.map((r) => r.resolution.analystEffectiveScore?.[role.id]).filter((x) => typeof x === 'number');
    return { ...role, resolvedSamples: scores.length, meanBrier: scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : null,
      meanEffectiveScore: effective.length ? effective.reduce((a,b) => a+b, 0) / effective.length : null,
      evolutionEligible: scores.length >= 6, state: scores.length >= 6 ? 'EVALUATION_READY' : 'COLLECTING_LIVE_RESULTS' };
  });
}
function latestAssessment() {
  const round = roundsWithStatus('COMMITTED','DUE','RESOLUTION_PENDING','RESOLVED','REVEALED').at(-1);
  if (!round) return { mode: 'live', status: 'UNAVAILABLE', reason: 'No Fuji-committed live assessment yet', backendAt: Date.now() };
  return { mode: 'live', status: round.status, backendAt: Date.now(), roundId: round.id,
    instrument: round.instrument, probability: round.council.probability,
    startClose: round.startClose, startCandleEnd: round.startCandleEnd,
    dueCandleEnd: round.dueCandleEnd, sourceHash: round.sourceHash,
    validity: Date.now() < round.dueCandleEnd ? 'ACTIVE_FORECAST' : 'HISTORICAL_FORECAST',
    observedAt: round.snapshot.observedAt,
    commitTx: round.commitTx, resolution: round.resolution || null };
}

const server = createServer(async (req, res) => {
  try {
    const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { mode: 'live', backendAt: Date.now(), error: 'FORBIDDEN_HOST' });
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    if (req.method === 'GET' && staticFiles.has(path)) {
      const [file, type] = staticFiles.get(path);
      const bytes = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(bytes);
    }
    if (req.method === 'POST' && req.headers.origin) {
      const allowed = new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`]);
      if (!allowed.has(req.headers.origin)) return send(res, 403, { mode: 'live', backendAt: Date.now(), status: 'FORBIDDEN_ORIGIN' });
    }
    if (req.method === 'GET' && path === '/health') {
      let fuji = { status: 'UNAVAILABLE' };
      try {
        const chainId = await publicClient.getChainId();
        if (chainId !== 43113) throw new Error('Wrong chain');
        const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
        let contractStatus = 'MISSING';
        if (config.contractAddress) {
          const code = await publicClient.getBytecode({ address: config.contractAddress });
          contractStatus = code && code !== '0x' ? 'DEPLOYED' : 'NOT_DEPLOYED';
        }
        let signerBalanceAvax = null;
        if (process.env.FUJI_PRIVATE_KEY) {
          const signer = privateKeyToAccount(process.env.FUJI_PRIVATE_KEY).address;
          signerBalanceAvax = Number(await publicClient.getBalance({ address: signer })) / 1e18;
        }
        fuji = { status: 'LIVE', chainId, blockNumber: blockNumber.toString(), contractStatus, signerBalanceAvax, at: Date.now() };
      }
      catch { fuji = { status: 'UNAVAILABLE', error: 'Fuji connection or configuration could not be verified', at: Date.now() }; }
      const credentials = credentialStatus();
      const modelLastVerifiedAt = getState('modelLastVerifiedAt');
      const modelLastError = getState('modelLastError');
      const modelFailed = modelLastError && modelLastError.at > (modelLastVerifiedAt || 0);
      const ready = credentials.openai && modelLastVerifiedAt && !modelFailed && marketState().status === 'LIVE'
        && fuji.status === 'LIVE' && fuji.contractStatus === 'DEPLOYED' && fuji.signerBalanceAvax > 0;
      const cadence = roundCadence(getState('evolutionLastDecisionCount') || 0);
      const nextScheduledAt = config.autoRounds
        ? (Math.floor(Date.now() / cadence.intervalMs) + 1) * cadence.intervalMs : null;
      return send(res, 200, { mode: 'live', backendAt: Date.now(), status: ready ? 'READY' : 'DEGRADED', process: 'RUNNING', credentials,
        trading: { credentialsPresent: okxCredentialsReady(), liveOrdersEnabled: process.env.ENABLE_LIVE_ORDERS === 'true',
          maxPerIntentUsdt: 5, maxOneOrderPer24h: true },
        model: { status: modelFailed ? 'ERROR' : modelLastVerifiedAt ? 'LIVE_VERIFIED' : credentials.openai ? 'UNVERIFIED' : 'MISSING',
          lastVerifiedAt: modelLastVerifiedAt, lastError: modelLastError, lastAttemptAt: getState('modelLastAttemptAt') },
        market: marketState().status, fuji,
        scheduler: { enabled: config.autoRounds, nextScheduledAt,
          phase: cadence.phase, intervalMinutes: cadence.intervalMinutes,
          forecastHorizonMinutes: 30, steadyIntervalMinutes: config.steadyRoundMinutes },
        worker: { lastCompletedAt: getState('workerLastCompletedAt'), lastError: getState('workerLastError'),
          pendingRecovery: roundsWithStatus('CHAIN_PENDING','RESOLUTION_PENDING','RESOLVED').length },
        lineage: { contractAddress: config.lineageAddress || null,
          lastCompleteAt: getState('lineageLastCompleteAt'), lastError: getState('lineageLastError') } });
    }
    if (req.method === 'GET' && path === '/api/live-market') {
      const state = marketState();
      return send(res, 200, state.status === 'LIVE' && Date.now() - state.data.observedAt < 30_000 ? state : await refreshMarket());
    }
    if (req.method === 'GET' && path === '/api/account') {
      try { return send(res, 200, { mode: 'live', backendAt: Date.now(), account: await readAccountStatus() }); }
      catch { return send(res, 503, { mode: 'live', backendAt: Date.now(), error: 'OKX_ACCOUNT_UNAVAILABLE' }); }
    }
    if (req.method === 'POST' && path === '/api/live-market/refresh') return send(res, 200, await refreshMarket());
    if (req.method === 'GET' && path === '/api/rounds') return send(res, 200, { mode: 'live', backendAt: Date.now(), rounds: listRounds(100).map(publicRoundSummary) });
    if (req.method === 'GET' && path.startsWith('/api/rounds/')) {
      const round = publicRound(getRound(path.split('/')[3]));
      return round ? send(res, 200, { mode: 'live', backendAt: Date.now(), round }) : send(res, 404, { mode: 'live', backendAt: Date.now(), error: 'ROUND_NOT_FOUND' });
    }
    if (req.method === 'POST' && path === '/api/rounds') {
      const key = req.headers['idempotency-key'];
      if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)))
        return send(res, 400, { mode: 'live', backendAt: Date.now(), error: 'INVALID_IDEMPOTENCY_KEY' });
      const started = startRound('manual', key || null);
      return send(res, started.accepted ? 202 : 409, { mode: 'live', backendAt: Date.now(), ...started });
    }
    if (req.method === 'GET' && path === '/api/analysts') return send(res, 200, { mode: 'live', backendAt: Date.now(), analysts: analystStats() });
    if (req.method === 'GET' && path === '/api/usage') return send(res, 200,
      { mode: 'live', backendAt: Date.now(), openai: recordedModelUsage() });
    if (req.method === 'GET' && path === '/api/performance') return send(res, 200,
      { mode: 'live', backendAt: Date.now(), ...actualPerformance() });
    if (req.method === 'GET' && path === '/api/lineage') return send(res, 200,
      { mode: 'live', backendAt: Date.now(), ...await publicLineage() });
    if (req.method === 'GET' && path === '/api/evolution') return send(res, 200, { mode: 'live', backendAt: Date.now(), ...evolutionState() });
    if (req.method === 'GET' && path === '/api/events') {
      const after = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) return send(res, 400, { mode: 'live', backendAt: Date.now(), error: 'INVALID_CURSOR' });
      const events = listEvents(after);
      return send(res, 200, { mode: 'live', backendAt: Date.now(), events, nextCursor: events.at(-1)?.seq ?? after });
    }
    if (req.method === 'GET' && path === '/api/assessment') return send(res, 200, latestAssessment());
    if (req.method === 'GET' && path === '/api/trade-intents') return send(res, 200,
      { mode: 'live', backendAt: Date.now(), intents: tradeIntents() });
    if (req.method === 'GET' && /^\/api\/trade-intents\/[0-9a-f-]{36}$/.test(path)) {
      const intent = tradeIntent(path.split('/')[3]);
      return intent ? send(res, 200, { mode: 'live', backendAt: Date.now(), intent })
        : send(res, 404, { mode: 'live', backendAt: Date.now(), error: 'INTENT_NOT_FOUND' });
    }
    if (req.method === 'POST' && path === '/api/trade-intents') {
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
        return send(res, 400, { mode: 'live', backendAt: Date.now(), error: 'INVALID_IDEMPOTENCY_KEY' });
      let body;
      try { body = await readJson(req); }
      catch (error) { return send(res, 400, { mode: 'live', backendAt: Date.now(), error: error.message }); }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return send(res, 400, { mode: 'live', backendAt: Date.now(), error: 'INVALID_BODY' });
      if (body.execute !== undefined && typeof body.execute !== 'boolean')
        return send(res, 400, { mode: 'live', backendAt: Date.now(), error: 'INVALID_EXECUTION_FLAG' });
      const result = startTradeIntent(body.amountUsdt, key, body.execute === true);
      return send(res, result.accepted ? 202 : result.reason === 'INVALID_AMOUNT' ? 400 : 409,
        { mode: 'live', backendAt: Date.now(), ...result });
    }
    return send(res, 404, { mode: 'live', backendAt: Date.now(), error: 'NOT_FOUND' });
  } catch (error) {
    event('API_ERROR', null, { errorType: error?.name || 'Error' });
    return send(res, 500, { mode: 'live', backendAt: Date.now(), status: 'ERROR', error: 'Backend request failed' });
  }
});

const timers = [];
let closing = false;
async function worker() {
  try {
    await resolveDueRounds();
    setState('workerLastCompletedAt', Date.now());
    setState('workerLastError', null);
    try {
      await syncLineage();
      setState('lineageLastError', null);
    } catch (error) {
      setState('lineageLastError', { at: Date.now(), errorType: error?.name || 'Error',
        message: 'Lineage synchronization pending' });
    }
  } catch (error) {
    const detail = { at: Date.now(), errorType: error?.name || 'Error' };
    setState('workerLastError', detail);
    event('WORKER_ERROR', null, detail);
  }
}
function scheduleTick() {
  const now = Date.now();
  const cadence = roundCadence(getState('evolutionLastDecisionCount') || 0);
  const slot = Math.floor(now / cadence.intervalMs) * cadence.intervalMs;
  const key = `schedulerLastSlot:${cadence.intervalMs}`;
  const previous = getState(key);
  if (previous === slot) return;
  const alreadyCreated = listRounds(100).some((r) => r.trigger === 'scheduled'
    && r.createdAt >= slot && r.createdAt < slot + cadence.intervalMs);
  // Never fabricate forecasts for elapsed slots after sleep or downtime.
  setState(key, slot);
  if (alreadyCreated) return;
  if (now - slot < 30_000) startRound('scheduled');
  else if (previous !== null) event('SCHEDULE_SKIPPED', null, { reason: 'BACKEND_OFFLINE_AT_BOUNDARY', slot });
}
server.listen(config.port, '127.0.0.1', () => {
  // Recover only after binding: a second server must not mutate active rounds.
  recoverInterrupted();
  markInterruptedTradeIntents();
  console.log(`Darwin backend listening on http://127.0.0.1:${config.port}`);
  void refreshMarket();
  void worker();
  timers.push(setInterval(() => { void worker(); }, 15_000));
  timers.push(setInterval(() => { void refreshMarket(); }, 30_000));
  if (config.autoRounds) {
    scheduleTick();
    timers.push(setInterval(scheduleTick, 1000));
  }
});
server.on('error', (error) => { console.error(`Backend startup failed (${error.code || 'ERROR'})`); process.exitCode = 1; });
async function shutdown() {
  if (closing) return;
  closing = true;
  stopAcceptingRounds();
  timers.forEach(clearInterval);
  server.close();
  const deadline = Date.now() + 20_000;
  while (isWorking() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
