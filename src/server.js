import { env } from "./config.js";
import app from "./app.js";
import { closePool } from "./db.js";

const server = app.listen(env.port, () => {
  console.log(`citrea-wallet-flow-tracker running on http://localhost:${env.port}`);
  console.log("mode=live");
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
