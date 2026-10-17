import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { config } from '../config.js';

const abi = JSON.parse(readFileSync(resolve('backend/contracts/build/DarwinCommit.json'), 'utf8')).abi;
const transport = http(config.fujiRpc, { timeout: 15_000 });
export const publicClient = createPublicClient({ chain: avalancheFuji, transport });
function wallet() {
  if (!process.env.FUJI_PRIVATE_KEY) throw new Error('FUJI_PRIVATE_KEY is not set');
  return createWalletClient({ chain: avalancheFuji, transport,
    account: privateKeyToAccount(process.env.FUJI_PRIVATE_KEY) });
}
function address() {
  if (!config.contractAddress) throw new Error('FUJI_CONTRACT_ADDRESS is not set');
  return config.contractAddress;
}
export async function checkChainReady() {
  const account = wallet().account;
  const [chainId, code, balance] = await Promise.all([
    publicClient.getChainId(), publicClient.getBytecode({ address: address() }),
    publicClient.getBalance({ address: account.address }),
  ]);
  if (chainId !== 43113 || !code || code === '0x' || balance <= 0n)
    throw new Error('Funded Fuji signer and deployed contract are required');
  return { chainId, signer: account.address };
}
export function commitmentFor(payload) {
  const serialized = JSON.stringify(payload);
  return { serialized, commitment: keccak256(toHex(serialized)) };
}
export function chainRoundId(id) { return keccak256(toHex(id)); }
let sending = Promise.resolve();
let nextReservedNonce = null;
export function sendFujiContract(contractAddress, contractAbi, functionName, args) {
  const task = sending.then(async () => {
    if (await publicClient.getChainId() !== avalancheFuji.id) throw new Error('RPC is not Avalanche Fuji');
    const client = wallet();
    const remoteNonce = await publicClient.getTransactionCount({ address: client.account.address, blockTag: 'pending' });
    const nonce = Math.max(remoteNonce, nextReservedNonce ?? remoteNonce);
    const hash = await client.writeContract({ address: contractAddress, abi: contractAbi, functionName, args, nonce });
    nextReservedNonce = nonce + 1;
    return hash;
  });
  sending = task.catch(() => {});
  return task;
}
export function resetFujiNonceReservation() {
  const task = sending.then(() => { nextReservedNonce = null; });
  sending = task.catch(() => {});
  return task;
}
export async function sendCommitRound(id, payload) {
  const { commitment } = commitmentFor(payload);
  const roundId = chainRoundId(id);
  const hash = await sendFujiContract(address(), abi, 'commit', [roundId, commitment]);
  return { hash, commitment, roundId,
    explorerUrl: `https://testnet.snowtrace.io/tx/${hash}` };
}
export async function sendRevealRound(id, serialized) {
  const hash = await sendFujiContract(address(), abi, 'reveal', [chainRoundId(id), toHex(serialized)]);
  return { hash, explorerUrl: `https://testnet.snowtrace.io/tx/${hash}` };
}
export async function confirmTx(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`Fuji transaction reverted: ${hash}`);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  return { hash, blockNumber: receipt.blockNumber.toString(), blockTimeMs: Number(block.timestamp) * 1000,
    explorerUrl: `https://testnet.snowtrace.io/tx/${hash}` };
}
export async function getOnchainRecord(id) {
  if (!config.contractAddress) return null;
  const record = await publicClient.readContract({ address: address(), abi, functionName: 'records', args: [chainRoundId(id)] });
  return { commitment: record[0], revealed: record[1], author: record[2] };
}

export async function transactionState(hash) {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED';
  } catch (error) {
    if (error.name !== 'TransactionReceiptNotFoundError') throw error;
  }
  try { await publicClient.getTransaction({ hash }); return 'PENDING'; }
  catch (error) {
    if (error.name === 'TransactionNotFoundError') return 'MISSING';
    throw error;
  }
}

export async function findRoundTransaction(round, eventName) {
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
  let first;
  const savedBlock = eventName === 'Revealed' ? round.revealStartBlock : round.chainStartBlock;
  const knownBlock = eventName === 'Revealed' ? round.revealTx?.blockNumber : round.commitTx?.blockNumber;
  if (knownBlock) first = BigInt(knownBlock);
  else if (savedBlock) first = BigInt(savedBlock);
  else {
    // Legacy rounds did not store a starting block. Binary-search actual block
    // times instead of guessing Fuji's block interval or scanning from genesis.
    let lo = 0n, hi = latest;
    const since = Math.floor((eventName === 'Revealed' ? round.lastRevealAttemptAt || round.dueCandleEnd : round.createdAt) / 1000) - 120;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const block = await publicClient.getBlock({ blockNumber: mid });
      if (Number(block.timestamp) < since) lo = mid + 1n; else hi = mid;
    }
    first = lo;
  }
  // The public Fuji RPC restricts eth_getLogs to 100 blocks per request.
  for (let fromBlock = first; fromBlock <= latest; fromBlock += 100n) {
    const toBlock = fromBlock + 99n > latest ? latest : fromBlock + 99n;
    const logs = await publicClient.getContractEvents({ address: address(), abi, eventName,
      args: { roundId: chainRoundId(round.id) }, fromBlock, toBlock, strict: true });
    if (logs.length) return logs[0].transactionHash;
  }
  return null;
}
