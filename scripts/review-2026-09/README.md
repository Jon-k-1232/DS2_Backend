# September 2026 ledger review

Run these tools from **DS2_Backend**. They use the repository's Knex through `require('../_db').makeDb`. All tools scope their findings and changes to the firm's `account_id = 1`; the integration-test account is excluded.

```sh
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/same-day-duplicate-statements.js
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/billday-writeoff-double-credit.js
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/mirror-desync.js
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/null-job-transactions.js
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/positive-total-payments-exceptions.js
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_local node scripts/review-2026-09/stale-unbilled-work.js
```

Every tool defaults to a PostgreSQL **READ ONLY, REPEATABLE READ** transaction. It prints tables and writes CSVs and a summary JSON next to the script. Filenames include the script, connected database, mode, and detail type. Repeating the same command replaces those artifacts; archive them before a later review. CSV fields are quoted and spreadsheet formula prefixes are escaped. Logs and CSVs contain customer financial information.

Both environment variables must be set explicitly. This prevents the shared helper's default production connection from being used accidentally. The database name is verified with `current_database()`, not trusted from the environment alone. Unknown flags fail.

Only the duplicate, mirror, and job scripts support `--apply`. Apply always refuses `ds2_local`. It refuses a connected `ds2_prod` unless `--i-know-this-is-prod` is also present; that flag is a technical guard, not authorization to run a production repair. **This review authorizes application only on the throwaway copy.** The other three reports reject `--apply`.

Apply takes table locks with a ten-second timeout, re-runs its analysis under those locks, and performs all writes in one serializable transaction. It prints each full row before and after the change, also writing before/after CSVs. A deleted row's after image is its ID and `DELETED`. A failure rolls back the whole database transaction; a successful summary JSON and normal exit establish completion. Partial console/file output by itself does not establish a committed repair. These are maintenance tools: the locks prevent concurrent ledger writes while the repair runs.

## What each report means

| Tool | Accountant output | Automatic repair |
| --- | --- | --- |
| `same-day-duplicate-statements.js` | Every same-date pair, both parents' beginning balance, charges, due, remaining and paid state; separate full payment/write-off histories and dependency counts; notes when payments went to the first chain. | Deletes only a uniquely identified zero-charge parent whose positive beginning balance exactly matches the other parent's **current stored remaining**, with no stamped transactions, tagged payments/write-offs, child snapshots, or absorption references. More than two parents is manual review. |
| `billday-writeoff-double-credit.js` | Per-customer repeated-credit amounts and statement numbers, plus every later-statement comparison, population, and statement reconciliation evidence. | None. |
| `mirror-desync.js` | Parent remaining/paid state versus latest child, ordered by timestamp then ID. | Copies remaining, paid flag and fully-paid date from that child. Does not copy payment totals: historical child totals are not reliable event sums. Invalid ownership or NULL child balance is manual review. |
| `null-job-transactions.js` | Billable NULL-job rows and all foreign-customer/account job links, description, exact same-type candidates, and most recently created candidate. | Relinks only when exactly one same-`job_type_id` job exists for that customer/account. Multiple candidates remain manual even if one is newer. A NULL job has no recoverable type in the transaction schema, so it is not guessed from prose. |
| `positive-total-payments-exceptions.js` | The parents migration 019 cannot normalize: stored positive totals, signed payment sums, magnitude, reversals and full tagged payment rows. Works before or after migration 019. | None; historical allocation and signed totals need accountant review. |
| `stale-unbilled-work.js` | Active customers' unbilled billable work dated on/before their newest statement: count, amount, oldest date, and missing-job blockers. Identifies the subset with no newer work separately. | None. Amounts are stored work totals before next-statement payments/write-offs; missing-job joins still prevent billing those rows. |

The duplicate predicate is intentionally literal and conservative. A later zero-charge parent's beginning balance may equal the first statement's original due while its current remaining is now zero after payment. That is a likely historical duplicate, but does not pass this automatic repair. Caroline's history also contains a negative issue-time due and a separate write-off problem. Removing a duplicate does not rebuild any later statement that already carried its balance forward. Accountants must reconcile those downstream statements separately. Run duplicate analysis before mirror repair: mirroring changes the values used by the strict duplicate predicate.

## Write-off replay and limits

`billday-writeoffs-population.csv` is a copy of the supplied 61-row review population. The script uses those IDs and validates the live bill-day match; it does not assume that every row was credited twice. Monetary arithmetic uses integer cents. Timestamp comparisons happen in PostgreSQL, preserving microseconds and the database's timestamp-without-time-zone convention.

For every subsequent parent, the replay selects the most recent prior parent by the engine's invoice-date/timestamp/ID ordering among parents already created at that point. It compares the old `writeoff.created_at >= previous.invoice_date` gate with the new `writeoff.created_at > previous.created_at` gate. It also applies the current-chain single-count rule. With write-offs shown, eligible credits go to the statement's write-off total; with write-offs hidden, job-level credits reduce charges only if that statement has stamped work for the same job. Both rules are replayed; no historical display choice is invented.

The saved `total_write_offs` and `total_charges` constrain which display modes could have produced a statement. Finalization damaged historical transaction cents, so charge reconciliation permits less than $1 of lost fractions per billable transaction, and less than $1 of issue-total rounding/truncation (a conservative allowance). A zero-work statement must reconcile exactly. Negative charge rows widen the lower bound to the same per-row allowance. The evidence CSV prints both model residuals and the row count so this assumption is reviewable.

**Supported** means the first statement supports inclusion, the old-rule later statement reconciles within those bounds, and the new-rule model does not. **Possible** includes supported amounts plus ambiguous/unreconciled cases. These columns overlap; do not add them together. Zero means no repeat is supported by this replay, not that every dollar in the customer's history is certified correct. This uses surviving tags and the specified engine rules, not an archived engine version or issued PDF. Missing display settings, modified history, grouped totals and damaged cents prevent definitive allocation in some cases. Verify PDFs/source work before posting any correcting entry. No automatic write-off adjustment is provided.

## Order before the next month-end

1. Save all six dry-run reports before changing data. Review duplicate histories, first-chain payments, and the write-off replay together; avoid correcting the same dollars twice.
2. Rehearse the permitted repairs on a fresh throwaway database. Run duplicate repair before mirror repair, then the job repair. Re-run each to establish idempotence. Review the exact before/after rows.
3. Resolve the remaining job targets with the accountant. Identical descriptions under different job-type IDs do not automatically establish equivalent jobs. The scripts do not create jobs or infer types for NULL links.
4. Review the 14 payment-total exceptions and reconcile historical payment attribution. Migration 019 and these reports do not authorize balance changes.
5. Run all reports again after separately authorized actual repairs. Confirm the stale-work list and missing-job blockers before preparing next-month statements. Have the accountant review draft statements and the affected carry-forward balances before finalization.

Create the rehearsal database as instructed (retry after a minute if the source is busy):

```sh
PGPASSWORD=ds2local psql -h 127.0.0.1 -p 5433 -U ds2 -d postgres -c "CREATE DATABASE ds2_repair_test TEMPLATE ds2_local"
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_repair_test node scripts/review-2026-09/same-day-duplicate-statements.js --apply
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_repair_test node scripts/review-2026-09/mirror-desync.js --apply
DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_repair_test node scripts/review-2026-09/null-job-transactions.js --apply
```

The template was busy during this rehearsal; the consistent logical-copy fallback and the legacy constraint issue are documented in the report.

See [REPORT.md](REPORT.md) for the measured sandbox findings, rehearsal results and limitations. The checked-in scripts do not run migrations, finalize invoices, change stored files, or connect to S3.
