-- Citrea Wallet Flow Tracker Schema (PostgreSQL)
-- Focus: wallet-level bridge flow + DEX swaps + gas for ETH L1 <-> Citrea L2 activity.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chains (
  chain_id BIGINT PRIMARY KEY,
  chain_name TEXT NOT NULL,
  native_symbol TEXT NOT NULL,
  is_l1 BOOLEAN NOT NULL DEFAULT FALSE,
  is_l2 BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tracked_bridge_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  contract_address TEXT NOT NULL,
  protocol_name TEXT NOT NULL,
  bridge_variant TEXT NOT NULL DEFAULT 'canonical_erc20' CHECK (bridge_variant IN ('canonical_erc20', 'layerzero_oft', 'citrea_btc_system')),
  direction_scope TEXT NOT NULL CHECK (direction_scope IN ('l1_to_l2', 'l2_to_l1', 'both')),
  start_block BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, contract_address)
);

ALTER TABLE tracked_bridge_contracts
  ADD COLUMN IF NOT EXISTS bridge_variant TEXT,
  ADD COLUMN IF NOT EXISTS start_block BIGINT;
UPDATE tracked_bridge_contracts SET bridge_variant = 'canonical_erc20' WHERE bridge_variant IS NULL;
ALTER TABLE tracked_bridge_contracts ALTER COLUMN bridge_variant SET DEFAULT 'canonical_erc20';
ALTER TABLE tracked_bridge_contracts ALTER COLUMN bridge_variant SET NOT NULL;
ALTER TABLE tracked_bridge_contracts DROP CONSTRAINT IF EXISTS tracked_bridge_contracts_bridge_variant_check;
ALTER TABLE tracked_bridge_contracts
  ADD CONSTRAINT tracked_bridge_contracts_bridge_variant_check
  CHECK (bridge_variant IN ('canonical_erc20', 'layerzero_oft', 'citrea_btc_system'));

CREATE TABLE IF NOT EXISTS tracked_dex_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  contract_address TEXT NOT NULL,
  dex_name TEXT NOT NULL,
  dex_variant TEXT NOT NULL DEFAULT 'uniswap_v3' CHECK (dex_variant IN ('uniswap_v2', 'uniswap_v3', 'algebra_v3', 'aggregator_router')),
  contract_role TEXT NOT NULL CHECK (contract_role IN ('factory', 'router', 'pair', 'pool', 'vault', 'quoter', 'other')),
  start_block BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain_id, contract_address)
);

ALTER TABLE tracked_dex_contracts
  ADD COLUMN IF NOT EXISTS dex_variant TEXT,
  ADD COLUMN IF NOT EXISTS start_block BIGINT;
UPDATE tracked_dex_contracts SET dex_variant = 'uniswap_v3' WHERE dex_variant IS NULL;
ALTER TABLE tracked_dex_contracts ALTER COLUMN dex_variant SET DEFAULT 'uniswap_v3';
ALTER TABLE tracked_dex_contracts ALTER COLUMN dex_variant SET NOT NULL;
ALTER TABLE tracked_dex_contracts DROP CONSTRAINT IF EXISTS tracked_dex_contracts_dex_variant_check;
ALTER TABLE tracked_dex_contracts
  ADD CONSTRAINT tracked_dex_contracts_dex_variant_check
  CHECK (dex_variant IN ('uniswap_v2', 'uniswap_v3', 'algebra_v3', 'aggregator_router'));
ALTER TABLE tracked_dex_contracts DROP CONSTRAINT IF EXISTS tracked_dex_contracts_contract_role_check;
ALTER TABLE tracked_dex_contracts
  ADD CONSTRAINT tracked_dex_contracts_contract_role_check
  CHECK (contract_role IN ('factory', 'router', 'pair', 'pool', 'vault', 'quoter', 'other'));

CREATE TABLE IF NOT EXISTS tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  name TEXT,
  decimals INT NOT NULL,
  l1_chain_id BIGINT,
  l1_address TEXT,
  l2_chain_id BIGINT,
  l2_address TEXT,
  is_native BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bridge_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  protocol_name TEXT NOT NULL,
  token_id UUID REFERENCES tokens(id),

  -- Wallet-centric fields
  wallet_address TEXT NOT NULL, -- the wallet whose flow is being counted
  counterparty_address TEXT,

  -- Chain/tx context
  source_chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  destination_chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  source_tx_hash TEXT NOT NULL,
  destination_tx_hash TEXT,
  source_log_index INT,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,

  -- Amounts
  amount_raw NUMERIC(78, 0) NOT NULL,
  amount_decimal NUMERIC(38, 18) NOT NULL,
  amount_usd NUMERIC(38, 8),

  -- Status and provenance
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'reverted')),
  event_name TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tx_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  tx_hash TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,

  gas_used NUMERIC(38, 0) NOT NULL,
  effective_gas_price_wei NUMERIC(38, 0) NOT NULL,
  fee_native NUMERIC(38, 18) NOT NULL,
  fee_usd NUMERIC(38, 8),

  is_bridge_related BOOLEAN NOT NULL DEFAULT FALSE,
  is_dex_related BOOLEAN NOT NULL DEFAULT FALSE,
  tx_category TEXT NOT NULL DEFAULT 'other' CHECK (tx_category IN ('bridge', 'dex', 'other')),
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (chain_id, tx_hash, wallet_address)
);

