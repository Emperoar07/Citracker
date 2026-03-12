# Citracker Data Sources

This file separates Citrea-related data sources into production-integrated sources, tracked app-hub entries, UI-only references, and manual analytics references.

## Registry Semantics

- `status` answers whether a source is currently monitored in the registry or live-polled by the backend
- `coverage` answers whether the source contributes to runtime totals:
  - `metrics`: already reflected in wallet or network totals
  - `registry`: tracked in the source registry, but not yet counted in totals
  - `reference`: visible only for transparency
- `scope` answers what kind of metric integration is actually in place:
  - `wallet metrics`: contributes to wallet or indexed bridge totals
  - `source health only`: treated as a live Citrea source surface in the registry, but not counted in wallet totals
- `confidence` answers how much trust to assign:
  - `official truth`
  - `derived index`
  - `secondary cross-check`
  - `registry tracked`
  - `reference only`

## Source Policy

Use this order of trust:

1. Citrea official explorer and official docs
2. Direct RPC reads and Citracker's indexed Postgres data
3. DefiLlama and CoinGecko for cross-checks and pricing
4. Citrea app-hub tracked apps, once their contracts or APIs are pinned
5. Dune and Nansen only as manual validation references unless a maintained Citrea query/API path is explicitly wired

## Production-Integrated Sources

| Source | Type | Official | Cadence | Coverage | Confidence | URL |
|---|---|---:|---|---|---|---|
| Citrea Explorer API | official api | Yes | 5m | metrics | official truth | `https://explorer.mainnet.citrea.xyz/api/v2` |
| Citrea Explorer Stats | official api | Yes | 5m | metrics | official truth | `https://explorer.mainnet.citrea.xyz/api/v2/stats` |
| Citracker Indexed DB | internal index | No | 5m | metrics | derived index | local Postgres |
| DefiLlama Chains | secondary api | No | 5m | metrics | secondary cross-check | `https://api.llama.fi/v2/chains` |
| DefiLlama Protocol | secondary api | No | 5m | metrics | secondary cross-check | `https://api.llama.fi/protocol/citrea-bridge` |
| DefiLlama DEX overview | secondary api | No | 5m | metrics | secondary cross-check | `https://api.llama.fi/overview/dexs/citrea` |
| CoinGecko | secondary api | No | on demand | metrics | secondary cross-check | `https://api.coingecko.com/api/v3` |

## Official Citrea References

| Source | Type | Coverage | Confidence | URL |
|---|---|---|---|---|
| Citrea Docs | official docs | reference | official truth | `https://docs.citrea.xyz/` |
| Citrea Main Site | official site | reference | official truth | `https://citrea.xyz/` |
| Citrea Bridge | official ui | reference | official truth | `https://citrea.xyz/bridge` |
| Citrea App Hub | official ui | reference | official truth | `https://app.citrea.xyz/` |
| Citrea Batch Explorer | official ui | reference | official truth | `https://citrea.xyz/batch-explorer?page=1&limit=10` |
| Citrea Origins | official ui | reference | official truth | `https://origins.citrea.xyz/` |
| Citrea GitHub | official repo | reference | official truth | `https://github.com/chainwayxyz/citrea` |

## Citrea App Registry

The app registry now lives in `config/citrea-app-registry.json` and can be refreshed from the Citrea app hub with:

```bash
npm run sync:citrea-apps
```

That sync updates app names and URLs without changing backend code.

Pinned per-app metrics configs now live under `config/apps/` for apps that have graduated from registry-only tracking into wallet metrics.

## Tracked Citrea Apps

