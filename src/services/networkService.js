import { env } from "../config.js";
import { getPool } from "../db.js";
import { resolveTokenUsdPrice } from "./priceService.js";

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

function buildSourceRegistry(statuses) {
  const cadence = formatRefreshMinutes(env.networkRefreshMs);
  return [
    {
      id: "citrea_explorer_api",
      label: "Citrea Explorer API",
      status: statuses.citreaExplorer,
      type: "official api",
      cadence,
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
      integrated: false,
      url: "https://citrea.xyz/batch-explorer?page=1&limit=10",
      usage: "Batch-level Bitcoin settlement context"
    },
    {
      id: "fibrous_api",
      label: "Fibrous API",
      status: "documented",
      type: "app api",
      cadence: "on demand",
      integrated: false,
      url: "https://docs.fibrous.finance/api-reference/introduction",
      usage: "Aggregator quotes and route surface for Fibrous-powered swaps"
    },
    {
      id: "juiceswap_contracts",
      label: "JuiceSwap Contracts",
      status: "tracked",
      type: "app contracts",
      cadence,
      integrated: true,
      url: "https://docs.juiceswap.com/smart-contracts.html#contract-summary",
      usage: "JuiceSwap V2/V3 routers, factories and gateway tracked in the swap indexer"
    },
    {
      id: "juiceswap_docs",
      label: "JuiceSwap Docs",
      status: "documented",
      type: "app docs",
      cadence: "manual",
      integrated: false,
      url: "https://docs.juiceswap.com/overview.html#what-is-juiceswap",
      usage: "Citrea-native DEX documentation and contract references"
    },
    {
      id: "satsuma_exchange",
      label: "Satsuma Exchange",
      status: "tracked",
      type: "app contracts",
      cadence,
      integrated: true,
      url: "https://satsuma.exchange/docs",
      usage: "Satsuma pools are tracked through the Citrea DEX indexer"
    },
    {
      id: "fibrous_docs",
      label: "Fibrous Docs",
      status: "reference",
      type: "app docs",
      cadence: "manual",
      integrated: false,
      url: "https://docs.fibrous.finance/essentials/inspiration-for-aggregator",
      usage: "Fibrous router and integration reference"
    },
    {
      id: "symbiosis_api",
      label: "Symbiosis API",
      status: "documented",
      type: "app api",
      cadence: "on demand",
      integrated: false,
      url: "https://api.symbiosis.finance/crosschain/v1/chains",
      usage: "Cross-chain routing surface, not yet wired into tracker totals"
    },
    {
      id: "symbiosis_app",
      label: "Symbiosis App",
      status: "reference",
      type: "app ui",
      cadence: "manual",
      integrated: false,
      url: "https://app.symbiosis.finance/swap?amountIn=1&chainIn=Bitcoin&chainOut=Citrea&tokenIn=BTC&tokenOut=CBTC",
      usage: "User-side bridge and swap interface"
    },
    {
      id: "zentra_docs",
      label: "Zentra Docs",
      status: "documented",
      type: "app docs",
      cadence: "manual",
      integrated: false,
      url: "https://zentrafinance.gitbook.io/zentra/",
      usage: "Citrea money market reference for lending and borrowing activity"
    },
    {
      id: "generic_money",
      label: "Generic Money",
      status: "documented",
      type: "app repo",
      cadence: "manual",
      integrated: false,
      url: "https://github.com/generic-money",
      usage: "Generic ecosystem repos and stable asset infrastructure referenced across Citrea apps"
    },
    {
      id: "accountable_capital",
      label: "Accountable Capital",
      status: "unverified",
      type: "app docs",
      cadence: "manual",
      integrated: false,
      url: "https://docs.accountable.capital/",
      usage: "Reference only until a confirmed Citrea integration or public API path is identified"
    },
    {
      id: "signals_protocol",
      label: "Signals Protocol",
      status: "documented",
      type: "app docs",
      cadence: "manual",
      integrated: false,
      url: "https://docs.signals.wtf/docs/",
      usage: "Prediction market protocol docs with ctUSD-based on-chain trading mechanics"
    },
    {
      id: "foresight",
      label: "Foresight",
      status: "documented",
      type: "app docs",
      cadence: "manual",
      integrated: false,
      url: "https://docs.foresight.now/guides/getting-started/introduction-to-foresight",
      usage: "Citrea-supported prediction market interface using ctUSD on chain 4114"
    },
    {
      id: "namoshi",
      label: "Namoshi",
      status: "unverified",
      type: "app ui",
      cadence: "manual",
      integrated: false,
      url: "https://app.namoshi.xyz/",
      usage: "Reference only until a confirmed Citrea integration or public API path is identified"
    },
    {
      id: "rango",
      label: "Rango",
      status: "documented",
      type: "aggregator docs",
      cadence: "manual",
      integrated: false,
      url: "https://docs.rango.exchange/",
      usage: "Cross-chain aggregator reference; Citrea support not yet wired into tracker runtime totals"
    },
    {
      id: "dfx_toolbox",
      label: "DFX Toolbox",
      status: "unverified",
      type: "fiat tooling",
      cadence: "manual",
      integrated: false,
      url: "https://dfx.swiss/dfx-toolbox.html",
      usage: "Reference only until a confirmed Citrea-specific integration path is identified"
    },
    {
      id: "defillama_chain",
      label: "DefiLlama Chain",
      status: statuses.defillamaChain,
      type: "secondary api",
      cadence,
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
      integrated: true,
      url: null,
      usage: "Wallet bridge flows, indexed swaps and fee enrichment"
    },
    {
      id: "dune",
      label: "Dune",
      status: "manual",
      type: "reference analytics",
      cadence: "manual",
      integrated: false,
      url: "https://dune.com/",
      usage: "Potential query-based validation only; not wired without a maintained Citrea query"
    },
    {
      id: "nansen",
      label: "Nansen",
      status: "unsupported",
      type: "reference analytics",
      cadence: "manual",
      integrated: false,
      url: "https://app.nansen.ai/macro/overview?chain=citrea&utm_source=twitter&utm_medium=social",
      usage: "Not integrated for Citrea because official supported-chain docs do not currently list Citrea"
    }
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

  const tokenSpendBreakdown = await enrichTokenSpendRows(tokenSpendRes.rows);
  const enrichedTokenSpendTotal = tokenSpendBreakdown.reduce((sum, row) => sum + toNumber(row.amount_spent_usd), 0);

  return {
    total_inflow_usd: toNumber(bridge.total_inflow_usd),
    total_outflow_usd: toNumber(bridge.total_outflow_usd),
    total_bridge_volume_usd: toNumber(bridge.total_bridge_volume_usd),
    total_swap_count: toNumber(dex.total_swap_count),
    total_swap_volume_usd: Math.max(toNumber(dex.total_swap_volume_usd), enrichedTokenSpendTotal),
    overall_token_spent_usd: Math.max(toNumber(dex.overall_token_spent_usd), enrichedTokenSpendTotal),
    total_gas_spent_usd: toNumber(gas.total_gas_spent_usd),
    indexed_wallet_count: toNumber(users.indexed_wallet_count),
    token_spend_breakdown: tokenSpendBreakdown
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
    source_registry: buildSourceRegistry({
      citreaExplorer: explorer.error ? "error" : "ok",
      defillamaChain: chainTvl.error ? "error" : "ok",
      defillamaBridge: bridge.error ? "error" : "ok",
      defillamaDex: dex.error ? "error" : "ok",
      indexed: indexed.error ? "error" : "ok"
    }),
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
      transactions_today: liveTodayTransactions.count,
      transactions_today_date: liveTodayTransactions.date,
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
