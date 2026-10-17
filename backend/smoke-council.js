import { getMarketSnapshot } from './market.js';
import { runCouncil } from './analysts.js';

const snapshot = await getMarketSnapshot();
const council = await runCouncil(snapshot);
const compact = (f) => ({ analystId: f.analystId, abstain: f.abstain,
  probability: f.probability ?? null, claimStatuses: f.claims.map((c) => ({ metric: c.metric, status: c.status })),
  reason: f.reason, status: f.status || 'LIVE', model: f.model || null, usage: f.usage || null });
console.log(JSON.stringify({ mode: 'live', status: 'UNCOMMITTED_SMOKE_TEST',
  source: snapshot.source, sourceTimes: snapshot.sourceTimes, startCandleEnd: snapshot.startCandleEnd,
  dueCandleEnd: snapshot.dueCandleEnd, initial: council.initial.map(compact), final: council.final.map(compact),
  eligibleCount: council.eligibleCount, probability: council.probability,
  chairStatus: council.chair?.status || 'UNAVAILABLE', weights: council.weights }, null, 2));
