# Event Model (Wallet-Centric)

## Exact Metric Definitions
For a selected wallet and time range:

- `bridge_inflow`: sum of bridged amounts where funds move from Ethereum L1 to Citrea L2 and the wallet is the Citrea receiver.
- `bridge_outflow`: sum of bridged amounts where funds move from Citrea L2 to Ethereum L1 and the wallet is the Citrea sender.
- `bridge_volume`: `bridge_inflow + bridge_outflow`.
- `netflow`: `bridge_inflow - bridge_outflow`.
- `gas_spent_l1`: sum of gas fees paid by wallet on Ethereum txs.
- `gas_spent_l2`: sum of gas fees paid by wallet on Citrea txs.
- `gas_spent_total`: `gas_spent_l1 + gas_spent_l2`.
- `dex_swap_volume`: sum of normalized USD volume for all DEX swaps executed by wallet on Citrea.
- `dex_swap_count`: number of swap events executed by wallet on Citrea.
- `total_activity_volume`: `bridge_volume + dex_swap_volume` (both in USD view).

## Goal
A single wallet input drives bridge flow, DEX swap activity, and gas on one page.

## Mainnet Coverage
- Ethereum canonical bridge contracts capture L1 deposit initiation into Citrea.
- Citrea LayerZero OFT contracts capture Citrea-side wallet inflow and outflow for USDC, USDT, and WBTC.
- Citrea Bitcoin system bridge captures wallet-level BTC-origin deposits and Citrea-to-Bitcoin withdrawals.
- Juiceswap V2, Juiceswap V3, and Satsuma pools are discovered from live factory events and then indexed with persistent cursors.
- Fibrous is tracked as a router entrypoint, but swap attribution still comes from the downstream pool swap logs.

## Canonical Event Shapes
Bridge model:

```ts
export type NormalizedBridgeTransfer = {
  direction: 'inflow' | 'outflow';
  protocolName: string;
  walletAddress: string;
  counterpartyAddress?: string;

  tokenAddressL1?: string;
  tokenAddressL2?: string;
  amountRaw: string;
  decimals: number;

  sourceChainId: number;
  destinationChainId: number;
  sourceTxHash: string;
  destinationTxHash?: string;
  sourceLogIndex?: number;
  blockNumber: number;
  blockTimestamp: string;

  eventName: string;
  status: 'pending' | 'confirmed' | 'reverted';
};
```

DEX swap model:

```ts
export type NormalizedDexSwap = {
  dexName: string;
  protocolVersion?: string;
  walletAddress: string;
  poolAddress?: string;
  routerAddress?: string;

  chainId: number;
  txHash: string;
  logIndex?: number;
  blockNumber: number;
  blockTimestamp: string;

  tokenInAddress: string;
  tokenOutAddress: string;
  tokenInRaw: string;
  tokenOutRaw: string;
  tokenInDecimals: number;
  tokenOutDecimals: number;

  tokenInUsd?: string;
  tokenOutUsd?: string;
  swapVolumeUsd?: string;

  eventName: string;
  status: 'pending' | 'confirmed' | 'reverted';
};
```

Gas model:

```ts
export type NormalizedTxFee = {
  chainId: number;
  txHash: string;
  walletAddress: string;
  blockNumber: number;
  blockTimestamp: string;
  gasUsed: string;
  effectiveGasPriceWei: string;
  feeNative: string;
  txCategory: 'bridge' | 'dex' | 'other';
};
```

## Swap Volume Normalization Rule
For each confirmed swap:
- compute `tokenInUsd` and `tokenOutUsd` from minute price feed.
- set `swapVolumeUsd = tokenInUsd` when available.
- fallback to `tokenOutUsd` when input side is missing.
- if both exist but diverge, use `LEAST(tokenInUsd, tokenOutUsd)` to reduce manipulation impact.

## Mapping Rules
- `inflow`: wallet receives bridged value on Citrea.
- `outflow`: wallet sends value from Citrea toward Ethereum.
- `wallet_address` is normalized to lowercase for indexing.
- bridge and DEX metrics remain separate; `total_activity_volume` combines them.

## Indexer Steps
1. Read configured bridge contracts on Ethereum and Citrea.
2. Decode Ethereum `DepositInitiated`, Citrea `OFTReceived`/`OFTSent`, and Citrea BTC bridge events into `bridge_transfers`.
3. Read configured DEX contracts on Citrea and decode swap events.
4. Resolve token metadata and write `dex_swaps`.
5. Pull tx receipts for any bridge or DEX tx missing a fee record and write `tx_fees` with `tx_category` (`bridge` or `dex`).
6. Join historical prices to fill `amount_usd`, `tokenInUsd`, `tokenOutUsd`, `swapVolumeUsd`, `fee_usd`.
7. Refresh materialized views (`wallet_flow_daily`, `wallet_gas_daily`, `wallet_dex_daily`).

## Reorg Handling
- Keep a confirmation depth per chain.
- Mark replaced records `reverted` when a reorg invalidates logs.
- Re-ingest affected block window.

## Required Config
- `ETH_RPC_URL`
- `CITREA_RPC_URL`
- `START_BLOCK_ETH`
- `START_BLOCK_CITREA`
- `BRIDGE_CONTRACTS_JSON` (array of chain+address+protocol)
- `DEX_CONTRACTS_JSON` (array of chain+address+dex+role)
- `PRICE_API_PROVIDER`
