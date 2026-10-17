import { roundsWithStatus } from './store.js';

export function actualPerformance() {
  const rounds = roundsWithStatus('RESOLVED','REVEALED').filter((r) => r.resolution && Number.isFinite(r.council?.probability));
  const observations = rounds.map((r) => ({ roundId: r.id, startCandleEnd: r.startCandleEnd,
    dueCandleEnd: r.dueCandleEnd, probability: r.council.probability,
    outcome: r.resolution.outcome, brier: r.resolution.councilBrier }));
  const count = observations.length;
  const meanBrier = count ? observations.reduce((sum, r) => sum + r.brier, 0) / count : null;
  const baselineBrier = 0.25;
  const overlapping = observations.some((r, i) => i > 0 && r.startCandleEnd < observations[i-1].dueCandleEnd);
  return { source: 'RESOLVED_LIVE_ROUNDS', count, meanBrier,
    reference: { description: 'Always predict 50%', probability: 0.5,
      meanBrier: count ? baselineBrier : null },
    skillVsReference: count ? 1 - meanBrier / baselineBrier : null,
    overlappingWindows: overlapping,
    inference: 'DESCRIPTIVE_ONLY',
    note: 'Overlapping 30-minute outcomes are correlated. The score does not prove predictive skill or statistical significance.',
    observations };
}
