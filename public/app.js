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

const transfersTbody = document.querySelector("#transfersTable tbody");
const swapsTbody = document.querySelector("#swapsTable tbody");
const gasTbody = document.querySelector("#gasTable tbody");
const tokenSpendTbody = document.querySelector("#tokenSpendTable tbody");

let walletChart;
let networkPollHandle = null;

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

function shortHash(hash) {
  if (!hash) return "-";
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
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

function percent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${(n * 100).toFixed(2)}%`;
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
    ["Bridge Inflow (USD)", summary.bridge.inflow_usd],
    ["Bridge Outflow (USD)", summary.bridge.outflow_usd],
    ["Netflow (USD)", summary.bridge.netflow_usd],
    ["Bridge Volume (USD)", summary.bridge.volume_usd],
    ["DEX Volume (USD)", summary.dex.swap_volume_usd],
    ["DEX Swap Count", summary.dex.swap_count],
    ["Citrea Tx Count", summary.citrea_total_tx_count],
    ["Total Activity (USD)", summary.total_activity_volume_usd],
    ["Gas L1 (Native)", summary.gas.l1_native],
    ["Gas L2 (Native)", summary.gas.l2_native],
    ["Gas Total (USD)", summary.gas.total_usd]
  ];

  kpiEl.innerHTML = cards
    .map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${money(value)}</div></div>`)
    .join("");
}

function renderWalletComposition(summary) {
  const labels = ["Bridge Volume", "DEX Volume", "Gas Total"];
  const values = [
    Number(summary.bridge.volume_usd || 0),
    Number(summary.dex.swap_volume_usd || 0),
    Number(summary.gas.total_usd || 0)
  ];

  if (walletChart) walletChart.destroy();
  walletChart = new Chart(document.getElementById("activityChart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: ["#ff890a", "#ccff00", "#f4d4a4"],
          borderColor: ["#2a221c", "#2a221c", "#2a221c"],
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom"
        }
      }
    }
  });
}

function fillRows(tbody, rowsHtml, colspan) {
  tbody.innerHTML = rowsHtml || `<tr><td colspan="${colspan}">No data</td></tr>`;
}

function renderWalletTables(transfers, swaps, gas) {
  fillRows(
    transfersTbody,
    transfers.items
      .map((item) => `
        <tr>
          <td>${new Date(item.block_timestamp).toLocaleString()}</td>
          <td>${item.direction}</td>
          <td>${item.token || "-"}</td>
          <td>${number(item.amount)}</td>
          <td>${money(item.amount_usd)}</td>
          <td title="${item.source_tx_hash}">${shortHash(item.source_tx_hash)}</td>
        </tr>`)
      .join(""),
    6
  );

  fillRows(
    swapsTbody,
    swaps.items
      .map((item) => `
        <tr>
          <td>${new Date(item.block_timestamp).toLocaleString()}</td>
          <td>${item.dex}</td>
          <td>${item.token_in || "-"} ${number(item.token_in_amount)}</td>
          <td>${item.token_out || "-"} ${number(item.token_out_amount)}</td>
          <td>${money(item.swap_volume_usd)}</td>
          <td title="${item.tx_hash}">${shortHash(item.tx_hash)}</td>
        </tr>`)
      .join(""),
    6
  );

  fillRows(
    gasTbody,
    gas.items
      .map((item) => `
        <tr>
          <td>${new Date(item.block_timestamp).toLocaleString()}</td>
          <td>${item.chain_id}</td>
          <td>${item.tx_category || "other"}</td>
          <td>${number(item.fee_native, 8)}</td>
          <td>${money(item.fee_usd)}</td>
          <td title="${item.tx_hash}">${shortHash(item.tx_hash)}</td>
        </tr>`)
      .join(""),
    6
  );
}

function renderNetworkSummary(payload) {
  const metrics = payload.citrea;
  const cards = [
    ["Total Inflow (USD)", metrics.total_inflow_usd],
    ["Total Outflow (USD)", metrics.total_outflow_usd],
    ["Netflow (USD)", metrics.netflow_usd],
    ["Citrea TVL (USD)", metrics.chain_tvl_usd],
    ["Bridge TVL (USD)", metrics.bridge_total_usd],
    ["Users", metrics.total_users],
    ["Transactions", metrics.total_transactions],
    ["Tx Today", metrics.transactions_today],
    ["DEX 24h (USD)", metrics.dex_volume_24h_usd],
    ["All Token Spend (USD)", metrics.overall_token_spent_usd],
    ["Gas Spent (USD)", metrics.total_gas_spent_usd],
    ["Swap Count", metrics.total_swap_count]
  ];

  networkKpisEl.innerHTML = cards
    .map(([label, value]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${money(value)}</div></div>`)
    .join("");

  bridgeOriginsEl.innerHTML = [
    ["From BTC Chain (USD)", metrics.bridge_from_btc_usd],
    ["From EVM Chains (USD)", metrics.bridge_from_evm_usd],
    ["Bridge Volume Indexed (USD)", metrics.total_bridge_volume_usd],
    ["DEX Volume All Time (USD)", metrics.dex_volume_all_time_usd],
    ["Average Block Time", `${number(metrics.average_block_time_ms, 0)} ms`],
    ["Network Utilization", percent(metrics.network_utilization_percentage)]
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
      <div class="metric-row">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${value}</span>
      </div>`)
    .join("");

  sourceHealthEl.innerHTML = Object.entries(payload.sources)
    .map(([source, status]) => `
      <div class="metric-row">
        <span class="metric-label">${source.replace(/_/g, " ")}</span>
        <span class="metric-value ${status === "ok" ? "source-ok" : "source-error"}">${status}</span>
      </div>`)
    .join("");

  fillRows(
    tokenSpendTbody,
    metrics.token_spend_breakdown
      .map((item) => `
        <tr>
          <td>${item.token}</td>
          <td>${number(item.amount_spent)}</td>
          <td>${money(item.amount_spent_usd)}</td>
        </tr>`)
      .join(""),
    3
  );

  networkUpdatedAtEl.textContent = `Updated ${new Date(payload.updated_at).toLocaleString()}`;
  gasPriceUpdatedAtEl.textContent = metrics.gas_price_updated_at
    ? `Explorer gas update ${new Date(metrics.gas_price_updated_at).toLocaleTimeString()}`
    : "Explorer gas update unavailable";
  networkLiveLabelEl.textContent = `Polling every ${Math.max(Math.round(payload.refresh_ms / 1000), 1)}s`;
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
    const [summary, transfers, swaps, gas] = await Promise.all([
      fetchJsonOrThrow(`${base}/summary`),
      fetchJsonOrThrow(`${base}/transfers?limit=20`),
      fetchJsonOrThrow(`${base}/swaps?limit=20`),
      fetchJsonOrThrow(`${base}/gas?chain=all&category=all&limit=20`)
    ]);

    renderKpis(summary);
    renderWalletComposition(summary);
    renderWalletTables(transfers, swaps, gas);

    setStatus(`Loaded all-time totals for ${wallet}.`);
  } catch (error) {
    setStatus(friendlyErrorMessage(error.message, "Failed to load wallet data."), true);
  }
}

async function loadNetworkData() {
  try {
    const payload = await fetchJsonOrThrow("/api/v1/network/summary");
    renderNetworkSummary(payload);
    scheduleNetworkPolling(payload.refresh_ms || 60000);
  } catch (error) {
    setNetworkStatus(friendlyErrorMessage(error.message, "Failed to load Citrea mainnet panel."), true);
    scheduleNetworkPolling(60000);
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
