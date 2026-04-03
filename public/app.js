const walletInput = document.getElementById("walletInput");
const loadBtn = document.getElementById("loadBtn");
const statusEl = document.getElementById("status");
const bridgeSourceInfoEl = document.getElementById("bridgeSourceInfo");
const kpiEl = document.getElementById("kpis");
const walletBalancesEl = document.getElementById("walletBalances");
const walletTopAppsEl = document.getElementById("walletTopApps");
const walletTopApps24hEl = document.getElementById("walletTopApps24h");

function friendlyErrorMessage(message, fallback) {
  if (!message) return fallback;
  if (message.includes("DATABASE_URL is required")) {
    return "Indexed wallet database is not connected yet.";
  }
  return message;
}

async function fetchJsonOrThrow(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" }
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

function number(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTrackedName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown App";

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
        <div class="metric-value metric-value-left">${formatTrackedName(item.app)}</div>
        <div class="metric-label">${walletUsageMeta(item)}</div>
      </div>
      <span class="metric-value">${money(item.tx_count)} tx</span>
    </div>`);
}

function renderWalletTopApps24h(summary) {
  renderMetricList(walletTopApps24hEl, summary?.usage?.top_apps || [], (item) => `
    <div class="metric-row metric-row-stack">
      <div>
        <div class="metric-value metric-value-left">${formatTrackedName(item.app)}</div>
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

loadBtn.addEventListener("click", loadWalletData);
