import express from "express";
import cors from "cors";
import { env } from "./config.js";
import router from "./api/routes.js";

const app = express();

const corsOptions = env.allowedOrigins.length
  ? {
      origin(origin, callback) {
        if (!origin || env.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("CORS origin not allowed"));
      }
    }
  : undefined;

app.use(cors(corsOptions));
app.use(express.json());

function healthHandler(req, res) {
  res.json({ ok: true, mode: "live" });
}

app.get("/health", healthHandler);
app.get("/api/health", healthHandler);
app.use("/api/v1", router);
app.use("/v1", router);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

export default app;
