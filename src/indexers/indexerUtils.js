import { ethers } from "ethers";
import { getPool } from "../db.js";
import { env } from "../config.js";

export function normalizeAddress(address) {
  return typeof address === "string" ? address.toLowerCase() : null;
}

export function chunkRange(fromBlock, toBlock, chunkSize) {
  const ranges = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const end = Math.min(cursor + chunkSize - 1, toBlock);
    ranges.push([cursor, end]);
    cursor = end + 1;
  }
  return ranges;
}

export function chunkRangeLimited(fromBlock, toBlock, chunkSize, maxRanges) {
  if (fromBlock > toBlock) return [];

  const ranges = [];
  let cursor = fromBlock;
  let remaining = Number.isFinite(maxRanges) ? Math.max(Number(maxRanges), 0) : Infinity;

  while (cursor <= toBlock && remaining > 0) {
    const end = Math.min(cursor + chunkSize - 1, toBlock);
    ranges.push([cursor, end]);
    cursor = end + 1;
    remaining -= 1;
  }

  return ranges;
}

export function getBufferedHeadBlock(headBlock) {
  const numericHead = Number(headBlock || 0);
  return Math.max(numericHead - Math.max(env.rpcHeadBufferBlocks, 0), 0);
}

export async function getLogsSafe(provider, filter) {
  let attempts = 0;
  let nextFilter = { ...filter };

  while (attempts < 3) {
    try {
      return await provider.getLogs(nextFilter);
    } catch (error) {
      const message = String(error?.shortMessage || error?.message || error?.error?.message || "");
      if (!/beyond current head block/i.test(message)) {
        throw error;
      }

      const bufferedHead = getBufferedHeadBlock(await provider.getBlockNumber());
      if (Number(nextFilter.fromBlock) > bufferedHead) {
        return [];
      }

      nextFilter = {
        ...nextFilter,
        toBlock: Math.min(Number(nextFilter.toBlock), bufferedHead)
      };
      attempts += 1;
    }
  }

  return [];
}

export async function getOrCreateCursor(streamKey, chainId, startBlock) {
  const pool = getPool();
  const existing = await pool.query(
    "SELECT last_processed_block FROM indexer_cursors WHERE stream_key = $1",
    [streamKey]
  );

  if (existing.rowCount) {
    return Number(existing.rows[0].last_processed_block);
  }

  const initial = Math.max(Number(startBlock || 0) - 1, -1);
  await pool.query(
    `INSERT INTO indexer_cursors (stream_key, chain_id, last_processed_block)
     VALUES ($1, $2, $3)
     ON CONFLICT (stream_key) DO NOTHING`,
    [streamKey, chainId, initial]
  );

  return initial;
}

export async function setCursor(streamKey, chainId, blockNumber) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO indexer_cursors (stream_key, chain_id, last_processed_block, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (stream_key)
     DO UPDATE SET last_processed_block = EXCLUDED.last_processed_block, updated_at = NOW()`,
    [streamKey, chainId, blockNumber]
  );
}

export async function upsertToken({
  symbol,
  name,
  decimals,
  l1ChainId,
  l1Address,
  l2ChainId,
  l2Address,
  isNative = false
}) {
  const pool = getPool();
  const query = `
    INSERT INTO tokens (symbol, name, decimals, l1_chain_id, l1_address, l2_chain_id, l2_address, is_native)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  const inserted = await pool.query(query, [
    symbol,
    name,
    decimals,
    l1ChainId || null,
    l1Address ? normalizeAddress(l1Address) : null,
    l2ChainId || null,
    l2Address ? normalizeAddress(l2Address) : null,
    isNative
  ]);

  if (inserted.rowCount) {
    return inserted.rows[0].id;
  }

  let selected;
  if (l1ChainId && l1Address) {
    selected = await pool.query(
      `SELECT id FROM tokens
       WHERE l1_chain_id = $1 AND l1_address = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [l1ChainId, normalizeAddress(l1Address)]
    );
  } else if (l2ChainId && l2Address) {
    selected = await pool.query(
      `SELECT id FROM tokens
       WHERE l2_chain_id = $1 AND l2_address = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [l2ChainId, normalizeAddress(l2Address)]
    );
  } else if (isNative && l2ChainId) {
    selected = await pool.query(
      `SELECT id FROM tokens
       WHERE l2_chain_id = $1 AND is_native = TRUE AND symbol = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [l2ChainId, symbol]
    );
  } else {
    selected = { rows: [] };
  }

  return selected.rows[0]?.id || null;
}

export async function readErc20Metadata(provider, address) {
  const token = new ethers.Contract(
    address,
    [
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function decimals() view returns (uint8)"
    ],
    provider
  );

  const [symbol, name, decimals] = await Promise.all([
    token.symbol(),
    token.name(),
    token.decimals()
  ]);

  return { symbol, name, decimals: Number(decimals) };
}

export async function readPoolTokens(provider, address) {
  const pool = new ethers.Contract(
    address,
    [
      "function token0() view returns (address)",
      "function token1() view returns (address)"
    ],
    provider
  );

  const [token0, token1] = await Promise.all([pool.token0(), pool.token1()]);
  return { token0, token1 };
}
