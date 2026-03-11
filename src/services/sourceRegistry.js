import { readFileSync } from "fs";

const citreaAppsRegistryUrl = new URL("../../config/citrea-app-registry.json", import.meta.url);

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

export function getCitreaAppRegistry() {
  return readJson(citreaAppsRegistryUrl);
}

export function buildCitreaAppSourceEntries(refreshCadence) {
  const apps = getCitreaAppRegistry();
  return apps.map((app) => {
    const cadence = app.coverage === "metrics" ? refreshCadence : app.apiUrl ? "on demand" : "manual";
    const primaryUrl = app.docsUrl || app.repoUrl || app.url || null;
    return {
      id: app.id,
      label: app.label,
      status: app.status,
      type: app.type,
      cadence,
      coverage: app.coverage,
      confidence: app.confidence,
      integrated: Boolean(app.integrated),
      url: primaryUrl,
      app_url: app.url || null,
      docs_url: app.docsUrl || null,
      api_url: app.apiUrl || null,
      repo_url: app.repoUrl || null,
      usage: app.usage,
      hub_category: app.hubCategory || null,
      contracts: Array.isArray(app.contracts) ? app.contracts : []
    };
  });
}
