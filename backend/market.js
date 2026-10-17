import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config } from './config.js';

const execFileAsync = promisify(execFile);
const cli = resolve(fileURLToPath(new URL('../node_modules/.bin/okx', import.meta.url)));
const MAX_AGE_MS = 180_000;

export function snapshotHash(snapshot) {
  const { sourceHash, status, ageMs, ...canonical } = snapshot;
  return `0x${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export async function atk(args) {
  let stdout;
  try { ({ stdout } = await execFileAsync(cli, [...args, '--json'], {
    env: { ...process.env, OKX_SITE: 'tr', OKX_API_BASE_URL: 'https://tr.okx.com' },
    timeout: 15_000,
    maxBuffer: 2_000_000,
  })); } catch { throw new Error(`ATK request unavailable: ${args.slice(0, 2).join(' ')}`); }
  const value = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length === 0) throw new Error(`ATK empty response: ${args.join(' ')}`);
  return value;
}

const number = (x, field) => {
  if ((typeof x !== 'string' && typeof x !== 'number') || (typeof x === 'string' && !x.trim()))
    throw new Error(`Missing or invalid ${field}`);
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${field}: ${String(x)}`);
  return n;
};

const positive = (x, field) => {
  const n = number(x, field);
  if (n <= 0) throw new Error(`Non-positive ${field}`);
  return n;
};

export function parseCandle(row) {
  if (!Array.isArray(row) || row.length < 9) throw new Error('Invalid ATK candle');
  const candle = {
    startMs: positive(row[0], 'candle timestamp'),
    endMs: positive(row[0], 'candle timestamp') + 60_000,
    open: positive(row[1], 'open'), high: positive(row[2], 'high'),
    low: positive(row[3], 'low'), close: positive(row[4], 'close'),
    volume: number(row[5], 'volume'), confirmed: String(row[8]) === '1',
  };
  if (!Number.isSafeInteger(candle.startMs) || candle.startMs % 60_000 !== 0
    || !['0','1'].includes(String(row[8])) || candle.volume < 0
    || candle.low > Math.min(candle.open, candle.close)
    || candle.high < Math.max(candle.open, candle.close) || candle.high < candle.low)
    throw new Error('Invalid candle structure');
  return candle;
}

export async function getCandles(instrument = config.instrument, limit = 60) {
  const rows = await atk(['market', 'candles', instrument, '--bar', '1m', '--limit', String(limit)]);
  return rows.map(parseCandle).sort((a, b) => a.startMs - b.startMs);
}

function bookSide(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Empty orderbook side');
  return rows.map((row) => ({ price: positive(row[0], 'book price'), size: positive(row[1], 'book size') }));
}

