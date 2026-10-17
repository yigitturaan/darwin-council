import { privateAtk, okxRows, verifiedSubaccount } from './okx-private.js';
const amount = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
  ? Number(value) : null;

async function main() {
  const account = await verifiedSubaccount();
  const trading = okxRows(await privateAtk(['account', 'balance', 'USDT']))?.[0]?.details ?? [];
  const funding = okxRows(await privateAtk(['account', 'asset-balance', '--ccy', 'USDT'])) ?? [];
  const tradeUsdt = trading.find((row) => row.ccy === 'USDT');
  const fundUsdt = funding.find((row) => row.ccy === 'USDT');
  console.log(JSON.stringify({
    ok: true,
    site: 'OKX TR',
    account: account.type,
    permission: account.permission,
    tradingUsdt: { total: amount(tradeUsdt?.eq), available: amount(tradeUsdt?.availBal ?? tradeUsdt?.availEq) },
    fundingUsdt: { total: amount(fundUsdt?.bal), available: amount(fundUsdt?.availBal) },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
