import 'dotenv/config';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { config } from '../config.js';
import { publicClient, checkChainReady } from './index.js';

const { signer } = await checkChainReady();
const artifact = JSON.parse(readFileSync(resolve('backend/contracts/build/DarwinLineage.json'), 'utf8'));
if (process.env.FUJI_LINEAGE_ADDRESS) {
  const code = await publicClient.getBytecode({ address: process.env.FUJI_LINEAGE_ADDRESS });
  if (code && code !== '0x') {
    console.log(JSON.stringify({ status: 'ALREADY_DEPLOYED', address: process.env.FUJI_LINEAGE_ADDRESS }));
    process.exit(0);
  }
}
const account = privateKeyToAccount(process.env.FUJI_PRIVATE_KEY);
if (account.address !== signer) throw new Error('Unexpected signer');
const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(config.fujiRpc) });
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Lineage deployment not confirmed');
const envPath = resolve('.env');
const env = readFileSync(envPath, 'utf8');
const line = `FUJI_LINEAGE_ADDRESS=${receipt.contractAddress}`;
const updated = /^FUJI_LINEAGE_ADDRESS=/m.test(env)
  ? env.replace(/^FUJI_LINEAGE_ADDRESS=.*$/m, line)
  : `${env.trimEnd()}\n${line}\n`;
writeFileSync(envPath, updated, { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(JSON.stringify({ status: 'DEPLOYED', address: receipt.contractAddress, txHash: hash,
  explorerUrl: `https://testnet.snowtrace.io/tx/${hash}` }));
