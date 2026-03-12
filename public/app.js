const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const statusEl = document.getElementById("status");
const kpiEl = document.getElementById("kpis");

const networkStatusEl = document.getElementById("networkStatus");
const networkKpisEl = document.getElementById("networkKpis");
const networkUpdatedAtEl = document.getElementById("networkUpdatedAt");
const networkLiveLabelEl = document.getElementById("networkLiveLabel");
const bridgeOriginsEl = document.getElementById("bridgeOrigins");
const gasPriceMetricsEl = document.getElementById("gasPriceMetrics");
const gasPriceUpdatedAtEl = document.getElementById("gasPriceUpdatedAt");
const sourceHealthEl = document.getElementById("sourceHealth");

let networkPollHandle = null;

function formatRefreshInterval(ms) {
  const minutes = Math.max(Math.round(Number(ms || 0) / 60000), 1);
  return `Refreshes every ${minutes}m`;
}

function friendlyErrorMessage(message, fallback) {
  if (!message) return fallback;
  if (message.includes("DATABASE_URL is required")) {
    return "Indexed wallet database is not connected yet. Chain-wide live metrics are available, but wallet-level totals need the Postgres index.";
  }
  return message;
}

async function fetchJsonOrThrow(url) {
  const response = await fetch(url);
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

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#ff6b6b" : "#c8b59d";
}

function setNetworkStatus(text, isError = false) {
  networkStatusEl.textContent = text;
  networkStatusEl.style.color = isError ? "#ff6b6b" : "#c8b59d";
}

function renderKpis(summary) {
  const cards = [
    ["Bridge Tx Count", summary.bridge.tx_count],
    ["Bridge Inflow (USDT)", summary.bridge.inflow_usd],
    ["Bridge Outflow (USDT)", summary.bridge.outflow_usd],
    ["Bridge Value (USDT)", summary.bridge.volume_usd],
    ["Total Wallet Volume (USDT)", summary.total_activity_volume_usd],
    ["DEX Swap Count", summary.dex.swap_count],
    ["App Activity Count", summary.apps.tx_count],
    ["Citrea Tx Count", summary.citrea_total_tx_count],
  ];

  kpiEl.innerHTML = cards
    .map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${money(value)}</div></div>`)
    .join("");
}

function renderNetworkSummary(payload) {
  const metrics = payload.citrea;
  const todayLabel = metrics.transactions_today_date
    ? `Tx Today (${shortDateLabel(metrics.transactions_today_date)})`
    : "Tx Today";
  const cards = [
    ["Indexed Volume (USD)", metrics.total_activity_volume_usd],
    ["Indexed Inflow (USD)", metrics.total_inflow_usd],
    ["Citrea TVL (USD)", metrics.chain_tvl_usd],
    ["Bridge TVL (USD)", metrics.bridge_total_usd],
    ["Users", metrics.total_users],
    ["Total Chain Transactions", metrics.total_transactions],
    [todayLabel, metrics.transactions_today],
    ["DEX 24h (USD)", metrics.dex_volume_24h_usd]
  ];

  networkKpisEl.innerHTML = cards
    .map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${money(value)}</div></div>`)
    .join("");

  bridgeOriginsEl.innerHTML = [
    ["From BTC Chain (USD)", metrics.bridge_from_btc_usd],
    ["From EVM Chains (USD)", metrics.bridge_from_evm_usd],
    ["Bridge Volume Indexed (USD)", metrics.total_bridge_volume_usd],
    ["DEX Volume All Time (USD)", metrics.dex_volume_all_time_usd]
  ]
    .map(([label, value]) => `
      <div class="metric-row">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${typeof value === "string" ? value : money(value)}</span>
      </div>`)
    .join("");

  gasPriceMetricsEl.innerHTML = [
    ["Slow", `${number(metrics.gas_prices?.slow, 4)} gwei`],
    ["Average", `${number(metrics.gas_prices?.average, 4)} gwei`],
    ["Fast", `${number(metrics.gas_prices?.fast, 4)} gwei`],
    ["Gas Used Today", number(metrics.gas_used_today, 0)]
  ]
    .map(([label, value]) => `
      <div class="gas-stat">
        <span class="gas-stat-label">${label}</span>
        <span class="gas-stat-value">${value}</span>
      </div>`)
    .join("");

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
  gasPriceUpdatedAtEl.textContent = metrics.gas_price_updated_at
    ? `Explorer gas update ${new Date(metrics.gas_price_updated_at).toLocaleTimeString()}`
    : "Explorer gas update unavailable";
  networkLiveLabelEl.textContent = formatRefreshInterval(payload.refresh_ms);
  const statusText = payload.errors.length
    ? friendlyErrorMessage(payload.errors.join(" | "), "Citrea mainnet panel synced.")
    : "Citrea mainnet panel synced.";
  const isOnlyIndexedDbGap =
    payload.errors.length === 1 && payload.errors[0].includes("DATABASE_URL is required");
  setNetworkStatus(statusText, payload.errors.length > 0 && !isOnlyIndexedDbGap);
}

async function loadWalletData() {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    setStatus("Paste a wallet address first.", true);
    return;
  }

  const base = `/api/v1/wallet/${wallet}`;
  setStatus("Loading all-time wallet totals...");

  try {
    const summary = await fetchJsonOrThrow(`${base}/summary`);

    renderKpis(summary);

    setStatus(`Loaded all-time totals for ${wallet}.`);
  } catch (error) {
    setStatus(friendlyErrorMessage(error.message, "Failed to load wallet data."), true);
  }
}

async function loadNetworkData() {
  try {
    const payload = await fetchJsonOrThrow("/api/v1/network/summary");
    renderNetworkSummary(payload);
    scheduleNetworkPolling(payload.refresh_ms || 300000);
  } catch (error) {
    setNetworkStatus(friendlyErrorMessage(error.message, "Failed to load Citrea mainnet panel."), true);
    scheduleNetworkPolling(300000);
  }
}

function scheduleNetworkPolling(delayMs) {
  if (networkPollHandle) {
    clearTimeout(networkPollHandle);
  }
  networkPollHandle = setTimeout(loadNetworkData, delayMs);
}

loadBtn.addEventListener("click", loadWalletData);
loadNetworkData();
