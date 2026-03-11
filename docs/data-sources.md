# Citrea Data Sources

This file ranks the data sources currently relevant to `Citracker` by practical usefulness, not by brand recognition.

## Summary

| Source | Official | Free | Public API | Good for Wallet Volume | Good for Network Volume | Notes |
|---|---|---:|---:|---:|---:|---|
| Citrea Blockscout | Yes | Yes | Yes | Yes | Yes | Best primary source for wallet txs, gas, token metadata, token transfers, chain stats |
| Citrea Docs | Yes | Yes | No | No | Indirectly | Best source for chain metadata, contracts, RPCs |
| Citrea Batch Explorer | Yes | Yes | No clear public API confirmed | No | Partial | Useful reference for batch-level context |
| mempool.space | No (Citrea) | Yes | Yes | BTC-side only | BTC-side only | Useful for Bitcoin bridge context and BTC mempool state |
| CoinGecko | No (Citrea) | Yes | Yes | Pricing only | Pricing only | Best free historical price source currently integrated |
| Dune | No (Citrea official source) | Partial | Yes | Maybe | Maybe | Useful only if Citrea support/query coverage is confirmed per dashboard/query |
| Nansen | No (Citrea official source) | No for API | Auth-gated | Maybe | Maybe | Useful as a dashboard reference; not a dependable free Citrea API source |
| public-apis/public-apis | No | Yes | Directory only | Discovery only | Discovery only | Good for finding candidate APIs, not as a runtime source |

## Recommended Runtime Sources

### 1. Citrea Blockscout

Use as the primary live data source.

Relevant endpoints and pages:

- Explorer: `https://explorer.mainnet.citrea.xyz/`
- Stats: `https://explorer.mainnet.citrea.xyz/stats`
- API docs: `https://explorer.mainnet.citrea.xyz/api-docs`
- Tokens: `https://explorer.mainnet.citrea.xyz/tokens`
- Token transfers: `https://explorer.mainnet.citrea.xyz/token-transfers`

Use cases:

- Wallet tx count
- Wallet tx history
- Gas fee extraction
- Token metadata fallback
- Chain-wide stats
- Token transfer validation

### 2. Citrea Official Docs

- Docs: `https://docs.citrea.xyz/`
- Site: `https://citrea.xyz/`
- Origins: `https://origins.citrea.xyz/`
- Repo: `https://github.com/chainwayxyz/citrea`

Use cases:

- Canonical bridge addresses
- RPC/documentation verification
- Architecture and protocol references
- Contract lists and network metadata

### 3. CoinGecko

Use as the default historical pricing source.

Current use in `Citracker`:

- stablecoins via static safe mapping
- BTC-like assets via CoinGecko `bitcoin`
- ETH-like assets via CoinGecko `ethereum`

Constraint:

- Public tier rate limits can return `429`

### 4. mempool.space

- `https://mempool.space/`

Use cases:

- BTC-side bridge context
- Bitcoin fee environment
- Bitcoin tx inspection around bridge deposits/withdrawals

## Reference-Only Sources

### Dune

Dune may become useful for cross-check dashboards and custom SQL, but it should not be treated as a trusted Citrea runtime dependency until Citrea support/query coverage is verified per query/dashboard.

Why not primary right now:

- Citrea chain support was not confirmed from official Dune docs during this pass.
- Public dashboards can exist without stable official API coverage for the exact metrics we need.
- Query results can depend on community-maintained logic rather than protocol-owned definitions.

Recommended use:

- manual cross-checking
- analyst dashboards
- later optional integration if a specific Citrea query is identified and maintained

### Nansen

- `https://app.nansen.ai/macro/overview?chain=citrea&utm_source=twitter&utm_medium=social`

Why not primary right now:

- Auth-gated product
- Not a free public API source
- Citrea support was not confirmed as a documented stable API integration target in this pass

Recommended use:

- manual dashboard reference
- sanity-check against macro trends only

## Useful Free API Candidates Discovered Via `public-apis/public-apis`

These are discovery candidates, not direct replacements for Citrea-native data:

- CoinGecko: historical and spot pricing
- Etherscan-like explorers: useful pattern, but Citrea already has its own Blockscout explorer
- Blockchair: cross-chain reference data, useful for secondary validation
- mempool.space: best free BTC-side operational source for this project

## Current Policy For `Citracker`

Use this order of trust:

1. Citrea official docs and official explorer
2. Direct RPC reads and indexed database results
3. CoinGecko for historical pricing
4. mempool.space for BTC-side context
5. Dune and Nansen only as secondary validation references
