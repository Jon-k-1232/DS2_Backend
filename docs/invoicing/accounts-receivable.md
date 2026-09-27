# Accounts receivable and true aging

**H6 navigation:** Receivables → Accounts receivable: `/receivables/aging`. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

H2 replaces statement-age buckets with remaining original obligations. Rolling statements still carry balances forward, but a newer statement never resets the debt's age. The UI is `/receivables/aging` with alias `/receivables/aging`. It supports business/search/age filters, sorting, paging, effective date, recorded cutoff and CSV export. Page totals cover the displayed page.

## API and access

Authenticated manager/admin billing access, with URL account matching the session. GET `/accountsReceivable/aging/:accountID/:userID` returns `{arAging:{customers,entityTotals,pagination,searchTerm,asOf,recordedThrough},status:200}`. GET the same path plus `/export` returns CSV. Both use the same report service and filters. Invalid dates/cutoffs or pagination return400; missing login401; role/tenant403; database failure500. Every report is read-only.

| Query | Contract |
|---|---|
| `entityId` | One same-account business, or all businesses. No cross-business netting. |
| `asOf` | Valid YYYY-MM-DD effective date, default Phoenix today; no future report date. |
| `recordedThrough` | UTC timestamp with Z, default database clock. Restricts what was recorded by that instant. Retain both returned cutoffs to reproduce the report. |
| `page,limit` | Defaults1/50; existing pagination validation/cap500. CSV uses first10,000 matched rows. |
| `search` | Case-insensitive substring of business/customer/display name or client ID. |
| `filter` | `30,60,90,over_90,unknown` selects clients with positive remaining obligations in that bucket. |
| `sort,direction` | Names, business, bucket amounts, issued/unapplied credit, signed billed balance, payment/work indicators and age/date fields; directionasc/desc. Stable client/business tie-breaks; null ages last. |

## Money and dates

Each obligation retains its original invoice date, newly issued net charge amount and current carrying statement. Age is whole calendar days from original obligation date to `asOf`:0–30,31–60,61–90,over90. Unknown legacy dates have a separate bucket. Applications and exact reversals are filtered by both effective date and recorded timestamp. Not-yet-effective charges are excluded.

`total_outstanding = gross remaining obligations - available issued statement credit`. Held receipt credit is separate: it has not reduced billed debt yet. Negative billed credit shows **Credit — no payment due**, and remains outside positive debt buckets. `oldest_days` and `oldest_open_charge_days` now both describe the oldest unpaid original obligation. Last-statement metadata is displayed separately and does not set the buckets. Unbilled work remains outside AR; raw next-statementN also includes eligible work and pending adjustments.

The response exposes `bucket_0_30,bucket_31_60,bucket_61_90,bucket_over_90,bucket_unknown,gross_obligations,statement_credit,unapplied_credit,total_outstanding,aging_basis,reconstructed`, business/client keys and original-date fields. Legacy reconstruction is explicitly labeled. The CSV carries identical money, business, cutoffs and basis, uses RFC4180 escaping and formula-injection protection, and labels age **Days Since Oldest Obligation**.

Aging data comes from `payments/receipt-ledger.js` and `accountsReceivable/obligation-aging.js`. Before a scope's derivation, retained legacy sources supply an explicitly estimated reconstruction. After derivation, immutable obligations/applications/credit events supply it directly. Original balance-forward chain queries still supply statement/payment/work metadata and independent reconciliation. The engine, Account Audit and AR retain zero billed-balance drift.

See [receipt/credit rules](../ledger/receipts-and-obligations.md), [H2 hand-computed ages](../scenarios/H2-receipts-and-aging.md) and [results](../decisions/2026-09-26-run-H2-results.md). Historical scenario assertions that treated all carried debt as current were replaced with signed-balance conservation plus explicit original-date boundary and two-rollover oracles.


## H3 update — 2026-09-26

Credit memos apply to original obligations without resetting their dates. Voiding removes the corrected original new charges and creates a replacement obligation at its issue date. Receipt refunds reduce held funds only; issued-credit refunds move negative B toward zero. Existing historical effective/recorded cutoffs still apply.

[Correction contracts](../ledger/invoice-corrections.md) and [H3 results](../decisions/2026-09-26-run-H3-results.md).

## H4 recurring fees

Prepared recurring Charges enter unbilled work by business; finalized fees use the existing H2 obligation/rolling statement rules. No new aging algorithm or debt reset is introduced. The Create Invoice preparation step and reasoned skips are documented in [recurring billing](../work/recurring-billing.md).

## H10 reporting projection

AR reads derivations, original obligations, applications, carriers and credits in batches per business within its existing repeatable-read snapshot. Unconverted empty clients use batched legacy sources; nonempty legacy chains retain the existing absorption/inconsistency validation. Effective-date and recorded-through boundaries, original ages, FIFO reconstruction, negative issued credit and held receipt credit are unchanged.

The projection does not compute mutation fingerprints that AR never returns. Receive payment and correction commands still use the original full fingerprint reader, including all financial tables. Audit remains independently calculated from raw ledger rows; AR does not take its answer from the invoice engine. All clients/businesses at current and historical cutoffs have exact ordered-report equivalence. [H10 evidence](../decisions/2026-09-26-run-H10-results.md).

## H8 presentation

The columns **Our business** and **Client company** distinguish issuer and client. The saved-through input is under the initially collapsed **Advanced: reproduce an earlier report** control, labeled **Include records saved through**; it still submits the exact `recordedThrough` timestamp with the report and export. A small **Estimated** badge identifies the client/business row whose historical balances were reconstructed. It does not imply that a known-age amount belongs in Unknown age. Its tooltip explains the distinction. Zero page totals use normal text. The table scrolls horizontally within its container to preserve readable headers and amounts at 1280px. Filters with no matches explain how to recover. A failed report cannot be exported as though its data were current.
