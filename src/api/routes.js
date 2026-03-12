import express from "express";
import { z } from "zod";
import {
  getWalletSummary,
  getWalletTimeseries,
  getWalletTransfers,
  getWalletSwaps,
  getWalletGas
} from "../services/metricsService.js";
import { getNetworkGasSummary, getNetworkSummary } from "../services/networkService.js";
import { coerceSummaryPayload } from "../services/summarySerializer.js";
import { getCitreaExplorerActivity, getExplorerEnhancements } from "../services/explorerService.js";
import { normalizeWallet, validateDateRange } from "../utils/validators.js";

const router = express.Router();
const ALL_TIME_FROM = "1970-01-01T00:00:00.000Z";
const ALL_TIME_TO = "2100-01-01T00:00:00.000Z";

const rangeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional()
});

function getRangeOrDefault(query) {
  const parsed = rangeQuerySchema.safeParse(query);
  if (!parsed.success) {
    const err = new Error("Invalid from/to query params");
    err.status = 400;
    throw err;
  }

  const from = parsed.data.from || ALL_TIME_FROM;
  const to = parsed.data.to || ALL_TIME_TO;
  const check = validateDateRange(from, to, { allowWideRange: true });
  if (!check.ok) {
    const err = new Error(check.reason);
    err.status = 400;
    throw err;
  }
  return { from, to, isAllTime: !parsed.data.from && !parsed.data.to };
}

function getWalletOrThrow(wallet) {
  const normalized = normalizeWallet(wallet);
  if (!normalized) {
    const err = new Error("Invalid wallet address");
    err.status = 400;
    throw err;
  }
  return normalized;
}

