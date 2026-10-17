import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const path = resolve('.env');
const existing = existsSync(path) ? readFileSync(path, 'utf8') : readFileSync(resolve('.env.example'), 'utf8');
const line = existing.match(/^FUJI_PRIVATE_KEY=(.*)$/m);
if (line?.[1]?.trim()) {
  console.log(`Existing Fuji test wallet: ${privateKeyToAccount(line[1].trim()).address}`);
  process.exit(0);
}
const key = generatePrivateKey();
const next = line ? existing.replace(/^FUJI_PRIVATE_KEY=.*$/m, `FUJI_PRIVATE_KEY=${key}`)
  : `${existing.trimEnd()}\nFUJI_PRIVATE_KEY=${key}\n`;
writeFileSync(path, next, { mode: 0o600 });
chmodSync(path, 0o600);
console.log(`Created dedicated Fuji test wallet: ${privateKeyToAccount(key).address}`);
console.log('Private key saved only in local .env; do not share it.');
