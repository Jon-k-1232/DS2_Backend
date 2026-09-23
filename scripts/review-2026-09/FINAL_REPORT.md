# DS2 full review and fix pass — 2026-09-22 → 2026-09-23

Branch `review/full-audit-2026-09` in DS2_Backend and DS2_Frontend (cut from `master`, which equals GitHub `master`: backend 45a57e9, frontend 53863d1). Nothing was deployed. The production database was only read (one `pg_dump` into a local Docker Postgres). Every fix, migration and test ran against that local copy (`ds2_local`), a clean-room database (`ds2_clean`) and a local MinIO standing in for S3.

Reviewers: Claude (coordinator + subsystem readers + fix agents on cheaper models) and Astra (GPT-6 via Codex CLI) in three rounds of cross-review; each Astra finding was either fixed with a regression test or listed below as an accountant decision.

## 1. Connector health (read-only checks, 2026-09-22)

| Connector | Result |
|---|---|
| RDS `ds2-shared-db` (Postgres 17.9) | Reachable from this Mac; 7-day automated backups; deletion protection on; daily snapshots; weekly `pg_dump` copies in `s3://ds2-database-backups-prod/weekly/` (latest 2026-09-20). |
| ECS `ds2-prod-backend-service` / `ds2-prod-frontend-service` | 1/1 running, rollouts COMPLETED, backend task definition rev 25 (`:latest`). |
| S3 `ds2-561979538576` | Invoice, audit and time-tracking prefixes present; the real tracker template (`James_F__Kimmel___Associates/time_tracking/tracker_versions/timeTracker_September-01-2026_03-28-08AM.xlsx`) was mirrored into the sandbox and drives the Excel end-to-end tests. |
| Google auth | GOOGLE_CLIENT_ID / WORKSPACE_DOMAIN / CORS_ORIGIN present in the live task definition; the terraform task definition lacked them (drift fixed in code, not applied). |
| Bedrock / Comprehend | Reachable with the JKA_JonKimmel_Admin profile; ingestion tests stub the model calls. |
| Payment-image Lambda | Unmatched-customer path returned an undefined id; fixed to NULL + review flag. |
| Nginx | Proxy timeouts raised for finalize; TLS renewal unchanged (auto-renewing). |

Security items for Jon (unchanged): one ROOT access key still exists on the AWS account; static S3 keys remain in the prod task definition and in `.env.dev` / `.env.prod` (the task role can replace them); the deploy profile is the account root principal.

## 2. Confirmed defects and their status

Money/data defects found in the production copy, all FIXED on the branch with regression tests unless marked otherwise:

