import { ethers } from "ethers";
import { env } from "../config.js";
import { getPool } from "../db.js";
import {
  chunkRange,
  getOrCreateCursor,
  normalizeAddress,
  readErc20Metadata,
  setCursor,
  upsertToken
} from "./indexerUtils.js";

const CANONICAL_BRIDGE_ABI = [
  "event DepositInitiated(address indexed from,address indexed to,address indexed l1Token,address l2Token,uint256 amount)",
  "event WithdrawalInitiated(address indexed from,address indexed to,address indexed l2Token,address l1Token,uint256 amount)"
];

const OFT_BRIDGE_ABI = [
  "function token() view returns (address)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)",
  "event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)"
];

const CITREA_BTC_BRIDGE_ABI = [
  "function optimisticWithdrawAmountSats() view returns (uint256)",
  "event Deposit(bytes32 wtxId, bytes32 txId, address recipient, uint256 timestamp, uint256 depositId)",
  "event Withdrawal((bytes32 txId, bytes4 outputId) utxo, uint256 index, uint256 timestamp)"
];

async function upsertBridgeTransfer(payload) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO bridge_transfers (
      direction,
      protocol_name,
      token_id,
      wallet_address,
      counterparty_address,
      source_chain_id,
      destination_chain_id,
      source_tx_hash,
      destination_tx_hash,
      source_log_index,
      block_number,
      block_timestamp,
      amount_raw,
      amount_decimal,
      event_name
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TO_TIMESTAMP($12),$13,$14,$15
    )
    ON CONFLICT DO NOTHING`,
    [
      payload.direction,
      payload.protocolName,
      payload.tokenId,
      normalizeAddress(payload.walletAddress),
      payload.counterpartyAddress ? normalizeAddress(payload.counterpartyAddress) : null,
      payload.sourceChainId,
      payload.destinationChainId,
      payload.sourceTxHash,
      payload.destinationTxHash || null,
      payload.logIndex ?? null,
      payload.blockNumber,
      payload.blockTimestamp,
      payload.amountRaw,
      payload.amountDecimal,
      payload.eventName
    ]
  );
}

async function resolveOftToken(contractAddress, provider, protocolName) {
  const contract = new ethers.Contract(contractAddress, OFT_BRIDGE_ABI, provider);
  let tokenAddress = contractAddress;
  let metadata;

  try {
    tokenAddress = await contract.token();
    metadata = await readErc20Metadata(provider, tokenAddress);
  } catch {
    const [symbol, name, decimals] = await Promise.all([
      contract.symbol(),
      contract.name(),
      contract.decimals()
    ]);
    metadata = { symbol, name, decimals: Number(decimals) };
  }

  const tokenId = await upsertToken({
    symbol: metadata.symbol,
    name: metadata.name || protocolName,
    decimals: metadata.decimals,
    l2ChainId: env.citreaChainId,
    l2Address: tokenAddress
  });

  return { contract, tokenId, tokenAddress, metadata };
}

async function processCanonicalContract(contractConfig, provider) {
  const iface = new ethers.Interface(CANONICAL_BRIDGE_ABI);
  const streamKey = `bridge:${contractConfig.bridge_variant}:${contractConfig.chain_id}:${contractConfig.contract_address}`;
  const latestBlock = await provider.getBlockNumber();
  const startBlock = await getOrCreateCursor(
    streamKey,
    Number(contractConfig.chain_id),
    contractConfig.start_block ?? env.startBlockEth
  );
  const ranges = chunkRange(startBlock + 1, latestBlock, env.indexerChunkSize);

  for (const [fromBlock, toBlock] of ranges) {
    const logs = await provider.getLogs({
      address: contractConfig.contract_address,
      fromBlock,
      toBlock,
      topics: [[
        iface.getEvent("DepositInitiated").topicHash,
        iface.getEvent("WithdrawalInitiated").topicHash
      ]]
    });

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const block = await provider.getBlock(log.blockNumber);
      const metadata = await readErc20Metadata(provider, parsed.args.l1Token);
      const tokenId = await upsertToken({
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        l1ChainId: env.ethChainId,
        l1Address: parsed.args.l1Token,
        l2ChainId: env.citreaChainId,
        l2Address: parsed.args.l2Token
      });
      const amountRaw = parsed.args.amount.toString();
      const amountDecimal = ethers.formatUnits(parsed.args.amount, metadata.decimals);

      if (parsed.name === "DepositInitiated") {
        await upsertBridgeTransfer({
          direction: "inflow",
          protocolName: contractConfig.protocol_name,
          tokenId,
          walletAddress: parsed.args.to,
          counterpartyAddress: parsed.args.from,
          sourceChainId: env.ethChainId,
          destinationChainId: env.citreaChainId,
          sourceTxHash: log.transactionHash,
          destinationTxHash: null,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          blockTimestamp: block.timestamp,
          amountRaw,
          amountDecimal,
          eventName: parsed.name
        });
      }

      if (parsed.name === "WithdrawalInitiated") {
        const tx = await provider.getTransaction(log.transactionHash);
        await upsertBridgeTransfer({
          direction: "outflow",
          protocolName: contractConfig.protocol_name,
          tokenId,
          walletAddress: tx?.from || parsed.args.from,
          counterpartyAddress: parsed.args.to,
          sourceChainId: env.citreaChainId,
          destinationChainId: env.ethChainId,
          sourceTxHash: log.transactionHash,
          destinationTxHash: null,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          blockTimestamp: block.timestamp,
          amountRaw,
          amountDecimal,
          eventName: parsed.name
        });
      }
    }

    await setCursor(streamKey, Number(contractConfig.chain_id), toBlock);
  }
}

async function processLayerZeroOft(contractConfig, provider) {
  const iface = new ethers.Interface(OFT_BRIDGE_ABI);
  const streamKey = `bridge:${contractConfig.bridge_variant}:${contractConfig.chain_id}:${contractConfig.contract_address}`;
  const latestBlock = await provider.getBlockNumber();
  const startBlock = await getOrCreateCursor(
    streamKey,
    Number(contractConfig.chain_id),
    contractConfig.start_block ?? env.startBlockCitrea
  );
  const ranges = chunkRange(startBlock + 1, latestBlock, env.indexerChunkSize);
  const { tokenId, metadata } = await resolveOftToken(
    contractConfig.contract_address,
    provider,
    contractConfig.protocol_name
  );

  for (const [fromBlock, toBlock] of ranges) {
    const logs = await provider.getLogs({
      address: contractConfig.contract_address,
      fromBlock,
      toBlock,
      topics: [[
        iface.getEvent("OFTReceived").topicHash,
        iface.getEvent("OFTSent").topicHash
      ]]
    });

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const block = await provider.getBlock(log.blockNumber);
      const tx = await provider.getTransaction(log.transactionHash);

      if (parsed.name === "OFTReceived") {
        await upsertBridgeTransfer({
          direction: "inflow",
          protocolName: contractConfig.protocol_name,
          tokenId,
          walletAddress: parsed.args.toAddress,
          counterpartyAddress: null,
          sourceChainId: env.ethChainId,
          destinationChainId: env.citreaChainId,
          sourceTxHash: parsed.args.guid,
          destinationTxHash: log.transactionHash,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          blockTimestamp: block.timestamp,
          amountRaw: parsed.args.amountReceivedLD.toString(),
          amountDecimal: ethers.formatUnits(parsed.args.amountReceivedLD, metadata.decimals),
          eventName: parsed.name
        });
      }

      if (parsed.name === "OFTSent") {
        await upsertBridgeTransfer({
          direction: "outflow",
          protocolName: contractConfig.protocol_name,
          tokenId,
          walletAddress: tx?.from || parsed.args.fromAddress,
          counterpartyAddress: null,
          sourceChainId: env.citreaChainId,
          destinationChainId: env.ethChainId,
          sourceTxHash: log.transactionHash,
          destinationTxHash: parsed.args.guid,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          blockTimestamp: block.timestamp,
          amountRaw: parsed.args.amountSentLD.toString(),
          amountDecimal: ethers.formatUnits(parsed.args.amountSentLD, metadata.decimals),
          eventName: parsed.name
        });
      }
    }

    await setCursor(streamKey, Number(contractConfig.chain_id), toBlock);
  }
}

async function processCitreaBtcBridge(contractConfig, provider) {
  const iface = new ethers.Interface(CITREA_BTC_BRIDGE_ABI);
  const streamKey = `bridge:${contractConfig.bridge_variant}:${contractConfig.chain_id}:${contractConfig.contract_address}`;
  const latestBlock = await provider.getBlockNumber();
  const startBlock = await getOrCreateCursor(
    streamKey,
    Number(contractConfig.chain_id),
    contractConfig.start_block ?? env.startBlockCitrea
  );
  const ranges = chunkRange(startBlock + 1, latestBlock, env.indexerChunkSize);
  const bridge = new ethers.Contract(contractConfig.contract_address, CITREA_BTC_BRIDGE_ABI, provider);
  const satsAmount = await bridge.optimisticWithdrawAmountSats();
  const amountRaw = satsAmount.toString();
  const amountDecimal = ethers.formatUnits(satsAmount * 10n ** 10n, 18);
  const tokenId = await upsertToken({
    symbol: "cBTC",
    name: "Citrea Bitcoin",
    decimals: 18,
    l2ChainId: env.citreaChainId,
    isNative: true
  });

  for (const [fromBlock, toBlock] of ranges) {
    const logs = await provider.getLogs({
      address: contractConfig.contract_address,
      fromBlock,
      toBlock,
      topics: [[
        iface.getEvent("Deposit").topicHash,
        iface.getEvent("Withdrawal").topicHash
      ]]
    });

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const block = await provider.getBlock(log.blockNumber);

      if (parsed.name === "Deposit") {
        await upsertBridgeTransfer({
          direction: "inflow",
          protocolName: contractConfig.protocol_name,
          tokenId,
          walletAddress: parsed.args.recipient,
          counterpartyAddress: null,
          sourceChainId: env.bitcoinChainId,
          destinationChainId: env.citreaChainId,
          sourceTxHash: parsed.args.txId,
          destinationTxHash: log.transactionHash,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          blockTimestamp: parsed.args.timestamp.toString(),
          amountRaw,
          amountDecimal,
          eventName: parsed.name
        });
      }

      if (parsed.name === "Withdrawal") {
        const tx = await provider.getTransaction(log.transactionHash);
        await upsertBridgeTransfer({
          direction: "outflow",
          protocolName: contractConfig.protocol_name,
          tokenId,
          walletAddress: tx?.from || null,
          counterpartyAddress: null,
          sourceChainId: env.citreaChainId,
          destinationChainId: env.bitcoinChainId,
          sourceTxHash: log.transactionHash,
          destinationTxHash: parsed.args.utxo.txId,
          logIndex: log.index,
          blockNumber: log.blockNumber,
          blockTimestamp: parsed.args.timestamp.toString() || block.timestamp,
          amountRaw,
          amountDecimal,
          eventName: parsed.name
        });
      }
    }

    await setCursor(streamKey, Number(contractConfig.chain_id), toBlock);
  }
}

async function run() {
  if (!env.ethRpcUrl || !env.citreaRpcUrl) {
    throw new Error("ETH_RPC_URL and CITREA_RPC_URL are required");
  }

  const pool = getPool();
  const ethProvider = new ethers.JsonRpcProvider(env.ethRpcUrl);
  const citreaProvider = new ethers.JsonRpcProvider(env.citreaRpcUrl);

  const contracts = await pool.query(
    `SELECT chain_id, contract_address, protocol_name, bridge_variant, start_block
     FROM tracked_bridge_contracts
     WHERE is_active = true
     ORDER BY chain_id, contract_address`
  );

  for (const contractConfig of contracts.rows) {
    if (contractConfig.bridge_variant === "canonical_erc20") {
      await processCanonicalContract(contractConfig, ethProvider);
      continue;
    }

    if (contractConfig.bridge_variant === "layerzero_oft") {
      await processLayerZeroOft(contractConfig, citreaProvider);
      continue;
    }

    if (contractConfig.bridge_variant === "citrea_btc_system") {
      await processCitreaBtcBridge(contractConfig, citreaProvider);
    }
  }

  console.log("bridgeIndexer completed");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
