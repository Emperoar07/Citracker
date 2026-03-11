import { env } from "../config.js";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Explorer HTTP ${res.status}`);
  }
  return res.json();
}

function buildUrl(baseUrl, apiKey, params) {
  const u = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") {
      u.searchParams.set(k, String(v));
    }
  });
  if (apiKey) u.searchParams.set("apikey", apiKey);
  return u.toString();
}

async function fetchEtherscanLikeTxCount({ baseUrl, apiKey, wallet, startTimestamp, endTimestamp }) {
  if (!baseUrl) return null;

  const common = {
    module: "account",
    action: "txlist",
    address: wallet,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 10000,
    sort: "asc"
  };

  const url = buildUrl(baseUrl, apiKey, common);
  const data = await fetchJson(url);

  if (!data || data.status === "0" || !Array.isArray(data.result)) {
    return 0;
  }

  const start = Math.floor(startTimestamp / 1000);
  const end = Math.floor(endTimestamp / 1000);

  return data.result.reduce((acc, tx) => {
    const ts = Number(tx.timeStamp || 0);
    if (ts >= start && ts <= end) return acc + 1;
    return acc;
  }, 0);
}

async function fetchBlockscoutV2TxCount({ baseUrl, wallet, startTimestamp, endTimestamp }) {
  if (!baseUrl) return null;

  const start = Math.floor(startTimestamp / 1000);
  const end = Math.floor(endTimestamp / 1000);
  let nextPageParams = null;
  let count = 0;

  do {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/addresses/${wallet}/transactions`);
    if (nextPageParams && typeof nextPageParams === "object") {
      Object.entries(nextPageParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const data = await fetchJson(url.toString());
    const items = Array.isArray(data?.items) ? data.items : [];

    for (const tx of items) {
      const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
      if (Number.isFinite(ts) && ts >= start && ts <= end) {
        count += 1;
      }
    }

    nextPageParams = data?.next_page_params || null;
  } while (nextPageParams);

  return count;
}

export async function getExplorerEnhancements(wallet, fromIso, toIso) {
  if (!env.enableExplorerEnrichment) {
    return { enabled: false };
  }

  const startTimestamp = new Date(fromIso).getTime();
  const endTimestamp = new Date(toIso).getTime();

  const out = {
    enabled: true,
    eth_tx_count: null,
    citrea_tx_count: null,
    errors: []
  };

  try {
    out.eth_tx_count = await fetchEtherscanLikeTxCount({
      baseUrl: env.etherscanApiUrl,
      apiKey: env.etherscanApiKey,
      wallet,
      startTimestamp,
      endTimestamp
    });
  } catch (err) {
    out.errors.push(`etherscan:${err.message}`);
  }

  try {
    if (env.citreascanApiUrl.includes("/api/v2")) {
      out.citrea_tx_count = await fetchBlockscoutV2TxCount({
        baseUrl: env.citreascanApiUrl,
        wallet,
        startTimestamp,
        endTimestamp
      });
    } else {
      out.citrea_tx_count = await fetchEtherscanLikeTxCount({
        baseUrl: env.citreascanApiUrl,
        apiKey: env.citreascanApiKey,
        wallet,
        startTimestamp,
        endTimestamp
      });
    }
  } catch (err) {
    out.errors.push(`citreascan:${err.message}`);
  }

  return out;
}
