# H3 results — credit memos, void/rebill and client refunds

2026-09-26. Local implementation of owner item 5 and the admin-only adjustment addendum. All 98 required acceptance commands passed; final counts and protected-data verification are recorded below. No production deployment, Git command/commit, AWS connection, real email or reference-database connection.

## Delivered behavior

- Credit memo against a finalized nonvoid invoice: positive amount/reason/business; original new-charge cap; original debt first; explicit confirmation for paid excess becoming noncash client credit; immutable document and compensating reversal.
- Void and rebill: read-only impact review, stale-version rejection, immutable void evidence, new-number sent/locked replacement, original and replacement PDFs/links, preserved work/provenance and independent cash. Absorbed originals correct the current carrier. Another correction to a replacement retains its outgoing link.
- Client-credit refunds: money-return record/PDF with source lot, date/method/reference/reason and availability cap. Returning $350 of held credit leaves $0 with AR unchanged. Returning issued credit moves negative B toward zero. No new fake payment, bank connection or online collection.
- Admin-only write-off create/edit/delete, retainer refund/adjustment, monetary duplicate removal, new correction actions and existing bounced-check actions. Case-insensitive admin/super admin succeeds alone; managers and employees receive HTTP 403 and no writes. Existing financial read/entry permissions remain; no approval or period close.
- Statement correction rows print once, original ages remain for memo-reduced obligations, Account Audit includes signed corrections and Audit Record captures/replays every new table. Interest printing and H2 cutover routing remain unchanged.

The design clarification for different businesses is deliberate: released cash stays at source unless explicitly transferred. Gross billed debt and held funds may both increase; total debt less held funds changes by the corrected charge delta. Both sides are shown in preview and independently reconciled. Correction charge lines are frozen in `rebill_links` and the issue payload; H5 must count these as replacement billings without adding employee work/cost again.

## Migration and account-1 effects

`042.invoice_corrections.sql` creates `credit_memos`, `credit_memo_lines`, `credit_memo_reversals`, `invoice_voids`, `rebill_links`, `client_refunds`, `correction_postings`; adds audit/immutable/scope guards, scoped indexes, expanded frozen statement membership, and receipt conservation including money returned. Applied separately with `psql -X -1 -v ON_ERROR_STOP=1 -f` to ds2_local, ds2_clean and ds2_scenarios. Scenario reset discovers 042 automatically; migration inventory/spec expects 41 files. No original-source backfill, cutover amendment, obligation derivation or account-1 correction is part of H3. Next free migration: 043.

Intended account-1 effect: **zero inserted/updated/deleted financial/source rows, zero new correction rows, zero new audit events**. Final comparison confirms unchanged H3 pre-run digests and the retained reference census, as recorded below. The reference database itself is never accessed.

| Protected table | Retained reference / H3 before / after count |
|---|---:|
| customers | 338 |
| customer_transactions | 39,052 |
| customer_payments | 1,005 |
| customer_writeoffs | 657 |
| customer_invoices | 2,253 |
| timesheet_entries | 28,255 |
| users | 23 |

