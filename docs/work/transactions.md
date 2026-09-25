# Time and charge transactions

## Owner decision update — 2026-09-25

Pass 4 UI correction: a transaction-grid refresh preserves keyboard focus in an open form. It no longer forcibly focuses the background search field and interrupts customer selection. The same correction applies to payment and write-off grids; `GridFocus.test.js` covers all three.

Delete details can load before customer/job/employee lookup lists. They retain the stored record IDs while those lists load, then fill in the available labels. A sent record immediately shows **Sent — locked** and **Open invoice history**, with no ordinary delete control. A delete opened before another session finalizes still reaches the server, whose refusal is displayed without changing the record. `SentScreens.test.js`, `DeleteTimeOrCharge.failure.test.js` and the two-session browser case cover these paths.

Time and charge creation now guard pending submissions and display request failures while preserving form values. An empty/negative duration cannot fall back to quantity1/rate0 and save a meaningless time entry. Required customer/job/employee/work description/date and nonnegative numeric quantity/rate are checked before posting; the backend remains authoritative. Six-minute time pricing and explicit charge quantities are unchanged. `FinancialSubmission.test.js` and the real browser mistakes suite cover these paths.

A stale transaction-delete screen now displays the backend's sent-lock refusal (or request failure) and remains usable. Finalization in another session never permits deletion; `DeleteTimeOrCharge.failure.test.js` and the two-session browser case cover the error display and unchanged issued rows.

Sent stamped transactions now refuse every edit/delete and Billing Review cascade with HTTP 409 naming the invoice. Work entry for new activity is still allowed and follows existing rounding. A trigger also protects raw imports/relinks, and family/retainer side effects roll back on conflict. GET rows expose sent_locked, locked_invoice_number and locked_invoice_id; grids/forms show the lock and history link. [Contract](../invoicing/invoices.md).


## 1. Purpose and UI

Transactions record employee time or a charge against a customer and job. `/transactions/customerTransactions` renders `TransactionsGrid`; its Time and Charge dialogs use `Time.js`, `Charge.js`, `TimeOptions.js` and `ChargeOptions.js`. Customer profiles also show the customer's transactions (`../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:27`, `../DS2_Frontend/src/Pages/Transactions/TransactionGrids/TransactionsGrid.js:99`, `../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.js:93`).

The forms start with today's date, quantity1, unit cost0, billable=true, excess-to-subscription=false and no retainer (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Time.js:15`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Charge.js:12`). `/transactions/employeeTimeTrackerTransactions` and `/time-tracking/trackingAdministration` instead render `EmployeeTrackerDashboard`, which calls timesheet-count/history APIs. An active UI consumer of the older transaction endpoint `fetchEmployeeTransactions` is **not determined from the code**: its fetch wrapper exists but the dashboard-widget call is commented out (`../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/EmployeeEntrySubRoutes.js:3`, `../DS2_Frontend/src/Routes/PrimaryRouter.js:139`, `../DS2_Frontend/src/Pages/Transactions/TransactionGrids/EmployeeTrackerDashboard.js:25`, `../DS2_Frontend/src/Services/ApiCalls/FetchCalls.js:431`, `../DS2_Frontend/src/Pages/Dashboard/EmployeeTimeWidget.js:3`).

The grid requests 20 rows initially, debounces search by 300 ms, and exports all matching records rather than only the current page. The delete subroute is live; the edit subroute and edit menu are commented out, although an edit component and backend PUT exist (`../DS2_Frontend/src/Pages/Transactions/TransactionGrids/TransactionsGrid.js:15`, `../DS2_Frontend/src/Pages/Transactions/TransactionGrids/TransactionsGrid.js:194`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionSubRoutes.js:37`). Review date: 2026-09-24. Source and tests were read; no database or tests were run.

## 2. Access rules

The `/transactions` mount requires authentication and `requireManagerOrAdmin`: `manager`, `admin`, `super admin`, `owner`, case-insensitive. Frontend manager routes accept the same four roles. Authentication prefers a cookie token, falls back to Bearer, verifies the JWT and retrieves the user by subject email. Missing/invalid/expired credentials or missing user gives HTTP 401; disallowed role gives HTTP 403 (`src/app.js:131`, `src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:94`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`).

Every endpoint has `enforceAccountId`: the number-converted URL account must be an integer equal to the session account, or HTTP 403. No self-or-privileged check is installed here. URL `userID` does not filter the employee or select the actor. Create uses the session user as creator; update/delete use the session user for new funding events and preserve the entry's original creator. `loggedForUserID` is a separate caller-supplied employee ID; its account membership is not checked (`src/endpoints/transactions/transactions-router.js:6`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/transactions/transactions-router.js:55`, `src/endpoints/transactions/transactions-router.js:78`, `src/endpoints/transactions/sharedTransactionFunctions.js:712`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common transport errors: HTTP 401/403 above; HTTP 429 from the general 300/minute limiter unless test/disabled; malformed JSON HTTP 400; JSON over 1 MB HTTP 413. Uncaught errors use HTTP `err.status || 500`, production `{message:'Server error'}`, otherwise `{message,error}` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). **E500** below means HTTP 200 with `{message,status:500}`. The mutation routers discard the ledger core's intended 400/404/409/422/423 status codes when caught (`src/endpoints/transactions/transactions-router.js:63`, `src/endpoints/transactions/transactions-router.js:85`, `src/endpoints/transactions/transactions-router.js:107`).

