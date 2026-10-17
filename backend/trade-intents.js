import { randomUUID, randomBytes } from 'node:crypto';
import { getMarketSnapshot } from './market.js';
import { runTradeCouncil } from './analysts.js';
import { evaluateTradeIntent, MAX_INTENT_USDT } from './trade-policy.js';
import { checkChainReady, commitmentFor, sendCommitRound, sendRevealRound,
  confirmTx, getOnchainRecord } from './chain/index.js';
import { event, getState, setState, saveTradeIntent, getTradeIntent, listTradeIntents,
  transaction } from './store.js';
import { spotBuyPreflight, placeSpotMarketBuy, getSpotOrder } from './okx-orders.js';
import { okxCredentialsReady } from './okx-private.js';

let processing = false;
const chainIdFor = (id) => `trade:${id}`;

function transition(intent, status, details = {}) {
  intent.status = status;
  intent.updatedAt = Date.now();
  transaction(() => { saveTradeIntent(intent); event(`TRADE_${status}`, intent.id, details); });
}
function executionTransition(intent, status, details = {}) {
  intent.execution.status = status;
  intent.updatedAt = Date.now();
  transaction(() => { saveTradeIntent(intent); event(`TRADE_ORDER_${status}`, intent.id, details); });
}

export function startTradeIntent(amountUsdt, requestKey, executionRequested = false) {
  if (!Number.isFinite(amountUsdt) || amountUsdt < 5 || amountUsdt > MAX_INTENT_USDT
    || Math.abs(Math.round(amountUsdt * 100) - amountUsdt * 100) > 1e-6)
    return { accepted: false, reason: 'INVALID_AMOUNT', minUsdt: 5, maxUsdt: MAX_INTENT_USDT };
  amountUsdt = Math.round(amountUsdt * 100) / 100;
  if (requestKey) {
    const previous = getState(`request:trade:${requestKey}`);
    if (previous) return { accepted: true, intentId: previous, reused: true };
  }
  if (processing) return { accepted: false, reason: 'TRADE_REVIEW_IN_PROGRESS' };
  if (executionRequested && (process.env.ENABLE_LIVE_ORDERS !== 'true' || !okxCredentialsReady()))
    return { accepted: false, reason: 'LIVE_ORDERS_NOT_READY' };
  if (!process.env.OPENAI_API_KEY || !process.env.FUJI_PRIVATE_KEY || !process.env.FUJI_CONTRACT_ADDRESS)
    return { accepted: false, reason: 'MISSING_CONFIG' };
  processing = true;
  const intent = { id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(),
    status: 'CREATING', mode: 'live', instrument: 'AVAX-USDT', side: 'BUY',
    amountUsdt, executionRequested,
    execution: { status: executionRequested ? 'AWAITING_DECISION' : 'NOT_REQUESTED', orderId: null } };
  try {
    transaction(() => {
      saveTradeIntent(intent);
      event('TRADE_CREATING', intent.id, { amountUsdt });
      if (requestKey) setState(`request:trade:${requestKey}`, intent.id);
    });
  } catch (error) { processing = false; throw error; }
  void processTradeIntent(intent).finally(() => { processing = false; });
  return { accepted: true, intentId: intent.id };
}

async function processTradeIntent(intent) {
  try {
    await checkChainReady();
    const first = await getMarketSnapshot();
    intent.market = { first: { observedAt: first.observedAt, sourceHash: first.sourceHash,
      metrics: first.metrics, sourceTimes: first.sourceTimes } };
    transition(intent, 'ANALYZING', { sourceHash: first.sourceHash });
    const council = await runTradeCouncil(first, intent.amountUsdt);
    intent.council = council;
    // The market may change during model calls. Re-fetch before evaluating any BUY.
    const latest = await getMarketSnapshot();
    intent.market.latest = { observedAt: latest.observedAt, sourceHash: latest.sourceHash,
      metrics: latest.metrics, sourceTimes: latest.sourceTimes };
    intent.decision = evaluateTradeIntent({ amountUsdt: intent.amountUsdt, council, first, latest });
    intent.decidedAt = Date.now();
    transition(intent, 'DECIDED');
    const payload = { version: 1, kind: 'SPOT_BUY_REVIEW', intentId: intent.id,
      createdAt: intent.createdAt, decidedAt: intent.decidedAt, instrument: intent.instrument,
      amountUsdt: intent.amountUsdt, firstSourceHash: first.sourceHash,
      latestSourceHash: latest.sourceHash, council, decision: intent.decision,
      executionRequested: intent.executionRequested,
      executionRule: 'ONLY_VERDICT_BUY_AFTER_FUJI_REVEAL_AND_FRESH_PREFLIGHT',
      salt: randomBytes(32).toString('hex') };
    intent.commitment = commitmentFor(payload).commitment;
    intent.revealPayload = JSON.stringify(payload);
    transition(intent, 'COMMITTING');
    intent.commitTx = await sendCommitRound(chainIdFor(intent.id), payload);
    transition(intent, 'CHAIN_PENDING', { txHash: intent.commitTx.hash });
    const receipt = await confirmTx(intent.commitTx.hash);
    const record = await getOnchainRecord(chainIdFor(intent.id));
    if (record?.commitment !== intent.commitment) throw new Error('Fuji commitment mismatch');
    intent.commitTx = { ...intent.commitTx, ...receipt };
    transition(intent, 'COMMITTED', { txHash: receipt.hash });
    intent.revealTx = await sendRevealRound(chainIdFor(intent.id), intent.revealPayload);
    transition(intent, 'REVEAL_PENDING', { txHash: intent.revealTx.hash });
    intent.revealTx = { ...intent.revealTx, ...await confirmTx(intent.revealTx.hash) };
    transition(intent, 'REVEALED', { txHash: intent.revealTx.hash });
    if (intent.executionRequested) await executeIfApproved(intent, first);
  } catch (error) {
    if (intent.execution.status === 'SUBMITTING') intent.execution.status = 'UNKNOWN';
    else if (intent.execution.status === 'AWAITING_DECISION') intent.execution.status = 'ABORTED_NO_ORDER';
    intent.error = { at: Date.now(), message: error?.message || 'Trade review failed' };
    transition(intent, 'FAILED', { error: intent.error.message });
  }
}