1. **Finalize floored every stamped transaction to whole hours/dollars** (5,478 billed rows; 3,100 billed time rows have quantity 0, about 1,569 h lost from the record). Fixed: finalize stamps only `customer_invoice_id`; decimal validators. Historical originals are not recoverable from the database (the uploaded trackers in S3 could rebuild hours).
2. **Same-day re-finalize doubled the carried balance** (Tomo Buncic, Peterson, Cappelli, Caroline Hernandez in 2026). Fixed: customers already billed today are skipped unless "allow same-day re-bill" is checked; the second statement then absorbs the first by chain identity.
3. **Bill-day write-offs/payments were re-credited on the next statement** (61 write-offs, $26.3K exposed; 23 customers' next statements change by $4,302.75 in total). Fixed: statement membership is decided by the newest parent's `created_at` compared inside Postgres; audit and CRUD use the same gate.
4. **Deleting an ordinary payment deleted an unrelated root retainer** (prod root retainer #1 is missing). Fixed; retainer draws are linked by an explicit marker.
5. **Retainers: the engine kept the oldest snapshot and subtracted the balance from remaining but not from the amount due.** Fixed (latest snapshot, microsecond-exact ordering; due == remaining; retainer is informational).
6. **Create Invoice hid customers with back-dated unbilled work** (10 customers). Fixed: unbilled = `customer_invoice_id IS NULL`.
7. **Billing Review cascade edits wiped job write-downs and mixed payment signs**; concurrent edits double-posted; adjustment rows could sort before the payment they built on. Fixed: delta-based adjustment snapshots under the customer lock with `clock_timestamp()`.
8. **Finalize was not atomic and could be raced** (ledger edits between reading and committing; duplicate invoice numbers; partial stamping). Fixed: one REPEATABLE READ snapshot for the fingerprint and every pricing input, a per-row hash fingerprint (payments, write-offs, invoice rows, unbilled work, retainers) re-checked under the account + customer locks, number collision check, exact-count stamping, per-run S3 keys.
9. **Ledger lock mode deadlocked with foreign-key key-share locks** (ingestion claims, inserts referencing the accounts row). Fixed: every ledger lock is `FOR NO KEY UPDATE`.
10. **Payments could be posted to absorbed/stale chains; overpayment excess stayed spendable after an NSF reversal; legacy overpayment-split text was a forgeable link; the legacy two-step pending-payment approval marked money processed without posting it.** Fixed (see Astra round 3, scope A).
11. **Transactions: CRUD outside the ledger lock; retainer-funded edits desynchronised the draw/payment; cross-customer retainer spend; authorship spoofable via `loggedByUserID`; string "false" stored as true.** Fixed.
12. **Jobs: create/update/delete outside the ledger lock; reassignment to another customer while transactions were linked.** Fixed.
13. **Ingestion: re-upload duplicates, order-dependent fuzzy customer matching, cross-tenant template and S3 paths, missing role/owner checks on timesheets routes, billed-entry deletes causing double billing, kickoff by tracker name using the caller instead of the owner.** Fixed (Excel end-to-end and timesheets coverage specs).
14. **Account Audit** counted issue-time payments twice, truncated the statement gate to milliseconds, counted cancelled or inactive-untouched retainers as "drawn", and its jobs were not tenant-scoped. Fixed.
15. **Data quality**: `transaction_type 'time'` excluded from analytics (5,130 rows), literal 'null'/'undefined' notes (33,129 rows), mixed `total_payments` sign (918 legacy positive / 88 negative). Migration 019 normalises casing/notes unconditionally and flips `total_payments` only for rows in its reviewed manifest, re-verified per row against live data at apply time, logging every changed row. The shipped manifest holds the 904 sign-only rows reviewed on 2026-09-23 (section 10); the 14 exceptions stay with the accountant.
16. **Frontend**: account-settings save deactivated the account; Create Invoice selection differed from the submitted batch; four paginated grids overwrote shared context and accepted stale responses; a failed download hid a committed finalize and skip details vanished after 2 s; the payment picker offered absorbed statements; missing customer profiles spun forever; the invoices grid dropped rows (no row id); grid toolbars remounted on every render. Fixed (see Astra round 3, scope E).
17. **Small defects**: unknown ids returned 500 or misleading 200 across customers/users/write-offs/retainers/jobs/master data; recurring-customer update NaN and delete no-op; `createUser` active flag; job-type active filter; `deleteCustomer` recurring guard keyed on the wrong id; role gates not mirrored server-side. Fixed.
18. **Astra round 4 (verification of the round-3 fixes) found follow-ups, all fixed with tests:** Account Audit read its raw ledger and the engine balance in separate snapshots and could report a discrepancy no ledger state ever had (now one repeatable-read snapshot); the finalize snapshot's start time lost microseconds (now exact text); statement PDFs overlapped long job descriptions and split a job across pages with many rows (paginated with measured row heights); a nested note marker could be sanitised into an executable prepayment link; compensating retainer snapshots recorded the previous creator instead of the actor; payments and invoice write-offs accepted another customer's job; job totals summed one job version instead of the family; the Create Invoice header checkbox had no keyboard or accessible mixed state (fixed); a failed balance refresh still left the grid on Loading (fixed); the grid selection survived a completed batch (fixed); the legacy two-step pending-approval fallback in the frontend could post twice (removed — approval is the single atomic POST; a missing route is a hard stop).
19. **Ingestion, fresh review (Astra round 4, scope C):** tracker time was priced in hundredths of an hour although the firm bills in 6-minute increments rounded up (the manual-entry UI already did) — 68 minutes at $137.50 is $165.00, not $155.38; an employee could kick off another employee's tracker under a forged actor id; a delete could overwrite a concurrent apply; manual apply billed non-work rows ("Doctor Appointment"); "Acme LLC" exact-matched "Acme Inc"; same-named employees shared an S3 folder; the wrong same-named employee's rate could be used; a held entry accepted another tenant's work-description id; duplicate detection blocked the advertised delete-and-re-upload; tied candidates depended on catalog order; the recursive validator overflowed the stack at 5,000 invalid rows and corrupt workbooks or bad filename encoding produced 500s; template-version listing authorised the URL user instead of the caller. All twelve fixed with tests (the 6-minute rule raises tracker-priced amounts slightly: the Excel end-to-end fixture's two statements moved from $393.75/$181.50 to $412.50/$195.00). Open policy item: with the AI flag OFF the template download is a byte-identical passthrough of one shared prod-derived object and still shows account 1's client names to any other tenant (there is only one real tenant today).

## 3. Data repairs for the accountant (NOT applied — decisions, with scripts in `DS2_Backend/scripts/review-2026-09/`)

- Same-day duplicate statements: Tomo Buncic INV-2026-00188/00189, Robert & Debra Peterson 00202/00203, John & Colleen Cappelli 00068/00069, Caroline Hernandez 00183/00184, plus 2024 pairs (`same-day-duplicate-statements.js`).
- Bill-day write-offs possibly credited twice: 61 write-offs / 28 customers, $8,331.75 supported, $12,208.00 possible (`billday-writeoff-double-credit.js`, population in `billday-writeoff-ids.json`).
- `total_payments` sign flips: 904 candidate parents adopted into migration 019's manifest on 2026-09-23 (pure sign changes, see section 10) and 14 exceptions left for the accountant (`manifest-2026-09-22/positive-total-payments-exceptions.report.csv`: stored 11,727.00 vs tagged net -28,154.50).
- Parent/snapshot mirror desync: invoices 2015 (Tomo) and 506 (customer 97).
- 5 billable transactions with no job ($365) and 9 cross-customer job links (KFP / JFK&A).
- Stale unbilled work: 51 customers / $14.8K never billed.
- Customer 228 INV-2024-00397: remaining $472 double-subtracts a $153 retainer payment.
- Job totals: 151 job families whose stored `current_job_total` on the newest version differs from the recomputed family total (net −$485, range −$275 to +$4; largest: family 1343 stored $1,235 vs $960). Pre-existing; the code now sums the whole version family, and the next edit on each job recomputes it (`job-family-totals-stored-vs-recomputed.csv`).
- Internal entities (customers 5 and 6) carry $1.43M of "billable" internal time; set `INTERNAL_CUSTOMER_IDS` in prod and consider an internal flag.
- Credit balances: finalize now skips negative statements with a reason; a carry-forward/credit-memo design is still open.
- AR aging ages the statement, not the charge; `oldest_open_charge_date` is a FIFO estimate.

## 4. Is the month-end model industry standard?

Balance-forward monthly statements are standard for a small CPA firm; the bookkeeping underneath was not (mutable history, date gates, non-atomic runs, integer truncation) and is now fixed. Remaining design gaps to plan for: charge-level AR aging, a period lock with adjustment-only corrections, credit carry-forward, voids instead of deletes for anything that appeared on a statement, and a persisted `billing_runs` table. Full assessment: `industry-standard-assessment.md`.

## 5. Tests (final counts filled in section 8)

Backend unit (mocha), integration specs against the sandbox (one process per file), clean-room three-month regression against `ds2_clean`, drift check (engine vs audit vs AR for every customer), frontend jest, CI build, Playwright browser suite in `DS2/e2e`.

## 6. Migration and rollout notes

- Dev: `npm run migrate -- --baseline 18` once (dev has no runner history), then `npm run migrate`.
- Prod: has no `schemaversion`; apply migration files by hand in order with `psql -X -1 -v ON_ERROR_STOP=1 -f`, 019 last. Its manifest block is already populated (904 rows from the 2026-09-22 snapshot); run the BEGIN / file / audit SELECT / ROLLBACK rehearsal from `migrations/README.md` first and save its output — any row whose live data changed since 2026-09-22 shows as SKIPPED and stays on the review list. Take a backup first.
- Deploy backend before frontend (the frontend depends on `skippedCustomers`, `allowSameDayRebill`, the 404 envelopes and the 410 on the legacy pending-approval route).
- Set `INTERNAL_CUSTOMER_IDS` and `BILLING_TIMEZONE=America/Phoenix` in the prod task definition.

## 7. Environment notes

The sandbox backend is started with `DISABLE_RATE_LIMIT=true` for browser end-to-end runs: in development mode the API limiter (300 requests a minute per client) is armed, and a full 69-test Playwright run exceeds it, so three tests failed on 429s until the switch was added. The switch skips only the API and expensive-endpoint limiters, never the auth limiter, and must never be set in a deployed environment (documented in `e2e/README.md`).

The repos live in the iCloud-synced Desktop with the disk at 97 %. macOS evicted `node_modules`, source files and the `.git` objects twice during the review ("dataless" files), which made every first read take minutes. `node_modules` now lives in `node_modules.nosync/node_modules` behind a symlink (iCloud never syncs `*.nosync`). Move the repos out of `~/Desktop` (or exclude the folder from iCloud) and free disk space; until then `git` operations on these repos are extremely slow, which is why the branch commits were produced through a scratch clone of `master` (same commit) and transplanted.

## 8. Final regression results (final code, 2026-09-23 ~06:00 Phoenix)

| Suite | Result |
|---|---|
| Backend unit (mocha, `test/` minus `test/integration`) | 829 passing, 0 failing |
| Backend integration, 18 specs one process each (account 9001 on the prod copy) | 935 passing, 2 pending (an account-1 quote fixture that does not exist; the flag-off template passthrough policy item), 0 failing |
| Migration runner / repair / review-script tests (`test/scripts`, throwaway databases) | 89 passing |
| Statement PDF layout tests (`test/pdfCreator`, pdftotext) | 12 passing |
| Clean-room three-month regression (`ds2_clean`, hand-computed ledger, PDF text) | 18 passing |
| Drift check (engine vs Account Audit vs AR, every customer on the prod copy) | 0 of 319 and 0 of 320 mismatched |
| Frontend jest | 22 suites, 94 tests passing |
| Frontend CI build (`CI=true`, warnings fail) | clean |
| Playwright browser suite (`DS2/e2e`, real UI against the local stack) | 69 of 69 passing, 0 fixme (expanded from 39; the nine product defects it reproduced — dead edit routes for job categories/types/work descriptions/jobs, a swallowed create error, a two-word first-name split, a quotes page that never loaded, a duplicated dashboard heading — were fixed and their tests un-skipped; details in `e2e/REVIEW_RESULTS.md`) |
| Route coverage matrix (`test/COVERAGE_MATRIX.md`) | 135 of 135 routes referenced after the Billing Review read-route spec (counts references, not behaviour) |

Per-spec integration counts: analytics 11 · billing-regression 2 · cascade-edit-recompute 11 · coverage account/users/auth/misc 197 · coverage billing-review read routes 31 · coverage invoices/audit/AR/analytics 131 · coverage jobs/master data 123 (+1 pending) · coverage payments/pending 102 · coverage time tracking/timesheets 85 (+1 pending) · coverage transactions/retainers/write-offs 84 · finalize-engine 15 · finalize-snapshot 9 · month-end lifecycle 19 · orchestrator 7 · payment-reversal 49 · pii-leak 2 · tracker Excel end-to-end 30 · transaction ledger seams 27. Specs share fixture account 9001 with the Playwright suite, so they are run one process at a time and never concurrently with a browser run (one chain run showed a single off-by-one row count while a Playwright upload was in flight; it passes alone).

Astra's five verification rounds are in the scratchpad (`astra*/` directories); the round-5 verdicts are summarised in section 9.

## 9. Astra round-5 verdicts (final verification of the round-4 fixes)

Every round-4 finding was confirmed fixed. Astra's fifth pass then found smaller residuals in each scope; the fix agents applied Astra's validated patches with regression tests, and Astra's sixth (closing) pass confirmed all twelve ledger/ingestion/frontend/scripts residuals fixed, with each new test shown to fail against the pre-fix code, and declared those four scopes ready to hand over (the PDF residuals are covered by their own closing pass, see below):

- Ledger (A5): a fabricated cancellation marker on retainer creation could make a real retainer un-editable; client-written "[reversed …]" note text blocked a genuine NSF reversal. Fixed: retainer notes and payment notes are stripped of every link/status marker to a fixed point, genuine system markers are re-added from the stored row.
- Finalize/audit/PDF (B5): the audit snapshot and microsecond start were confirmed; the paginated PDF still allowed a near-page-height row to split from its amount, a heading or subtotal without rows, notes longer than a page to escape the managed layout, and printed "null" for empty payment references. Fixed with boundary tests (23 jobs, 71-line description refused, 100-line note, null references).
- Ingestion (C5): a shared "Company" token defeated the legal-form conflict check ("Acme Company LLC" matched "Acme Company Inc" exactly); Billing Review recorded the URL user as the actor; the legacy manual conversion route still priced hundredths of an hour and accepted a sub-cent rate. Fixed with tests; the wrong-oracle coverage test (20 minutes as 0.33 h) corrected to 0.4 h.
- Frontend (E5): the grid remount that reset the selection also wiped skipped customers' draft notes and write-off choices (now only invoiced customers' drafts are cleared); the review dialog could resubmit after success (disabled); stale fallback comment removed.
- Migrations/scripts (F5): the plain-SQL lexer mis-classified two valid PostgreSQL forms (escape-string continuation across a newline, non-ASCII dollar tags), the ownership quarantine missed a foreign-owned child without payments, the rehearsal command lost its audit rows on ROLLBACK, and an empty manifest lacked its provenance header. Fixed with tests and README corrections.

