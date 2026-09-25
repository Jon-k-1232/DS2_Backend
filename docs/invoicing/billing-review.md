# Billing Review

## 1. Purpose and UI

Billing Review resolves held time-tracker entries and reviews processed transactions before billing. Route `/time-tracking/billingReview` uses `../DS2_Frontend/src/Pages/Transactions/BillingReview/BillingReviewPage.js:6`. Its mounted tabs are NeedsReviewTab and ConsolidatedTab with period='unbilled'. PreInvoiceTab exists in the folder but is not mounted by BillingReviewPage. The edit dialog is components/ReviewBillingDialog.js; cascade effects are displayed by components/CascadeImpactPanel.js. Sources: `../DS2_Frontend/src/Routes/PrimaryRouter.js:151`, `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:40`, `../DS2_Frontend/src/Pages/Transactions/BillingReview/BillingReviewPage.js:25`. API calls are in `../DS2_Frontend/src/Services/ApiCalls/BillingReviewCalls.js:49`.

## 2. Access rules

The router requires authentication, backend role manager/admin/super admin/owner and enforceAccountId. No enforceSelfOrPrivileged middleware is registered on userID. Held apply, rerun and transaction edits record **req.user.user_id**, never the URL actor. Sources: `src/app.js:159`, `src/endpoints/billingReview/billingReview-router.js:5`, `src/endpoints/billingReview/billingReview-router.js:123`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`.

Every endpoint has HTTP 401 for missing/invalid/expired/unresolvable authentication, 403 for role/account mismatch and 429 at the general 300/minute limit. Non-GET/HEAD requests also have the expensive-route 30/minute limiter. JSON is limited to 1 MB (413); malformed JSON is 400. Unexpected asynchronous failures go to the global error handler (500); coded service errors are mapped below. Sources: `src/app.js:70`, `src/app.js:100`, `src/app.js:111`, `src/app.js:159`, `src/app.js:178`.

AI reruns require TIME_TRACKER_AI_FEATURE_FLAG='on', or 'test' with this account in comma-separated TIME_TRACKER_AI_TEST_ACCOUNT_IDS. Other values/default 'off' deny rerun. Manual held apply has no AI feature-flag requirement. Source: `src/endpoints/timesheets/auto-ingest-runner.js:8`.

## 3. API reference

Unexpected database failure in the role middleware can return HTTP 500 through the global handler. Source: `src/endpoints/auth/jwt-auth.js:77`, `src/app.js:178`.

All paths below include the shown required accountID/userID route segments. userID is a compatibility placeholder. No route in this router deletes a transaction or held entry. Source: `src/endpoints/billingReview/billingReview-router.js:47`.

### GET /billing-review/distinct-entities/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/billing-review/distinct-entities/:accountID/:userID` |
| Inputs | No query/body. |
| Success | HTTP 200 {message:'ok',entities:[string,...]}. |
| Errors | Shared 401/403/429; unexpected DB errors 500. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:50`. |

### GET /billing-review/earliest-unbilled-month/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/billing-review/earliest-unbilled-month/:accountID/:userID` |
| Inputs | No query/body. |
| Success | HTTP 200 {message:'ok',start:'YYYY-MM-01'}. When no eligible unbilled rows exist, returns first of current server-local month, not null. |
| Errors | Shared 401/403/429; unexpected failures 500. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:63`, `src/endpoints/billingReview/billingReview-service.js:554`. |

### GET /billing-review/pending/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/billing-review/pending/:accountID/:userID` |
| Pagination | Optional page default 1; limit default 50. Number-converted integers only, page >=1, limit 1..500; empty string means default. |
| Filters | Optional hold_reason, timesheet_name, date_start/date_end, entity_contains/entity_equals, employee_contains, tracker_contains, notes_contains, ai_conf_min, customerId, employeeUserId, workDescId. Numeric filters use Number without further bounds. Dates are passed to SQL without route format validation. |
| Sorting | sortField: date, entity, customer, work_description, hold_reason, hours, employee, timesheet_name, ai_confidence, created_at. Unknown defaults created_at. sortDirection exactly 'asc', otherwise desc. |
| Success | HTTP 200 {message:'ok',entries,total,page,limit}. Each entry contains stored tracker fields and joined suggestion/customer/work-description fields. |
| Errors | Shared errors; HTTP 400 invalid pagination; invalid SQL date/numeric filters and other DB failures reach 500. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:73`, `src/endpoints/billingReview/billingReview-service.js:99`. |

### PUT /billing-review/:entryID/:accountID/:userID

| Item | Contract |
|---|---|
| Method | PUT |
| Path | `/billing-review/:entryID/:accountID/:userID` |
| Inputs | entryID Number-converted path value. Body is the held-entry edits object, fields below. |
| Success | HTTP 200 {message:'ok',transaction:<created customer_transactions row>}. |
| Errors | Shared errors; 404 NOT_FOUND for absent/deleted/already-processed entry or losing its atomic claim; 400 MISSING_FIELD/INVALID_FIELD for missing fields, wrong-account references, job/customer mismatch, invalid duration/rate; other failures 500. Error body {message,code?,field?}. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:118`, `src/endpoints/billingReview/billingReview-service.js:247`. |

