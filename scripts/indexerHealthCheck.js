import { closePool } from "../src/db.js";
import {
  getIndexerHealth,
  toHealthMarkdownSection
} from "../src/services/indexerHealthService.js";

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const values = Object.fromEntries(
    argv
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, value] = arg.split(/=(.*)/s, 2);
        return [key, value];
      })
  );

  return { flags, values };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stream = (args.values["--stream"] || "all").toLowerCase();
  const markdown = args.flags.has("--markdown");
  const enforceThresholds = args.flags.has("--enforce-thresholds");

  const payload = await getIndexerHealth({ stream, enforceThresholds });

  if (markdown) {
    const sectionsMarkdown = Object.entries(payload.sections)
      .map(([name, stats]) => toHealthMarkdownSection(name, stats))
      .join("\n\n");
    const thresholdSection = payload.health
      ? [
          "### health",
          `- status: ${payload.health.status}`,
          ...payload.health.failures.map((failure) => `- failure: ${failure}`)
        ].join("\n")
      : "";
    console.log([sectionsMarkdown, thresholdSection].filter(Boolean).join("\n\n"));
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }

  await closePool();

  if (payload.health?.failures?.length) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
