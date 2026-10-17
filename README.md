# Darwin Council

**A live council of AI market analysts that has to show its work.** Four specialists read OKX TR market data, make independent assessments, review one another's arguments, and reach a rule based decision. Their forecasts and trade assessments are committed to Avalanche Fuji before the outcome is known. Over time, a challenger analyst can earn a seat by outperforming an incumbent on future live rounds.

The product has two connected loops:

1. **Autonomous evaluation:** the council forecasts whether the next completed AVAX/USDT candle 30 minutes ahead will close higher. The result is checked against the real OKX TR candle, scored with the Brier rule, and revealed on Fuji. These rounds never place orders.
2. **On demand trade review:** a user asks whether to buy 5 USDT of AVAX now. The council votes **BUY, WAIT, or BLOCK** using fresh market data. A hard coded policy checks data freshness, spread, order book depth, price movement during review, and verified votes. A real OKX TR spot order is possible only when the user explicitly enables execution, the council returns BUY, and the separate order safeguards pass.

The current interface is in Turkish; this README documents the project in English.

## Why it exists

AI trading opinions are easy to generate and hard to audit. Darwin Council records what each analyst claimed, checks numerical claims against the market snapshot, locks forecasts before the answer is available, and measures performance after the fact. The system can also decline a trade. A small order amount alone never forces a BUY decision.

## What is live

- **Market:** the official OKX Agent Trade Kit CLI reads OKX TR ticker, candles, order book, and available derivatives context. Missing or stale sources are shown as such; they are not replaced with sample data.
- **Agents:** OpenAI model calls power four specialist roles: momentum, liquidity, relative market/derivatives, and volatility. Analysts first answer without seeing peers, then revise after seeing their verified initial views. Claims that fail the numerical verifier do not count toward consensus.
- **Chain:** Solidity contracts on Avalanche Fuji provide commit and reveal records for forecasts and trade assessments, plus analyst lineage and promotion or rejection events. A chain commitment proves that the committed bytes were fixed at that time; it does not prove a forecast was correct.
- **Evolution:** after enough resolved live rounds, a challenger is generated from an underperforming role. It is evaluated on six *future* paired rounds before a promotion or rejection. A challenger does not influence the council while on trial.
- **Dashboard:** a live council view shows the current assessment and agent explanations. A separate board shows the last decision, decision inputs, policy checks, round history, evolution, and system state.

No replayed market data, fabricated agent dialogue, or mock order fill is used in the live path. The dashboard runs on the same local server as the API.

## Architecture

```text
OKX TR Agent Trade Kit ──> market snapshot ──> four OpenAI analysts
                                                │ blind vote → peer review
                                                ▼
                                       claim verifier + policy
                                                │
                         ┌──────────────────────┴──────────────────────┐
                         ▼                                             ▼
             Avalanche Fuji commit/reveal                 optional OKX TR spot BUY
                         │                                 explicit user opt in only
                         ▼
              real outcome + Brier score
                         │
                         ▼
                 challenger evaluation
```

Node.js serves the API and frontend. SQLite stores rounds, events, recovery state, and trade intents. The browser polls live API endpoints. The autonomous scheduler initially uses 10 minute starts to collect enough evidence for the first Darwin decision, then switches to 30 minute starts. Every forecast still has a 30 minute horizon. Missed starts are not backfilled as historical predictions.

## Run locally

Tested with **Node.js 25.6.1**. The backend uses the built in `node:sqlite` module, so use a Node.js version that provides it.

```bash
npm ci
cp .env.example .env
npm run contract:compile
```

Add an OpenAI API key to `.env`. Create a dedicated Avalanche Fuji test wallet with `npm run wallet:create`, fund its public address with Fuji C-Chain test AVAX, then deploy both contracts:

```bash
npm run contract:deploy
npm run lineage:deploy
npm run backend
```

Open **http://127.0.0.1:8787/**. `npm run check:live` checks the running service and its current integrations. Deployment scripts write contract addresses into the local `.env` file. Restart the backend after changing environment values.

The market reader does not require an OKX API key. To display the connected subaccount balance or use real order execution, create a dedicated OKX TR **standard subaccount** API key with Read and Trade permissions. Put these three values in a local `.env.okx` file:

```dotenv
OKX_API_KEY=
OKX_SECRET_KEY=
OKX_PASSPHRASE=
```

Run `npm run account:check` to verify the account connection without placing an order. Real orders are disabled by default (`ENABLE_LIVE_ORDERS=false`). Enabling them does not start autonomous trading: the user must also check the execution box for an individual request and receive a BUY decision. The implementation caps the request at **5 USDT**, blocks another real order for 24 hours, rechecks market data and balance before submission, and does not blindly retry an uncertain order response. No withdrawal permission is needed.

Starting the autonomous backend uses real OpenAI API calls and Fuji testnet transactions. Keep enough API credit and test AVAX available if you leave it running.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run smoke:market` | Read a live OKX TR market snapshot |
| `npm run smoke:model` | Check a real OpenAI model call |
| `npm run smoke:fuji` | Check Fuji wallet, RPC, and contract connectivity |
| `npm run check:live` | Check the running API and integrations |
| `npm run audit:round -- <round-id>` | Independently verify a round against OKX TR and Fuji |
| `npm run audit:lineage` | Verify analyst lineage transactions on Fuji |
| `npm run db:backup` | Create and check a consistent local SQLite backup |

See [backend/API.md](backend/API.md) for endpoint details and [backend/README.md](backend/README.md) for deeper implementation and recovery notes.

## Boundaries

- Short horizon direction forecasts are noisy. A few rounds or a low Brier score do not establish profitable trading ability.
- The chain records commitments and lineage; OKX spot trades, when enabled, happen on OKX TR, not on Avalanche.
- This build binds to `127.0.0.1` and is intended for local demonstration. It is not an internet facing trading service.
- `.env`, `.env.okx`, SQLite data, contract build output, and local design/research notes are excluded from Git. Never commit API credentials or a Fuji private key.

The repository is a working hackathon prototype. Market access, OpenAI credit, Fuji RPC, and test AVAX are required for a complete live run.
