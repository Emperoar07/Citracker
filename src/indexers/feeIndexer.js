import { ethers } from "ethers";
import { env } from "../config.js";
import { getPool } from "../db.js";

async function writeFee(pool, provider, chainId, wallet, txHash, category) {
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash)
  ]);

  if (!tx || !receipt) return;

  const feeWei = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice || 0n);
  const feeNative = ethers.formatEther(feeWei);
  const block = await provider.getBlock(receipt.blockNumber);

  await pool.query(
    `INSERT INTO tx_fees (
      chain_id, tx_hash, wallet_address, block_number, block_timestamp,
      gas_used, effective_gas_price_wei, fee_native, tx_category, is_bridge_related, is_dex_related
    ) VALUES (
      $1, $2, LOWER($3), $4, TO_TIMESTAMP($5),
      $6, $7, $8, $9, $10, $11
    ) ON CONFLICT DO NOTHING`,
    [
      chainId,
      txHash,
      wallet,
      receipt.blockNumber,
      block.timestamp,
      String(receipt.gasUsed),
      String(receipt.effectiveGasPrice || 0n),
      feeNative,
      category,
      category === "bridge",
      category === "dex"
    ]
  );
}

async function run() {
  if (!env.ethRpcUrl || !env.citreaRpcUrl) {
    throw new Error("ETH_RPC_URL and CITREA_RPC_URL are required");
  }

  const pool = getPool();
  const ethProvider = new ethers.JsonRpcProvider(env.ethRpcUrl);
  const citreaProvider = new ethers.JsonRpcProvider(env.citreaRpcUrl);

  const bridgeTxs = await pool.query(
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
        OR (
          bt.destination_tx_hash IS NOT NULL
          AND bt.destination_chain_id IN ($1, $2)
          AND dst_fee.id IS NULL
        )`,
    [env.ethChainId, env.citreaChainId]
  );

  for (const row of bridgeTxs.rows) {
    const sourceChainId = Number(row.source_chain_id);
    const destinationChainId = Number(row.destination_chain_id);

    if (sourceChainId === env.ethChainId || sourceChainId === env.citreaChainId) {
      const provider = sourceChainId === env.ethChainId ? ethProvider : citreaProvider;
      await writeFee(pool, provider, sourceChainId, row.wallet_address, row.source_tx_hash, "bridge");
      continue;
    }

    if (destinationChainId === env.citreaChainId && row.destination_tx_hash) {
      await writeFee(pool, citreaProvider, destinationChainId, row.wallet_address, row.destination_tx_hash, "bridge");
    }
  }

  const dexTxs = await pool.query(
    `SELECT DISTINCT ds.chain_id, ds.tx_hash, ds.wallet_address
     FROM dex_swaps ds
     LEFT JOIN tx_fees tf
       ON tf.chain_id = ds.chain_id
      AND tf.tx_hash = ds.tx_hash
      AND tf.wallet_address = ds.wallet_address
     WHERE tf.id IS NULL`
  );

  for (const row of dexTxs.rows) {
    const provider = Number(row.chain_id) === env.ethChainId ? ethProvider : citreaProvider;
    await writeFee(pool, provider, Number(row.chain_id), row.wallet_address, row.tx_hash, "dex");
  }

  console.log("feeIndexer completed");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
