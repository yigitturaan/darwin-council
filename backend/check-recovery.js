import 'dotenv/config';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Read real completed rounds, then exercise lost local receipts in a separate DB.
// No generated market/model data; production state is never modified. No signer.
const source = new DatabaseSync(resolve(process.env.DARWIN_DB_PATH || 'data/darwin.sqlite'), { readOnly: true });
const originals = source.prepare("SELECT payload FROM rounds WHERE status='REVEALED' ORDER BY created_at LIMIT 2")
  .all().map((r) => JSON.parse(r.payload));
source.close();
assert.equal(originals.length, 2, 'Two real revealed rounds are required');
const directory = mkdtempSync(join(tmpdir(), 'darwin-recovery-'));
process.env.DARWIN_DB_PATH = join(directory, 'recovery.sqlite');
delete process.env.FUJI_PRIVATE_KEY;
try {
  const { getOnchainRecord } = await import('./chain/index.js');
  for (const r of originals) assert.equal((await getOnchainRecord(r.id)).revealed, true);
  const { saveRound, getRound, getState, listEvents } = await import('./store.js');
  const { recoverInterrupted, resolveDueRounds } = await import('./coordinator.js');
  const first = structuredClone(originals[0]);
  first.status = 'COMMITTING';
  delete first.commitTx;
  delete first.revealTx;
  delete first.resolution;
  first.nextRetryAt = null;
  saveRound(first);
  const second = structuredClone(originals[1]);
  second.status = 'RESOLVED';
  delete second.revealTx;
  second.nextRetryAt = null;
  saveRound(second);
  recoverInterrupted();
  assert.equal(getRound(first.id).status, 'CHAIN_PENDING');
  await resolveDueRounds();
  for (const original of originals) {
    const recovered = getRound(original.id);
    assert.equal(recovered.status, 'REVEALED');
    assert.equal(recovered.commitTx.hash, original.commitTx.hash);
    assert.equal(recovered.revealTx.hash, original.revealTx.hash);
    assert.equal(recovered.resolution.outcome, original.resolution.outcome);
    assert.equal(recovered.resolution.targetCandle.close, original.resolution.targetCandle.close);
  }
  assert.equal(getState('roles'), null, 'Two real results must not trigger evolution');
  const eventCount = listEvents(0, 10000).length;
  await resolveDueRounds();
  assert.equal(listEvents(0, 10000).length, eventCount, 'Recovery must be idempotent');
  console.log(JSON.stringify({ result: 'PASS', lostCommitReceipt: true, lostRevealReceipt: true,
    realTargetRechecked: true, idempotent: true, noPrematureEvolution: true,
    source: 'EXISTING_REAL_ROUNDS_PLUS_LIVE_FUJI_AND_ATK', productionWrites: false, signerAvailable: false }, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
