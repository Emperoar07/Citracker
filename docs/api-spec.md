# API Spec (Wallet Input First)

Wallet endpoints require a wallet address input and support wallet paste only (no wallet connection flow).

## 0) Citrea Network Summary
`GET /api/v1/network/summary`

Response includes:
- Citrea mainnet inflow/outflow from indexed bridge data across Ethereum-origin canonical bridges and BTC-origin Citrea bridge flow.
- Total users and transactions from Citrea mainnet explorer stats.
- Citrea TVL from DefiLlama chain data.
- Bridged amount split by Bitcoin-origin and EVM-origin.
- Total token spend on Citrea plus per-token spend breakdown from indexed DEX input totals.

## 1) Wallet Summary
`GET /api/v1/wallet/{wallet}/summary?from=2026-01-01T00:00:00Z&to=2026-01-31T23:59:59Z`

Response:

```json
{
  "wallet": "0x1234...",
  "range": {
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-01-31T23:59:59Z"
  },
  "bridge": {
    "inflow_usd": "120000.35",
    "outflow_usd": "20400.10",
    "volume_usd": "140400.45",
    "netflow_usd": "99600.25"
  },
  "dex": {
    "swap_volume_usd": "85422.44",
    "swap_count": 182
  },
  "gas": {
    "l1_native": "0.0145",
    "l2_native": "0.0922",
    "total_usd": "48.20"
  },
  "citrea_total_tx_count": 436,
  "total_activity_volume_usd": "225822.89",
  "explorer": {
    "enabled": true,
    "eth_tx_count": 950,
    "citrea_tx_count": 436,
    "errors": []
  }
}
```

Formula notes:
- `bridge.volume_usd = bridge.inflow_usd + bridge.outflow_usd`
- `bridge.netflow_usd = bridge.inflow_usd - bridge.outflow_usd`
- `total_activity_volume_usd = bridge.volume_usd + dex.swap_volume_usd`

## 2) Wallet Timeseries
`GET /api/v1/wallet/{wallet}/timeseries?from=...&to=...&interval=1h|1d|1w`

## 3) Wallet Bridge Transfers
`GET /api/v1/wallet/{wallet}/transfers?from=...&to=...&direction=inflow|outflow&token=USDC&limit=50`

## 4) Wallet DEX Swaps
`GET /api/v1/wallet/{wallet}/swaps?from=...&to=...&dex=all|<dex_name>&token=USDC&limit=50`

## 5) Wallet Gas Transactions
`GET /api/v1/wallet/{wallet}/gas?from=...&to=...&chain=all|l1|l2&category=all|bridge|dex|other&limit=50`

## Query/Validation Rules
- `wallet` must be EVM hex address.
- `from` and `to` required; max range 366 days.
- `interval` allowed values: `1h`, `1d`, `1w`.
- monetary values are decimal strings.
