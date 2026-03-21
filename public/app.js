const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const statusEl = document.getElementById("status");
const bridgeSourceInfoEl = document.getElementById("bridgeSourceInfo");
const kpiEl = document.getElementById("kpis");
const walletBalancesEl = document.getElementById("walletBalances");
const walletTopAppsEl = document.getElementById("walletTopApps");
const walletTopApps24hEl = document.getElementById("walletTopApps24h");

const networkStatusEl = document.getElementById("networkStatus");
const networkKpisEl = document.getElementById("networkKpis");
const networkUpdatedAtEl = document.getElementById("networkUpdatedAt");
const networkLiveLabelEl = document.getElementById("networkLiveLabel");
const indexerHealthBadgeEl = document.getElementById("indexerHealthBadge");
const indexerHealthDotEl = document.getElementById("indexerHealthDot");
const indexerHealthLabelEl = document.getElementById("indexerHealthLabel");
const bridgeOriginsEl = document.getElementById("bridgeOrigins");
const gasPriceMetricsEl = document.getElementById("gasPriceMetrics");
const gasPriceUpdatedAtEl = document.getElementById("gasPriceUpdatedAt");
const gasLiveLabelEl = document.getElementById("gasLiveLabel");
const sourceHealthEl = document.getElementById("sourceHealth");
const todaySnapshotEl = document.getElementById("todaySnapshot");
const topAppsByTxEl = document.getElementById("topAppsByTx");
const topAppsByVolumeEl = document.getElementById("topAppsByVolume");

let networkPollHandle = null;
let gasPollHandle = null;

function formatRefreshInterval(ms) {
  const minutes = Math.max(Math.round(Number(ms || 0) / 60000), 1);
  return `Refreshes every ${minutes}m`;
}

function timeLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString();
}

function friendlyErrorMessage(message, fallback) {
  if (!message) return fallback;
  if (message.includes("DATABASE_URL is required")) {
    return "Indexed wallet database is not connected yet. Chain-wide live metrics are available, but wallet-level totals need the Postgres index.";
  }
  return message;
}

