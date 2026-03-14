import { env } from "../config.js";
import { ethers } from "ethers";
import { getPool } from "../db.js";
import { resolveNativeUsdPrice, resolveTokenUsdPrice, resolveTokenUsdPriceSpot } from "./priceService.js";
import { getCitreaMetricAppConfigs } from "./sourceRegistry.js";

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(env.externalFetchTimeoutMs)
  });
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
const addressMetadataCache = new Map();
const STATIC_DEX_DESTINATIONS = new Set([
  "0x565ed3d57fe40f78a46f348c220121ae093c3cf8",
  "0x6bdea31c89e0a202ce84b5752bb2e827b39984ae",
  "0xafcfd58fe17beb0c9d15c51d19519682dfcdaab9",
  "0x274602a953847d807231d2370072f5f4e4594b44"
]);
const STATIC_ROUTER_DESTINATIONS = new Set(STATIC_DEX_DESTINATIONS);
const STATIC_DEX_LABELS = new Map([
  ["0x565ed3d57fe40f78a46f348c220121ae093c3cf8", "JuiceSwap"],
  ["0x6bdea31c89e0a202ce84b5752bb2e827b39984ae", "JuiceSwap"],
  ["0xafcfd58fe17beb0c9d15c51d19519682dfcdaab9", "JuiceSwap"],
  ["0x274602a953847d807231d2370072f5f4e4594b44", "Fibrous"]
]);
let trackedDexCache = { value: null, loadedAt: 0 };
let trackedAppCache = { value: null, loadedAt: 0 };
const transactionTransferCache = new Map();
const ETH_BLOCKSCOUT_V2_URL = "https://eth.blockscout.com/api/v2";
const STATIC_BRIDGE_DESTINATIONS = new Set([
  "0x41710804cab0974638e1504db723d7bddec22e30",
  "0xf8b5983bfa11dc763184c96065d508ae1502c030",
  "0xdf240dc08b0fdad1d93b74d5048871232f6bea3d",
  "0x3100000000000000000000000000000000000002",
  "0x8d11020286af9ecf7e5d7bd79699c391b224a0bd",
  "0xebeb7f52892df3066885f4d31137a76327f6348b"
]);
const CITREA_BTC_BALANCE_SYMBOLS = new Set(["CBTC", "WCBTC", "WCBTC.E", "WCBTCE", "SYBTC"]);

