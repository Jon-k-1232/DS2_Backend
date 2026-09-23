# Is DS2's billing model industry standard? (assessment, 2026-09-22)

## What DS2 does today
- **Balance-forward monthly statements.** Each month the firm runs "Create Invoice"; every selected customer gets one new parent statement whose beginning balance is the prior remaining balance, plus the period's charges, less credits. The newest statement's remaining balance *is* the customer's debt. Older statements are zeroed ("absorbed").
- **Payments are applied to the statement chain**, not to individual charges. A payment creates a snapshot row on the current chain and lowers its remaining balance.
- **Write-offs** come in two kinds: job-level write-downs (WIP adjustments folded into the charges before billing) and invoice-linked credits.
- **Retainers/prepayments** are held per customer and drawn when work is entered against them (each draw creates a payment).
- **AR aging** is computed from the newest statement's date.

## How that compares with practice-management systems used by CPA firms
Balance-forward statements are a legitimate and common presentation for small and mid-size CPA firms (QuickBooks statements, Practice CS "statement" billing, most legal/accounting time-and-billing packages offer it). What established systems do differently underneath is worth knowing:

| Area | Common practice | DS2 today | Gap / recommendation |
|---|---|---|---|
| Ledger model | Open-item ledger underneath; statements are a *presentation* of open invoices + unapplied receipts | Statement chain *is* the ledger; the roll-forward mutates the prior rows | Acceptable for one small firm, but fragile. Keep the presentation, but stop mutating history: (done) absorption is now recorded explicitly and finalize is atomic. Longer term, store statement membership per charge/credit instead of relying on `created_at` gates. |
| Payment application | Receipts are applied to specific invoices/charges, with an "unapplied cash" bucket | Receipts reduce the current chain only; excess becomes a prepayment retainer | Adequate. The overpayment→prepayment split is a reasonable stand-in for unapplied cash. Keep receipts strictly on the current chain (now enforced for write-offs too). |
| Credits | Credit memos carry forward as negative open items | Negative balances are dropped from the next statement (0 live cases today) | Add credit carry-forward or an explicit credit-memo record before it ever matters. |
| AR aging | Ages **charges** by original invoice date (0–30/31–60/61–90/90+) regardless of when statements are issued | Ages the whole rolling balance from the newest statement date, so a re-issued statement resets everyone to "current" | This is the most material standards gap for a CPA firm: it hides delinquency. The AR page now also exposes the oldest open charge date as a hint; a true fix needs payment allocation to charges (open-item) or a carried aging-bucket ledger. |
| Period close | A hard close: after month-end, prior periods are locked; corrections are dated in the open period as adjustments | Billed rows are immutable per row, but there is no period lock; Billing Review can edit billed transactions | Add a "close period" flag that blocks edits/deletes dated in a closed period and forces adjustments (the cascade edit now writes an adjustment snapshot instead of rewriting history). |
| Idempotent billing runs | A statement run is a job with a unique run id; re-running is a no-op or an explicit re-issue | Was: re-clicking Finalize double-billed | Fixed (same-day guard + explicit re-bill flag + account lock + stale-ledger check). Consider a persisted `billing_runs` table for auditability. |
| WIP / unbilled | WIP reports by client, aged, with realization (billed ÷ standard) | WIP aging page exists; realization reporting partially via job write-downs | Fix the `time` casing (done) and add realization % per client/job type. |
| Trust/retainer accounting | Retainers tracked as a liability with explicit draws and refunds | Retainer chain snapshots + payment per draw | Functional, but the balance must never be re-applied at billing (fixed). Add a refund flow. |
| Audit trail | Every posting has who/when/why; voids instead of deletes | Deletes are common (payments, invoices); snapshots give a partial trail | Prefer voids/reversals over deletes for anything that ever appeared on a statement; keep `ai_reviewer_corrections`-style logs for manual edits. |
| Time capture | 0.1 h (6-minute) increments are standard; entries validated against the period | 6-minute rounding on manual entry; tracker validation had gaps | Validation gaps fixed (negative/zero durations, dates outside the window, non-work rows, duplicate uploads). |

## Bottom line
The **statement-cycle timing is fine**: billing once a month, with the statement showing beginning balance, new charges, payments received and balance due is exactly what clients of a tax/accounting firm expect. What was *not* standard was the bookkeeping underneath it (mutable history, date-based gates, non-atomic runs, integer truncation), and most of that is now fixed. The two remaining design gaps to plan for are **charge-level AR aging** and a **period lock with adjustment-only corrections**.
