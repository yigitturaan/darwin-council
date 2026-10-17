import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'dotenv';

const root = resolve(import.meta.dirname, '..');
const credentialsFile = resolve(root, '.env.okx');
const cli = resolve(root, 'node_modules/.bin/okx');
const execFileAsync = promisify(execFile);

export function okxCredentialsReady() {
  try {
    const values = parse(readFileSync(credentialsFile));
    return ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_PASSPHRASE'].every((key) => Boolean(values[key]));
  } catch { return false; }
}

function credentials() {
  const values = parse(readFileSync(credentialsFile));
  for (const key of ['OKX_API_KEY', 'OKX_SECRET_KEY', 'OKX_PASSPHRASE']) {
    if (!values[key]) throw new Error(`${key} henüz .env.okx dosyasına girilmedi`);
  }
  return values;
}

export async function privateAtk(args) {
  const values = credentials();
  try {
    const { stdout } = await execFileAsync(cli, ['--live', '--json', ...args], {
      cwd: root,
      env: {
        ...process.env,
        ...values,
        OKX_SITE: 'tr',
        OKX_API_BASE_URL: 'https://tr.okx.com',
      },
      timeout: 20_000,
      maxBuffer: 1_000_000,
    });
    return JSON.parse(stdout);
  } catch {
    throw new Error(`OKX TR ${args.slice(0, 2).join(' ')} çağrısı başarısız; anahtar, parola ve API yetkisini OKX ekranında kontrol et`);
  }
}

export const okxRows = (value) => Array.isArray(value) ? value : value?.data;

export async function verifiedSubaccount() {
  const config = okxRows(await privateAtk(['account', 'config']))?.[0];
  if (!config) throw new Error('OKX hesap yapılandırması boş');
  const permissions = String(config.perm ?? '').toLowerCase().split(/[;,\s]+/).filter(Boolean);
  if (permissions.length !== 2 || !permissions.includes('read_only') || !permissions.includes('trade'))
    throw new Error('OKX anahtarında yalnız Okuma + Al-Sat izinleri bekleniyor');
  if (String(config.type) !== '1')
    throw new Error('Anahtar standart alt hesaba ait görünmüyor (OKX type=1 bekleniyor)');
  return { type: 'standard subaccount', permission: config.perm };
}
