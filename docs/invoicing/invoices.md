# Invoice register, immutable statements and exceptions

Revision packaging: each revision ZIP contains its clearly marked correction PDF **and the exact unchanged original PDF**. Reprint/resend both together; this preserves full original itemization for modern and historical invoices. Missing/corrupt original archives fail before resolution commits.

See the [owner decision record](../decisions/2026-09-24-owner-decisions.md) for the five-decision contract. This guide describes run 1, decisions 3 and 5.

## 1. Screens and issuance

Month-end **finalize commits issuance**. DS2 has no separate emailed/mailed status, so this is the precise meaning of **Sent — locked**; it does not assert delivery. Draft previews are not issued. The register at `/invoices/invoices` and protected ledger rows display the lock and invoice number. Edit/delete/reversal forms direct the operator to the owning invoice's history.

**Owner confirmation (2026-09-25):** drafts stay editable; finalizing an invoice is the same as sending it, so a finalized invoice and its transactions, payments, write-offs and retainers are locked. See the [decision record](../decisions/2026-09-24-owner-decisions.md#shared-rules-and-issuance-boundary).

Details at `/invoices/invoices/invoiceDetail/*` show original totals and frozen Transactions, Payments, Write-offs, Retainers and Beginning Balance inputs, alongside `current_remaining_balance` from the newest child. Original issued values never become a current-balance cache. For example, an issued $500 parent remains $500 after a new $100 receipt; current balance is $400. Once the next statement includes that receipt, it too becomes locked.

The history panel provides a required condition/reason/payment selection, Record exception, Reverse selected payments, then Issue revision for reprint/resend or Roll into next invoice. An uncorrected flag can be cancelled. Archived versions and actor/time/reason/record/balance history remain visible. The original downloader and each revision download fetch archived bytes. Delivery is an operator action.

## 2. Access rules

All invoice routes require an active authenticated user with role manager, admin, super admin or owner and an account matching the session. No cross-tenant administrator bypass exists. The actor is the session user, never the `userID` route argument. Shared authentication/authorization failures are HTTP 401/403; the API limiter may return 429. Unexpected errors are 500.

## 3. API reference

| Method and path | Request | Response and refusals |
|---|---|---|
| GET `/invoices/getInvoices/:accountID/:invoiceID` | Final segment retained for compatibility, unused as a filter | `activeInvoiceData:{activeInvoices,grid,treeGrid}`, message/status. Account parent and child rows, lock metadata. |
| GET `/invoices/getInvoicesPaginated/:accountID/:userID` | page default 1, limit default 20 capped 500, search default empty | `invoicesList.activeInvoiceData` with grid, rows, pagination and searchTerm; 400 invalid pagination, 500 DB/grid failure. Fixed invoice-date DESC order. |
| GET `/invoices/getInvoiceDetails/:invoiceID/:accountID/:userID` | Scoped invoice ID | Original invoiceDetails plus current_remaining_balance, sentHistory, and five named ledger Data groups with arrays/grids. 404 missing row/contact; 500 database failure. |
| DELETE `/invoices/deleteInvoice/:accountID/:invoiceID` | No force parameter | Sent record: **HTTP 409**, `{status:409,code:'SENT_INVOICE_LOCKED',message:'locked: part of sent invoice INV-…'}`. Unissued safe empty parent: 200 refreshed invoicesList. Existing unissued structural/missing/DB refusals retain legacy HTTP 200/body500 envelopes. |
| GET `/invoices/:invoiceID/history/:accountID/:userID` | Positive integer invoice ID (child resolves to root) | Lock metadata, current_remaining_balance, conditions, original issue, revisions, exceptions with selected payments, chronological events and statementPayments with eligibility. 400 malformed ID, 404 missing, 500 DB failure. GET never creates historical metadata. |
| POST `/invoices/:invoiceID/exceptions/:accountID/:userID` | `{condition:'bounced_check',reason,paymentIds:[…]}` | Created exception (`flagged`). Reason 1–2000 characters; 1–100 distinct positive integer payment IDs. 400 invalid input; 404 missing invoice/payment on this statement; 409 unissued/child target, existing active exception or ineligible payment; 500 DB failure. |
| POST `/invoices/:invoiceID/exceptions/:exceptionID/reverse/:accountID/:userID` | No correction amounts accepted | Atomic positive reversals for exactly the selected receipts; reversal IDs, cancelled excess-retainer evidence, before/after balance and `state:'reversed'`. 400 malformed IDs; 404 missing; 409 wrong state, already reversed, retainer-funded or used overpayment excess; 500 DB failure. |
| POST `/invoices/:invoiceID/exceptions/:exceptionID/resolve/:accountID/:userID` | `{action:'revision'|'roll_forward'|'cancel'}` | State/result; revision includes immutable artifact_key, revision number and issued_amount. 400 invalid action/IDs; 404 missing; 409 wrong state or revision of an absorbed historical invoice; 500 DB/storage failure with state unchanged. |

File downloads remain at `/invoices/downloadFile/:accountID/:userID`; see [storage](../platform/storage-and-downloads.md). Account-scoped lookup never discloses a foreign record. Unexpected transition errors expose a generic message, not SQL. Every unsuccessful precommit transition rolls back money, exception state and history together.

## 4. Data model and locks

Migration `023.sent_invoice_locks.sql` adds `invoice_issues`, `invoice_statement_members`, `invoice_exceptions`, `invoice_exception_payments`, `invoice_revisions`, `invoice_history` and the single migration-cutover row `invoice_lock_policy`. It does not rewrite existing business rows.

An issue saves the exact renderer input, artifact key, actor and timestamp. Membership saves row IDs and JSON snapshots for the customer ledger basis through issuance, including previously stamped work, balance-forward snapshots, receipts, hidden/netted write-offs and retainers. A row may support multiple statements. Pending unbilled work remains editable. Details use the exact frozen renderer groups, not cumulative membership as a period filter; legacy snapshots fall back to saved membership.

SQL triggers refuse changes/deletion of every protected invoice, transaction, receipt, write-off and retainer, plus direct insertion/relinking into an issued statement. Customer deletion and job reassignment/deletion cannot strand protected work. Imports receive the same barrier. Customer row locks serialize ledger writers with finalize. Application preflight and response normalization expose HTTP 409 before any partial mutation can commit.

`invoice_issues`, membership, revisions and history are append-only. The exception state/selected reversal references are changed only by their transactional service. An exception grants a specific correcting event, never ordinary edit/delete access. Corrective payment/snapshot/retainer rows are immediately added to immutable membership.

Pre-cutover artifact-bearing parent statements lock conservatively without backfilling business rows. First explicit exception archives their available historical metadata and records `legacy_issue_recorded` with the current operator; original parent time/creator identify the historical issue. Their original PDF supplies the full original itemization. Statements without an artifact require archival review before production rollout; absence of evidence is not evidence of historical non-delivery.

## 5. Balances and revisions

Payments/write-offs after issuance create new children and leave parent totals, dates, paid status and notes unchanged. The latest child is the current balance. Absorption appends a zero child carrying `[absorbed_by:INV-…@YYYY-MM-DD]`; it never zeroes issued rows in place. Engine, Audit, AR and payment pickers use this chain model.

A bounced receipt appends a positive payment to the current live chain; the original receipt is unchanged. Unused overpayment excess is cancelled with a new zero retainer snapshot when its original is locked. Used excess refuses atomically. Revision amount = original issued due + all selected reversed receipt amounts for this invoice across exceptions. Cancelled excess is disclosed separately, not added to debt twice. Later payments/work remain separate activity; the UI shows current balance separately.

Revision uses the same invoice number and increasing revision number, a clearly marked PDF with frozen original content and explicit corrections, and a unique new object key. Original bytes/key never change. Revision is allowed only for a live statement. For an older absorbed statement, reverse onto the live chain and choose roll forward. Roll forward records resolution without posting money again. A storage failure leaves state retryable; a later database failure can leave an unreferenced unique blob but cannot overwrite or break a referenced original.

## 6. Unissued deletion and prior behavior

Only an unissued empty parent with no linked rows/children, nonzero beginning balance, absorption source or marker may be deleted. These structural checks repeat under customer/invoice locks. Even an issued $0 empty invoice now refuses deletion.

Billing Review's old post-issue cascade edit is deliberately replaced with 409. Ordinary edits to unissued fixtures retain cascade/rollback coverage. Direct reversal of a locked receipt now requires the audited exception route. Direct locked-retainer editing refuses; decision 1's append-only refund/adjustment interface is implemented in run2.

## 7. Verification

`scenario-lifecycle-12-sent-exceptions.integration.spec.js` tests the full workflow, preserved row/PDF bytes, all mutation surfaces, invalid inputs, tenant/role boundaries, races and injected DB/storage failures with unchanged-state checks. It hand-calculates $500 → $400 → $500 and a $150 overpayment split into $100 debt restoration plus $50 credit cancellation. The updated month-end/finalize/clean-room suites retain arithmetic and PDF/CSV coverage. Frontend jest covers history, errors, selection, transitions, archived downloads, lock indicators and current-snapshot payment selection. Exact final counts are in the [run results](../decisions/2026-09-24-run-1-results.md).


## Owner run 2 — retainers and duplicate review

Invoice Retainers detail now includes frozen `invoiceRetainersData.events` from issuance payload and displays refund/adjustment evidence. Duplicate review links locked candidates to invoice history but never unlocks them; currently only bounced-payment exceptions are supported. Zero-dollar statements carrying pending retainer events remain issuable. See [retainer events](../ledger/retainers-and-prepayments.md) and [duplicates](../ledger/duplicates.md).

## Run 3 credit statements

A selected credit finalizes at the same sent/lock boundary. Invoice detail shows its original signed credit and no payment due at issuance, separately from its later current balance. The archived PDF is titled CREDIT STATEMENT and remains unchanged after carry-forward or a bounced-payment correction. Selection actor/time/reason is retained in invoice_issues/history (migration025). Existing exception/revision/roll-forward rules apply equally to credits. Drafts remain editable and write nothing to the ledger.


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.

Opening an issued original/revision through the invoice downloader now records an `invoice_reprint` action after reading the archive and before returning bytes. This is nonfinancial and does not imply email delivery. Draft exports produce no issuance/reprint event.

### Pass 3 response failure checks

Deleting an allowed empty, unissued legacy invoice confirms the committed deletion even if the refreshed invoice list fails. Likewise, failure of the shared sent-lock/duplicate-status decoration after a committed change returns success with `committed: true` and a reload warning; it does not expose rows missing their lock state or invite a duplicate submission. This fallback retains the finalized download link, skipped-customer identities and committed invoice IDs, so a partial batch remains actionable. Read-only decoration failure remains an error with no writes. Drafts remain editable and write nothing to the ledger; finalize is the sent/lock boundary. See `path-matrix-09-ledger-defenses` and `path-matrix-14-response-decoration` integration tests.