Closing verdicts: Astra's sixth pass re-verified every residual above against the final code — each new regression test fails on the pre-fix code, no regression was introduced — and declared all five scopes (ledger, ingestion, frontend, scripts, PDF) ready to hand over. The PDF pass also re-rendered the four largest real statements from the production copy (customers 5, 6, 70, 80): labels and values identical to the pre-fix renderer apart from pagination and the blank-instead-of-"null" references.

Astra's bookkeeping guidance carried into section 3 and 6: the 6-minute rule changes amounts, not display (tell the firm); no retroactive repricing was performed; the 019 manifest is an approval list, not proof of attribution — every candidate parent needs review, and the rehearsal output must be saved before rollback.

## 10. Follow-up decisions taken 2026-09-23 (afternoon, decisions delegated by Jon)

### 10.1 Migration 019 manifest populated (904 rows)

- **Source**: the 2026-09-22 `pg_dump` of prod (`scratchpad/dumps/ds2_prod_20260922.dump`, the read-only dump taken at the start of the review) restored locally as `ds2_ref_20260922`; the generator ran read-only against it. This step neither connected to nor wrote to production.
- **Result**: 904 candidates, 0 flagged `possible_misattributed_reversal`, 295 customers, stored positive total 718,003.54 -> signed net -718,003.54. 14 exceptions (stored total not explained by tagged payments) excluded. Package committed under `scripts/review-2026-09/manifest-2026-09-22/` (review CSV, generator output, exception list, README with the decision basis).
- **Why adopt without an accountant**: for every one of the 904 rows the change is representational only — the column now means "signed net of the payments tagged to this chain", all tagged payments are negative, none has a reversal anywhere on the account, all are owned by the invoice's own customer, and they sum to exactly the magnitude the legacy code stored. No balance, remaining amount or payment moves. Attribution questions (a payment tagged to the wrong chain of the same customer) are unaffected by the sign and remain tracked in the 113-payment reconciliation list.
- **Fail-closed per row remains**: the UPDATE checks owner, old total, signed net, exact payment-id set, zero reversal events on the row's own chain, no foreign ownership in the chain and — added after Astra's round-7 review, which reproduced the gap on a clone (a `[reversal of payment #8]` entered on another chain of the same customer left root 4 eligible) — no reversal note anywhere on the account naming one of the row's payments; drifted rows are skipped and listed under `019-review`. Regeneration for a newer snapshot needs a new documented decision (the generator flags, but does not exclude, the cross-chain reversal shape).
- **Rehearsal on a clone of the snapshot** (`CREATE DATABASE ds2_m019_rehearsal TEMPLATE ds2_ref_20260922`): documented BEGIN / file / audit SELECT / ROLLBACK run -> 904 APPLIED, 0 SKIPPED, 14 still positive, 5,130 casing fixes, 33,129 + 1 literal-null notes; after ROLLBACK all 918 positive parents intact. Committing run (`psql -X -1`) -> same counts, `ledger_normalization_log` = 33,130 note + 5,130 casing + 904 total_payments + 14 review rows; second run changed nothing (log unchanged at 39,178 rows). Three-view drift check before and after: 320 customers, 0 changed rows, 0 nonzero diffs.
- **Sandbox**: `ds2_local` was flipped by the pre-fail-closed arithmetic version of 019 early in the review (2026-09-22); verified row by row today that its 904 roots equal the manifest's signed nets exactly, so the final regression in section 8, run after that point, exercised the state this migration produces (the exact database state under each earlier run is not re-established here). `ds2_ref_20260922` is kept as the pristine prod-snapshot reference; the rehearsal clone was dropped.
- **Visible change**: for the 904 statements the stored Total Payments shows the signed value (425.00 -> -425.00) in invoice details, grids and API, consistent with statements created since June 2026; remaining balances, payments, PDFs, AR, audit and analytics are unchanged (Astra's reader-by-reader inspection agrees; the deprecated `cascadeEdit._recomputeInvoiceTotals` export has no production caller and must not be used for reconciliation).
- **Tests**: `test/scripts/migration-019.spec.js` strips the shipped block for the empty-manifest cases and adds shipped-manifest tests (904 well-formed unique account-1 rows summing to 718,003.54; a non-matching database flips nothing and lists the parent; a fixture matching shipped root 4 exactly flips through the shipped file with its remaining balance unchanged) plus the round-7 regression (manifest-matching row + reversal note on another chain -> no flip, review entry).
- **Round-7 fix verified on a fresh clone**: pristine data still 904 APPLIED / 0 SKIPPED; with Astra's probe applied (payment 21 of customer 67 turned into a +425.00 `[reversal of payment #8]` on another chain) the same file flips 902, skips root 4 (new account-wide reversal-note check) and root 49 (the chain that now carries the positive event), and lists both under `019-review`.
- **Astra round 7** (`scratchpad/astra-review7/`): NOT READY on first pass — three findings (live cross-chain reversal check missing; wholesale-regeneration wording unsafe; document the visible sign change) — all addressed above; Astra independently regenerated the manifest (identical 904 rows, 0 flagged), applied it on its own clone (904 flips, all other invoice fields identical across 2,253 rows, 320 customers unchanged in the drift check) and ran the scripts suite (91 passing).

### 10.2 Time-tracker template tenant gap closed

- `GET /time-tracking/template/latest/:accountID/:userID` serves the byte-identical uploaded template only to the account that owns the object (`TEMPLATE_OWNER_ACCOUNT_ID`, default 1, because the key lives under account 1's slug and no per-object owner is recorded). Every other account always receives a copy rebuilt from its own customers, employees and categories, whatever its auto-ingest flag; if that rebuild fails the response is a 503, never the shared bytes. The builder is now called through the module object so the failure path is testable.
- Tests: the pending DEFECT test (account 9001 must never receive account 1 names) is un-skipped and also asserts the rebuild header; a stubbed-builder 503 test added; the passthrough/upload round-trip tests target the owner account. `coverage-timetracking-timesheets` 87 passing, `tracker-excel-end-to-end` 30 passing, unit suite 831 passing.

### 10.3 Other follow-ups

- `coverage-jobs-masterdata`: the perpetually skipped account-1 quote test became a self-contained create/read/update/delete lifecycle on fixture account 9001 (124 passing, 0 pending).
- Playwright suite moved from the unversioned `DS2/e2e` into `DS2_Frontend/e2e` (resolver `lib/paths.js` finds the DS2 root and `DS2_Backend`; generated folders ignored; README updated). 69 of 69 passing from the new location; frontend jest 94 and CI build unaffected. Frontend commit `ef47f60` on `review/full-audit-2026-09`, pushed to GitHub as an off-machine backup (no CI workflows exist in either repo, so a push cannot deploy anything; no pull request opened).
- Month-end CSV report (`createInvoiceCsv.js`, zipped with the draft statements) now goes through the shared `csv-util` formula-injection guard like the transactions, AR and analytics exports: a customer name beginning with `=`, `+`, `-` or `@` no longer executes as a formula when the file opens in a spreadsheet, and names containing commas are quoted instead of stripped. Closes the CSV-hardening item deferred in June 2026. Tests: new unit spec (3), invoices coverage 131, clean-room regression 18 (asserts the CSV rows byte for byte).
- Sandbox: `ds2_ref_20260922` (pristine 2026-09-22 prod snapshot) added and kept; rehearsal clones dropped. The local backend was restarted on the committed code (`DISABLE_RATE_LIMIT=true`, `.env.local`) so the running stack matches the branch. Nothing was deployed and production was not touched.
