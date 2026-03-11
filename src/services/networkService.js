import { env } from "../config.js";
import { getPool } from "../db.js";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getDefillamaChainTvl() {
  const data = await fetchJson(`${env.defillamaApiBase}/v2/chains`);
  const chains = Array.isArray(data) ? data : data?.value;
  const match = Array.isArray(chains)
    ? chains.find((item) => String(item?.name || "").toLowerCase() === env.defillamaChainName.toLowerCase())
    : null;

  return {
    chain_tvl_usd: toNumber(match?.tvl),
    chain_id: match?.chainId ?? env.citreaChainId
  };
}

async function getDefillamaBridgeStats() {
  const data = await fetchJson(`${env.defillamaApiBase}/protocol/${env.defillamaBridgeProtocol}`);
  const currentChainTvls = data?.currentChainTvls || {};
  const bridgeTotal = Object.values(currentChainTvls).reduce((sum, value) => sum + toNumber(value), 0);
  const btcOrigin = toNumber(currentChainTvls.Bitcoin);
  const evmOrigin = Object.entries(currentChainTvls).reduce((sum, [chain, value]) => {
    if (chain.toLowerCase() === "bitcoin") return sum;
    return sum + toNumber(value);
  }, 0);

  return {
    bridge_total_usd: bridgeTotal,
    bridge_from_btc_usd: btcOrigin,
    bridge_from_evm_usd: evmOrigin
  };
}