| Held-apply field | Validation/default |
|---|---|
| customer_id | Required nonblank; customer must exist in this account. |
| customer_job_id | Required nonblank; same account and selected customer. |
| general_work_description_id | Required nonblank; account-owned work description. |
| logged_for_user_id | Required nonblank; account-owned employee, supplies default billing_rate. |
| transaction_date | Required nonblank; no further calendar/format validation in this service. Database conversion may fail. |
| duration_minutes | Optional, defaults to stored entry.duration; finite >0 and must produce positive rounded quantity. |
| unit_cost | Optional, defaults to employee.billing_rate then 0; finite >=0; trimmed raw representation must be digits with at most 2 decimal places. No explicit maximum here. |
| is_transaction_billable | Optional default true; false only for false/'false'/0/'0'; forcibly false for internal customers or stored non-work entries. |
| transaction_type | Optional, trimmed case-insensitive Time/Charge; unknown or missing defaults Time. |
| note, detailed_work_description | Optional, defaults ''; no explicit length/type checks here. |
| total_transaction, quantity, invoice/retainer links | Client total/quantity do not set pricing; computed from duration/rate. New invoice and retainer links are forced NULL. |
| Evidence | `src/endpoints/billingReview/billingReview-service.js:9`, `src/endpoints/billingReview/billingReview-service.js:261`, `src/endpoints/billingReview/billingReview-service.js:289`, `src/endpoints/billingReview/billingReview-service.js:337`. |

### GET /billing-review/weekly/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/billing-review/weekly/:accountID/:userID` |
| Required | start/end strings matching YYYY-MM-DD. Regex only: valid calendar date and start <= end are not checked here. |
| Optional filters | customerId, employeeUserId, workDescId (Number); jobContains, trackerContains, noteContains, entityContains, entityEquals; aiConfMin (Number); billableOnly query strings 'true'/'false'; unbilledOnly and aiOnly true/'true'. |
| Pagination | page default 1, limit default 200; unlike pending, no explicit integer/range/max validation. Invalid values can fail in SQL. |
| Sorting | transaction_date (default), customer, entity, job, work_description, employee, hours, total, billable, ai_confidence, timesheet_name. Direction exactly 'asc', else desc. |
| Success | HTTP 200 {message:'ok',transactions,totalSum,pageSum,totalCount,page,limit}. |
| Errors | Shared errors; HTTP 400 missing start/end or bad format; 500 unexpected query failures. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:143`, `src/endpoints/billingReview/billingReview-service.js:210`. |

### GET /billing-review/pre-invoice/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/billing-review/pre-invoice/:accountID/:userID` |
| Inputs | Required query customerId, start, end checked only for presence; customerId Number-converted. Other query filters/paging are not forwarded. |
| Success | HTTP 200 {message:'ok',...consolidatedList,anomaly}. List uses first page/default limit 200. anomaly may be null. |
| Errors | Shared errors; 400 missing required query values; invalid dates/query errors 500. Foreign customer returns no account-scoped transactions, not another tenant's ledger. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:188`. |

