import { ethers } from "ethers";
import { env } from "../config.js";
import { getPool } from "../db.js";
import {
  chunkRange,
  getOrCreateCursor,
  normalizeAddress,
  readErc20Metadata,
  readPoolTokens,
  setCursor,
  upsertToken
} from "./indexerUtils.js";

const V2_FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)"
];

const V3_FACTORY_ABI = [
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
];

const ALGEBRA_FACTORY_ABI = [
  "event Pool(address indexed token0, address indexed token1, address pool)"
];

const V2_PAIR_ABI = [
  "event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)"
];

const V3_POOL_SWAP_ABIS = [
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 price,uint128 liquidity,int24 tick,uint24 fee)"
];

function eventTopics(variant) {
  if (variant === "uniswap_v2") {
    return {
      factoryTopic: new ethers.Interface(V2_FACTORY_ABI).getEvent("PairCreated").topicHash,
      swapTopics: [new ethers.Interface(V2_PAIR_ABI).getEvent("Swap").topicHash]
    };
  }

  if (variant === "algebra_v3") {
    return {
      factoryTopic: new ethers.Interface(ALGEBRA_FACTORY_ABI).getEvent("Pool").topicHash,
      swapTopics: V3_POOL_SWAP_ABIS.map((abi) => new ethers.Interface([abi]).getEvent("Swap").topicHash)
    };
  }

  return {
    factoryTopic: new ethers.Interface(V3_FACTORY_ABI).getEvent("PoolCreated").topicHash,
    swapTopics: V3_POOL_SWAP_ABIS.map((abi) => new ethers.Interface([abi]).getEvent("Swap").topicHash)
  };
}

function absoluteDecimal(value, decimals) {
  const raw = BigInt(value.toString());
  const abs = raw < 0n ? raw * -1n : raw;
  return ethers.formatUnits(abs, decimals);
}

