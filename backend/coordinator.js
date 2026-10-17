import { randomUUID, randomBytes } from 'node:crypto';
import { getMarketSnapshot, getTargetCandle, snapshotHash } from './market.js';
import { runCouncil } from './analysts.js';
import { advanceEvolution } from './roles.js';
import { saveRound, getRound, getState, setState, pendingDue, event, listRounds, roundsWithStatus, transaction } from './store.js';
import { sendCommitRound, sendRevealRound, confirmTx, getOnchainRecord, commitmentFor,
  publicClient, findRoundTransaction, transactionState, checkChainReady,
  resetFujiNonceReservation } from './chain/index.js';
import { config, roundCadence } from './config.js';

let creating = false;
let resolving = false;
let scheduledQueued = false;
let liveMarket = null;
let marketError = null;
let marketRefreshPromise = null;
let stopping = false;
let activeRoundId = null;
export function stopAcceptingRounds() { stopping = true; scheduledQueued = false; }
export function isWorking() { return creating || resolving; }

function retryError(round, message, error) {
  const attempts = (round.retryAttempts || 0) + 1;
  round.retryAttempts = attempts;
  round.nextRetryAt = Date.now() + Math.min(120_000, 5000 * 2 ** Math.min(attempts, 5));
  round.error = { at: Date.now(), message, errorType: error?.name || 'Error' };
  saveRound(round);
}

function clearRetry(round) {
  round.error = null;
  round.retryAttempts = 0;
  round.nextRetryAt = null;
}

function verifiedPayload(round) {
  const payload = JSON.parse(round.revealPayload);
  if (commitmentFor(payload).commitment !== round.commitment || payload.sourceHash !== round.sourceHash
    || snapshotHash(round.snapshot) !== round.sourceHash || payload.roundId !== round.id
    || payload.instrument !== round.instrument || payload.startClose !== round.startClose
    || payload.startCandleEnd !== round.startCandleEnd || payload.dueCandleEnd !== round.dueCandleEnd
    || payload.probability !== round.council.probability
    || JSON.stringify(payload.final) !== JSON.stringify(round.council.final))
    throw new Error('Persisted forecast does not match its commitment');
  return payload;
}

function transition(round, status, detail = {}) {
  round.status = status;
  round.updatedAt = Date.now();
  transaction(() => {
    saveRound(round);
    event(status, round.id, detail);
  });
}

export function refreshMarket() {
  if (marketRefreshPromise) return marketRefreshPromise;
  marketRefreshPromise = (async () => {
    try {
      liveMarket = await getMarketSnapshot();
      marketError = null;
      return { mode: 'live', backendAt: Date.now(), status: 'LIVE', data: liveMarket };
    } catch (error) {
      marketError = { at: Date.now(), message: error.message };
      return { mode: 'live', backendAt: Date.now(), status: 'UNAVAILABLE', error: marketError,
        lastSuccessful: liveMarket ? { observedAt: liveMarket.observedAt, sourceTimes: liveMarket.sourceTimes } : null };
    }
  })().finally(() => { marketRefreshPromise = null; });
  return marketRefreshPromise;
}

export function marketState() {
  if (!liveMarket) return { mode: 'live', backendAt: Date.now(), status: marketError ? 'UNAVAILABLE' : 'NOT_LOADED', error: marketError };
  const times = liveMarket.sourceTimes;
  const ageMs = Date.now() - Math.min(liveMarket.observedAt, times.ticker, times.orderbook,
    times.candleEnd, times.btc, times.eth);
  const status = marketError ? 'UNAVAILABLE' : ageMs > 180_000 ? 'STALE' : 'LIVE';
  return { mode: 'live', backendAt: Date.now(), status, data: { ...liveMarket, status, ageMs }, error: marketError, ageMs };
}

