import { getPool } from "../db.js";
import { env } from "../config.js";
import {
  resolveNativeUsdPrice,
  resolveTokenUsdPrice,
  upsertTokenPriceSnapshot
} from "../services/priceService.js";

function startOfUtcDay() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

async function processBridgeRows(rows, pool) {
  let updated = 0;
  for (const row of rows) {
    const priced = await resolveTokenUsdPrice(row.symbol, row.block_timestamp);
    if (!priced) continue;

    const amountUsd = Number(row.amount_decimal) * priced.price;
    await pool.query(
      `UPDATE bridge_transfers
       SET amount_usd = $2
       WHERE id = $1 AND amount_usd IS NULL`,
      [row.id, String(amountUsd)]
    );
    await upsertTokenPriceSnapshot(row.token_id, row.block_timestamp, priced.price, priced.source);
    updated += 1;
  }

  return updated;
}

async function processBridgeBatch() {
  const pool = getPool();
  const dayStart = startOfUtcDay();
  const todayResult = await pool.query(
    `SELECT bt.id, bt.token_id, bt.amount_decimal, bt.block_timestamp, t.symbol
     FROM bridge_transfers bt
     JOIN tokens t ON t.id = bt.token_id
     WHERE bt.amount_usd IS NULL
       AND bt.status = 'confirmed'
       AND bt.block_timestamp >= $2
     ORDER BY bt.block_timestamp DESC
     LIMIT $1`,
    [env.pricingBatchSize, dayStart]
  );

  let scanned = todayResult.rowCount;
  let updated = await processBridgeRows(todayResult.rows, pool);

  const remaining = Math.max(env.pricingBatchSize - todayResult.rowCount, 0);
  if (remaining > 0) {
    const backlogResult = await pool.query(
      `SELECT bt.id, bt.token_id, bt.amount_decimal, bt.block_timestamp, t.symbol
       FROM bridge_transfers bt
       JOIN tokens t ON t.id = bt.token_id
       WHERE bt.amount_usd IS NULL
         AND bt.status = 'confirmed'
         AND bt.block_timestamp < $2
       ORDER BY bt.block_timestamp ASC
       LIMIT $1`,
      [remaining, dayStart]
    );

    scanned += backlogResult.rowCount;
    updated += await processBridgeRows(backlogResult.rows, pool);
  }

  return { scanned, updated };
}

async function processDexRows(rows, pool) {
  let updated = 0;
  for (const row of rows) {
    const [inPrice, outPrice] = await Promise.all([
      resolveTokenUsdPrice(row.token_in_symbol, row.block_timestamp),
      resolveTokenUsdPrice(row.token_out_symbol, row.block_timestamp)
    ]);

    const tokenInUsd = inPrice ? Number(row.token_in_amount) * inPrice.price : null;
    const tokenOutUsd = outPrice ? Number(row.token_out_amount) * outPrice.price : null;
    const swapVolumeUsd = tokenInUsd ?? tokenOutUsd;

    if (tokenInUsd === null && tokenOutUsd === null && swapVolumeUsd === null) {
      continue;
    }

    await pool.query(
      `UPDATE dex_swaps
       SET token_in_usd = COALESCE(token_in_usd, $2),
           token_out_usd = COALESCE(token_out_usd, $3),
           swap_volume_usd = COALESCE(swap_volume_usd, $4)
       WHERE id = $1`,
      [
        row.id,
        tokenInUsd === null ? null : String(tokenInUsd),
        tokenOutUsd === null ? null : String(tokenOutUsd),
        swapVolumeUsd === null ? null : String(swapVolumeUsd)
      ]
    );

    if (inPrice) {
      await upsertTokenPriceSnapshot(row.token_in_id, row.block_timestamp, inPrice.price, inPrice.source);
    }
    if (outPrice) {
      await upsertTokenPriceSnapshot(row.token_out_id, row.block_timestamp, outPrice.price, outPrice.source);
    }
    updated += 1;
  }

  return updated;
}

