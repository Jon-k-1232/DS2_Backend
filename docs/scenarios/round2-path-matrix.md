# H7 — round-two API path matrix

This extends the retained Pass3 matrix from 160 to **218 contracts**. The 58 additions below are enumerated from actual Express routers by `test/integration/_round2-routes.js`, with an executable inventory assertion. `path-matrix-H7-round2-guards.integration.spec.js` checks every added route for anonymous refusal and every disallowed employee/manager role, including mixed-case roles. All refusals compare every public table, including audit and retry records. H6 changed browser routes, not APIs.

Feature proof filenames below are under `test/integration/`, with suffix `.integration.spec.js`. These are case indexes, not independent totals to add together. All Admin actions also admit Super Admin through existing case-insensitive `requireAdmin`; any one admin acts alone. No approval workflow. Full execution evidence is in [PASS5](RESULTS-PASS5.md).

| Proof group | Happy paths and additional refusals |
|---|---|
| H1 | `path-matrix-H1-entities`, `scenario-H1-entities`, `scenario-H2-cutover` |
| H2 | `path-matrix-H2-receipts`, `path-matrix-H2-credit-transfers`, `scenario-H2-receipts`, `path-matrix-H7-boundaries`, `path-matrix-H7-receipt-transitions` |
| H3 | `path-matrix-H3-corrections`, `path-matrix-H3-admin-adjustments`, `scenario-H3-corrections`, `path-matrix-H7-boundaries` |
| H4 | `path-matrix-H4-recurring`, `scenario-H4-recurring` |
| H5 | `path-matrix-H5-analytics`, `scenario-H5-analytics`, analytics model unit regressions |
| Combined | `scenario-H7-combined` follows both businesses through every money category and the preserved owner decisions |

## Added contracts

| Method | Path | Minimum role | Proof group |
|---|---|---|---|
| GET | `/billing-entities` | Manager | H1 |
| POST | `/billing-entities` | Admin | H1 |
| GET | `/billing-entities/balances` | Manager | H1 |
| GET | `/billing-entities/review` | Admin | H1 |
| POST | `/billing-entities/review/:entryID/resolve` | Admin | H1 |
| GET | `/billing-entities/transfers` | Employee (history) | H1 |
| POST | `/billing-entities/transfers` | Admin | H1 |
| GET | `/billing-entities/work/:transactionID` | Admin | H1 |
| POST | `/billing-entities/work/:transactionID` | Admin | H1 |
| GET | `/billing-entities/cutover` | Admin | H1 |
| GET | `/billing-entities/cutover/amendment` | Admin | H1 |
| POST | `/billing-entities/cutover/amendment` | Admin | H1 |
| GET | `/billing-entities/cutover/candidates` | Manager | H1 |
| POST | `/billing-entities/cutover` | Admin | H1 |
| GET | `/billing-entities/:entityID` | Admin | H1 |
| PATCH | `/billing-entities/:entityID` | Admin | H1 |
| POST | `/billing-entities/:entityID/aliases` | Admin | H1 |
| DELETE | `/billing-entities/:entityID/aliases/:aliasID` | Admin | H1 |
| GET | `/billing-entities/:entityID/logo` | Admin | H1 |
| POST | `/billing-entities/:entityID/logo` | Admin | H1 |
| GET | `/payments/open-obligations` | Manager | H2 |
| GET | `/payments/receipts` | Manager | H2 |
| POST | `/payments/receipts` | Manager | H2 |
| GET | `/payments/receipts/:receiptID` | Manager | H2 |
| POST | `/payments/receipts/:receiptID/applications/:applicationID/correct` | Admin | H2 |
| POST | `/payments/receipts/:receiptID/exceptions` | Admin | H2 |
| POST | `/payments/receipts/:receiptID/cancellations` | Admin | H2 |
| POST | `/payments/receipts/:receiptID/reversals` | Admin | H2 |
| POST | `/payments/receipts/:receiptID/resolve` | Admin | H2 |
| GET | `/credits` | Manager | H2 |
| GET | `/credits/transfers` | Manager | H2 |
| POST | `/credits/transfers` | Admin | H2 |
| GET | `/invoices/:invoiceID/corrections` | Manager | H3 |
| POST | `/invoices/:invoiceID/credit-memos` | Admin | H3 |
| POST | `/invoices/:invoiceID/void-rebill/preview` | Admin | H3 |
| POST | `/invoices/:invoiceID/void-rebill` | Admin | H3 |
| GET | `/credits/:creditID/refundable` | Manager | H3 |
| POST | `/credits/:creditID/refunds` | Admin | H3 |
| GET | `/credit-memos` | Manager | H3 |
| GET | `/credit-memos/reversals/:recordID/pdf` | Manager | H3 |
| GET | `/credit-memos/:recordID` | Manager | H3 |
| GET | `/credit-memos/:recordID/pdf` | Manager | H3 |
| POST | `/credit-memos/:memoID/reversals` | Admin | H3 |
| GET | `/refunds` | Manager | H3 |
| GET | `/refunds/:recordID` | Manager | H3 |
| GET | `/refunds/:recordID/pdf` | Manager | H3 |
| GET | `/invoice-voids/:recordID/pdf` | Manager | H3 |
| GET | `/recurringCustomer/plans` | Manager | H4 |
| POST | `/recurringCustomer/plans` | Manager | H4 |
| GET | `/recurringCustomer/plans/:planID` | Manager | H4 |
| PATCH | `/recurringCustomer/plans/:planID` | Manager | H4 |
| GET | `/recurringCustomer/due` | Manager | H4 |
| POST | `/recurringCustomer/prepare` | Manager | H4 |
| POST | `/recurringCustomer/:planID/catch-up` | Manager | H4 |
| PATCH | `/recurringCustomer/occurrences/:occurrenceID` | Manager | H4 |
| POST | `/recurringCustomer/occurrences/:occurrenceID/skip` | Manager | H4 |
| GET | `/analytics/billingPerformance/:accountID/:userID` | Super Admin | H5 |
| GET | `/analytics/billingPerformance/:accountID/:userID/export` | Super Admin | H5 |

