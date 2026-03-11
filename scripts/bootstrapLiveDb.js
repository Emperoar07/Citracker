import fs from "fs";
import { getPool } from "../src/db.js";
import { env } from "../src/config.js";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function run() {
  const pool = getPool();
  const schema = fs.readFileSync("db/schema.sql", "utf8");
  const bridgeContracts = readJson("config/bridge-contracts.json");
  const dexContracts = readJson("config/dex-contracts.json");

  await pool.query(schema);

  await pool.query(
    `INSERT INTO chains (chain_id, chain_name, native_symbol, is_l1, is_l2)
     VALUES
      ($1, 'Bitcoin', 'BTC', TRUE, FALSE),
      ($2, 'Ethereum', 'ETH', TRUE, FALSE),
      ($3, 'Citrea', 'cBTC', FALSE, TRUE)
     ON CONFLICT (chain_id) DO NOTHING`,
    [env.bitcoinChainId, env.ethChainId, env.citreaChainId]
  );

  for (const contract of bridgeContracts) {
    await pool.query(
      `INSERT INTO tracked_bridge_contracts (
        chain_id,
        contract_address,
        protocol_name,
        bridge_variant,
        direction_scope,
        start_block,
        is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,TRUE)
      ON CONFLICT (chain_id, contract_address)
      DO UPDATE SET
        protocol_name = EXCLUDED.protocol_name,
        bridge_variant = EXCLUDED.bridge_variant,
        direction_scope = EXCLUDED.direction_scope,
        start_block = EXCLUDED.start_block,
        is_active = TRUE`,
      [
        contract.chainId,
        contract.contractAddress.toLowerCase(),
        contract.protocolName,
        contract.bridgeVariant,
        contract.directionScope,
        contract.startBlock ?? null
      ]
    );
  }

  await pool.query(
    `UPDATE tracked_bridge_contracts
     SET is_active = FALSE
     WHERE chain_id IN (${bridgeContracts.map((_, idx) => `$${idx + 1}`).join(", ")})
       AND (chain_id, contract_address) NOT IN (
         ${bridgeContracts
           .map((_, idx) => `($${bridgeContracts.length + idx * 2 + 1}, $${bridgeContracts.length + idx * 2 + 2})`)
           .join(", ")}
       )`,
    [
      ...bridgeContracts.map((contract) => contract.chainId),
      ...bridgeContracts.flatMap((contract) => [contract.chainId, contract.contractAddress.toLowerCase()])
    ]
  );

  for (const contract of dexContracts) {
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
      DO UPDATE SET
        dex_name = EXCLUDED.dex_name,
        dex_variant = EXCLUDED.dex_variant,
        contract_role = EXCLUDED.contract_role,
        start_block = EXCLUDED.start_block,
        is_active = TRUE`,
      [
        contract.chainId,
        contract.contractAddress.toLowerCase(),
        contract.dexName,
        contract.dexVariant,
        contract.contractRole,
        contract.startBlock ?? null
      ]
    );
  }

  await pool.query(
    `UPDATE tracked_dex_contracts
     SET is_active = FALSE
     WHERE chain_id IN (${dexContracts.map((_, idx) => `$${idx + 1}`).join(", ")})
       AND contract_role IN ('factory', 'router')
       AND (chain_id, contract_address) NOT IN (
         ${dexContracts
           .map((_, idx) => `($${dexContracts.length + idx * 2 + 1}, $${dexContracts.length + idx * 2 + 2})`)
           .join(", ")}
       )`,
    [
      ...dexContracts.map((contract) => contract.chainId),
      ...dexContracts.flatMap((contract) => [contract.chainId, contract.contractAddress.toLowerCase()])
    ]
  );

  console.log("Live DB bootstrapped.");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
