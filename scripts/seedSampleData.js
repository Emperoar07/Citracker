import { getPool } from "../src/db.js";
import { env } from "../src/config.js";
import fs from "fs";

async function run() {
  const pool = getPool();

  const schema = fs.readFileSync("db/schema.sql", "utf8");
  await pool.query(schema);

  await pool.query(
    `INSERT INTO chains (chain_id, chain_name, native_symbol, is_l1, is_l2)
     VALUES
      ($1, 'Ethereum', 'ETH', TRUE, FALSE),
      ($2, 'Citrea', 'cBTC', FALSE, TRUE)
     ON CONFLICT (chain_id) DO NOTHING`,
    [env.ethChainId, env.citreaChainId]
  );

  await pool.query(
    `INSERT INTO bridge_transfers (
      direction, protocol_name, wallet_address, source_chain_id, destination_chain_id,
      source_tx_hash, source_log_index, block_number, block_timestamp,
      amount_raw, amount_decimal, amount_usd, event_name
    ) VALUES
      ('inflow', 'canonical', LOWER($1), $2, $3, '0xseed1', 0, 1, NOW() - INTERVAL '2 day', '1000000000', 1000, 1000, 'DepositInitiated'),
      ('outflow', 'canonical', LOWER($1), $3, $2, '0xseed2', 0, 2, NOW() - INTERVAL '1 day', '250000000', 250, 250, 'WithdrawalInitiated')
     ON CONFLICT DO NOTHING`,
    ["0x1111111111111111111111111111111111111111", env.ethChainId, env.citreaChainId]
  );

  await pool.query(
    `INSERT INTO dex_swaps (
      dex_name, wallet_address, chain_id, tx_hash, log_index, block_number, block_timestamp,
      token_in_raw, token_out_raw, token_in_amount, token_out_amount, swap_volume_usd, event_name
    ) VALUES
      ('example-dex', LOWER($1), $2, '0xseed3', 0, 3, NOW() - INTERVAL '12 hour',
       '500000000', '490000000', 500, 490, 500, 'Swap')
     ON CONFLICT DO NOTHING`,
    ["0x1111111111111111111111111111111111111111", env.citreaChainId]
  );

  await pool.query(
    `INSERT INTO tx_fees (
      chain_id, tx_hash, wallet_address, block_number, block_timestamp,
      gas_used, effective_gas_price_wei, fee_native, fee_usd, tx_category, is_bridge_related, is_dex_related
    ) VALUES
      ($1, '0xseed1', LOWER($3), 1, NOW() - INTERVAL '2 day', 21000, 1000000000, 0.000021, 0.08, 'bridge', TRUE, FALSE),
      ($2, '0xseed2', LOWER($3), 2, NOW() - INTERVAL '1 day', 180000, 25000000, 0.0045, 0.95, 'bridge', TRUE, FALSE),
      ($2, '0xseed3', LOWER($3), 3, NOW() - INTERVAL '12 hour', 190000, 25000000, 0.00475, 1.02, 'dex', FALSE, TRUE)
     ON CONFLICT DO NOTHING`,
    [env.ethChainId, env.citreaChainId, "0x1111111111111111111111111111111111111111"]
  );

  await pool.query("REFRESH MATERIALIZED VIEW wallet_flow_daily");
  await pool.query("REFRESH MATERIALIZED VIEW wallet_gas_daily");
  await pool.query("REFRESH MATERIALIZED VIEW wallet_dex_daily");

  console.log("Mock data seeded.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
