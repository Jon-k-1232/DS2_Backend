# Receive payment, obligations and held credit (H2)

**H6 navigation:** Payments & Credits → Receive payment and Payment receipts: `/payments/receive`, `/payments/receipts`, `/:receiptId`. Client receipt tabs retain selected client/business context. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

Receive payment is at `/payments/receive`; receipt history and detail are `/payments/receipts` and `/payments/receipts/:receiptId`. Choose the client and billing business, enter the check/cash once, review original invoices oldest first, and confirm. A receipt is gross cash received; individual applications are reductions of debt. The remaining amount is held receipt credit for that same business. It is automatically proposed at the next invoice and posted only at finalization. No bank, collection or online-payment integration exists.

## Ledger rules

`ar_obligations` records only newly issued net charges, never the statement's brought-forward amount. Original invoice date controls age even after absorption into a later statement. `ar_obligation_carriers` identifies the live balance-forward statement to receive later applications and reversals. Original issued rows and artifacts remain immutable. Existing child snapshots and absorption markers remain authoritative for the billing engine; application postings reconcile the new subledger to those snapshots.

For each business, `B = remaining obligations - available issued statement credit`; `N = B + eligible unbilled work + signed pending adjustments`. Held receipt credit and retainers are separate from B. Invoice preview and Account Audit show raw N, proposed automatic credit use, and proposed payable total separately. Applying a held receipt credit reduces B once. Applying already-issued statement credit reduces both its credit balance and the obligation, without another reduction of B. No aging bucket contains negative credit.

All amounts are integer cents in calculations and fixed-decimal SQL amounts. A line must be positive and no more than its obligation's remaining balance; total lines cannot exceed receipt gross. A changed FIFO allocation requires a reason. Dates cannot be future or precede the target obligation. Prepayments can stay held without an invoice. A UUID `Idempotency-Key` makes a repeated identical request return its committed response. Reusing the key for changed input conflicts. Account then customer locks and a financial fingerprint prevent concurrent over-application and stale submissions. Every refusal rolls back the receipt, applications, snapshots, credits and audit events together.

`payment_receipts`, `ar_applications`, credit lots/events, receipt events, derivation manifests and carrier links are append-only and audited. Session actor/reason are set transactionally. Legacy derivation runs as system with its source and reason. New finalized obligations retain gross charge and net adjustment components separately.

## API contracts (all scoped to the authenticated account)

The payments and credit mounts require the existing manager/admin billing access. `requireAdmin` limits corrections/transfers to case-insensitive admin and super admin, with no second approver.

| Method/path | Inputs and result | Permission |
|---|---|---|
| GET `/payments/open-obligations` | Required `customerId,entityId`; optional `asOf,recordedThrough`. Original invoice dates, remaining cents, carriers, credits and `ledgerFingerprint`. | Manager/admin |
| GET `/payments/receipts` | Optional client/business, page/limit; receipt headers and count. | Manager/admin |
| POST `/payments/receipts` | `customerId,entityId,amount,date,method,reference,allocations:[{obligationId,amount}],ledgerFingerprint`; optional allocation `reason`, duplicate acknowledgement `duplicateReason`; UUID header. Returns header, applications, excess credit. | Manager/admin |
| GET `/payments/receipts/:receiptID` | Header, all direct and downstream credit applications, finalization flags, remaining credit per business, events, fingerprint. | Manager/admin |
| POST `/payments/receipts/:receiptID/applications/:applicationID/correct` | Same positive application amount, new `obligationId`, reason/date/fingerprint and UUID. Append exact reversal/replacement before finalization. | Admin |
| POST `/payments/receipts/:receiptID/cancellations` | Reason/fingerprint and UUID. Cancel a complete unissued mistaken receipt; cannot cancel finalized applications or an existing NSF exception. Re-enter corrected cash separately. | Admin |
| POST `/payments/receipts/:receiptID/exceptions` | `condition:bounced_check`, reason/fingerprint and UUID. Flags the entire check and all affected issued statements. | Admin |
| POST `/payments/receipts/:receiptID/reversals` | Reason/date/fingerprint and UUID. Entire flagged receipt only; no amount/application subset accepted. | Admin |
| POST `/payments/receipts/:receiptID/resolve` | `action:revision|roll_forward`, reason/fingerprint and UUID after reversal. | Admin |
| GET `/credits` | `customerId,entityId`, optional historical cutoffs. Lots, available cents and fingerprint. | Manager/admin |
| GET `/credits/transfers` | Read-only receipt-credit transfer history, names, reasons and origin receipt. | Manager/admin |
| POST `/credits/transfers` | Client, source/destination businesses, `creditId,amount,reason,ledgerFingerprint`, UUID. Unused held receipt credit only. Paired source debit and destination lot preserve original cash lineage. | Admin |

Validation returns HTTP 400; missing or cross-client/business records 404; role refusal 403; stale, locked or conflicting state 409; database or storage failure 500. These routes do not use the legacy HTTP 200-with-error-body convention. Legacy edit/delete/reverse endpoints return HTTP 409 for new receipt-backed applications, with the receipt number and correction guidance.

## Corrections and duplicates

A single unissued application can be moved to another original invoice in the same client/business with its amount preserved. Correcting receipt gross uses cancellation then a replacement receipt; headers are never edited. Finalized applications cannot be edited. Payment tabs link receipt-backed entries to this correction screen. Old unissued single-payment/retainer editors remain supported for true compatibility records.

Duplicate review compares receipt-level client/business/date/method/reference/amount, not allocation rows. A possible duplicate blocks entry until a specific reason is supplied; acknowledgement and duplicate flags are retained. Review never deletes immutable cash: cancel an unissued erroneous receipt or follow the issued correction rules. Flag/dismiss permissions remain unchanged; H3 owns the broader retrofit of existing adjustment/removal controls.

