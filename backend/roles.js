import { event, getState, roundsWithStatus, setState, transaction } from './store.js';

const baseRoles = [
  { id: 'momentum', label: 'Fiyat ve Momentum', metrics: ['startClose','lastPrice','return5mPct','return15mPct','avax24hPct'], instruction: 'Kısa vadeli fiyat hareketi ve momentum sinyallerine odaklan.' },
  { id: 'liquidity', label: 'Likidite', metrics: ['bidDepth','askDepth','depthImbalance','spreadBps'], instruction: 'Emir defteri derinliği, denge ve spread riskine odaklan.' },
  { id: 'relative', label: 'Türev ve Göreli Piyasa', metrics: ['btc24hPct','eth24hPct','avax24hPct','fundingRatePct','openInterestUsd'], instruction: 'AVAX hareketini BTC ve ETH ile karşılaştır. Gerçek fonlama oranı ve açık pozisyon verisi varsa türev bağlamı olarak kullan; eksikse bu kaynaklar hakkında iddia etme. Açık pozisyonun yalnız anlık seviyesi var, geçmiş karşılaştırması yok; bunu yüksek veya düşük diye yorumlama.' },
  { id: 'volatility', label: 'Volatilite ve Veri Kalitesi', metrics: ['range15mPct','return5mPct','spreadBps'], instruction: 'Yakın volatiliteyi, zaman ufkunu ve sinyal belirsizliğini değerlendir. Haber veya smart money verisi verilmedi; bunları bildiğini iddia etme.' },
].map((r) => ({ ...r, status: 'ACTIVE', bornAt: null, parentId: null }));

export function getRoles() { return getState('roles') || baseRoles; }
export function getCurrentRoles() { return getRoles().filter((r) => ['ACTIVE','TRIAL'].includes(r.status)); }

function resolvedRounds() {
  return roundsWithStatus('RESOLVED','REVEALED').filter((r) => r.resolution).reverse();
}
function scoreFor(rounds, id) {
  const xs = rounds.map((r) => r.resolution.analystBrier[id]).filter((x) => typeof x === 'number');
  const effective = rounds.map((r) => r.resolution.analystEffectiveScore?.[id]).filter((x) => typeof x === 'number');
  return { samples: xs.length, meanBrier: xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : null,
    meanEffective: effective.length ? effective.reduce((a,b) => a+b, 0) / effective.length : null };
}

function candidateFromHistory(role, recent) {
  const sample = recent.filter((r) => Number.isFinite(r.resolution.analystBrier[role.id])
    && Number.isFinite(r.council.final.find((f) => f.analystId === role.id)?.probability));
  const average = (values) => values.reduce((a,b) => a+b, 0) / values.length;
  const meanProbability = average(sample.map((r) => r.council.final.find((f) => f.analystId === role.id).probability));
  const realizedUpRate = average(sample.map((r) => r.resolution.outcome));
  const calibrationGap = meanProbability - realizedUpRate;
  const correction = calibrationGap > 0.05
    ? 'Gerçek sonuçlarda yukarı yön olasılığını fazla verdi; aynı yön sinyallerinde daha temkinli ol ve karşı kanıt ara.'
    : calibrationGap < -0.05
      ? 'Gerçek sonuçlarda yukarı yön olasılığını düşük verdi; güçlü yukarı sinyallerini gereğinden fazla bastırma.'
      : 'Gerçek sonuçlarla ortalama olasılığı yakındı; kısa ufukta sinyal çatışmasını ve belirsizliği daha dikkatli tart.';
  return { instruction: `Mevcut ${role.label} analistine karşı bağımsız alternatif görüş üret. ${correction} Her yeni turda yalnız verilen canlı metrikleri kullan; geçmiş sonuçlar yalnız bu yaklaşımın nedenini belirledi.`,
    evidence: { source: 'PRIOR_RESOLVED_LIVE_ROUNDS', sampleCount: sample.length,
      meanProbability, realizedUpRate, calibrationGap,
      trainingRoundIds: sample.map((r) => r.id) } };
}

export function advanceEvolution() {
  return transaction(evaluateEvolution);
}

