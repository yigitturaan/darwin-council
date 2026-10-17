import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeEventLog } from 'viem';
import { config } from '../config.js';
import { getRoles } from '../roles.js';
import { getState } from '../store.js';
import { analystKey, analystSpecHash, analystDecisionHash, retirementHash,
  readLineageAnalyst } from '../lineage.js';
import { publicClient } from './index.js';

if (!config.lineageAddress) throw new Error('FUJI_LINEAGE_ADDRESS is not configured');
const abi = JSON.parse(readFileSync(resolve('backend/contracts/build/DarwinLineage.json'), 'utf8')).abi;
const zero = `0x${'0'.repeat(64)}`;
const roles = getRoles();
const checks = {};
checks.fujiChain = await publicClient.getChainId() === 43113;
const code = await publicClient.getBytecode({ address: config.lineageAddress });
checks.contractDeployed = Boolean(code && code !== '0x');

async function eventMatches(tx, name, expected) {
  if (!tx?.hash) return false;
  const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
  if (receipt.status !== 'success') return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== config.lineageAddress.toLowerCase()) return false;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      return decoded.eventName === name && Object.entries(expected).every(([key, value]) => decoded.args[key] === value);
    } catch { return false; }
  });
}

const analysts = [];
for (const role of roles) {
  const record = await readLineageAnalyst(role.id);
  const parentIdHash = role.parentId ? analystKey(role.parentId) : zero;
  const expectedStatus = role.status === 'TRIAL' ? 1 : role.status === 'REJECTED' ? 3
    : role.status === 'RETIRED' ? 4 : 2;
  const idHash = analystKey(role.id);
  const specificationHash = analystSpecHash(role);
  const child = role.status === 'RETIRED'
    ? roles.find((r) => r.parentId === role.id && r.status === 'ACTIVE') : null;
  const expectedDecisionHash = child ? retirementHash(role, child)
    : role.parentId && ['ACTIVE', 'REJECTED'].includes(role.status) ? analystDecisionHash(role) : null;
  const registrationTx = getState(`lineageTx:${role.parentId ? 'registerCandidate' : 'registerFounder'}:${role.id}`);
  const decisionTx = getState(`lineageTx:decide:${role.id}`);
  const retirementTx = getState(`lineageTx:retire:${role.id}`);
  const roleChecks = {
    registered: record.statusCode !== 0,
    specificationHash: record.specificationHash === specificationHash,
    parentHash: record.parentIdHash === parentIdHash,
    status: record.statusCode === expectedStatus,
    decisionHash: !expectedDecisionHash || record.decisionHash === expectedDecisionHash,
    registrationEvent: await eventMatches(registrationTx, 'AnalystRegistered', {
      analystId: idHash, parentId: parentIdHash, specificationHash,
      status: role.parentId ? 1 : 2,
    }),
  };
  if (expectedDecisionHash) {
    roleChecks.decisionEvent = await eventMatches(
      role.status === 'RETIRED' ? retirementTx : decisionTx,
      'AnalystDecided', { analystId: idHash, status: expectedStatus,
        evidenceHash: expectedDecisionHash });
  }
  analysts.push({ id: role.id, localStatus: role.status, onchainStatusCode: record.statusCode,
    result: Object.values(roleChecks).every(Boolean) ? 'PASS' : 'PENDING_OR_FAIL',
    checks: roleChecks, registrationTx: registrationTx?.hash || null,
    decisionTx: decisionTx?.hash || null, retirementTx: retirementTx?.hash || null });
}

const result = Object.values(checks).every(Boolean)
  && analysts.length >= 4 && analysts.every((a) => a.result === 'PASS') ? 'PASS' : 'FAIL';
console.log(JSON.stringify({ result, source: 'LOCAL_SQLITE_PLUS_LIVE_FUJI_RECEIPTS_AND_EVENTS',
  contractAddress: config.lineageAddress, checks, analysts }, null, 2));
if (result !== 'PASS') process.exitCode = 1;