### Create

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/transactions/createTransaction/:accountID/:userID` | Required path IDs; body `{transaction:{...}}`, fields below | HTTP 200 refresh envelope T | Common errors; E500 for invalid type/customer/job, wrong customer job, unavailable/foreign/insufficient retainer, SQL/FK/date/amount failure. A rejected postcommit refresh returns status200 with committed:true and a reload warning. `src/endpoints/transactions/transactions-router.js:49` |

### Update

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/transactions/updateTransaction/:accountID/:userID` | Required path IDs; full `{transaction:{...}}` including `transactionID` | HTTP 200 T, optional `warning` | Common errors; E500 for missing/changed entry, customer move, stored invoice link, invalid job, all funding refusals listed in section 7, invalid fields or SQL failure; postcommit refresh failure returns committed success. `src/endpoints/transactions/transactions-router.js:73` |

### Delete

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/transactions/deleteTransaction/:accountID/:userID` | Required path IDs; body `{transaction:{transactionID,customerID}}`. Identity fields are required; pricing and type are not required and cannot override stored values. If an optional transactionType is supplied, it must still be Time/Charge. | HTTP 200 T, optional `warning` | Common errors; E500 for missing/changed/wrong-customer entry, billed entry/payment/draw, ambiguous/inconsistent funding, absent job/customer, SQL failure; postcommit refresh failure returns committed success. Stored amounts/job/retainer decide deletion, not body copies. `src/endpoints/transactions/transactions-router.js:95`, `src/endpoints/transactions/sharedTransactionFunctions.js:758` |

### Paginated list

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/transactions/getTransactions/:accountID/:userID` | Required path IDs; optional `page=1`, `limit=20`, `search=''` | HTTP 200 `{transactionsList:{activeTransactionsData:{activeTransactions:[joinedRow],grid,pagination,searchTerm}},message,status:200}` | Common errors; actual HTTP 400 invalid pagination; actual HTTP 500 query/serialization failure. `src/endpoints/transactions/transactions-router.js:117` |

`page` and `limit` use `parseInt(...,10)`; NaN or values below 1 fail, limit is capped at 500. Thus numeric prefixes/fractions are truncated rather than strictly rejected. Offset is `(page-1)*cappedLimit`; metadata is `{page,limit,totalItems,totalPages:ceil(totalItems/limit)}`. Search is trimmed only if a string; other types become empty. No sort, customer, billable or date query parameter is implemented (`src/utils/pagination.js:6`, `src/endpoints/transactions/transactions-router.js:242`).

### CSV export

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/transactions/exportTransactions/:accountID/:userID` | Required path IDs; optional string `search=''`. No pagination/limit | HTTP 200 `text/csv`, attachment `transactions_YYYYMMDD_HHmmss.csv` | Common errors; actual HTTP 500 for query/CSV failure, including a non-string nonempty search that has no `.trim()`. `src/endpoints/transactions/transactions-router.js:151`, `src/endpoints/transactions/transactions-service.js:23` |

### Detail

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID` | Required path IDs; customer and transaction IDs must number-convert to positive safe integers | HTTP 200 `{activeTransactionsData:{transactionData:[rawRow],grid},message,status:200}` | Common errors; HTTP 200 `{message:'No matching transaction record found.',status:404}` for invalid/missing/foreign/mismatched IDs; E500 for read failure. `src/endpoints/transactions/transactions-router.js:176` |

