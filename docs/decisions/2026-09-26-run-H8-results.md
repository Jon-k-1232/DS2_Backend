# H8 — page help, browser workflows and user mistakes

Status: **accepted locally on 2026-09-27; not deployed**. All **51 required validation commands** passed, covering **5,724 unique tests** and a second consecutive full browser pass. Final accepted results have zero failures, skipped, pending, flaky or retried tests.

## What changed

- A keyboard-accessible information button lives in the shared workspace header. All 39 sidebar destinations, all nine client-profile tabs, invoice/receipt details, opening assignments and the dashboard resolve to 52 help entries. Each has five plain-language bullets covering purpose, appropriate use, business effects, roles and correction limits. The credit memo explanation distinguishes lower billed revenue from cash and write-offs. Help is read-only.
- `DS2_Frontend/src/help/pageHelp.js` is the only content source. `scripts/docs/generate-page-help.js` writes [the owner-readable document](../platform/page-help.md); its check mode and Jest compare the actual markdown bytes. Navigation and client-tab tests prevent missing or stale help. Dialog tests exercise Tab, Enter, Escape, Close and restored focus.
- AR distinguishes **Our business** from **Client company**, moves the saved-through cutoff into **Advanced: reproduce an earlier report**, keeps historical estimates beside the client instead of an unrelated empty age bucket, and uses ordinary text for zero totals. Money and headers do not wrap; the wide table scrolls within the page at 1280 pixels. Cutoff values and export parameters retain their meaning.
- Credit memo/refund registers show named actors, Issued/Reversed status, unbroken document numbers and dates, clear empty states and recovery after read errors. Buttons use their written sentence case. Invoice, retainer and duplicate histories, and catalog/job/retainer deletion reviews, also show names. Missing names are explicitly unrecorded; inactive staff remain resolvable. Actor IDs remain in tooltips, not visible substitutes for names.
- Business assignment review uses available client names, distinguishes loading/errors from an empty queue and avoids a nonsensical 1–0 range. Work review explains unavailable automated matching without exposing server configuration instructions.
- Shared ordinary grids show document numbers and names first, use sentence-case headers and omit internal-key columns. Keys remain on row objects for navigation and guarded actions. Audit views and server export contracts retain their evidence. The quote register receives same-account client/service/creator labels and remains read-only in the UI.
- Receipt details wait for both the receipt and open-invoice reads before offering corrections. They discard stale responses and hide actions after a read failure. Applications show original invoice numbers instead of debt/application IDs. Credit memo reversal review prevents another selection while its balances load.
- Account Audit blocks old selections while loading or after a read error, removes stale rows on failure and ignores an older search response that arrives last. Client/invoice grids no longer steal keyboard focus from the header or help dialog when delayed data arrives.
- Payment imports now exposes read failures with Reload payments instead of silently showing an empty grid. All three lists clear stale rows and ignore superseded requests; the processed-month race has Jest and browser regression coverage. Lists explain empty results and use **Name on payment**, **Matched client** and sentence-case tabs. Other ordinary grids inherit a clear empty-selection message.

## Scope and invariants

No migration, backfill, table, financial write path or endpoint was added. The inventory remains 221 endpoint contracts and 48 forward migrations (002–049); 050 remains free. Deploy the matching backend and frontend together after the existing 049 schema. H8 adds no production SQL rollout step. This run performed no deployment, Git command, AWS/production action or real email.

Changed reads decorate responses only: correction context/list/detail, invoice exception history, retainer event history, duplicate review history, receipt applications, single category/type/job/retainer/work-description reads, and quote list reads. Names are account-scoped and never persisted into financial rows or command fingerprints. Quote joins include account/client ownership. Existing happy/error/role/tenant/not-found coverage remains; the H8 presentation matrix additionally compares all committed tables and audit state on successful reads and injected presentation-query failures.

The rolling statement model, latest child/absorption rules, H2 default-business opening, original debt ages, immutable issues, six-minute rounding, captured costs and printed interest line remain authoritative. Any admin or super admin may apply an adjustment alone; managers/employees cannot. No second approval, period close, bank connection, collections or online payment feature was added.

## Browser and mistake coverage

[The H8 scenario matrix](../scenarios/H8-browser-and-help.md) maps every destination and supported workflow to its browser specs. The existing suite retains payment allocation, excess credit, wrong client/business/invoice, finalized locks, retainer/refund/transfer lineage, double-click, stale form, validation, tenant/role, storage and API-error cases. H9 type-ahead, compact responses, lazy routes and H10 loaded-workspace performance/equivalence budgets run unchanged, apart from selectors matching corrected labels.

New browser cases cover every help destination, all client tabs, exact help text on the key financial/settings screens, real two-tab memo conflict and back/reload, refused and lost-response payments, receipt readiness, correction-register recovery, quote names, delayed financial/report reads and delayed-grid keyboard focus. No retry, skip or weakened budget is used for acceptance.

