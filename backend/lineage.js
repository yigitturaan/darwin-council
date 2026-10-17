import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, toHex } from 'viem';
import { config } from './config.js';
import { getRoles } from './roles.js';
import { getState, setState } from './store.js';
import { checkChainReady, confirmTx, publicClient, sendFujiContract } from './chain/index.js';

const abi = JSON.parse(readFileSync(resolve('backend/contracts/build/DarwinLineage.json'), 'utf8')).abi;
const zero = `0x${'0'.repeat(64)}`;
const hash = (value) => keccak256(toHex(JSON.stringify(value)));
export const analystKey = (id) => keccak256(toHex(id));

export function analystSpecHash(role) {
  return hash({ version: 1, roleId: role.id, parentId: role.parentId,
    metrics: role.metrics, instruction: role.instruction, bornAt: role.bornAt,
    evidence: role.evidence || null });
}

export function analystDecisionHash(role) {
  return hash({ version: 1, roleId: role.id, parentId: role.parentId,
    status: role.status, decisionAt: role.decisionAt,
    liveTrialScore: role.liveTrialScore });
}

export function retirementHash(role, promotedChild) {
  return hash({ version: 1, roleId: role.id, status: 'RETIRED', retiredAt: role.retiredAt,
    childId: promotedChild.id, childDecisionHash: analystDecisionHash(promotedChild) });
}

export async function readLineageAnalyst(id) {
  if (!config.lineageAddress) return null;
  const row = await publicClient.readContract({ address: config.lineageAddress, abi,
    functionName: 'analysts', args: [analystKey(id)] });
  return { parentIdHash: row[0], specificationHash: row[1], statusCode: Number(row[2]),
    createdAt: Number(row[3]) * 1000 || null, decidedAt: Number(row[4]) * 1000 || null,
    decisionHash: row[5] };
}

async function writeAndConfirm(functionName, args, roleId) {
  const txHash = await sendFujiContract(config.lineageAddress, abi, functionName, args);
  const receipt = await confirmTx(txHash);
  setState(`lineageTx:${functionName}:${roleId}`, { hash: txHash,
    explorerUrl: receipt.explorerUrl, blockNumber: receipt.blockNumber });
}

async function recoverLineageTx(functionName, role, record, expectedStatus) {
  const key = `lineageTx:${functionName}:${role.id}`;
  if (getState(key)) return;
  const targetTime = functionName === 'registerFounder' || functionName === 'registerCandidate'
    ? record.createdAt : record.decidedAt;
  if (!targetTime) throw new Error(`Missing Fuji lineage event time: ${role.id}`);
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  let lo = 0n, hi = latest;
  const since = Math.floor(targetTime / 1000) - 120;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const block = await publicClient.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) < since) lo = mid + 1n; else hi = mid;
  }
  const eventName = functionName === 'decide' || functionName === 'retire'
    ? 'AnalystDecided' : 'AnalystRegistered';
  for (let fromBlock = lo; fromBlock <= latest; fromBlock += 100n) {
    const toBlock = fromBlock + 99n > latest ? latest : fromBlock + 99n;
    const logs = await publicClient.getContractEvents({ address: config.lineageAddress, abi,
      eventName, args: { analystId: analystKey(role.id) }, fromBlock, toBlock, strict: true });
    const match = logs.find((log) => Number(log.args.status) === expectedStatus);
    if (match) {
      const receipt = await confirmTx(match.transactionHash);
      setState(key, { hash: match.transactionHash,
        explorerUrl: receipt.explorerUrl, blockNumber: receipt.blockNumber });
      return;
    }
  }
  throw new Error(`Fuji lineage event not indexed yet: ${role.id}`);
}

