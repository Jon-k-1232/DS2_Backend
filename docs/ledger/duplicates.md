# Possible duplicates

Owner decision 4 is implemented by `duplicates/duplicates-service.js`, `duplicates-router.js`, migration 024, common grid badges and frontend `/transactions/possibleDuplicates`. All four routes require authenticated Manager/Admin/Super Admin/Owner, exact session account, session actor and a reason for mutations. They never provide an invoice unlock.

| Route | Inputs and result |
|---|---|
| GET `/duplicates/:accountID/:userID` | Optional `customerId`, `status=open` (default) or `all`. Returns `duplicates` with current candidate/original rows, original detection snapshots, status/reason, owning invoice lock/ID and chronological history. Missing source is explicit. |
| POST `/duplicates/:accountID/:userID` | `{kind, recordId, canonicalId?, reason}`; kinds transaction/payment/writeoff/retainer. IDs positive int32. Both rows must belong to account and same customer; retainer snapshots are refused. A manual flag need not satisfy the automatic matching rule. Returns `duplicate`. |
| POST `/duplicates/scan/:accountID/:userID` | `{customerId?, reason}`. Scans the selected customer or account, holding customer locks in ID order. Returns number `created` and message; records scan reason/actor even with zero new matches. |
| POST `/duplicates/:duplicateID/resolve/:accountID/:userID` | `{action:'dismiss'|'remove', reason}`. Dismiss records not-a-duplicate without changing money. Remove uses existing atomic deletion cores and saves affected ledger before/after. Returns updated `duplicate` and message. |

Reasons are trimmed strings of 1–2000 characters. Actual HTTP statuses: 400 invalid kind/IDs/self-reference/filters/action/reason/customer mismatch; 401/403 auth/role/account; 404 missing/foreign customer/source/flag; 409 already reviewed pair, repeated resolution, sent record, source changed since flagging, or linked/dependent deletion refusal; 500 database failure. All mutation/evidence writes roll back together. These routes use no object storage. The row ID to delete is always stored in the flag, never supplied at resolution time.

Automatic detection runs inside each manual create route transaction. Same account/customer/kind, identical signed stored cent amount and calendar dates within three days are necessary. Additional normalized evidence (trim, collapse whitespace, lowercase) is required:

| Kind | Additional evidence |
|---|---|
| Work | Same type, job, employee, work-description ID, quantity, unit cost, billability and nonblank detailed description. |
| Payment | Nonblank matching reference and same method. Excludes retainer-funded payments, reversals and pending-import markers. |
| Write-off | Same type, job and nonblank write-off reason. |
| Retainer receipt | Root only, same hold type and nonblank reference+method; if neither has a reference, nonblank matching display name. Generated overpayment/cancelled roots and snapshots excluded. Manually held prepayments remain eligible. |

Review scan uses the same rule. Known tracker-generated work linked by a non-null timesheet-entry ID in `ai_category_training_examples` is excluded. Legacy rows without reliable provenance can be advisory candidates. Blank evidence, equal amount/date alone, another customer/account and later dates do not match. A possible match alone never rejects a valid entry or removes it automatically; a failure to save its evidence rolls back the new entry. The pair index is symmetric and includes resolved flags; repeating a scan does not reopen a dismissed pair. An explicit manual flag can reopen a resolved review when the candidate has changed, replacing its detection snapshots while appending new immutable history; unchanged resolved pairs still return 409. Automatic scans never reopen either case.

Common grids display a **Possible duplicate** badge linking to the review. The list shows both records and their amounts/dates/references, current state and audit history. Supply a reason to scan/flag/dismiss, or choose Remove duplicate then Confirm removal. The UI disables removal for known sent/missing sources; the server rechecks under the customer lock. Removal closes other open pair flags involving the removed source atomically. History retains detection snapshots and ledger before/after evidence; its rows are DB-protected against update/delete.

Sent duplicates return 409 naming the invoice. Open invoice history to inspect supported exceptions; the current bounced-check workflow only reverses selected eligible payments. It cannot delete duplicate work/retainers/write-offs or act as a generic unlock. Original PDFs never change. New correcting workflows require a separate owner decision; unsupported locked removal is explicitly refused.

Balances do not change on detection, flag, scan or dismissal. Removal adjusts job totals, invoice snapshots, payments and retainer draws using their existing dependency/ordering rules. See [hand oracle and route tests](../scenarios/10-owner-retainers-duplicates.md) and the [design record](../decisions/2026-09-24-owner-decisions.md).

A source edited since detection cannot be removed by that old flag. Dismiss it and create a fresh manual review against the current entry. This prevents stale confirmation from deleting changed money.

## Owner run 3

Credit statements lock at finalize exactly like debit statements; duplicate flags never unlock them. Scenario16 removes duplicate unissued work while preserving issued evidence, then continues through bounced-check reversal, refund and optional credit issuance. See the [owner decisions](../decisions/2026-09-24-owner-decisions.md) and [combined scenario](../scenarios/16-owner-combined.md).


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.
