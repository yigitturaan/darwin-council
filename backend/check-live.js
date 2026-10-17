import 'dotenv/config';
import { config } from './config.js';

const base = `http://127.0.0.1:${config.port}`;
async function read(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.mode !== 'live') throw new Error(`${path}: mode is not live`);
  return body;
}

const market = await read('/api/live-market');
const [health, rounds, analysts, events, assessment, usage, evolution, performance, lineage] = await Promise.all([
  read('/health'), read('/api/rounds'), read('/api/analysts'),
  read('/api/events'), read('/api/assessment'), read('/api/usage'), read('/api/evolution'),
  read('/api/performance'), read('/api/lineage'),
]);
const latest = rounds.rounds.find((r) => ['COMMITTED','DUE','RESOLUTION_PENDING','RESOLVED','REVEALED'].includes(r.status));
const detail = latest ? await read(`/api/rounds/${latest.id}`) : null;
const checks = {
  marketFresh: market.status === 'LIVE' && Date.now() - market.data.observedAt < 180_000,
  backendReady: health.status === 'READY',
  fujiDeployed: health.fuji?.contractStatus === 'DEPLOYED',
  schedulerEnabled: health.scheduler?.enabled === true && health.scheduler.nextScheduledAt > Date.now()
    && health.scheduler.intervalMinutes === (evolution.lastDecisionCount ? config.steadyRoundMinutes : config.fastRoundMinutes)
    && health.scheduler.forecastHorizonMinutes === 30,
  committedRound: Boolean(latest?.commitTx?.hash && ['COMMITTED','DUE','RESOLUTION_PENDING','RESOLVED','REVEALED'].includes(latest.status)),
  detailAvailable: Boolean(detail?.round?.council?.final?.length && detail.round.sourceHash),
  analystsAvailable: Array.isArray(analysts.analysts) && analysts.analysts.length >= 4,
  eventsAvailable: Array.isArray(events.events) && events.events.length > 0,
  assessmentMatches: assessment.roundId === latest?.id,
  recordedUsage: usage.openai?.calls > 0 && usage.openai.estimatedUsd !== null,
  eventCursor: events.nextCursor === (events.events.at(-1)?.seq ?? 0)
    && events.events.every((e,i) => i === 0 || e.seq > events.events[i-1].seq),
  evolutionHonest: evolution.minimumLiveResults === 6 &&
    (evolution.resolvedRounds >= 6 || evolution.status === 'COLLECTING_LIVE_RESULTS'),
  correctChain: health.fuji?.chainId === 43113,
  workerRunning: health.worker?.lastCompletedAt > Date.now() - 120_000 && !health.worker?.lastError,
  realPerformance: performance.source === 'RESOLVED_LIVE_ROUNDS'
    && performance.count === evolution.resolvedRounds && performance.reference.meanBrier === 0.25
    && performance.inference === 'DESCRIPTIVE_ONLY',
  lineageAnchored: lineage.status === 'VERIFIED' && lineage.analysts.length >= 4
    && lineage.analysts.every((a) => a.proofStatus === 'VERIFIED'),
};
const result = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';
console.log(JSON.stringify({ result, checks, latestRoundId: latest?.id || null,
  latestStatus: latest?.status || null, nextScheduledAt: health.scheduler?.nextScheduledAt || null,
  note: 'Checks only current live backend responses; final 30-minute result still needs its own audit.' }, null, 2));
if (result === 'FAIL') process.exitCode = 1;
