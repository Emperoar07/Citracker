import { env } from "../config.js";
import { ethers } from "ethers";
import { getPool } from "../db.js";
import { resolveNativeUsdPrice, resolveTokenUsdPrice } from "./priceService.js";

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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const tokenMetadataCache = new Map();
const STATIC_DEX_DESTINATIONS = new Set([
  "0x565ed3d57fe40f78a46f348c220121ae093c3cf8",
  "0x6bdea31c89e0a202ce84b5752bb2e827b39984ae",
  "0xafcfd58fe17beb0c9d15c51d19519682dfcdaab9",
  "0x274602a953847d807231d2370072f5f4e4594b44"
]);
const STATIC_ROUTER_DESTINATIONS = new Set(STATIC_DEX_DESTINATIONS);
let trackedDexCache = { value: null, loadedAt: 0 };

function shortAddress(address) {
  if (!address || typeof address !== "string") return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeAddress(value) {
  if (!value) return null;
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "object" && typeof value.hash === "string") return value.hash.toLowerCase();
  return null;
}

function findDecodedParam(tx, ...names) {
  const params = Array.isArray(tx?.decoded_input?.parameters) ? tx.decoded_input.parameters : [];
  for (const name of names) {
    const match = params.find((item) => item?.name === name);
    if (match) return match.value;
  }
  return null;
}

async function fetchBlockscoutTransactions({ baseUrl, wallet, startTimestamp, endTimestamp, maxItems }) {
  if (!baseUrl) return [];

  const start = Math.floor(startTimestamp / 1000);
  const end = Math.floor(endTimestamp / 1000);
  let nextPageParams = null;
  let items = [];

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
    const pageItems = Array.isArray(data?.items) ? data.items : [];

    for (const tx of pageItems) {
      const ts = Math.floor(new Date(tx.timestamp).getTime() / 1000);
      if (Number.isFinite(ts) && ts >= start && ts <= end) {
        items.push(tx);
        if (maxItems && items.length >= maxItems) {
          return items;
        }
      }
    }

    nextPageParams = data?.next_page_params || null;
  } while (nextPageParams);

  return items;
}

async function fetchBlockscoutTokenTransfers({ baseUrl, wallet, startTimestamp, endTimestamp, maxItems }) {
  if (!baseUrl) return [];

  const start = Math.floor(startTimestamp / 1000);
  const end = Math.floor(endTimestamp / 1000);
  let nextPageParams = null;
  let items = [];

  do {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/addresses/${wallet}/token-transfers`);
    if (nextPageParams && typeof nextPageParams === "object") {
      Object.entries(nextPageParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const data = await fetchJson(url.toString());
    const pageItems = Array.isArray(data?.items) ? data.items : [];

    for (const transfer of pageItems) {
      const ts = Math.floor(new Date(transfer.timestamp).getTime() / 1000);
      if (Number.isFinite(ts) && ts >= start && ts <= end) {
        items.push(transfer);
        if (maxItems && items.length >= maxItems) {
          return items;
        }
      }
    }

    nextPageParams = data?.next_page_params || null;
  } while (nextPageParams);

  return items;
}

async function getTokenMetadata(baseUrl, address) {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized === ZERO_ADDRESS) {
    return { symbol: "cBTC", decimals: 18 };
  }

  if (tokenMetadataCache.has(normalized)) {
    return tokenMetadataCache.get(normalized);
  }

  try {
    const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/tokens/${normalized}`);
    const meta = {
      symbol: data?.symbol || shortAddress(normalized),
      decimals: Number(data?.decimals || 18)
    };
    tokenMetadataCache.set(normalized, meta);
    return meta;
  } catch {
    const fallback = { symbol: shortAddress(normalized), decimals: 18 };
    tokenMetadataCache.set(normalized, fallback);
    return fallback;
  }
}