async function getDefillamaDexStats() {
  const url = `${env.defillamaApiBase}/overview/dexs/${encodeURIComponent(env.defillamaChainName.toLowerCase())}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
  const data = await fetchJson(url);
  return {
    dex_volume_24h_usd: toNumber(data?.total24h),
    dex_volume_7d_usd: toNumber(data?.total7d),
    dex_volume_30d_usd: toNumber(data?.total30d),
    dex_volume_all_time_usd: toNumber(data?.totalAllTime)
  };
}

async function getCitreascanNetworkStats() {
  const data = await fetchJson(env.citreascanStatsUrl);
  return {
    total_users: toNumber(data?.total_addresses),
    total_transactions: toNumber(data?.total_transactions),
    transactions_today: toNumber(data?.transactions_today),
    total_blocks: toNumber(data?.total_blocks),
    average_block_time_ms: toNumber(data?.average_block_time),
    network_utilization_percentage: toNumber(data?.network_utilization_percentage),
    gas_price_updated_at: data?.gas_price_updated_at || null,
    gas_used_today: toNumber(data?.gas_used_today),
    gas_prices: {
      slow: toNumber(data?.gas_prices?.slow),
      average: toNumber(data?.gas_prices?.average),
      fast: toNumber(data?.gas_prices?.fast)
    }
  };
}

async function getIndexedNetworkStats() {
  const pool = getPool();

  const bridgeSql = `
    SELECT
      COALESCE(SUM(CASE WHEN direction='inflow' THEN amount_usd END),0) AS total_inflow_usd,
      COALESCE(SUM(CASE WHEN direction='outflow' THEN amount_usd END),0) AS total_outflow_usd,
      COALESCE(SUM(amount_usd),0) AS total_bridge_volume_usd
    FROM bridge_transfers
    WHERE status = 'confirmed';
  `;

  const dexSql = `
    WITH normalized_swaps AS (
      SELECT DISTINCT ON (ds.chain_id, ds.tx_hash)
        ds.chain_id,
        ds.tx_hash,
        ds.swap_volume_usd,
        ds.token_in_usd
      FROM dex_swaps ds
      WHERE ds.status = 'confirmed'
      ORDER BY ds.chain_id, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    )
    SELECT
      COUNT(*) AS total_swap_count,
      COALESCE(SUM(swap_volume_usd),0) AS total_swap_volume_usd,
      COALESCE(SUM(COALESCE(token_in_usd, swap_volume_usd)),0) AS overall_token_spent_usd
    FROM normalized_swaps;
  `;

  const gasSql = `
    SELECT
      COALESCE(SUM(fee_usd),0) AS total_gas_spent_usd
    FROM tx_fees;
  `;

  const usersSql = `
    SELECT COUNT(DISTINCT wallet_address) AS indexed_wallet_count
    FROM (
      SELECT wallet_address FROM bridge_transfers
      UNION
      SELECT wallet_address FROM dex_swaps
      UNION
      SELECT wallet_address FROM tx_fees
    ) wallets;
  `;

  const tokenSpendSql = `
    WITH normalized_swaps AS (
      SELECT DISTINCT ON (ds.chain_id, ds.tx_hash)
        ds.chain_id,
        ds.tx_hash,
        ds.token_in_id,
        ds.token_in_amount,
        ds.token_in_usd,
        ds.swap_volume_usd
      FROM dex_swaps ds
      WHERE ds.status = 'confirmed'
      ORDER BY ds.chain_id, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    )
    SELECT
      COALESCE(t.symbol, 'UNKNOWN') AS token,
      COALESCE(SUM(ns.token_in_amount),0) AS amount_spent,
      COALESCE(SUM(COALESCE(ns.token_in_usd, ns.swap_volume_usd)),0) AS amount_spent_usd
    FROM normalized_swaps ns
    LEFT JOIN tokens t ON t.id = ns.token_in_id
    GROUP BY 1
    ORDER BY amount_spent_usd DESC, amount_spent DESC
    LIMIT 12;
  `;

  const [bridgeRes, dexRes, gasRes, usersRes, tokenSpendRes] = await Promise.all([
    pool.query(bridgeSql),
    pool.query(dexSql),
    pool.query(gasSql),
    pool.query(usersSql),
    pool.query(tokenSpendSql)
  ]);

  const bridge = bridgeRes.rows[0] || {};
  const dex = dexRes.rows[0] || {};
  const gas = gasRes.rows[0] || {};
  const users = usersRes.rows[0] || {};

  return {
    total_inflow_usd: toNumber(bridge.total_inflow_usd),
    total_outflow_usd: toNumber(bridge.total_outflow_usd),
    total_bridge_volume_usd: toNumber(bridge.total_bridge_volume_usd),
    total_swap_count: toNumber(dex.total_swap_count),
    total_swap_volume_usd: toNumber(dex.total_swap_volume_usd),
    overall_token_spent_usd: toNumber(dex.overall_token_spent_usd),
    total_gas_spent_usd: toNumber(gas.total_gas_spent_usd),
    indexed_wallet_count: toNumber(users.indexed_wallet_count),
    token_spend_breakdown: tokenSpendRes.rows.map((row) => ({
      token: row.token,
      amount_spent: toNumber(row.amount_spent),
      amount_spent_usd: toNumber(row.amount_spent_usd)
    }))
  };
}

export async function getNetworkSummary() {
  const [explorer, chainTvl, bridge, dex, indexed] = await Promise.all([
    getCitreascanNetworkStats().catch((error) => ({ error: `citreascan:${error.message}` })),
    getDefillamaChainTvl().catch((error) => ({ error: `defillama-chain:${error.message}` })),
    getDefillamaBridgeStats().catch((error) => ({ error: `defillama-bridge:${error.message}` })),
    getDefillamaDexStats().catch((error) => ({ error: `defillama-dex:${error.message}` })),
    getIndexedNetworkStats().catch((error) => ({
      error: `indexed:${error.message}`,
      total_inflow_usd: 0,
      total_outflow_usd: 0,
      total_bridge_volume_usd: 0,
      total_swap_count: 0,
      total_swap_volume_usd: 0,
      overall_token_spent_usd: 0,
      total_gas_spent_usd: 0,
      indexed_wallet_count: 0,
      token_spend_breakdown: []
    }))
  ]);

  const errors = [explorer.error, chainTvl.error, bridge.error, dex.error, indexed.error].filter(Boolean);

  return {
    mode: "live",
    updated_at: new Date().toISOString(),
    refresh_ms: env.networkRefreshMs,
    sources: {
      citreascan: explorer.error ? "error" : "ok",
      defillama_chain: chainTvl.error ? "error" : "ok",
      defillama_bridge: bridge.error ? "error" : "ok",
      defillama_dex: dex.error ? "error" : "ok",
      indexed: indexed.error ? "error" : "ok"
    },
    errors,
    citrea: {
      total_inflow_usd: indexed.total_inflow_usd,
      total_outflow_usd: indexed.total_outflow_usd,
      netflow_usd: indexed.total_inflow_usd - indexed.total_outflow_usd,
      total_bridge_volume_usd: indexed.total_bridge_volume_usd,
      total_swap_volume_usd: indexed.total_swap_volume_usd,
      total_activity_volume_usd: indexed.total_bridge_volume_usd + indexed.total_swap_volume_usd,
      total_swap_count: indexed.total_swap_count,
      total_gas_spent_usd: indexed.total_gas_spent_usd,
      total_users: explorer.total_users || indexed.indexed_wallet_count,
      indexed_wallet_count: indexed.indexed_wallet_count,
      total_transactions: explorer.total_transactions || 0,
      transactions_today: explorer.transactions_today || 0,
      total_blocks: explorer.total_blocks || 0,
      average_block_time_ms: explorer.average_block_time_ms || 0,
      network_utilization_percentage: explorer.network_utilization_percentage || 0,
      gas_price_updated_at: explorer.gas_price_updated_at || null,
      gas_used_today: explorer.gas_used_today || 0,
      gas_prices: {
        slow: explorer.gas_prices?.slow || 0,
        average: explorer.gas_prices?.average || 0,
        fast: explorer.gas_prices?.fast || 0
      },
      chain_tvl_usd: chainTvl.chain_tvl_usd || 0,
      dex_volume_24h_usd: dex.dex_volume_24h_usd || 0,
      dex_volume_7d_usd: dex.dex_volume_7d_usd || 0,
      dex_volume_30d_usd: dex.dex_volume_30d_usd || 0,
      dex_volume_all_time_usd: dex.dex_volume_all_time_usd || 0,
      bridge_total_usd: bridge.bridge_total_usd || 0,
      bridge_from_btc_usd: bridge.bridge_from_btc_usd || 0,
      bridge_from_evm_usd: bridge.bridge_from_evm_usd || 0,
      overall_token_spent_usd: indexed.overall_token_spent_usd,
      token_spend_breakdown: indexed.token_spend_breakdown
    }
  };
}