async function fetchJsonOrThrow(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "cache-control": "no-cache"
    }
  });
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(text || `Non-JSON response from ${url}`);
    err.status = response.status;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(payload.error || `Request failed with ${response.status}`);
    err.status = response.status;
    throw err;
  }

  return payload;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function compactMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}B`;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}K`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function number(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function shortDateLabel(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTrackedName(value, type = "app") {
  const raw = String(value || "").trim();
  if (!raw) return type === "route" ? "Unknown Bridge" : "Unknown App";

  const known = {
    juiceswap: "JuiceSwap",
    satsuma: "Satsuma",
    fibrous: "Fibrous",
    "citrea-canonical-wbtc": "Canonical WBTC Bridge",
    "citrea-canonical-usdt": "Canonical USDT Bridge",
    "citrea-canonical-usdc": "Canonical USDC Bridge",
    "citrea-btc-system": "Citrea BTC System Bridge"
  };

  const direct = known[raw.toLowerCase()];
  if (direct) return direct;

  return titleCaseWords(raw.replace(/[-_]+/g, " "));
}

function renderMetricList(container, rows, formatter) {
  if (!container) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    container.innerHTML = `<div class="metric-empty">No indexed data yet.</div>`;
    return;
  }

  container.innerHTML = rows.map(formatter).join("");
}

function walletUsageMeta(item) {
  const category = String(item?.category || "").toLowerCase();
  const volume = money(item?.volume_usd);
  if (category === "bridge") return `bridge | $${volume} bridged`;
  if (category === "dex") return `dex | $${volume} swapped`;
  if (category === "lending" || category === "yield") return `${category} | $${volume} supplied`;
  return `${category || "activity"} | $${volume} activity`;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff6b6b" : "#c8b59d";
}

function setNetworkStatus(text, isError = false) {
  networkStatusEl.textContent = text;
  networkStatusEl.style.color = isError ? "#ff6b6b" : "#c8b59d";
}

function renderIndexerHealth(payload) {
  const health = payload?.health;
  if (!indexerHealthBadgeEl || !indexerHealthDotEl || !indexerHealthLabelEl || !health) return;

  const failureCount = Array.isArray(health.failures) ? health.failures.length : 0;
  const status = health.status === "pass" ? "healthy" : "alert";
  indexerHealthBadgeEl.classList.remove("health-pass", "health-fail");
  indexerHealthBadgeEl.classList.add(status === "healthy" ? "health-pass" : "health-fail");
  indexerHealthDotEl.classList.remove("health-pass", "health-fail");
  indexerHealthDotEl.classList.add(status === "healthy" ? "health-pass" : "health-fail");
  indexerHealthLabelEl.textContent =
    status === "healthy"
      ? "Indexer health healthy"
      : `Indexer health alert${failureCount ? ` (${failureCount})` : ""}`;

  const title = status === "healthy"
    ? `Checked ${new Date(payload.checked_at).toLocaleString()}`
    : (health.failures || []).join(" | ");
  indexerHealthBadgeEl.title = title;
}

function renderKpis(summary) {
  const balanceTokens = Array.isArray(summary.balances?.top_tokens)
    ? summary.balances.top_tokens.map((item) => item.token).filter(Boolean).slice(0, 3)
    : [];
  const balanceMetaParts = [];
  if (balanceTokens.length) balanceMetaParts.push(`Tokens: ${balanceTokens.join(", ")}`);
  if (Number(summary.balances?.cbtc_amount || 0) > 0) {
    balanceMetaParts.push(`Native cBTC: ${number(summary.balances?.cbtc_amount)}`);
  }
  const balanceMeta = balanceMetaParts.length ? balanceMetaParts.join(" | ") : "No live token balances";
  const cbtcAmount = Number(summary.balances?.cbtc_amount || 0);
  const cbtcMeta =
    cbtcAmount > 0
      ? `$${money(summary.balances?.cbtc_usd)} USD - native fee token only | Citrea explorer coin balance`
      : "No native cBTC currently held | Citrea explorer coin balance";

  const cards = [
    { label: "Bridge Tx Count", value: summary.bridge.tx_count },
    { label: "Bridge Total (USD)", value: summary.bridge.volume_usd },
    {
      label: "Available cBTC",
      value: summary.balances?.cbtc_amount,
      meta: cbtcMeta,
      formatter: number
    },
    { label: "Available Token Balance (USD)", value: summary.balances?.total_usd, meta: balanceMeta },
    { label: "Total Wallet Volume (USD)", value: summary.total_activity_volume_usd },
    { label: "DEX Swap Count", value: summary.dex.swap_count },
    { label: "Citrea Tx Count", value: summary.citrea_total_tx_count }
  ];

  kpiEl.innerHTML = cards
    .map((card) => `
      <div class="kpi">
        <div class="label">${card.label}</div>
        <div class="value">${(card.formatter || money)(card.value)}</div>
        ${card.meta ? `<div class="meta">${card.meta}</div>` : ""}
      </div>`)
    .join("");

  bridgeSourceInfoEl.textContent = "";
  bridgeSourceInfoEl.style.display = "none";

  renderMetricList(walletBalancesEl, summary.balances?.all_tokens || [], (item) => `
    <div class="metric-row metric-row-stack">
      <div>
        <div class="metric-value metric-value-left">${item.token}</div>
        <div class="metric-label">${number(item.amount)} available</div>
      </div>
      <span class="metric-value">$${money(item.usd)}</span>
    </div>`);

  renderMetricList(walletTopAppsEl, summary.usage?.top_apps || [], (item) => `
    <div class="metric-row metric-row-stack">
      <div>
        <div class="metric-value metric-value-left">${item.app}</div>
        <div class="metric-label">${walletUsageMeta(item)}</div>
      </div>
      <span class="metric-value">${money(item.tx_count)} tx</span>
    </div>`);
}

function renderWalletTopApps24h(summary) {
  renderMetricList(walletTopApps24hEl, summary?.usage?.top_apps || [], (item) => `
    <div class="metric-row metric-row-stack">
      <div>
        <div class="metric-value metric-value-left">${item.app}</div>
        <div class="metric-label">${walletUsageMeta(item)}</div>
      </div>
      <span class="metric-value">${money(item.tx_count)} tx</span>
    </div>`);
}

function getLast24HoursRange() {
  const now = new Date();
  const from = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  return {
    from: from.toISOString(),
    to: now.toISOString()
  };
}

function renderNetworkSummary(payload) {
  const metrics = payload.citrea;
  const dex24hSource =
    metrics.dex_volume_24h_source === "indexed_live" ? "Citracker" : "DefiLlama";
  const sourceSyncLabel = timeLabel(payload.updated_at);
  const defillamaMeta = sourceSyncLabel ? `Last source sync ${sourceSyncLabel}` : null;
  const cards = [
    { label: "Citrea TVL (USD)", value: metrics.chain_tvl_usd, source: "DefiLlama", meta: defillamaMeta, formatter: compactMoney },
    { label: "Bridge TVL on Citrea (USD)", value: metrics.bridge_total_usd, source: "DefiLlama", meta: defillamaMeta, formatter: compactMoney },
    { label: "Total Addresses", value: metrics.total_users, source: "Explorer" },
    { label: "Total Chain Transactions", value: metrics.total_transactions, source: "Explorer" },
    {
      label: "Chain Transactions Today",
      value: metrics.transactions_today,
      source: "Explorer",
      meta: "UTC reset 00:00 | Explorer live tx feed"
    },
    {
      label: "Citrea DEX Volume 24h (USD)",
      value: metrics.dex_volume_24h_usd,
      source: dex24hSource,
      meta: dex24hSource === "DefiLlama" ? defillamaMeta : null,
      formatter: compactMoney
    }
  ];

  networkKpisEl.innerHTML = cards
    .map((card) => `
      <div class="kpi">
        <div class="label">
          ${card.label}
          <span class="metric-source-tag metric-source-tag-inline">${card.source}</span>
        </div>
        <div class="value">${(card.formatter || money)(card.value)}</div>
        ${card.meta ? `<div class="meta">${card.meta}</div>` : ""}
      </div>`)
    .join("");

  bridgeOriginsEl.innerHTML = [
    ["Bridge TVL From BTC (USD)", "DefiLlama", metrics.bridge_from_btc_usd],
    ["Bridge TVL From EVM (USD)", "DefiLlama", metrics.bridge_from_evm_usd],
    ["DEX Volume All Time (USD)", "DefiLlama", metrics.dex_volume_all_time_usd]
  ]
    .map(([label, source, value]) => `
      <div class="metric-row metric-row-stack">
        <div>
          <div class="metric-label">${label} <span class="metric-source-tag">${source}</span></div>
          ${defillamaMeta ? `<div class="metric-label">${defillamaMeta}</div>` : ""}
        </div>
        <span class="metric-value">${typeof value === "string" ? value : compactMoney(value)}</span>
      </div>`)
    .join("");

  renderMetricList(todaySnapshotEl, [
    { label: "Tracked Active Wallets Today", value: metrics.active_wallets_today, source: "Citracker" },
    { label: "Failed Transactions Today", value: metrics.failed_tx_today, source: "Explorer" },
    { label: "Tracked DEX Swap Count Today", value: metrics.total_swap_count_today, source: "Citracker" }
  ], (item) => `
    <div class="metric-row">
      <span class="metric-label">${item.label} <span class="metric-source-tag">${item.source}</span></span>
      <span class="metric-value">${money(item.value)}</span>
    </div>`);

  renderMetricList(topAppsByTxEl, metrics.top_apps_by_tx_today, (item) => `
    <div class="metric-row metric-row-stack">
      <div>
        <div class="metric-value metric-value-left">${formatTrackedName(item.app, "app")}</div>
        <div class="metric-label">${item.category} | ${money(item.volume_usd)} USD</div>
      </div>
      <span class="metric-value">${money(item.tx_count)} tx</span>
    </div>`);

  renderMetricList(topAppsByVolumeEl, metrics.top_apps_by_volume_today, (item) => `
    <div class="metric-row metric-row-stack">
      <div>
        <div class="metric-value metric-value-left">${formatTrackedName(item.app, "app")}</div>
        <div class="metric-label">${item.category} | ${money(item.tx_count)} tx</div>
      </div>
      <span class="metric-value">${money(item.volume_usd)} USD</span>
    </div>`);

  const sourceEntries = Array.isArray(payload.source_registry) && payload.source_registry.length
    ? payload.source_registry
    : Object.entries(payload.sources || {}).map(([id, status]) => ({
        id,
        label: id.replace(/_/g, " "),
        status,
        type: "source",
        cadence: "unknown",
        usage: ""
      }));

  sourceHealthEl.innerHTML = sourceEntries
    .map((entry) => {
      const statusClass =
        entry.status === "ok"
          ? "source-ok"
          : entry.status === "tracked"
            ? "source-tracked"
          : entry.status === "error"
            ? "source-error"
            : "source-neutral";
      const meta = [
        entry.coverage === "metrics"
          ? "metrics"
          : entry.coverage === "registry"
            ? "registry"
            : "reference",
        entry.type,
        entry.cadence,
        entry.confidence
      ]
        .filter(Boolean)
        .join(" | ");

      return `
        <div class="source-entry">
          <div class="source-entry-top">
            <span class="metric-label source-entry-label">${entry.url ? `<a href="${entry.url}" target="_blank" rel="noreferrer">${entry.label}</a>` : entry.label}</span>
            <span class="metric-value ${statusClass}">${entry.status}</span>
          </div>
          <div class="source-entry-meta">${meta}</div>
        </div>`;
    })
    .join("");

  networkUpdatedAtEl.textContent = `Updated ${new Date(payload.updated_at).toLocaleString()}`;
  networkLiveLabelEl.textContent = formatRefreshInterval(payload.refresh_ms);
  const statusText = payload.errors.length
    ? friendlyErrorMessage(payload.errors.join(" | "), "Citrea mainnet panel synced.")
    : "Citrea mainnet panel synced.";
  const isOnlyIndexedDbGap =
    payload.errors.length === 1 && payload.errors[0].includes("DATABASE_URL is required");
  setNetworkStatus(statusText, payload.errors.length > 0 && !isOnlyIndexedDbGap);
}

function renderGasSummary(payload) {
  const gas = payload.gas || {};
  gasPriceMetricsEl.innerHTML = [
    ["Slow", `${number(gas.gas_prices?.slow, 4)} gwei`],
    ["Average", `${number(gas.gas_prices?.average, 4)} gwei`],
    ["Fast", `${number(gas.gas_prices?.fast, 4)} gwei`],
    ["1 Gwei (USD/gas)", `$${number(gas.usd_per_gwei, 8)}`],
    ["Gas Spent Today (USD)", `$${money(gas.gas_spent_today_usd)}`]
  ]
    .map(([label, value]) => `
      <div class="gas-stat">
        <span class="gas-stat-label">${label}</span>
        <span class="gas-stat-value">${value}</span>
      </div>`)
    .join("");

  gasPriceUpdatedAtEl.textContent = gas.gas_price_updated_at
    ? `Explorer gas update ${new Date(gas.gas_price_updated_at).toLocaleTimeString()}`
    : "Explorer gas update unavailable";
  const sourceLabel =
    gas.gas_spent_today_source === "live_from_explorer_fees"
      ? "Explorer live fee sum"
      : gas.gas_spent_today_source === "indexed_fee_rows"
        ? "Indexed fee rows"
        : "Fee estimate";
  gasLiveLabelEl.textContent = `UTC reset ${gas.gas_day_reset_utc || "00:00"} | ${sourceLabel} | Polling every 60s`;
}

async function loadWalletData() {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    setStatus("Paste a wallet address first.", true);
    return;
  }

  const base = `/api/v1/wallet/${wallet}`;
  const recentRange = getLast24HoursRange();
  const recentQuery = `from=${encodeURIComponent(recentRange.from)}&to=${encodeURIComponent(recentRange.to)}`;
  setStatus("Loading all-time wallet totals...");

  try {
    const [summaryResult, recentSummaryResult] = await Promise.allSettled([
      fetchJsonOrThrow(`${base}/summary`),
      fetchJsonOrThrow(`${base}/summary?${recentQuery}`)
    ]);

    if (summaryResult.status !== "fulfilled") {
      throw summaryResult.reason;
    }

    const summary = summaryResult.value;
    const recentSummary =
      recentSummaryResult.status === "fulfilled"
        ? recentSummaryResult.value
        : { usage: { top_apps: [] } };

    renderKpis(summary);
    renderWalletTopApps24h(recentSummary);

    setStatus(
      recentSummaryResult.status === "fulfilled"
        ? `Loaded all-time totals for ${wallet}.`
        : `Loaded all-time totals for ${wallet}. Recent app activity is temporarily unavailable.`
    );
  } catch (error) {
    setStatus(friendlyErrorMessage(error.message, "Failed to load wallet data."), true);
  }
}