export function startRound(trigger = 'manual', requestKey = null) {
  if (stopping) return { accepted: false, reason: 'SHUTTING_DOWN' };
  if (requestKey) {
    const previous = getState(`request:${requestKey}`);
    if (previous) return { accepted: true, roundId: previous, reused: true };
  }
  const missing = [!process.env.OPENAI_API_KEY && 'OPENAI_API_KEY',
    !process.env.FUJI_PRIVATE_KEY && 'FUJI_PRIVATE_KEY',
    !config.contractAddress && 'FUJI_CONTRACT_ADDRESS'].filter(Boolean);
  if (missing.length) {
    if (trigger === 'scheduled') event('SCHEDULE_SKIPPED', null, { reason: 'MISSING_CONFIG', missing });
    return { accepted: false, reason: 'MISSING_CONFIG', missing };
  }
  if (creating) {
    if (trigger === 'scheduled') {
      scheduledQueued = true;
      const intervalMs = roundCadence(getState('evolutionLastDecisionCount') || 0).intervalMs;
      setState('scheduledQueuedSlot', Math.floor(Date.now() / intervalMs) * intervalMs);
      event('SCHEDULE_QUEUED', null, { active: activeRoundId });
    }
    return { accepted: false, reason: 'ROUND_IN_PROGRESS', active: listRounds(1)[0]?.id || null };
  }
  creating = true;
  const round = { id: randomUUID(), status: 'CREATING', trigger, createdAt: Date.now(), updatedAt: Date.now(),
    instrument: config.instrument, mode: 'live' };
  activeRoundId = round.id;
  try {
    transaction(() => {
      saveRound(round);
      event('CREATING', round.id, { trigger });
      if (requestKey) setState(`request:${requestKey}`, round.id);
      if (trigger === 'scheduled') setState('scheduledQueuedSlot', null);
    });
  } catch (error) { creating = false; activeRoundId = null; throw error; }
  void processRound(round).finally(() => {
    creating = false;
    activeRoundId = null;
    if (scheduledQueued) {
      scheduledQueued = false;
      startRound('scheduled');
    }
  }).catch(() => { console.error('Round persistence failed; inspect database availability'); });
  return { accepted: true, roundId: round.id };
}

async function processRound(round) {
  try {
    const chain = await checkChainReady();
    round.signer = chain.signer;
    const snapshot = await getMarketSnapshot(round.instrument);
    liveMarket = snapshot;
    marketError = null;
    round.snapshot = snapshot;
    round.startCandleEnd = snapshot.startCandleEnd;
    round.startClose = snapshot.startClose;
    round.dueCandleEnd = snapshot.dueCandleEnd;
    round.sourceHash = snapshot.sourceHash;
    transition(round, 'DATA_READY', { sourceHash: snapshot.sourceHash });
    transition(round, 'ANALYZING');
    const council = await runCouncil(snapshot);
    round.council = council;
    if (council.probability == null) {
      transition(round, 'ABSTAINED', { reason: 'No verified final forecasts' });
      return;
    }
    transition(round, 'VERIFIED', { eligibleCount: council.eligibleCount });
    if (Date.now() >= round.dueCandleEnd) throw new Error('Forecast became late before Fuji commit');
    const payload = {
      version: 1, roundId: round.id, instrument: round.instrument,
      question: 'Is the confirmed 1m candle close 30 minutes later higher than the start close?',
      createdAt: round.createdAt, startCandleEnd: round.startCandleEnd, startClose: round.startClose,
      dueCandleEnd: round.dueCandleEnd, sourceHash: round.sourceHash,
      initial: council.initial, final: council.final,
      probability: council.probability, eligibleCount: council.eligibleCount,
      chair: council.chair, salt: randomBytes(32).toString('hex'),
    };
    round.commitment = commitmentFor(payload).commitment;
    round.revealPayload = JSON.stringify(payload);
    round.chainStartBlock = (await publicClient.getBlockNumber({ cacheTime: 0 })).toString();
    round.lastCommitAttemptAt = Date.now();
    transition(round, 'COMMITTING');
    const sent = await sendCommitRound(round.id, payload);
    round.commitTx = sent;
    transition(round, 'CHAIN_PENDING', { txHash: sent.hash });
    const receipt = await confirmTx(sent.hash);
    if (receipt.blockTimeMs >= round.dueCandleEnd) throw new Error('Fuji commit block was after target candle');
    const record = await getOnchainRecord(round.id);
    if (record?.commitment !== round.commitment) throw new Error('Fuji record does not match local commitment');
    round.commitTx = { ...sent, ...receipt };
    round.committedAt = receipt.blockTimeMs;
    transition(round, 'COMMITTED', { txHash: sent.hash, blockNumber: receipt.blockNumber });
  } catch (error) {
    round.error = { at: Date.now(), message: 'Live round could not complete; check source/model/chain status', errorType: error?.name || 'Error' };
    const status = round.status === 'CREATING' || round.status === 'DATA_READY' ? 'SOURCE_UNAVAILABLE'
      : ['COMMITTING','CHAIN_PENDING'].includes(round.status) ? 'CHAIN_PENDING' : 'ABORTED';
    transition(round, status, { error: round.error.message, errorType: round.error.errorType });
  }
}

export async function resolveDueRounds() {
  if (resolving) return;
  resolving = true;
  try {
    const ready = (r) => r.id !== activeRoundId && (!r.nextRetryAt || r.nextRetryAt <= Date.now());
    for (const round of roundsWithStatus('CHAIN_PENDING').filter(ready)) await recoverChainPending(round);
    for (const round of pendingDue().filter(ready)) await resolveOne(round);
    for (const round of roundsWithStatus('RESOLVED').filter(ready)) await revealOne(round);
    // Idempotent evaluation also runs after restart if a crash happened between
    // saving a real resolution and advancing the evolution state.
    advanceEvolution();
  } finally { resolving = false; }
}

