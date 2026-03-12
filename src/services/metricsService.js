import { getPool } from "../db.js";
import { env } from "../config.js";

function intervalExpr(interval) {
  if (interval === "1h") return "hour";
  if (interval === "1w") return "week";
  return "day";
}

function walletNormalizedSwapCte(extraWhere = "") {
  return `
    WITH normalized_swaps AS (
      SELECT DISTINCT ON (ds.wallet_address, ds.tx_hash)
        ds.wallet_address,
        ds.chain_id,
        ds.dex_name,
        ds.tx_hash,
        ds.block_timestamp,
        ds.token_in_id,
        ds.token_out_id,
        ds.token_in_amount,
        ds.token_out_amount,
        ds.token_in_usd,
        ds.token_out_usd,
        ds.swap_volume_usd
      FROM dex_swaps ds
      LEFT JOIN tokens t_in ON t_in.id = ds.token_in_id
      LEFT JOIN tokens t_out ON t_out.id = ds.token_out_id
      WHERE ds.wallet_address = $1
        AND ds.block_timestamp BETWEEN $2 AND $3
        AND ds.status = 'confirmed'
        ${extraWhere}
      ORDER BY ds.wallet_address, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    )
  `;
}

export async function getWalletSummary(wallet, from, to) {
  const pool = getPool();

  const bridgeSql = `
    SELECT
      COUNT(*) AS bridge_tx_count,
      COALESCE(array_agg(DISTINCT protocol_name) FILTER (WHERE protocol_name IS NOT NULL), '{}') AS bridge_sources,
      COALESCE(SUM(CASE WHEN direction='inflow' THEN amount_usd END),0) AS inflow_usd,
      COALESCE(SUM(CASE WHEN direction='outflow' THEN amount_usd END),0) AS outflow_usd,
      COALESCE(SUM(amount_usd),0) AS volume_usd,
      COALESCE(SUM(CASE WHEN direction='inflow' THEN amount_usd ELSE -amount_usd END),0) AS netflow_usd
    FROM bridge_transfers
    WHERE wallet_address = $1
      AND block_timestamp BETWEEN $2 AND $3
      AND status = 'confirmed';
  `;

  const dexSql = `
    ${walletNormalizedSwapCte()}
    SELECT
      COUNT(*) AS swap_count,
      COALESCE(SUM(swap_volume_usd),0) AS dex_volume_usd
    FROM normalized_swaps;
  `;

  const gasSql = `
    SELECT
      COUNT(DISTINCT (chain_id, tx_hash)) AS gas_tx_count,
      COALESCE(SUM(CASE WHEN chain_id=$4 THEN fee_native END),0) AS gas_l1_native,
      COALESCE(SUM(CASE WHEN chain_id=$5 THEN fee_native END),0) AS gas_l2_native,
      COALESCE(SUM(fee_usd),0) AS gas_total_usd
    FROM tx_fees
    WHERE wallet_address = $1
      AND block_timestamp BETWEEN $2 AND $3;
  `;

  const txCountSql = `
    SELECT COUNT(DISTINCT tx_hash) AS citrea_total_tx_count
    FROM tx_fees
    WHERE wallet_address = $1
      AND chain_id = $4
      AND block_timestamp BETWEEN $2 AND $3;
  `;

  const topAppsSql = `
    WITH dex_usage AS (
      ${walletNormalizedSwapCte()}
      SELECT
        COALESCE(NULLIF(dex_name, ''), 'Unknown DEX') AS app,
        'dex' AS category,
        COUNT(*) AS tx_count,
        COALESCE(SUM(swap_volume_usd), 0) AS volume_usd
      FROM normalized_swaps
      GROUP BY 1, 2
    ),
    bridge_usage AS (
      SELECT
        COALESCE(NULLIF(protocol_name, ''), 'Unknown Bridge') AS app,
        'bridge' AS category,
        COUNT(*) AS tx_count,
        COALESCE(SUM(amount_usd), 0) AS volume_usd
      FROM bridge_transfers
      WHERE wallet_address = $1
        AND block_timestamp BETWEEN $2 AND $3
        AND status = 'confirmed'
      GROUP BY 1, 2
    ),
    combined AS (
      SELECT * FROM dex_usage
      UNION ALL
      SELECT * FROM bridge_usage
    )
    SELECT app, category, tx_count, volume_usd
    FROM combined
    ORDER BY tx_count DESC, volume_usd DESC, app ASC
    LIMIT 5;
  `;

  const [bridgeRes, dexRes, gasRes, txCountRes, topAppsRes] = await Promise.all([
    pool.query(bridgeSql, [wallet, from, to]),
    pool.query(dexSql, [wallet, from, to]),
    pool.query(gasSql, [wallet, from, to, env.ethChainId, env.citreaChainId]),
    pool.query(txCountSql, [wallet, from, to, env.citreaChainId]),
    pool.query(topAppsSql, [wallet, from, to])
  ]);

  const bridge = bridgeRes.rows[0] || {};
  const dex = dexRes.rows[0] || {};
  const gas = gasRes.rows[0] || {};
  const txc = txCountRes.rows[0] || {};

  const totalActivity = Number(bridge.volume_usd || 0) + Number(dex.dex_volume_usd || 0);

  return {
    wallet,
    range: { from, to },
    bridge_inflow_usd: bridge.inflow_usd,
    bridge_outflow_usd: bridge.outflow_usd,
    bridge_volume_usd: bridge.volume_usd,
    bridge_netflow_usd: bridge.netflow_usd,
    bridge_tx_count: bridge.bridge_tx_count,
    bridge_sources: Array.isArray(bridge.bridge_sources) ? bridge.bridge_sources : [],
    dex_swap_volume_usd: dex.dex_volume_usd,
    dex_swap_count: dex.swap_count,
    gas_tx_count: gas.gas_tx_count,
    gas_l1_native: gas.gas_l1_native,
    gas_l2_native: gas.gas_l2_native,
    gas_total_usd: gas.gas_total_usd,
    citrea_total_tx_count: txc.citrea_total_tx_count,
    usage_top_apps: topAppsRes.rows,
    total_activity_volume_usd: String(totalActivity)
  };
}