### GET /billing-review/reprocess-count/:accountID/:userID

| Item | Contract |
|---|---|
| Method | GET |
| Path | `/billing-review/reprocess-count/:accountID/:userID` |
| Inputs | Optional mode = unprocessed (default), errored, all_held. |
| Success | HTTP 200 {message:'ok',mode,count,eligible}. Count is the size of a **maximum 2,000** ID selection, not a full uncapped count. eligible is the feature-flag decision. |
| Errors | Shared errors; 400 BAD_MODE; 500 other failures. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:212`. |

### POST /billing-review/reprocess/:accountID/:userID

| Item | Contract |
|---|---|
| Method | POST |
| Path | `/billing-review/reprocess/:accountID/:userID` |
| Body | Optional mode above; batch_size Number-converted, default 500, capped at 2,000 in selection. Negative/fractional values are not explicitly rejected. Optional ids array maps Number and retains finite values, without integer validation/deduplication/explicit size cap. |
| Precedence | Nonempty converted ids bypass mode selection/validation. Otherwise select by mode. |
| Success | HTTP 202 {message,queued,mode:'explicit_ids' or selected mode}; background setImmediate processing. If no IDs, HTTP 200 {message,queued:0,mode}. No durable job ID or poll API. |
| Errors | Shared errors; 503 {message,code:'flag_off'} when disabled; 400 code bad_mode for invalid selection mode; 500 selection/queue errors. Later background errors cannot change the already-sent response. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:235`, `src/endpoints/timesheets/auto-ingest-runner.js:69`. |

### POST /billing-review/reprocess-with-overrides/:entryID/:accountID/:userID

