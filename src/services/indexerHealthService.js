import { getPool } from "../db.js";

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function ageMinutes(timestamp) {
  if (!timestamp) return null;
  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return null;
  return (Date.now() - value) / 60000;
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

async function getPriceStats(pool, dayStart) {
  const [bridge, dex, fees, snapshots] = await Promise.all([
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE amount_usd IS NOT NULL)::int AS priced_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1)::int AS today_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1 AND amount_usd IS NOT NULL)::int AS today_priced_rows
       FROM bridge_transfers`,
      [dayStart.toISOString()]
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE swap_volume_usd IS NOT NULL)::int AS priced_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1)::int AS today_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1 AND swap_volume_usd IS NOT NULL)::int AS today_priced_rows
       FROM dex_swaps`,
      [dayStart.toISOString()]
    ),
    queryValue(
      pool,
      `SELECT
         COUNT(*)::int AS total_rows,
         COUNT(*) FILTER (WHERE fee_usd IS NOT NULL)::int AS priced_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1)::int AS today_rows,
         COUNT(*) FILTER (WHERE block_timestamp >= $1 AND fee_usd IS NOT NULL)::int AS today_priced_rows
       FROM tx_fees`,
      [dayStart.toISOString()]
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
    bridgeCoverage: percentage(Number(bridge.priced_rows || 0), Number(bridge.total_rows || 0)),
    bridgeTodayRows: Number(bridge.today_rows || 0),
    bridgeTodayPricedRows: Number(bridge.today_priced_rows || 0),
    bridgeTodayCoverage: percentage(Number(bridge.today_priced_rows || 0), Number(bridge.today_rows || 0)),
    dexPricedRows: Number(dex.priced_rows || 0),
    dexTotalRows: Number(dex.total_rows || 0),
    dexCoverage: percentage(Number(dex.priced_rows || 0), Number(dex.total_rows || 0)),
    dexTodayRows: Number(dex.today_rows || 0),
    dexTodayPricedRows: Number(dex.today_priced_rows || 0),
    dexTodayCoverage: percentage(Number(dex.today_priced_rows || 0), Number(dex.today_rows || 0)),
    feePricedRows: Number(fees.priced_rows || 0),
    feeTotalRows: Number(fees.total_rows || 0),
    feeCoverage: percentage(Number(fees.priced_rows || 0), Number(fees.total_rows || 0)),
    feeTodayRows: Number(fees.today_rows || 0),
    feeTodayPricedRows: Number(fees.today_priced_rows || 0),
    feeTodayCoverage: percentage(Number(fees.today_priced_rows || 0), Number(fees.today_rows || 0)),
    snapshotRows: Number(snapshots.snapshot_rows || 0)
  };
}

function coverageForThreshold(totalCoverage, todayCoverage, todayRows) {
  if (Number(todayRows || 0) > 0 && todayCoverage !== null) {
    return {
      scope: "today",
      coverage: todayCoverage
    };
  }

  return {
    scope: "all-time",
    coverage: totalCoverage
  };
}

export function buildHealthThresholds() {
  return {
    bridgeMaxCursorStalenessMinutes: envNumber("HEALTH_BRIDGE_MAX_CURSOR_STALENESS_MINUTES", 120),
    dexMaxCursorStalenessMinutes: envNumber("HEALTH_DEX_MAX_CURSOR_STALENESS_MINUTES", 120),
    minBridgeCursorCount: envNumber("HEALTH_MIN_BRIDGE_CURSOR_COUNT", 3),
    minDexCursorCount: envNumber("HEALTH_MIN_DEX_CURSOR_COUNT", 10),
    minBridgePriceCoverage: envNumber("HEALTH_MIN_BRIDGE_PRICE_COVERAGE", 0.008),
    minDexPriceCoverage: envNumber("HEALTH_MIN_DEX_PRICE_COVERAGE", 0.015),
    minFeePriceCoverage: envNumber("HEALTH_MIN_FEE_PRICE_COVERAGE", 0.8),
    minPriceSnapshots: envNumber("HEALTH_MIN_PRICE_SNAPSHOTS", 25)
  };
}

