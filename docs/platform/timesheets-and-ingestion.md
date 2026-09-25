# Timesheets and ingestion

Source review: 2026-09-24. Citations are backend-relative unless prefixed `../DS2_Frontend/`. Tests were read, not run. Workbook validation, duplicate detection and original-file ownership are in [time-tracking.md](time-tracking.md).

## 1. Purpose and UI

`timesheet_entries` is the holding table between workbook upload and customer_transactions. An upload can be pending, held for review, processed, or soft-deleted. Upload success does not mean all entries became billable transactions. Sources: `migrations/schema-snapshot-2026-09-22.sql:1013`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:664`.

`/time-tracking/billingReview` renders `../DS2_Frontend/src/Pages/Transactions/BillingReview/BillingReviewPage.js`, with `tabs/NeedsReviewTab.js`, `tabs/ConsolidatedTab.js`, `tabs/PreInvoiceTab.js` and `components/ReviewBillingDialog.js`. The route requires Manager/Admin/Super Admin. Legacy employee tracker screens live below `/transactions/employeeTimeTrackerTransactions/*`, routed by `EmployeeEntrySubRoutes.js`; grids include `TimeTrackerStatusGrid.js`, `EmployeeTimesheetsGrid.js` and `TimesheetsByMonthGrid.js` under Pages/Transactions/TransactionGrids. Sources: `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:41`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:13`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:32`.

## 2. Access rules

Every timesheets route requires an active authenticated user and own account. Per-employee reads register self-or-privileged on `queryUserID`; the trailing URL userID is not the actor. Account-wide queue/count, move and delete require lowercase `manager`, `admin`, `super admin` or legacy `owner`. The actor recorded on movement comes from req.user.user_id. AI kickoff permits ordinary users only for their own selected entries. Sources: `src/app.js:149`, `src/endpoints/timesheets/timesheets-router.js:5`, `src/endpoints/timesheets/timesheets-router.js:36`, `src/endpoints/timesheets/timesheets-router.js:88`, `src/endpoints/timesheets/timesheets-router.js:281`.

All billing-review routes require the same privileged roles at mount and own account. Their URL userID does not authorize/attribute an action; authenticated user is the actor. Non-GET/HEAD billing-review requests also have a 30/minute expensive-operation limit; timesheet kickoff uses only the ordinary API limiter. The deprecated ai-integration mount requires authentication, then returns 410 for all paths/methods. Sources: `src/app.js:154`, `src/app.js:159`, `src/endpoints/billingReview/billingReview-router.js:123`, `src/endpoints/aiIntegration/aiIntegration-router.js:16`.

## 3. API reference

`A=:accountID`, `U=:userID`, `Q=:queryUserID`. Required account paths must match authenticated account. All routes inherit **401** missing/invalid/inactive identity, **403** account/role/self failures, **429** rate limits, **400** malformed JSON and **413** JSON over 1 MB; unexpected errors give **500** unless specified below. Sources: `src/app.js:70`, `src/app.js:100`, `src/app.js:178`, `src/endpoints/auth/account-scope.js:7`.

Timesheet paging uses `page` default 1 and `limit` default 10, parseInt conversion, positive finite validation, limit capped at 500, offset=(page−1)×limit. Thus `2junk` parses as 2. Metadata is `{page,limit,totalItems,totalPages}`. It is different from strict billing-review paging. Sources: `src/utils/pagination.js:1`, `src/endpoints/timesheets/timesheets-router.js:18`.

### Account pending entries

| Item | Contract |
|---|---|
| Method/path | `GET /timesheets/getTimesheetEntries/A/U` |
| Input | Privileged; optional page/limit above. No search/sort/date parameters. |
| Success | **200** `{outstandingTimesheetEntries:[entry + ai_suggestion],pagination,message}`. |
| Errors | **400** bad paging; **500** read error; shared errors. |
| Source | `src/endpoints/timesheets/timesheets-router.js:58` |

### Per-employee pending entries

| Item | Contract |
|---|---|
| Method/path | `GET /timesheets/getTimesheetEntriesByUserID/Q/A/U` |
| Input | Q self or privileged; optional page/limit. No other filter/sort. |
| Success | **200** `{outstandingTimesheetEntries,grid,pagination,message}`. Grid removes nested ai_suggestion and adds ai_status. |
| Errors | **400** paging; **500** read error; shared errors. An unknown employee can yield empty data rather than 404. |
| Source | `src/endpoints/timesheets/timesheets-router.js:149` |

### All upload summaries for employee

| Item | Contract |
|---|---|
| Method/path | `GET /timesheets/getAllTimesheetsForEmployeeByUserID/Q/A/U` |
| Input | Q self/privileged, page/limit. |
| Success | **200** `{allEmployeeTimesheets:[{employee_name,timesheet_name,time_tracker_start_date,time_tracker_end_date,created_at}],grid,pagination,message}`. |
| Errors | **400** paging; **500** read error; shared errors. |
| Source | `src/endpoints/timesheets/timesheets-router.js:187` |

### Current-month upload summaries

| Item | Contract |
|---|---|
| Method/path | `GET /timesheets/fetchTimesheetsByMonth/Q/A/U` |
| Input | Q self/privileged, page/limit. Month is server's current month; no caller month/year accepted. |
| Success | **200** `{employeeTimesheetsForMonth:[summary],grid,pagination,message}`. |
| Errors | **400** paging; **500** read error; shared errors. |
| Source | `src/endpoints/timesheets/timesheets-router.js:214` |

### Employee counts

| Item | Contract |
|---|---|
| Method/path | `GET /timesheets/countsByEmployee/A/U` |
| Input | Privileged; no paging/filter/sort. |
| Success | **200** `{timesheetsByEmployees,grid,message}`. Each employee includes pending/upload/month/AI-state counts with fields display_name, user_id, transaction_count, trackers_to_date, trackers_by_month, ai_processing_count, ai_completed_count, ai_failed_count. |
| Errors | **500** outer read failure; per-employee count failures become zero counts instead. Shared errors. |
| Source | `src/endpoints/timesheets/timesheets-router.js:247`, `src/endpoints/timesheets/timesheets-router.js:583` |

### Kick off AI

| Item | Contract |
|---|---|
| Method/path | `POST /timesheets/ai/kickoff/A/U` |
| Input | `timesheet_name` or nonempty array `entry_ids`; by-name lookup wins where supplied. IDs converted to numbers and falsy values removed. No numeric-array size limit beyond JSON size. Authenticated actor, not U, is passed to runner. |
| Success | **202** `{status,message,entryIdsCount}`; may be zero. Response means queued in this process, not completed. |
| Errors | **400** no selector; **403** ordinary caller selecting another employee; **503** account not feature-enabled; **500** lookup/system failure. |
| Source | `src/endpoints/timesheets/timesheets-router.js:88` |

### Legacy manual movement

| Item | Contract |
|---|---|
| Method/path | `POST /timesheets/moveToTransactions/A/U` |
| Input | Privileged; JSON `{entry:{...}}`; nonarray object and positive integer timesheetEntryID (or timesheet_entry_id) required. Detailed field contract below. |
| Success | **200** `{status:200,message:'Successfully moved timesheet entry to transactions.'}`; no created transaction returned. |
| Errors | **400** malformed entry/ID, foreign/missing employee or work description, invalid Time minutes/rate, or helper error with status 400. **409** pending/nondeleted claim lost, absent or already processed/deleted entry. Other failures, including helper statuses other than 400/409, are mapped to **500**. |
| Source | `src/endpoints/timesheets/timesheets-router.js:281`, `src/endpoints/timesheets/timesheets-router.js:397` |

### Delete holding entry

| Item | Contract |
|---|---|
| Method/path | `DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/A/U` |
| Input | Privileged; positive integer entry ID. |
| Success | **200** message; sets is_deleted=true. |
| Errors | **400** invalid ID; **404** no account-owned entry; **409** processed entry or conditional pending/nondeleted update matched no row (including repeat/race); **500** database error. |
| Source | `src/endpoints/timesheets/timesheets-router.js:407` |

Held-entry review, apply, reprocess counts, queued reprocessing and reviewer overrides are documented in [billing review](../invoicing/billing-review.md#3-api-reference).

### Removed AI integration

| Item | Contract |
|---|---|
| Method/path | `ALL /ai-integration/*` |
| Input | Any authenticated request; no legacy API key configuration is used. |
| Result | **410** `{message,deprecated:true,replacedBy:['/billing-review','/notifications','/time-tracking/template/latest']}`. Shared auth/rate/parser errors can occur first. |
| Source | `src/endpoints/aiIntegration/aiIntegration-router.js:9` |

The [billing-review guide](../invoicing/billing-review.md) also owns held-apply field mappings and guarded transaction corrections.

### Manual transaction field mappings

| Input | Rule |
|---|---|
| Legacy entry.customerID, customerJobID, loggedForUserID, selectedGeneralWorkDescriptionID | Number conversion; account-owned employee/GWD checked in claim transaction; customer/job checked in central ledger writer. |
| Legacy selectedRetainerID, customerInvoicesID | Number or null; central create forcibly clears invoice association. A selected retainer may fund a billable positive charge. |
| Legacy transactionType | Case-normalized Time or Charge; invalid value throws a plain Error, surfaced as 500 on this route. |
| Legacy detailedJobDescription, transactionDate, note | Nullable text, date string, nullable text respectively; database handles unsupported dates. |
| Legacy quantity, unitCost, totalTransaction, minutes | Number conversion; total absolute value. For Time, quantity/total are recomputed from explicit minutes or stored duration and explicit rate or employee.billing_rate. Positive finite minutes, nonnegative finite rate with at most two decimals; no 1,440-minute/integer limit here. Charge trusts mapped flat amount/quantity instead. |
| Legacy isTransactionBillable, isInAdditionToMonthlyCharge | True only for true or 'true'; otherwise false. Stored non-work and detected internal customer force non-billable. |
| Legacy loggedByUserID/accountID | Replaced by authenticated actor/account; cannot forge these via body. |
| Sources | `src/endpoints/transactions/transactionsObjects.js:37`, `src/endpoints/timesheets/timesheets-router.js:281`, `src/endpoints/billingReview/billingReview-service.js:247`. |

## 4. Data model

| Table | Relevant reads/writes |
|---|---|
| timesheet_entries | Entry/account/user, employee_name, timesheet_name, tracker period, date/entity/category/company/first/last/duration/notes; is_processed/is_deleted; hold_reason, ai_attempted_at, ai_payload, suggested_customer_id, matched_user_id. Duration stored integer minutes. `migrations/schema-snapshot-2026-09-22.sql:1013`. |
| ai_time_tracker_transaction_suggestions | One row per entry; own account; sanitized_notes, category/job-category/job-type/GWD/customer/entity suggestions, confidence/reason/payload/status/source/timestamps. New orchestrator persists empty sanitized_notes and null customer label/entity, with IDs/scores/reason codes in payload. `src/endpoints/timesheets/auto-ingest-orchestrator.js:420`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:824`. |
| customers, users, customer_jobs, customer_job_types, customer_job_categories, customer_general_work_descriptions | Account-scoped active reference catalogs; employee billing_rate; open parent jobs and work labels. `src/endpoints/timesheets/auto-ingest-orchestrator.js:47`, `src/ai_integrations/customerHistoricalPatterns.js:21`. |
| customer_transactions | Applied positive charge/time amount, quantity in hours for Time, cost_per_unit, customer/job/employee/GWD, date, billable/excess flags, detail/note, actor. New ingestion rows have customer_invoice_id=null. `src/endpoints/timesheets/auto-ingest-orchestrator.js:575`, `src/endpoints/transactions/sharedTransactionFunctions.js:586`. |
| customer_retainers_and_prepayments + customer_payments | Central manual-create retainer funding snapshots and negative payment, exact note marker `[retainer_draw:<draw ID>]`; auto ingestion does not select a retainer. `src/endpoints/transactions/sharedTransactionFunctions.js:131`, `src/endpoints/transactions/sharedTransactionFunctions.js:200`. |
| ai_category_training_examples | Account/entry/transaction linkage, original/final category, sanitized notes, confidence/reason/source/duration/entity; original_notes is deliberately null. FK transaction deletion sets link null. `src/endpoints/transactions/sharedTransactionFunctions.js:543`, `migrations/006.create_ai_category_training_examples.sql:1`. |
| ai_reviewer_corrections | Reviewer corrections supply recent few-shot examples; original/final values/labels, sanitized_notes, transaction/entry/reviewer IDs. `src/endpoints/timesheets/auto-ingest-orchestrator.js:111`, `migrations/012.create_ai_reviewer_corrections.sql:1`. |
| ai_call_log, accounts.ai_daily_cost_cap_usd, notifications | Estimated model tokens/cost/latency/status/S3 audit key; cap; completion/held notifications. `src/ai_integrations/bedrock/audit.js:1`, `src/endpoints/timesheets/auto-ingest-runner.js:22`. |

Ingestion does not write invoice balance-forward or aging values. Time amounts are positive even when non-billable; billable=false controls billing inclusion. Retainer credit balances and their automatic payment events are negative; drawing increases the retainer's current_amount toward zero. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:541`, `src/endpoints/transactions/sharedTransactionFunctions.js:131`.

## 5. Exact read logic

Ordinary queues select the service's safe-column list from timesheet_entries with account, is_processed=false, is_deleted=false; per-user adds user_id. They apply limit/offset **without ORDER BY**, so page stability is not guaranteed. Counts repeat matching filters. Suggestions are loaded separately by account+entry IDs and attached; held-only payload/hold columns are not in ordinary safe columns. Sources: `src/endpoints/timesheets/timesheets-service.js:1`, `src/endpoints/timesheets/timesheets-service.js:23`, `src/endpoints/timesheets/timesheets-router.js:470`.

Upload summaries filter account/user/nondeleted, include both processed and pending rows, and use ROW_NUMBER partitioned by timesheet_name ordered created_at descending; take rn=1, then newest-first with limit/offset. Count is distinct timesheet_name. Current-month summary requires the entire tracker period inside month boundaries, not merely an overlapping entry date. Source: `src/endpoints/timesheets/timesheets-service.js:161`.

Employee counts start with active users except exact display_name `Jon Kimmel`. Per employee: pending row count; distinct nondeleted upload names; fully-contained current-month upload names; and AI counts joining suggestions to pending/nondeleted entries. AI pending accepts processing/pending, completed accepts completed/applied, failed accepts failed. Current pending_review/auto_applied statuses are not included in those old buckets, and processed rows are excluded. Source: `src/endpoints/timesheets/timesheets-router.js:583`, `src/endpoints/timesheets/timesheets-service.js:79`.

Held queue requires own account, pending, nondeleted and hold_reason IS NOT NULL. It left joins suggestions by entry, suggested customer and GWD labels. Exact filters: hold reason, timesheet name, entity_equals, selected customer/employee/GWD; partial filters use case-insensitive matching for entity/employee/tracker/notes; date endpoints are inclusive; confidence uses minimum. Sort allowlist: date, entity, customer, work_description, hold_reason, hours (stored duration), employee, timesheet_name, ai_confidence, created_at. Default is created_at descending; only explicit asc selects ascending. Count repeats the filtered joined query. Source: `src/endpoints/billingReview/billingReview-service.js:29`.

Reprocess selection always filters account/pending/nondeleted. `unprocessed` means ai_attempted_at IS NULL; `errored` means hold_reason='bedrock_error'; `all_held` means non-null hold_reason. Order is created_at ascending, bounded to 2,000. Orchestrator subsequently reselects requested IDs with account/pending/nondeleted, so explicit queue IDs cannot move foreign/processed rows. Sources: `src/endpoints/billingReview/billingReview-service.js:387`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:886`.

## 6. Matching, AI decisions and calculations

### Employee/customer matching

Employee resolution: explicit reviewer logged_for_user_id from the active account catalog; otherwise the entry's validated user_id; only legacy entries without user_id use a unique normalized name match. An inactive/unmatched ID does not silently fall back to a same-named employee. Source: `src/endpoints/timesheets/auto-ingest-orchestrator.js:556`.

Customer search uses company_name, otherwise joined first+last, otherwise the one available name. **Entity is not the client match input.** A reviewer customer override must match the active account catalog. Unique exact normalized display-name match wins. Next, canonical names remove punctuation/apostrophes/connectors, normalize legal suffix spellings and compare sorted tokens, while conflicting nonempty legal forms (LLC versus Inc) are rejected. Duplicate exact/canonical names require review. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:712`, `src/ai_integrations/customerMatching.js:115`, `src/utils/fuzzyMatch.js:61`.

Fuzzy matching uses fuzzball WRatio, strictly above the default 62/100 cutoff, sorted score descending then numeric ID/label, top five. Confirmed aliases require at least two distinct qualifying reviewer confirmations and a unique customer; they still need name agreement and closeness to the best score. High fuzzy score defaults to ≥0.90, margin ≥0.08 over runner-up and at least two meaningful shared tokens or equal canonical name, with no legal-form conflict. Ambiguous high matches are held, not passed through merely because score is high. Sources: `src/utils/fuzzyMatch.js:27`, `src/ai_integrations/customerMatching.js:4`, `src/ai_integrations/customerMatching.js:185`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:79`.

Lower-score candidates can call Sonnet for a tie-break. That prompt includes the search name and candidate names/IDs. Returned customer ID must belong to the account catalog and satisfy name agreement; it is not restricted solely to the displayed top-five set. No result means no match. A prospective individual can be tagged new_individual but there is no automatic customer creation; missing customer still holds. Sources: `src/ai_integrations/customerMatching.js:185`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:749`.

### Category inference and gates

Current notes are redacted through Comprehend plus deterministic fallback, while date/minutes/category free text and opaque customer/employee tokens form the model entry. Comprehend itself receives raw notes. Category free text is not passed through that notes redactor. Customer tie-break has the separate name-bearing prompt described above; therefore “all AI input is anonymous” is not a code-supported claim. Sources: `src/utils/piiRedactor.js:22`, `src/utils/comprehend.js:46`, `src/ai_integrations/customerMatching.js:185`.

Category inference tries configured Haiku (default Claude Haiku 4.5 ID in code), max 400 tokens, then Sonnet if invalid or confidence <0.75. Auth/permission/not-found/validation failures recognized by message do not trigger model escalation. IDs must be integers from the account reference arrays or null; confidence is clamped 0–1; reason truncated to 200 characters. Category/job-type/GWD relationship consistency beyond membership is not established by this validator. Up to 150 job types and five merged recent training/reviewer examples are used by default; reviewer examples are deduplicated by notes+label. Sources: `src/ai_integrations/categoryInference.js:3`, `src/ai_integrations/categoryInference.js:93`, `src/ai_integrations/categoryInference.js:119`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:111`.

Gate order is employee match → ambiguous customer → missing customer → absent AI suggestion → missing GWD → confidence. Combined confidence is min(category confidence, customer score). Below 0.65 gives ambiguous_category; below AUTO_INSERT_CONFIDENCE_THRESHOLD (default 0.85) gives low_ai_confidence. A fuzzy_high match must also clear CUSTOMER_FUZZY_HIGH_THRESHOLD (default 0.90). Missing job and invalid duration can hold after these gates. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:12`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:664`.

Hold codes declared are no_matching_customer, low_ai_confidence, missing_required_field, ambiguous_category, new_customer_needs_addition, employee_not_matched, bedrock_error, ai_cost_cap_reached, missing_current_year_job and ambiguous_customer_match. Migration 009 additionally marks legacy pending rows legacy_pre_ai. A declared new_customer_needs_addition code does not prove the missing-name path emits it: current gate returns no_matching_customer. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:20`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:664`, `migrations/009.timesheet_entries_holding_columns.sql:1`.

### Job selection and billability

History groups customer transactions by GWD/job and counts them; billability groups by GWD/billable, with no general time cutoff for those aggregates. Recent examples separately use a 365-day lookback and up to eight deduplicated GWD examples after redaction. Parent-job candidates must be own-account/customer, open and parent_job_id null; job types are joined for labels. Source: `src/ai_integrations/customerHistoricalPatterns.js:21`, `src/ai_integrations/customerHistoricalPatterns.js:37`, `src/ai_integrations/customerHistoricalPatterns.js:91`.

Job preference order is: explicitly mentioned 20xx year in category/notes (prefer matching historical job, then label word overlap, then first candidate); monthly/payroll/bookkeeping override; established history with at least five occurrences; meaningful label/notes overlap; newest open parent. An explicit year mismatch holds. Without explicit year, the expected tax year is entry UTC year−1; a chosen older annual-job family is replaced by the current expected year's equivalent if available, otherwise held. Label token matching ignores short words and years. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:173`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:278`.

Internal customers are configured positive IDs plus exact canonical matches to account name or an established tracker entity used by at least two distinct employees by default. Entity evidence includes nondeleted entries, not only pending entries; one employee's typo is insufficient. Internal/non-work time retains hours and amount but is never billable. Other auto billability: strong administrative/payment-processing note patterns make false unless client-work overrides apply; historical GWD sample ≥5 with nonbillable fraction ≥0.70 means false, ≤0.30 means true; otherwise default true. Sources: `src/endpoints/timesheets/internal-customers.js:37`, `src/endpoints/timesheets/internal-customers.js:75`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:493`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:521`, `src/ai_integrations/customerHistoricalPatterns.js:164`.

### Six-minute pricing and retainer funding

1. Convert minutes to billed tenths of an hour: increments=ceil(minutes/6).
2. Represent hours in hundredths: quantityHundredths=increments×10.
3. Convert hourly rate to cents: rateCents=round(Number(rate)×100).
4. Compute total cents: round(quantityHundredths×rateCents/100).
5. Store quantity=quantityHundredths/100, cost_per_unit=rateCents/100, total_transaction=totalCents/100.

For 20 minutes at $150/hour: ceil(20/6)=4, quantity=0.4, total=$60. For 68 minutes at $137.50: 12 increments, 1.2 hours, $165. This rounds **up**, not to nearest six minutes. Auto conversion uses Number(rate || 0): a falsy rate becomes zero, but a truthy nonnumeric string becomes NaN; manual routes apply the stricter rate validators above. Source: `src/endpoints/timesheets/auto-ingest-orchestrator.js:541`.

Manual create with selected retainer draws only for billable positive amount. Available credit=max(0,−latest.current_amount), rounded cents; chain must belong to account/customer, be active and cover the entire amount. A $500 credit stored −500 and $60 work creates a −440 remaining snapshot and a −60 customer payment with `[retainer_draw:<snapshot ID>]`; the positive $60 work remains. Job family totals are recomputed by shared ledger code. Sources: `src/endpoints/transactions/sharedTransactionFunctions.js:131`, `src/endpoints/transactions/sharedTransactionFunctions.js:200`, `src/endpoints/transactions/sharedTransactionFunctions.js:461`.

Model cost is an **estimate from constants**, not current AWS pricing: Haiku input/output $0.80/$4 per million tokens; Sonnet $3/$15; cost rounded six decimals, unknown model price zero. Daily spend sums account ai_call_log since UTC midnight. A positive/truthy account cap holds when spend is already at/above it, before the next entry; default parallelism eight and per-batch tally omits customer tie-break cost, so this is not a hard spend ceiling. Sources: `src/ai_integrations/bedrock/cost.js:1`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:155`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:712`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:886`.

## 7. Create, edit, delete and side effects

The runner is enabled only for TIME_TRACKER_AI_FEATURE_FLAG=`on`, or `test` with account in TIME_TRACKER_AI_TEST_ACCOUNT_IDS; default/other values are off. Upload/kickoff queues `setImmediate`, not a durable queue. It processes entries with bounded concurrency, caches customer patterns within the batch, catches per-entry exceptions into bedrock_error holds, and returns completion-order perEntry results plus processed/autoInserted/held/skipped/cumulative cost. Sources: `src/endpoints/timesheets/auto-ingest-runner.js:8`, `src/endpoints/timesheets/auto-ingest-runner.js:69`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:886`.

Auto insert resolves job/employee/minutes/billability, retains original notes as the transaction detail, and supplies no invoice/retainer/excess flag. Within one database transaction it conditionally claims the entry (`is_processed=false AND is_deleted=false` → true), clears hold, calls central addNewTransaction, writes training/suggestion status auto_applied, and commits. Losing the claim skips rather than duplicating. Holds conditionally update only unprocessed entries, setting reason/attempt/payload/matches and pending_review suggestion; the hold update does not itself include is_deleted=false. Sources: `src/endpoints/timesheets/auto-ingest-orchestrator.js:458`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:575`.

Both manual routes claim entry and create transaction in the same transaction; reference-validation/ledger failure rolls back the claim. Held apply verifies customer/job/employee/GWD are account-owned; it does not additionally require active references or parent-only jobs. Central addNewTransaction clears customer_invoice_id, locks the customer row **FOR NO KEY UPDATE** before ledger decisions, validates customer/job ownership, updates job totals, creates retainer snapshot/payment if applicable and records training. This lock mode permits FK key-share checks while serializing customer ledger writers. Sources: `src/endpoints/billingReview/billingReview-service.js:247`, `src/endpoints/timesheets/timesheets-router.js:333`, `src/endpoints/transactions/sharedTransactionFunctions.js:586`, `src/endpoints/payments/ledger-helpers.js:1`.

Training insertion uses a savepoint and is best effort: an error is logged without aborting the financial transaction. Consequently the training entry→transaction link is not guaranteed even though later rerun protection consults it. A synchronous rerun locks the holding row FOR UPDATE, rejects deleted/absent entries and any live same-account transaction referenced by training, then resets processed/hold/attempt before running AI. A competitor can win the subsequent claim and produce skip. Sources: `src/endpoints/transactions/sharedTransactionFunctions.js:543`, `src/endpoints/billingReview/billingReview-service.js:459`, `src/endpoints/billingReview/billingReview-service.js:481`.

Deleting a holding row only sets is_deleted on pending/nondeleted data. It refuses processed entries and does not remove S3, suggestions or tracker ownership. Already-billed transactions are not edited through holding routes: ordinary shared transaction update/delete refuses invoice-linked rows with 423. Reprocessing is not a mechanism to revise a posted bill. Sources: `src/endpoints/timesheets/timesheets-router.js:407`, `src/endpoints/transactions/sharedTransactionFunctions.js:648`, `src/endpoints/transactions/sharedTransactionFunctions.js:766`.

After a background batch, the runner inserts in-app notifications for the triggering user and active tracker staff, deduplicated. Held rows change the title/body; otherwise it reports processed. Notification failures are logged, not rolled back with entries. Bedrock wrapper retries once for throttling or HTTP≥500 with a 500–749ms delay, uses process-local token buckets, logs metadata/hash/size by default, and best-effort writes S3/DB audit. LLM_LOG_RAW enables fallback-redacted raw logs; redaction is not proof every possible identifier was removed. Sources: `src/endpoints/timesheets/auto-ingest-runner.js:22`, `src/ai_integrations/bedrock/index.js:9`, `src/ai_integrations/bedrock/rateLimiter.js:18`, `src/ai_integrations/bedrock/audit.js:1`.

## 8. Invariants and test evidence

| Invariant or behavior | Inspected tests |
|---|---|
| Independent ceil(minutes/6) oracle, cent rounding, employee-ID precedence, ambiguity/threshold holds | `test/endpoints/timesheets/auto-ingest-orchestrator.spec.js:3`, `test/endpoints/timesheets/auto-ingest-orchestrator.spec.js:109`, `test/endpoints/timesheets/auto-ingest-orchestrator.spec.js:151`. |
| Internal customers retain hours but never auto-bill; single employee entity cannot mark customer internal | `test/endpoints/timesheets/internal-customers.spec.js:21`. |
| Flag off/on/test account behavior | `test/endpoints/timesheets/auto-ingest-runner.spec.js:3`. |
| Concurrent runs and stale reads do not double-insert; duplicate uploads; mixed holds | `test/integration/orchestrator.integration.spec.js:58`, `test/integration/orchestrator.integration.spec.js:139`, `test/integration/orchestrator.integration.spec.js:223`. Bedrock/Comprehend are stubbed in this suite. |
| HTTP account/user gates, malformed requests, manual movement and processed-delete refusal | `test/integration/coverage-timetracking-timesheets.integration.spec.js:216`. |
| Adversarial fixture prompt/artifact checks and held payloads | `test/integration/pii-leak.integration.spec.js:40`. Scope is the tested fixtures; do not extrapolate to every customer-match prompt or arbitrary category text. |
| Shared ledger operations and rollback | `test/endpoints/transactions/sharedTransactionFunctions.spec.js:1`. |

## 9. Limitations and open decisions

Restart can lose queued in-process ingestion. Counts use old suggestion statuses. Default queue paging is unordered. Rate changes affect new processing; there is no historical rate agreement lookup in this pipeline. Cost cap is approximate. The migration chain removes customer suggestion columns in 005 but current runtime requires them and the snapshot includes them; an ordered historical replay alone does not reconstruct this contract ([F30](../_review/findings.md#f30)). Sources: `src/endpoints/timesheets/auto-ingest-runner.js:69`, `src/endpoints/timesheets/timesheets-service.js:79`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:575`, `migrations/005.drop_ai_customer_suggestion_columns.sql:1`, `migrations/schema-snapshot-2026-09-22.sql:335`.

Historical accountant decisions remain: internal customers 5/6 with billable history are not repaired merely by setting INTERNAL_CUSTOMER_IDS; five no-job and nine wrong-customer job links need review; 151 historical job families can disagree with their newest totals; stale unbilled rows and credit-carry policy remain. These are dated report observations, not fresh counts. Production flag/model/IAM/cap readiness and rollout completion are not determined from the code. Sources: `scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:69`. See [operations.md](operations.md).

Coverage: **9 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