async function loadNetworkData() {
  try {
    const [payload, healthPayload] = await Promise.all([
      fetchJsonOrThrow("/api/v1/network/summary"),
      fetchJsonOrThrow("/api/v1/network/health")
    ]);
    renderNetworkSummary(payload);
    renderIndexerHealth(healthPayload);
    scheduleNetworkPolling(payload.refresh_ms || 300000);
  } catch (error) {
    setNetworkStatus(friendlyErrorMessage(error.message, "Failed to load Citrea mainnet panel."), true);
    scheduleNetworkPolling(300000);
  }
}

async function loadGasData() {
  try {
    const payload = await fetchJsonOrThrow("/api/v1/network/gas");
    renderGasSummary(payload);
    scheduleGasPolling(payload.refresh_ms || 60000);
  } catch {
    scheduleGasPolling(60000);
  }
}

function scheduleNetworkPolling(delayMs) {
  if (networkPollHandle) {
    clearTimeout(networkPollHandle);
  }
  networkPollHandle = setTimeout(loadNetworkData, delayMs);
}

function scheduleGasPolling(delayMs) {
  if (gasPollHandle) {
    clearTimeout(gasPollHandle);
  }
  gasPollHandle = setTimeout(loadGasData, delayMs);
}

loadBtn.addEventListener("click", loadWalletData);
loadNetworkData();
loadGasData();