function shortAddress(address) {
  if (!address || typeof address !== "string") return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTrackedLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  const aliases = {
    fibrous: "Fibrous",
    juiceswap: "JuiceSwap",
    "juiceswap-v2": "JuiceSwap V2",
    satsuma: "Satsuma",
    symbiosis: "Symbiosis",
    generic_usd: "Generic USD"
  };
  if (aliases[key]) return aliases[key];
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

function nestedValueExists(node, matcher) {
  if (matcher(node)) return true;
  if (Array.isArray(node)) {
    return node.some((item) => nestedValueExists(item, matcher));
  }
  if (node && typeof node === "object") {
    return Object.values(node).some((value) => nestedValueExists(value, matcher));
  }
  return false;
}

function txTargetsChainId(tx, chainId) {
  const target = Number(chainId);
  if (!Number.isFinite(target)) return false;
  return nestedValueExists(tx?.decoded_input, (value) => {
    if (typeof value === "number") return value === target;
    if (typeof value === "string") return value === String(target);
    return false;
  });
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

async function fetchTransactionTokenTransfers({ baseUrl, txHash }) {
  const normalizedHash = String(txHash || "").toLowerCase();
  if (!normalizedHash) return [];
  if (transactionTransferCache.has(normalizedHash)) {
    return transactionTransferCache.get(normalizedHash);
  }

  try {
    const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/transactions/${normalizedHash}/token-transfers`);
    const items = Array.isArray(data?.items) ? data.items : [];
    transactionTransferCache.set(normalizedHash, items);
    return items;
  } catch {
    transactionTransferCache.set(normalizedHash, []);
    return [];
  }
}

async function fetchAddressTokenBalances(baseUrl, wallet) {
  if (!baseUrl) return [];

  try {
    const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/addresses/${wallet}/token-balances`);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
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

async function getAddressMetadata(baseUrl, address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  if (addressMetadataCache.has(normalized)) {
    return addressMetadataCache.get(normalized);
  }

  try {
    const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/addresses/${normalized}`);
    addressMetadataCache.set(normalized, data);
    return data;
  } catch {
    addressMetadataCache.set(normalized, null);
    return null;
  }
}

async function getTrackedDexDestinations() {
  const now = Date.now();
  if (trackedDexCache.value && now - trackedDexCache.loadedAt < 60_000) {
    return trackedDexCache.value;
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT contract_address, dex_name, contract_role
     FROM tracked_dex_contracts
     WHERE chain_id = $1
       AND is_active = TRUE
       AND contract_role IN ('router', 'pair', 'pool')`,
    [env.citreaChainId]
  );

  const tracked = new Set(STATIC_DEX_DESTINATIONS);
  const routers = new Set(STATIC_ROUTER_DESTINATIONS);
  const labels = new Map(STATIC_DEX_LABELS);
  for (const row of result.rows) {
    const normalized = normalizeAddress(row.contract_address);
    if (!normalized) continue;
    tracked.add(normalized);
    if (row.dex_name) {
      labels.set(normalized, formatTrackedLabel(row.dex_name));
    }
    if (String(row.contract_role || "").toLowerCase() === "router") {
      routers.add(normalized);
    }
  }

  trackedDexCache = { value: { all: tracked, routers, labels }, loadedAt: now };
  return trackedDexCache.value;
}

async function getTrackedBridgeDestinations() {
  const pool = getPool();
  const result = await pool.query(
    `SELECT contract_address
     FROM tracked_bridge_contracts
     WHERE chain_id = $1
       AND is_active = TRUE`,
    [env.citreaChainId]
  );

  const tracked = new Map();
  for (const address of STATIC_BRIDGE_DESTINATIONS) {
    tracked.set(address, "Canonical bridge");
  }
  for (const row of result.rows) {
    const normalized = normalizeAddress(row.contract_address);
    if (normalized) tracked.set(normalized, "Canonical bridge");
  }

  const trackedMetricApps = await getTrackedMetricApps();
  for (const app of trackedMetricApps.apps || []) {
    if (String(app?.walletMetrics?.category || "").toLowerCase() !== "bridge") continue;
    for (const entry of app?.walletMetrics?.addresses || []) {
      const normalized = normalizeAddress(entry.address);
      if (normalized) tracked.set(normalized, app.label);
    }
  }

  return tracked;
}

async function verifySymbiosisChainSupport(config) {
  const url = config?.api?.chainsUrl;
  if (!url) return true;

  try {
    const data = await fetchJson(url);
    const chains = Array.isArray(data) ? data : [];
    return chains.some((chain) => Number(chain?.id) === env.citreaChainId);
  } catch {
    return false;
  }
}

async function getTrackedMetricApps() {
  const now = Date.now();
  if (trackedAppCache.value && now - trackedAppCache.loadedAt < 300_000) {
    return trackedAppCache.value;
  }

  const configs = getCitreaMetricAppConfigs();
  const verifiedConfigs = await Promise.all(
    configs.map(async (config) => {
      if (config.id !== "symbiosis") return config;
      const supported = await verifySymbiosisChainSupport(config);
      return supported ? config : null;
    })
  );

  const activeApps = verifiedConfigs.filter(Boolean);
  const byAddress = new Map();

  for (const app of activeApps) {
    const mode = String(app?.walletMetrics?.mode || "destination-address").toLowerCase();
    if (mode === "source-bridge") continue;
    for (const entry of app?.walletMetrics?.addresses || []) {
      const normalized = normalizeAddress(entry.address);
      if (!normalized) continue;
      byAddress.set(normalized, {
        id: app.id,
        label: app.label,
        category: app?.walletMetrics?.category || "app",
        role: entry.role || "contract",
        address: normalized
      });
    }
  }

  trackedAppCache = {
    value: {
      apps: activeApps,
      byAddress
    },
    loadedAt: now
  };
  return trackedAppCache.value;
}

async function getSourceBridgeAppConfigs() {
  const trackedMetricApps = await getTrackedMetricApps();
  return (trackedMetricApps.apps || []).filter((app) => {
    const mode = String(app?.walletMetrics?.mode || "").toLowerCase();
    return mode === "source-bridge" && Number(app?.walletMetrics?.sourceChainId || 0) === env.ethChainId;
  });
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

async function getWalletTransferCandidatesUsd(walletOutTransfers, walletInTransfers, timestamp, nativeValue) {
  const [pricedWalletOut, pricedWalletIn] = await Promise.all([
    Promise.all(walletOutTransfers.map((transfer) => buildPricedTransferCandidate(transfer, timestamp))),
    Promise.all(walletInTransfers.map((transfer) => buildPricedTransferCandidate(transfer, timestamp)))
  ]);

  let nativeCandidate = null;
  if (BigInt(nativeValue || "0") > 0n) {
    const nativeAmount = Number(ethers.formatEther(nativeValue));
    const nativePrice = await resolveNativeUsdPrice(env.citreaChainId, timestamp).catch(() => null);
    if (nativePrice) {
      nativeCandidate = {
        symbol: "cBTC",
        amount: nativeAmount,
        usd: nativeAmount * nativePrice.price
      };
    }
  }

  return {
    out: maxUsdCandidate(pricedWalletOut),
    in: maxUsdCandidate(pricedWalletIn),
    native: nativeCandidate
  };
}

function getBestVolumeCandidate(candidates) {
  return maxUsdCandidate([candidates?.out, candidates?.in, candidates?.native]);
}

async function getTransactionTransferCandidatesUsd(txTransfers, timestamp) {
  const pricedTransfers = await Promise.all(txTransfers.map((transfer) => buildPricedTransferCandidate(transfer, timestamp)));
  return maxUsdCandidate(pricedTransfers);
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

function getSwapAttributionLabels(classification, txTransfers, trackedRegistry) {
  const labels = new Set();
  const primaryLabel =
    trackedRegistry?.labels?.get(classification?.destination) ||
    STATIC_DEX_LABELS.get(classification?.destination) ||
    null;
  if (primaryLabel) labels.add(primaryLabel);

  for (const transfer of txTransfers || []) {
    for (const candidate of [
      normalizeAddress(transfer?.from?.hash || transfer?.from),
      normalizeAddress(transfer?.to?.hash || transfer?.to)
    ]) {
      if (!candidate) continue;
      const label = trackedRegistry?.labels?.get(candidate) || STATIC_DEX_LABELS.get(candidate);
      if (label) labels.add(label);
    }
  }

  return [...labels];
}

function getAppClassification(tx, walletAddress, txTransfers, trackedApps) {
  const destination =
    normalizeAddress(tx?.to?.hash) ||
    normalizeAddress(tx?.to);
  const app = trackedApps?.byAddress?.get(destination);

  if (!app) {
    return {
      isAppActivity: false,
      destination,
      app: null,
      walletOutTransfers: [],
      walletInTransfers: [],
      hasNativeInput: false
    };
  }

  const walletOutTransfers = txTransfers.filter(
    (transfer) => normalizeAddress(transfer?.from?.hash || transfer?.from) === walletAddress
  );
  const walletInTransfers = txTransfers.filter(
    (transfer) => normalizeAddress(transfer?.to?.hash || transfer?.to) === walletAddress
  );
  const hasNativeInput = BigInt(tx?.value || "0") > 0n;
  const types = Array.isArray(tx?.transaction_types) ? tx.transaction_types : [];
  const isContractCall = types.includes("contract_call");
  const isAppActivity = walletOutTransfers.length > 0 || walletInTransfers.length > 0 || hasNativeInput || isContractCall;

  return {
    isAppActivity,
    destination,
    app,
    walletOutTransfers,
    walletInTransfers,
    hasNativeInput,
    isContractCall
  };
}

function addressLooksBridgeLike(metadata) {
  const labels = [
    metadata?.name,
    ...(Array.isArray(metadata?.implementations) ? metadata.implementations.map((item) => item?.name) : [])
  ]
    .filter(Boolean)
    .join(" ");

  return /hyp(?:erc20|native)|hyperlane|oft|bridge/i.test(labels);
}

function transferMatchesToken(a, b) {
  const tokenA = normalizeAddress(a?.token?.address_hash || a?.token?.hash || a?.token?.address);
  const tokenB = normalizeAddress(b?.token?.address_hash || b?.token?.hash || b?.token?.address);
  return Boolean(tokenA && tokenB && tokenA === tokenB);
}

async function classifyBridgeTransfer(
  transfer,
  walletAddress,
  trackedBridgeDestinations,
  txTransfersByHash,
  trackedDexDestinations
) {
  const from = normalizeAddress(transfer?.from?.hash || transfer?.from);
  const to = normalizeAddress(transfer?.to?.hash || transfer?.to);
  const txHash = String(transfer?.transaction_hash || "").toLowerCase();
  if (!txHash || (!from && !to)) return null;

  let direction = null;
  let counterparty = null;
  if (to === walletAddress && from && from !== walletAddress) {
    direction = "inflow";
    counterparty = from;
  } else if (from === walletAddress && to && to !== walletAddress) {
    direction = "outflow";
    counterparty = to;
  } else {
    return null;
  }

  const counterpartyMeta = await getAddressMetadata(env.citreascanApiUrl, counterparty);
  const trackedSource = trackedBridgeDestinations.get(counterparty) || null;
  const isBridgeLike = Boolean(trackedSource) || addressLooksBridgeLike(counterpartyMeta);
  let sourceLabel = trackedSource || "Bridge flow";

  if (!isBridgeLike && direction === "inflow") {
    const isKnownDexCounterparty =
      Boolean(trackedDexDestinations?.all?.has(counterparty)) || STATIC_DEX_DESTINATIONS.has(counterparty);
    if (isKnownDexCounterparty) return null;

    let txTransfers = txTransfersByHash.get(txHash) || [];
    let walletInTransfers = txTransfers.filter(
      (item) => normalizeAddress(item?.to?.hash || item?.to) === walletAddress
    );
    let walletOutTransfers = txTransfers.filter(
      (item) => normalizeAddress(item?.from?.hash || item?.from) === walletAddress
    );
    let priorRelay = txTransfers.some((item) => {
      const relayTo = normalizeAddress(item?.to?.hash || item?.to);
      const relayFrom = normalizeAddress(item?.from?.hash || item?.from);
      return relayTo === counterparty && relayFrom !== walletAddress && transferMatchesToken(item, transfer);
    });

    if (!priorRelay && walletOutTransfers.length === 0 && txTransfers.length <= 2) {
      txTransfers = await fetchTransactionTokenTransfers({
        baseUrl: env.citreascanApiUrl,
        txHash
      });
      walletInTransfers = txTransfers.filter(
        (item) => normalizeAddress(item?.to?.hash || item?.to) === walletAddress
      );
      walletOutTransfers = txTransfers.filter(
        (item) => normalizeAddress(item?.from?.hash || item?.from) === walletAddress
      );
      priorRelay = txTransfers.some((item) => {
        const relayTo = normalizeAddress(item?.to?.hash || item?.to);
        const relayFrom = normalizeAddress(item?.from?.hash || item?.from);
        return relayTo === counterparty && relayFrom !== walletAddress && transferMatchesToken(item, transfer);
      });
    }

    const relayBridgeLike =
      walletInTransfers.length > 0 &&
      walletOutTransfers.length === 0 &&
      txTransfers.length >= 3 &&
      priorRelay;

    if (!relayBridgeLike) return null;
    sourceLabel = "Official bridge relay";
  } else if (!isBridgeLike) {
    return null;
  } else if (!trackedSource) {
    sourceLabel = "Bridge flow";
  }

  const volumeCandidate = await buildPricedTransferCandidate(transfer, transfer?.timestamp);
  return {
    txHash,
    direction,
    counterparty,
    sourceLabel,
    volumeCandidate,
    timestamp: transfer?.timestamp
  };
}

async function fetchEtherscanLikeTxCount({ baseUrl, apiKey, wallet, startTimestamp, endTimestamp }) {
  if (!baseUrl) return null;

  const common = {
    chainid: env.ethChainId,
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

  if (!data) {
    return 0;
  }

  if (data.status === "0") {
    const message = String(data.result || data.message || "");
    if (/no transactions found/i.test(message)) {
      return 0;
    }
    throw new Error(message || "Etherscan request failed");
  }

  if (!Array.isArray(data.result)) {
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
  const ethEnabled = env.enableExplorerEnrichment && Boolean(env.etherscanApiUrl) && Boolean(env.etherscanApiKey);

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

  if (out.eth_tx_count === null) {
    try {
      out.eth_tx_count = await fetchBlockscoutV2TxCount({
        baseUrl: ETH_BLOCKSCOUT_V2_URL,
        wallet,
        startTimestamp,
        endTimestamp
      });
    } catch (err) {
      out.errors.push(`eth-blockscout:${err.message}`);
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

export async function getCitreaWalletTokenBalances(wallet) {
  if (!env.citreascanApiUrl) {
    return {
      enabled: false,
      token_count: 0,
      total_usd: "0",
      cbtc_amount: "0",
      cbtc_usd: "0",
      top_tokens: [],
      errors: []
    };
  }

  const rows = await fetchAddressTokenBalances(env.citreascanApiUrl, wallet);
  const nowIso = new Date().toISOString();
  const balances = [];
  let totalUsd = 0;
  let cbtcAmount = 0;
  let cbtcUsd = 0;

  for (const row of rows) {
    const token = row?.token || {};
    const symbol = token.symbol || token.name || shortAddress(token.address_hash);
    const decimals = Number(token.decimals || 18);
    const valueRaw = String(row?.value || "0");

    let amount = 0;
    try {
      amount = Number(ethers.formatUnits(valueRaw, decimals));
    } catch {
      amount = 0;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const exchangeRate = Number(token.exchange_rate);
    const spotPrice = Number.isFinite(exchangeRate) && exchangeRate > 0
      ? { price: exchangeRate, source: "explorer:exchange_rate" }
      : await resolveTokenUsdPriceSpot(symbol).catch(() => null) ||
        await resolveTokenUsdPrice(symbol, nowIso).catch(() => null);

    const usd = spotPrice ? amount * Number(spotPrice.price || 0) : 0;
    totalUsd += Number.isFinite(usd) ? usd : 0;

    if (CITREA_BTC_BALANCE_SYMBOLS.has(String(symbol).trim().toUpperCase())) {
      cbtcAmount += amount;
      cbtcUsd += Number.isFinite(usd) ? usd : 0;
    }

    balances.push({
      token: symbol,
      amount: String(amount),
      usd: Number.isFinite(usd) ? String(usd) : "0",
      price_source: spotPrice?.source || "unpriced"
    });
  }

  balances.sort((a, b) => {
    const usdDiff = Number(b.usd || 0) - Number(a.usd || 0);
    if (usdDiff !== 0) return usdDiff;
    return Number(b.amount || 0) - Number(a.amount || 0);
  });

  return {
    enabled: true,
    token_count: balances.length,
    total_usd: String(totalUsd),
    cbtc_amount: String(cbtcAmount),
    cbtc_usd: String(cbtcUsd),
    top_tokens: balances.slice(0, 3),
    errors: []
  };
}

export async function getCitreaExplorerActivity(wallet, fromIso, toIso, options = {}) {
  if (!env.citreascanApiUrl) {
    return {
      enabled: false,
      tx_count: 0,
      swap_count: 0,
      app_tx_count: 0,
      gas_total_native: "0",
      gas_total_usd: "0",
      swap_volume_usd_total: "0",
      app_volume_usd_total: "0",
      app_breakdown: [],
      gas_items: [],
      swap_items: []
    };
  }

  const startTimestamp = new Date(fromIso).getTime();
  const endTimestamp = new Date(toIso).getTime();
  const limit = Number(options.limit || 20);
  const walletAddress = normalizeAddress(wallet);
  const trackedDexDestinations = await getTrackedDexDestinations();
  const trackedBridgeDestinations = await getTrackedBridgeDestinations();
  const trackedMetricApps = await getTrackedMetricApps();
  const sourceBridgeApps = await getSourceBridgeAppConfigs();
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
  const walletTxHashes = new Set(transactions.map((tx) => String(tx.hash || "").toLowerCase()));
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
  let appVolumeUsdTotal = 0;
  let bridgeInflowUsdTotal = 0;
  let bridgeOutflowUsdTotal = 0;
  let swapCount = 0;
  let appTxCount = 0;
  let bridgeTxCount = 0;
  const appBreakdown = new Map();
  const bridgeByTxDirection = new Map();
  const bridgeSourceLabels = new Set();
  const gasItems = [];
  const swapItems = [];

  for (const transfer of tokenTransfers) {
    const bridgeTransfer = await classifyBridgeTransfer(
      transfer,
      walletAddress,
      trackedBridgeDestinations,
      swapTransfersByHash,
      trackedDexDestinations
    );
    if (!bridgeTransfer) continue;

    const dedupeKey = `${bridgeTransfer.txHash}:${bridgeTransfer.direction}`;
    const existing = bridgeByTxDirection.get(dedupeKey);
    const existingUsd = Number(existing?.volumeCandidate?.usd || 0);
    const currentUsd = Number(bridgeTransfer?.volumeCandidate?.usd || 0);

    if (!existing || currentUsd > existingUsd) {
      bridgeByTxDirection.set(dedupeKey, bridgeTransfer);
    }
  }

  for (const bridgeTransfer of bridgeByTxDirection.values()) {
    bridgeTxCount += 1;
    bridgeSourceLabels.add(bridgeTransfer.sourceLabel);
    const usd = Number(bridgeTransfer?.volumeCandidate?.usd || 0);
    if (bridgeTransfer.direction === "inflow") {
      bridgeInflowUsdTotal += usd;
    } else {
      bridgeOutflowUsdTotal += usd;
    }
  }

  for (const tx of transactions) {
    const feeWei = BigInt(tx?.fee?.value || "0");
    gasTotalWei += feeWei;
    const txTransfers = swapTransfersByHash.get(String(tx.hash || "").toLowerCase()) || [];
    const classification = getSwapClassification(tx, walletAddress, txTransfers, trackedDexDestinations);
    const appClassification = getAppClassification(tx, walletAddress, txTransfers, trackedMetricApps);
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
      const transferCandidates = await getWalletTransferCandidatesUsd(
        classification.walletOutTransfers,
        classification.walletInTransfers,
        tx.timestamp,
        tx.value
      );
      const exactInput = transferCandidates.out ?? transferCandidates.native;
      const exactOutput = transferCandidates.in;

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
      const dexLabel =
        trackedDexDestinations?.labels?.get(classification.destination) ||
        tx?.to?.name ||
        tx?.method ||
        "swap";
      let attributionLabels = getSwapAttributionLabels(classification, txTransfers, trackedDexDestinations);
      if (
        trackedDexDestinations?.routers?.has(classification.destination) &&
        attributionLabels.length <= 1
      ) {
        const fullTxTransfers = await fetchTransactionTokenTransfers({
          baseUrl: env.citreascanApiUrl,
          txHash: tx.hash
        });
        const expandedLabels = getSwapAttributionLabels(classification, fullTxTransfers, trackedDexDestinations);
        if (expandedLabels.length > attributionLabels.length) {
          attributionLabels = expandedLabels;
        }
      }

      if (swapVolumeUsd !== null) {
        swapVolumeUsdTotal += swapVolumeUsd;
      }

      if (swapItems.length < limit) {
        swapItems.push({
          dex: dexLabel,
          attribution_labels: attributionLabels,
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

    if (appClassification.isAppActivity && !classification.isSwap) {
      appTxCount += 1;
      const transferCandidates = await getWalletTransferCandidatesUsd(
        appClassification.walletOutTransfers,
        appClassification.walletInTransfers,
        tx.timestamp,
        tx.value
      );
      let appVolumeCandidate = getBestVolumeCandidate(transferCandidates) ||
        (await getTransactionTransferCandidatesUsd(txTransfers, tx.timestamp));
      if (!appVolumeCandidate) {
        const fullTxTransfers = await fetchTransactionTokenTransfers({
          baseUrl: env.citreascanApiUrl,
          txHash: tx.hash
        });
        appVolumeCandidate = await getTransactionTransferCandidatesUsd(fullTxTransfers, tx.timestamp);
      }
      const appVolumeUsd = Number(appVolumeCandidate?.usd || 0);

      appVolumeUsdTotal += appVolumeUsd;
      const existing = appBreakdown.get(appClassification.app.id) || {
        id: appClassification.app.id,
        label: appClassification.app.label,
        category: appClassification.app.category,
        tx_count: 0,
        volume_usd: 0
      };
      existing.tx_count += 1;
      existing.volume_usd += appVolumeUsd;
      appBreakdown.set(appClassification.app.id, existing);
    }
  }

  if (sourceBridgeApps.length > 0) {
    const [ethTransactions, ethTokenTransfers] = await Promise.all([
      fetchBlockscoutTransactions({
        baseUrl: ETH_BLOCKSCOUT_V2_URL,
        wallet,
        startTimestamp,
        endTimestamp
      }),
      fetchBlockscoutTokenTransfers({
        baseUrl: ETH_BLOCKSCOUT_V2_URL,
        wallet,
        startTimestamp,
        endTimestamp
      })
    ]);

    const sourceBridgeAddressMap = new Map();
    for (const app of sourceBridgeApps) {
      for (const entry of app?.walletMetrics?.addresses || []) {
        const normalized = normalizeAddress(entry.address);
        if (!normalized) continue;
        sourceBridgeAddressMap.set(normalized, {
          id: app.id,
          label: app.label,
          category: app?.walletMetrics?.category || "bridge",
          methods: Array.isArray(app?.walletMetrics?.methods)
            ? app.walletMetrics.methods.map((item) => String(item).toLowerCase())
            : [],
          destinationChainId: Number(app?.walletMetrics?.destinationChainId || env.citreaChainId)
        });
      }
    }

    const ethTransfersByHash = new Map();
    for (const transfer of ethTokenTransfers) {
      const txHash = String(transfer?.transaction_hash || "").toLowerCase();
      if (!txHash) continue;
      const list = ethTransfersByHash.get(txHash) || [];
      list.push(transfer);
      ethTransfersByHash.set(txHash, list);
    }

    for (const tx of ethTransactions) {
      const txHash = String(tx?.hash || "").toLowerCase();
      const destination = normalizeAddress(tx?.to?.hash || tx?.to);
      if (!txHash || !destination) continue;

      const app = sourceBridgeAddressMap.get(destination);
      if (!app) continue;

      const status = String(tx?.status || tx?.result || "").toLowerCase();
      if (status !== "ok" && status !== "success") continue;

      const methodCall = String(tx?.decoded_input?.method_call || tx?.method || "").toLowerCase();
      if (app.methods.length > 0 && !app.methods.some((method) => methodCall.includes(method))) {
        continue;
      }
      if (!txTargetsChainId(tx, app.destinationChainId)) {
        continue;
      }

      const txTransfers = ethTransfersByHash.get(txHash) || [];
      const walletOutTransfers = txTransfers.filter((transfer) => {
        const from = normalizeAddress(transfer?.from?.hash || transfer?.from);
        const to = normalizeAddress(transfer?.to?.hash || transfer?.to);
        return from === walletAddress && to === destination;
      });

      let bridgeVolumeCandidate = null;
      if (walletOutTransfers.length > 0) {
        const candidates = await Promise.all(
          walletOutTransfers.map((transfer) => buildPricedTransferCandidate(transfer, tx.timestamp))
        );
        bridgeVolumeCandidate = maxUsdCandidate(candidates);
      }

      if (!bridgeVolumeCandidate && BigInt(tx?.value || "0") > 0n) {
        const nativeAmount = Number(ethers.formatEther(tx.value));
        const nativePrice = await resolveNativeUsdPrice(env.ethChainId, tx.timestamp).catch(() => null);
        if (nativePrice) {
          bridgeVolumeCandidate = {
            symbol: "ETH",
            amount: nativeAmount,
            usd: nativeAmount * nativePrice.price
          };
        }
      }

      if (!bridgeVolumeCandidate) continue;

      bridgeTxCount += 1;
      bridgeInflowUsdTotal += Number(bridgeVolumeCandidate.usd || 0);
      bridgeSourceLabels.add(app.label);

      const existing = appBreakdown.get(app.id) || {
        id: app.id,
        label: app.label,
        category: app.category,
        tx_count: 0,
        volume_usd: 0
      };
      existing.tx_count += 1;
      existing.volume_usd += Number(bridgeVolumeCandidate.usd || 0);
      appBreakdown.set(app.id, existing);
    }
  }

  return {
    enabled: true,
    tx_count: transactions.length,
    wallet_tx_count: transactions.length,
    swap_count: swapCount,
    app_tx_count: appTxCount,
    bridge_tx_count: bridgeTxCount,
    bridge_sources_detected: [...bridgeSourceLabels],
    bridge_inflow_usd_total: String(bridgeInflowUsdTotal),
    bridge_outflow_usd_total: String(bridgeOutflowUsdTotal),
    bridge_volume_usd_total: String(bridgeInflowUsdTotal + bridgeOutflowUsdTotal),
    gas_total_native: ethers.formatEther(gasTotalWei),
    gas_total_usd: String(gasTotalUsd),
    swap_volume_usd_total: String(swapVolumeUsdTotal),
    app_volume_usd_total: String(appVolumeUsdTotal),
    app_breakdown: [...appBreakdown.values()].sort((a, b) => b.volume_usd - a.volume_usd),
    gas_items: gasItems,
    swap_items: swapItems
  };
}