| Source | Type | Public API | Status | Coverage | Notes |
|---|---|---:|---|---|---|
| Fibrous | aggregator | Docs available | tracked | metrics | Router is already used in wallet fallback and DEX tracking |
| Juice Swap | dex | Docs available | tracked | metrics | Routers and factories are already indexed |
| Satsuma | dex | Docs/UI available | tracked | metrics | Factory-driven pool discovery is already indexed |
| Symbiosis | bridge app | Yes | ok | metrics | `wallet metrics` via `config/apps/symbiosis.json` |
| Atomiq | bridge app | Public app surface | ok | metrics | `source health only` via `config/apps/atomiq.json` |
| Stargate | bridge app | Public app surface | ok | metrics | `source health only` via `config/apps/stargate.json` |
| Avail Nexus | bridge app | Public app surface | ok | metrics | `source health only` via `config/apps/avail_nexus.json` |
| Squid | bridge app | Public app surface | ok | metrics | `source health only` via `config/apps/squid.json` |
| Clementine | bridge tooling | Official docs | ok | metrics | `wallet metrics` via indexed official bridge contracts in `config/apps/clementine.json` |
| Zentra | lending | Docs available | ok | metrics | `wallet metrics` via `config/apps/zentra.json` |
| Accountable | yield | Docs available | ok | metrics | `wallet metrics` via `config/apps/accountable.json` |
| Generic USD | stable asset app | Repo/app available | ok | metrics | `wallet metrics` via `config/apps/generic_usd.json` |
| Signals | prediction market | Docs available | ok | metrics | `wallet metrics` via `config/apps/signals.json` |
| Foresight | prediction market | Docs available | ok | metrics | `wallet metrics` via `config/apps/foresight.json` |
| Namoshi | consumer app | Public app surface | ok | metrics | `source health only` via `config/apps/namoshi.json` |
| Omnihub | creator app | Public app surface | ok | metrics | `source health only` via `config/apps/omnihub.json` |
| Rango Exchange | aggregator | Docs available | ok | metrics | `source health only` via `config/apps/rango_exchange.json` |
| DFX | fiat tooling | UI/docs available | ok | metrics | `source health only` via `config/apps/dfx.json` |

## BTC-Side Reference

| Source | Type | Public API | Purpose | URL |
|---|---|---:|---|---|
| mempool.space | btc api | Yes | BTC-side bridge context and fee environment | `https://mempool.space/` |

## Manual Analytics References

| Source | Why not runtime today | URL |
|---|---|---|
| Dune | Supported only as a pinned-query cross-check. It never overrides official explorer or indexed totals. | `https://dune.com/` |
| Nansen | Citrea macro dashboard exists, but the official API currently rejects `citrea` as an unsupported chain value. Keep it as a manual cross-check until Nansen adds public Citrea API support. | `https://app.nansen.ai/macro/overview?chain=citrea&utm_source=twitter&utm_medium=social` |

## Dune Status

- `DUNE_API_KEY` plus pinned Citrea query IDs can be configured privately.
- Supported query slots:
  - `DUNE_QUERY_ID_CITREA_ACTIVITY`
  - `DUNE_QUERY_ID_CITREA_FEES`
  - `DUNE_QUERY_ID_CITREA_DEX`
- Citracker exposes Dune results under `reference_probes.dune` when those query IDs are configured.
- Dune remains a cross-check only and never becomes runtime truth.

## Nansen Status

- `NANSEN_API_KEY` is supported in local/Vercel private env configuration and is intentionally not stored in git.
- Citracker exposes Nansen in the source registry as a configured reference source when the key is present.
- Citracker does not use Nansen for Citrea runtime metrics yet.
- On `2026-03-12`, a live probe against the official Nansen API returned `422 Invalid value 'citrea'` for:
  - `POST /api/v1/token-screener`
  - `POST /api/v1/smart-money/dex-trades`
  - `POST /api/v1/tgm/holders`
- This means the macro dashboard can be used for manual comparison, but not as production truth in this app until Nansen's public API adds Citrea support.

Manual probe command:

```bash
npm run probe:nansen
```

## Current Runtime Rule

- Wallet counts and wallet activity: Citrea explorer first, indexed DB second
- Chain-wide totals: Citrea explorer + DefiLlama + indexed DB
- Pricing: CoinGecko plus safe symbol mapping
- JuiceSwap, Satsuma, and Fibrous are already reflected through tracked contracts and wallet/runtime logic
- Every currently tracked Citrea app-hub entry now has a `config/apps/*.json` definition
- Symbiosis, Zentra, Signals, Foresight, Accountable, Clementine, and Generic USD contribute to wallet totals through pinned Citrea contracts or indexed bridge surfaces
- Atomiq, Avail Nexus, DFX, Namoshi, Omnihub, Rango Exchange, Squid, and Stargate are integrated as `source health only` metrics until a stable public Citrea wallet contract map is pinned
