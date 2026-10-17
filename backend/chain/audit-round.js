import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeEventLog, fromHex } from 'viem';
import { config } from '../config.js';
import { getRound, listRounds } from '../store.js';
import { getTargetCandle, snapshotHash } from '../market.js';
import { commitmentFor, getOnchainRecord, publicClient } from './index.js';

const id = process.argv[2] || listRounds(1)[0]?.id;
if (!id) throw new Error('No stored round. Pass a round ID.');
const round = getRound(id);
if (!round) throw new Error(`Round not found: ${id}`);
if (!round.commitTx?.hash || !round.revealPayload || !round.commitment) {
  console.log(JSON.stringify({ roundId: id, status: round.status, audit: 'NO_COMMITTED_ROUND_YET' }, null, 2));
  process.exit(0);
}

const checks = {};
checks.localSnapshotHash = snapshotHash(round.snapshot) === round.sourceHash;
checks.localPayloadHash = commitmentFor(JSON.parse(round.revealPayload)).commitment === round.commitment;
const chainRecord = await getOnchainRecord(id);
checks.chainCommitment = chainRecord?.commitment === round.commitment;
const commitReceipt = await publicClient.getTransactionReceipt({ hash: round.commitTx.hash });
const commitBlock = await publicClient.getBlock({ blockNumber: commitReceipt.blockNumber });
checks.commitConfirmed = commitReceipt.status === 'success';
checks.commitBeforeOutcome = Number(commitBlock.timestamp) * 1000 < round.dueCandleEnd;

if (round.resolution) {
  const target = await getTargetCandle(round.instrument, round.dueCandleEnd);
  checks.targetCandleMatchesLiveATK = Boolean(target && target.confirmed
    && target.endMs === round.resolution.targetCandle.endMs
    && target.close === round.resolution.targetCandle.close);
  const expectedOutcome = target && target.close > round.startClose ? 1 : 0;
  checks.outcomeMath = Boolean(target && round.resolution.outcome === expectedOutcome);
  checks.brierMath = Boolean(target && Math.abs(round.resolution.councilBrier
    - (round.council.probability - expectedOutcome) ** 2) < 1e-12);
}

if (round.revealTx?.hash) {
  const revealReceipt = await publicClient.getTransactionReceipt({ hash: round.revealTx.hash });
  checks.revealConfirmed = revealReceipt.status === 'success' && chainRecord?.revealed === true;
  const abi = JSON.parse(readFileSync(resolve('backend/contracts/build/DarwinCommit.json'), 'utf8')).abi;
  const revealLog = revealReceipt.logs.filter((log) =>
    log.address.toLowerCase() === config.contractAddress.toLowerCase()).map((log) => {
    try { return decodeEventLog({ abi, data: log.data, topics: log.topics }); }
    catch { return null; }
  }).find((event) => event?.eventName === 'Revealed');
  checks.revealedPayloadMatches = Boolean(revealLog
    && fromHex(revealLog.args.payload, 'string') === round.revealPayload);
}

console.log(JSON.stringify({ roundId: id, status: round.status,
  result: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
  checks, commitTx: round.commitTx.hash, revealTx: round.revealTx?.hash || null,
  source: 'LOCAL_SQLITE_PLUS_LIVE_FUJI_AND_ATK_WHEN_RESOLVED' }, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