async function recoverChainPending(round) {
  try {
    verifiedPayload(round);
    const record = await getOnchainRecord(round.id);
    const exists = record && record.commitment !== `0x${'0'.repeat(64)}`;
    if (exists && (record.commitment !== round.commitment || (round.signer && record.author.toLowerCase() !== round.signer.toLowerCase()))) {
      round.error = { at: Date.now(), message: 'Onchain commitment mismatch; round cannot be scored' };
      transition(round, 'ABORTED', round.error);
      return;
    }
    if (exists) {
      const hash = await findRoundTransaction(round, 'Committed');
      if (!hash) throw new Error('Committed event not indexed yet');
      round.commitTx = { ...round.commitTx, hash };
      saveRound(round);
    } else {
      if (Date.now() >= round.dueCandleEnd) {
        // A pending transaction may still land. Never turn a late forecast into a score.
        round.error = { at: Date.now(), message: 'No confirmed commitment before deadline; round cannot be scored' };
        transition(round, 'ABORTED', round.error);
        return;
      }
      const previousState = round.commitTx?.hash ? await transactionState(round.commitTx.hash) : 'MISSING';
      if (['PENDING','CONFIRMED'].includes(previousState))
        throw new Error('Transaction still pending');
      if (Date.now() - (round.lastCommitAttemptAt || round.updatedAt) < 90_000)
        throw new Error('Waiting for transaction propagation');
      if (previousState === 'MISSING' || previousState === 'REVERTED') await resetFujiNonceReservation();
      round.lastCommitAttemptAt = Date.now();
      saveRound(round);
      round.commitTx = await sendCommitRound(round.id, JSON.parse(round.revealPayload));
      saveRound(round);
    }
    const receipt = await confirmTx(round.commitTx.hash);
    if (receipt.blockTimeMs >= round.dueCandleEnd) {
      round.error = { at: Date.now(), message: 'Commit confirmation recovered after target candle; round cannot be scored' };
      transition(round, 'ABORTED', round.error);
      return;
    }
    round.commitTx = { ...round.commitTx, ...receipt };
    round.committedAt = receipt.blockTimeMs;
    clearRetry(round);
    transition(round, 'COMMITTED', { txHash: receipt.hash, recovered: true });
  } catch (error) {
    retryError(round, 'Fuji commitment verification pending; automatic recovery will retry', error);
  }
}

async function resolveOne(round) {
  try {
    if (round.status === 'COMMITTED') transition(round, 'DUE');
    verifiedPayload(round);
    const candle = await getTargetCandle(round.instrument, round.dueCandleEnd);
    if (!candle) throw new Error('Target confirmed 1m candle not available from live ATK history');
    const outcome = candle.close > round.startClose ? 1 : 0;
    const scored = round.council.final.filter((f) => !f.abstain);
    round.resolution = {
      source: 'OKX_TR_ATK_CLI', targetCandle: candle, observedAt: Date.now(),
      outcome, councilBrier: (round.council.probability - outcome) ** 2,
      analystBrier: Object.fromEntries(scored
        .map((f) => [f.analystId, (f.probability - outcome) ** 2])),
      claimMismatchRate: Object.fromEntries(scored.map((f) => [f.analystId,
        f.claims.length ? f.claims.filter((c) => c.status === 'MISMATCH').length / f.claims.length : 1])),
      analystEffectiveScore: Object.fromEntries(scored.map((f) => [f.analystId,
        (f.probability - outcome) ** 2 + 0.1 * (f.claims.length
          ? f.claims.filter((c) => c.status === 'MISMATCH').length / f.claims.length : 1)])),
    };
    clearRetry(round);
    round.lastResolutionError = null;
    transition(round, 'RESOLVED', { outcome, targetClose: candle.close });
    try { advanceEvolution(); }
    catch (error) { event('EVOLUTION_ERROR', round.id, { error: error.message }); }
    await revealOne(round);
  } catch (error) {
    retryError(round, 'Confirmed target candle could not be verified; automatic recovery will retry', error);
    if (round.status !== 'RESOLUTION_PENDING') {
      transition(round, 'RESOLUTION_PENDING', { error: round.error.message });
    } else saveRound(round);
  }
}