let synchronizing = false;
export async function syncLineage() {
  if (synchronizing) return;
  synchronizing = true;
  try {
    if (!config.lineageAddress) throw new Error('FUJI_LINEAGE_ADDRESS is not configured');
    const { signer } = await checkChainReady();
    const [code, owner] = await Promise.all([
      publicClient.getBytecode({ address: config.lineageAddress }),
      publicClient.readContract({ address: config.lineageAddress, abi, functionName: 'owner' }),
    ]);
    if (!code || code === '0x' || owner.toLowerCase() !== signer.toLowerCase())
      throw new Error('Fuji lineage contract or owner mismatch');
    const roles = getRoles();
    // Registration precedes decisions; a retired parent must exist on chain
    // before its child can be registered.
    for (const role of roles) {
      const record = await readLineageAnalyst(role.id);
      const specHash = analystSpecHash(role);
      if (record.statusCode === 0) {
        await writeAndConfirm(role.parentId ? 'registerCandidate' : 'registerFounder',
          role.parentId ? [analystKey(role.id), analystKey(role.parentId), specHash]
            : [analystKey(role.id), specHash], role.id);
        return;
      }
      if (record.specificationHash !== specHash || record.parentIdHash !== (role.parentId ? analystKey(role.parentId) : zero))
        throw new Error(`Lineage specification mismatch: ${role.id}`);
      await recoverLineageTx(role.parentId ? 'registerCandidate' : 'registerFounder',
        role, record, role.parentId ? 1 : 2);
    }
    for (const role of roles.filter((r) => r.parentId && ['ACTIVE','REJECTED'].includes(r.status))) {
      const record = await readLineageAnalyst(role.id);
      const wanted = role.status === 'ACTIVE' ? 2 : 3;
      const evidenceHash = analystDecisionHash(role);
      if (record.statusCode === 1) {
        await writeAndConfirm('decide', [analystKey(role.id), wanted, evidenceHash], role.id);
        return;
      }
      if (record.statusCode !== wanted || record.decisionHash !== evidenceHash)
        throw new Error(`Lineage decision mismatch: ${role.id}`);
      await recoverLineageTx('decide', role, record, wanted);
    }
    for (const role of roles.filter((r) => r.status === 'RETIRED')) {
      const child = roles.find((r) => r.parentId === role.id && r.status === 'ACTIVE');
      if (!child) throw new Error(`Retired analyst has no promoted child: ${role.id}`);
      const record = await readLineageAnalyst(role.id);
      const evidenceHash = retirementHash(role, child);
      if (record.statusCode === 2) {
        await writeAndConfirm('retire', [analystKey(role.id), evidenceHash], role.id);
        return;
      }
      if (record.statusCode !== 4 || record.decisionHash !== evidenceHash)
        throw new Error(`Lineage retirement mismatch: ${role.id}`);
      await recoverLineageTx('retire', role, record, 4);
    }
    setState('lineageLastCompleteAt', Date.now());
  } finally { synchronizing = false; }
}

export async function publicLineage() {
  const roles = getRoles();
  if (!config.lineageAddress) return { status: 'UNAVAILABLE', contractAddress: null, analysts: [] };
  const records = await Promise.all(roles.map(async (role) => {
    const onchain = await readLineageAnalyst(role.id);
    const expectedStatus = role.status === 'TRIAL' ? 1 : role.status === 'REJECTED' ? 3
      : role.status === 'RETIRED' ? 4 : 2;
    const parentHash = role.parentId ? analystKey(role.parentId) : zero;
    let expectedDecisionHash = null;
    if (role.parentId && ['ACTIVE','REJECTED'].includes(role.status)) expectedDecisionHash = analystDecisionHash(role);
    if (role.status === 'RETIRED') {
      const child = roles.find((r) => r.parentId === role.id && r.status === 'ACTIVE');
      if (child) expectedDecisionHash = retirementHash(role, child);
    }
    const proofStatus = onchain.statusCode === 0 ? 'PENDING'
      : onchain.specificationHash !== analystSpecHash(role) || onchain.parentIdHash !== parentHash
        ? 'MISMATCH'
        : onchain.statusCode !== expectedStatus ? 'PENDING'
          : expectedDecisionHash && onchain.decisionHash !== expectedDecisionHash ? 'MISMATCH' : 'VERIFIED';
    return { id: role.id, parentId: role.parentId, localStatus: role.status,
      specificationHash: analystSpecHash(role), evidence: role.evidence || null, proofStatus,
      onchain, registrationTx: getState(`lineageTx:${role.parentId ? 'registerCandidate' : 'registerFounder'}:${role.id}`),
      decisionTx: getState(`lineageTx:decide:${role.id}`),
      retirementTx: getState(`lineageTx:retire:${role.id}`) };
  }));
  return { status: records.some((r) => r.proofStatus === 'MISMATCH') ? 'MISMATCH'
    : records.every((r) => r.proofStatus === 'VERIFIED') ? 'VERIFIED' : 'PENDING',
    contractAddress: config.lineageAddress,
    explorerUrl: `https://testnet.snowtrace.io/address/${config.lineageAddress}`,
    lastCompleteAt: getState('lineageLastCompleteAt'),
    lastError: getState('lineageLastError'), analysts: records };
}
