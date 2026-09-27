# H3 correction oracles

All figures below are hand-computed dollars for one synthetic client/business. B is billed balance; H is held receipt credit. Positive B is due, negative B is issued credit. These scenarios use only ds2_scenarios, and Playwright uses prefix-isolated account9001 in ds2_local.

| Sequence | Expected result |
|---|---|
| Issue100; memo30 | B70; original age retained; next statement70 prints the memo once |
| Issue100; pay100; memo30 | B−30, noncash statement credit30; received cash stays100 |
| Previous row; refund10; new work50 | B−20 after refund, then30 after billing; money returned10 |
| Issue1150; receive1500; refund350 | Before refund B0/H350; afterward B0/H0; no added payment or obligation |
| Issue100; void and rebill120 | B120; original100 void; replacement120 new number; original bytes unchanged |
| Issue100; pay40; void/rebill120 | B80; received cash40, one original work row |
| Issue100; pay100; void/rebill120 | B20; received cash100, original and replacement archives available |
| Issue100; later statement adds50; pay100; rebill original as120 | B70; later50 retained and original corrected on current carrier |
| Issue100; pay100; memo30; rebill120 | B20; original memo evidence retained once; cash100 |
| Issue100; pay100; rebill120; bounce whole receipt | B120; complete receipt reversal follows released/reapplied funds |
| Issue100; memo30; reverse memo | B100; memo and compensating document immutable |
| Issue100 source A; pay100; rebill120 business B with transfer | A B0/H0, B B20/H0; no new cash |
| Same cross-business rebill without transfer | A B0/H100, B B120/H0; aggregate debt less held funds20 |
| Issue negative credit30; unused credit; void/rebill50 | B50; original negative PDF preserved |
| Paid100; memo30; issue optional credit statement; refund30 | B0; no unrelated debt reopened; Audit Record0, chain valid |
| Legacy payment100; invoice100; rebill120 | B20; no new manual receipt or work row |
| Issue100; pay40; rebill120; rebill replacement90 | B50; all three invoices preserved; intermediate links to newest replacement |
| Original issued45 days ago; memo30 from100 | 31–60 bucket70, current bucket0; reversing memo restores31–60 bucket100 |

Every scenario checks relevant balances through the invoice engine, original obligations/AR, Account Audit and immutable records. API path matrices capture every table and audit event before refusal and require exact equality afterward. Cases cover cap, sign, fractional cents, missing reason/reference/entity, wrong source/tenant, unavailable source, date, locked/void state, stale fingerprint, repeat/changed-key retries, and injected storage or late database failure. Role cases cover both admin roles succeeding and manager/employee403 with nothing written for new corrections and existing write-off, retainer-event, duplicate-removal and bounced-check routes.

Browser tests in `e2e/tests/corrections.spec.js` cover entered values, required reasons/caps, explicit paid-excess credit confirmation, void preview/replacement history, document downloads, repeat clicks, concurrent ledger changes, wrong invoice/business/credit, and role-hidden actions. Jest tests cover the same form recovery/confirmation paths and shared adjustment guards. Existing lifecycle, permissions and browser coverage remains part of full regression acceptance; changed manager mutation fixtures use an admin while explicit refusal coverage remains.

Specs: `scenario-H3-corrections.integration.spec.js`, `path-matrix-H3-corrections.integration.spec.js`, `path-matrix-H3-admin-adjustments.integration.spec.js`, `test/scripts/migration-H3.spec.js`. Exact final counts are recorded in [H3 results](../decisions/2026-09-26-run-H3-results.md).
