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

Strict local health check with thresholds:

```bash
npm run health:indexers:strict
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

## Thresholds

The health script can enforce thresholds and exit non-zero.

Default thresholds:

- `HEALTH_BRIDGE_MAX_CURSOR_STALENESS_MINUTES=120`
- `HEALTH_DEX_MAX_CURSOR_STALENESS_MINUTES=120`
- `HEALTH_MIN_BRIDGE_CURSOR_COUNT=3`
- `HEALTH_MIN_DEX_CURSOR_COUNT=10`
- `HEALTH_MIN_BRIDGE_PRICE_COVERAGE=0.008`
- `HEALTH_MIN_DEX_PRICE_COVERAGE=0.015`
- `HEALTH_MIN_FEE_PRICE_COVERAGE=0.80`
- `HEALTH_MIN_PRICE_SNAPSHOTS=25`

You can override these in GitHub Actions repository variables for the `Indexer Health` workflow.

## Scheduled Health Workflow

The `Indexer Health` workflow runs separately from the ingestion workflow.

It does three things:

- writes a markdown health summary to the workflow run
- fails the workflow when thresholds are violated
- creates or updates a GitHub issue labeled `indexer-health-alert`

When health recovers, the workflow closes the open alert issue automatically.
