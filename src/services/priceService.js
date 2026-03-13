import { env } from "../config.js";
import { getPool } from "../db.js";

const HISTORY_PRICE_CACHE = new Map();
const SPOT_PRICE_CACHE = new Map();
const STABLECOIN_SYMBOLS = new Set(["USDC", "USDC.E", "USDT", "USDT.E", "CTUSD", "JUSD", "SVJUSD", "GUSD"]);
const BITCOIN_SYMBOLS = new Set(["BTC", "WBTC", "WBTC.E", "WCBTC", "CBTC", "SYBTC", "SYMBTC", "CITREA BTC", "CITREA_BTC"]);
const ETHEREUM_SYMBOLS = new Set(["ETH", "WETH"]);

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function symbolToAsset(symbol) {
  const normalized = normalizeSymbol(symbol);

  if (STABLECOIN_SYMBOLS.has(normalized)) {
    return { kind: "static", source: "stablecoin", price: 1 };
  }

  if (BITCOIN_SYMBOLS.has(normalized)) {
    return { kind: "coingecko", source: "coingecko:bitcoin", assetId: "bitcoin" };
  }

  if (ETHEREUM_SYMBOLS.has(normalized)) {
    return { kind: "coingecko", source: "coingecko:ethereum", assetId: "ethereum" };
  }

  return null;
}

function formatCoinGeckoDate(timestamp) {
  const d = new Date(timestamp);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function normalizeSnapshotMinute(timestamp) {
  const d = new Date(timestamp);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

async function fetchCoinGeckoHistory(assetId, timestamp) {
  const date = formatCoinGeckoDate(timestamp);
  const cacheKey = `${assetId}:${date}`;
  if (HISTORY_PRICE_CACHE.has(cacheKey)) {
    return HISTORY_PRICE_CACHE.get(cacheKey);
  }

  try {
    const url = new URL(`${env.coinGeckoApiBase.replace(/\/$/, "")}/coins/${assetId}/history`);
    url.searchParams.set("date", date);
    url.searchParams.set("localization", "false");

    const headers = {};
    if (env.coinGeckoDemoApiKey) {
      headers["x-cg-demo-api-key"] = env.coinGeckoDemoApiKey;
    }

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(env.externalFetchTimeoutMs)
    });
    if (!res.ok) {
      if (res.status === 429) {
        HISTORY_PRICE_CACHE.set(cacheKey, null);
        return null;
      }
      throw new Error(`CoinGecko HTTP ${res.status}`);
    }

    const data = await res.json();
    const usd = Number(data?.market_data?.current_price?.usd);
    const value = Number.isFinite(usd) ? usd : null;
    HISTORY_PRICE_CACHE.set(cacheKey, value);
    return value;
  } catch (error) {
    console.warn(`CoinGecko history lookup failed for ${assetId} on ${date}: ${error.message}`);
    HISTORY_PRICE_CACHE.set(cacheKey, null);
    return null;
  }
}

async function fetchCoinGeckoSpot(assetId) {
  const cached = SPOT_PRICE_CACHE.get(assetId);
  if (cached && Date.now() - cached.updatedAt < 60_000) {
    return cached.value;
  }

  try {
    const url = new URL(`${env.coinGeckoApiBase.replace(/\/$/, "")}/simple/price`);
    url.searchParams.set("ids", assetId);
    url.searchParams.set("vs_currencies", "usd");

    const headers = {};
    if (env.coinGeckoDemoApiKey) {
      headers["x-cg-demo-api-key"] = env.coinGeckoDemoApiKey;
    }

    const res = await fetch(url.toString(), {
      headers,
      signal: AbortSignal.timeout(env.externalFetchTimeoutMs)
    });
    if (!res.ok) {
      if (res.status === 429) {
        return null;
      }
      throw new Error(`CoinGecko HTTP ${res.status}`);
    }

    const data = await res.json();
    const value = Number(data?.[assetId]?.usd);
    if (!Number.isFinite(value)) return null;
    SPOT_PRICE_CACHE.set(assetId, { value, updatedAt: Date.now() });
    return value;
  } catch (error) {
    console.warn(`CoinGecko spot lookup failed for ${assetId}: ${error.message}`);
    return null;
  }
}

export async function resolveTokenUsdPriceSpot(symbol) {
  const asset = symbolToAsset(symbol);
  if (!asset) return null;
  if (asset.kind === "static") return { price: asset.price, source: asset.source };

  const price = await fetchCoinGeckoSpot(asset.assetId);
  if (price === null) return null;
  return { price, source: `${asset.source}:spot` };
}

export async function resolveTokenUsdPrice(symbol, timestamp) {
  const asset = symbolToAsset(symbol);
  if (!asset) return null;
  if (asset.kind === "static") return { price: asset.price, source: asset.source };

  let price = await fetchCoinGeckoHistory(asset.assetId, timestamp);
  if (price === null) {
    price = await fetchCoinGeckoSpot(asset.assetId);
  }
  if (price === null) return null;
  return { price, source: asset.source };
}

export async function resolveNativeUsdPrice(chainId, timestamp) {
  if (Number(chainId) === 1) {
    return resolveTokenUsdPrice("ETH", timestamp);
  }

  return resolveTokenUsdPrice("CBTC", timestamp);
}

export async function upsertTokenPriceSnapshot(tokenId, timestamp, price, source) {
  if (!tokenId || price === null || price === undefined) return;

  const pool = getPool();
  await pool.query(
    `INSERT INTO token_prices_1m (token_id, quote_currency, ts_minute, price, source)
     VALUES ($1, 'USD', $2::timestamptz, $3, $4)
     ON CONFLICT (token_id, quote_currency, ts_minute)
     DO UPDATE SET price = EXCLUDED.price, source = EXCLUDED.source`,
    [tokenId, normalizeSnapshotMinute(timestamp), String(price), source]
  );
}