export function evaluateHealthThresholds(sections, thresholds) {
  const failures = [];
  const warnings = [];

  if (sections.bridge) {
    const stale = ageMinutes(sections.bridge.lastCursorUpdate);
    if (sections.bridge.activeContracts > 0 && sections.bridge.cursorCount < thresholds.minBridgeCursorCount) {
      failures.push(`bridge cursor count ${sections.bridge.cursorCount} is below minimum ${thresholds.minBridgeCursorCount}`);
    }
    if (sections.bridge.cursorCount > 0 && stale !== null && stale > thresholds.bridgeMaxCursorStalenessMinutes) {
      failures.push(
        `bridge cursor freshness is stale at ${stale.toFixed(1)} minutes, above ${thresholds.bridgeMaxCursorStalenessMinutes}`
      );
    }
  }

  if (sections.dex) {
    const stale = ageMinutes(sections.dex.lastCursorUpdate);
    if (sections.dex.activeContracts > 0 && sections.dex.cursorCount < thresholds.minDexCursorCount) {
      failures.push(`dex cursor count ${sections.dex.cursorCount} is below minimum ${thresholds.minDexCursorCount}`);
    }
    if (sections.dex.cursorCount > 0 && stale !== null && stale > thresholds.dexMaxCursorStalenessMinutes) {
      failures.push(`dex cursor freshness is stale at ${stale.toFixed(1)} minutes, above ${thresholds.dexMaxCursorStalenessMinutes}`);
    }
  }

  if (sections.prices) {
    const bridgeCoverage = coverageForThreshold(
      sections.prices.bridgeCoverage,
      sections.prices.bridgeTodayCoverage,
      sections.prices.bridgeTodayRows
    );
    const dexCoverage = coverageForThreshold(
      sections.prices.dexCoverage,
      sections.prices.dexTodayCoverage,
      sections.prices.dexTodayRows
    );
    const feeCoverage = coverageForThreshold(
      sections.prices.feeCoverage,
      sections.prices.feeTodayCoverage,
      sections.prices.feeTodayRows
    );

    if (sections.prices.snapshotRows < thresholds.minPriceSnapshots) {
      failures.push(`price snapshot rows ${sections.prices.snapshotRows} are below minimum ${thresholds.minPriceSnapshots}`);
    }
    if (bridgeCoverage.coverage !== null && bridgeCoverage.coverage < thresholds.minBridgePriceCoverage) {
      warnings.push(
        `bridge ${bridgeCoverage.scope} price coverage ${(bridgeCoverage.coverage * 100).toFixed(2)}% is below minimum ${(thresholds.minBridgePriceCoverage * 100).toFixed(2)}%`
      );
    }
    if (dexCoverage.coverage !== null && dexCoverage.coverage < thresholds.minDexPriceCoverage) {
      warnings.push(
        `dex ${dexCoverage.scope} price coverage ${(dexCoverage.coverage * 100).toFixed(2)}% is below minimum ${(thresholds.minDexPriceCoverage * 100).toFixed(2)}%`
      );
    }
    if (feeCoverage.coverage !== null && feeCoverage.coverage < thresholds.minFeePriceCoverage) {
      failures.push(
        `fee ${feeCoverage.scope} price coverage ${(feeCoverage.coverage * 100).toFixed(2)}% is below minimum ${(thresholds.minFeePriceCoverage * 100).toFixed(2)}%`
      );
    }
  }

  return { failures, warnings };
}

export function toHealthMarkdownSection(title, stats) {
  const lines = [`### ${title}`];
  for (const [key, value] of Object.entries(stats)) {
    lines.push(`- ${key}: ${value ?? "n/a"}`);
  }
  return lines.join("\n");
}

export async function getIndexerHealth({ stream = "all", enforceThresholds = false } = {}) {
  const pool = getPool();
  const dayStart = startOfUtcDay();
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
    sections.prices = await getPriceStats(pool, dayStart);
  }

  const thresholds = buildHealthThresholds();
  const evaluation = enforceThresholds ? evaluateHealthThresholds(sections, thresholds) : { failures: [], warnings: [] };

  return {
    checked_at: new Date().toISOString(),
    sections,
    ...(enforceThresholds
      ? {
          health: {
            status: evaluation.failures.length ? "fail" : "pass",
            thresholds,
            failures: evaluation.failures,
            warnings: evaluation.warnings
          }
        }
      : {})
  };
}