## Branch families and refusal evidence

| Boundary | Reachable refusal branches and success alternatives | Proof |
|---|---|---|
| Business CRUD and aliases | Scalar IDs, reason/name/prefix/email/boolean; duplicate name/prefix; stale version; inactive/default/open-balance conflict; missing/foreign object; used/missing alias; DB insert/update/delete failure | H1 matrix |
| Logos and tracker review | Bad image, foreign key, changed bytes, storage read/write failure, late DB failure after upload; ambiguous/unknown tracker, stale/processed/deleted source, used alias; explicit resolution and repeat conflict | H1 matrix and scenario; H2 cutover scenario |
| Legacy opening and work reassignment | Missing/foreign/issued work; reason/hash; position/slice conservation; stale/repeated manifest, invalid key/hash; resumed financial activity; candidate reads and deleted-source review pages | H1 scenario; H2 cutover scenario |
| Receive payment | Client/business, method/reference, date/scale/range, malformed/null allocation rows, array IDs, repeated/wrong-client/wrong-business/missing invoice, overapplication, pre-invoice date, FIFO override reason, duplicate acknowledgement, fingerprint/key, stale and same/different-key races, late application/credit DB failure | H2 receipt matrix; H7 boundaries/transitions and combined lifecycle |
| Reads and original aging | Missing/foreign receipt/client/business, pagination, effective/knowledge cutoffs, impossible dates, year zero and clock normalization, valid year-one/leap-day/microseconds, DB failures, original dates after absorption and bounce | H2 receipt/credit matrices; H7 boundaries; H2/H7 scenarios |
| Application correction | Missing/foreign/already-corrected/finalized source; changed amount; missing/same/insufficient target; correction before target, receipt or original application; stale state, late DB failure after reversal; retry for another application | H2 receipt matrix; H7 boundaries/transitions |
| Cancel/flag/reverse/resolve | Reconstructed source cannot use manual workflow; check-only/condition; already flagged/reversed/resolved, resolve before reversal, issued or flagged cancellation, partial selectors, early dates, later credit use, refunded dependency, transfer lineage, late DB failure, revision storage failure, wrong-receipt retry | H2 matrices; H3 correction matrix; H7 transitions/lifecycle |
| Credit transfer | Same/inactive/foreign target; source scope/kind/available funds; amount/reason/fingerprint/key; DB failure after debit; source cash lineage and exact replay | H1/H2 credit matrices; H7 lifecycle |
| Memo and memo reversal | Finalized original required; wrong entity, voided/exception state; original/cumulative amount, explicit excess-credit choice; missing/null/duplicate/unbalanced/foreign lines; before-source/later-activity date; used/refunded dependencies; stale/retry; storage and late DB failure | H3 matrix/scenario; H7 boundaries/lifecycle |
| Void/rebill | Missing/stale preview; line count/description/amount/source membership; strict transfer choice, wrong/inactive entity; unresolvable/used/refunded basis; payment date/bounce dependency; artifact and late DB failure; same/different-business funding; preserved original PDF | H3 matrix/scenario; H7 boundaries/lifecycle; funding unit regressions |
| Refunds and downloads | Source/entity, amount/availability, method/reference/date, prior credit date, bounce dependency, stale/retry; wrong tenant, pagination/ID; storage failure/tamper and DB failure | H3 matrix/scenario; H7 lifecycle |
| Recurring | Client/business/job, amount/cadence/calendar/start/end/activity; version/key; generated-history identity lock; explicit historic confirmation, cap12, duplicate/not-due periods; closed job; late DB rollback; skipped/issued locks; preparation races, finalize refresh outcome | H4 matrix/scenario; H7 lifecycle |
| Analytics | All ten changed report/export contracts retain Super Admin; tenant/entity/year/window/cutoff/export validation; read-only success/DB failure and stream failures; estimates/unknowns, historical worked-for/billed-by, mixed funding across repeated rebills, one surviving fee/effort cohort | H5 matrix/scenario; existing matrix08; H7 boundaries/lifecycle; reporting-model unit specs |
| Existing admin adjustments | Write-off CRUD; retainer refund/increase/decrease; monetary duplicate removal; legacy and receipt bounce flag/reverse/revise/roll-forward; manager/employee403 before parsing; admin/Super Admin success; flag/dismiss and ordinary entries unchanged | H3 admin/correction matrices; H1/H2 transfer matrices; H7 guards; H3/H6 browser role tests |
| Existing customer-create screen | One pending submission; body/HTTP refusals and lost transport confirmation retain the draft; explicit retry sends once and creates exactly one customer | `NewCustomer.test.js`; `e2e/tests/customers.spec.js`; existing API commit-outcome and customer route tests |