Additional census: retainers 3, recurring plans 8, quotes 0, jobs 49,555; audit events 139,949. [Before evidence](evidence/run-H3/account1-before.json). Future production steps are in [operations](../platform/operations.md#h3-rollout--corrections-and-adjustment-permissions) and [FINAL_REPORT](../../scripts/review-2026-09/FINAL_REPORT.md); none was executed.

## Routes, screens and implementation

[Complete correction contract](../ledger/invoice-corrections.md) and [README endpoint index](../README.md#h3-endpoint-index-additions) enumerate 15 new routes; 207 total implemented contracts. Existing write-off/retainer-event/duplicate/bounced-check permission changes are also listed. New pages `/billing/credit-memos`, `/payments/credits`, `/payments/refunds`, plus invoice-detail correction/history controls. Existing sidebar links group them with financial work; H6 may finish the planned navigation consolidation. Direct form guards prevent nonadmins from rendering adjustment controls even if a component is mounted separately.

`src/endpoints/corrections/` owns posting/preview/PDF/API behavior. Existing invoice/receipt engines, statement membership, audit queries/replay and PDF templates are extended. Invoice detail now follows replacement/original links on the same route and ignores stale responses. Original PDFs and source rows are never rewritten. API writes use cents, scoped locks, current fingerprints, UUID retry keys and rollback; archived bytes are hash-verified. A reconstructed pre-cutover invoice without safely reversible payment lineage refuses void/rebill; H3 does not invent historical cash allocations. Credit memos use the known original charge cap/open amount. A storage write followed by later DB failure may leave an unreferenced private object, but no committed document metadata, money or audit event.

## Validation

The acceptance runner executes one test process at a time, each integration file individually with its required env. The unit command ran separately and passed 1,194 tests, including 10 migration 042 tests. Final command-by-command results: [validation results](evidence/run-H3/acceptance/validation-results.json); logs are adjacent. Initial failures from fixture URL validation and an unissued-invoice fixture were corrected; the browser found and drove the same-route invoice navigation fix. No coverage was removed.

All **98 required acceptance commands exited 0**. Every accepted test command has **zero failures, skipped or pending tests**; Playwright also has zero flaky tests and zero report errors. Integration files ran individually, with no concurrent test processes. Scenario and clean-room totals overlap integration and are not additional unique tests.

| Command / suite | Final result |
|---|---:|
| Backend unit, including migration specs | 1,194 passed |
| All integration files, each run alone | 3,002 passed across 90 files |
| `npm run -s test:scenarios` | 1,845 passed across 49 files |
| `npm run -s test:cleanroom` | 18 passed |
| Payment-image Lambda pytest | 17 passed |
| Frontend Jest | 325 passed across 56 suites |
| `CI=true npm run build` | Passed |
| Full Playwright through the managed browser, one worker | 160 passed |
| Read-only Create Invoice / Account Audit / AR comparison | Drift 0 across 1,014 client/business comparisons |

H3 adds 10 migration tests, 108 integration/scenario cases across its three files, 24 frontend tests and 17 browser tests. Its final targeted matrix has 78 correction cases; the legacy admin matrix has 13 cases and the financial lifecycle has 17. After the final authority-before-validation guard, the complete unit suite and correction matrix were rerun; after the navigation fix, the complete frontend Jest/build/browser sequence was rerun. No test coverage was removed. [Count rollup](evidence/run-H3/acceptance/suite-counts.json), [exact commands and environments](evidence/run-H3/acceptance/validation-results.json), [Playwright JSON report](evidence/run-H3/acceptance/playwright-results.json).

The final protected-data check at **2026-09-26 15:29:10 UTC** finds **identical counts and sorted whole-row digests across all 12 captured tables**, including the audit ledger. All seven required source counts above match the retained reference census. Every new correction table contains **zero account-1 rows**. The account audit chain verifies **139,949 events**, unchanged from H2. There are **zero H3 account-1 financial/source changes or new audit events**. [After census](evidence/run-H3/account1-after.json), [verification](evidence/run-H3/account1-verification.json), [read-only verifier](evidence/run-H3/verify-protected-data.cjs), [migration application evidence](evidence/run-H3/migration042-evidence.json).

The [drift result](evidence/run-H3/drift.json) retains next-statement / Account Audit totals of **$60,888.50** and billed / AR totals of **$41,015.00**, all in the default business; both other businesses remain zero. Account 1 was inspected read-only and the reference database was never connected. Original remote PDF bytes were not fetched; protected-row verification covers their stored paths and metadata. Synthetic browser downloads independently prove the H3 artifact behavior.

The [source inventory](evidence/run-H3/source-change-manifest.json) records 62 changed or newly inventoried source/test/script files, comparing retained H2 hashes where available without using Git. The PDF evidence records six visually inspected documents in [PDF QA](evidence/run-H3/pdf-qa.json); the final offline graph refresh is recorded in `evidence/run-H3/graphify.log`. Production rollout remains a separate operator action. No owner-only decision is needed to finish this local run.

H3 focused suites cover hand-computed memo/refund/void balances, multiple corrections, absorbed originals, prior memo, legacy cash, cross-business transfer/retention, optional credit statements, and bounced checks. Route matrices hash every table and audit row on refusal, including injected DB/storage faults. UI tests exercise caps/missing reasons, explicit credit confirmation, stale and wrong IDs/businesses, repeat clicks, immutable history and downloads, and admin/manager/employee controls. Jest includes same-route original/replacement navigation and stale-response protection. [Oracles](../scenarios/H3-corrections.md).

Downloaded original, credit memo, memo reversal, void, replacement and refund PDFs are retained under `evidence/run-H3/pdfs/`, with browser screenshots under `evidence/run-H3/ui/`. Visual inspection confirms readable layout, source references, amounts and footers. The replacement shows its new number, preserved original link, the void correction once, released receipt credit and the expected $7.50 payable balance; the unchanged interest line remains present. Graphify processed 533 code files into 2,198 nodes, 3,004 edges, 342 communities and 2,540 Obsidian graph notes using zero model tokens. Docs and workspace MEMORY are mirrored to DS2_Notes after finalization.