### Employee time

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID` | All path fields required; dates passed through dayjs `.format()`, no explicit validity/range check | HTTP 200 T plus `userTime:[{user,time,customers:[{customer,time,jobs:[{job,time,transactions:[...]}]}]}]` | Common errors; E500 for query/date failure; refresh failure returns E500 without a committed flag. Inverted valid range simply finds no matching time. `src/endpoints/transactions/transactions-router.js:209`, `src/endpoints/transactions/transactionLogic.js:1` |

Refresh **T** is `{transactionsList,accountRetainersList:{activeRetainerData:{activeRetainers,grid,treeGrid}},accountJobsList:{activeJobData:{activeJobs,grid,treeGrid}},paymentsList:{activePaymentsData:{activePayments,grid}},message:'Successful.',status:200,warning?,userTime?}`. Transactions reset to page 1, limit 20, empty search; other lists are unpaginated. No newly created transaction ID is returned separately (`src/endpoints/transactions/transactions-router.js:242`, `src/endpoints/transactions/transactions-router.js:265`).

| Transaction field | Actual type, requirement, and limit |
|---|---|
| `transactionID` | Required for update/delete; number-coerced positive integer, owned row required. |
| `customerID` | Required number-coerced positive integer; owned customer required; immutable on update. |
| `customerJobID` | Required for create/update; number-coerced existing job in same account and customer. Completed/inactive-type jobs are not rejected. |
| `loggedForUserID` | Required create/update integer FK; must belong to the verified account; inactive historical users remain allowed. |
| `selectedGeneralWorkDescriptionID` | Required create/update integer FK; must belong to the verified account; inactive descriptions remain allowed. |
| `transactionType` | Required, string trimmed and case-normalized to `Time` or `Charge`; other values throw. Also required on delete. |
| `transactionDate` | Required create/update, coerced with `String`; database DATE must accept it. UI sends `YYYY-MM-DD`; no future-date/period lock validation. |
| `quantity` | Number, numeric(10,2). Required finite nonnegative value with at most two decimals. Direct Time entries without minutes accept decimal hours, including 0.25; they are not re-rounded. Zero remains zero on update. If minutes are supplied, quantity must equal duration rounded up to six minutes. |
| `unitCost` | Number, numeric(10,2); required finite nonnegative value with at most two decimals; no rate lookup. |
| `totalTransaction` | Required finite nonnegative cents amount equal to quantity × rate rounded to cents. Shared create/update rejects inconsistent values before ledger writes. |
| `selectedRetainerID` | Optional number, `Number(value) \|\| null`. Used only when billable and rounded amount >0; otherwise create stores null. Must resolve to own customer's chain when used. |
| `isTransactionBillable`, `isInAdditionToMonthlyCharge` | Optional, default false; only boolean true or string `'true'` maps true. `1`, `'1'`, `'false'`, false map false. |
| `detailedJobDescription`, `note` | Optional text; null/undefined/empty string becomes SQL null; other values become strings. Literal `'null'`/`'undefined'` remain text. |
| `accountID`, `account_id`, `loggedByUserID` | Caller values do not override trusted route account/session creator. Original created-at/creator survive update. |
| `customerInvoicesID` | Ignored: create forces null; update never includes invoice column. Only billing can attach it. |
| `timesheetEntryID`, `selectedGeneralWorkDescription.general_work_description`, `category`, `aiSuggestion`, `minutes`, `entity` | Optional create-time training metadata; mapper described in section 7. Supplied minutes must agree with Time quantity after six-minute rounding. |

Field rules: `src/endpoints/transactions/transactionsObjects.js:9`, `src/endpoints/transactions/transactionsObjects.js:24`, `src/endpoints/transactions/transactionsObjects.js:37`, `src/endpoints/transactions/transactionsObjects.js:61`, `src/endpoints/transactions/sharedTransactionFunctions.js:543`, `migrations/schema-snapshot-2026-09-22.sql:758`. Bodies undergo recursive string XSS filtering, not schema validation (`src/utils/sanitizeFields.js:8`). PUT is a full form mapping; omitted fields can reset values or fail SQL.

## 4. Data model

| Table | Columns and use |
|---|---|
| `customer_transactions` | All mapped fields above; `transaction_id`, account/customer/job/retainer/invoice IDs; employee/description IDs; DATE `transaction_date`; numeric(10,2) quantity/unit/total; billable/excess flags; audit timestamp/creator; two note fields. Writes create/update/delete (`migrations/schema-snapshot-2026-09-22.sql:758`). |
| `customers` | Account/customer ownership and ledger row lock; display/business/name on reads. Active and customer-level billable flags do not gate the direct core (`src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/transactions/transactions-service.js:12`). |
| `customer_jobs`, `customer_job_types`, `customer_job_categories` | Job ownership, family IDs, cumulative snapshot insert; labels/rates in reads. See [jobs.md](jobs.md) for all copied columns (`src/endpoints/transactions/sharedTransactionFunctions.js:461`, `src/endpoints/job/job-service.js:106`). |
| `customer_retainers_and_prepayments` | Root/parent IDs, account/customer, `current_amount`, active flag, actor and timestamp. New draw/compensation, running-balance edits, exact draw deletion (`src/endpoints/transactions/sharedTransactionFunctions.js:117`, `src/endpoints/transactions/sharedTransactionFunctions.js:150`). |
| `customer_payments` | Account/customer/job/retainer/invoice, date, amount, form/reference, billable flag, creator, created-at and note; auto payment insert/update/delete (`src/endpoints/transactions/sharedTransactionFunctions.js:200`, `src/endpoints/transactions/sharedTransactionFunctions.js:407`). |
| `customer_invoices` | Newest parent and timestamp only for funded-entry edit/delete gates; no direct parent/snapshot writes here (`src/endpoints/transactions/sharedTransactionFunctions.js:354`, `src/endpoints/payments/payment-logic.js:66`). |
| `users`, `customer_general_work_descriptions` | Employee display/rate data and work-description label; list joins and training label (`src/endpoints/transactions/transactions-service.js:3`, `src/endpoints/transactions/sharedTransactionFunctions.js:547`). |
| `ai_category_training_examples` | Best-effort category/provenance record on create. Its transaction FK and `ai_reviewer_corrections.transaction_id` become null when a transaction is deleted (`migrations/schema-snapshot-2026-09-22.sql:261`, `migrations/schema-snapshot-2026-09-22.sql:1758`, `migrations/schema-snapshot-2026-09-22.sql:1790`). |

Transaction create/update converts totals to absolute values. Retainer available funds are negative `current_amount`; a draw increases that signed balance toward zero. Its payment is negative and credits billing. The transaction stores **draw ID D**, while the payment stores the **retainer root ID** and note marker `[retainer_draw:D]`. Transaction note fields get no generated marker (`src/endpoints/transactions/transactionsObjects.js:53`, `src/endpoints/transactions/sharedTransactionFunctions.js:150`, `src/endpoints/transactions/sharedTransactionFunctions.js:200`). Ordinary ID FKs do not prove tenant equality; transaction customer/invoice/retainer columns have no corresponding FKs in the reference snapshot (`migrations/schema-snapshot-2026-09-22.sql:2066`).

## 5. Read logic

| Read | Query, order, and reduction |
|---|---|
| Account list/export | Select transactions.*, customer display label, employee label, description label, job type ID and type label. INNER JOIN customers, users and jobs; LEFT JOIN general descriptions and types. Filter transaction account and require account equality on all joined tables; the job must match the transaction customer. No billable, invoiced, employee-active or customer-active filter. Order transaction `created_at DESC`, no tie-breaker (`src/endpoints/transactions/transactions-service.js:1`, `src/endpoints/transactions/transactions-service.js:47`). |
| Search | AND one grouped OR: lowercase LIKE on customer label, type, detail, general description, job description, employee label; text casts of transaction/invoice/customer/job IDs, total and quantity; transaction date formatted YYYY-MM-DD. Parameters prevent SQL injection; `%` and `_` retain wildcard meaning. `note`, unit cost and retainer ID are not searched (`src/endpoints/transactions/transactions-service.js:20`). |
| Pagination | Clone joined/filtered query for `COUNT(*)`; separately fetch ordered LIMIT/OFFSET rows. Count and rows are not a single snapshot. Export uses same joins/search without LIMIT (`src/endpoints/transactions/transactions-service.js:51`). |
| Detail | Raw transaction columns by account+customer+transaction ID, no joins (`src/endpoints/transactions/transactions-service.js:132`). |
| Customer profile | Transaction columns and labels; all five joins are INNER, including general description/type. Filter transaction account/customer; order created-at DESC. A malformed historical link can hide a row here that appears in another raw read (`src/endpoints/transactions/transactions-service.js:107`). |
| Employee dates | Transactions.* plus customer names, job quote/agreed/current/status/notes and type description/book-rate/estimate. INNER JOIN customers/jobs, LEFT JOIN types. Filter transaction account and inclusive transaction dates >=start, <=end; no SQL ordering. Load all account active users separately, then group Time only (`src/endpoints/transactions/transactions-service.js:82`, `src/endpoints/user/user-service.js:2`, `src/endpoints/transactions/transactions-router.js:216`). |
| Job totals/guards | Raw account transactions with job ID equal to one ID or IN family IDs, no billable/invoice/date filter (`src/endpoints/transactions/transactions-service.js:143`). |
| Retainer funding | Resolve account root via selected row's parent or ID, then account rows with ID=root OR parent=root, ordered created-at ASC, ID ASC. Validate every returned row's customer. The picker instead selects latest row per coalesced parent/ID and requires active and current_amount<0 (`src/endpoints/retainer/retainer-service.js:38`, `src/endpoints/retainer/retainer-service.js:46`, `src/endpoints/retainer/retainer-service.js:71`). |
| Refresh lists | Retainers: account rows INNER JOIN customer/creator, created-at DESC, including inactive/history. Jobs: all joined account versions, created-at ASC. Payments: account rows INNER JOIN customer/creator, created-at DESC. These names do not imply active-only filters (`src/endpoints/retainer/retainer-service.js:10`, `src/endpoints/job/job-service.js:22`, `src/endpoints/payments/payments-service.js:1`). |

CSV columns, in order: `transaction_id`, `customer_id`, `customer_name`, `transaction_type`, `quantity`, `unit_cost`, `total_transaction`, `customer_invoice_id`, `retainer_id`, `is_transaction_billable`, `is_excess_to_subscription`, `transaction_date`, `created_at`, `logged_for_user_name`, `job_description`, `general_work_description`, `detailed_work_description`. Empty results still contain headers. Null is empty, Date becomes ISO, CSV quoting escapes quotes/commas/newlines. Formula-like text beginning `= + - @ TAB CR` gets an apostrophe; legitimate numeric strings such as `-225.00` remain numeric (`src/endpoints/transactions/transactions-router.js:20`, `src/endpoints/transactions/transactions-router.js:305`, `src/endpoints/analytics/csv-util.js:25`).

## 6. Calculations

### Manual time and charges

The hours input converts hours to `Math.round(hours*60)` minutes. For a positive manual duration M, whole hours plus `ceil(remainderMinutes/6)/10` is equivalent to `ceil(M/6)/10` hours. Selected employee `billing_rate` becomes unit cost. The submitted minutes retain the raw entered duration. Display and the post builder use integer-hundredth × integer-cent pricing rounded once to cents; Charge uses caller-entered quantity and unit cost. Missing employee or falsy/NaN duration resets quantity=1, unitCost=0, minutes=null (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/TimeOptions.js:64`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/TimeTrackingIncrements.js:4`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:20`, `../DS2_Frontend/src/Services/SharedPostObjects/SharedPostObjects.js:53`).

