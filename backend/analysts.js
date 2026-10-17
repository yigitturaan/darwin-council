import OpenAI from 'openai';
import { config } from './config.js';
import { listRounds, setState } from './store.js';
import { getRoles, getCurrentRoles } from './roles.js';

export { getRoles };

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 40_000, maxRetries: 1 });
}

function modelError(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return `OpenAI authentication/permission error (${status})`;
  if (status === 429) return 'OpenAI rate or credit limit (429)';
  if (Number.isInteger(status) && status >= 400) return `OpenAI request failed (${status})`;
  return error?.name === 'APIConnectionTimeoutError' ? 'OpenAI request timed out' : 'Model output could not be validated';
}

function parseForecast(content, role, metrics) {
  let data;
  try { data = JSON.parse(content); } catch { throw new Error(`${role.id}: model response is not JSON`); }
  if (data.abstain === true) return { analystId: role.id, abstain: true, reason: String(data.reason || 'Kaynak yetersiz').slice(0, 400), claims: [] };
  if (typeof data.probability !== 'number' || data.probability < 0 || data.probability > 1) throw new Error(`${role.id}: invalid probability`);
  if (typeof data.reason !== 'string' || data.reason.trim().length < 10) throw new Error(`${role.id}: missing rationale`);
  if (!Array.isArray(data.claims)) throw new Error(`${role.id}: claims must be an array`);
  const claims = data.claims.slice(0, 5).map((c) => ({ metric: String(c.metric), value: c.value }));
  if (!claims.length) throw new Error(`${role.id}: active forecast requires at least one sourced claim`);
  for (const claim of claims) {
    if (!Number.isFinite(claim.value) || !role.metrics.includes(claim.metric) || metrics[claim.metric] == null) throw new Error(`${role.id}: invalid claim`);
  }
  return { analystId: role.id, abstain: false, probability: data.probability,
    reason: String(data.reason || '').slice(0, 700), claims };
}

export function verifyClaims(forecast, snapshot) {
  const metrics = snapshot.metrics;
  const sourceFor = (metric) => {
    if (['startClose','return5mPct','return15mPct','range15mPct'].includes(metric)) return { source: 'OKX_1M_CANDLE', sourceAt: snapshot.sourceTimes.candleEnd };
    if (['bidDepth','askDepth','depthImbalance','spreadBps'].includes(metric)) return { source: 'OKX_ORDERBOOK', sourceAt: snapshot.sourceTimes.orderbook };
    if (metric === 'btc24hPct') return { source: 'OKX_BTC_TICKER', sourceAt: snapshot.sourceTimes.btc };
    if (metric === 'eth24hPct') return { source: 'OKX_ETH_TICKER', sourceAt: snapshot.sourceTimes.eth };
    if (metric === 'fundingRatePct') return { source: 'OKX_AVAX_SWAP_FUNDING', sourceAt: snapshot.sourceTimes.funding };
    if (metric === 'openInterestUsd') return { source: 'OKX_AVAX_SWAP_OPEN_INTEREST', sourceAt: snapshot.sourceTimes.openInterest };
    return { source: 'OKX_AVAX_TICKER', sourceAt: snapshot.sourceTimes.ticker };
  };
  return { ...forecast, claims: forecast.claims.map((c) => {
    const actual = metrics[c.metric];
    if (!Number.isFinite(actual) || !Number.isFinite(c.value))
      return { ...c, actual: actual ?? null, status: 'UNVERIFIED' };
    const absolute = c.metric === 'fundingRatePct' ? 0.0001 : c.metric.endsWith('Pct') ? 0.02 : c.metric === 'spreadBps' ? 0.1
      : c.metric === 'depthImbalance' ? 0.005 : c.metric.toLowerCase().includes('price') || c.metric === 'startClose' ? 0.001 : 0.000001;
    const tolerance = Math.max(absolute, Math.abs(actual) * 0.005);
    return { ...c, ...sourceFor(c.metric), actual, tolerance,
      status: Math.abs(c.value - actual) <= tolerance ? 'VERIFIED' : 'MISMATCH' };
  }) };
}

