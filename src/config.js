import dotenv from "dotenv";

dotenv.config();

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanUrl(value, fallback = "") {
  return cleanString(value, fallback).replace(/[\r\n]+/g, "");
}

export const env = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: cleanString(process.env.DATABASE_URL),
  bitcoinChainId: Number(process.env.BITCOIN_CHAIN_ID || 8332),
  ethChainId: Number(process.env.ETH_CHAIN_ID || 1),
  citreaChainId: Number(process.env.CITREA_CHAIN_ID || 4114),
  ethRpcUrl: cleanUrl(process.env.ETH_RPC_URL),
  citreaRpcUrl: cleanUrl(process.env.CITREA_RPC_URL),
  startBlockEth: Number(process.env.START_BLOCK_ETH || 0),
  startBlockCitrea: Number(process.env.START_BLOCK_CITREA || 0),
  indexerChunkSize: Number(process.env.INDEXER_CHUNK_SIZE || 2000),
  rpcMaxLogRange: Number(process.env.RPC_MAX_LOG_RANGE || 1000),
  indexerMaxRangesPerStream: Number(process.env.INDEXER_MAX_RANGES_PER_STREAM || 20),
  indexerMaxPendingItems: Number(process.env.INDEXER_MAX_PENDING_ITEMS || 500),
  pricingBatchSize: Number(process.env.PRICING_BATCH_SIZE || 500),
  enableExplorerEnrichment: String(process.env.ENABLE_EXPLORER_ENRICHMENT || "false").toLowerCase() === "true",
  etherscanApiUrl: cleanUrl(process.env.ETHERSCAN_API_URL, "https://api.etherscan.io/v2/api"),
  etherscanApiKey: cleanString(process.env.ETHERSCAN_API_KEY),
  citreascanApiUrl: cleanUrl(process.env.CITREASCAN_API_URL, "https://explorer.mainnet.citrea.xyz/api/v2"),
  citreascanApiKey: cleanString(process.env.CITREASCAN_API_KEY),
  citreascanStatsUrl: cleanUrl(process.env.CITREASCAN_STATS_URL, "https://explorer.mainnet.citrea.xyz/api/v2/stats"),
  coinGeckoApiBase: cleanUrl(process.env.COINGECKO_API_BASE, "https://api.coingecko.com/api/v3"),
  coinGeckoDemoApiKey: cleanString(process.env.COINGECKO_DEMO_API_KEY),
  defillamaApiBase: cleanUrl(process.env.DEFILLAMA_API_BASE, "https://api.llama.fi"),
  defillamaChainName: cleanString(process.env.DEFILLAMA_CHAIN_NAME, "Citrea"),
  defillamaBridgeProtocol: cleanString(process.env.DEFILLAMA_BRIDGE_PROTOCOL, "citrea-bridge"),
  duneApiBase: cleanUrl(process.env.DUNE_API_BASE, "https://api.dune.com/api/v1"),
  duneApiKey: cleanString(process.env.DUNE_API_KEY),
  duneQueryIdCitreaActivity: cleanString(process.env.DUNE_QUERY_ID_CITREA_ACTIVITY),
  duneQueryIdCitreaFees: cleanString(process.env.DUNE_QUERY_ID_CITREA_FEES),
  duneQueryIdCitreaDex: cleanString(process.env.DUNE_QUERY_ID_CITREA_DEX),
  nansenApiBase: cleanUrl(process.env.NANSEN_API_BASE, "https://api.nansen.ai"),
  nansenApiKey: cleanString(process.env.NANSEN_API_KEY),
  networkRefreshMs: Number(process.env.NETWORK_REFRESH_MS || 300000),
  allowedOrigins: cleanString(process.env.ALLOWED_ORIGINS).split(",").map((s) => s.trim()).filter(Boolean)
};
