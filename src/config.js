import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL || "",
  bitcoinChainId: Number(process.env.BITCOIN_CHAIN_ID || 8332),
  ethChainId: Number(process.env.ETH_CHAIN_ID || 1),
  citreaChainId: Number(process.env.CITREA_CHAIN_ID || 4114),
  ethRpcUrl: process.env.ETH_RPC_URL || "",
  citreaRpcUrl: process.env.CITREA_RPC_URL || "",
  startBlockEth: Number(process.env.START_BLOCK_ETH || 0),
  startBlockCitrea: Number(process.env.START_BLOCK_CITREA || 0),
  indexerChunkSize: Number(process.env.INDEXER_CHUNK_SIZE || 2000),
  enableExplorerEnrichment: String(process.env.ENABLE_EXPLORER_ENRICHMENT || "false").toLowerCase() === "true",
  etherscanApiUrl: process.env.ETHERSCAN_API_URL || "https://api.etherscan.io/api",
  etherscanApiKey: process.env.ETHERSCAN_API_KEY || "",
  citreascanApiUrl: process.env.CITREASCAN_API_URL || "",
  citreascanApiKey: process.env.CITREASCAN_API_KEY || "",
  citreascanStatsUrl: process.env.CITREASCAN_STATS_URL || "https://explorer.mainnet.citrea.xyz/api/v2/stats",
  defillamaApiBase: process.env.DEFILLAMA_API_BASE || "https://api.llama.fi",
  defillamaChainName: process.env.DEFILLAMA_CHAIN_NAME || "Citrea",
  defillamaBridgeProtocol: process.env.DEFILLAMA_BRIDGE_PROTOCOL || "citrea-bridge",
  networkRefreshMs: Number(process.env.NETWORK_REFRESH_MS || 60000),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)
};