async function oneForecast(openai, role, snapshot, phase, peers) {
  const scoped = Object.fromEntries(role.metrics.map((k) => [k, snapshot.metrics[k]]));
  const started = Date.now();
  setState('modelLastAttemptAt', started);
  const response = await openai.chat.completions.create({
    model: config.model, temperature: 0.2, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `Sen Darwin Council'ın ${role.label} analistisin. ${role.instruction} Türkçe, kısa ve sayısal olarak dikkatli yaz. Yalnız verilen veriyi kullan. Soru: başlangıç mum kapanışından 30 dakika sonraki tamamlanmış mum kapanışı daha yüksek mi? Eşitlik hayırdır. Bu bir kesinlik değil olasılık tahminidir. Verilen metriklerden en az biri geçerli ve güncelse olasılık üret; sinyal zayıfsa 0.5 civarında kal. Belirsizlik veya 30 dakikalık ufkun zor olması çekimserlik nedeni değildir. Yalnız gerekli kaynak eksik, geçersiz veya bayatsa ABSTAIN et. JSON nesnesi döndür: {"abstain":false,"probability":0.5,"reason":"...","claims":[{"metric":"verilen_metric_adı","value":sayı}]}. Çekimser kalırsan {"abstain":true,"reason":"...","claims":[]}. Aktif tahminde en az bir, en fazla beş kaynaklı claim kullan. Gerekçede rakam kullanma. Bir metriğin yönü veya düzeyi hakkında konuşuyorsan aynı metriği claims listesine ekle; ekleyemiyorsan gerekçeden çıkar. Geçmiş karşılaştırması verilmeyen tekil açık pozisyon seviyesini yüksek/düşük diye niteleme. Başka veri veya gelecek sonuç uydurma.` },
      { role: 'user', content: JSON.stringify({ phase, instrument: snapshot.instrument, startCandleEnd: snapshot.startCandleEnd,
        startClose: snapshot.startClose, dueCandleEnd: snapshot.dueCandleEnd, sourceTimes: snapshot.sourceTimes,
        metrics: scoped, peerInitialViews: peers || undefined }) },
    ],
  });
  const forecast = verifyClaims(parseForecast(response.choices[0]?.message?.content || '', role, snapshot.metrics), snapshot);
  setState('modelLastVerifiedAt', Date.now());
  return { ...forecast, phase, model: response.model, at: Date.now(), latencyMs: Date.now() - started,
    usage: response.usage ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens } : null };
}

async function safeForecast(openai, role, snapshot, phase, peers) {
  try { return await oneForecast(openai, role, snapshot, phase, peers); }
  catch (error) { setState('modelLastError', { at: Date.now(), message: modelError(error) });
    return { analystId: role.id, abstain: true, phase, at: Date.now(),
    reason: modelError(error), claims: [], status: 'ERROR' }; }
}

function measuredWeights(final) {
  const completed = listRounds(1000).filter((r) => r.resolution && ['RESOLVED','REVEALED'].includes(r.status)).slice(0, 12);
  const activeIds = getCurrentRoles().filter((r) => r.status === 'ACTIVE').map((r) => r.id);
  const scores = Object.fromEntries(final.filter((f) => activeIds.includes(f.analystId)).map((f) => [f.analystId,
    completed.map((r) => r.resolution.analystBrier[f.analystId]).filter((x) => typeof x === 'number')]));
  const ready = completed.length >= 6;
  const raw = Object.fromEntries(final.filter((f) => activeIds.includes(f.analystId)).map((f) => [f.analystId, ready
    && scores[f.analystId].length >= 6
    ? Math.exp(-4 * (scores[f.analystId].reduce((a,b) => a+b, 0) / scores[f.analystId].length)) : 1]));
  return { weights: raw, basis: ready ? 'LIVE_BRIER_WITH_NEUTRAL_UNPROVEN_ROLES' : 'EQUAL_UNTIL_6_LIVE_RESOLUTIONS',
    sampleCount: completed.length,
    roleSampleCounts: Object.fromEntries(Object.entries(scores).map(([id, xs]) => [id, xs.length])) };
}

