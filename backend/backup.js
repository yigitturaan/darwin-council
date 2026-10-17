import 'dotenv/config';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const source = resolve(process.env.DARWIN_DB_PATH || 'data/darwin.sqlite');
const directory = join(dirname(source), 'backups');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const destination = join(directory, `darwin-${new Date().toISOString().replaceAll(':','-')}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA integrity_check').get();
    if (check.integrity_check !== 'ok') throw new Error('Backup integrity check failed');
    console.log(JSON.stringify({ result: 'PASS', file: destination,
      rounds: copy.prepare('SELECT count(*) AS n FROM rounds').get().n }));
  } finally { copy.close(); }
} finally { db.close(); }