async function executeIfApproved(intent, first) {
  if (intent.decision.verdict !== 'BUY') {
    intent.execution = { status: 'SKIPPED_BY_COUNCIL', reason: intent.decision.verdict, orderId: null };
    executionTransition(intent, 'SKIPPED_BY_COUNCIL', { verdict: intent.decision.verdict });
    return;
  }
  try {
    if (Date.now() - intent.decidedAt > 120_000) throw new Error('Konsey kararı artık güncel değil');
    const recent = listTradeIntents(10000).filter((entry) => entry.id !== intent.id
      && entry.createdAt >= Date.now() - 86_400_000
      && ['SUBMITTING','ACCEPTED','FILLED','UNKNOWN'].includes(entry.execution?.status));
    if (recent.length) throw new Error('Son 24 saatte başka gerçek emir var; 5 USDT günlük sınır doldu');
    const latest = await getMarketSnapshot();
    const freshDecision = evaluateTradeIntent({ amountUsdt: intent.amountUsdt,
      council: intent.council, first, latest });
    if (freshDecision.verdict !== 'BUY') throw new Error(`Emir öncesi piyasa kontrolü: ${freshDecision.verdict}`);
    const account = await spotBuyPreflight(intent.amountUsdt, latest.metrics.lastPrice);
    intent.execution.preflight = { at: Date.now(), account, sourceHash: latest.sourceHash,
      decision: freshDecision.verdict };
    const clientOrderId = `DK${intent.id.replaceAll('-', '').slice(0, 30)}`;
    intent.execution = { ...intent.execution, status: 'SUBMITTING', clientOrderId,
      submittedAt: Date.now() };
    executionTransition(intent, 'SUBMITTING', { clientOrderId });
    let accepted;
    try { accepted = await placeSpotMarketBuy({ amountUsdt: intent.amountUsdt, clientOrderId }); }
    catch (error) {
      intent.execution = { ...intent.execution, status: 'UNKNOWN', error: error.message };
      executionTransition(intent, 'UNKNOWN');
      return;
    }
    intent.execution = { ...intent.execution, status: 'ACCEPTED', ...accepted };
    executionTransition(intent, 'ACCEPTED', { orderId: accepted.orderId });
    try {
      const order = await getSpotOrder(accepted);
      intent.execution = { ...intent.execution, ...order,
        status: order.state === 'filled' ? 'FILLED' : 'ACCEPTED' };
      executionTransition(intent, intent.execution.status, { orderId: accepted.orderId });
    } catch { /* Keep the acknowledged order ID; no second placement. */ }
  } catch (error) {
    if (['SUBMITTING','ACCEPTED','FILLED','UNKNOWN'].includes(intent.execution.status)) {
      // Once placement may have reached OKX, never relabel it as a safe preflight rejection.
      intent.execution = { ...intent.execution, status: 'UNKNOWN', error: error.message };
      executionTransition(intent, 'UNKNOWN');
      return;
    }
    intent.execution = { ...intent.execution, status: 'BLOCKED_PREFLIGHT', reason: error.message };
    executionTransition(intent, 'BLOCKED_PREFLIGHT');
  }
}

export function publicTradeIntent(intent) {
  if (!intent) return null;
  const { revealPayload, council, decision, ...safe } = intent;
  const visible = Boolean(intent.commitTx?.blockNumber)
    || ['COMMITTED','REVEAL_PENDING','REVEALED'].includes(intent.status);
  return { ...safe, council: visible ? council : null,
    decision: visible ? decision : null,
    market: visible ? intent.market : { first: intent.market?.first
      ? { observedAt: intent.market.first.observedAt, sourceHash: intent.market.first.sourceHash } : null } };
}

export function tradeIntent(id) { return publicTradeIntent(getTradeIntent(id)); }
export function tradeIntents() { return listTradeIntents(20).map(publicTradeIntent); }
export function markInterruptedTradeIntents() {
  for (const intent of listTradeIntents(10000)) {
    if (intent.execution?.status === 'SUBMITTING') {
      intent.execution.status = 'UNKNOWN';
      intent.execution.error = 'Emir gönderimi sırasında süreç durdu; OKX order ID kontrol edilmeli. Otomatik tekrar yok.';
      executionTransition(intent, 'UNKNOWN');
    }
    if (intent.status === 'REVEALED' && intent.execution?.status === 'AWAITING_DECISION') {
      intent.execution.status = 'INTERRUPTED_NO_ORDER';
      executionTransition(intent, 'INTERRUPTED_NO_ORDER');
    }
    if (['CREATING','ANALYZING','DECIDED','COMMITTING','CHAIN_PENDING',
      'COMMITTED','REVEAL_PENDING'].includes(intent.status)) {
      intent.error = { at: Date.now(), message: 'Review interrupted; onchain record requires inspection' };
      transition(intent, 'INTERRUPTED');
    }
  }
}