async function revealOne(round) {
  try {
    if (Date.now() < round.dueCandleEnd || !round.resolution) throw new Error('Reveal not due');
    const payload = verifiedPayload(round);
    const expected = commitmentFor(payload).commitment;
    if (expected !== round.commitment) throw new Error('Local reveal preimage mismatch');
    const record = await getOnchainRecord(round.id);
    if (record?.commitment !== expected) throw new Error('Onchain commitment mismatch');
    if (record.revealed) {
      const hash = await findRoundTransaction(round, 'Revealed');
      if (!hash) throw new Error('Reveal event not indexed yet');
      round.revealTx = { ...round.revealTx, hash };
      saveRound(round);
    } else if (!round.revealTx?.hash || ['MISSING','REVERTED'].includes(await transactionState(round.revealTx.hash))) {
      if (Date.now() - (round.lastRevealAttemptAt || 0) < 90_000) throw new Error('Waiting for reveal propagation');
      if (round.revealTx?.hash) await resetFujiNonceReservation();
      if (!round.revealStartBlock) round.revealStartBlock = (await publicClient.getBlockNumber({ cacheTime: 0 })).toString();
      round.lastRevealAttemptAt = Date.now();
      saveRound(round);
      round.revealTx = await sendRevealRound(round.id, round.revealPayload);
      saveRound(round);
    }
    const receipt = await confirmTx(round.revealTx.hash);
    round.revealTx = { ...round.revealTx, ...receipt };
    clearRetry(round);
    transition(round, 'REVEALED', { txHash: receipt.hash });
  } catch (error) {
    retryError(round, 'Fuji reveal is pending; the backend will retry', error);
    event('REVEAL_PENDING', round.id, { error: round.error.message, errorType: round.error.errorType });
  }
}

export function recoverInterrupted() {
  for (const round of roundsWithStatus('CREATING','DATA_READY','ANALYZING','VERIFIED','COMMITTING')) {
    if (round.status === 'COMMITTING' && round.revealPayload && round.commitment) {
      transition(round, 'CHAIN_PENDING', { recovered: true, reason: 'Reconcile contract before retrying broadcast' });
    } else {
      round.error = { at: Date.now(), message: 'Backend restarted before confirmed Fuji commit' };
      transition(round, 'ABORTED', round.error);
    }
  }
  const queuedSlot = getState('scheduledQueuedSlot');
  if (queuedSlot !== null) {
    setState('scheduledQueuedSlot', null);
    if (config.autoRounds && Date.now() - queuedSlot < 180_000) startRound('scheduled');
    else event('SCHEDULE_SKIPPED', null, { reason: 'QUEUED_SLOT_EXPIRED', slot: queuedSlot });
  }
}

export function publicRound(round) {
  if (!round) return null;
  const { revealPayload, chainStartBlock, lastCommitAttemptAt, lastRevealAttemptAt, ...safe } = round;
  const publiclyCommitted = ['COMMITTED','DUE','RESOLUTION_PENDING','RESOLVED','REVEALED'].includes(round.status);
  if (!publiclyCommitted) {
    const { council, snapshot, commitment, commitTx, ...progress } = safe;
    return { ...progress, pendingCommitTx: commitTx?.hash
      ? { hash: commitTx.hash, explorerUrl: commitTx.explorerUrl } : null };
  }
  if (round.status !== 'REVEALED') return safe;
  return { ...safe, revealedPayload: JSON.parse(revealPayload) };
}

export function publicRoundSummary(round) {
  const safe = publicRound(round);
  return {
    id: safe.id, mode: safe.mode, status: safe.status, trigger: safe.trigger,
    instrument: safe.instrument, createdAt: safe.createdAt, updatedAt: safe.updatedAt,
    marketObservedAt: safe.snapshot?.observedAt || null,
    startCandleEnd: safe.startCandleEnd || null, dueCandleEnd: safe.dueCandleEnd || null,
    startClose: safe.startClose ?? null, sourceHash: safe.sourceHash || null,
    probability: safe.council?.probability ?? null,
    eligibleCount: safe.council?.eligibleCount ?? null,
    commitTx: safe.commitTx?.hash ? { hash: safe.commitTx.hash,
      explorerUrl: safe.commitTx.explorerUrl, blockNumber: safe.commitTx.blockNumber || null } : null,
    committedAt: safe.committedAt || null,
    pendingCommitTx: safe.pendingCommitTx || null,
    outcome: safe.resolution?.outcome ?? null,
    councilBrier: safe.resolution?.councilBrier ?? null,
    targetClose: safe.resolution?.targetCandle?.close ?? null,
    targetCandleEnd: safe.resolution?.targetCandle?.endMs || null,
    revealTx: safe.revealTx?.hash ? { hash: safe.revealTx.hash,
      explorerUrl: safe.revealTx.explorerUrl, blockNumber: safe.revealTx.blockNumber || null } : null,
    error: safe.error || null,
  };
}