Examples at $150/hour: 1 minute ->0.1h->$15; 60 minutes ->1h->$150; 63 minutes ->1.1h->$165; 68 minutes ->1.2h->$180. The timer branch now uses the same ceiling formula directly on elapsed minutes; the former extra minute was removed. See the run3 boundary tests and owner time-increment audit.

Tracker ingestion and held-entry application calculate server-side: `quantityHundredths=ceil(Number(minutes)/6)*10`; `rateCents=round(Number(rate||0)*100)`; `totalCents=round(quantityHundredths*rateCents/100)`; return quantity/100, rate/100 and total/100. These flows require finite positive duration before applying. The shared transaction core verifies finite nonnegative cents pricing, `round2(quantity*unitCost)=totalTransaction`, and agreement with supplied minutes rounded up to six minutes ([F11](../_review/findings.md#f11)). A direct entry with absent/null/empty minutes can use two-decimal hours: 0.25 hours × $75 = $18.75 remains unchanged. Supplying 15 minutes instead requires 0.3 hours and $22.50 at that rate. The UI and tracker duration calculators retain their six-minute policy (`src/endpoints/transactions/transactionPricing.js`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:541`, `src/endpoints/billingReview/billingReview-service.js:290`).

### Billable, recurring and internal work

The form toggles recurring-customer work non-billable when it is not in addition to the monthly charge, and billable when it is additional. Otherwise it keeps the current flag. The operator also has a billable checkbox. Time/Charge effects do not include selected customer as a dependency; these are form defaults, not backend enforcement. The invoice sum uses `is_transaction_billable`; it does not require the excess-to-subscription flag (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:7`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/TimeOptions.js:22`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/ChargeOptions.js:9`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:81`).

Internal IDs combine positive integer `INTERNAL_CUSTOMER_IDS` entries with account-scoped customers whose canonical display/business name equals the account name or an entity used by at least `INTERNAL_ENTITY_MIN_EMPLOYEES` distinct employees (valid positive integer, default 2). Entity counts use nondeleted timesheet entries, grouped by entity, with non-null entity. Canonical names use NFKC/lowercase, remove apostrophes, turn ampersand into and and other punctuation into spaces, normalize corporation/incorporated/company/limited spellings, remove legal suffixes and and/the/of, then sort remaining tokens. Empty name keys never match (`src/endpoints/timesheets/internal-customers.js:28`, `src/endpoints/timesheets/internal-customers.js:47`, `src/endpoints/timesheets/internal-customers.js:75`, `src/utils/fuzzyMatch.js:64`).

Auto-ingestion decides billability in order: non-work false; internal false; admin-only note pattern false unless a client-work pattern is also present; historical work-description preference; otherwise true. History counts all account/customer transactions by description and billable flag, without a date filter. At least 5 samples and >=70% non-billable gives false; >=70% billable gives true; mixed/insufficient history falls through. Manual tracker approval and billing review force internal work false. Shared direct and tracker create/update forces nonbillable when the internal resolver matches or `customers.is_billable=false`, under the customer ledger lock before any retainer funding ([F12](../_review/findings.md#f12)) (`src/endpoints/timesheets/auto-ingest-orchestrator.js:500`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:521`, `src/ai_integrations/customerHistoricalPatterns.js:62`, `src/ai_integrations/customerHistoricalPatterns.js:160`, `src/endpoints/timesheets/timesheets-router.js:310`, `src/endpoints/billingReview/billingReview-service.js:314`, `src/endpoints/transactions/sharedTransactionFunctions.js:596`).

Non-work detection checks category, then entity, then notes. It normalizes NFKC/lowercase/punctuation/whitespace. Whole category/entity labels match paid time off, PTO, vacation, holiday, sick, lunch, out of [the] office, OOO, personal or doctor, optionally prefixed paid and followed by day/days/time/leave/hour(s)/hr(s)/break/appointment/appt/errand/off/request/visit. Notes must start with an allowed absence phrase; immediate work-object words such as pay/payroll/schedule/form/letter/report cancel that match (the full allow-list is in source), as do lunch followed by with/meeting/and/n/presentation/seminar. A bare doctor note is not enough; appointment/appt/visit is required. This avoids treating client payroll or lunch meetings as absence (`src/timeTrackerValidation/nonWorkEntries.js:18`, `src/timeTrackerValidation/nonWorkEntries.js:31`, `src/timeTrackerValidation/nonWorkEntries.js:40`, `src/timeTrackerValidation/nonWorkEntries.js:44`, `src/timeTrackerValidation/nonWorkEntries.js:75`). Admin-only patterns cover processing checks/payments/deposits/bank work, depositing checks, verifying invoices, posting payments, scanning/filing, reviewing checks, or emailing/notifying listed staff; client meeting/call/tax-return preparation/review patterns override them (`src/endpoints/timesheets/auto-ingest-orchestrator.js:500`).

### Job-family totals and invoice membership

Before inserting/deleting/changing amount, sum **all** account transaction totals for root plus direct versions and add the proposed delta. Insert a job snapshot with this total and root parent. Non-billable time counts toward this stored job total; payments/write-offs do not. For cross-family moves subtract old amount from old family and add new amount to destination family. Same-family moves apply only the amount difference; zero-delta moves create no total snapshot. No explicit rounding occurs inside the family reducer; numeric(10,2) storage applies (`src/endpoints/transactions/sharedTransactionFunctions.js:461`, `src/endpoints/transactions/sharedTransactionFunctions.js:704`). Example: $100 billable + $50 non-billable + new $25 = $175 job total; invoice charge contribution is $125.

The invoice query selects every unbilled customer transaction (`customer_invoice_id IS NULL`), with transaction_date on or before the billing date and no lower date bound, INNER JOIN jobs/types. It selects transaction columns last so their customer ID wins over joined columns. Rows without a job/type join disappear. Downstream grouping is by exact job ID, not family root; billable totals are summed, non-billable rows remain detail only. When write-offs are hidden as separate lines, signed negative job credits reduce job totals; adjustment-only groups allow credits without new work (`src/endpoints/invoice/invoice-service.js:263`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:1`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:20`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:65`).

### Retainer arithmetic

`round2(x)=Math.round((Number(x)+Number.EPSILON)*100)/100`. Funding requires billable=true, a selected retainer and rounded amount >0. Available funds=`round2(max(0,-latest.current_amount))`; latest must be active, available positive and enough for the entire entry. No partial draw is created. Draw balance=`round2(latest.current_amount+amount)`; active=`balance<0`; auto payment=`-round2(amount)` (`src/endpoints/payments/ledger-helpers.js:11`, `src/endpoints/transactions/sharedTransactionFunctions.js:131`, `src/endpoints/transactions/sharedTransactionFunctions.js:494`).

Example: $500 available is stored −500. A $120 entry inserts draw −380 and payment −120. Another $80 draw leaves −300. Repricing the first to $150 shifts its draw and every later balance by +30: −350 and −270. Removing that first exact draw returns its full $150 to all later balances and deletes its payment; remaining balance is −420. An increase cannot exceed the smallest available balance from the affected draw through the latest snapshot (`src/endpoints/transactions/sharedTransactionFunctions.js:163`, `src/endpoints/transactions/sharedTransactionFunctions.js:173`, `src/endpoints/transactions/sharedTransactionFunctions.js:385`, `src/endpoints/transactions/sharedTransactionFunctions.js:396`).

### Employee totals

Start with every active account user at zero. Accept case-insensitive Time rows; skip entries attributed to inactive/absent users. Group by employee ID, then **customer display name**, then **job description**, and add Number(quantity), rounding to two decimals after every addition. Billability does not affect hours. Duplicate names/descriptions merge their displayed groups. Users with no matching time still appear. The `user` member is the active-user service's full row (`src/endpoints/transactions/transactionLogic.js:1`, `src/endpoints/user/user-service.js:2`).

## 7. Create, edit, and delete

Create parses before locking, forces invoice=null, joins an existing knex transaction or starts one, and locks the owned customer `FOR NO KEY UPDATE`. It verifies job, employee and description ownership before writes, plans any retainer funding, inserts job snapshot, inserts retainer draw if funded, inserts transaction, inserts linked payment, then attempts training. Draw/payment timestamps use PostgreSQL `clock_timestamp()` **after** lock acquisition; transaction created-at is the mapper's earlier JavaScript Date. Any core failure rolls all core writes back (`src/endpoints/payments/ledger-helpers.js:21`, `src/endpoints/payments/ledger-helpers.js:30`, `src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/transactions/sharedTransactionFunctions.js:586`).

Update/delete first find the account-owned stored entry, lock its owning customer, and reread the entry `FOR NO KEY UPDATE`. Missing entry/customer, changed customer while waiting, or wrong submitted customer refuses. Update cannot move customers: delete and re-enter is the stated remedy, subject to billed-delete refusal. Customer and job active/completed flags do not prevent direct writes (`src/endpoints/transactions/sharedTransactionFunctions.js:520`, `src/endpoints/transactions/sharedTransactionFunctions.js:640`).

Any truthy stored transaction invoice ID blocks **all** update/delete, even a note-only change. Client invoice fields cannot clear it. For an unbilled funded entry, a payment is considered billed if it has any non-null invoice ID or its stored timestamp is <= the newest statement's timestamp. The comparison occurs in PostgreSQL, preserving microseconds. Newest parent includes null-parent or self-parent rows ordered invoice date DESC, created-at DESC, ID DESC. This is a creation-time membership gate, not the performed date (`src/endpoints/transactions/sharedTransactionFunctions.js:80`, `src/endpoints/transactions/sharedTransactionFunctions.js:648`, `src/endpoints/transactions/sharedTransactionFunctions.js:766`, `src/endpoints/payments/ledger-helpers.js:119`, `src/endpoints/payments/payment-logic.js:66`).

| Funding transition | Exact behavior |
|---|---|
| Unfunded -> billable positive with retainer | Validate full availability; insert draw/payment; new events use current authenticated actor. |
| Funded -> non-billable or zero | Resolve link, require unbilled payment/draw; undo draw; delete auto payment; set transaction retainer null. |
| Funded -> still billable positive, retainer cleared | Refuse; user must make non-billable or delete/re-enter. |
| Funded -> another root | Refuse. Another version ID in the same root is acceptable; stored draw ID is retained. |
| Funded amount/date/job change | Validate linked payment is unbilled; sync payment amount/date/job. Amount change also validates/reprices draw. Date/job-only edits do not reprice draw. |
| Funded metadata-only edit | Retainer ownership/root still checked. Payment lookup/billed gate is not run if amount, date, job and funding are unchanged; original audit fields survive. |
| Delete funded entry | Validate stored funding; recompute job total minus old total; return draw amount, delete transaction and auto payment atomically. |

Transitions and refusal messages: `src/endpoints/transactions/sharedTransactionFunctions.js:54`, `src/endpoints/transactions/sharedTransactionFunctions.js:494`, `src/endpoints/transactions/sharedTransactionFunctions.js:673`, `src/endpoints/transactions/sharedTransactionFunctions.js:712`, `src/endpoints/transactions/sharedTransactionFunctions.js:758`.

Exact linkage searches this account/customer's payment notes for `[retainer_draw:storedRetainerID]`. More than one refuses. The payments resolver must confirm chain, customer and draw; payment amount must equal negative old transaction amount. For a moving/removable draw, its index must be after a prior chain row, have a parent, its balance movement must equal old entry total, no other transaction may share it, and it must not already be on a statement. Any mismatch refuses for support reconciliation (`src/endpoints/transactions/sharedTransactionFunctions.js:282`, `src/endpoints/transactions/sharedTransactionFunctions.js:329`, `src/endpoints/transactions/sharedTransactionFunctions.js:354`, `src/endpoints/payments/ledger-helpers.js:377`).

Legacy linkage falls back to account+customer, form `Retainer`, exact negative absolute amount, same calendar payment/performed date, and same resolved chain; payments bearing another draw marker are excluded. Multiple candidates refuse. One unbilled match is updated/deleted. No match permits the operation with `This transaction is linked to a retainer but no matching retainer payment record was found; nothing to sync.` Legacy changes append a compensating snapshot against the latest balance instead of changing/deleting an unidentified draw. Increases use latest headroom only (`src/endpoints/transactions/sharedTransactionFunctions.js:247`, `src/endpoints/transactions/sharedTransactionFunctions.js:296`, `src/endpoints/transactions/sharedTransactionFunctions.js:185`, `src/endpoints/transactions/sharedTransactionFunctions.js:375`).

Training inserts inside a nested savepoint; failure is logged and does not abort financial creation. Fields: owned account, optional timesheet ID, created transaction ID, original/suggested/final category (label if supplied, else ID string), AI reason/confidence/source (default `ai`), original_notes=null, supplied sanitized_notes, numeric minutes or null, entity, uploaded=false. No raw main transaction notes are copied to this training column. There is no training update/delete on transaction edit; deleting a transaction nulls the training/correction FKs (`src/endpoints/transactions/sharedTransactionFunctions.js:543`, `migrations/schema-snapshot-2026-09-22.sql:1758`, `migrations/schema-snapshot-2026-09-22.sql:1790`).

Ingestion callers claim a timesheet entry in their own transaction before invoking this shared core: require owned, is_processed=false, is_deleted=false; set processed=true, clear hold, set matched employee/suggested customer, and refuse when no row was claimed. Their core writes join that same transaction, preventing duplicate apply. Auto-ingestion supplies no retainer/invoice link, uses raw entry notes as main work description, and supplies separately sanitized training notes (`src/endpoints/timesheets/auto-ingest-orchestrator.js:600`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:621`, `src/endpoints/billingReview/billingReview-service.js:318`). Direct API create has no idempotency key/duplicate-work precheck; its lock serializes two submits but does not deduplicate them (`src/endpoints/transactions/sharedTransactionFunctions.js:586`).

These handlers do not synchronize invoice parent balances/snapshots: billed changes are refused instead. They do not create S3 objects or send notifications. List refresh happens after financial commit, so a refresh error does not imply rollback (`src/endpoints/transactions/transactions-router.js:60`, `src/endpoints/transactions/sharedTransactionFunctions.js:730`, `src/endpoints/transactions/transactions-router.js:265`).

## 8. Invariants, edge cases, and tests

| Rule | Source-read test evidence |
|---|---|
| Canonical type, false flags, null text, original audit preservation | `test/endpoints/transactions/transactionsObjects.spec.js:1`; real false-flag regression `test/integration/transactions-ledger-seams.integration.spec.js:840`. |
| Account/customer/job guards; client invoice spoof ignored; billed mutation refused | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:488`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:501`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:659`. |
| Locking and all-or-nothing financial writes; training failure isolated | `test/integration/transactions-ledger-seams.integration.spec.js:237`, `test/integration/transactions-ledger-seams.integration.spec.js:872`. |
| Funding, own-customer retainer, session actor for draw/compensation | `test/integration/transactions-ledger-seams.integration.spec.js:389`, `test/integration/transactions-ledger-seams.integration.spec.js:574`, `test/integration/transactions-ledger-seams.integration.spec.js:650`, `test/integration/transactions-ledger-seams.integration.spec.js:740`. |
| Family totals, cross-family move, same-family move counts delta once | `test/endpoints/transactions/sharedTransactionFunctions.spec.js:143`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:542`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:563`. |
| Ambiguous funding and funding transition decisions | `test/endpoints/transactions/sharedTransactionFunctions.spec.js:208`, `test/endpoints/transactions/sharedTransactionFunctions.spec.js:331`. |
| Paging, cap, search, signed numeric CSV and formula neutralization | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:702`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:753`. |
| Invalid detail ID is body 404; employee attribution/zero roster | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:838`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:859`, `test/endpoints/transactions/transactionLogic.spec.js:1`. |
| Rounded minutes/rate changes and internal resolver | `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.test.js:7`, `test/endpoints/timesheets/internal-customers.spec.js:1`. |

## 9. Limitations and open decisions

See [consolidated findings](../_review/findings.md): [F2](../_review/findings.md#f2) is fixed by reference validation and scoped label joins (regression `review-related-ids.integration.spec.js`); [F10](../_review/findings.md#f10) fixed by copying the latest family metadata (created_at then ID order), [F11](../_review/findings.md#f11) fixed by shared numeric, increment and arithmetic validation, [F12](../_review/findings.md#f12) fixed by shared customer/internal billability policy. F2 and F10–F12 were reproduced and verified in the local fixture account. Limits above come from source and the schema reference, not an independently inspected live schema (`migrations/README.md:1`).

The prior review reports 5 billable jobless entries ($365), 9 cross-customer job links, 51 customers with about $14.8K stale unbilled work, 151 mismatched job-family totals, and roughly $1.43M of legacy billable internal work on customers 5/6. These are historical report figures. The accountant must decide treatment; current guards/calculations do not repair every old record (`scripts/review-2026-09/FINAL_REPORT.md:51`, `scripts/review-2026-09/FINAL_REPORT.md:55`).

The report also flags duplicate statements, bill-day write-off inclusion/sign exceptions, invoice parent/snapshot disagreement, a suspected double retainer subtraction, negative-statement credit carry, and statement-age versus oldest-charge aging. Owner decisions now provide sent-record locks, narrow bounced-payment exceptions, duplicate review and optional signed credit statements. Broader account-period policies, general void/reissue workflows and persisted billing runs remain separate work (`scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:59`). Rollout requires reviewed migrations/backups and 019 rehearsal, 020/021 ordering and tracker backfill, backend before frontend, plus explicit `INTERNAL_CUSTOMER_IDS` and `BILLING_TIMEZONE=America/Phoenix` review (`scripts/review-2026-09/FINAL_REPORT.md:67`).

Coverage: **7 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F2 verification: `test/integration/review-related-ids.integration.spec.js` covers forged related IDs on create/update, session creators, preserved update attribution, and historical malformed label joins. No historical production-copy rows are repaired by this change.

F11 verification: `review-transaction-policy.integration.spec.js` covers create/update rejection without ledger writes, supplied-duration mismatches, direct decimal-hour create/update with preserved cents/notes, and zero-quantity/Charge arithmetic. `finalize-engine.integration.spec.js` preserves the original 0.25 hours, $18.75 and NULL notes through statement creation. CSV export still preserves negative numeric rates in historical rows; new direct entries require nonnegative pricing. Billing Review retains its separately documented explicit total override for historical corrections.

## Pass 2 retry and export verification

Create/update/delete list-refresh failures after commit return status200, `committed:true` and an explicit reload-without-resubmission warning. Read-only employee report failures remain failures; they never claim a saved change. The invoice query defers future-dated work until the Phoenix billing date, while preserving older unbilled work. CSV descriptions beginning =,+,-,@,tab or CR are exported as text, quoted cells and unicode round-trip, and numeric amounts stay numeric. See [what-if scenarios](../scenarios/what-if-and-mistakes.md) for red/green evidence and exact oracles.


## Owner run 2 — retainers and duplicate review

The manual creation route runs duplicate detection inside the same transaction as job totals, funded draws and auto payments. Same customer/type/job/employee/description/quantity/rate/billability/amount and date within three days can produce a visible badge. Known tracker-linked rows are excluded. Flag/dismiss leaves work unchanged; removal invokes `deleteTransactionCore` and preserves sent/dependency checks. Event-bearing retainer snapshots cannot be rewritten by an earlier draw correction. See [duplicate review](../ledger/duplicates.md).

## Owner run 3

Manual duration pricing, tracker ingestion and held review use ceil(minutes/6)/10 hours and integer-cent multiplication. Direct supplied duration must match quantity; explicit quantity without duration preserves the existing decimal-hour contract. Manual edit preserves loaded quantity; frontend display/post use the same half-cent rule. Boundary scenarios cover1,6,7,14,15,16,59,60,61 minutes. See the [owner decisions](../decisions/2026-09-24-owner-decisions.md) and [combined scenario](../scenarios/16-owner-combined.md).


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.
