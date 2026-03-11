import { readdirSync, readFileSync } from "fs";
import { extname } from "path";

const citreaAppsRegistryUrl = new URL("../../config/citrea-app-registry.json", import.meta.url);
const citreaAppConfigsUrl = new URL("../../config/apps/", import.meta.url);

function readJson(url) {
  return JSON.parse(readFileSync(url, "utf8"));
}

function readCitreaAppConfigs() {
  const configs = [];
  for (const entry of readdirSync(citreaAppConfigsUrl, { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".json") continue;
    configs.push(readJson(new URL(entry.name, citreaAppConfigsUrl)));
  }
  return configs.sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
}

export function getCitreaAppConfigs() {
  return readCitreaAppConfigs();
}

export function getCitreaMetricAppConfigs() {
  return readCitreaAppConfigs().filter(
    (config) => config?.chainId === 4114 && config?.registry?.coverage === "metrics"
  );
}

export function getCitreaAppRegistry() {
  const base = readJson(citreaAppsRegistryUrl);
  const configById = new Map(readCitreaAppConfigs().map((config) => [config.id, config]));

  return base.map((app) => {
    const config = configById.get(app.id);
    if (!config) return app;

    return {
      ...app,
      coverage: config.registry?.coverage || app.coverage,
      confidence: config.registry?.confidence || app.confidence,
      integrated: config.registry?.integrated ?? app.integrated,
      status: config.registry?.status || app.status,
      usage: config.registry?.usage || app.usage,
      apiUrl: config.api?.chainsUrl || config.api?.subgraphUrl || config.api?.forwarderUrl || app.apiUrl,
      contracts: Array.isArray(config.contracts) && config.contracts.length ? config.contracts : app.contracts
    };
  });
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