async function processDexBatch() {
  const pool = getPool();
  const dayStart = startOfUtcDay();
  const todayResult = await pool.query(
    `SELECT
       ds.id,
       ds.token_in_id,
       ds.token_out_id,
       ds.token_in_amount,
       ds.token_out_amount,
       ds.block_timestamp,
       t_in.symbol AS token_in_symbol,
       t_out.symbol AS token_out_symbol
     FROM dex_swaps ds
     LEFT JOIN tokens t_in ON t_in.id = ds.token_in_id
     LEFT JOIN tokens t_out ON t_out.id = ds.token_out_id
     WHERE (ds.token_in_usd IS NULL OR ds.token_out_usd IS NULL OR ds.swap_volume_usd IS NULL)
       AND ds.status = 'confirmed'
       AND ds.block_timestamp >= $2
     ORDER BY ds.block_timestamp DESC
     LIMIT $1`,
    [env.pricingBatchSize, dayStart]
  );

  let scanned = todayResult.rowCount;
  let updated = await processDexRows(todayResult.rows, pool);

  const remaining = Math.max(env.pricingBatchSize - todayResult.rowCount, 0);
  if (remaining > 0) {
    const backlogResult = await pool.query(
      `SELECT
         ds.id,
         ds.token_in_id,
         ds.token_out_id,
         ds.token_in_amount,
         ds.token_out_amount,
         ds.block_timestamp,
         t_in.symbol AS token_in_symbol,
         t_out.symbol AS token_out_symbol
       FROM dex_swaps ds
       LEFT JOIN tokens t_in ON t_in.id = ds.token_in_id
       LEFT JOIN tokens t_out ON t_out.id = ds.token_out_id
       WHERE (ds.token_in_usd IS NULL OR ds.token_out_usd IS NULL OR ds.swap_volume_usd IS NULL)
         AND ds.status = 'confirmed'
         AND ds.block_timestamp < $2
       ORDER BY ds.block_timestamp ASC
       LIMIT $1`,
      [remaining, dayStart]
    );

    scanned += backlogResult.rowCount;
    updated += await processDexRows(backlogResult.rows, pool);
  }

  return { scanned, updated };
}

async function processFeeRows(rows, pool) {
  let updated = 0;
  for (const row of rows) {
    const priced = await resolveNativeUsdPrice(row.chain_id, row.block_timestamp);
    if (!priced) continue;

    const feeUsd = Number(row.fee_native) * priced.price;
    await pool.query(
      `UPDATE tx_fees
       SET fee_usd = $2
       WHERE id = $1 AND fee_usd IS NULL`,
      [row.id, String(feeUsd)]
    );
    updated += 1;
  }

  return updated;
}

async function processFeeBatch() {
  const pool = getPool();
  const dayStart = startOfUtcDay();
  const todayResult = await pool.query(
    `SELECT id, chain_id, fee_native, block_timestamp
     FROM tx_fees
     WHERE fee_usd IS NULL
       AND block_timestamp >= $2
     ORDER BY block_timestamp DESC
     LIMIT $1`,
    [env.pricingBatchSize, dayStart]
  );

  let scanned = todayResult.rowCount;
  let updated = await processFeeRows(todayResult.rows, pool);

  const remaining = Math.max(env.pricingBatchSize - todayResult.rowCount, 0);
  if (remaining > 0) {
    const backlogResult = await pool.query(
      `SELECT id, chain_id, fee_native, block_timestamp
       FROM tx_fees
       WHERE fee_usd IS NULL
         AND block_timestamp < $2
       ORDER BY block_timestamp ASC
       LIMIT $1`,
      [remaining, dayStart]
    );

    scanned += backlogResult.rowCount;
    updated += await processFeeRows(backlogResult.rows, pool);
  }

  return { scanned, updated };
}

async function run() {
  const [bridge, dex, fees] = await Promise.all([
    processBridgeBatch(),
    processDexBatch(),
    processFeeBatch()
  ]);

  console.log(
    JSON.stringify({
      bridge,
      dex,
      fees
    })
  );
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
