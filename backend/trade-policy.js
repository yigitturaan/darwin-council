// These are safety limits for a proposed spot BUY, not a profit prediction.
export const MAX_INTENT_USDT = 5;

export function evaluateTradeIntent({ amountUsdt, council, first, latest, now = Date.now() }) {
  const checks = [];
  const add = (name, passed, observed, limit) => checks.push({ name, passed, observed, limit });
  const ageMs = now - Math.min(latest.observedAt, latest.sourceTimes.ticker,
    latest.sourceTimes.orderbook, latest.sourceTimes.candleEnd);
  add('FRESH_DATA', ageMs >= 0 && ageMs <= 90_000, ageMs, 90_000);
  const spreadBps = latest.metrics.spreadBps;
  add('SPREAD', Number.isFinite(spreadBps) && spreadBps <= 30, spreadBps, 30);
  const range15mPct = latest.metrics.range15mPct;
  add('RECENT_RANGE', Number.isFinite(range15mPct) && range15mPct <= 3, range15mPct, 3);
  const askNotionalUsdt = latest.orderbook.asks.reduce((sum, level) => sum + level.price * level.size, 0);
  add('ASK_DEPTH', askNotionalUsdt >= amountUsdt * 20, askNotionalUsdt, amountUsdt * 20);
  const priceDriftPct = 100 * Math.abs(latest.metrics.lastPrice / first.metrics.lastPrice - 1);
  add('PRICE_DRIFT_DURING_REVIEW', priceDriftPct <= 0.5, priceDriftPct, 0.5);
  const eligible = council.eligibleCount;
  const buyVotes = council.votes.BUY;
  const blockVotes = council.votes.BLOCK;
  add('VERIFIED_ANALYSTS', eligible >= 3, eligible, 3);
  add('BUY_CONSENSUS', buyVotes >= 3 && blockVotes === 0, buyVotes, 3);
  const failed = checks.filter((check) => !check.passed).map((check) => check.name);
  const hardBlock = failed.some((name) => ['FRESH_DATA','SPREAD','ASK_DEPTH','VERIFIED_ANALYSTS'].includes(name))
    || blockVotes >= 2;
  return { verdict: hardBlock ? 'BLOCK' : failed.length ? 'WAIT' : 'BUY',
    checks, failed, votes: council.votes,
    note: 'Risk koşulları ve doğrulanmış oylar değerlendirilir; kâr veya yükseliş garantisi değildir.' };
}
