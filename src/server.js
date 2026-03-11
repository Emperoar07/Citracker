import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config.js";
import app from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

app.use(express.static(publicDir));

app.listen(env.port, () => {
  console.log(`citrea-wallet-flow-tracker running on http://localhost:${env.port}`);
  console.log("mode=live");
});