The $50 receipt oracle and $22.50 less $5 memo oracle are hand-computed in the scenario document. Refused requests leave audit evidence unchanged. Retrying a receipt after the response was lost **after commit** returns the same receipt without another cash entry or audit event. The stale memo tab gets 409 and leaves the issued original unchanged.

## Evidence and screenshots

Final counts and both consecutive complete browser runs are recorded in [PASS6](../scenarios/RESULTS-PASS6.md) and `evidence/run-H8/final-acceptance.json`. Commands, environment selection, durations and exact per-file logs are in `validation-commands.json`. Focused repetitions and initial red tests are separate from final acceptance.

| Review | Before | After |
|---|---|---|
| AR at 1280 pixels | [Before](evidence/run-H8/screenshots/before-ar-1280.png) | [After](evidence/run-H8/screenshots/after-ar-1280.png) |
| Credit memos at 1280 pixels | [Before](evidence/run-H8/screenshots/before-credit-memos-1280.png) | [After](evidence/run-H8/screenshots/after-credit-memos-1280.png) |
| Client grid | [Before](evidence/run-H8/screenshots/before-grid-page-clients.png) | [After](evidence/run-H8/screenshots/after-page-clients.png) |
| Quote register | [Before](evidence/run-H8/screenshots/before-grid-page-billing-quotes.png) | [After](evidence/run-H8/screenshots/after-page-billing-quotes.png) |
| Write-off grid | [Before](evidence/run-H8/screenshots/before-grid-page-receivables-write-offs.png) | [After](evidence/run-H8/screenshots/after-page-receivables-write-offs.png) |
| Payment imports | [Before](evidence/run-H8/screenshots/before-grid-page-payments-imports.png) | [After](evidence/run-H8/screenshots/after-page-payments-imports.png) |

Every sidebar destination has a 1280-pixel screenshot and overflow check. Key dialogs have screenshots including Create invoices, Receive payment, Credit memos, Void and rebill, Write-offs, Retainers and credits, Recurring plans, AR, Audit Record and Business settings. Initial failures established the missing help, display defects, delayed-read actions and focus/search races before their fixes. Test-fixture and selector corrections are retained in logs as non-acceptance attempts.

The first complete browser attempt passed 334 tests and failed one new assertion that expected a recorded later carrier in an unmaterialized legacy opening. The corrected test retains its allocation/aging assertions and adds a real $25 follow-up issue, checking $175 total and the original $150 debt's number/date on its later statement. The final screenshot sweep also produced nine failing Jest cases and three failing browser cases for import-list wording, hidden read errors and stale month responses; all are retained in `evidence/run-H8/red/`. These attempts are not represented as accepted validation or silently retried.

A subsequent browser attempt was explicitly interrupted after six passes to add a pagination regression. The failing Jest test proved that clearing the row count during loading reset page two to page one. The final hook clears stale rows but retains the pagination count until the response arrives; Jest and browser tests verify the second page. The interrupted attempt and a CI hook-cleanup lint failure remain separate from final acceptance.

## Final accepted validation

Unit **1,238**; ordinary integration **1,163 /42 files**; scenarios **2,342 /60 files**; clean-room **18**, for **3,523 integration tests /103 files**; Lambda **17**; frontend Jest **606 /91 suites**; CI build passed; full Playwright **340 + 340**, consecutively with retries zero. The browser commands took **1,438.01 and 1,429.39 seconds**. All **954 source/test/schema hashes** were unchanged across the pair. The independent read-only drift check is **0 /1,014 comparisons /338 clients**. Exact commands, counts, performance measurements and retained earlier failures are in PASS6 and the acceptance JSON.

## Protected data and documentation

H8's intended account-1 migration effects are **none: zero rows changed or added**. The seven required counts are compared directly with `ds2_ref_20260922` using a database-enforced read-only connection, as expressly permitted by the H8 clarification. Twelve before/after source/audit digests additionally detect changes beyond row counts. All seven counts match the directly read reference, all twelve digests are unchanged, and the **207,272-event audit chain verifies**. The final audit-chain verification and independent drift check are linked from PASS6.

Feature rules, endpoint index, integrated design, scenarios, operations, FINAL_REPORT and the workspace MEMORY log are updated. The help document is generated, offline Graphify is refreshed without model calls, and the existing sync script mirrors documentation into DS2_Notes. Earlier H9/H10 measurement artifacts are preserved; H8 remeasurements are copied into this run's evidence before restoring their original bytes.

Offline Graphify processed **585 source files, 2,381 nodes, 3,282 edges, 354 communities and 2,735 generated graph notes**, with zero model tokens. The graph covers current application logic and scripts; feature rules and hand oracles remain in the authored documentation.

No owner policy question is needed for this implementation. Local acceptance is not a production deployment or approval of historical source data.