export async function getMarketSnapshot(instrument = config.instrument) {
  if (instrument !== 'AVAX-USDT') throw new Error('Council roles currently require AVAX-USDT');
  const observedAt = Date.now();
  const optional = (args) => atk(args).then((rows) => ({ rows, error: null }),
    (error) => ({ rows: null, error: error?.name || 'ATK_ERROR' }));
  const [tickerRows, bookRows, candles, btcRows, ethRows, fundingResult, interestResult] = await Promise.all([
    atk(['market', 'ticker', instrument]),
    atk(['market', 'orderbook', instrument, '--sz', '20']),
    getCandles(instrument, 60),
    atk(['market', 'ticker', 'BTC-USDT']),
    atk(['market', 'ticker', 'ETH-USDT']),
    optional(['market', 'funding-rate', 'AVAX-USDT-SWAP']),
    optional(['market', 'open-interest', '--instType', 'SWAP', '--instId', 'AVAX-USDT-SWAP']),
  ]);
  const ticker = tickerRows[0], book = bookRows[0], btc = btcRows[0], eth = ethRows[0];
  const last = [...candles].reverse().find((c) => c.confirmed);
  if (!last) throw new Error('No confirmed 1m candle');
  const tickTs = number(ticker.ts, 'ticker timestamp');
  const bookTs = number(book.ts, 'orderbook timestamp');
  const btcTs = number(btc.ts, 'BTC timestamp');
  const ethTs = number(eth.ts, 'ETH timestamp');
  const sourceTimes = [tickTs, bookTs, last.endMs, btcTs, ethTs];
  const ageMs = Date.now() - Math.min(...sourceTimes);
  if (sourceTimes.some((ts) => Date.now() - ts > MAX_AGE_MS || ts - Date.now() > 30_000))
    throw new Error(`STALE or future ATK source, oldest age ${ageMs}ms`);
  const bids = bookSide(book.bids), asks = bookSide(book.asks);
  const bidDepth = bids.reduce((s, x) => s + x.size, 0);
  const askDepth = asks.reduce((s, x) => s + x.size, 0);
  if (bidDepth + askDepth <= 0 || asks[0].price < bids[0].price) throw new Error('Invalid live orderbook depth or spread');
  const previous5 = candles.find((c) => c.confirmed && c.endMs === last.endMs - 5 * 60_000);
  const previous15 = candles.find((c) => c.confirmed && c.endMs === last.endMs - 15 * 60_000);
  const optionalValue = (result, field) => {
    if (!result.rows) return { status: 'UNAVAILABLE', value: null, sourceAt: null };
    const row = result.rows[0];
    let value, sourceAt;
    try {
      value = number(row?.[field], field);
      sourceAt = positive(row?.ts, 'optional timestamp');
      if (field === 'oiUsd' && value < 0) throw new Error('Negative open interest');
    } catch { return { status: 'INVALID', value: null, sourceAt: null }; }
    const age = Date.now() - sourceAt;
    if (age > MAX_AGE_MS || age < -30_000)
      return { status: 'STALE', value: null, sourceAt };
    return { status: 'LIVE', value, sourceAt };
  };
  const funding = optionalValue(fundingResult, 'fundingRate');
  const openInterest = optionalValue(interestResult, 'oiUsd');
  const metricCatalog = {
    startClose: last.close,
    lastPrice: positive(ticker.last, 'last price'),
    return5mPct: previous5 ? 100 * (last.close / previous5.close - 1) : null,
    return15mPct: previous15 ? 100 * (last.close / previous15.close - 1) : null,
    bidDepth, askDepth,
    depthImbalance: (bidDepth - askDepth) / (bidDepth + askDepth),
    spreadBps: 10_000 * (asks[0].price - bids[0].price) / ((asks[0].price + bids[0].price) / 2),
    btc24hPct: 100 * (positive(btc.last, 'BTC price') / positive(btc.open24h, 'BTC open24h') - 1),
    eth24hPct: 100 * (positive(eth.last, 'ETH price') / positive(eth.open24h, 'ETH open24h') - 1),
    avax24hPct: 100 * (positive(ticker.last, 'AVAX price') / positive(ticker.open24h, 'AVAX open24h') - 1),
    fundingRatePct: funding.value === null ? null : 100 * funding.value,
    openInterestUsd: openInterest.value,
    range15mPct: (() => {
      const recent = candles.filter((c) => c.confirmed && c.endMs > last.endMs - 15 * 60_000);
      if (new Set(recent.map((c) => c.endMs)).size !== 15) return null;
      return 100 * (Math.max(...recent.map((c) => c.high)) - Math.min(...recent.map((c) => c.low))) / last.close;
    })(),
  };
  if (Object.values(metricCatalog).some((v) => v !== null && !Number.isFinite(v)))
    throw new Error('Non-finite market metric');
  const raw = {
    instrument, observedAt, source: 'OKX_TR_ATK_CLI',
    ticker: { last: metricCatalog.lastPrice, ts: tickTs, open24h: number(ticker.open24h, 'open24h') },
    orderbook: { bids, asks, ts: bookTs },
    candles: candles.filter((c) => c.confirmed),
    relative: {
      btc: { last: number(btc.last, 'BTC last'), open24h: number(btc.open24h, 'BTC open'), ts: btcTs },
      eth: { last: number(eth.last, 'ETH last'), open24h: number(eth.open24h, 'ETH open'), ts: ethTs },
    },
    derivatives: { funding: { status: funding.status, sourceAt: funding.sourceAt },
      openInterest: { status: openInterest.status, sourceAt: openInterest.sourceAt } },
    startCandleEnd: last.endMs,
    startClose: last.close,
    dueCandleEnd: last.endMs + 30 * 60_000,
    metrics: metricCatalog,
    sourceTimes: { ticker: tickTs, orderbook: bookTs, candleEnd: last.endMs,
      btc: btcTs, eth: ethTs, funding: funding.sourceAt, openInterest: openInterest.sourceAt },
  };
  return { ...raw, sourceHash: snapshotHash(raw), status: 'LIVE', ageMs };
}

export async function getTargetCandle(instrument, dueCandleEnd) {
  if (!Number.isSafeInteger(dueCandleEnd) || dueCandleEnd % 60_000 !== 0)
    throw new Error('Invalid target candle time');
  if (dueCandleEnd > Date.now()) return null;
  // ATK chooses its historical endpoint automatically for older timestamps.
  // `after` is an exclusive upper bound on candle START times.
  const rows = await atk(['market', 'candles', instrument, '--bar', '1m',
    '--after', String(dueCandleEnd), '--limit', '3']);
  return rows.map(parseCandle).find((c) => c.confirmed && c.endMs === dueCandleEnd) || null;
}
