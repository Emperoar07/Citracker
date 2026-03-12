import { toDecimalString } from "../utils/validators.js";

export function coerceSummaryPayload(dbSummary) {
  return {
    wallet: dbSummary.wallet,
    range: dbSummary.range,
    bridge: {
      tx_count: Number(dbSummary.bridge_tx_count || 0),
      sources_detected: Array.isArray(dbSummary.bridge_sources) ? dbSummary.bridge_sources : [],
      inflow_usd: toDecimalString(dbSummary.bridge_inflow_usd),
      outflow_usd: toDecimalString(dbSummary.bridge_outflow_usd),
      volume_usd: toDecimalString(dbSummary.bridge_volume_usd),
      netflow_usd: toDecimalString(dbSummary.bridge_netflow_usd)
    },
    dex: {
      swap_volume_usd: toDecimalString(dbSummary.dex_swap_volume_usd),
      swap_count: Number(dbSummary.dex_swap_count || 0)
    },
    apps: {
      tx_count: Number(dbSummary.app_tx_count || 0),
      volume_usd: toDecimalString(dbSummary.app_volume_usd),
      breakdown: Array.isArray(dbSummary.app_breakdown) ? dbSummary.app_breakdown : []
    },
    usage: {
      top_apps: Array.isArray(dbSummary.usage_top_apps) ? dbSummary.usage_top_apps : []
    },
    gas: {
      tx_count: Number(dbSummary.gas_tx_count || 0),
      l1_native: toDecimalString(dbSummary.gas_l1_native),
      l2_native: toDecimalString(dbSummary.gas_l2_native),
      total_usd: toDecimalString(dbSummary.gas_total_usd)
    },
    explorer: {
      enabled: false,
      eth_tx_count: null,
      citrea_tx_count: null,
      errors: []
    },
    citrea_total_tx_count: Number(dbSummary.citrea_total_tx_count || 0),
    total_activity_volume_usd: toDecimalString(dbSummary.total_activity_volume_usd)
  };
}
