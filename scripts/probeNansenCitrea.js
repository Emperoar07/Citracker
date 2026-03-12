import { env } from "../src/config.js";

async function main() {
  if (!env.nansenApiKey) {
    console.error("NANSEN_API_KEY is not configured.");
    process.exit(1);
  }

  const response = await fetch(`${env.nansenApiBase}/api/v1/token-screener`, {
    method: "POST",
    headers: {
      apiKey: env.nansenApiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chains: ["citrea"],
      date: {
        from: "2026-03-11",
        to: "2026-03-12"
      }
    })
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  console.log(
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        status: response.status,
        ok: response.ok,
        payload
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