async function upsertTrackedDexContract(contract) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO tracked_dex_contracts (
      chain_id,
      contract_address,
      dex_name,
      dex_variant,
      contract_role,
      start_block,
      is_active
    ) VALUES ($1,$2,$3,$4,$5,$6,TRUE)
    ON CONFLICT (chain_id, contract_address)
    DO UPDATE SET dex_name = EXCLUDED.dex_name, dex_variant = EXCLUDED.dex_variant, contract_role = EXCLUDED.contract_role`,
    [
      contract.chainId,
      normalizeAddress(contract.contractAddress),
      contract.dexName,
      contract.dexVariant,
      contract.contractRole,
      contract.startBlock ?? null
    ]
  );
}

async function discoverPools(factoryConfig, provider) {
  const topics = eventTopics(factoryConfig.dex_variant);
  const streamKey = `dex-factory:${factoryConfig.dex_name}:${normalizeAddress(factoryConfig.contract_address)}`;
  const latestBlock = await provider.getBlockNumber();
  const startBlock = await getOrCreateCursor(streamKey, Number(factoryConfig.chain_id), factoryConfig.start_block ?? env.startBlockCitrea);
  const ranges = chunkRange(startBlock + 1, latestBlock, env.indexerChunkSize);
  const iface =
    factoryConfig.dex_variant === "uniswap_v2"
      ? new ethers.Interface(V2_FACTORY_ABI)
      : factoryConfig.dex_variant === "algebra_v3"
        ? new ethers.Interface(ALGEBRA_FACTORY_ABI)
        : new ethers.Interface(V3_FACTORY_ABI);

  for (const [fromBlock, toBlock] of ranges) {
    const logs = await provider.getLogs({
      address: factoryConfig.contract_address,
      fromBlock,
      toBlock,
      topics: [[topics.factoryTopic]]
    });

    for (const log of logs) {
      const parsed = iface.parseLog(log);
      const poolAddress =
        parsed.name === "PairCreated"
          ? parsed.args.pair
          : parsed.name === "PoolCreated"
            ? parsed.args.pool
            : parsed.args.pool;

      await upsertTrackedDexContract({
        chainId: Number(factoryConfig.chain_id),
        contractAddress: poolAddress,
        dexName: factoryConfig.dex_name,
        dexVariant: factoryConfig.dex_variant,
        contractRole: factoryConfig.dex_variant === "uniswap_v2" ? "pair" : "pool",
        startBlock: log.blockNumber
      });
    }

    await setCursor(streamKey, Number(factoryConfig.chain_id), toBlock);
  }
}

function parseSwapLog(variant, log) {
  if (variant === "uniswap_v2") {
    return new ethers.Interface(V2_PAIR_ABI).parseLog(log);
  }

  for (const abi of V3_POOL_SWAP_ABIS) {
    try {
      return new ethers.Interface([abi]).parseLog(log);
    } catch {
      continue;
    }
  }

  return null;
}

async function processPool(poolConfig, provider) {
  const topics = eventTopics(poolConfig.dex_variant);
  const streamKey = `dex-pool:${poolConfig.dex_variant}:${normalizeAddress(poolConfig.contract_address)}`;
  const latestBlock = await provider.getBlockNumber();
  const startBlock = await getOrCreateCursor(streamKey, Number(poolConfig.chain_id), poolConfig.start_block ?? env.startBlockCitrea);
  const ranges = chunkRange(startBlock + 1, latestBlock, env.indexerChunkSize);
  const pool = getPool();
  const tokens = await readPoolTokens(provider, poolConfig.contract_address);
  const [token0Meta, token1Meta] = await Promise.all([
    readErc20Metadata(provider, tokens.token0),
    readErc20Metadata(provider, tokens.token1)
  ]);

  const [token0Id, token1Id] = await Promise.all([
    upsertToken({
      symbol: token0Meta.symbol,
      name: token0Meta.name,
      decimals: token0Meta.decimals,
      l2ChainId: env.citreaChainId,
      l2Address: tokens.token0
    }),
    upsertToken({
      symbol: token1Meta.symbol,
      name: token1Meta.name,
      decimals: token1Meta.decimals,
      l2ChainId: env.citreaChainId,
      l2Address: tokens.token1
    })
  ]);

  for (const [fromBlock, toBlock] of ranges) {
    const logs = await provider.getLogs({
      address: poolConfig.contract_address,
      fromBlock,
      toBlock,
      topics: [topics.swapTopics]
    });

    for (const log of logs) {
      const parsed = parseSwapLog(poolConfig.dex_variant, log);
      if (!parsed) continue;

      const block = await provider.getBlock(log.blockNumber);
      const tx = await provider.getTransaction(log.transactionHash);
      let tokenInId = token0Id;
      let tokenOutId = token1Id;
      let tokenInRaw = "0";
      let tokenOutRaw = "0";
      let tokenInAmount = "0";
      let tokenOutAmount = "0";

      if (poolConfig.dex_variant === "uniswap_v2") {
        const amount0In = BigInt(parsed.args.amount0In.toString());
        const amount1In = BigInt(parsed.args.amount1In.toString());
        const amount0Out = BigInt(parsed.args.amount0Out.toString());
        const amount1Out = BigInt(parsed.args.amount1Out.toString());

        if (amount0In > 0n) {
          tokenInId = token0Id;
          tokenOutId = token1Id;
          tokenInRaw = amount0In.toString();
          tokenOutRaw = amount1Out.toString();
          tokenInAmount = ethers.formatUnits(amount0In, token0Meta.decimals);
          tokenOutAmount = ethers.formatUnits(amount1Out, token1Meta.decimals);
        } else {
          tokenInId = token1Id;
          tokenOutId = token0Id;
          tokenInRaw = amount1In.toString();
          tokenOutRaw = amount0Out.toString();
          tokenInAmount = ethers.formatUnits(amount1In, token1Meta.decimals);
          tokenOutAmount = ethers.formatUnits(amount0Out, token0Meta.decimals);
        }
      } else {
        const amount0 = BigInt(parsed.args.amount0.toString());
        const amount1 = BigInt(parsed.args.amount1.toString());

        if (amount0 > 0n && amount1 < 0n) {
          tokenInId = token0Id;
          tokenOutId = token1Id;
          tokenInRaw = amount0.toString();
          tokenOutRaw = (-amount1).toString();
          tokenInAmount = absoluteDecimal(amount0, token0Meta.decimals);
          tokenOutAmount = absoluteDecimal(amount1, token1Meta.decimals);
        } else {
          tokenInId = token1Id;
          tokenOutId = token0Id;
          tokenInRaw = amount1.toString();
          tokenOutRaw = (-amount0).toString();
          tokenInAmount = absoluteDecimal(amount1, token1Meta.decimals);
          tokenOutAmount = absoluteDecimal(amount0, token0Meta.decimals);
        }
      }

      await pool.query(
        `INSERT INTO dex_swaps (
          dex_name,
          protocol_version,
          wallet_address,
          pool_address,
          router_address,
          chain_id,
          tx_hash,
          log_index,
          block_number,
          block_timestamp,
          token_in_id,
          token_out_id,
          token_in_raw,
          token_out_raw,
          token_in_amount,
          token_out_amount,
          event_name
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,TO_TIMESTAMP($10),$11,$12,$13,$14,$15,$16,$17
        )
        ON CONFLICT DO NOTHING`,
        [
          poolConfig.dex_name,
          poolConfig.dex_variant,
          normalizeAddress(tx?.from || parsed.args.sender),
          normalizeAddress(poolConfig.contract_address),
          normalizeAddress(parsed.args.sender),
          Number(poolConfig.chain_id),
          log.transactionHash,
          log.index,
          log.blockNumber,
          block.timestamp,
          tokenInId,
          tokenOutId,
          tokenInRaw,
          tokenOutRaw,
          tokenInAmount,
          tokenOutAmount,
          parsed.name
        ]
      );
    }

    await setCursor(streamKey, Number(poolConfig.chain_id), toBlock);
  }
}

async function run() {
  if (!env.citreaRpcUrl) {
    throw new Error("CITREA_RPC_URL is required");
  }

  const pool = getPool();
  const provider = new ethers.JsonRpcProvider(env.citreaRpcUrl);

  const factories = await pool.query(
    `SELECT chain_id, contract_address, dex_name, dex_variant, contract_role, start_block
     FROM tracked_dex_contracts
     WHERE is_active = true AND chain_id = $1 AND contract_role = 'factory'
     ORDER BY dex_name, contract_address`,
    [env.citreaChainId]
  );

  for (const factory of factories.rows) {
    await discoverPools(factory, provider);
  }

  const pools = await pool.query(
    `SELECT chain_id, contract_address, dex_name, dex_variant, contract_role, start_block
     FROM tracked_dex_contracts
     WHERE is_active = true AND chain_id = $1 AND contract_role IN ('pair', 'pool')
     ORDER BY dex_name, contract_address`,
    [env.citreaChainId]
  );

  for (const poolConfig of pools.rows) {
    await processPool(poolConfig, provider);
  }

  console.log("dexIndexer completed");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
