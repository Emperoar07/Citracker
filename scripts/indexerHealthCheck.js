import { getPool, closePool } from "../src/db.js";

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function queryValue(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || {};
}

async function getBridgeStats(pool, dayStart) {
  const [counts, cursors, contracts] = await Promise.all([
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1)::int AS today_rows,
         COUNT(DISTINCT wallet_address)::int AS wallets
       FROM bridge_transfers`,
      [dayStart.toISOString()]
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS cursor_count,
         MAX(updated_at) AS last_cursor_update
       FROM indexer_cursors
       WHERE stream_key LIKE 'bridge:%'`
    ),
    queryValue(
      pool,
      `SELECT COUNT(*)::int AS active_contracts
       FROM tracked_bridge_contracts
       WHERE is_active = TRUE`
    )
  ]);

  return {
    activeContracts: Number(contracts.active_contracts || 0),
    totalRows: Number(counts.total_rows || 0),
    todayRows: Number(counts.today_rows || 0),
    walletCount: Number(counts.wallets || 0),
    cursorCount: Number(cursors.cursor_count || 0),
    lastCursorUpdate: cursors.last_cursor_update || null
  };
}

async function getDexStats(pool, dayStart) {
  const [counts, cursors, contracts] = await Promise.all([
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1)::int AS today_rows,
         COUNT(DISTINCT tx_hash) FILTER (WHERE block_timestamp >= $1)::int AS distinct_txs_today,
         COUNT(DISTINCT wallet_address) FILTER (WHERE block_timestamp >= $1)::int AS wallets_today
       FROM dex_swaps`,
      [dayStart.toISOString()]
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS cursor_count,
         MAX(updated_at) AS last_cursor_update
       FROM indexer_cursors
       WHERE stream_key LIKE 'dex-%'`
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_contracts,
         COUNT(*) FILTER (WHERE is_active = TRUE AND contract_role = 'factory')::int AS factories,
         COUNT(*) FILTER (WHERE is_active = TRUE AND contract_role IN ('pair', 'pool'))::int AS pools,
         COUNT(*) FILTER (WHERE is_active = TRUE AND contract_role = 'router')::int AS routers
       FROM tracked_dex_contracts`
    )
  ]);

  return {
    activeContracts: Number(contracts.active_contracts || 0),
    factories: Number(contracts.factories || 0),
    pools: Number(contracts.pools || 0),
    routers: Number(contracts.routers || 0),
    totalRows: Number(counts.total_rows || 0),
    todayRows: Number(counts.today_rows || 0),
    distinctTxsToday: Number(counts.distinct_txs_today || 0),
    walletsToday: Number(counts.wallets_today || 0),
    cursorCount: Number(cursors.cursor_count || 0),
    lastCursorUpdate: cursors.last_cursor_update || null
  };
}

async function getFeeStats(pool, dayStart) {
  const [counts, prices] = await Promise.all([
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1)::int AS today_rows,
         COUNT(*) FILTER (WHERE fee_usd IS NOT NULL)::int AS priced_rows
       FROM tx_fees`,
      [dayStart.toISOString()]
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*) FILTER (WHERE block_timestamp >= $1 AND fee_usd IS NOT NULL)::int AS today_priced_rows
       FROM tx_fees`,
      [dayStart.toISOString()]
    )
  ]);

  return {
    totalRows: Number(counts.total_rows || 0),
    todayRows: Number(counts.today_rows || 0),
    pricedRows: Number(counts.priced_rows || 0),
    todayPricedRows: Number(prices.today_priced_rows || 0)
  };
}

async function getPriceStats(pool) {
  const [bridge, dex, fees, snapshots] = await Promise.all([
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE amount_usd IS NOT NULL)::int AS priced_rows
       FROM bridge_transfers`
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE swap_volume_usd IS NOT NULL)::int AS priced_rows
       FROM dex_swaps`
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE fee_usd IS NOT NULL)::int AS priced_rows
       FROM tx_fees`
    ),
    queryValue(
      pool,
      `SELECT COUNT(*)::int AS snapshot_rows
       FROM token_prices_1m`
    )
  ]);

  return {
    bridgePricedRows: Number(bridge.priced_rows || 0),
    bridgeTotalRows: Number(bridge.total_rows || 0),
    dexPricedRows: Number(dex.priced_rows || 0),
    dexTotalRows: Number(dex.total_rows || 0),
    feePricedRows: Number(fees.priced_rows || 0),
    feeTotalRows: Number(fees.total_rows || 0),
    snapshotRows: Number(snapshots.snapshot_rows || 0)
  };
}

function toMarkdownSection(title, stats) {
  const lines = [`### ${title}`];
  for (const [key, value] of Object.entries(stats)) {
    lines.push(`- ${key}: ${value ?? "n/a"}`);
  }
  return lines.join("\n");
}

async function main() {
  const streamArg = process.argv.find((arg) => arg.startsWith("--stream="));
  const stream = (streamArg ? streamArg.split("=")[1] : "all").toLowerCase();
  const markdown = process.argv.includes("--markdown");
  const dayStart = startOfUtcDay();
  const pool = getPool();

  const sections = {};

  if (stream === "all" || stream === "bridge") {
    sections.bridge = await getBridgeStats(pool, dayStart);
  }
  if (stream === "all" || stream === "dex") {
    sections.dex = await getDexStats(pool, dayStart);
  }
  if (stream === "all" || stream === "fees") {
    sections.fees = await getFeeStats(pool, dayStart);
  }
  if (stream === "all" || stream === "prices") {
    sections.prices = await getPriceStats(pool);
  }

  if (markdown) {
    const output = Object.entries(sections)
      .map(([name, stats]) => toMarkdownSection(name, stats))
      .join("\n\n");
    console.log(output);
  } else {
    console.log(JSON.stringify(sections, null, 2));
  }

  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
