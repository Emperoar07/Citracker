import { env } from "../config.js";

function hasDuneConfig() {
  return Boolean(
    env.duneApiKey &&
      (env.duneQueryIdCitreaActivity || env.duneQueryIdCitreaFees || env.duneQueryIdCitreaDex)
  );
}

async function fetchDuneLatestResult(queryId) {
  const response = await fetch(`${env.duneApiBase}/query/${queryId}/results?limit=1`, {
    headers: {
      "X-Dune-API-Key": env.duneApiKey
    },
    signal: AbortSignal.timeout(env.externalFetchTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.result?.rows) ? payload.result.rows : [];
  return rows[0] || null;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getDuneCitreaCrossChecks() {
  if (!hasDuneConfig()) {
    return {
      configured: false,
      status: "not_configured",
      reason: "Dune cross-checks require DUNE_API_KEY and pinned Citrea query IDs."
    };
  }

  const queries = [
    ["activity", env.duneQueryIdCitreaActivity],
    ["fees", env.duneQueryIdCitreaFees],
    ["dex", env.duneQueryIdCitreaDex]
  ].filter(([, queryId]) => Boolean(queryId));

  const settled = await Promise.allSettled(
    queries.map(async ([name, queryId]) => [name, { query_id: queryId, row: await fetchDuneLatestResult(queryId) }])
  );

  const out = {
    configured: true,
    status: "ok",
    reason: null,
    checks: {},
    errors: []
  };

  for (const result of settled) {
    if (result.status === "fulfilled") {
      const [name, value] = result.value;
      out.checks[name] = value;
      continue;
    }

    out.status = "error";
    out.errors.push(result.reason?.message || "Unknown Dune error");
  }

  const activityRow = out.checks.activity?.row || {};
  const feeRow = out.checks.fees?.row || {};
  const dexRow = out.checks.dex?.row || {};

  out.metrics = {
    active_addresses: toNumber(
      activityRow.active_addresses ?? activityRow.addresses ?? activityRow.transacting_addresses
    ),
    daily_transactions: toNumber(
      activityRow.daily_transactions ?? activityRow.transactions ?? activityRow.tx_count
    ),
    daily_fees_usd: toNumber(feeRow.daily_fees_usd ?? feeRow.fees_usd ?? feeRow.fee_usd),
    dex_volume_24h_usd: toNumber(dexRow.dex_volume_24h_usd ?? dexRow.volume_24h_usd ?? dexRow.volume_usd),
    as_of:
      activityRow.day ||
      activityRow.date ||
      feeRow.day ||
      feeRow.date ||
      dexRow.day ||
      dexRow.date ||
      null
  };

  return out;
}

export function getDuneSourceEntry(refreshCadence, duneCrossChecks) {
  const configured = Boolean(duneCrossChecks?.configured);
  const status = duneCrossChecks?.status || (configured ? "configured" : "not_configured");

  return {
    id: "dune",
    label: "Dune",
    status,
    type: "reference analytics",
    cadence: configured ? refreshCadence : "manual",
    coverage: "reference",
    confidence: "secondary cross-check",
    integrated: configured,
    url: "https://dune.com/",
    usage: configured
      ? "Pinned Citrea Dune queries are available as cross-checks only and never override official explorer or indexed totals."
      : "Dune is supported only when pinned Citrea query IDs are configured. It remains a cross-check, not source of truth."
  };
}
