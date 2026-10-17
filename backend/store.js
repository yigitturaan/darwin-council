import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const dbPath = resolve(process.env.DARWIN_DB_PATH || 'data/darwin.sqlite');
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath);
chmodSync(dbPath, 0o600);
db.exec(`PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL,
  due_at INTEGER, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rounds_due ON rounds(due_at, status);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  round_id TEXT, type TEXT NOT NULL, details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
db.exec(`CREATE TABLE IF NOT EXISTS trade_intents (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_intents_created ON trade_intents(created_at DESC);`);

const encode = JSON.stringify;
const decode = (r) => r ? JSON.parse(r.payload) : null;

export function saveRound(round) {
  db.prepare(`INSERT INTO rounds(id,status,created_at,due_at,payload) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,due_at=excluded.due_at,payload=excluded.payload`)
    .run(round.id, round.status, round.createdAt, round.dueCandleEnd || null, encode(round));
  return round;
}
export function getRound(id) { return decode(db.prepare('SELECT payload FROM rounds WHERE id=?').get(id)); }
export function listRounds(limit = 50) {
  return db.prepare('SELECT payload FROM rounds ORDER BY created_at DESC LIMIT ?').all(limit).map(decode);
}
export function roundsWithStatus(...statuses) {
  return db.prepare(`SELECT payload FROM rounds WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`)
    .all(...statuses).map(decode);
}
export function pendingDue(now = Date.now()) {
  return db.prepare(`SELECT payload FROM rounds WHERE due_at <= ? AND status IN ('COMMITTED','DUE','RESOLUTION_PENDING') ORDER BY due_at`).all(now).map(decode);
}
export function event(type, roundId = null, details = {}) {
  const at = Date.now();
  db.prepare('INSERT INTO events(at,round_id,type,details) VALUES(?,?,?,?)').run(at, roundId, type, encode(details));
  return { at, roundId, type, details };
}
export function listEvents(after = 0, limit = 100) {
  return db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?').all(after, limit)
    .map((e) => ({ seq: e.seq, at: e.at, roundId: e.round_id, type: e.type, details: JSON.parse(e.details) }));
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function getState(key) {
  const row = db.prepare('SELECT payload FROM state WHERE key=?').get(key);
  return row ? JSON.parse(row.payload) : null;
}
export function setState(key, value) {
  db.prepare('INSERT INTO state(key,payload) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload')
    .run(key, encode(value));
}
export function saveTradeIntent(intent) {
  db.prepare(`INSERT INTO trade_intents(id,status,created_at,payload) VALUES(?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload`)
    .run(intent.id, intent.status, intent.createdAt, encode(intent));
  return intent;
}
export function getTradeIntent(id) { return decode(db.prepare('SELECT payload FROM trade_intents WHERE id=?').get(id)); }
export function listTradeIntents(limit = 50) {
  return db.prepare('SELECT payload FROM trade_intents ORDER BY created_at DESC LIMIT ?').all(limit).map(decode);
}
