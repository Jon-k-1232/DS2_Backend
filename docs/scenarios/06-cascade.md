# C — Billing Review after the owner locks issued statements

The [owner decision record](../decisions/2026-09-24-owner-decisions.md) deliberately changes the previous billed-edit oracle. Issued statement totals no longer change through cascade edit. The old success expectations are replaced by explicit refusal and original-evidence assertions; unissued recomputation/fault coverage remains.

Story: work $100; statement 00001 = (0,100,0,0,0,100); receipt $40 creates a $60 child. Original parent/PDF remain $100.

| Case/action | Expected |
|---|---|
| C02 quantity, total, date, billable or no-op edit of the sent work | HTTP 409; B=N60; family100; all evidence unchanged |
| C03 notes/job move | HTTP 409; B=N60; original PDF byte-identical |
| C04 advance31 days, add30 work | N90/B60; family130; old balance in31–60 |
| C04 next finalize | 00002=(60,30,0,0,0,90); new closing child0 on first chain; original parent remains100 |
| C04 edit old notes after absorption | HTTP409; B=N90 |
| C05 separate100 bill settled with100 receipt | Every financial/metadata/no-op edit refused; B=N0; issued parent100, latest child0 |
| C06 customer move with explicit confirmation | Sent source100 and destination0 unchanged; family100/0 |
| C06b unissued work quantity1→1.2, then total override110 | Accepted; 120 then110; family updates; no invoice |

Retainer-backed and internal/nonbillable controls remain. `cascade-edit-recompute.integration.spec.js` retains detailed unissued-chain delta/negative-balance/fault coverage. Scenario F now injects an actual failure in an **unissued** cascade write; a sent rejection is not counted as reaching an injected downstream failure. Each refusal checks unchanged database state and the three hand-computed balances.