export async function getWalletTimeseries(wallet, from, to, interval = "1d") {
  const pool = getPool();
  const unit = intervalExpr(interval);

  const sql = `
    WITH bridge AS (
      SELECT
        date_trunc('${unit}', block_timestamp) AS ts,
        COALESCE(SUM(CASE WHEN direction='inflow' THEN amount_usd END),0) AS bridge_inflow_usd,
        COALESCE(SUM(CASE WHEN direction='outflow' THEN amount_usd END),0) AS bridge_outflow_usd,
        COALESCE(SUM(amount_usd),0) AS bridge_volume_usd,
        COALESCE(SUM(CASE WHEN direction='inflow' THEN amount_usd ELSE -amount_usd END),0) AS netflow_usd
      FROM bridge_transfers
      WHERE wallet_address = $1
        AND block_timestamp BETWEEN $2 AND $3
        AND status = 'confirmed'
      GROUP BY 1
    ),
    normalized_swaps AS (
      SELECT DISTINCT ON (ds.wallet_address, ds.tx_hash)
        ds.wallet_address,
        ds.tx_hash,
        ds.block_timestamp,
        ds.swap_volume_usd
      FROM dex_swaps ds
      WHERE ds.wallet_address = $1
        AND ds.block_timestamp BETWEEN $2 AND $3
        AND ds.status = 'confirmed'
      ORDER BY ds.wallet_address, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    ),
    dex AS (
      SELECT
        date_trunc('${unit}', block_timestamp) AS ts,
        COUNT(*) AS dex_swap_count,
        COALESCE(SUM(swap_volume_usd),0) AS dex_volume_usd
      FROM normalized_swaps
      GROUP BY 1
    ),
    gas AS (
      SELECT
        date_trunc('${unit}', block_timestamp) AS ts,
        COALESCE(SUM(fee_usd),0) AS gas_total_usd,
        COUNT(DISTINCT CASE WHEN chain_id = $4 THEN tx_hash END) AS citrea_tx_count
      FROM tx_fees
      WHERE wallet_address = $1
        AND block_timestamp BETWEEN $2 AND $3
      GROUP BY 1
    )
    SELECT
      COALESCE(b.ts, d.ts, g.ts) AS ts,
      COALESCE(b.bridge_inflow_usd,0) AS bridge_inflow_usd,
      COALESCE(b.bridge_outflow_usd,0) AS bridge_outflow_usd,
      COALESCE(b.bridge_volume_usd,0) AS bridge_volume_usd,
      COALESCE(b.netflow_usd,0) AS netflow_usd,
      COALESCE(d.dex_volume_usd,0) AS dex_volume_usd,
      COALESCE(d.dex_swap_count,0) AS dex_swap_count,
      COALESCE(g.gas_total_usd,0) AS gas_total_usd,
      COALESCE(g.citrea_tx_count,0) AS citrea_tx_count
    FROM bridge b
    FULL OUTER JOIN dex d ON d.ts = b.ts
    FULL OUTER JOIN gas g ON g.ts = COALESCE(b.ts, d.ts)
    ORDER BY ts;
  `;

  const result = await pool.query(sql, [wallet, from, to, env.citreaChainId]);
  return {
    wallet,
    range: { from, to },
    interval,
    points: result.rows
  };
}

