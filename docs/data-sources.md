# Citracker Data Sources

This file separates Citrea-related data sources into production-integrated sources, documented app-level sources, UI-only references, and manual analytics references.

## Source Policy

Use this order of trust:

1. Citrea official explorer and official docs
2. Direct RPC reads and Citracker's indexed Postgres data
3. DefiLlama and CoinGecko for cross-checks and pricing
4. App-level APIs such as Fibrous or Symbiosis only when the endpoint and semantics are confirmed
5. Dune and Nansen only as manual validation references unless a maintained Citrea query/API path is explicitly wired

## Production-Integrated Sources

| Source | Type | Official | Cadence | Purpose | URL |
|---|---|---:|---|---|---|
| Citrea Explorer API | official api | Yes | 5m | Wallet tx count, gas, token transfers, chain stats | `https://explorer.mainnet.citrea.xyz/api/v2` |
| Citrea Explorer Stats | official api | Yes | 5m | Total txs, users, gas prices, blocks | `https://explorer.mainnet.citrea.xyz/api/v2/stats` |
| DefiLlama Chains | secondary api | No | 5m | Citrea TVL cross-check | `https://api.llama.fi/v2/chains` |
| DefiLlama Protocol | secondary api | No | 5m | Bridge TVL and origin split | `https://api.llama.fi/protocol/citrea-bridge` |
| DefiLlama DEX overview | secondary api | No | 5m | Citrea-wide DEX volume cross-check | `https://api.llama.fi/overview/dexs/citrea` |
| Citracker Indexed DB | internal index | No | 5m | Indexed bridge flows, swaps, fee enrichment | local Postgres |
| CoinGecko | secondary api | No | on demand | Historical token and gas pricing | `https://api.coingecko.com/api/v3` |

## Official Citrea References

These are authoritative references, but not all of them are runtime APIs.

| Source | Type | API | Purpose | URL |
|---|---|---:|---|---|
| Citrea Docs | official docs | No | Chain metadata, canonical contracts, RPC docs | `https://docs.citrea.xyz/` |
| Citrea Main Site | official site | No | Product and ecosystem reference | `https://citrea.xyz/` |
| Citrea Bridge | official ui | No confirmed public API | Official bridge surface | `https://citrea.xyz/bridge` |
| Citrea App Hub | official ui | No confirmed public API | Official app discovery | `https://app.citrea.xyz/` |
| Citrea Batch Explorer | official ui | No confirmed public API | Bitcoin settlement/batch context | `https://citrea.xyz/batch-explorer?page=1&limit=10` |
| Citrea Origins | official ui | No confirmed public API | Origin/campaign reference | `https://origins.citrea.xyz/` |
| Citrea GitHub | official repo | N/A | Protocol/source verification | `https://github.com/chainwayxyz/citrea` |

## App-Level APIs And References

These are relevant because Citrea users route through them, but they should only drive runtime logic when the API contract is verified and the metric definition is clear.

| Source | Type | Public API | Current Use In Citracker | Notes |
|---|---|---:|---|---|
| Fibrous Docs | app docs | Yes, documented | Used as integration reference | Citrea router docs and aggregator model are confirmed |
| Fibrous API | app api | Documented | Not yet used as runtime truth | Base described as `https://api.fibrous.finance/citrea/{version}` in docs |
| Fibrous GitHub | app repo | N/A | Reference only | Useful for router/integration verification |
| JuiceSwap Contracts | app contracts | Yes, documented | Already tracked in the swap indexer | JuiceSwap V2/V3 routers and factories are part of current DEX tracking |
| JuiceSwap Docs | app docs | Yes | Reference only | Citrea-native DEX docs and contract references |
| Satsuma Exchange | app contracts | Docs/UI available | Already tracked in the swap indexer | Satsuma pools are discovered through the Citrea DEX indexer |
| Zentra Docs | app docs | Docs available | Not yet used as runtime truth | Lending and borrowing reference for Citrea money markets |
| Signals Protocol | app docs | Docs available | Not yet used as runtime truth | Prediction-market protocol reference tied to ctUSD flows |
| Foresight | app docs | Docs available | Not yet used as runtime truth | Citrea-supported prediction market app using ctUSD |
| Generic Money | app repo | N/A | Reference only | Useful for stable asset and protocol-repo verification |
| Accountable Capital | app docs | Docs available | Reference only | No confirmed Citrea runtime/API path was verified in this pass |
| Symbiosis App | app ui | No confirmed primary-source runtime contract in this pass | Reference only | Useful because Citrea users bridge through it |
| Symbiosis Chains API | app api | Yes | Not yet used as runtime truth | `https://api.symbiosis.finance/crosschain/v1/chains` responded successfully during verification |
| Namoshi | app ui | No confirmed public API | Reference only | No confirmed Citrea runtime/API path was verified in this pass |
| Rango Docs | aggregator docs | Docs available | Reference only | Cross-chain aggregator reference, not yet wired into tracker runtime |
| DFX Toolbox | fiat tooling | UI/docs only | Reference only | No confirmed Citrea runtime/API path was verified in this pass |

## BTC-Side Reference

| Source | Type | Public API | Purpose | URL |
|---|---|---:|---|---|
| mempool.space | btc api | Yes | BTC-side bridge context and fee environment | `https://mempool.space/` |

## Manual Analytics References

These should not be treated as runtime truth in the app today.

| Source | Why not runtime today | URL |
|---|---|---|
| Dune | Official API exists, but it is query-driven and requires a maintained Citrea query path; no production Citrea query was confirmed in this pass | `https://dune.com/` |
| Nansen | Dashboard product, auth-gated, and current official supported-chain docs did not confirm Citrea support for API/runtime use | `https://app.nansen.ai/macro/overview?chain=citrea&utm_source=twitter&utm_medium=social` |

## Current Runtime Rule

- Wallet counts and wallet activity: Citrea explorer first, indexed DB second
- Chain-wide totals: Citrea explorer + DefiLlama + indexed DB
- Pricing: CoinGecko plus safe symbol mapping
- Fibrous and Symbiosis: app-level sources to expand later, but not promoted to chain truth until endpoint semantics are pinned
- JuiceSwap and Satsuma: already reflected through tracked router/factory contracts and DEX indexing
- Lending, prediction, fiat, and unverified app surfaces: kept in the registry for discovery until their contracts or APIs are pinned
