# Accountant review results — September 22, 2026 (Phoenix)

All six reports ran against `ds2_local`, account 1, using `.env.local` and the shared Knex connection helper. Database reads ran in read-only transactions. Production was not contacted. Actual repairs and test fixtures were confined to `ds2_repair_test`. All file changes are confined to this directory.

The complete commands and repair contract are in [README.md](README.md). CSV links below contain the customer-level findings; matching `.summary.json` and `.log` files record the run. Amounts are dollars, with credits stored as negative values. Reported repeated-credit amounts are positive magnitudes for review.

## Sandbox dry-run results

| Script / accountant CSV | Measured result | Eligible automatic changes |
| --- | --- | --- |
| [Same-day statements](out/same-day-duplicate-statements.ds2_local.dry-run.report.csv) | 14 customers / 14 pairs: four in 2026, ten in 2024. | One parent deletion; 13 pairs remain manual. |
| [Bill-day write-offs](out/billday-writeoff-double-credit.ds2_local.dry-run.report.csv) | 61 write-offs totaling **−$26,302.25**, 28 customers, 293 later-statement comparisons. **$8,331.75 supported** repeated credits across 12 customers; **$12,208.00 possible inclusive of supported**, across 15 customers. | Read-only. The additional ambiguous amount is **$3,876.25**. |
| [Parent mirrors](out/mirror-desync.ds2_local.dry-run.report.csv) | Two parents store **$1,563.00** collectively while both latest children store zero and paid. | Two mirror updates. |
| [Job anomalies](out/null-job-transactions.ds2_local.dry-run.report.csv) | 14 transactions / **$674.00**: five NULL jobs, nine foreign-customer job links. | Zero unique same-type candidates. |
| [Positive payment exceptions](out/positive-total-payments-exceptions.ds2_local.dry-run.report.csv) | 14 parents, 33 tagged payment rows. Stored positive totals **+$11,727.00** versus signed tagged payments **−$28,154.50**. | Read-only. |
| [Stale unbilled work](out/stale-unbilled-work.ds2_local.dry-run.report.csv) | 51 active customers, 161 transactions, **$14,829.75**. Ten customers have no newer unbilled billable work. | Read-only. Two rows totaling **$151.25** still have missing-job blockers. |

## Findings and accountant actions

**Same-day parents — confirmed anomaly, confidence 1.00 on the stored rows.** Tomo Buncic's second parent **2016 / INV-2026-00189** has zero charges and beginning balance $1,458, matching first parent 2015's current stored remaining. It has no stamped transactions, payments, write-offs or children and passes the repair guards. First-chain payments are shown separately; do not move them to the duplicate. The throwaway repair removed only 2016.

Robert and Debra Peterson (56), John and Colleen Cappelli (93), and the ten 2024 pairs no longer match the strict current-remaining predicate after payments/history changes. The report identifies likely historical duplicates when the second beginning balance matches the first original due, but leaves them manual. Caroline Hernandez (171) has first remaining $400 versus second beginning balance $24; the second statement's original due is **−$376**, with current remaining zero and paid false. Her same-day write-off repeat must be reviewed together with the duplicate history. The reports do not reconstruct later carry-forward balances. Evidence: `scripts/review-2026-09/same-day-duplicate-statements.js:32`, plus its payment, write-off and dependency CSVs.

**Bill-day write-offs — replay evidence, not a blanket $26,302 adjustment.** Twenty-three write-offs have supported repeat amounts; 33 have possible repeat amounts including those 23. The largest supported customer totals are Jennifer L Smith NMD PLLC **$3,687.75**, Exodus Sales Collective **$1,905.00**, and OPACS **$1,057.50**. Caroline's **$400** is visible on the immediate same-day successor **INV-2026-00184**. Every affected statement number appears in the customer summary and detailed replay.

A key surprise is that an old-gate re-fetch does not necessarily cause a second credit. Job-only write-offs with no matching billed job have no hidden-charge effect; in other histories the saved charges reconcile with exclusion rather than reapplication. For example, Tricia Schafer's $405 and Keith's Landscaping's $1,049.50 do not pass the saved-charge replay for a second credit. Jerry Brown's $20 also has no supported later repeat. Do not equate the original candidate CSV with an adjustment journal.

The display setting was not saved, and transaction stamping discarded fractional dollars. Supported amounts are conditional on the specified engine rules, surviving tags, and the explicit per-row truncation bounds. Confidence is **1.00 in the reported rule comparisons**, but these bounds and missing historical inputs do not establish exact issued-statement allocation. Use the PDFs/source work to settle the $3,876.25 ambiguity and authorize any adjusting entries. The possible column includes supported amounts and must not be added to it. Evidence: `scripts/review-2026-09/billday-writeoff-double-credit.js:75` and `:113`; `src/endpoints/invoice/invoice-service.js:10`; `src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`; `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:22`. [Detailed replay](out/billday-writeoff-double-credit.ds2_local.dry-run.replay.csv) and [statement reconciliation](out/billday-writeoff-double-credit.ds2_local.dry-run.statement_evidence.csv).

