import { okxRows, privateAtk, verifiedSubaccount } from './okx-private.js';

const validAmount = (amount) => Number.isFinite(amount) && amount === 5
  && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
let accountCache = null;

export async function readAccountStatus() {
  if (accountCache && Date.now() - accountCache.observedAt < 30_000) return accountCache;
  const account = await verifiedSubaccount();
  const row = okxRows(await privateAtk(['account', 'balance', 'USDT']))?.[0]
    ?.details?.find((entry) => entry.ccy === 'USDT');
  const availableUsdt = Number(row?.availBal ?? row?.availEq);
  const totalUsdt = Number(row?.eq);
  if (!Number.isFinite(availableUsdt) || !Number.isFinite(totalUsdt))
    throw new Error('OKX TR USDT bakiyesi doğrulanamadı');
  accountCache = { status: 'LIVE', site: 'OKX TR', account: account.type,
    availableUsdt, totalUsdt, observedAt: Date.now() };
  return accountCache;
}

export async function spotBuyPreflight(amountUsdt, marketPrice) {
  if (!validAmount(amountUsdt)) throw new Error('5 USDT sınırı veya tutar biçimi geçersiz');
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) throw new Error('Geçerli canlı AVAX fiyatı yok');
  await verifiedSubaccount();
  const instrument = okxRows(await privateAtk(['market', 'instruments', '--instType', 'SPOT',
    '--instId', 'AVAX-USDT']))?.[0];
  if (!instrument || instrument.instId !== 'AVAX-USDT' || instrument.state !== 'live'
      || instrument.baseCcy !== 'AVAX' || instrument.quoteCcy !== 'USDT'
      || !instrument.tradeQuoteCcyList?.includes('USDT'))
    throw new Error('OKX TR AVAX-USDT spot ürünü canlı işleme uygun değil');
  const minAvax = Number(instrument.minSz);
  const maxMarketUsdt = Number(instrument.maxMktAmt);
  if (!Number.isFinite(minAvax) || minAvax <= 0 || amountUsdt / marketPrice < minAvax
      || !Number.isFinite(maxMarketUsdt) || amountUsdt > maxMarketUsdt)
    throw new Error('OKX TR ürününün canlı minimum veya maksimum emir büyüklüğü karşılanmıyor');
  const row = okxRows(await privateAtk(['account', 'balance', 'USDT']))?.[0]
    ?.details?.find((entry) => entry.ccy === 'USDT');
  const available = Number(row?.availBal ?? row?.availEq);
  if (!Number.isFinite(available) || available < amountUsdt)
    throw new Error('OKX Al-Sat hesabında yeterli kullanılabilir USDT yok');
  return { availableUsdt: available, minAvax, maxMarketUsdt, checkedAt: Date.now() };
}

export async function placeSpotMarketBuy({ amountUsdt, clientOrderId }) {
  if (!validAmount(amountUsdt)) throw new Error('5 USDT sınırı veya tutar biçimi geçersiz');
  if (!/^DK[A-Za-z0-9]{1,30}$/.test(clientOrderId)) throw new Error('Geçersiz OKX client order ID');
  // One live POST only. Callers must persist SUBMITTING before invoking this function.
  // A timeout can mean the exchange accepted the order; never retry automatically.
  const result = okxRows(await privateAtk(['spot', 'place', '--instId', 'AVAX-USDT',
    '--side', 'buy', '--ordType', 'market', '--tdMode', 'cash',
    '--sz', amountUsdt.toFixed(2), '--tgtCcy', 'quote_ccy', '--banAmend',
    '--clOrdId', clientOrderId]))?.[0];
  if (!result || String(result.sCode) !== '0' || !result.ordId)
    throw new Error('OKX emri kabul etmedi veya yanıt doğrulanamadı');
  return { orderId: result.ordId, clientOrderId, acceptedAt: Date.now() };
}

export async function getSpotOrder({ orderId, clientOrderId }) {
  const args = ['spot', 'get', '--instId', 'AVAX-USDT'];
  if (orderId) args.push('--ordId', orderId);
  else if (clientOrderId) args.push('--clOrdId', clientOrderId);
  else throw new Error('OKX order ID eksik');
  const row = okxRows(await privateAtk(args))?.[0];
  if (!row || row.instId !== 'AVAX-USDT' || row.side !== 'buy' || row.ordType !== 'market')
    throw new Error('OKX emri beklenen AVAX spot alımıyla eşleşmedi');
  return { orderId: row.ordId, clientOrderId: row.clOrdId || clientOrderId,
    state: row.state, filledAvax: Number(row.accFillSz || 0),
    avgPrice: Number(row.avgPx || 0), observedAt: Date.now() };
}
