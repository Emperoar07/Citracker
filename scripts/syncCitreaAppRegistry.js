import { readFileSync, writeFileSync } from "fs";

const registryUrl = new URL("../config/citrea-app-registry.json", import.meta.url);
const CANONICAL_ID_MAP = {
  juice_swap: "juiceswap"
};
const EXCLUDED_IDS = new Set(["bridge_hub", "etherscan", "juice_swap"]);

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractAppObjects(bundle) {
  const regex = /name:"([^"]+)",url:"([^"]*)"(?:,displayUrl:"([^"]*)")?,icon:"\/app-icons\/[^"]+"/g;
  const seen = new Map();
  let match;

  while ((match = regex.exec(bundle)) !== null) {
    const [, label, url, displayUrl] = match;
    if (!url) continue;
    const rawId = slugify(label);
    const id = CANONICAL_ID_MAP[rawId] || rawId;
    if (EXCLUDED_IDS.has(id)) continue;
    if (!seen.has(id)) {
      seen.set(id, { id, label, url, displayUrl: displayUrl || null });
    }
  }

  return [...seen.values()];
}

async function fetchAppHubBundle() {
  const html = await fetch("https://app.citrea.xyz/").then((res) => res.text());
  const bundlePathMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (!bundlePathMatch) {
    throw new Error("Could not locate Citrea app hub bundle");
  }
  const bundleUrl = `https://app.citrea.xyz${bundlePathMatch[1]}`;
  return fetch(bundleUrl).then((res) => res.text());
}

function mergeRegistry(existing, discovered) {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const merged = [];

  for (const app of discovered) {
    const current = existingById.get(app.id);
    if (current) {
      merged.push({
        ...current,
        label: app.label,
        url: app.url,
        displayUrl: app.displayUrl || current.displayUrl || null
      });
    } else {
      merged.push({
        id: app.id,
        label: app.label,
        status: "tracked",
        type: "app",
        coverage: "registry",
        confidence: "registry tracked",
        integrated: false,
        url: app.url,
        displayUrl: app.displayUrl || null,
        usage: "Imported from the Citrea app hub; contract/API mapping still needs review",
        hubCategory: null,
        contracts: []
      });
    }
  }

  for (const item of existing) {
    if (EXCLUDED_IDS.has(item.id)) continue;
    if (!merged.find((candidate) => candidate.id === item.id)) {
      merged.push(item);
    }
  }

  return merged.sort((a, b) => a.label.localeCompare(b.label));
}

async function main() {
  const existing = JSON.parse(readFileSync(registryUrl, "utf8"));
  const bundle = await fetchAppHubBundle();
  const discovered = extractAppObjects(bundle);
  const merged = mergeRegistry(existing, discovered);
  writeFileSync(registryUrl, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Synced ${discovered.length} Citrea app hub entries into ${registryUrl.pathname}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
