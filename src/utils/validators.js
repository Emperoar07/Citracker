const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function normalizeWallet(wallet) {
  if (!wallet || typeof wallet !== "string") return null;
  const trimmed = wallet.trim();
  if (!EVM_ADDRESS_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseISODate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function validateDateRange(from, to) {
  const fromDate = parseISODate(from);
  const toDate = parseISODate(to);
  if (!fromDate || !toDate) return { ok: false, reason: "Invalid from/to date" };
  if (toDate < fromDate) return { ok: false, reason: "to must be >= from" };
  const diffMs = toDate.getTime() - fromDate.getTime();
  const maxDays = 366;
  if (diffMs > maxDays * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "Date range exceeds 366 days" };
  }
  return { ok: true, fromDate, toDate };
}

export function toDecimalString(value) {
  if (value === null || value === undefined) return "0";
  return String(value);
}
