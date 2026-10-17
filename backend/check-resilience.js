import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { refreshMarket, marketState } from './coordinator.js';
import { parseCandle } from './market.js';

// Real ATK responses and real connection/process failures, never fabricated API responses.
const live = await refreshMarket();
assert.equal(live.status, 'LIVE');
const originalPath = process.env.PATH;
try {
  // The installed CLI uses /usr/bin/env node. Make its runtime unavailable
  // in this check's child processes only; the actual backend is unaffected.
  process.env.PATH = '/nonexistent-darwin-check';
  const failed = await refreshMarket();
  assert.equal(failed.status, 'UNAVAILABLE');
  assert.equal(failed.data, undefined);
  assert.equal(marketState().data.status, 'UNAVAILABLE');
} finally { process.env.PATH = originalPath; }
assert.equal((await refreshMarket()).status, 'LIVE');
const c = live.data.candles.at(-1);
const row = [c.startMs,c.open,c.high,c.low,c.close,c.volume,0,0,1];
for (const invalid of [null, undefined, '', ' ', false, true, 0, -1])
  assert.throws(() => parseCandle(row.map((v,i) => i === 4 ? invalid : v)));

const directory = mkdtempSync(join(tmpdir(), 'darwin-offline-'));
const port = 18789;
const child = spawn(process.execPath, ['backend/server.js'], {
  env: { ...process.env, DARWIN_DB_PATH: join(directory, 'offline.sqlite'),
    PORT: String(port), AUTO_ROUNDS: 'false', FUJI_RPC_URL: 'http://127.0.0.1:1',
    OPENAI_API_KEY: '', FUJI_PRIVATE_KEY: '', FUJI_CONTRACT_ADDRESS: '' },
  stdio: 'ignore',
});
try {
  let connected = false;
  for (let i=0; i<40; i++) {
    if (child.exitCode !== null) throw new Error('Isolated server exited');
    try { await fetch(`http://127.0.0.1:${port}/api/rounds`); connected = true; break; }
    catch { await delay(100); }
  }
  assert.equal(connected, true);
  const request = (path, options) => fetch(`http://127.0.0.1:${port}${path}`, options);
  const health = await (await request('/health')).json();
  assert.equal(health.status, 'DEGRADED');
  assert.equal(health.fuji.status, 'UNAVAILABLE');
  const missing = await request('/api/rounds', { method: 'POST' });
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).reason, 'MISSING_CONFIG');
  assert.equal((await request('/api/rounds', { method: 'POST', headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  // fetch normalizes Host; use HTTP directly to actually send a foreign Host.
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: '/api/rounds',
      headers: { Host: 'untrusted.invalid' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await request('/api/events?after=invalid')).status, 400);
  assert.equal((await (await request('/api/rounds')).json()).rounds.length, 0);
  console.log(JSON.stringify({ result: 'PASS', realSourceFailure: true, sourceRecovery: true,
    invalidNumberRejected: true, realRpcFailure: true, missingCredentialsBlocked: true,
    foreignOriginBlocked: true, foreignHostBlocked: true, invalidCursorRejected: true,
    fabricatedRounds: 0, productionWrites: false }, null, 2));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  rmSync(directory, { recursive: true, force: true });
}