**Mirror desynchronization — confirmed, confidence 1.00.** Parent **506** stores $105/unpaid but latest child **2137** stores zero/paid. Parent **2015** stores $1,458/unpaid but child **2143** stores zero/paid. Re-mirroring fixes those parent fields; it does not independently prove the whole customer balance. The repair copies fully-paid date as part of paid state and leaves total payments, charges, due, and all children untouched. Run duplicate analysis/repair first because mirroring Tomo changes the duplicate predicate. Evidence: `scripts/review-2026-09/mirror-desync.js:12`.

**Jobs — confirmed, confidence 1.00.** All 14 rows remain manual on this snapshot. NULL-job transactions contain no structured job-type ID from which to select a same-type job. The foreign-job cases have no candidate under the exact original job-type ID. In particular, “Teleconference” and “Administrative” occur under different type IDs for the two Kimmel customers; matching descriptions alone would silently broaden the repair. The CSV includes the original type and work description for the accountant's selection. Evidence: `scripts/review-2026-09/null-job-transactions.js:12` and `:18`.

**Positive payment totals — confirmed, confidence 1.00 on current tags.** The 14 IDs match the critique: **2, 10, 170, 310, 320, 503, 596, 644, 990, 1585, 1654, 1773, 1855, 1863**. Migration 019's safe normalization excludes these; neither simply negating the stored value nor copying the full-chain sum into snapshots is appropriate. Review the 33 [payment rows](out/positive-total-payments-exceptions.ds2_local.dry-run.payments.csv), especially legacy attribution, before adjusting metadata or balances. Evidence: `scripts/review-2026-09/positive-total-payments-exceptions.js:11`; `migrations/019.ledger_data_normalization.sql`.

**Stale work — confirmed, confidence 1.00 on the query population.** The earlier “ten customers” finding described customers with *no newer work*. The full requested population also includes customers with both old and new unbilled work: 51 customers and $14,829.75. James and Jennifer Blakeslee's two stale NULL-job rows account for the $151.25 blocked by the billing engine's inner job join. That leaves **159 rows / $14,678.50** without that particular blocker. These are gross stored work amounts, not a prediction of final net statements after credits, payments or accountant adjustments. Evidence: `scripts/review-2026-09/stale-unbilled-work.js:9`; `src/endpoints/invoice/invoice-service.js` (`getTransactionsByCustomerID`).

## Repair rehearsal and verification

The specified `CREATE DATABASE ds2_repair_test TEMPLATE ds2_local` failed twice, with more than a minute between attempts, because another session held the template open. No source sessions were terminated. A consistent custom-format logical dump was used instead. The initial plain restore exposed an existing orphan `ai_category_training_examples.timesheet_entry_id = 29099`. To preserve the snapshot, the empty schema/indexes/constraints were restored first, then data with triggers disabled **only in the throwaway database**. The temporary dump file was removed after restoration. The ledger, customer and job table fingerprints matched the source exactly before tests.

The rehearsal committed only these baseline changes:

| Repair | Before | After |
| --- | --- | --- |
| Delete parent 2016 | Empty duplicate, remaining $1,458 | Parent row deleted |
| Mirror parent 506 | Remaining $105, unpaid | Remaining $0, paid; child fully-paid date copied |
| Mirror parent 2015 | Remaining $1,458, unpaid | Remaining $0, paid; child fully-paid date copied |
| Job repair | 14 exceptions, zero unique candidates | No changes |

The `first-apply.*.before.csv` and `.after.csv` files preserve these exact rows. Second applications changed **zero rows**. The database `ds2_repair_test` is retained with the rehearsed repairs; it is not the live sandbox.

[Verification results](out/verification.csv), [verification log](out/verification.log), and [table fingerprints](out/verification-fingerprints.json) document:

- All six dry-runs left customers, jobs, invoices, transactions, payments and write-offs unchanged.
- The sandbox guard rejected attempted apply commands before any write; the production identity guard was tested with a fake connection, without contacting production.
- An injected failure on the second mirror update rolled back the first update too.
- Separate payment, write-off, transaction and child fixtures each prevented duplicate deletion.
- Full-row comparisons limited baseline changes to parent 2016's deletion and the specified mirror fields on 506/2015; every other row in the six checked tables stayed identical.
- A throwaway unique-job fixture proved the repair changes only `customer_job_id`; a second same-type candidate made it refuse the relink. All fixtures were removed.
- Before/after evidence preserves PostgreSQL timestamp microseconds. All three repairs were idempotent.
- Sandbox fingerprints remained unchanged through the rehearsal. No production repair, migration, S3 operation, or application-source edit occurred.

This is targeted script and ledger-repair verification. The repository-wide application tests were not run; other engineers are changing application code. Git status was unavailable because this machine's `/usr/bin/git` exits at the unaccepted Xcode-license check. All filesystem write commands used paths within `scripts/review-2026-09`.
