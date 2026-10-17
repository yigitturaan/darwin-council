import 'dotenv/config';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { config } from '../config.js';

if (!process.env.FUJI_PRIVATE_KEY) throw new Error('Set FUJI_PRIVATE_KEY in local .env first');
const artifact = JSON.parse(readFileSync(resolve('backend/contracts/build/DarwinCommit.json'), 'utf8'));
const account = privateKeyToAccount(process.env.FUJI_PRIVATE_KEY);
const transport = http(config.fujiRpc);
const publicClient = createPublicClient({ chain: avalancheFuji, transport });
const walletClient = createWalletClient({ account, chain: avalancheFuji, transport });
if (config.contractAddress) {
  const code = await publicClient.getBytecode({ address: config.contractAddress });
  if (code && code !== '0x') {
    console.log(JSON.stringify({ status: 'ALREADY_DEPLOYED', address: config.contractAddress }, null, 2));
    process.exit(0);
  }
}
const balance = await publicClient.getBalance({ address: account.address });
if (balance === 0n) throw new Error(`Fuji test wallet ${account.address} has no test AVAX`);
const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode });
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
const envPath = resolve('.env');
const env = readFileSync(envPath, 'utf8');
const updated = /^FUJI_CONTRACT_ADDRESS=/m.test(env)
  ? env.replace(/^FUJI_CONTRACT_ADDRESS=.*$/m, `FUJI_CONTRACT_ADDRESS=${receipt.contractAddress}`)
  : `${env.trimEnd()}\nFUJI_CONTRACT_ADDRESS=${receipt.contractAddress}\n`;
writeFileSync(envPath, updated, { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(JSON.stringify({ address: receipt.contractAddress, txHash: hash,
  explorerUrl: `https://testnet.snowtrace.io/tx/${hash}`, savedTo: '.env' }, null, 2));
