import { env } from "../config.js";
import { getPool } from "../db.js";

let inMemoryBuckets = new Map();
let lastCleanupAt = 0;
let rateLimitTableReady = false;

function currentWindowStart(now = Date.now()) {
  return Math.floor(now / env.rateLimitWindowMs) * env.rateLimitWindowMs;
}

function fallbackBucketKey(clientKey, windowStartMs) {
  return `${clientKey}:${windowStartMs}`;
}

function cleanupFallbackBuckets(now = Date.now()) {
  if (now - lastCleanupAt < env.rateLimitWindowMs) {
    return;
  }

  for (const [key, bucket] of inMemoryBuckets.entries()) {
    if (bucket.resetAt <= now) {
      inMemoryBuckets.delete(key);
    }
  }
  lastCleanupAt = now;
}

async function ensureRateLimitTable() {
  if (rateLimitTableReady) return;

  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS api_rate_limits (
      client_key text NOT NULL,
      window_start timestamptz NOT NULL,
      request_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (client_key, window_start)
    )`
  );

  rateLimitTableReady = true;
}

async function consumeSharedWindow(clientKey, now = Date.now()) {
  await ensureRateLimitTable();

  const windowStartMs = currentWindowStart(now);
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO api_rate_limits (client_key, window_start, request_count, updated_at)
     VALUES ($1, $2::timestamptz, 1, now())
     ON CONFLICT (client_key, window_start)
     DO UPDATE
       SET request_count = api_rate_limits.request_count + 1,
           updated_at = now()
     RETURNING request_count`,
    [clientKey, new Date(windowStartMs).toISOString()]
  );

  if (Math.random() < 0.02) {
    pool.query(
      `DELETE FROM api_rate_limits
       WHERE window_start < now() - make_interval(secs => $1::int)`,
      [Math.max(Math.ceil((env.rateLimitWindowMs * 10) / 1000), 60)]
    ).catch(() => {});
  }

  return {
    count: Number(result.rows[0]?.request_count || 0),
    resetAt: windowStartMs + env.rateLimitWindowMs,
    shared: true
  };
}

function consumeFallbackWindow(clientKey, now = Date.now()) {
  cleanupFallbackBuckets(now);

  const windowStartMs = currentWindowStart(now);
  const key = fallbackBucketKey(clientKey, windowStartMs);
  const existing = inMemoryBuckets.get(key);

  if (!existing) {
    const fresh = {
      count: 1,
      resetAt: windowStartMs + env.rateLimitWindowMs
    };
    inMemoryBuckets.set(key, fresh);
    return {
      count: fresh.count,
      resetAt: fresh.resetAt,
      shared: false
    };
  }

  existing.count += 1;
  return {
    count: existing.count,
    resetAt: existing.resetAt,
    shared: false
  };
}

export async function consumeRateLimitWindow(clientKey, now = Date.now()) {
  try {
    return await consumeSharedWindow(clientKey, now);
  } catch {
    return consumeFallbackWindow(clientKey, now);
  }
}
