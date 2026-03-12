import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config.js";
import router from "./api/routes.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const rateLimitBuckets = new Map();

app.disable("x-powered-by");

const corsOptions = {
  origin(origin, callback) {
    if (!origin || env.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(Object.assign(new Error("CORS origin not allowed"), { status: 403 }));
  }
};

function getRateLimitKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function rateLimitMiddleware(req, res, next) {
  const now = Date.now();
  const key = getRateLimitKey(req);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + env.rateLimitWindowMs
    });
    return next();
  }

  if (bucket.count >= env.rateLimitMax) {
    const retryAfterSeconds = Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  bucket.count += 1;
  return next();
}

app.use(cors({
  methods: ["GET", "HEAD", "OPTIONS"],
  ...corsOptions
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "32kb" }));
app.use("/api/v1", rateLimitMiddleware);
app.use("/v1", rateLimitMiddleware);

function healthHandler(req, res) {
  res.json({ ok: true, mode: "live" });
}

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.use("/api/v1", router);
app.use("/v1", router);
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-store");
      }
    }
  })
);

function sendIndex(req, res) {
  res.sendFile(path.join(publicDir, "index.html"));
}

app.get("/", sendIndex);
app.get(/^\/(?!api\/|v1\/|health$).*/, sendIndex);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    return res.status(status).json({ error: "Internal server error" });
  }
  return res.status(status).json({ error: err.message || "Request failed" });
});

export default app;
