# Citracker Data Sources

This file separates Citrea-related data sources into production-integrated sources, tracked app-hub entries, UI-only references, and manual analytics references.

## Registry Semantics

- `status` answers whether a source is currently monitored in the registry or live-polled by the backend
- `coverage` answers whether the source contributes to runtime totals:
  - `metrics`: already reflected in wallet or network totals
  - `registry`: tracked in the source registry, but not yet counted in totals
  - `reference`: visible only for transparency
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
| Symbiosis | bridge app | Yes | ok | metrics | Citrea contracts and official chain API are pinned in `config/apps/symbiosis.json` |
| Atomiq | bridge app | No confirmed public API | tracked | registry | App-hub tracked route; not yet merged into totals |
| Stargate | bridge app | Public app surface | tracked | registry | App-hub tracked route; not yet merged into totals |
| Avail Nexus | bridge app | Public app surface | tracked | registry | App-hub tracked route; not yet merged into totals |
| Squid | bridge app | Public app surface | tracked | registry | App-hub tracked route; not yet merged into totals |
| Clementine | bridge tooling | Official docs | tracked | registry | Official Citrea bridge tooling reference from the app hub |
| Zentra | lending | Docs available | ok | metrics | Citrea pool/configurator contracts are pinned in `config/apps/zentra.json` |
| Accountable | yield | Docs available | tracked | registry | Vault app is tracked in the registry, not totals |
| Generic USD | stable asset app | Repo/app available | tracked | registry | Stable asset app is tracked in the registry, not totals |
| Signals | prediction market | Docs available | ok | metrics | Citrea MarketCore contract is pinned in `config/apps/signals.json` |
| Foresight | prediction market | Docs available | ok | metrics | Citrea launchpad contract is pinned in `config/apps/foresight.json` |
| Namoshi | consumer app | No confirmed public API | tracked | registry | App-hub tracked entry; contract/API mapping still needed |
| Omnihub | creator app | Public app surface | tracked | registry | App-hub tracked entry; contract/API mapping still needed |
| Rango Exchange | aggregator | Docs available | tracked | registry | App-hub tracked cross-chain aggregator, not yet merged into totals |
| DFX | fiat tooling | UI/docs available | tracked | registry | App-hub tracked fiat tooling, not yet merged into totals |

## BTC-Side Reference

| Source | Type | Public API | Purpose | URL |
|---|---|---:|---|---|
| mempool.space | btc api | Yes | BTC-side bridge context and fee environment | `https://mempool.space/` |

## Manual Analytics References

| Source | Why not runtime today | URL |
|---|---|---|
| Dune | Official API exists, but it is query-driven and requires a maintained Citrea query path; no production Citrea query was confirmed in this pass | `https://dune.com/` |
| Nansen | Dashboard product, auth-gated, and current official supported-chain docs did not confirm Citrea support for API/runtime use | `https://app.nansen.ai/macro/overview?chain=citrea&utm_source=twitter&utm_medium=social` |

## Current Runtime Rule

- Wallet counts and wallet activity: Citrea explorer first, indexed DB second
- Chain-wide totals: Citrea explorer + DefiLlama + indexed DB
- Pricing: CoinGecko plus safe symbol mapping
- JuiceSwap, Satsuma, and Fibrous are already reflected through tracked contracts and wallet/runtime logic
- The remaining Citrea app-hub entries are now tracked in the registry without backend code edits via the JSON registry plus sync script
- Symbiosis, Zentra, Signals, and Foresight now contribute to wallet totals through pinned Citrea contracts and app-specific fallback logic
- Bridge, fiat, creator, and remaining app-hub entries stay out of totals until their contracts or APIs are pinned
