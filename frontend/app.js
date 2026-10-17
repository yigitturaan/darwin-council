const state = { market: null, health: null, account: null, lineage: null,
  intents: [], rounds: [], roundDetail: null, feedMode: null, evolution: null,
  performance: null, events: [], eventCursor: 0, connection: 'CONNECTING' };
const $ = (id) => document.getElementById(id);
const voteLabel = { BUY: 'AL', WAIT: 'BEKLE', BLOCK: 'ENGELLE' };
const stageLabel = {
  CREATING: 'Canlı veri alınıyor', ANALYZING: 'Analistler tartışıyor',
  DECIDED: 'Karar zincire hazırlanıyor', COMMITTING: 'Avalanche’a gönderiliyor',
  CHAIN_PENDING: 'Avalanche teyidi bekleniyor', COMMITTED: 'Mühürlendi',
  REVEAL_PENDING: 'Karar açılıyor', REVEALED: 'Karar açıklandı',
  FAILED: 'Değerlendirme başarısız', INTERRUPTED: 'Değerlendirme kesildi',
};
const checkLabel = {
  FRESH_DATA: 'Veri güncel', SPREAD: 'Alış satış farkı uygun',
  RECENT_RANGE: 'Yakın oynaklık sınırda', ASK_DEPTH: 'Emir defteri yeterli',
  PRICE_DRIFT_DURING_REVIEW: 'Tartışırken fiyat sıçramadı',
  VERIFIED_ANALYSTS: 'Yeterli doğrulanmış analist', BUY_CONSENSUS: 'Güçlü AL çoğunluğu',
};
const failedReason = {
  FRESH_DATA: 'Piyasa verisi yeterince güncel değil.',
  SPREAD: 'Alış satış fiyatları arasındaki fark yüksek.',
  RECENT_RANGE: 'Piyasa kısa sürede fazla hareket etti.',
  ASK_DEPTH: 'Emir defterinde bu alım için yeterli satıcı yok.',
  PRICE_DRIFT_DURING_REVIEW: 'Konsey tartışırken fiyat fazla değişti.',
  VERIFIED_ANALYSTS: 'Yeterli sayıda analistin verisi doğrulanmadı.',
};
const analystName = { momentum: 'Momentum', liquidity: 'Likidite',
  relative: 'Türev', volatility: 'Volatilite' };