The original Pass3 **898-site count is historical**, not a new source coverage number. The route total is an inventory; behavior proof comes from named assertions and full-table comparisons. Defensive database constraints also retain direct-SQL, migration and invariant tests in the complete pass. There is no claim that one assertion per status code exhausts a feature.

Some error categories do not exist on a given route: pure reads have no monetary double-submit or write-storage branch; in-memory analytics exports have no object-store write; session-account APIs enforce tenant ownership on stored objects rather than trusting a body account ID. Disabled email/scheduling tests prove the boundary before network/client construction; enabled branches use transport stubs.

The documented recurring finalize refresh409 **commits prepared unissued fees and creates no invoice**. Its test proves that precise outcome. Likewise post-commit export/refresh failures preserve and report a successful invoice commit. They are not counted as no-write refusals. Ordinary validation/role/tenant/not-found/lock/stale refusals and transactional errors preserve every table. Nontransactional sequences may advance; late DB failure may leave an unreferenced create-only artifact while original and referenced artifact bytes remain protected.

## H9 extension

Current inventory: **221 contracts**. `path-matrix-H9-loading.integration.spec.js` adds `/jobs/getJobs/:accountID/:userID`, `/customer/lookup/:accountID/:userID` and `/retainers/getRetainers/:accountID/:userID`; it also replaces the per-client job read contract with bounded search. Every refusal compares all public table contents, including the audit ledger. Older160/218 contract inventories remain covered; the H9 additions have their own role/tenant/input/read-failure matrix.
