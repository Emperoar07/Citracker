import { env } from "../config.js";
import { getPool } from "../db.js";
import { resolveNativeUsdPrice, resolveTokenUsdPrice } from "./priceService.js";
import { buildCitreaAppSourceEntries } from "./sourceRegistry.js";
import { getDuneCitreaCrossChecks, getDuneSourceEntry } from "./duneService.js";
import { getNansenCitreaProbeResult, getNansenCitreaSourceEntry } from "./nansenService.js";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function ensureRuntimeCacheTable() {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS runtime_cache (
      cache_key text PRIMARY KEY,
      cache_value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`
  );
}

async function getRuntimeCache(cacheKey) {
  await ensureRuntimeCacheTable();
  const pool = getPool();
  const result = await pool.query(
    `SELECT cache_value, updated_at
     FROM runtime_cache
     WHERE cache_key = $1`,
    [cacheKey]
  );
  if (!result.rows[0]) return null;
  return {
    value: result.rows[0].cache_value,
    updated_at: result.rows[0].updated_at
  };
}

async function setRuntimeCache(cacheKey, value) {
  await ensureRuntimeCacheTable();
  const pool = getPool();
  await pool.query(
    `INSERT INTO runtime_cache (cache_key, cache_value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (cache_key)
     DO UPDATE SET cache_value = EXCLUDED.cache_value, updated_at = now()`,
    [cacheKey, JSON.stringify(value)]
  );
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatRefreshMinutes(ms) {
  const minutes = Math.max(Math.round(ms / 60000), 1);
  return `${minutes}m`;
}

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function utcDayStartIso(date = new Date()) {
  return `${utcDateString(date)}T00:00:00.000Z`;
}

function utcNextDayStartIso(date = new Date()) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${utcDateString(next)}T00:00:00.000Z`;
}

function buildSourceRegistry(statuses, duneCrossChecks) {
  const cadence = formatRefreshMinutes(env.networkRefreshMs);
  const duneSource = getDuneSourceEntry(cadence, duneCrossChecks);
  const nansenSource = getNansenCitreaSourceEntry(cadence);
  return [
    {
      id: "citrea_explorer_api",
      label: "Citrea Explorer API",
      status: statuses.citreaExplorer,
      type: "official api",
      cadence,
      coverage: "metrics",
      confidence: "official truth",
      integrated: true,
      url: env.citreascanApiUrl,
      usage: "Wallet transactions, gas, token transfers, chain stats"
    },
    {
      id: "citrea_docs",
      label: "Citrea Docs",
      status: "reference",
      type: "official docs",
      cadence: "manual",
      coverage: "reference",
      confidence: "official truth",
      integrated: false,
      url: "https://docs.citrea.xyz/",
      usage: "Chain metadata, contracts, RPC and bridge references"
    },
    {
      id: "citrea_bridge_ui",
      label: "Citrea Bridge",
      status: "reference",
      type: "official ui",
      cadence: "manual",
      coverage: "reference",
      confidence: "official truth",
      integrated: false,
      url: "https://citrea.xyz/bridge",
      usage: "Official bridge surface for user-side reference"
    },
    {
      id: "citrea_app_hub",
      label: "Citrea App Hub",
      status: "reference",
      type: "official ui",
      cadence: "manual",
      coverage: "reference",
      confidence: "official truth",
      integrated: false,
      url: "https://app.citrea.xyz/",
      usage: "Official app discovery surface"
    },
    {
      id: "citrea_batch_explorer",
      label: "Citrea Batch Explorer",
      status: "reference",
      type: "official ui",
      cadence: "manual",
      coverage: "reference",
      confidence: "official truth",
      integrated: false,
      url: "https://citrea.xyz/batch-explorer?page=1&limit=10",
      usage: "Batch-level Bitcoin settlement context"
    },
    ...buildCitreaAppSourceEntries(cadence),
    {
      id: "defillama_chain",
      label: "DefiLlama Chain",
      status: statuses.defillamaChain,
      type: "secondary api",
      cadence,
      coverage: "metrics",
      confidence: "secondary cross-check",
      integrated: true,
      url: `${env.defillamaApiBase}/v2/chains`,
      usage: "Chain TVL cross-check"
    },
    {
      id: "defillama_bridge",
      label: "DefiLlama Bridge",
      status: statuses.defillamaBridge,
      type: "secondary api",
      cadence,
      coverage: "metrics",
      confidence: "secondary cross-check",
      integrated: true,
      url: `${env.defillamaApiBase}/protocol/${env.defillamaBridgeProtocol}`,
      usage: "Bridge origin and TVL cross-check"
    },
    {
      id: "defillama_dex",
      label: "DefiLlama DEX",
      status: statuses.defillamaDex,
      type: "secondary api",
      cadence,
      coverage: "metrics",
      confidence: "secondary cross-check",
      integrated: true,
      url: `${env.defillamaApiBase}/overview/dexs/${encodeURIComponent(env.defillamaChainName.toLowerCase())}`,
      usage: "Chain-wide DEX volume cross-check"
    },
    {
      id: "mempool_space",
      label: "mempool.space",
      status: "reference",
      type: "btc api",
      cadence: "manual",
      coverage: "reference",
      confidence: "reference only",
      integrated: false,
      url: "https://mempool.space/",
      usage: "BTC-side context around Citrea bridge activity"
    },
    {
      id: "indexed_db",
      label: "Citracker Index",
      status: statuses.indexed,
      type: "internal index",
      cadence,
      coverage: "metrics",
      confidence: "derived index",
      integrated: true,
      url: null,
      usage: "Wallet bridge flows, indexed swaps and fee enrichment"
    },
    duneSource,
    nansenSource
  ];
}

export async function refreshLiveTransactionState(totalTransactions, fallbackCount = 0, fallbackDate = null) {
  const today = utcDateString();
  const cacheKey = "citrea:transactions-today:live-state";
  const cached = await getRuntimeCache(cacheKey);
  const currentTotal = toNumber(totalTransactions);
  let state = cached?.value || null;

  if (!state) {
    state = {
      date: today,
      baseline_total_transactions:
        fallbackDate === today ? Math.max(currentTotal - toNumber(fallbackCount), 0) : currentTotal,
      last_total_transactions: currentTotal,
      exact: fallbackDate === today
    };
    await setRuntimeCache(cacheKey, state);
    return {
      count: Math.max(currentTotal - toNumber(state.baseline_total_transactions), 0),
      date: today,
      exact: Boolean(state.exact)
    };
  }

  if (state.date !== today) {
    state = {
      date: today,
      baseline_total_transactions: toNumber(state.last_total_transactions, currentTotal),
      last_total_transactions: currentTotal,
      exact: true
    };
    await setRuntimeCache(cacheKey, state);
    return {
      count: Math.max(currentTotal - toNumber(state.baseline_total_transactions), 0),
      date: today,
      exact: true
    };
  }

  state.last_total_transactions = currentTotal;
  await setRuntimeCache(cacheKey, state);
  return {
    count: Math.max(currentTotal - toNumber(state.baseline_total_transactions), 0),
    date: today,
    exact: Boolean(state.exact)
  };
}

async function getDefillamaChainTvl() {
  const data = await fetchJson(`${env.defillamaApiBase}/v2/chains`);
  const chains = Array.isArray(data) ? data : data?.value;
  const normalizedTarget = env.defillamaChainName.toLowerCase().trim();
  const match = Array.isArray(chains)
    ? chains.find((item) => Number(item?.chainId) === env.citreaChainId) ||
      chains.find((item) => String(item?.name || "").toLowerCase().trim() === normalizedTarget) ||
      chains.find((item) => String(item?.name || "").toLowerCase().includes(normalizedTarget))
    : null;

  return {
    chain_tvl_usd: toNumber(match?.tvl),
    chain_id: match?.chainId ?? env.citreaChainId
  };
}

async function enrichTokenSpendRows(rows) {
  const timestamp = new Date().toISOString();
  return Promise.all(
    rows.map(async (row) => {
      const baseUsd = toNumber(row.amount_spent_usd);
      if (baseUsd > 0) {
        return {
          token: row.token,
          amount_spent: toNumber(row.amount_spent),
          amount_spent_usd: baseUsd
        };
      }

      const price = await resolveTokenUsdPrice(row.token, timestamp).catch(() => null);
      const fallbackUsd = price ? toNumber(row.amount_spent) * price.price : 0;

      return {
        token: row.token,
        amount_spent: toNumber(row.amount_spent),
        amount_spent_usd: fallbackUsd
      };
    })
  );
}

async function enrichDex24hRows(rows) {
  return Promise.all(
    rows.map(async (row) => {
      const swapVolumeUsd = toNumber(row.swap_volume_usd);
      const tokenInUsd = toNumber(row.token_in_usd);
      const tokenOutUsd = toNumber(row.token_out_usd);

      if (swapVolumeUsd > 0) return swapVolumeUsd;
      if (tokenInUsd > 0) return tokenInUsd;
      if (tokenOutUsd > 0) return tokenOutUsd;

      const [inPrice, outPrice] = await Promise.all([
        row.token_in_symbol ? resolveTokenUsdPrice(row.token_in_symbol, row.block_timestamp).catch(() => null) : null,
        row.token_out_symbol ? resolveTokenUsdPrice(row.token_out_symbol, row.block_timestamp).catch(() => null) : null
      ]);

      if (inPrice) {
        return toNumber(row.token_in_amount) * inPrice.price;
      }
      if (outPrice) {
        return toNumber(row.token_out_amount) * outPrice.price;
      }
      return 0;
    })
  );
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
  const [data, txChart] = await Promise.all([
    fetchJson(env.citreascanStatsUrl),
    fetchJson(`${env.citreascanApiUrl.replace(/\/$/, "")}/stats/charts/transactions`).catch(() => null)
  ]);
  const latestDailyPoint = Array.isArray(txChart?.chart_data) ? txChart.chart_data[0] : null;

  return {
    total_users: toNumber(data?.total_addresses),
    total_transactions: toNumber(data?.total_transactions),
    transactions_today: toNumber(data?.transactions_today),
    latest_daily_transactions: toNumber(
      latestDailyPoint?.transactions_count,
      toNumber(data?.transactions_today)
    ),
    latest_daily_transactions_date: latestDailyPoint?.date || null,
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
        ds.block_timestamp,
        ds.swap_volume_usd,
        ds.token_in_usd
      FROM dex_swaps ds
      WHERE ds.status = 'confirmed'
      ORDER BY ds.chain_id, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    )
    SELECT
      COUNT(*) AS total_swap_count,
      COALESCE(SUM(CASE WHEN block_timestamp >= now() - interval '24 hours' THEN swap_volume_usd END),0) AS dex_volume_24h_usd,
      COALESCE(SUM(swap_volume_usd),0) AS total_swap_volume_usd,
      COALESCE(SUM(COALESCE(token_in_usd, swap_volume_usd)),0) AS overall_token_spent_usd
    FROM normalized_swaps;
  `;

  const gasSql = `
    SELECT
      COALESCE(SUM(fee_usd),0) AS total_gas_spent_usd,
      COALESCE(SUM(CASE WHEN block_timestamp >= $1::timestamptz THEN fee_usd END),0) AS gas_spent_today_usd
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

  const recentDexSql = `
    WITH normalized_swaps AS (
      SELECT DISTINCT ON (ds.chain_id, ds.tx_hash)
        ds.chain_id,
        ds.tx_hash,
        ds.block_timestamp,
        ds.token_in_amount,
        ds.token_out_amount,
        ds.token_in_usd,
        ds.token_out_usd,
        ds.swap_volume_usd,
        t_in.symbol AS token_in_symbol,
        t_out.symbol AS token_out_symbol
      FROM dex_swaps ds
      LEFT JOIN tokens t_in ON t_in.id = ds.token_in_id
      LEFT JOIN tokens t_out ON t_out.id = ds.token_out_id
      WHERE ds.status = 'confirmed'
        AND ds.block_timestamp >= now() - interval '24 hours'
      ORDER BY ds.chain_id, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    )
    SELECT *
    FROM normalized_swaps;
  `;

  const [bridgeRes, dexRes, gasRes, usersRes, tokenSpendRes, recentDexRes] = await Promise.all([
    pool.query(bridgeSql),
    pool.query(dexSql),
    pool.query(gasSql, [utcDayStartIso()]),
    pool.query(usersSql),
    pool.query(tokenSpendSql),
    pool.query(recentDexSql)
  ]);

  const bridge = bridgeRes.rows[0] || {};
  const dex = dexRes.rows[0] || {};
  const gas = gasRes.rows[0] || {};
  const users = usersRes.rows[0] || {};

  const tokenSpendBreakdown = await enrichTokenSpendRows(tokenSpendRes.rows);
  const enrichedTokenSpendTotal = tokenSpendBreakdown.reduce((sum, row) => sum + toNumber(row.amount_spent_usd), 0);
  const dex24hRowValues = await enrichDex24hRows(recentDexRes.rows);
  const dexVolume24hUsd = dex24hRowValues.reduce((sum, value) => sum + toNumber(value), 0);

  return {
    total_inflow_usd: toNumber(bridge.total_inflow_usd),
    total_outflow_usd: toNumber(bridge.total_outflow_usd),
    total_bridge_volume_usd: toNumber(bridge.total_bridge_volume_usd),
    total_swap_count: toNumber(dex.total_swap_count),
    dex_volume_24h_usd: Math.max(toNumber(dex.dex_volume_24h_usd), dexVolume24hUsd),
    total_swap_volume_usd: Math.max(toNumber(dex.total_swap_volume_usd), enrichedTokenSpendTotal),
    overall_token_spent_usd: Math.max(toNumber(dex.overall_token_spent_usd), enrichedTokenSpendTotal),
    total_gas_spent_usd: toNumber(gas.total_gas_spent_usd),
    gas_spent_today_usd: toNumber(gas.gas_spent_today_usd),
    indexed_wallet_count: toNumber(users.indexed_wallet_count),
    token_spend_breakdown: tokenSpendBreakdown
  };
}

export async function getPublicInterestIndexedStats() {
  const pool = getPool();
  const dayStart = utcDayStartIso();
  const nextDayStart = utcNextDayStartIso();

  const activeWalletsSql = `
    SELECT COUNT(DISTINCT wallet_address) AS active_wallets_today
    FROM (
      SELECT wallet_address
      FROM bridge_transfers
      WHERE status = 'confirmed'
        AND block_timestamp >= $1::timestamptz
        AND block_timestamp < $2::timestamptz
      UNION
      SELECT wallet_address
      FROM dex_swaps
      WHERE status = 'confirmed'
        AND block_timestamp >= $1::timestamptz
        AND block_timestamp < $2::timestamptz
      UNION
      SELECT wallet_address
      FROM tx_fees
      WHERE block_timestamp >= $1::timestamptz
        AND block_timestamp < $2::timestamptz
    ) wallet_set;
  `;

  const bridgeRowsSql = `
    SELECT
      COALESCE(NULLIF(bt.protocol_name, ''), 'Unknown Bridge') AS route,
      COALESCE(t.symbol, 'UNKNOWN') AS token,
      bt.direction,
      bt.amount_decimal,
      bt.amount_usd,
      bt.block_timestamp
    FROM bridge_transfers bt
    LEFT JOIN tokens t ON t.id = bt.token_id
    WHERE bt.status = 'confirmed'
      AND bt.block_timestamp >= $1::timestamptz
      AND bt.block_timestamp < $2::timestamptz;
  `;

  const dexAppsSql = `
    WITH normalized_swaps AS (
      SELECT DISTINCT ON (ds.chain_id, ds.tx_hash)
        ds.chain_id,
        ds.tx_hash,
        ds.dex_name,
        ds.block_timestamp,
        ds.token_in_amount,
        ds.token_out_amount,
        ds.token_in_usd,
        ds.token_out_usd,
        ds.swap_volume_usd,
        t_in.symbol AS token_in_symbol,
        t_out.symbol AS token_out_symbol
      FROM dex_swaps ds
      LEFT JOIN tokens t_in ON t_in.id = ds.token_in_id
      LEFT JOIN tokens t_out ON t_out.id = ds.token_out_id
      WHERE ds.status = 'confirmed'
        AND ds.block_timestamp >= $1::timestamptz
        AND ds.block_timestamp < $2::timestamptz
      ORDER BY ds.chain_id, ds.tx_hash, COALESCE(ds.log_index, 2147483647), ds.block_timestamp DESC
    )
    SELECT *
    FROM normalized_swaps;
  `;

  const [activeWalletsRes, bridgeRowsRes, dexAppsRes] =
    await Promise.all([
      pool.query(activeWalletsSql, [dayStart, nextDayStart]),
      pool.query(bridgeRowsSql, [dayStart, nextDayStart]),
      pool.query(dexAppsSql, [dayStart, nextDayStart])
    ]);

  const bridgeRows = await Promise.all(
    bridgeRowsRes.rows.map(async (row) => {
      let volumeUsd = toNumber(row.amount_usd);
      if (volumeUsd <= 0 && row.token) {
        const price = await resolveTokenUsdPrice(row.token, row.block_timestamp).catch(() => null);
        if (price) {
          volumeUsd = toNumber(row.amount_decimal) * price.price;
        }
      }

      return {
        route: row.route || "Unknown Bridge",
        token: row.token || "UNKNOWN",
        direction: row.direction || "inflow",
        amount_decimal: toNumber(row.amount_decimal),
        volume_usd: volumeUsd
      };
    })
  );

  const dexAppVolumes = await Promise.all(
    dexAppsRes.rows.map(async (row) => {
      let volumeUsd = toNumber(row.swap_volume_usd);
      if (volumeUsd <= 0) {
        volumeUsd = toNumber(row.token_in_usd);
      }
      if (volumeUsd <= 0) {
        volumeUsd = toNumber(row.token_out_usd);
      }
      if (volumeUsd <= 0 && row.token_in_symbol) {
        const price = await resolveTokenUsdPrice(row.token_in_symbol, row.block_timestamp).catch(() => null);
        if (price) {
          volumeUsd = toNumber(row.token_in_amount) * price.price;
        }
      }
      if (volumeUsd <= 0 && row.token_out_symbol) {
        const price = await resolveTokenUsdPrice(row.token_out_symbol, row.block_timestamp).catch(() => null);
        if (price) {
          volumeUsd = toNumber(row.token_out_amount) * price.price;
        }
      }

      return {
        app: row.dex_name || "Unknown DEX",
        category: "dex",
        tx_count: 1,
        volume_usd: volumeUsd
      };
    })
  );

  const appMap = new Map();
  for (const item of dexAppVolumes) {
    const key = `${String(item.app || "").toLowerCase()}::${item.category}`;
    const existing = appMap.get(key) || {
      app: item.app,
      category: item.category,
      tx_count: 0,
      volume_usd: 0
    };
    existing.tx_count += Number(item.tx_count || 0);
    existing.volume_usd += Number(item.volume_usd || 0);
    appMap.set(key, existing);
  }

  const routeMap = new Map();
  const tokenMap = new Map();
  for (const row of bridgeRows) {
    if (toNumber(row.amount_decimal) <= 0) continue;

    const routeKey = String(row.route || "Unknown Bridge").toLowerCase();
    const existingRoute = routeMap.get(routeKey) || {
      route: row.route || "Unknown Bridge",
      tx_count: 0,
      volume_usd: 0
    };
    existingRoute.tx_count += 1;
    existingRoute.volume_usd += Number(row.volume_usd || 0);
    routeMap.set(routeKey, existingRoute);

    const tokenKey = String(row.token || "UNKNOWN").toLowerCase();
    const existingToken = tokenMap.get(tokenKey) || {
      token: row.token || "UNKNOWN",
      tx_count: 0,
      inflow_usd: 0,
      outflow_usd: 0,
      volume_usd: 0
    };
    existingToken.tx_count += 1;
    if (row.direction === "outflow") {
      existingToken.outflow_usd += Number(row.volume_usd || 0);
    } else {
      existingToken.inflow_usd += Number(row.volume_usd || 0);
    }
    existingToken.volume_usd += Number(row.volume_usd || 0);
    tokenMap.set(tokenKey, existingToken);

    const key = `${String(row.route || "Unknown Bridge").toLowerCase()}::bridge`;
    const existing = appMap.get(key) || {
      app: row.route || "Unknown Bridge",
      category: "bridge",
      tx_count: 0,
      volume_usd: 0
    };
    existing.tx_count += 1;
    existing.volume_usd += Number(row.volume_usd || 0);
    appMap.set(key, existing);
  }

  const combinedApps = [...appMap.values()];
  const topBridgeRoutesToday = [...routeMap.values()]
    .sort((a, b) => {
      const volumeDiff = toNumber(b.volume_usd) - toNumber(a.volume_usd);
      if (volumeDiff !== 0) return volumeDiff;
      return toNumber(b.tx_count) - toNumber(a.tx_count);
    })
    .slice(0, 5);
  const topTokensBridgedToday = [...tokenMap.values()]
    .sort((a, b) => {
      const volumeDiff = toNumber(b.volume_usd) - toNumber(a.volume_usd);
      if (volumeDiff !== 0) return volumeDiff;
      return toNumber(b.tx_count) - toNumber(a.tx_count);
    })
    .slice(0, 5);
  const topAppsByTxToday = combinedApps
    .slice()
    .sort((a, b) => {
      const txDiff = toNumber(b.tx_count) - toNumber(a.tx_count);
      if (txDiff !== 0) return txDiff;
      return toNumber(b.volume_usd) - toNumber(a.volume_usd);
    })
    .slice(0, 5);
  const topAppsByVolumeToday = combinedApps
    .slice()
    .sort((a, b) => {
      const volumeDiff = toNumber(b.volume_usd) - toNumber(a.volume_usd);
      if (volumeDiff !== 0) return volumeDiff;
      return toNumber(b.tx_count) - toNumber(a.tx_count);
    })
    .slice(0, 5);

  return {
    active_wallets_today: toNumber(activeWalletsRes.rows[0]?.active_wallets_today),
    top_bridge_routes_today: topBridgeRoutesToday.map((item) => ({
      route: item.route,
      tx_count: toNumber(item.tx_count),
      volume_usd: toNumber(item.volume_usd)
    })),
    top_tokens_bridged_today: topTokensBridgedToday.map((item) => ({
      token: item.token,
      tx_count: toNumber(item.tx_count),
      inflow_usd: toNumber(item.inflow_usd),
      outflow_usd: toNumber(item.outflow_usd),
      volume_usd: toNumber(item.volume_usd)
    })),
    top_apps_by_tx_today: topAppsByTxToday.map((item) => ({
      app: item.app,
      category: item.category,
      tx_count: toNumber(item.tx_count),
      volume_usd: toNumber(item.volume_usd)
    })),
    top_apps_by_volume_today: topAppsByVolumeToday.map((item) => ({
      app: item.app,
      category: item.category,
      tx_count: toNumber(item.tx_count),
      volume_usd: toNumber(item.volume_usd)
    }))
  };
}

async function getFailedTransactionsToday() {
  const dayStart = new Date(utcDayStartIso());
  let failedCount = 0;
  let nextPageParams = null;
  const maxPages = 80;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${env.citreascanApiUrl.replace(/\/$/, "")}/transactions`);
    if (nextPageParams?.block_number != null) {
      url.searchParams.set("block_number", String(nextPageParams.block_number));
    }
    if (nextPageParams?.index != null) {
      url.searchParams.set("index", String(nextPageParams.index));
    }
    if (nextPageParams?.items_count != null) {
      url.searchParams.set("items_count", String(nextPageParams.items_count));
    }

    const data = await fetchJson(url.toString());
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) break;

    let reachedOlderItems = false;
    for (const item of items) {
      const timestamp = item?.timestamp ? new Date(item.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) {
        continue;
      }
      if (timestamp < dayStart) {
        reachedOlderItems = true;
        break;
      }

      const isFailed =
        String(item?.status || "").toLowerCase() !== "ok" ||
        String(item?.result || "").toLowerCase() !== "success" ||
        Boolean(item?.revert_reason) ||
        Boolean(item?.has_error_in_internal_transactions);

      if (isFailed) {
        failedCount += 1;
      }
    }

    if (reachedOlderItems || !data?.next_page_params) {
      break;
    }
    nextPageParams = data.next_page_params;
  }

  return {
    failed_tx_today: failedCount,
    failed_tx_today_source: "citrea_explorer_transactions_scan"
  };
}

async function getCachedFailedTransactionsToday() {
  const cacheKey = `citrea:failed-transactions:${utcDateString()}`;

  try {
    const cached = await getRuntimeCache(cacheKey);
    if (cached?.value && cached.updated_at) {
      const ageMs = Date.now() - new Date(cached.updated_at).getTime();
      if (Number.isFinite(ageMs) && ageMs < env.networkRefreshMs) {
        return cached.value;
      }
    }
  } catch {
    return getFailedTransactionsToday();
  }

  const fresh = await getFailedTransactionsToday();
  try {
    await setRuntimeCache(cacheKey, fresh);
  } catch {
    return fresh;
  }
  return fresh;
}

export async function getNetworkGasSummary() {
  const [explorer, indexed] = await Promise.all([
    getCitreascanNetworkStats().catch((error) => ({ error: `citreascan:${error.message}` })),
    getIndexedNetworkStats().catch((error) => ({
      error: `indexed:${error.message}`,
      gas_spent_today_usd: 0
    }))
  ]);

  const errors = [explorer.error, indexed.error].filter(Boolean);
  const nativePrice = await resolveNativeUsdPrice(env.citreaChainId, new Date().toISOString()).catch(() => null);
  const averageGasPriceGwei = toNumber(explorer.gas_prices?.average);
  const gasUsedToday = toNumber(explorer.gas_used_today);
  const estimatedGasSpentNative = gasUsedToday * averageGasPriceGwei * 1e-9;
  const estimatedGasSpentUsd = nativePrice ? estimatedGasSpentNative * nativePrice.price : 0;
  const usdPerGwei = nativePrice ? nativePrice.price * 1e-9 : 0;

  return {
    updated_at: new Date().toISOString(),
    refresh_ms: 60000,
    errors,
    gas: {
      gas_price_updated_at: explorer.gas_price_updated_at || null,
      gas_day_date: utcDateString(),
      gas_day_reset_utc: "00:00",
      gas_used_today: gasUsedToday,
      gas_spent_today_usd: estimatedGasSpentUsd,
      gas_spent_today_source: nativePrice ? "estimated_from_explorer_gas_used" : "unavailable",
      usd_per_gwei: usdPerGwei,
      native_token_usd: nativePrice?.price || 0,
      gas_prices: {
        slow: explorer.gas_prices?.slow || 0,
        average: explorer.gas_prices?.average || 0,
        fast: explorer.gas_prices?.fast || 0
      }
    }
  };
}

export async function getNetworkSummary() {
  const [explorer, chainTvl, bridge, dex, indexed, publicInterest, failedToday, duneCrossChecks] = await Promise.all([
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
    })),
    getPublicInterestIndexedStats().catch((error) => ({
      error: `public-interest:${error.message}`,
      active_wallets_today: 0,
      top_bridge_routes_today: [],
      top_tokens_bridged_today: [],
      top_apps_by_tx_today: [],
      top_apps_by_volume_today: []
    })),
    getCachedFailedTransactionsToday().catch((error) => ({
      error: `failed-tx:${error.message}`,
      failed_tx_today: 0,
      failed_tx_today_source: "unavailable"
    })),
    getDuneCitreaCrossChecks().catch((error) => ({
      configured: Boolean(env.duneApiKey),
      status: "error",
      reason: error.message,
      checks: {},
      metrics: {},
      errors: [error.message]
    }))
  ]);

  const liveTodayTransactions = explorer.error
    ? { count: 0, date: utcDateString(), exact: false }
    : await refreshLiveTransactionState(
        explorer.total_transactions || 0,
        explorer.latest_daily_transactions || explorer.transactions_today || 0,
        explorer.latest_daily_transactions_date || null
      ).catch(() => ({
        count: explorer.latest_daily_transactions || explorer.transactions_today || 0,
        date: explorer.latest_daily_transactions_date || utcDateString(),
        exact: false
      }));

  const errors = [explorer.error, chainTvl.error, bridge.error, dex.error, indexed.error, publicInterest.error, failedToday.error].filter(Boolean);

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
    source_registry: buildSourceRegistry({
      citreaExplorer: explorer.error ? "error" : "ok",
      defillamaChain: chainTvl.error ? "error" : "ok",
      defillamaBridge: bridge.error ? "error" : "ok",
      defillamaDex: dex.error ? "error" : "ok",
      indexed: indexed.error ? "error" : "ok"
    }, duneCrossChecks),
    reference_probes: {
      dune: duneCrossChecks,
      nansen: getNansenCitreaProbeResult()
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
      gas_spent_today_usd: indexed.gas_spent_today_usd,
      total_users: explorer.total_users || indexed.indexed_wallet_count,
      indexed_wallet_count: indexed.indexed_wallet_count,
      active_wallets_today: publicInterest.active_wallets_today,
      total_transactions: explorer.total_transactions || 0,
      transactions_today: liveTodayTransactions.count,
      transactions_today_date: liveTodayTransactions.date,
      failed_tx_today: failedToday.failed_tx_today,
      failed_tx_today_source: failedToday.failed_tx_today_source,
      transactions_today_exact: liveTodayTransactions.exact,
      latest_daily_transactions: explorer.latest_daily_transactions || explorer.transactions_today || 0,
      latest_daily_transactions_date: explorer.latest_daily_transactions_date || null,
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
      dex_volume_24h_usd: indexed.dex_volume_24h_usd > 0 ? indexed.dex_volume_24h_usd : dex.dex_volume_24h_usd || 0,
      dex_volume_24h_source: indexed.dex_volume_24h_usd > 0 ? "indexed_live" : "defillama",
      dex_volume_7d_usd: dex.dex_volume_7d_usd || 0,
      dex_volume_30d_usd: dex.dex_volume_30d_usd || 0,
      dex_volume_all_time_usd: dex.dex_volume_all_time_usd || 0,
      bridge_total_usd: bridge.bridge_total_usd || 0,
      bridge_from_btc_usd: bridge.bridge_from_btc_usd || 0,
      bridge_from_evm_usd: bridge.bridge_from_evm_usd || 0,
      overall_token_spent_usd: indexed.overall_token_spent_usd,
      token_spend_breakdown: indexed.token_spend_breakdown,
      top_bridge_routes_today: publicInterest.top_bridge_routes_today,
      top_tokens_bridged_today: publicInterest.top_tokens_bridged_today,
      top_apps_by_tx_today: publicInterest.top_apps_by_tx_today,
      top_apps_by_volume_today: publicInterest.top_apps_by_volume_today
    }
  };
}
