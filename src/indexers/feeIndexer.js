import { ethers } from "ethers";
import { env } from "../config.js";
import { getPool } from "../db.js";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Explorer HTTP ${res.status}`);
  }
  return res.json();
}

async function withRetries(fn, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

async function writeFee(pool, provider, chainId, wallet, txHash, category) {
  const [tx, receipt] = await Promise.all([
    withRetries(() => provider.getTransaction(txHash)),
    withRetries(() => provider.getTransactionReceipt(txHash))
  ]);

  if (!tx || !receipt) return;

  let effectiveGasPrice =
    receipt.effectiveGasPrice ??
    tx.gasPrice ??
    tx.maxFeePerGas ??
    tx.maxPriorityFeePerGas ??
    0n;
  let feeWei = BigInt(receipt.gasUsed) * BigInt(effectiveGasPrice || 0n);

  if (Number(chainId) === env.citreaChainId && (!effectiveGasPrice || feeWei === 0n) && env.citreascanApiUrl) {
    const explorerTx = await withRetries(() =>
      fetchJson(`${env.citreascanApiUrl.replace(/\/$/, "")}/transactions/${txHash}`)
    );
    effectiveGasPrice = BigInt(explorerTx?.gas_price || effectiveGasPrice || 0n);
    feeWei = BigInt(explorerTx?.fee?.value || feeWei || 0n);
  }

  const feeNative = ethers.formatEther(feeWei);
  const block = await withRetries(() => provider.getBlock(receipt.blockNumber));

  await pool.query(
    `INSERT INTO tx_fees (
      chain_id, tx_hash, wallet_address, block_number, block_timestamp,
      gas_used, effective_gas_price_wei, fee_native, tx_category, is_bridge_related, is_dex_related
    ) VALUES (
      $1, $2, LOWER($3), $4, TO_TIMESTAMP($5),
      $6, $7, $8, $9, $10, $11
    ) ON CONFLICT (chain_id, tx_hash, wallet_address)
      DO UPDATE SET
        block_number = EXCLUDED.block_number,
        block_timestamp = EXCLUDED.block_timestamp,
        gas_used = EXCLUDED.gas_used,
        effective_gas_price_wei = EXCLUDED.effective_gas_price_wei,
        fee_native = EXCLUDED.fee_native,
        tx_category = EXCLUDED.tx_category,
        is_bridge_related = EXCLUDED.is_bridge_related,
        is_dex_related = EXCLUDED.is_dex_related,
        fee_usd = NULL`,
    [
      chainId,
      txHash,
      wallet,
      receipt.blockNumber,
      block.timestamp,
      String(receipt.gasUsed),
      String(effectiveGasPrice || 0n),
      feeNative,
      category,
      category === "bridge",
      category === "dex"
    ]
  );
}

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

async function run() {
  if (!env.ethRpcUrl || !env.citreaRpcUrl) {
    throw new Error("ETH_RPC_URL and CITREA_RPC_URL are required");
  }

  const pool = getPool();
  const ethProvider = new ethers.JsonRpcProvider(env.ethRpcUrl);
  const citreaProvider = new ethers.JsonRpcProvider(env.citreaRpcUrl);
  const dayStart = startOfUtcDay();

  const bridgeTodayTxs = await pool.query(
    `SELECT DISTINCT bt.source_chain_id, bt.source_tx_hash, bt.destination_chain_id, bt.destination_tx_hash, bt.wallet_address
     FROM bridge_transfers bt
     LEFT JOIN tx_fees src_fee
       ON src_fee.chain_id = bt.source_chain_id
      AND src_fee.tx_hash = bt.source_tx_hash
      AND src_fee.wallet_address = bt.wallet_address
     LEFT JOIN tx_fees dst_fee
       ON dst_fee.chain_id = bt.destination_chain_id
      AND dst_fee.tx_hash = bt.destination_tx_hash
      AND dst_fee.wallet_address = bt.wallet_address
     WHERE src_fee.id IS NULL
        OR COALESCE(src_fee.effective_gas_price_wei, 0) = 0
        OR (
          bt.destination_tx_hash IS NOT NULL
          AND bt.destination_chain_id IN ($1, $2)
          AND (
            dst_fee.id IS NULL
            OR COALESCE(dst_fee.effective_gas_price_wei, 0) = 0
          )
        )
       AND bt.block_timestamp >= $3
     ORDER BY bt.block_timestamp DESC, bt.source_chain_id, bt.source_tx_hash
     LIMIT $4`,
    [env.ethChainId, env.citreaChainId, dayStart, env.indexerMaxPendingItems]
  );

  let bridgeRows = bridgeTodayTxs.rows;
  const remainingBridge = Math.max(env.indexerMaxPendingItems - bridgeTodayTxs.rowCount, 0);
  if (remainingBridge > 0) {
    const bridgeBacklogTxs = await pool.query(
      `SELECT DISTINCT bt.source_chain_id, bt.source_tx_hash, bt.destination_chain_id, bt.destination_tx_hash, bt.wallet_address
       FROM bridge_transfers bt
       LEFT JOIN tx_fees src_fee
         ON src_fee.chain_id = bt.source_chain_id
        AND src_fee.tx_hash = bt.source_tx_hash
        AND src_fee.wallet_address = bt.wallet_address
       LEFT JOIN tx_fees dst_fee
         ON dst_fee.chain_id = bt.destination_chain_id
        AND dst_fee.tx_hash = bt.destination_tx_hash
        AND dst_fee.wallet_address = bt.wallet_address
       WHERE (
           src_fee.id IS NULL
           OR COALESCE(src_fee.effective_gas_price_wei, 0) = 0
           OR (
             bt.destination_tx_hash IS NOT NULL
             AND bt.destination_chain_id IN ($1, $2)
             AND (
               dst_fee.id IS NULL
               OR COALESCE(dst_fee.effective_gas_price_wei, 0) = 0
             )
           )
         )
         AND bt.block_timestamp < $3
       ORDER BY bt.block_timestamp ASC, bt.source_chain_id, bt.source_tx_hash
       LIMIT $4`,
      [env.ethChainId, env.citreaChainId, dayStart, remainingBridge]
    );
    bridgeRows = bridgeRows.concat(bridgeBacklogTxs.rows);
  }

  for (const row of bridgeRows) {
    const sourceChainId = Number(row.source_chain_id);
    const destinationChainId = Number(row.destination_chain_id);

    if (sourceChainId === env.ethChainId || sourceChainId === env.citreaChainId) {
      const provider = sourceChainId === env.ethChainId ? ethProvider : citreaProvider;
      try {
        await writeFee(pool, provider, sourceChainId, row.wallet_address, row.source_tx_hash, "bridge");
      } catch (error) {
        console.warn(`feeIndexer bridge source skipped ${row.source_tx_hash}: ${error.message}`);
      }
      continue;
    }

    if (destinationChainId === env.citreaChainId && row.destination_tx_hash) {
      try {
        await writeFee(pool, citreaProvider, destinationChainId, row.wallet_address, row.destination_tx_hash, "bridge");
      } catch (error) {
        console.warn(`feeIndexer bridge destination skipped ${row.destination_tx_hash}: ${error.message}`);
      }
    }
  }

  const dexTodayTxs = await pool.query(
    `SELECT DISTINCT ds.chain_id, ds.tx_hash, ds.wallet_address
     FROM dex_swaps ds
     LEFT JOIN tx_fees tf
       ON tf.chain_id = ds.chain_id
      AND tf.tx_hash = ds.tx_hash
      AND tf.wallet_address = ds.wallet_address
     WHERE tf.id IS NULL
        OR COALESCE(tf.effective_gas_price_wei, 0) = 0
       AND ds.block_timestamp >= $1
     ORDER BY ds.block_timestamp DESC, ds.chain_id, ds.tx_hash
     LIMIT $2`,
    [dayStart, env.indexerMaxPendingItems]
  );

  let dexRows = dexTodayTxs.rows;
  const remainingDex = Math.max(env.indexerMaxPendingItems - dexTodayTxs.rowCount, 0);
  if (remainingDex > 0) {
    const dexBacklogTxs = await pool.query(
      `SELECT DISTINCT ds.chain_id, ds.tx_hash, ds.wallet_address
       FROM dex_swaps ds
       LEFT JOIN tx_fees tf
         ON tf.chain_id = ds.chain_id
        AND tf.tx_hash = ds.tx_hash
        AND tf.wallet_address = ds.wallet_address
       WHERE (tf.id IS NULL OR COALESCE(tf.effective_gas_price_wei, 0) = 0)
         AND ds.block_timestamp < $1
       ORDER BY ds.block_timestamp ASC, ds.chain_id, ds.tx_hash
       LIMIT $2`,
      [dayStart, remainingDex]
    );
    dexRows = dexRows.concat(dexBacklogTxs.rows);
  }

  for (const row of dexRows) {
    const provider = Number(row.chain_id) === env.ethChainId ? ethProvider : citreaProvider;
    try {
      await writeFee(pool, provider, Number(row.chain_id), row.wallet_address, row.tx_hash, "dex");
    } catch (error) {
      console.warn(`feeIndexer dex skipped ${row.tx_hash}: ${error.message}`);
    }
  }

  console.log("feeIndexer completed");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
