import { Pool } from "pg";
import { env } from "./config.js";

let pool;

export function getPool() {
  if (!pool) {
    if (!env.databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    pool = new Pool({ connectionString: env.databaseUrl });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
  }
}
