import { env } from "../config.js";

const nansenMacroUrl = "https://app.nansen.ai/macro/overview?chain=citrea&utm_source=twitter&utm_medium=social";
const nansenDocsUrl = "https://docs.nansen.ai/getting-started/first-api-call";
const nansenApiDocsUrl = "https://docs.nansen.ai/";

export function getNansenCitreaSourceEntry(refreshCadence) {
  const hasApiKey = Boolean(env.nansenApiKey);

  return {
    id: "nansen",
    label: "Nansen",
    status: hasApiKey ? "configured" : "not_configured",
    type: "reference analytics",
    cadence: "manual",
    coverage: "reference",
    confidence: "reference only",
    integrated: false,
    url: nansenMacroUrl,
    docs_url: nansenDocsUrl,
    api_url: env.nansenApiBase,
    usage: hasApiKey
      ? "API key is configured privately, but the official Nansen API currently rejects 'citrea' as an unsupported chain. The Citrea macro dashboard stays reference-only until public API support exists."
      : "Citrea macro dashboard is visible as a reference, but no private API key is configured for future validation work.",
    notes: [
      `Configured refresh target: ${refreshCadence}`,
      "Official Nansen API docs use apiKey header authentication.",
      "As of 2026-03-12, the documented API chain validation does not accept 'citrea'."
    ]
  };
}

export function getNansenCitreaProbeResult() {
  return {
    configured: Boolean(env.nansenApiKey),
    api_base: env.nansenApiBase,
    macro_url: nansenMacroUrl,
    docs_url: nansenApiDocsUrl,
    citrea_api_supported: false,
    checked_at: new Date().toISOString(),
    reason:
      "Official Nansen API validation currently rejects 'citrea' as an unsupported chain value, so Citracker does not use Nansen as runtime truth for Citrea metrics."
  };
}