A bounced check restores every application on the current carrier and cancels remaining credit, including traceable credit transferred to other businesses or used on later statements. A refund dependency blocks the entire reversal. Partial reversal is never accepted. Artifact resolution is a separate transaction after reversal: storage failure leaves the reversed receipt visibly unresolved and retryable. An unissued cash-entry cancellation does not manufacture an NSF claim.

## Compatibility boundary and legacy reconstruction

The old single-payment, explicit-retainer and payment-image approval entry points retain their existing interfaces and retainer excess handling. Their debt applications synchronize to obligations once that scope is derived. H2 does not migrate those forms/imports to the new multi-invoice receipt request; they remain labeled legacy sources. This is a deliberate compatibility exception to the initial H0 “new cash only here” contract. H5 must use source kinds and links rather than treat every negative payment as new cash. New Receive payment cash uses only the new receipt header and held-credit path. Existing retainer deposits/draws/refunds are not duplicated into spendable credit lots.

`scripts/derive-legacy-obligations.js` plans and applies immutable manifests, using the corrected default opening business. It walks incremental original charge components; exact independent-invoice payment links take precedence, and remaining reductions use a disclosed FIFO estimate. It reconciles to opening B without invented cash. Unsupported residual debt uses the oldest verifiable date, or an explicit unknown-age bucket. Negative opening B becomes issued statement credit. Standalone legacy payment rows become individual derived headers; equal check references are not guessed into a group. Original cash-deposit retainer roots get descriptive derived headers and retain their balances. Destination roots created by noncash transfers do not create another receipt. Derived headers direct corrections to their source workflow.

Historical reports carry both effective `asOf` and recorded `recordedThrough` UTC cutoffs. Default recorded cutoffs use the database clock. A report before derivation uses retained source evidence and is labeled reconstructed; it does not pretend the original historical allocations were known exactly. See [H2 hand oracles](../scenarios/H2-receipts-and-aging.md), [cutover correction](../platform/billing-entities.md) and [operations](../platform/operations.md).

H3 implementation note: migration 040 currently conserves each receipt as net direct applications plus available origin-linked held credit (zero after full reversal). H3's refund/disposition migration must explicitly include returned money in that conservation equation before exposing refunds; decrementing a lot alone must continue to fail. The existing receipt reversal guard already refuses a linked refund dependency.

Receipt duplicate reviews show the gross check amount, date and reference. Their Open receipt action leads to the admin correction/cancellation workflow; the generic Remove duplicate action is disabled for immutable receipts. Flagging and dismissing a review do not change money.


## H3 update — 2026-09-26

Receipt conservation now includes money returned: applied + available + refunded = received. Refunds of held cash have no AR effect. Refunds of issued statement credit move signed B toward zero. Complete bounce refuses if source funds were refunded; refund refuses during a pending bounce. Void/rebill traces reversal/reapplication without new cash.

[Correction contracts](../ledger/invoice-corrections.md) and [H3 results](../decisions/2026-09-26-run-H3-results.md).

## H5 reporting of cash and applications

Billing Performance combines manual receipt headers with source-labeled compatibility payments/retainers without counting derived headers, transfers or draws again as deposits. Collected means receipt-backed applications; held cash is reported separately until applied. Noncash memo/retainer adjustments and refunds remain distinct. Original-date AR reconciliation is independent of analytics and is used in the year-end packet at matching cutoffs. [Definitions](../invoicing/analytics.md#4-definitions-and-reconciliation).

## H7 boundary verification

Receipt and allocation IDs accept scalar numeric IDs, not arrays. Null/scalar allocation rows return 400. An application correction date must be on/after the original receipt, original application and target obligation. Retry keys identify the URL receipt/application as well as the submitted body; another target returns 409, while an exact historical retry returns the saved response. No saved request is rewritten. Dates and historical UTC cutoffs reject unsupported year zero; cutoffs also reject impossible calendar/clock components before SQL and retain up to six fractional digits. Valid year one and leap-day timestamps remain accepted. See [H7 matrix](../scenarios/round2-path-matrix.md) and [combined cash/credit/bounce oracle](../scenarios/H7-combined-lifecycle.md).

## H10 reporting reads

AR batches obligation/application/carrier and credit-lot/event reads across the requested clients. It retains the same historical/recorded cutoffs and original legacy-opening reconstruction, including absorbed-only refusal. The report does not generate unused command fingerprints. Receive payment, correction and finalize paths retain their full fingerprints and locking readers; no cash, credit, obligation, allocation or audit event is cached or rewritten. Original-reader equality and independent engine/Audit/AR drift remain required. [H10 oracle](../scenarios/H10-batched-calculations.md).

## H8 receipt detail and response-loss checks

Receipt application reads include the original `invoice_number` and `original_invoice_id` through account-qualified joins; the page displays the invoice number or **Historical opening balance**, with internal IDs only in a tooltip. Correction controls appear only when both receipt and open-invoice reads succeed. Route changes invalidate older reads; a load failure clears stale controls and offers **Refresh receipt**.

Browser tests prove that network/server failures preserve entered amounts and references, and that losing a successful response then retrying the same unmodified request returns the original receipt without another cash or audit entry. Existing request-key, fingerprint, complete-bounce and admin-only rules are unchanged.

Receive payment labels carried debt as being on a later statement while retaining the original invoice number and date. The internal carrying-statement key is available in a tooltip, not presented as the invoice’s document number. Allocation values, dates and request keys are unchanged.