router.get("/network/summary", async (req, res, next) => {
  try {
    const payload = await getNetworkSummary();
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

router.get("/network/gas", async (req, res, next) => {
  try {
    const payload = await getNetworkGasSummary();
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

router.get("/wallet/:wallet/summary", async (req, res, next) => {
  try {
    const wallet = getWalletOrThrow(req.params.wallet);
    const { from, to, isAllTime } = getRangeOrDefault(req.query);
    const base = coerceSummaryPayload(await getWalletSummary(wallet, from, to));

    const explorer = await getExplorerEnhancements(wallet, from, to);
    const citreaFallback = await getCitreaExplorerActivity(wallet, from, to, { limit: 20 });

    if (explorer.enabled && typeof explorer.citrea_tx_count === "number") {
      base.citrea_total_tx_count = Math.max(
        Number(base.citrea_total_tx_count || 0),
        explorer.citrea_tx_count
      );
    }
    if (citreaFallback?.enabled) {
      base.citrea_total_tx_count = Math.max(
        Number(base.citrea_total_tx_count || 0),
        Number(citreaFallback.tx_count || 0)
      );
      base.bridge.tx_count = Math.max(
        Number(base.bridge.tx_count || 0),
        Number(citreaFallback.bridge_tx_count || 0)
      );
      if (Number(citreaFallback.bridge_inflow_usd_total || 0) > Number(base.bridge.inflow_usd || 0)) {
        base.bridge.inflow_usd = String(citreaFallback.bridge_inflow_usd_total || "0");
      }
      if (Number(citreaFallback.bridge_outflow_usd_total || 0) > Number(base.bridge.outflow_usd || 0)) {
        base.bridge.outflow_usd = String(citreaFallback.bridge_outflow_usd_total || "0");
      }
      base.bridge.volume_usd = String(
        Number(base.bridge.inflow_usd || 0) + Number(base.bridge.outflow_usd || 0)
      );
      base.bridge.netflow_usd = String(
        Number(base.bridge.inflow_usd || 0) - Number(base.bridge.outflow_usd || 0)
      );
      base.gas.tx_count = Math.max(
        Number(base.gas.tx_count || 0),
        Number(citreaFallback.tx_count || 0)
      );
      base.dex.swap_count = Math.max(
        Number(base.dex.swap_count || 0),
        Number(citreaFallback.swap_count || 0)
      );
      base.apps.tx_count = Math.max(
        Number(base.apps.tx_count || 0),
        Number(citreaFallback.app_tx_count || 0)
      );
      if (Number(citreaFallback.swap_volume_usd_total || 0) > Number(base.dex.swap_volume_usd || 0)) {
        base.dex.swap_volume_usd = String(citreaFallback.swap_volume_usd_total || "0");
      }
      if (Number(citreaFallback.app_volume_usd_total || 0) > Number(base.apps.volume_usd || 0)) {
        base.apps.volume_usd = String(citreaFallback.app_volume_usd_total || "0");
      }
      if (Array.isArray(citreaFallback.app_breakdown) && citreaFallback.app_breakdown.length > 0) {
        base.apps.breakdown = citreaFallback.app_breakdown;
      }
      if (Number(citreaFallback.gas_total_native || 0) > Number(base.gas.l2_native || 0)) {
        base.gas.l2_native = String(citreaFallback.gas_total_native || "0");
      }
      if (Number(citreaFallback.gas_total_usd || 0) > Number(base.gas.total_usd || 0)) {
        base.gas.total_usd = String(citreaFallback.gas_total_usd || "0");
      }
      base.total_activity_volume_usd = String(
        Number(base.bridge.volume_usd || 0) +
          Number(base.dex.swap_volume_usd || 0) +
          Number(base.apps.volume_usd || 0)
      );
    }

    base.explorer = {
      ...explorer,
      citrea_activity_fallback: Boolean(citreaFallback?.enabled)
    };
    base.is_all_time = isAllTime;
    return res.json(base);
  } catch (err) {
    return next(err);
  }
});

router.get("/wallet/:wallet/timeseries", async (req, res, next) => {
  try {
    const wallet = getWalletOrThrow(req.params.wallet);
    const { from, to } = getRangeOrDefault(req.query);
    const interval = req.query.interval || "1d";

    if (!["1h", "1d", "1w"].includes(interval)) {
      return res.status(400).json({ error: "Invalid interval. Use 1h|1d|1w" });
    }

    const payload = await getWalletTimeseries(wallet, from, to, interval);
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

router.get("/wallet/:wallet/transfers", async (req, res, next) => {
  try {
    const wallet = getWalletOrThrow(req.params.wallet);
    const { from, to } = getRangeOrDefault(req.query);
    const direction = req.query.direction;
    const token = req.query.token;
    const limit = Math.min(Number(req.query.limit || 50), 200);

    if (direction && !["inflow", "outflow"].includes(direction)) {
      return res.status(400).json({ error: "Invalid direction. Use inflow|outflow" });
    }

    const payload = await getWalletTransfers(wallet, from, to, direction, token, limit);
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

router.get("/wallet/:wallet/swaps", async (req, res, next) => {
  try {
    const wallet = getWalletOrThrow(req.params.wallet);
    const { from, to } = getRangeOrDefault(req.query);
    const dex = req.query.dex && req.query.dex !== "all" ? req.query.dex : null;
    const token = req.query.token;
    const limit = Math.min(Number(req.query.limit || 50), 200);

    const payload = await getWalletSwaps(wallet, from, to, dex, token, limit);
    if (payload.total_count === 0) {
      const fallback = await getCitreaExplorerActivity(wallet, from, to, { limit });
      if (fallback.enabled && fallback.swap_items.length > 0) {
        return res.json({
          wallet,
          items: fallback.swap_items,
          next_cursor: null,
          total_count: fallback.swap_count,
          source: "citreascan_fallback"
        });
      }
    }
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

router.get("/wallet/:wallet/gas", async (req, res, next) => {
  try {
    const wallet = getWalletOrThrow(req.params.wallet);
    const { from, to } = getRangeOrDefault(req.query);
    const chain = req.query.chain || "all";
    const category = req.query.category || "all";
    const limit = Math.min(Number(req.query.limit || 50), 200);

    if (!["all", "l1", "l2"].includes(chain)) {
      return res.status(400).json({ error: "Invalid chain. Use all|l1|l2" });
    }
    if (!["all", "bridge", "dex", "other"].includes(category)) {
      return res.status(400).json({ error: "Invalid category. Use all|bridge|dex|other" });
    }

    const payload = await getWalletGas(wallet, from, to, chain, category, limit);
    if (
      payload.total_count === 0 &&
      (chain === "all" || chain === "l2") &&
      (category === "all" || category === "dex" || category === "other")
    ) {
      const fallback = await getCitreaExplorerActivity(wallet, from, to, { limit });
      if (fallback.enabled && fallback.gas_items.length > 0) {
        const filteredItems = fallback.gas_items.filter((item) => {
          if (category === "all") return true;
          return item.tx_category === category;
        });
        return res.json({
          wallet,
          items: filteredItems,
          next_cursor: null,
          total_count: fallback.tx_count,
          source: "citreascan_fallback"
        });
      }
    }
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

export default router;
