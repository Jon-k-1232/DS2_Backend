# H8 browser and page-help acceptance

This pass exercises the current local application after H9/H10. Financial fixtures stay in account 9001 of ds2_local, or the disposable scenario/clean databases. Account 1 is read-only. Browser tests connect to the managed Chromium server at port 3334; no local browser or application server is launched. Test processes run sequentially with retries disabled.

## Oracles and realistic mistakes

- A new client receives $50 with no open invoice: one $50 cash receipt, $50 held credit and no billed debt. A network or server refusal leaves the client's audit history unchanged. Losing the response **after** commit and retrying the same request returns that same receipt and adds no audit event or cash.
- A finalized $22.50 invoice receives a $5 memo: remaining debt $17.50. Two browser tabs reviewing the same original cannot post that memo twice: the stale tab gets 409, retains its correction and adds no event. Back/refresh shows $17.50; the original invoice row remains byte-for-byte unchanged.
- One $1,000 receipt applies $300 + $450 + $250 to three debts, leaving $150. A subsequent $25 charge produces a $175 statement. Receive payment still identifies the $150 by its original invoice number/date and marks it **Later statement**; only the new $25 belongs to the new original statement. The reconstructed opening has no recorded carrier yet, so the pre-receipt display correctly says **Original statement**.
- A receipt detail must finish both its receipt and open-invoice reads before correction controls appear. An open-invoice failure exposes recovery, with no stale correction action. A memo reversal review blocks switching to another memo while its balances are loading.
- Delayed Create invoices, AR and Billing performance reads keep submit/export controls disabled. Account Audit blocks an old selection while loading or after an error and ignores an older response that arrives last. Delayed invoice/client grids preserve focus on the help button.
- Payment imports distinguishes a failed list from an empty result in New payments, Processed and All payments. Reload restores the selected list without any financial/audit write. A late response for the previous month cannot overwrite the selected month. Empty states explain the next step; **Name on payment** and **Matched client** replace technical headings.
- AR's synthetic display oracle has $20 in 0–30, zero unknown age and a historical estimate marker. The marker belongs to the client row, not the empty Unknown age bucket; zero totals use normal text color. Date and saved-through filters continue to reach both table and export.
- The retained payment, recurring, correction, retainer and issued-record suites prove oldest-first allocation, excess credit, wrong client/business/invoice, pennies, overapplication, duplicate clicks, stale state, admin-only adjustments, immutable originals, refunds, transfer lineage, catch-up, locks and storage errors.

## Navigation and workflow coverage

| Pages / workflows | Browser coverage |
|---|---|
| All 39 sidebar destinations; client Overview, Statements, Work, Jobs, Receipts, Credits & retainers, AI Audit, Audit Record, Edit client | `page-help-H8`, `navigation-H6`, `auth-and-navigation`, `customer-profile` |
| Clients, contact edits, stale profiles, missing/foreign records | `customers`, `customer-profile`, `user-mistakes-navigation`, `navigation-H6` |
| Time, charges, jobs, covered/excess time, work review, bounded type-ahead, dependent deletion | `jobs-and-transactions`, `jobs-list`, `edit-flows`, `billing-review-H9`, `lookups-H9`, `user-mistakes-financial`, `user-mistakes-delete` |
| Create invoices, drafts/CSV, credit statements, finalize, post-finalize refusals | `month-end`, `invoices-quotes`, `path-matrix-owner-decisions`, `user-mistakes-decisions`, `performance-H9`, `performance-H10` |
| Receive payment, open invoices, allocations, overpayments, bounce, application correction, receipt/credit transfers | `receive-payment`, `mistakes-H8`, `business-entities` |
| Credit memos, reversal, void/rebill, client-credit refunds, concurrent tabs | `corrections`, `mistakes-H8`, `page-help-H8` |
| Write-offs, retainers, retainer events, legacy payment entry, pending imports | `payments-writeoffs-retainers`, `user-mistakes-financial`, `user-mistakes-decisions`, `role-matrix`, `payment-imports-H8` |
| Recurring plans, preparation, edit/skip/catch-up, issue locks and rejected saves | `recurring-billing` |
| AR, Account Audit, all six analytics pages and exports | `analytics-pages`, `analytics-H5`, `read-only-pages`, `performance-H10`, `readiness-H8`, `receive-payment`, `page-help-H8` |
| Audit Record print/read/verify, source downloads, filters and failures | `user-mistakes-audit`, `path-matrix-owner-decisions` |
| Business settings, aliases, assignments, credit transfer and permissions | `business-entities`, `navigation-H6`, `role-matrix` |
| Users, account, automation settings, catalogs and tracker administration/template/upload/history | `account-users`, `workspace-users`, `master-data`, `time-tracking-admin`, `time-tracker-upload`, `role-matrix` |
| Old bookmarks, missing IDs, back/reload, keyboard and narrow navigation | `navigation-H6`, `auth-and-navigation`, `user-mistakes-navigation`, `page-help-H8` |

Help itself changes no business data. Five bullets per destination cover purpose, use and alternatives, financial effects, real roles and correction limits. `src/help/pageHelp.js` is the single source; the generator and Jest compare the actual markdown in `docs/platform/page-help.md`. IDs remain available in actor tooltips; missing names are explicitly unrecorded rather than invented. API presentation tests also verify inactive staff names, tenant separation and unchanged tables/audit evidence on successful reads and failures.

## Evidence

[PASS6](RESULTS-PASS6.md) records the final counts and two complete no-retry browser passes. Before/after screenshots and individual command logs are in `../decisions/evidence/run-H8/`. Initial failures are retained separately from acceptance, including the tests written before each defect fix. The protected census compares all seven required tables directly to ds2_ref_20260922 using a read-only connection, as expressly authorized in the H8 brief; twelve source/audit digests additionally compare before and after this pass.
