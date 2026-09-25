# Time-increment boundary oracle

`scenario-lifecycle-17-time-boundaries.integration.spec.js` posts and edits manual Time work and applies held tracker rows through HTTP. The manual rule is six-minute ceiling billing; quarter-hour rounding is not introduced.

| Raw minutes | Billed hours | At $137.50/hour |
|---:|---:|---:|
| 1 | 0.1 | 13.75 |
| 6 | 0.1 | 13.75 |
| 7 | 0.2 | 27.50 |
| 14 | 0.3 | 41.25 |
| 15 | 0.3 | 41.25 |
| 16 | 0.3 | 41.25 |
| 59 | 1.0 | 137.50 |
| 60 | 1.0 | 137.50 |
| 61 | 1.1 | 151.25 |

One set sums to4.4 billed hours/$605. Two sets (manual and held review) sum to8.8 hours/$1210. Tracker raw duration stays239 minutes, displayed as3.98 actual hours; it is not overwritten with rounded billing hours. Finalize freezes$1210 and its items, and the PDF, engine, Account Audit and AR agree. No second time-rounding occurs at invoice generation.

Backend unit tests also pass each boundary through duration parsing and the automatic-ingestion pricing entry point. Frontend jest verifies numeric-minute and timer inputs,0/invalid durations, raw-minute preservation, and the half-cent case0.3 × $1.15 = $0.35. The full path inventory, historical explicit-quantity contract and corrections are in the [design record](../decisions/2026-09-24-owner-decisions.md#run-3-time-increment-audit).