export async function getWalletTransfers(wallet, from, to, direction, token, limit = 50) {
  const pool = getPool();
  const sql = `
    SELECT
      bt.direction,
      bt.protocol_name AS protocol,
      t.symbol AS token,
      bt.amount_decimal AS amount,
      bt.amount_usd,
      bt.source_chain_id,
      bt.destination_chain_id,
      bt.source_tx_hash,
      bt.destination_tx_hash,
      bt.block_timestamp
    FROM bridge_transfers bt
    LEFT JOIN tokens t ON t.id = bt.token_id
    WHERE bt.wallet_address = $1
      AND bt.block_timestamp BETWEEN $2 AND $3
      AND bt.status = 'confirmed'
      AND ($4::text IS NULL OR bt.direction = $4)
      AND ($5::text IS NULL OR t.symbol = $5)
    ORDER BY bt.block_timestamp DESC
    LIMIT $6;
  `;
  const result = await pool.query(sql, [wallet, from, to, direction || null, token || null, limit]);
  return { wallet, items: result.rows, next_cursor: null, total_count: result.rowCount };
}

export async function getWalletSwaps(wallet, from, to, dex, token, limit = 50) {
  const pool = getPool();
  const sql = `
    ${walletNormalizedSwapCte(`
        AND ($4::text IS NULL OR ds.dex_name = $4)
        AND ($5::text IS NULL OR t_in.symbol = $5 OR t_out.symbol = $5)
      `)}
    SELECT
      dex_name AS dex,
      t_in.symbol AS token_in,
      t_out.symbol AS token_out,
      token_in_amount,
      token_out_amount,
      swap_volume_usd,
      tx_hash,
      block_timestamp
    FROM normalized_swaps ns
    LEFT JOIN tokens t_in ON t_in.id = ns.token_in_id
    LEFT JOIN tokens t_out ON t_out.id = ns.token_out_id
    ORDER BY block_timestamp DESC
    LIMIT $6;
  `;
  const result = await pool.query(sql, [wallet, from, to, dex || null, token || null, limit]);
  return { wallet, items: result.rows, next_cursor: null, total_count: result.rowCount };
}

export async function getWalletGas(wallet, from, to, chain, category, limit = 50) {
  const pool = getPool();

  let chainId = null;
  if (chain === "l1") chainId = env.ethChainId;
  if (chain === "l2") chainId = env.citreaChainId;

  const cat = category && category !== "all" ? category : null;

  const sql = `
    SELECT
      chain_id,
      tx_hash,
      gas_used,
      effective_gas_price_wei,
      fee_native,
      fee_usd,
      tx_category,
      block_timestamp
    FROM tx_fees
    WHERE wallet_address = $1
      AND block_timestamp BETWEEN $2 AND $3
      AND ($4::bigint IS NULL OR chain_id = $4)
      AND ($5::text IS NULL OR tx_category = $5)
    ORDER BY block_timestamp DESC
    LIMIT $6;
  `;

  const result = await pool.query(sql, [wallet, from, to, chainId, cat, limit]);
  return { wallet, items: result.rows, next_cursor: null, total_count: result.rowCount };
}
