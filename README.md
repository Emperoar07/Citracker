# Citracker

One-page Citrea mainnet dashboard with two independent halves:
- Left: wallet tracker driven only by pasted wallet address.
- Right: permanent Citrea mainnet panel with live chain metrics.

No wallet connection is required.

## Metrics (exact)
- Bridge Inflow: tokens moved from Ethereum to Citrea for wallet.
- Bridge Outflow: tokens moved from Citrea to Ethereum for wallet.
- Bridge Volume: `inflow + outflow`.
- Netflow: `inflow - outflow`.
- Gas spent: L1 + L2 (separate and combined).
- DEX swap volume: all tracked Citrea DEX swaps for wallet.
- Citrea total tx count: count of wallet txs recorded on Citrea.
- Total activity volume: `bridge volume + dex swap volume` (USD).

## Chain-wide live panel
- Total inflow and outflow for Citrea from indexed bridge data.
- Total users and total transactions from Citrea mainnet explorer stats.
- Citrea TVL from DefiLlama chain data.
- Bridged amount split by Bitcoin-origin and EVM-origin from DefiLlama Citrea Bridge data.
- Total token spend on Citrea and spend per token from indexed DEX input totals.
- Automatic refresh that does not alter wallet state.

## Live index coverage
- Canonical Ethereum bridge contracts for USDC, USDT, and WBTC deposits into Citrea.
- Citrea LayerZero OFT bridge contracts for wallet-level inflow/outflow on Citrea mainnet.
- Citrea Bitcoin system bridge for BTC-origin wallet inflow/outflow.
- DEX factory discovery for Juiceswap V2, Juiceswap V3, and Satsuma Algebra pools.
- Fibrous router tracking is configured so routed swaps can be recognized, while execution is still attributed from the pool-side swap logs.
- Bridge and DEX indexers use persistent cursors in `indexer_cursors` and backfill from `START_BLOCK_*` to chain head.

## Project structure
- `db/schema.sql`: PostgreSQL schema.
- `src/server.js`: Express server + static frontend hosting.
- `src/api/routes.js`: wallet endpoints.
- `src/services/metricsService.js`: SQL metric queries.
- `src/services/explorerService.js`: optional Etherscan/Citreascan wallet tx enrichment.
- `src/services/networkService.js`: chain-wide Citrea mainnet aggregation.
- `src/indexers/*`: bridge, dex, and fee indexer workers.
- `api/[...path].js`: Vercel serverless API entrypoint.
- `public/*`: one-page frontend.
- `scripts/bootstrapLiveDb.js`: schema apply + live contract bootstrap.
- `scripts/seedSampleData.js`: optional sample data utility.

## Setup
1. Copy env:
```bash
cp .env.example .env
```
2. Install dependencies:
```bash
npm install
```
3. Set `DATABASE_URL`.
4. Bootstrap live schema and contract registry:
```bash
npm run db:bootstrap
```
5. Optional: seed sample data for local testing:
```bash
npm run seed:sample
```
6. Run app:
```bash
npm run dev
```
7. Run indexers:
```bash
npm run indexer:bridge
npm run indexer:dex
npm run indexer:fees
```

## Optional explorer enrichment
You can enhance wallet tx counting via explorer APIs:
- `ENABLE_EXPLORER_ENRICHMENT=true`
- `ETHERSCAN_API_KEY=...`
- `ETHERSCAN_API_URL=https://api.etherscan.io/api`
- `CITREASCAN_API_URL=https://explorer.mainnet.citrea.xyz/api/v2`
- `CITREASCAN_API_KEY=...`

If enabled, `summary` includes explorer counts and uses `citrea_tx_count` from explorer when available.

## Live network sources
- Citrea mainnet explorer stats: `https://explorer.mainnet.citrea.xyz/api/v2/stats`
- DefiLlama chains: `https://api.llama.fi/v2/chains`
- DefiLlama Citrea Bridge: `https://api.llama.fi/protocol/citrea-bridge`
- DefiLlama Citrea DEX overview: `https://api.llama.fi/overview/dexs/Citrea`

## API
- `GET /api/v1/wallet/:wallet/summary?from=...&to=...`
- `GET /api/v1/wallet/:wallet/timeseries?from=...&to=...&interval=1d`
- `GET /api/v1/wallet/:wallet/transfers?from=...&to=...`
- `GET /api/v1/wallet/:wallet/swaps?from=...&to=...`
- `GET /api/v1/wallet/:wallet/gas?from=...&to=...`
- `GET /api/v1/network/summary`

All endpoints are wallet-input only; there is no wallet connect flow.
