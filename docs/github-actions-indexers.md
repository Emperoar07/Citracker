# Indexers Workflow Notes

This workflow is designed to make bounded forward progress on every run.

## Jobs

- `bootstrap`
  - installs dependencies with retry logic
  - bootstraps schema and tracked contracts once per workflow
- `bridge`
  - processes bounded bridge ranges
- `dex`
  - processes bounded DEX ranges and router transaction batches
- `fees`
  - backfills gas fees after bridge and DEX ingestion
- `prices`
  - backfills USD pricing after bridge, DEX, and fee ingestion

## Recommended GitHub Secrets

Required:

- `DATABASE_URL`
- `ETH_RPC_URL`
- `CITREA_RPC_URL`

Recommended core indexer controls:

- `START_BLOCK_ETH`
- `START_BLOCK_CITREA`
- `INDEXER_CHUNK_SIZE`
- `RPC_MAX_LOG_RANGE`
- `RPC_HEAD_BUFFER_BLOCKS`
- `INDEXER_MAX_RANGES_PER_STREAM`
- `INDEXER_MAX_PENDING_ITEMS`
- `PRICING_BATCH_SIZE`

Recommended DEX-specific controls:

- `DEX_INDEXER_MAX_RANGES_PER_STREAM`
- `DEX_INDEXER_MAX_PENDING_ITEMS`

Optional pricing controls:

- `COINGECKO_API_BASE`
- `COINGECKO_DEMO_API_KEY`

## Suggested Secret Values

Safe starting point:

- `INDEXER_CHUNK_SIZE=2000`
- `RPC_MAX_LOG_RANGE=1000`
- `RPC_HEAD_BUFFER_BLOCKS=4`
- `INDEXER_MAX_RANGES_PER_STREAM=20`
- `INDEXER_MAX_PENDING_ITEMS=500`
- `DEX_INDEXER_MAX_RANGES_PER_STREAM=8`
- `DEX_INDEXER_MAX_PENDING_ITEMS=200`
- `PRICING_BATCH_SIZE=500`

If DEX runs are still too long:

- reduce `DEX_INDEXER_MAX_RANGES_PER_STREAM`
- reduce `DEX_INDEXER_MAX_PENDING_ITEMS`

If progress is too slow but runs are stable:

- increase `DEX_INDEXER_MAX_RANGES_PER_STREAM` carefully
- increase `DEX_INDEXER_MAX_PENDING_ITEMS` carefully

## Health Check

Run locally:

```bash
npm run health:indexers
```

Or target one stream:

```bash
node scripts/indexerHealthCheck.js --stream=bridge
node scripts/indexerHealthCheck.js --stream=dex
node scripts/indexerHealthCheck.js --stream=fees
node scripts/indexerHealthCheck.js --stream=prices
```

Markdown output for workflow/job summaries:

```bash
node scripts/indexerHealthCheck.js --stream=dex --markdown
```