export async function runCouncil(snapshot) {
  const openai = client();
  const roles = getCurrentRoles();
  const initial = await Promise.all(roles.map((role) => safeForecast(openai, role, snapshot, 'blind_initial', null)));
  if (initial.every((f) => f.status === 'ERROR'))
    return { initial, final: [], eligibleCount: 0, probability: null, chair: null };
  const peers = initial.map((f) => {
    const valid = !f.abstain && f.claims.length > 0 && f.claims.every((c) => c.status === 'VERIFIED');
    return { analystId: f.analystId, abstain: !valid, probability: valid ? f.probability : null,
      reason: valid ? f.reason : 'Initial view excluded: unavailable or unverified claims',
      mismatches: f.claims.filter((c) => c.status !== 'VERIFIED').map((c) => c.metric) };
  });
  const final = await Promise.all(roles.map((role) => safeForecast(openai, role, snapshot, 'after_peer_review', peers.filter((p) => p.analystId !== role.id))));
  const activeIds = roles.filter((r) => r.status === 'ACTIVE').map((r) => r.id);
  const eligible = final.filter((f) => activeIds.includes(f.analystId) && !f.abstain && f.claims.every((c) => c.status === 'VERIFIED'));
  if (!eligible.length) return { initial, final, eligibleCount: 0, probability: null, chair: null };
  const weightState = measuredWeights(final);
  const totalWeight = eligible.reduce((s, f) => s + weightState.weights[f.analystId], 0);
  const probability = eligible.reduce((s, f) => s + f.probability * weightState.weights[f.analystId], 0) / totalWeight;
  const chairStarted = Date.now();
  let chair;
  try {
    const chairResponse = await openai.chat.completions.create({
    model: config.model, temperature: 0.2, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Sen konsey başkanısın. Verilen sayısal konsey olasılığını ASLA değiştirme. Türkçe 1-2 cümlede görüş ayrılığını ve belirsizliği açıkla. Sadece {"explanation":"..."} JSON döndür. Geleceği olmuş gibi anlatma.' },
      { role: 'user', content: JSON.stringify({ probability, final: final.map((f) => ({ analystId: f.analystId, probability: f.probability ?? null, abstain: f.abstain, reason: f.reason })) }) },
    ],
  });
    const parsed = JSON.parse(chairResponse.choices[0]?.message?.content || '{}');
    if (typeof parsed.explanation !== 'string' || parsed.explanation.trim().length < 10) throw new Error('Invalid chair explanation');
    chair = { status: 'LIVE', explanation: String(parsed.explanation || '').slice(0, 700), model: chairResponse.model,
      at: Date.now(), latencyMs: Date.now() - chairStarted, usage: chairResponse.usage };
  } catch (error) { chair = { status: 'UNAVAILABLE', error: modelError(error), at: Date.now() }; }
  return { initial, final, eligibleCount: eligible.length, probability,
    weights: weightState, chair };
}

