# Accuracy And Security Audit

## Executive Summary

This pass focused on two classes of issues:

1. Metric correctness problems where the UI label did not match the actual source or calculation.
2. Basic runtime hardening issues in the Express app and external fetch layer.

The highest-confidence fixes are now in code:

- `Gas Spent Today` uses live explorer fee sums instead of an average-gas estimate.
- `Today Snapshot -> DEX Swap Count` now uses a real today-level indexed count.
- `Users` is relabeled to `Total Addresses`, which matches the explorer source.
- The app now sets basic security headers, limits JSON body size, applies outbound fetch timeouts, and stops leaking raw 500 errors to clients.

## Findings

### ACC-001

- Severity: High
- Location: [src/services/networkService.js](c:/Users/bolaj/New%20folder/src/services/networkService.js)
- Evidence: `Today Snapshot` previously consumed `indexed.total_swap_count`, which is an all-time metric.
- Impact: The dashboard showed an all-time DEX count in a today-only panel, which is materially inaccurate.
- Fix: Added `total_swap_count_today` in `getPublicInterestIndexedStats()` and wired the frontend to use it.
- Status: Fixed

### ACC-002

- Severity: Medium
- Location: [public/app.js](c:/Users/bolaj/New%20folder/public/app.js)
- Evidence: The network KPI label used `Users`, but the backing source is `total_addresses` from Citrea explorer stats.
- Impact: The UI implied a user identity metric when the source is actually address count.
- Fix: Renamed the card to `Total Addresses`.
- Status: Fixed

### ACC-003

- Severity: High
- Location: [src/services/networkService.js](c:/Users/bolaj/New%20folder/src/services/networkService.js)
- Evidence: `Gas Spent Today` was previously derived from `gas_used_today * average gas price * cBTC/USD`.
- Impact: The card could significantly overstate or understate today’s actual paid fees.
- Fix: Summed exact `fee.value` across today’s explorer transaction feed and priced that live result.
- Status: Fixed

### ACC-004

- Severity: Medium
- Location: [public/app.js](c:/Users/bolaj/New%20folder/public/app.js)
- Evidence: Bridge-origin rows mixed DefiLlama TVL split values with Citracker’s indexed bridge volume, but the UI did not distinguish them clearly.
- Impact: Users could read unrelated metrics as one comparable metric family.
- Fix: Renamed the rows and added source tags (`DefiLlama`, `Citracker`).
- Status: Fixed

### SEC-001

- Severity: Medium
- Location: [src/app.js](c:/Users/bolaj/New%20folder/src/app.js)
- Evidence: No explicit security headers were set in app code.
- Impact: We were relying entirely on infrastructure defaults for basic browser protections.
- Fix: Added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- Status: Fixed

### SEC-002

- Severity: Medium
- Location: [src/app.js](c:/Users/bolaj/New%20folder/src/app.js)
- Evidence: `express.json()` had no explicit body limit.
- Impact: Unbounded body parsing increases DoS risk.
- Fix: Changed to `express.json({ limit: "32kb" })`.
- Status: Fixed

### SEC-003

- Severity: Medium
- Location: [src/services/networkService.js](c:/Users/bolaj/New%20folder/src/services/networkService.js), [src/services/explorerService.js](c:/Users/bolaj/New%20folder/src/services/explorerService.js), [src/services/priceService.js](c:/Users/bolaj/New%20folder/src/services/priceService.js), [src/services/duneService.js](c:/Users/bolaj/New%20folder/src/services/duneService.js)
- Evidence: External `fetch()` calls had no timeout.
- Impact: Upstream hangs could pin worker time and degrade API responsiveness.
- Fix: Added `AbortSignal.timeout(env.externalFetchTimeoutMs)` to external fetch paths.
- Status: Fixed

### SEC-004

- Severity: Low
- Location: [src/app.js](c:/Users/bolaj/New%20folder/src/app.js)
- Evidence: The generic error handler returned raw `err.message` for 500s.
- Impact: Internal failure details could leak to public clients.
- Fix: 500-level responses now return `Internal server error`, while 4xx responses keep explicit request errors.
- Status: Fixed

## Residual Limitations

### LIM-001

- Severity: Medium
- Location: [public/app.js](c:/Users/bolaj/New%20folder/public/app.js), [src/services/networkService.js](c:/Users/bolaj/New%20folder/src/services/networkService.js)
- Evidence: Cards labeled `Indexed`, `Tracked`, or `Citracker` still depend on local index coverage.
- Impact: These metrics are accurate within tracked coverage, not guaranteed full-chain truth.
- Mitigation: Keep source tags visible and avoid presenting indexed totals as official chain totals.

### LIM-002

- Severity: Low
- Location: [src/app.js](c:/Users/bolaj/New%20folder/src/app.js)
- Evidence: If `ALLOWED_ORIGINS` is unset, the public API remains broadly CORS-accessible.
- Impact: This is not an auth bypass because the app is read-only, but it is still wider exposure than a locked-down origin allowlist.
- Mitigation: Set `ALLOWED_ORIGINS` explicitly in production if you want browser-level origin restriction.

### LIM-003

- Severity: Low
- Location: [src/app.js](c:/Users/bolaj/New%20folder/src/app.js)
- Evidence: There is still no request-rate limiting on public endpoints.
- Impact: Public GET endpoints can be scraped or abused more easily.
- Mitigation: Add edge or app-level rate limiting if abuse appears.