CREATE TABLE IF NOT EXISTS dex_swaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dex_name TEXT NOT NULL,
  protocol_version TEXT,
  wallet_address TEXT NOT NULL,
  pool_address TEXT,
  router_address TEXT,

  chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  tx_hash TEXT NOT NULL,
  log_index INT,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMPTZ NOT NULL,

  token_in_id UUID REFERENCES tokens(id),
  token_out_id UUID REFERENCES tokens(id),
  token_in_raw NUMERIC(78, 0) NOT NULL,
  token_out_raw NUMERIC(78, 0) NOT NULL,
  token_in_amount NUMERIC(38, 18) NOT NULL,
  token_out_amount NUMERIC(38, 18) NOT NULL,
  token_in_usd NUMERIC(38, 8),
  token_out_usd NUMERIC(38, 8),
  swap_volume_usd NUMERIC(38, 8), -- normalized swap volume, usually token_in_usd

  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'reverted')),
  event_name TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_prices_1m (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id UUID NOT NULL REFERENCES tokens(id),
  quote_currency TEXT NOT NULL DEFAULT 'USD',
  ts_minute TIMESTAMPTZ NOT NULL,
  price NUMERIC(38, 18) NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (token_id, quote_currency, ts_minute)
);

CREATE TABLE IF NOT EXISTS indexer_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_key TEXT NOT NULL UNIQUE,
  chain_id BIGINT NOT NULL REFERENCES chains(chain_id),
  last_processed_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_wallet_time ON bridge_transfers (wallet_address, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_wallet_direction_time ON bridge_transfers (wallet_address, direction, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_token_time ON bridge_transfers (token_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_src_tx ON bridge_transfers (source_chain_id, source_tx_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bridge_dedupe_expr ON bridge_transfers (
  source_chain_id,
  source_tx_hash,
  (COALESCE(source_log_index, -1)),
  wallet_address,
  direction
);
CREATE INDEX IF NOT EXISTS idx_fees_wallet_time ON tx_fees (wallet_address, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fees_wallet_chain_time ON tx_fees (wallet_address, chain_id, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dex_wallet_time ON dex_swaps (wallet_address, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dex_wallet_dex_time ON dex_swaps (wallet_address, dex_name, block_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dex_chain_tx ON dex_swaps (chain_id, tx_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dex_dedupe_expr ON dex_swaps (
  chain_id,
  tx_hash,
  (COALESCE(log_index, -1)),
  wallet_address
);
DROP INDEX IF EXISTS uq_tokens_l1_pair_expr;
DROP INDEX IF EXISTS uq_tokens_l2_pair_expr;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tokens_l1_pair
  ON tokens (l1_chain_id, l1_address)
  WHERE l1_chain_id IS NOT NULL AND l1_address IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tokens_l2_pair
  ON tokens (l2_chain_id, l2_address)
  WHERE l2_chain_id IS NOT NULL AND l2_address IS NOT NULL;

-- Wallet daily aggregates for fast dashboard queries.
CREATE MATERIALIZED VIEW IF NOT EXISTS wallet_flow_daily AS
SELECT
  date_trunc('day', bt.block_timestamp) AS day,
  bt.wallet_address,
  SUM(CASE WHEN bt.direction = 'inflow' THEN bt.amount_decimal ELSE 0 END) AS inflow_amount,
  SUM(CASE WHEN bt.direction = 'outflow' THEN bt.amount_decimal ELSE 0 END) AS outflow_amount,
  SUM(bt.amount_decimal) AS gross_volume_amount,
  SUM(CASE WHEN bt.direction = 'inflow' THEN COALESCE(bt.amount_usd, 0) ELSE 0 END) AS inflow_usd,
  SUM(CASE WHEN bt.direction = 'outflow' THEN COALESCE(bt.amount_usd, 0) ELSE 0 END) AS outflow_usd,
  SUM(COALESCE(bt.amount_usd, 0)) AS gross_volume_usd
FROM bridge_transfers bt
WHERE bt.status = 'confirmed'
GROUP BY 1, 2;

CREATE INDEX IF NOT EXISTS idx_wallet_flow_daily_wallet_day ON wallet_flow_daily (wallet_address, day DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS wallet_gas_daily AS
SELECT
  date_trunc('day', tf.block_timestamp) AS day,
  tf.wallet_address,
  SUM(CASE WHEN tf.chain_id IN (1) THEN tf.fee_native ELSE 0 END) AS gas_l1_native,
  SUM(CASE WHEN tf.chain_id NOT IN (1) THEN tf.fee_native ELSE 0 END) AS gas_l2_native,
  SUM(COALESCE(tf.fee_usd, 0)) AS gas_total_usd
FROM tx_fees tf
GROUP BY 1, 2;

CREATE INDEX IF NOT EXISTS idx_wallet_gas_daily_wallet_day ON wallet_gas_daily (wallet_address, day DESC);

CREATE MATERIALIZED VIEW IF NOT EXISTS wallet_dex_daily AS
WITH normalized_swaps AS (
  SELECT DISTINCT ON (ds.wallet_address, ds.tx_hash)
    ds.wallet_address,
    ds.tx_hash,
    ds.block_timestamp,
    ds.swap_volume_usd
  FROM dex_swaps ds
  WHERE ds.status = 'confirmed'
  ORDER BY ds.wallet_address, ds.tx_hash, COALESCE(ds.log_index, -1), ds.block_timestamp DESC
)
SELECT
  date_trunc('day', ns.block_timestamp) AS day,
  ns.wallet_address,
  COUNT(*) AS swap_count,
  SUM(COALESCE(ns.swap_volume_usd, 0)) AS dex_volume_usd
FROM normalized_swaps ns
GROUP BY 1, 2;

CREATE INDEX IF NOT EXISTS idx_wallet_dex_daily_wallet_day ON wallet_dex_daily (wallet_address, day DESC);
