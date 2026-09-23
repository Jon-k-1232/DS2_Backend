# Migration 019 manifest — 2026-09-22 production snapshot

Review package behind the `_m019_reviewed` block shipped in
`migrations/019.ledger_data_normalization.sql` (between the
`-- accountant-reviewed rows go here` and `-- end of accountant-reviewed rows` markers).

## Provenance

- Source data: `pg_dump` of `ds2_prod` taken 2026-09-22, restored locally as `ds2_ref_20260922`
  (Docker Postgres 17 on 127.0.0.1:5433). Production itself was only ever read.
- Generated 2026-09-23 with the read-only generator, then copied here unchanged:
  ```sh
  DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_ref_20260922 node scripts/review-2026-09/positive-total-payments-manifest.js
  DS2_ENV_FILE=.env.local DATABASE_NAME=ds2_ref_20260922 node scripts/review-2026-09/positive-total-payments-exceptions.js
  ```

## Files

| File | What it is |
| --- | --- |
| `positive-total-payments-manifest.review.csv` | One row per parent invoice in the manifest (904): customer, invoice number, stored positive total, signed net, tagged payment ids, dates and amounts, `possible_misattributed_reversal` flag. |
| `positive-total-payments-manifest.generated.sql` | The generator's own INSERT block, byte-for-byte as produced (the migration carries the same 904 rows plus a provenance comment). |
| `positive-total-payments-manifest.summary.json` | 904 candidates, 0 flagged. |
| `positive-total-payments-exceptions.report.csv` | The 14 positive parents migration 019 does **not** touch: stored total is not the magnitude of the tagged payments (stored 11,727.00 vs tagged net -28,154.50). These need historical payment-attribution review by the accountant. |
| `positive-total-payments-exceptions.payments.csv` | The 33 payment rows tagged to those 14 parents. |
| `positive-total-payments-exceptions.summary.json` | Totals for the exception list. |

## Decision (2026-09-23)

Decisions were delegated to the reviewer by the owner. The 904 rows were adopted because for
each of them the flip is a representation change only: under the current code
`customer_invoices.total_payments` means "signed net of the payments tagged to this chain", and
for every row the tagged payments are all negative, have no reversal anywhere on the account, are
all owned by the invoice's own customer, and sum to exactly the magnitude the legacy code stored.
No amount changes hands and no balance moves; whether a payment was tagged to the right chain of
the same customer is a separate question (`scripts/repair-mistagged-payments.js`) that the sign
neither creates nor resolves. The 14 exceptions were left alone because their stored totals are
not explained by their tagged payments at all.

Migration 019 re-verifies every row against live data when it runs and silently skips a row
whose owner, stored total, signed net or payment-id set has drifted since this snapshot, or that
has acquired a `[reversal of payment #id]` note anywhere on the account naming one of its payments
(added after Astra's round-7 review, which reproduced that drift shape on a clone); the skipped
rows stay on the `019-review` list in `ledger_normalization_log`.

**What does change visibly.** "Balance neutral" is not "output identical": for each adopted
statement the stored Total Payments field shows the signed value (root 4: 425.00 -> -425.00) in
the invoice details page, the invoice / customer-profile / outstanding-invoice grids and the API,
consistent with statements created since June 2026. Remaining balances, payments, write-offs,
PDFs, Accounts Receivable, Account Audit balances and analytics are unchanged (verified by the
before/after three-view drift check and a full 2,253-row invoice comparison on the clone).
`billingReview/cascadeEdit.js` still exports a deprecated `_recomputeInvoiceTotals` that would
read this column into a remaining balance; it has no production caller and must not be used as a
reconciliation step.

**Regenerating for a newer snapshot** needs a new documented decision, not a mechanical replace:
the generator only flags `possible_misattributed_reversal` rows (it still emits them into its
INSERT block), so strike or first resolve every flagged row, re-check the criteria above, and
record the decision in a new `manifest-<date>/README.md`.

## Rehearsal evidence

Against `ds2_m019_rehearsal` (a `CREATE DATABASE ... TEMPLATE ds2_ref_20260922` clone), the
documented BEGIN / file / audit SELECT / ROLLBACK rehearsal from `migrations/README.md`
reported 904 APPLIED and 0 SKIPPED, 14 parents still positive on the review list, 5,130
`time` -> `Time` casing fixes, 33,129 literal-`null` transaction notes and 1 payment note
cleared; after ROLLBACK the clone still held all 918 positive parents. The committing run on the
same clone and the before/after three-view drift check are recorded in
`scripts/review-2026-09/FINAL_REPORT.md`.