| Item | Contract |
|---|---|
| Method | POST |
| Path | `/billing-review/reprocess-with-overrides/:entryID/:accountID/:userID` |
| Body | Optional overrides object, default {}. Supplies customer_id, customer_job_id, general_work_description_id, logged_for_user_id, transaction_date and duration_minutes hints to the ingestion orchestrator. The route does not validate their types/limits. |
| Success | HTTP 200 {message:'ok',decision,reason,suggestionError?,errorMessage?,autoInserted,held,transactionId?}. Decisions pass through auto_insert/hold/skip; no-result fallback is unknown/no_result_returned. |
| Errors | Shared errors; 503 flag_off; 404 NOT_FOUND for missing/deleted entry; 409 ENTRY_ALREADY_APPLIED for a live linked transaction (includes transactionId); coded MISSING_FIELD/INVALID_FIELD/BAD_MODE map to 400; unexpected failures 500. Error decision is 'error'. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:280`, `src/endpoints/billingReview/billingReview-service.js:481`. |

### PUT /billing-review/transaction/:transactionID/:accountID/:userID

| Item | Contract |
|---|---|
| Method | PUT |
| Path | `/billing-review/transaction/:transactionID/:accountID/:userID` |
| Body | {updates:{...},confirmCustomerChange:false}. Nonobject/array updates become {}. Unknown fields ignored. confirmCustomerChange true only for true/'true'. |
| Success | HTTP 200 {message:'ok',updatedTransaction,sideEffects,diff}; no-op has [] effects and {} diff. |
| 404 | transaction_not_found. |
| 400 | job_required_for_customer_change; invalid_field_value for invalid fields or foreign/mismatched references. |
| 409 | invoice_locked; date_outside_invoice_period; retainer_not_editable_here; customer_change_needs_confirm; edit_would_create_credit_balance; concurrent_edit. Triggers detailed below. |
| Other errors | Shared errors; unexpected 500. Responses include message/code where known, with unexpected server details sanitized. |
| Evidence | `src/endpoints/billingReview/billingReview-router.js:12`, `src/endpoints/billingReview/billingReview-router.js:312`, `src/endpoints/billingReview/cascadeEdit.js:790`. |

| Editable field | Rules |
|---|---|
| customer_id, general_work_description_id | Positive integer, nonblank; changed references validated in account. |
| customer_job_id | Positive integer or normalized null; a changed job cannot be null, and must belong to selected customer/account. Legacy unchanged null is tolerated. |
| transaction_date | Date or parseable input normalized to YYYY-MM-DD and checked as a real date. ISO prefixes are used. Billed changed dates must stay in the invoice's inclusive start/end period unless moving customer. |
| quantity, unit_cost, total_transaction | Finite numbers 0..99,999,999.99, rounded to 2 decimals. No six-minute rounding in cascade editing. Blank values fail. |
| is_transaction_billable | true/false, 1/0, or trimmed case-insensitive true/false/t/f/1/0. |
| note, detailed_work_description | Text or null; objects rejected. Null and empty text compare unchanged. |
| Disallowed | Any presence of retainer_id is refused with 409, even unchanged. Employee, transaction type, creator and invoice ID are not editable fields. |
| Evidence | `src/endpoints/billingReview/cascadeEdit.js:6`, `src/endpoints/billingReview/cascadeEdit.js:116`, `src/endpoints/billingReview/cascadeEdit.js:186`, `src/endpoints/billingReview/cascadeEdit.js:456`, `src/endpoints/billingReview/cascadeEdit.js:795`. |

## 4. Data model

| Table | Reads/writes |
|---|---|
| timesheet_entries | account/entry, date, duration, entity/employee/tracker/notes/category, deleted/processed flags, hold_reason, matched_user_id, suggested_customer_id, ai_attempted_at and stored payload. Held apply claims it; rerun resets processing metadata. |
| ai_time_tracker_transaction_suggestions | Entry suggestion/status, confidence, suggested work/customer and ai_payload. Held apply marks applied; rerun pipeline may replace/update suggestion data. |
| customer_transactions | Full row/amounts, account/customer/job/work-description/employee/invoice/retainer IDs, billable flag and notes. |
| customers, customer_jobs, customer_job_types, customer_general_work_descriptions, users | Ownership checks, labels, employee billing_rate and job totals. |
| customer_invoices | Root/current snapshot and paid/absorbed status; delta snapshot + parent totals/remaining when a billed monetary contribution changes. |
| ai_category_training_examples | One preferred provenance row per transaction for list joins; best-effort new examples on creation/work-description edits. |
| ai_reviewer_corrections | Changed-field feedback, original/final values and sanitized original notes on cascade edits. |
| time_tracker_staff, notifications | Async batch rerun notification recipients/results. |
| Evidence | `src/endpoints/billingReview/billingReview-service.js:29`, `src/endpoints/billingReview/billingReview-service.js:120`, `src/endpoints/billingReview/cascadeEdit.js:707`, `src/endpoints/timesheets/auto-ingest-runner.js:22`. |

Invoice delta notes are `[adjustment: transaction #<id> Δ<signed amount>]`. Existing absorption markers are read as locks. Normal negative payments/write-offs are not recalculated by transaction edits. Source: `src/endpoints/billingReview/cascadeEdit.js:386`.

## 5. Read logic

Pending entry rows return timesheet_entries.* (including its original ai_payload), suggested_general_work_description_id, suggested_job_category_id, suggested_job_type_id, ai_suggested_category, ai_confidence, ai_reason, ai_payload_suggestion, suggested_customer_display_name, suggested_customer_display and suggested_work_description. The suggestion payload is aliased so it cannot replace the held-entry payload. Source: `src/endpoints/billingReview/billingReview-service.js:84`.

Consolidated rows return customer_transactions.* plus customer_display_name, general_work_description, logged_for_user_display_name, invoice_number, is_invoice_paid_in_full, customer_job_description/parent_id, tracker_id/filename/entity/company_name/first_name/last_name/category/notes/duration_minutes/date/employee_name, ai_confidence, ai_reason, ai_status and ai_source. aiOnly filters the selected provenance row to ai_source='ai_auto_insert'. jobContains searches job-type description; noteContains matches detailed_work_description OR note; tracker/entity filters use the tracker row. Source: `src/endpoints/billingReview/billingReview-service.js:146`, `src/endpoints/billingReview/billingReview-service.js:181`.

Both list offsets are max(0,(Number(page)-1)×Number(limit)). This does not make weekly page/limit validation equivalent to pending's stricter route checks. Source: `src/endpoints/billingReview/billingReview-service.js:52`, `src/endpoints/billingReview/billingReview-service.js:144`.

Cascade sideEffects can include invoice_recalculated or old_invoice_recalculated_after_customer_change (mode='delta', root/snapshot IDs, invoice number, delta, charges/due/latest/parent remaining and paid flag), transaction_unlinked_from_invoice, old_job_recalculated/new_job_recalculated, reviewer_corrections_written and training_example_written. diff records only changed fields with old/new values. Source: `src/endpoints/billingReview/cascadeEdit.js:428`, `src/endpoints/billingReview/cascadeEdit.js:681`.

Pending rows are account-scoped timesheet_entries where processed=false, deleted=false and hold_reason IS NOT NULL. Left joins add AI suggestion, suggested customer and work-description labels. Filters use exact hold/timesheet/entity equality where requested, inclusive dates, ILIKE contains fields, suggested customer, matched employee, suggested work description and confidence >= minimum. Count uses the same joins/filters. Sorting has no secondary tie-break. Source: `src/endpoints/billingReview/billingReview-service.js:29`.

Consolidated reads account-scoped customer_transactions with inclusive transaction_date start/end. It inner joins customer and work description, left joins employee, invoice, job/type, and one LATERAL training example. That example prefers a nonnull timesheet_entry_id, then created_at DESC and training_id DESC. Tracker/suggestion joins then supply provenance without multiplying transaction rows. Filters operate on the joined fields; unbilledOnly means invoice ID NULL. Count and sum use the full filtered set; pageSum uses returned rows. Source: `src/endpoints/billingReview/billingReview-service.js:21`, `src/endpoints/billingReview/billingReview-service.js:120`.

Distinct entities selects distinct nondeleted account entry.entity, excludes null/empty and sorts ascending. Earliest-unbilled-month uses MIN(transaction_date) for invoice ID NULL and date <= server-local today, regardless of billable flag; future work cannot move the default start forward. Source: `src/endpoints/billingReview/billingReview-service.js:440`, `src/endpoints/billingReview/billingReview-service.js:554`.

Reprocess selection always requires unprocessed/nondeleted account entries, ordered created_at ASC. unprocessed means ai_attempted_at NULL; errored means hold_reason='bedrock_error'; all_held means nonnull hold_reason. LIMIT is min(requested/default,2000). Source: `src/endpoints/billingReview/billingReview-service.js:387`.

## 6. Calculations

### Held apply

The live helper uses six-minute increments despite a stale minutes/60 comment in billingReview-service:

1. quantityHundredths = ceil(minutes / 6) × 10.
2. rateCents = round(rate × 100).
3. totalCents = round(quantityHundredths × rateCents / 100).
4. quantity = quantityHundredths / 100; unitCost = rateCents / 100; totalTransaction = totalCents / 100.

68 minutes at $137.50 becomes 1.2 hours and $165.00. Client total is ignored. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:541`, `src/endpoints/billingReview/billingReview-service.js:289`.

Internal-customer resolution and the stored non-work classification force billable=false even if the reviewer asks for true. Internal resolution considers configured IDs, canonical account/customer identity and qualifying staff/entity associations. Source: `src/endpoints/billingReview/billingReview-service.js:308`, `src/endpoints/timesheets/internal-customers.js:28`.

### Consolidated totals and anomaly

totalSum and pageSum add stored total_transaction, rounded to cents. They include nonbillable amounts unless billableOnly filters them out. Source: `src/endpoints/billingReview/billingReview-service.js:227`.

Anomaly comparison uses D=end-start milliseconds, without an extra inclusive day. Invalid/nonpositive D returns null. Current sum includes both endpoints; history is [start-6D,start), divided by 6. All transaction totals count, not just billable/unbilled. Average <=0 gives no_history; otherwise current/average >2 or <0.5 flags an anomaly. Exact thresholds are normal. Example: current $1,200, history $3,000 over six periods => average $500, ratio 2.4, high. Source: `src/endpoints/billingReview/billingReview-service.js:405`.

### Billed transaction delta

Normalize fields before deciding whether anything changed. If quantity/rate changes while supplied total is absent or unchanged from old total, recompute total=round2(quantity×unit_cost). An explicitly changed total wins, even if different from quantity×rate. Source: `src/endpoints/billingReview/cascadeEdit.js:549`.

Old contribution = old total if billable, else 0. New contribution = new total if billable, else 0; a customer move contributes 0 to the old invoice. Delta = new contribution - old contribution. A nonbillable amount edit has delta 0. Source: `src/endpoints/billingReview/cascadeEdit.js:549`.

For delta +$20 on a $100 charge with current invoice remaining $60: increase parent total_charges/total_amount_due by $20, create a latest adjustment snapshot with remaining $80, and add $20 to the parent's existing remaining mirror. The code preserves any preexisting parent/latest drift; it does not rebuild balances from payments. Source: `src/endpoints/billingReview/cascadeEdit.js:386`.

## 7. Create, edit and delete

### Apply a held entry

The service checks account-owned customer/job/work-description/employee and pricing, then starts one transaction. It atomically updates the entry WHERE unprocessed/nondeleted, sets processed=true, clears hold_reason, saves matched employee/suggested customer and requires a claimed row. The shared transaction creator takes the customer ledger FOR NO KEY UPDATE, rechecks job ownership, updates job-family history, inserts an unbilled transaction and best-effort training example. It receives retainer=NULL, so no draw/payment is generated here. The suggestion becomes applied within the same transaction. Any core failure rolls back the entry claim and transaction together. Sources: `src/endpoints/billingReview/billingReview-service.js:318`, `src/endpoints/transactions/sharedTransactionFunctions.js:543`, `src/endpoints/transactions/sharedTransactionFunctions.js:586`.

The service lookup does not require hold_reason nonnull, only unprocessed/nondeleted. It can therefore apply another qualifying unprocessed entry by ID. No invoice, PDF, S3 object or direct notification is created by manual apply. Source: `src/endpoints/billingReview/billingReview-service.js:254`.

### Cascade edit

An unlocked preview identifies changes and required customer locks; no-ops return immediately. Original detailed notes are sanitized through Comprehend before locks, with failure becoming null. The authoritative plan is recomputed after ascending customer ledger locks and a transaction FOR UPDATE reread. If customer/invoice ownership changed and extra ledger locks are needed, retry with the expanded lock set, at most three attempts; then 409 concurrent_edit. Source: `src/endpoints/billingReview/cascadeEdit.js:489`, `src/endpoints/billingReview/cascadeEdit.js:790`.

For financial deltas, the chain root and latest snapshot are locked FOR UPDATE. Refuse when the chain is missing, paid in either root/latest, absorbed by notes, or has a newer parent. Refuse a reduction making latest remaining negative. Zero is allowed and marks parent/latest paid with server-local current date. A changed billed date outside inclusive start/end is refused; unchanged historical dates are not revalidated. Nonfinancial edits may proceed on paid/absorbed invoices. Sources: `src/endpoints/billingReview/cascadeEdit.js:297`, `src/endpoints/billingReview/cascadeEdit.js:341`, `src/endpoints/billingReview/cascadeEdit.js:441`.

A customer move requires explicit confirmCustomerChange and a job for the target customer. For billed rows it removes the old contribution and clears customer_invoice_id so the target customer receives unbilled work. A retainer-funded row cannot change customer, total or billable flag here; any explicit retainer_id field is rejected. Sources: `src/endpoints/billingReview/cascadeEdit.js:456`, `src/endpoints/billingReview/cascadeEdit.js:549`, `src/endpoints/billingReview/cascadeEdit.js:641`.

A nonzero delta copies the latest invoice snapshot, removes ID/created_at, sets parent=root, timestamp=clock_timestamp(), authenticated actor, adjustment note and revised financial amounts. It updates the parent's mirror; earlier snapshots and payment/write-off/retainer totals stay unchanged. Saved invoice_file_location is copied, **not regenerated**, so PDFs remain the original artifacts. Source: `src/endpoints/billingReview/cascadeEdit.js:386`.

Changed customer/job/total triggers _recomputeJobTotal. That helper sums only transactions on the exact job ID and updates that row, unlike the shared family-history creator. This leaves latest family totals stale in multi-version jobs ([F9](../_review/findings.md#f9)). Source: `src/endpoints/billingReview/cascadeEdit.js:281`.

Feedback writes use savepoints: ai_reviewer_corrections for changed fields and a reviewer_edit category training example when work description changes. Failure rolls back only that feedback savepoint. If original notes changed after preview, stale sanitized text is not reused. No notification, PDF or S3 update occurs. Source: `src/endpoints/billingReview/cascadeEdit.js:681`.

### Rerun side effects

Batch rerun schedules processEntries after returning. The pipeline can write suggestions/held reasons, AI attempt and usage data, transactions/job history and training data. It then sends in-app notifications to the initiating user plus active time_tracker_staff users whose account/user remain active. Type is new_customer_needs_addition, rows_held_for_review or tracker_upload_processed; payload includes autoInserted/held/cost. Notification failures are logged without undoing processing. Source: `src/endpoints/timesheets/auto-ingest-runner.js:22`, `src/endpoints/timesheets/auto-ingest-runner.js:69`.

Synchronous override rerun first locks the tracker entry FOR UPDATE and refuses deleted/missing rows or any live transaction found through training provenance. It resets processed=false, hold_reason=NULL, ai_attempted_at=NULL while keeping previous matched/suggested identities, commits, then invokes processEntries with overrides. Reset and AI processing are not one long transaction. Concurrent processing returns skip with the linked transaction when available. This path calls the orchestrator directly, not the batch notification runner. Source: `src/endpoints/billingReview/billingReview-service.js:481`.

There is no delete route in Billing Review. Detailed AI matching/prompt decisions outside this financial review boundary are implemented in `src/endpoints/timesheets/auto-ingest-orchestrator.js`; model output for a future rerun is **not determined from the code**.

## 8. Invariants and tests

| Existing spec | Assertions |
|---|---|
| test/endpoints/billingReview/billingReview-service.spec.js | Held apply validation, pricing, billability, account references and atomic application. |
| test/endpoints/billingReview/billingReview-router.spec.js | Status mapping, pagination, authenticated actor and rerun contracts. |
| test/endpoints/billingReview/listEntriesForReprocess.spec.js | Mode selection and rejection. |
| test/endpoints/billingReview/cascadeEdit.spec.js | Normalization, editable fields, validation and calculation helpers. |
| test/endpoints/billingReview/cascadeEdit.flow.spec.js | No-op/nonfinancial edits; paid/absorbed guards; billable deltas; customer moves; retainer restrictions; feedback failures and locks. |
| test/integration/coverage-billing-review.integration.spec.js | HTTP reads, date/paging validation and account/role scope. |
| test/integration/cascade-edit-recompute.integration.spec.js | Financial edits keep engine, audit and AR aligned; snapshot/delta behavior. |
| test/integration/billing-regression.integration.spec.js | Ingestion pricing and billed-charge regression behavior. |

Tests were inspected, not executed. Their fixtures do not establish that historical production job families have been corrected.

## 9. Known limitations and open decisions

Weekly paging is less strict than pending paging; pre-invoice returns only its first 200 rows even though totalSum covers all rows. Cascade edits do not re-round time in six-minute increments or regenerate issued PDFs. [F9](../_review/findings.md#f9) covers the family-total defect. Sources: `src/endpoints/billingReview/billingReview-router.js:180`, `src/endpoints/billingReview/billingReview-router.js:196`, `src/endpoints/billingReview/cascadeEdit.js:281`.

The report identifies 151 stale job families, broken/missing job links, stale WIP and internal customers that must remain nonbillable. Closed-period adjustment policy is still open. Rollout includes INTERNAL_CUSTOMER_IDS and the reviewed migration/backend/frontend order. Live resolution is **not determined from the code**. Sources: `scripts/review-2026-09/FINAL_REPORT.md:51`, `scripts/review-2026-09/FINAL_REPORT.md:54`, `scripts/review-2026-09/FINAL_REPORT.md:61`, `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **10 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
