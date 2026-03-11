const walletInput = document.getElementById("walletInput");
const fromInput = document.getElementById("fromInput");
const toInput = document.getElementById("toInput");
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

const now = new Date();
const prior = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
fromInput.value = prior.toISOString().slice(0, 16);
toInput.value = now.toISOString().slice(0, 16);

let walletChart;
let networkPollHandle = null;

function isoFromLocal(value) {
  return new Date(value).toISOString();
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
  statusEl.style.color = isError ? "#b91c1c" : "#536471";
}

function setNetworkStatus(text, isError = false) {
  networkStatusEl.textContent = text;
  networkStatusEl.style.color = isError ? "#b91c1c" : "#536471";
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

function renderWalletChart(series) {
  const labels = series.points.map((point) => new Date(point.ts).toLocaleDateString());
  const bridge = series.points.map((point) => Number(point.bridge_volume_usd || 0));
  const dex = series.points.map((point) => Number(point.dex_volume_usd || 0));
  const gas = series.points.map((point) => Number(point.gas_total_usd || 0));

  if (walletChart) walletChart.destroy();
  walletChart = new Chart(document.getElementById("activityChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Bridge Volume USD",
          data: bridge,
          borderColor: "#0057ff",
          backgroundColor: "rgba(0, 87, 255, 0.12)",
          tension: 0.25
        },
        {
          label: "DEX Volume USD",
          data: dex,
          borderColor: "#0f9d7a",
          backgroundColor: "rgba(15, 157, 122, 0.12)",
          tension: 0.25
        },
        {
          label: "Gas USD",
          data: gas,
          borderColor: "#f97316",
          backgroundColor: "rgba(249, 115, 22, 0.12)",
          tension: 0.25
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
  setNetworkStatus(payload.errors.length ? payload.errors.join(" | ") : "Citrea mainnet panel synced.", payload.errors.length > 0);
}

async function loadWalletData() {
  const wallet = walletInput.value.trim();
  if (!wallet) {
    setStatus("Paste a wallet address first.", true);
    return;
  }

  const from = isoFromLocal(fromInput.value);
  const to = isoFromLocal(toInput.value);
  const base = `/api/v1/wallet/${wallet}`;
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  setStatus("Loading wallet data...");

  try {
    const [summaryRes, seriesRes, transfersRes, swapsRes, gasRes] = await Promise.all([
      fetch(`${base}/summary?${query}`),
      fetch(`${base}/timeseries?${query}&interval=1d`),
      fetch(`${base}/transfers?${query}&limit=20`),
      fetch(`${base}/swaps?${query}&limit=20`),
      fetch(`${base}/gas?${query}&chain=all&category=all&limit=20`)
    ]);

    const [summary, series, transfers, swaps, gas] = await Promise.all([
      summaryRes.json(),
      seriesRes.json(),
      transfersRes.json(),
      swapsRes.json(),
      gasRes.json()
    ]);

    if (!summaryRes.ok) throw new Error(summary.error || "Summary request failed");
    if (!seriesRes.ok) throw new Error(series.error || "Timeseries request failed");
    if (!transfersRes.ok) throw new Error(transfers.error || "Transfers request failed");
    if (!swapsRes.ok) throw new Error(swaps.error || "Swaps request failed");
    if (!gasRes.ok) throw new Error(gas.error || "Gas request failed");

    renderKpis(summary);
    renderWalletChart(series);
    renderWalletTables(transfers, swaps, gas);

    const explorerText = summary.explorer?.enabled
      ? ` Explorer counts: ETH ${summary.explorer.eth_tx_count ?? "n/a"}, Citrea ${summary.explorer.citrea_tx_count ?? "n/a"}.`
      : "";

    setStatus(`Loaded wallet ${wallet}.${explorerText}`);
  } catch (error) {
    setStatus(error.message || "Failed to load wallet data.", true);
  }
}

async function loadNetworkData() {
  try {
    const response = await fetch("/api/v1/network/summary");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Network summary request failed");
    }

    renderNetworkSummary(payload);
    scheduleNetworkPolling(payload.refresh_ms || 60000);
  } catch (error) {
    setNetworkStatus(error.message || "Failed to load Citrea mainnet panel.", true);
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