async function oneTradeOpinion(openai, role, snapshot, amountUsdt, phase, peers) {
  const scoped = Object.fromEntries(role.metrics.map((key) => [key, snapshot.metrics[key]]));
  const started = Date.now();
  setState('modelLastAttemptAt', started);
  const response = await openai.chat.completions.create({
    model: config.model, temperature: 0.2, response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `Sen Darwin Council'ın ${role.label} analistisin. ${role.instruction} Kullanıcı en fazla belirtilen USDT tutarıyla AVAX spot ALMAK istiyor. BUY yalnızca eldeki veriler alımı şimdi yapmak için savunulabilir bir gerekçe sağlıyorsa; WAIT sinyal belirsizse veya daha iyi koşul bekleniyorsa; BLOCK doğrulanmış belirgin bir risk/engel varsa seç. İşlem tutarı tek başına BUY gerekçesi değildir. Kâr, gelecek fiyatı, hesap bakiyesi, ücret veya kullanıcının mevcut AVAX miktarı hakkında veri verilmediyse bildiğini iddia etme. Yalnız kendi verilen metriklerinden söz et; akran görüşlerini yeni piyasa verisi sayma. İlk aşamada diğer analistlerin görüşü yoktur; ikinci aşamada görüşlerini eleştirel değerlendir, çoğunluğa uymak zorunda değilsin. Kısa Türkçe JSON döndür: {"vote":"BUY|WAIT|BLOCK","reason":"...","claims":[{"metric":"metrik_adı","value":sayı}]}. Reason alanında HİÇBİR rakam veya yüzde işareti yazma; tüm sayısal iddialar yalnız claims alanında olmalı. En az bir, en çok dört doğrulanabilir claim kullan. Kaynak yetersizse WAIT seç.` },
      { role: 'user', content: JSON.stringify({ phase, instrument: snapshot.instrument, amountUsdt,
        observedAt: snapshot.observedAt, sourceTimes: snapshot.sourceTimes, metrics: scoped,
        peerInitialViews: peers || undefined }) },
    ],
  });
  const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
  if (!['BUY','WAIT','BLOCK'].includes(parsed.vote) || typeof parsed.reason !== 'string'
    || parsed.reason.trim().length < 10 || /[0-9%]/.test(parsed.reason)
    || !Array.isArray(parsed.claims) || parsed.claims.length < 1)
    throw new Error('Invalid trade opinion');
  const claims = parsed.claims.slice(0, 4).map((c) => ({ metric: String(c.metric), value: c.value }));
  if (claims.some((c) => !role.metrics.includes(c.metric) || !Number.isFinite(c.value)
    || !Number.isFinite(snapshot.metrics[c.metric]))) throw new Error('Invalid trade claim');
  const checked = verifyClaims({ analystId: role.id, vote: parsed.vote,
    reason: parsed.reason.slice(0, 700), claims }, snapshot);
  setState('modelLastVerifiedAt', Date.now());
  return { ...checked, phase, at: Date.now(), model: response.model,
    latencyMs: Date.now() - started,
    usage: response.usage ? { inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens } : null };
}

async function safeTradeOpinion(openai, role, snapshot, amountUsdt, phase, peers) {
  try { return await oneTradeOpinion(openai, role, snapshot, amountUsdt, phase, peers); }
  catch (error) {
    setState('modelLastError', { at: Date.now(), message: modelError(error) });
    return { analystId: role.id, vote: 'WAIT', phase, at: Date.now(),
      reason: modelError(error), claims: [], status: 'ERROR' };
  }
}

export async function runTradeCouncil(snapshot, amountUsdt) {
  const openai = client();
  const roles = getCurrentRoles();
  const initial = await Promise.all(roles.map((role) => safeTradeOpinion(openai, role,
    snapshot, amountUsdt, 'blind_initial', null)));
  const peers = initial.map((view) => {
    const valid = view.claims.length && view.claims.every((claim) => claim.status === 'VERIFIED');
    return { analystId: view.analystId, vote: valid ? view.vote : 'WAIT',
      reason: valid ? view.reason : 'Görüş doğrulanamadı' };
  });
  const final = await Promise.all(roles.map((role) => safeTradeOpinion(openai, role,
    snapshot, amountUsdt, 'after_peer_review', peers.filter((peer) => peer.analystId !== role.id))));
  const active = new Set(roles.filter((role) => role.status === 'ACTIVE').map((role) => role.id));
  const eligible = final.filter((view) => active.has(view.analystId)
    && view.claims.length && view.claims.every((claim) => claim.status === 'VERIFIED'));
  return { initial, final, eligibleCount: eligible.length,
    votes: Object.fromEntries(['BUY','WAIT','BLOCK'].map((vote) =>
      [vote, eligible.filter((view) => view.vote === vote).length])) };
}