const eventLabel = {
  TRADE_CREATING: 'Yeni alım isteği alındı.',
  TRADE_ANALYZING: 'Analistler canlı OKX TR verilerini değerlendiriyor.',
  TRADE_DECIDED: 'Konsey kararını verdi; Fuji kaydı hazırlanıyor.',
  TRADE_COMMITTING: 'Karar Avalanche Fuji’ye gönderiliyor.',
  TRADE_CHAIN_PENDING: 'Avalanche Fuji teyidi bekleniyor.',
  TRADE_COMMITTED: 'Karar Avalanche Fuji’ye mühürlendi.',
  TRADE_REVEAL_PENDING: 'Kararın içeriği zincirde açılıyor.',
  TRADE_REVEALED: 'Konseyin kararı Fuji’de açıldı.',
  TRADE_ORDER_SUBMITTING: 'Konsey AL dedi; OKX TR spot emri gönderiliyor.',
  TRADE_ORDER_ACCEPTED: 'OKX TR canlı emri kabul etti.',
  TRADE_ORDER_FILLED: 'OKX TR canlı alımı tamamlandı.',
  TRADE_FAILED: 'İşlem değerlendirmesi tamamlanamadı.',
  TRADE_INTERRUPTED: 'Değerlendirme kesildi; zincir kaydı incelenmeli.',
  ANALYST_TRIAL_STARTED: 'Yeni çırak sınava başladı.',
  ANALYST_PROMOTED: 'Çırak konseye katıldı.',
  ANALYST_REJECTED: 'Çırak sınavı geçemedi.',
  COMMITTED: 'Yön tahmini Avalanche Fuji’ye mühürlendi.',
  REVEALED: 'Yön tahmini Fuji’de açıldı.',
};
function put(id, value) { $(id).textContent = value == null ? '—' : String(value); }
function n(value, digits = 2) {
  return Number.isFinite(value) ? new Intl.NumberFormat('tr-TR',
    { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : '—';
}
function clock(at) { return Number.isFinite(at) ? new Date(at).toLocaleTimeString('tr-TR',
  { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'; }
async function api(path, options) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.reason || body.error || `HTTP ${response.status}`);
  return body;
}
function safeExplorer(value) {
  return typeof value === 'string' && /^https:\/\/testnet\.snowtrace\.io\/tx\/0x[a-fA-F0-9]{64}$/.test(value)
    ? value : null;
}
function setLink(id, href, label) {
  const node = $(id);
  const safe = safeExplorer(href);
  node.hidden = !safe;
  if (safe) { node.href = safe; node.textContent = label; }
  else node.removeAttribute('href');
}
function renderMarket() {
  const live = state.market?.status === 'LIVE' && state.market.data;
  put('market-chip', live ? `■ OKX TR canlı · AVAX ${n(live.metrics.lastPrice, 3)}` : '■ OKX TR · veri yok');
  const atDecision = state.intents[0]?.decision && state.intents[0]?.market?.latest;
  const shown = atDecision || live;
  put('metric-price', shown ? `${n(shown.metrics.lastPrice, 3)} USDT` : null);
  put('metric-spread', shown ? `${n(shown.metrics.spreadBps, 2)} baz puan` : null);
  put('metric-range', shown ? `${n(shown.metrics.range15mPct, 2)}%` : null);
  put('metric-time', shown ? clock(shown.observedAt) : null);
  put('metric-source-note', atDecision
    ? 'Bunlar karar anında yeniden alınan OKX TR verileridir; üstteki fiyat şu anki piyasadır.'
    : 'Bunlar güncel OKX TR ATK piyasa verileridir.');
  put('system-okx', live ? '■ canlı' : '■ veri yok');
  $('system-okx').className = live ? 'ok' : 'no';
  const account = state.account?.status === 'LIVE' ? state.account : null;
  put('system-balance', account ? `${n(account.availableUsdt, 2)} USDT · canlı` : 'bağlantı yok');
  $('system-balance').className = account ? 'ok' : 'no';
  const fuji = state.health?.fuji;
  const chainLive = fuji?.status === 'LIVE' && fuji.contractStatus === 'DEPLOYED';
  put('fuji-chip', chainLive ? '■ Avalanche Fuji · bağlı' : '■ Avalanche Fuji · bağlantı yok');
  put('system-fuji', chainLive ? `■ blok ${fuji.blockNumber}` : '■ bağlantı yok');
  $('system-fuji').className = chainLive ? 'ok' : 'no';
  put('system-title', state.connection === 'LIVE' && live && chainLive ? 'Sistem canlı' : 'Bağlantıyı kontrol et');
  $('feed-dot').style.background = state.connection === 'LIVE' ? 'var(--ok)' : 'var(--red)';
}
function renderIntent() {
  const intent = state.intents[0];
  if (!intent) {
    put('intent-kicker', 'CANLI PİYASA · AVAX/USDT');
    put('intent-question', 'AVAX alımını şimdi yapmak uygun mu? Bir tutar girip konseye sor.');
    put('verdict', '—'); put('verdict-label', 'henüz karar yok');
    put('board-decision-title', 'Henüz istek yok');
    put('board-decision', '—');
    put('board-decision-detail', 'Canlı bir istek oluşturulduğunda oylar burada görünecek.');
    put('checks-list', 'Önce canlı bir değerlendirme başlat.');
  } else {
    put('intent-kicker', `${intent.status === 'REVEALED' ? 'SON ALIM DEĞERLENDİRMESİ' : 'CANLI İSTEK'} · ${clock(intent.createdAt)}`);
    put('intent-question', `En fazla ${n(intent.amountUsdt, 2)} USDT’lik AVAX şimdi alınsın mı?`);
    const verdict = intent.decision?.verdict;
    const shown = verdict ? voteLabel[verdict] : intent.status === 'FAILED' || intent.status === 'INTERRUPTED' ? 'HATA' : '…';
    put('verdict', shown);
    put('verdict-label', verdict ? 'konseyin kararı' : stageLabel[intent.status] || 'değerlendiriliyor');
    put('board-decision-title', `${n(intent.amountUsdt, 2)} USDT’lik AVAX alımı`);
    put('board-decision', shown);
    const votes = intent.decision?.votes;
    put('board-decision-detail', votes
      ? `${votes.BUY} AL · ${votes.WAIT} BEKLE · ${votes.BLOCK} ENGELLE · ${intent.council.eligibleCount} doğrulanmış analist`
      : stageLabel[intent.status] || 'Karar bekleniyor');
    put('checks-list', intent.decision ? '' : 'Karar henüz doğrulanıp açıklanmadı.');
    if (intent.decision) {
      const list = $('checks-list');
      for (const check of intent.decision.checks) {
        const row = document.createElement('div'); row.className = 'mini-row';
        const name = document.createElement('span'); name.className = 'nm';
        name.textContent = checkLabel[check.name] || check.name;
        const result = document.createElement('span'); result.className = check.passed ? 'ok' : 'no';
        result.textContent = check.passed ? '✓' : '✕';
        row.append(name, result); list.append(row);
      }
    }
    const views = intent.council?.final || [];
    for (const id of ['momentum','liquidity','relative','volatility']) {
      const view = views.find((entry) => entry.analystId === id);
      const label = view ? view.status === 'ERROR' ? 'yanıt hatası'
        : view.claims.length && view.claims.every((c) => c.status === 'VERIFIED')
          ? voteLabel[view.vote] : 'sayı tutmadı' : stageLabel[intent.status] || 'bekliyor…';
      put(`vote-${id}`, label);
      $(`vote-${id}`).className = `say ${view && ['sayı tutmadı', 'yanıt hatası'].includes(label) ? 'bad' : !view ? 'think' : ''}`;
    }
    const trial = views.find((entry) => entry.analystId.startsWith('trial-'));
    $('trial-agent').classList.toggle('hidden', !trial);
    if (trial) put('vote-trial', `${voteLabel[trial.vote]} · deneme`);
    put('chair-say', votes ? `${votes.BUY} AL · ${votes.WAIT} BEKLE · ${votes.BLOCK} ENGELLE` : 'oyları topluyorum');
    const commitUrl = intent.commitTx?.blockNumber && safeExplorer(intent.commitTx?.explorerUrl);
    setLink('seal', commitUrl, 'Avalanche’da mühürlü ↗');
    $('seal-pending').hidden = Boolean(commitUrl);
    if (!commitUrl) put('seal-pending', stageLabel[intent.status] || 'Zincir teyidi yok');
    const chain = $('board-chain'); chain.replaceChildren();
    if (commitUrl) {
      const a = document.createElement('a'); a.href = commitUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'link'; a.textContent = 'Fuji mühürünü gör ↗'; chain.append(a);
    }
    const revealUrl = safeExplorer(intent.revealTx?.explorerUrl);
    if (revealUrl && intent.revealTx?.blockNumber) {
      const a = document.createElement('a'); a.href = revealUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'link'; a.textContent = ' · Kararın açılışını gör ↗'; chain.append(a);
    }
  }
  const execution = intent?.execution;
  const executionText = {
    ACCOUNT_NOT_CONNECTED: 'Önceki değerlendirme · gerçek emir gönderilmedi',
    NOT_REQUESTED: 'Yalnız değerlendirme istendi · emir gönderilmedi',
    AWAITING_DECISION: 'Konsey ve Fuji kaydı bekleniyor · AL çıkarsa gerçek emir',
    SKIPPED_BY_COUNCIL: `Konsey ${voteLabel[execution?.reason] || 'AL demedi'} · emir yok`,
    BLOCKED_PREFLIGHT: `Son güvenlik kontrolü emri durdurdu: ${execution?.reason || 'bilinmiyor'}`,
    SUBMITTING: 'Gerçek OKX TR spot emri gönderiliyor…',
    ACCEPTED: `OKX TR emri kabul etti · #${execution?.orderId || '—'}`,
    FILLED: `Gerçek AVAX alımı tamamlandı · #${execution?.orderId || '—'}`,
    UNKNOWN: 'Emir sonucu belirsiz · OKX emir geçmişini kontrol et, tekrar başlatma',
    ABORTED_NO_ORDER: 'Değerlendirme tamamlanamadı · emir gönderilmedi',
    INTERRUPTED_NO_ORDER: 'Süreç kesildi · emir gönderilmedi',
  };
  const ready = state.health?.trading?.liveOrdersEnabled && state.health?.trading?.credentialsPresent
    && state.account?.status === 'LIVE';
  $('execute').disabled = !ready;
  put('execution-message', execution ? executionText[execution.status] || execution.status
    : ready ? 'OKX gerçek alım hazır · kutuyu seçersen yalnız AL kararında emir açılır'
      : 'Gerçek alım bağlantısı henüz etkin değil · değerlendirme çalışır');
  put('board-execution', execution?.status === 'FILLED' ? 'GERÇEK ALIM TAMAMLANDI'
    : execution?.status === 'ACCEPTED' ? 'OKX EMRİ KABUL ETTİ'
      : execution?.status === 'SUBMITTING' ? 'OKX EMRİ GÖNDERİLİYOR'
        : 'EMİR YOK');
}
function renderRounds() {
  const list = $('round-history'); list.replaceChildren();
  if (!state.rounds.length) { const li = document.createElement('li'); li.textContent = 'Henüz tur yok'; list.append(li); }
  for (const [index, round] of state.rounds.slice(0, 5).entries()) {
    const li = document.createElement('li');
    const a = document.createElement('span'); a.textContent = `#${state.rounds.length - index} · ${clock(round.createdAt)}`;
    const b = document.createElement('span'); b.textContent = Number.isFinite(round.probability)
      ? `%${n(round.probability * 100, 0)}` : '—';
    const c = document.createElement('span'); c.textContent = round.outcome == null ? '⏳' : round.outcome ? '↑' : '↓';
    li.append(a, b, c); list.append(li);
  }
  const evolution = state.evolution;
  const lastDecision = evolution?.lastDecision;
  const settled = Boolean(lastDecision && evolution?.status !== 'TRIAL');
  put('evolution-title', settled ? lastDecision.status === 'PROMOTED' ? 'Çırak terfi etti' : 'Çırak elendi'
    : evolution?.status === 'TRIAL' ? 'Çırak sınavda'
    : evolution?.status === 'COLLECTING_LIVE_RESULTS' ? 'Sonuç toplanıyor'
      : evolution?.status === 'COOLDOWN' ? 'Yeni tur bekleniyor'
        : evolution ? 'Konsey gelişiyor' : 'Durum yükleniyor');
  const roleName = { momentum: 'Momentum', liquidity: 'Likidite', relative: 'Türev', volatility: 'Volatilite' };
  const parent = settled ? roleName[lastDecision.parentId] || lastDecision.parentId : 'Analist';
  const nextTrialResults = evolution?.status === 'COOLDOWN'
    ? Math.max(0, 6 - (evolution.resolvedRounds - evolution.lastDecisionCount)) : null;
  put('evolution-detail', settled
    ? `${parent} rolünden doğan çırak 6 gerçek turda sınandı. ${lastDecision.status === 'PROMOTED'
      ? 'Başarılı oldu ve koltuğu aldı.' : 'Yeterince iyi olamadı; mevcut analist kaldı.'}${nextTrialResults
      ? ` Yeni çırak için ${nextTrialResults} gerçek sonuç daha bekleniyor.` : ''}`
    : evolution ? evolution.status === 'TRIAL'
    ? `${evolution.pairedTrialResults}/${evolution.requiredPairedResults} gerçek eşleşmiş sonuç.`
    : `${evolution.resolvedRounds} gerçek tur çözüldü.` : 'Canlı sonuçlar bekleniyor.');
  const sprite = $('evolution-parent');
  const shape = { momentum: 'momentum', liquidity: 'likidite', relative: 'turev', volatility: 'vol' }
    [settled ? lastDecision.parentId : evolution?.trialParentId] || 'vol';
  if (sprite.dataset.c !== shape) { sprite.dataset.c = shape; window.drawDarwinSprite?.(sprite); }
  const dots = $('evolution-dots'); dots.replaceChildren();
  if (evolution) for (let i = 0; i < evolution.requiredPairedResults; i++) {
    const dot = document.createElement('i');
    dot.className = settled ? lastDecision.status === 'REJECTED' ? 'rejected' : 'on'
      : i < evolution.pairedTrialResults ? 'on' : '';
    dots.append(dot);
  }
  const proof = $('evolution-proof'); proof.replaceChildren();
  const candidate = state.lineage?.analysts?.find((entry) => entry.id === lastDecision?.analystId);
  const proofUrl = safeExplorer(candidate?.decisionTx?.explorerUrl);
  if (settled && proofUrl && candidate.proofStatus === 'VERIFIED') {
    const link = document.createElement('a'); link.href = proofUrl; link.target = '_blank';
    link.rel = 'noopener noreferrer'; link.className = 'link';
    link.textContent = 'Fuji’deki gerçek Darwin kararını gör ↗'; proof.append(link);
  }
  put('system-rounds', state.performance?.count ?? null);
  put('system-brier', Number.isFinite(state.performance?.meanBrier) ? n(state.performance.meanBrier, 3) : null);
}
function renderEvents() {
  const list = $('feed-list'); list.replaceChildren();
  const selected = state.events.filter((event) => eventLabel[event.type]).slice(-5).reverse();
  put('feed-event-count', selected.length ? `· ${selected.length} kayıt` : '');
  if (!selected.length) { const li = document.createElement('li'); li.textContent = 'Canlı olay bekleniyor…'; list.append(li); }
  for (const entry of selected) {
    const li = document.createElement('li');
    li.textContent = `${clock(entry.at)} · ${eventLabel[entry.type]}`;
    if (/COMMITTED|REVEAL/.test(entry.type)) li.className = 'chain';
    if (/FAILED|INTERRUPTED/.test(entry.type)) li.className = 'bad';
    list.append(li);
  }
}
function renderFeedTabs() {
  const mode = state.feedMode || 'auto';
  for (const value of ['trade','auto']) {
    const button = $(`feed-tab-${value}`);
    const active = mode === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    $(`feed-${value}`).hidden = !active;
  }
}
function renderAutoCouncil() {
  const box = $('feed-auto-content'); box.replaceChildren();
  const nextAt = state.health?.scheduler?.nextScheduledAt;
  const cadence = state.health?.scheduler?.intervalMinutes;
  const latestAuto = state.rounds.find((round) => round.trigger === 'scheduled');
  const round = state.roundDetail;
  const summary = document.createElement('div'); summary.className = 'summary';
  const title = document.createElement('strong'); title.textContent = 'Konsey kendi kendine çalışıyor';
  const desc = document.createElement('p');
  desc.textContent = `Canlı verilerle ${cadence || 30} dakikada bir görüşüyor. Sıradaki tur: ${clock(nextAt)}.`;
  const guard = document.createElement('small');
  guard.textContent = 'Bu turlar AVAX yön tahminini sınar; gerçek emir açmaz.';
  summary.append(title, desc, guard); box.append(summary);
  if (latestAuto && !['COMMITTED','DUE','RESOLUTION_PENDING','RESOLVED','REVEALED'].includes(latestAuto.status)) {
    const progress = document.createElement('div'); progress.className = 'summary';
    progress.textContent = `Yeni tur ${clock(latestAuto.createdAt)}’de başladı; analistler görüşüyor veya Fuji teyidi bekleniyor.`;
    box.append(progress);
  }
  if (!round?.council?.final?.length) {
    const waiting = document.createElement('div');
    waiting.textContent = 'İlk mühürlü otonom turun görüşleri bekleniyor.';
    box.append(waiting); return;
  }
  const result = document.createElement('div'); result.className = 'summary';
  const resultTitle = document.createElement('strong');
  resultTitle.textContent = `Son tur · ${clock(round.createdAt)}`;
  const probability = document.createElement('span');
  probability.textContent = Number.isFinite(round.council.probability)
    ? `AVAX’ın 30 dakika sonra daha yüksek olma tahmini: %${n(round.council.probability * 100, 0)}`
    : 'Bu turda doğrulanmış ortak tahmin oluşmadı.';
  result.append(resultTitle, probability);
  if (round.council.chair?.explanation) {
    const chair = document.createElement('p');
    chair.textContent = `Başkan: ${round.council.chair.explanation}`;
    result.append(chair);
  }
  box.append(result);
  for (const view of round.council.final) {
    const valid = !view.abstain && view.claims?.length > 0
      && view.claims.every((claim) => claim.status === 'VERIFIED');
    const card = document.createElement('article'); card.className = 'opinion';
    const heading = document.createElement('div'); heading.className = 'who';
    const who = document.createElement('span');
    who.textContent = view.analystId.startsWith('trial-') ? 'Çırak · deneme'
      : analystName[view.analystId] || view.analystId;
    const vote = document.createElement('span'); vote.className = 'vote';
    vote.textContent = valid ? `%${n(view.probability * 100, 0)}` : view.abstain ? 'ÇEKİMSER' : 'SAYILMADI';
    heading.append(who, vote);
    const reason = document.createElement('p');
    reason.textContent = valid ? view.reason : view.abstain
      ? 'Bu turda yeterli kaynak olmadığını bildirip tahmin üretmedi.'
      : 'Görüşü doğrulama kurallarını geçemedi; konsey hesabına katılmadı.';
    card.append(heading, reason);
    const initial = round.council.initial?.find((entry) => entry.analystId === view.analystId);
    if (valid && Number.isFinite(initial?.probability)
      && Math.abs(initial.probability - view.probability) >= 0.01) {
      const change = document.createElement('small');
      change.textContent = `Tartışmadan önce %${n(initial.probability * 100, 0)} → sonra %${n(view.probability * 100, 0)}`;
      card.append(change);
    }
    box.append(card);
  }
}
function shortOpinion(reason) {
  const sentence = String(reason || '').trim().split(/[!?;]|\.\s+/)[0].trim();
  if (sentence.length <= 30) return sentence;
  const words = sentence.split(/\s+/);
  let result = '';
  for (const word of words) {
    if (`${result} ${word}`.trim().length > 27) break;
    result = `${result} ${word}`.trim();
  }
  return `${result || sentence.slice(0, 27)}…`;
}
function renderIdleSpeech() {
  const intent = state.intents[0];
  const finished = !intent || (['REVEALED','FAILED','INTERRUPTED'].includes(intent.status)
    && !['AWAITING_DECISION','SUBMITTING'].includes(intent.execution?.status));
  const council = state.roundDetail?.council;
  if (!finished || !council?.final?.length) return;
  for (const id of ['momentum','liquidity','relative','volatility']) {
    const view = council.final.find((entry) => entry.analystId === id);
    if (!view) continue;
    const valid = !view.abstain && view.claims?.length > 0
      && view.claims.every((claim) => claim.status === 'VERIFIED');
    const bubble = $(`vote-${id}`);
    bubble.textContent = valid ? shortOpinion(view.reason)
      : view.abstain ? 'Bu tur çekimserim' : 'Görüşüm sayılmadı';
    bubble.className = `say auto-talk ${!valid ? 'think' : ''}`;
  }
  const trial = council.final.find((entry) => entry.analystId.startsWith('trial-'));
  $('trial-agent').classList.toggle('hidden', !trial);
  if (trial) {
    put('vote-trial', trial.abstain ? 'Bu tur çekimserim' : shortOpinion(trial.reason));
    $('vote-trial').className = 'say auto-talk think';
  }
  put('chair-say', Number.isFinite(council.probability)
    ? `Otonom tur · %${n(council.probability * 100, 0)}` : 'Otonom tur tamamlandı');
}
function renderReasons() {
  const box = $('feed-reasons'); box.replaceChildren();
  const intent = state.intents[0];
  if (!intent) { box.textContent = 'Yeni bir istek başlayınca analistlerin gerekçeleri burada görünecek.'; return; }
  if (!intent.revealTx?.blockNumber || !intent.decision || !intent.council?.final) {
    box.textContent = intent.status === 'FAILED' || intent.status === 'INTERRUPTED'
      ? 'Bu isteğin görüşleri tamamlanamadı.'
      : 'Analistler canlı veriyi inceliyor. Gerekçeler karar Avalanche’da açılınca görünecek.';
    return;
  }
  const summary = document.createElement('div'); summary.className = 'summary';
  const title = document.createElement('strong');
  title.textContent = `Konsey: ${voteLabel[intent.decision.verdict] || intent.decision.verdict}`;
  const votes = intent.decision.votes;
  const detail = document.createElement('span');
  detail.textContent = `${votes.BUY} AL · ${votes.WAIT} BEKLE · ${votes.BLOCK} ENGELLE`;
  summary.append(title, detail);
  if (intent.decision.failed?.length) {
    const reason = document.createElement('p');
    reason.textContent = intent.decision.failed.map((name) => name === 'BUY_CONSENSUS'
      ? votes.BLOCK > 0
        ? `${votes.BLOCK} ENGELLE oyu var; işlem için oybirliğine yakın AL kararı oluşmadı.`
        : `En az üç doğrulanmış AL oyu gerekiyor; şu an ${votes.BUY} AL var.`
      : failedReason[name] || `${checkLabel[name] || name} koşulu sağlanmadı.`).join(' ');
    summary.append(reason);
  } else {
    const reason = document.createElement('p');
    reason.textContent = 'Analist çoğunluğu ve anlık piyasa güvenlik koşulları sağlandı.';
    summary.append(reason);
  }
  box.append(summary);
  for (const view of intent.council.final) {
    const verified = view.claims?.length > 0 && view.claims.every((claim) => claim.status === 'VERIFIED');
    const card = document.createElement('article');
    card.className = `opinion ${verified && view.vote === 'BLOCK' ? 'block' : ''}`;
    const heading = document.createElement('div'); heading.className = 'who';
    const who = document.createElement('span');
    const trial = view.analystId.startsWith('trial-');
    who.textContent = trial ? 'Çırak · deneme' : analystName[view.analystId] || view.analystId;
    const vote = document.createElement('span'); vote.className = 'vote';
    vote.textContent = verified ? voteLabel[view.vote] || view.vote : 'SAYILMADI';
    heading.append(who, vote);
    const reason = document.createElement('p');
    reason.textContent = verified ? view.reason : view.status === 'ERROR'
      ? view.reason?.includes('429') ? 'Model çağrısı kredi veya hız sınırına takıldı; oyu sayılmadı.'
        : view.reason?.includes('timed out') ? 'Model yanıtı zaman aşımına uğradı; oyu sayılmadı.'
          : 'Model yanıtı doğrulama kurallarını geçemedi; oyu sayılmadı. Bu, piyasa verisinin yanlış olduğu anlamına gelmez.'
      : 'Modelin söylediği sayılardan biri canlı OKX verisiyle uyuşmadı; oyu sayılmadı.';
    card.append(heading, reason);
    const initial = intent.council.initial?.find((entry) => entry.analystId === view.analystId);
    if (verified && initial?.vote && initial.vote !== view.vote) {
      const change = document.createElement('small');
      change.textContent = `Tartışmada oyunu değiştirdi: ${voteLabel[initial.vote] || initial.vote} → ${voteLabel[view.vote] || view.vote}`;
      card.append(change);
    }
    if (trial) {
      const note = document.createElement('small'); note.textContent = 'Çırağın oyu konsey çoğunluğuna katılmaz.';
      card.append(note);
    }
    box.append(card);
  }
}
function render() { renderMarket(); renderIntent(); renderIdleSpeech(); renderRounds(); renderReasons(); renderAutoCouncil(); renderFeedTabs(); renderEvents(); }
let polling = false;
async function poll(freshEverything = false) {
  if (polling) return;
  polling = true;
  try {
    const calls = [api('/api/trade-intents')];
    if (freshEverything) calls.push(api('/api/live-market'), api('/health'),
      api('/api/rounds'), api('/api/evolution'), api('/api/performance'),
      api('/api/account').then((result) => result.account).catch(() => null));
    const results = await Promise.all(calls);
    state.intents = results[0].intents || [];
    if (state.feedMode === null) state.feedMode = state.intents[0]
      && Date.now() - state.intents[0].createdAt < 5 * 60_000 ? 'trade' : 'auto';
    if (freshEverything) {
      state.market = results[1]; state.health = results[2];
      state.rounds = results[3].rounds || []; state.evolution = results[4]; state.performance = results[5];
      state.account = results[6];
      const summary = state.rounds.find((round) => round.trigger === 'scheduled'
        && ['COMMITTED','DUE','RESOLUTION_PENDING','RESOLVED','REVEALED'].includes(round.status));
      state.roundDetail = summary ? await api(`/api/rounds/${summary.id}`).then((result) => result.round).catch(() => null) : null;
    }
    for (let page = 0; page < 20; page++) {
      const result = await api(`/api/events?after=${state.eventCursor}`);
      state.events.push(...result.events);
      state.events = state.events.slice(-30);
      state.eventCursor = result.nextCursor;
      if (result.events.length < 100) break;
    }
    state.connection = 'LIVE';
  } catch (error) {
    state.connection = 'ERROR';
    console.error('Canlı API bağlantısı:', error.message);
  } finally { polling = false; render(); }
}
document.querySelectorAll('.btn[data-s]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.btn[data-s]').forEach((item) => item.classList.toggle('on', item === button));
  $('square').classList.toggle('hidden', button.dataset.s !== 'square');
  $('board').classList.toggle('hidden', button.dataset.s !== 'board');
  document.body.classList.toggle('board-open', button.dataset.s === 'board');
}));
for (const mode of ['trade','auto']) $(`feed-tab-${mode}`).addEventListener('click', () => {
  state.feedMode = mode; renderFeedTabs();
});
$('intent-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const amountUsdt = Number($('amount').value);
  const execute = $('execute').checked;
  if (execute && !window.confirm(`Konsey AL derse OKX TR alt hesabında en fazla ${n(amountUsdt, 2)} USDT ile gerçek AVAX spot alımı otomatik yapılacak. Devam edilsin mi?`)) return;
  state.feedMode = 'trade'; renderFeedTabs();
  const button = $('ask-button'); button.disabled = true; button.textContent = 'Başlatılıyor…';
  try {
    const result = await api('/api/trade-intents', {
      method: 'POST', headers: { 'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ amountUsdt, execute }),
    });
    put('execution-message', `İstek ${result.intentId.slice(0, 8)}… alındı; ${execute ? 'AL çıkarsa gerçek emir değerlendirilecek' : 'emir istenmedi'}`);
    await poll(true);
  } catch (error) { put('execution-message', `İstek başlatılamadı: ${error.message}`); }
  finally { button.disabled = false; button.textContent = '▶ Konseye Sor'; }
});
void poll(true);
void api('/api/lineage').then((lineage) => { state.lineage = lineage; renderRounds(); }).catch(() => {});
setInterval(() => void poll(false), 4000);
setInterval(() => void poll(true), 16000);