async function getTrackedDexDestinations() {
  const now = Date.now();
  if (trackedDexCache.value && now - trackedDexCache.loadedAt < 60_000) {
    return trackedDexCache.value;
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT contract_address
     FROM tracked_dex_contracts
     WHERE chain_id = $1
       AND is_active = TRUE
       AND contract_role IN ('router', 'pair', 'pool')`,
    [env.citreaChainId]
  );

  const tracked = new Set(STATIC_DEX_DESTINATIONS);
  const routers = new Set(STATIC_ROUTER_DESTINATIONS);
  for (const row of result.rows) {
    const normalized = normalizeAddress(row.contract_address);
    if (!normalized) continue;
    tracked.add(normalized);
    if (String(row.contract_role || "").toLowerCase() === "router") {
      routers.add(normalized);
    }
  }

  trackedDexCache = { value: { all: tracked, routers }, loadedAt: now };
  return trackedDexCache.value;
}

function getTransferAmountDecimal(transfer) {
  const decimals = Number(transfer?.total?.decimals || transfer?.token?.decimals || 18);
  const value = transfer?.total?.value || "0";
  return Number(ethers.formatUnits(value, decimals));
}

async function buildPricedTransferCandidate(transfer, timestamp) {
  const symbol = transfer?.token?.symbol || null;
  if (!symbol) return null;

  const price = await resolveTokenUsdPrice(symbol, timestamp).catch(() => null);
  if (!price) return null;

  const amount = getTransferAmountDecimal(transfer);
  return {
    symbol,
    amount,
    usd: amount * price.price
  };
}

function maxUsdCandidate(candidates) {
  const valid = candidates.filter((item) => item && Number.isFinite(item.usd));
  if (!valid.length) return null;
  return valid.sort((a, b) => b.usd - a.usd)[0];
}

function hasSwapKeyword(tx) {
  const method = String(tx?.method || tx?.decoded_input?.method_call || "").toLowerCase();
  return method.includes("swap");
}

function looksLikeDexExecution(tx) {
  const types = Array.isArray(tx?.transaction_types) ? tx.transaction_types : [];
  return types.includes("contract_call") && types.includes("token_transfer");
}

function getSwapClassification(
  tx,
  walletAddress,
  txTransfers,
  trackedRegistry = { all: STATIC_DEX_DESTINATIONS, routers: STATIC_ROUTER_DESTINATIONS }
) {
  const trackedDestinations = trackedRegistry?.all || STATIC_DEX_DESTINATIONS;
  const trackedRouters = trackedRegistry?.routers || STATIC_ROUTER_DESTINATIONS;
  const destination =
    normalizeAddress(tx?.to?.hash) ||
    normalizeAddress(tx?.to) ||
    normalizeAddress(tx?.created_contract?.hash);

  if (!destination || !trackedDestinations.has(destination)) {
    return {
      isSwap: false,
      destination,
      walletOutTransfers: [],
      walletInTransfers: [],
      hasNativeInput: false,
      methodHasSwapKeyword: hasSwapKeyword(tx)
    };
  }

  const walletOutTransfers = txTransfers.filter(
    (transfer) => normalizeAddress(transfer?.from?.hash || transfer?.from) === walletAddress
  );
  const walletInTransfers = txTransfers.filter(
    (transfer) => normalizeAddress(transfer?.to?.hash || transfer?.to) === walletAddress
  );
  const hasNativeInput = BigInt(tx?.value || "0") > 0n;
  const methodHasSwapKeyword = hasSwapKeyword(tx);
  const routerOneSidedSwap =
    trackedRouters.has(destination) &&
    walletOutTransfers.length > 0 &&
    looksLikeDexExecution(tx);
  const isSwap =
    methodHasSwapKeyword ||
    (walletInTransfers.length > 0 && (walletOutTransfers.length > 0 || hasNativeInput)) ||
    routerOneSidedSwap;

  return {
    isSwap,
    destination,
    walletOutTransfers,
    walletInTransfers,
    hasNativeInput,
    methodHasSwapKeyword,
    routerOneSidedSwap
  };
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

  const items = await fetchBlockscoutTransactions({ baseUrl, wallet, startTimestamp, endTimestamp });
  return items.length;
}

export async function getExplorerEnhancements(wallet, fromIso, toIso) {
  const citreaEnabled = Boolean(env.citreascanApiUrl);
  const ethEnabled = env.enableExplorerEnrichment && Boolean(env.etherscanApiUrl);

  if (!citreaEnabled && !ethEnabled) {
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

  if (ethEnabled) {
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

export async function getCitreaExplorerActivity(wallet, fromIso, toIso, options = {}) {
  if (!env.citreascanApiUrl) {
    return {
      enabled: false,
      tx_count: 0,
      swap_count: 0,
      gas_total_native: "0",
      gas_total_usd: "0",
      swap_volume_usd_total: "0",
      gas_items: [],
      swap_items: []
    };
  }

  const startTimestamp = new Date(fromIso).getTime();
  const endTimestamp = new Date(toIso).getTime();
  const limit = Number(options.limit || 20);
  const walletAddress = normalizeAddress(wallet);
  const trackedDexDestinations = await getTrackedDexDestinations();
  const [transactions, tokenTransfers] = await Promise.all([
    fetchBlockscoutTransactions({
      baseUrl: env.citreascanApiUrl,
      wallet,
      startTimestamp,
      endTimestamp
    }),
    fetchBlockscoutTokenTransfers({
      baseUrl: env.citreascanApiUrl,
      wallet,
      startTimestamp,
      endTimestamp
    })
  ]);

  const swapTransfersByHash = new Map();
  for (const transfer of tokenTransfers) {
    const txHash = String(transfer?.transaction_hash || "").toLowerCase();
    if (!txHash) continue;
    const list = swapTransfersByHash.get(txHash) || [];
    list.push(transfer);
    swapTransfersByHash.set(txHash, list);
  }

  let gasTotalWei = 0n;
  let gasTotalUsd = 0;
  let swapVolumeUsdTotal = 0;
  let swapCount = 0;
  const gasItems = [];
  const swapItems = [];

  for (const tx of transactions) {
    const feeWei = BigInt(tx?.fee?.value || "0");
    gasTotalWei += feeWei;
    const txTransfers = swapTransfersByHash.get(String(tx.hash || "").toLowerCase()) || [];
    const classification = getSwapClassification(tx, walletAddress, txTransfers, trackedDexDestinations);
    const gasUsdPrice = await resolveNativeUsdPrice(env.citreaChainId, tx.timestamp).catch(() => null);
    if (gasUsdPrice) {
      gasTotalUsd += Number(ethers.formatEther(feeWei)) * gasUsdPrice.price;
    }

    if (gasItems.length < limit) {
      gasItems.push({
        chain_id: env.citreaChainId,
        tx_hash: tx.hash,
        gas_used: tx.gas_used || "0",
        effective_gas_price_wei: tx.gas_price || "0",
        fee_native: ethers.formatEther(feeWei),
        fee_usd: gasUsdPrice ? String(Number(ethers.formatEther(feeWei)) * gasUsdPrice.price) : null,
        tx_category: classification.isSwap ? "dex" : "other",
        block_timestamp: tx.timestamp
      });
    }

    if (classification.isSwap) {
      swapCount += 1;
      const tokenInAddress = findDecodedParam(tx, "tokenIn");
      const tokenOutAddress = findDecodedParam(tx, "tokenOut");
      const amountInRaw = findDecodedParam(tx, "amountIn") || "0";
      const amountOutRaw =
        findDecodedParam(tx, "amountOut", "amountOutMinimum", "minAmountOut", "amountOutMin") || "0";
      const [pricedWalletOut, pricedWalletIn] = await Promise.all([
        Promise.all(classification.walletOutTransfers.map((transfer) => buildPricedTransferCandidate(transfer, tx.timestamp))),
        Promise.all(classification.walletInTransfers.map((transfer) => buildPricedTransferCandidate(transfer, tx.timestamp)))
      ]);

      let exactInput = maxUsdCandidate(pricedWalletOut);
      const exactOutput = maxUsdCandidate(pricedWalletIn);

      if (!exactInput && classification.hasNativeInput) {
        const nativeAmount = Number(ethers.formatEther(tx.value));
        const nativePrice = await resolveNativeUsdPrice(env.citreaChainId, tx.timestamp).catch(() => null);
        if (nativePrice) {
          exactInput = {
            symbol: "cBTC",
            amount: nativeAmount,
            usd: nativeAmount * nativePrice.price
          };
        }
      }

      const [tokenInMeta, tokenOutMeta] = await Promise.all([
        getTokenMetadata(env.citreascanApiUrl, tokenInAddress),
        getTokenMetadata(env.citreascanApiUrl, tokenOutAddress)
      ]);
      const [tokenInPrice, tokenOutPrice] = await Promise.all([
        resolveTokenUsdPrice(tokenInMeta.symbol, tx.timestamp).catch(() => null),
        resolveTokenUsdPrice(tokenOutMeta.symbol, tx.timestamp).catch(() => null)
      ]);
      const fallbackInputAmount = Number(ethers.formatUnits(amountInRaw, tokenInMeta.decimals));
      const fallbackOutputAmount = Number(ethers.formatUnits(amountOutRaw, tokenOutMeta.decimals));
      const fallbackVolumeUsd =
        tokenInPrice
          ? fallbackInputAmount * tokenInPrice.price
          : tokenOutPrice
            ? fallbackOutputAmount * tokenOutPrice.price
            : null;

      const swapVolumeUsd = exactInput?.usd ?? exactOutput?.usd ?? fallbackVolumeUsd;

      if (swapVolumeUsd !== null) {
        swapVolumeUsdTotal += swapVolumeUsd;
      }

      if (swapItems.length < limit) {
        swapItems.push({
          dex: tx?.to?.name || tx?.method || "swap",
          token_in: exactInput?.symbol || tokenInMeta.symbol,
          token_out: exactOutput?.symbol || tokenOutMeta.symbol,
          token_in_amount: String(exactInput?.amount ?? fallbackInputAmount),
          token_out_amount: String(exactOutput?.amount ?? fallbackOutputAmount),
          swap_volume_usd: swapVolumeUsd === null ? null : String(swapVolumeUsd),
          tx_hash: tx.hash,
          block_timestamp: tx.timestamp
        });
      }
    }
  }

  return {
    enabled: true,
    tx_count: transactions.length,
    swap_count: swapCount,
    gas_total_native: ethers.formatEther(gasTotalWei),
    gas_total_usd: String(gasTotalUsd),
    swap_volume_usd_total: String(swapVolumeUsdTotal),
    gas_items: gasItems,
    swap_items: swapItems
  };
}