function evaluateEvolution() {
  const rounds = resolvedRounds();
  if (rounds.length < 6) return { status: 'COLLECTING_LIVE_RESULTS', resolvedRounds: rounds.length };
  const roles = getRoles();
  const trial = roles.find((r) => r.status === 'TRIAL');
  if (trial) {
    const paired = rounds.filter((r) => typeof r.resolution.analystBrier[trial.id] === 'number'
      && typeof r.resolution.analystBrier[trial.parentId] === 'number').slice(0, 6);
    if (paired.length < 6) return { status: 'TRIAL', trialId: trial.id, resolvedSamples: paired.length };
    const candidateScore = scoreFor(paired, trial.id);
    const incumbentScore = scoreFor(paired, trial.parentId);
    const promoted = candidateScore.meanEffective + 0.02 < incumbentScore.meanEffective;
    trial.status = promoted ? 'ACTIVE' : 'REJECTED';
    trial.decisionAt = Date.now();
    trial.liveTrialScore = candidateScore;
    if (promoted) {
      const incumbent = roles.find((r) => r.id === trial.parentId);
      incumbent.status = 'RETIRED';
      incumbent.retiredAt = Date.now();
    }
    setState('roles', roles);
    setState('evolutionLastDecisionCount', rounds.length);
    event(promoted ? 'ANALYST_PROMOTED' : 'ANALYST_REJECTED', null,
      { trialId: trial.id, parentId: trial.parentId, candidateScore, incumbentScore, liveSamples: paired.length });
    return { status: promoted ? 'PROMOTED' : 'REJECTED', trialId: trial.id };
  }
  const lastDecisionCount = getState('evolutionLastDecisionCount') || 0;
  if (lastDecisionCount && rounds.length - lastDecisionCount < 6) return { status: 'COOLDOWN', resolvedRounds: rounds.length };
  const active = roles.filter((r) => r.status === 'ACTIVE');
  const recent = rounds.slice(0, 12);
  const ranked = active.map((r) => ({ role: r, score: scoreFor(recent, r.id) }))
    .filter((x) => x.score.samples >= 6).sort((a,b) => b.score.meanEffective - a.score.meanEffective);
  if (ranked.length < 2) return { status: 'INSUFFICIENT_ROLE_SAMPLES', resolvedRounds: rounds.length,
    qualifiedAnalysts: ranked.length };
  const worst = ranked[0].role;
  const learned = candidateFromHistory(worst, recent);
  const candidate = {
    id: `trial-${rounds.length}-${worst.id}`, label: `${worst.label} · Karşı Görüş`,
    status: 'TRIAL', parentId: worst.id, bornAt: Date.now(),
    metrics: [...new Set([...worst.metrics, 'range15mPct', 'spreadBps'])],
    instruction: learned.instruction, evidence: learned.evidence,
  };
  roles.push(candidate);
  setState('roles', roles);
  event('ANALYST_TRIAL_STARTED', null, { trialId: candidate.id, parentId: worst.id,
    parentMeanBrier: ranked[0].score.meanBrier, parentMeanEffective: ranked[0].score.meanEffective,
    sampleCount: ranked[0].score.samples, lookbackRounds: recent.length,
    qualifiedAnalysts: ranked.length, activeAnalysts: active.length,
    calibrationGap: learned.evidence.calibrationGap });
  return { status: 'TRIAL_STARTED', trialId: candidate.id, parentId: worst.id };
}

export function evolutionState() {
  const rounds = resolvedRounds();
  const roles = getRoles();
  const trial = roles.find((r) => r.status === 'TRIAL');
  const lastDecisionCount = getState('evolutionLastDecisionCount') || 0;
  const lastDecisionRole = roles.filter((r) => r.parentId && r.decisionAt)
    .sort((a,b) => b.decisionAt - a.decisionAt)[0];
  const qualifiedAnalysts = roles.filter((r) => r.status === 'ACTIVE'
    && scoreFor(rounds.slice(0, 12), r.id).samples >= 6).length;
  const paired = trial ? rounds.filter((r) => Number.isFinite(r.resolution.analystBrier[trial.id])
    && Number.isFinite(r.resolution.analystBrier[trial.parentId])).length : 0;
  const status = trial ? 'TRIAL' : rounds.length < 6 ? 'COLLECTING_LIVE_RESULTS'
    : lastDecisionCount && rounds.length - lastDecisionCount < 6 ? 'COOLDOWN'
      : qualifiedAnalysts < 2 ? 'INSUFFICIENT_ROLE_SAMPLES' : 'READY_TO_EVALUATE';
  return { status, resolvedRounds: rounds.length, minimumLiveResults: 6,
    qualifiedAnalysts, trialId: trial?.id || null, trialParentId: trial?.parentId || null,
    pairedTrialResults: paired, requiredPairedResults: 6,
    lastDecisionCount,
    lastDecision: lastDecisionRole ? { analystId: lastDecisionRole.id,
      parentId: lastDecisionRole.parentId, status: lastDecisionRole.status,
      at: lastDecisionRole.decisionAt } : null };
}
