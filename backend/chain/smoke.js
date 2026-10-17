import 'dotenv/config';
import { privateKeyToAccount } from 'viem/accounts';
import { publicClient } from './index.js';

const blockNumber = await publicClient.getBlockNumber();
const result = { mode: 'live', status: 'OK', chainId: await publicClient.getChainId(),
  blockNumber: blockNumber.toString(), observedAt: Date.now() };
if (process.env.FUJI_PRIVATE_KEY) {
  const address = privateKeyToAccount(process.env.FUJI_PRIVATE_KEY).address;
  result.address = address;
  result.balanceAvax = Number(await publicClient.getBalance({ address })) / 1e18;
}
console.log(JSON.stringify(result, null, 2));
