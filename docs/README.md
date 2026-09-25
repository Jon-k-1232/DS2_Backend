# DS2 documentation

Reviewed against the local source on 2026-09-24.

DS2 is an account-scoped practice management and billing application. It connects customer and job records, staff time, invoice statements, payments, retainers and receivables. The browser lives in DS2_Frontend, the Express API in DS2_Backend, and the payment-image processor in DS2_Lambdas. This documentation describes their checked-out implementation, including known defects. It does not certify a deployed environment.

## How to read these docs

1. Read [architecture](architecture.md) for the request flow, main records and month-end cycle.
2. Read [ledger conventions](ledger/ledger-conventions.md) before interpreting balances or changing financial records.
3. Open the owning feature guide from the catalog or endpoint index. Its API section defines inputs, responses, role checks and errors. Calculation and edit sections describe what the code actually does.
4. Read [consolidated findings](_review/findings.md) for confirmed inconsistencies and proposed fixes. The four original review files remain historical evidence; their overlapping endpoint totals are superseded here.

Source citations use `path:line`, relative to DS2_Backend. A `../DS2_Frontend/` or `../DS2_Lambdas/` prefix identifies a sibling repository. Test references describe inspected assertions unless explicitly labeled as an earlier executed helper check. This consistency pass did not run tests, services, database operations or cloud calls.

Every endpoint has exactly one owning **feature** contract. Supporting guides cross-link it. The index repeats only method, path, role and ownership for navigation; it is not a second contract. Some guides abbreviate `A=:accountID`, `U=:userID` and `Q=:queryUserID`; this index expands them.

## Document catalog

| Document | Description | Owned endpoints |
|---|---|---:|
| [README.md](README.md) | Reading guide, complete document catalog, router ownership and endpoint index. | — |
| [architecture.md](architecture.md) | Request flow, data relationships, background work, storage and month-end lifecycle. | — |
| [ledger/ledger-conventions.md](ledger/ledger-conventions.md) | Shared signs, rounding, invoice/retainer chains, markers and ledger locks. | 0 |
| [ledger/payments.md](ledger/payments.md) | Receipts, edits, deletion, NSF reversals and invoice/retainer effects. | 6 |
| [ledger/retainers-and-prepayments.md](ledger/retainers-and-prepayments.md) | Retainer receipt chains, direct edits, available credit and draws. | 5 |
| [ledger/write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md) | Write-off posting and lifecycle, with links to work corrections. | 5 |
| [ledger/pending-payments.md](ledger/pending-payments.md) | Payment extraction, review, atomic approval and source-file handling. | 10 |
| [work/customers.md](work/customers.md) | Customer/contact profiles, recurring settings, statements and deletion rules. | 10 |
| [work/initial-data-and-notifications.md](work/initial-data-and-notifications.md) | Bootstrap payload, role redaction, notifications and read status. | 5 |
| [work/job-categories-and-types.md](work/job-categories-and-types.md) | Category/type catalogs, ownership checks and edit/delete behavior. | 8 |
| [work/jobs.md](work/jobs.md) | Customer jobs, version families, stored totals and lifecycle rules. | 5 |
| [work/quotes.md](work/quotes.md) | Quote records, field handling, account scope and CRUD behavior. | 4 |
| [work/transactions.md](work/transactions.md) | Direct work entry, job totals, retainer funding and billed edit guards. | 7 |
| [work/work-descriptions.md](work/work-descriptions.md) | General work-description catalog and create/update/delete rules. | 4 |
| [invoicing/account-audit.md](invoicing/account-audit.md) | Independent ledger reconciliation, saved audit jobs, narrative and PDFs. | 7 |
| [invoicing/accounts-receivable.md](invoicing/accounts-receivable.md) | Current statement balances, aging buckets, open-charge estimates and CSV. | 2 |
| [invoicing/analytics.md](invoicing/analytics.md) | Rates, time allocation, WIP, budgets, capacity and reporting exports. | 10 |
| [invoicing/billing-review.md](invoicing/billing-review.md) | Held work, weekly/pre-invoice review, reprocessing and guarded corrections. | 10 |
| [invoicing/create-invoice-engine.md](invoicing/create-invoice-engine.md) | Customer eligibility, snapshot inputs and invoice calculations. | 1 |
| [invoicing/invoices.md](invoicing/invoices.md) | Invoice register, detail reads, history and guarded deletion. | 4 |
| [invoicing/month-end-finalize.md](invoicing/month-end-finalize.md) | The shared generation request, drafts/CSV, final commit and artifacts. | 1 |
| [invoicing/pdf-statements.md](invoicing/pdf-statements.md) | Invoice and customer-statement layout, amounts and pagination. | 0 |
| [platform/accounts-users-auth.md](platform/accounts-users-auth.md) | Google sessions, account settings, users, roles and automation settings. | 12 |
| [platform/operations.md](platform/operations.md) | Health aliases, configuration, migrations, reminders and repair procedures. | 4 |
| [platform/storage-and-downloads.md](platform/storage-and-downloads.md) | S3 namespaces, key authorization and the generic export downloader. | 1 |
| [platform/time-tracking.md](platform/time-tracking.md) | Tracker upload/history, templates, ownership and notification staff. | 13 |
| [platform/timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md) | Holding rows, matching, AI decisions, time pricing and movement to work. | 9 |
| [_review/findings.md](_review/findings.md) | Verified, deduplicated F1–F39 with severity, evidence, reproduction and fixes. | — |
| [_review/findings-ledger.md](_review/findings-ledger.md) | Retained original ledger review notes and earlier helper evidence. | — |
| [_review/findings-work.md](_review/findings-work.md) | Retained original customer, job, catalog and transaction review notes. | — |
| [_review/findings-invoicing.md](_review/findings-invoicing.md) | Retained original invoice, audit, AR, analytics and PDF review notes. | — |
| [_review/findings-platform.md](_review/findings-platform.md) | Retained original auth, tracker, storage, operations and Lambda notes. | — |

## Coverage and ownership

The source contains **143 route contracts** across **28 mounts and 27 router modules**. They include all **135** method/path entries in `test/COVERAGE_MATRIX.md`, plus the eight below. Aliases count separately. The retired ALL-method catch-all counts once; implicit Express HEAD/OPTIONS behavior does not add contracts. The health root routes accept both trailing-slash and slashless forms under the current non-strict router settings.

The matrix is a route-reference inventory, not proof that every branch was tested. Its omissions are retained here without editing the matrix or application code. Mount evidence: `src/app.js:121` through the analytics mount at `src/app.js:170`; each owning guide cites its router handlers.

| Method | Route present in source but absent from matrix | Owning document |
|---|---|---|
| PUT | `/account/automations/:accountID/:userID` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| ALL | `/ai-integration/*` | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md) |
| GET | `/api/health/` | [operations.md](platform/operations.md) |
| GET | `/api/health/check` | [operations.md](platform/operations.md) |
| POST | `/auth/google` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| POST | `/auth/logout` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| POST | `/auth/renew` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| GET | `/jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID` | [job-categories-and-types.md](work/job-categories-and-types.md) |

### Router owners

Each router has one primary guide below. The invoice router delegates its calculation-selection, generation and file-download contracts to the named specialized guides. Its register guide links them.

| Mount | Router source | Primary guide |
|---|---|---|
| `/account` | `src/endpoints/account/account-router.js` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| `/accountAudit` | `src/endpoints/accountAudit/account-audit-router.js` | [account-audit.md](invoicing/account-audit.md) |
| `/accountsReceivable` | `src/endpoints/accountsReceivable/accounts-receivable-router.js` | [accounts-receivable.md](invoicing/accounts-receivable.md) |
| `/ai-integration` | `src/endpoints/aiIntegration/aiIntegration-router.js` | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md) |
| `/analytics` | `src/endpoints/analytics/analytics-router.js` | [analytics.md](invoicing/analytics.md) |
| `/api/health` | `src/endpoints/health/health-router.js` | [operations.md](platform/operations.md) |
| `/auth` | `src/endpoints/auth/auth-router.js` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| `/billing-review` | `src/endpoints/billingReview/billingReview-router.js` | [billing-review.md](invoicing/billing-review.md) |
| `/customer` | `src/endpoints/customer/customer-router.js` | [customers.md](work/customers.md) |
| `/healthz` | `src/endpoints/health/health-router.js` | [operations.md](platform/operations.md) |
| `/initialData` | `src/endpoints/initialData/initialData-router.js` | [initial-data-and-notifications.md](work/initial-data-and-notifications.md) |
| `/invoices` | `src/endpoints/invoice/invoice-router.js` | [invoices.md](invoicing/invoices.md) |
| `/jobCategories` | `src/endpoints/jobCategories/jobCategories-router.js` | [job-categories-and-types.md](work/job-categories-and-types.md) |
| `/jobTypes` | `src/endpoints/jobType/jobType-router.js` | [job-categories-and-types.md](work/job-categories-and-types.md) |
| `/jobs` | `src/endpoints/job/job-router.js` | [jobs.md](work/jobs.md) |
| `/notifications` | `src/endpoints/notifications/notifications-router.js` | [initial-data-and-notifications.md](work/initial-data-and-notifications.md) |
| `/payments` | `src/endpoints/payments/payments-router.js` | [payments.md](ledger/payments.md) |
| `/pending-payments` | `src/endpoints/pendingPayments/pendingPayments-router.js` | [pending-payments.md](ledger/pending-payments.md) |
| `/quotes` | `src/endpoints/quotes/quotes-router.js` | [quotes.md](work/quotes.md) |
| `/recurringCustomer` | `src/endpoints/recurringCustomer/recurringCustomer-router.js` | [customers.md](work/customers.md) |
| `/retainers` | `src/endpoints/retainer/retainer-router.js` | [retainers-and-prepayments.md](ledger/retainers-and-prepayments.md) |
| `/time-tracker-staff` | `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js` | [time-tracking.md](platform/time-tracking.md) |
| `/time-tracking` | `src/endpoints/timeTracking/timeTracking-router.js` | [time-tracking.md](platform/time-tracking.md) |
| `/timesheets` | `src/endpoints/timesheets/timesheets-router.js` | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md) |
| `/transactions` | `src/endpoints/transactions/transactions-router.js` | [transactions.md](work/transactions.md) |
| `/user` | `src/endpoints/user/user-router.js` | [accounts-users-auth.md](platform/accounts-users-auth.md) |
| `/workDescriptions` | `src/endpoints/workDescriptions/workDescriptions-router.js` | [work-descriptions.md](work/work-descriptions.md) |
| `/writeOffs` | `src/endpoints/writeOffs/writeOffs-router.js` | [write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md) |

## Endpoint index

Roles describe backend access, not frontend visibility:

- **Public**: no DS2 login required. Google login still validates Google identity and the provisioned user.
- **Authenticated**: any active authenticated user, subject to the route's account and row checks.
- **M**: Manager, Admin, Super Admin or legacy Owner.
- **A**: Admin or Super Admin.
- **S**: Super Admin.
- **Self / M**: ordinary users can target themselves; M can target another user in their account. The index names queryUserID when that is the checked segment.
- **Template owner account**: the configured TEMPLATE_OWNER_ACCOUNT_ID, default 1. Nonowner template-list requests return no owner versions.

Account parameters must match the session account; Super Admin is not a cross-account bypass. URL userID is not universally an ownership check. Additional selection, state and file-key restrictions are in the linked contracts. Sources: `src/endpoints/auth/account-scope.js:7`, `src/endpoints/auth/account-scope.js:28`, `src/endpoints/auth/jwt-auth.js:64`, `src/endpoints/timeTracking/timeTracking-router.js:1207`.

| Method | Path | Role | Document |
|---|---|---|---|
| GET | `/account/AccountInformation/:accountID/:userID` | A | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| GET | `/account/automations/:accountID/:userID` | A | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| PUT | `/account/automations/:accountID/:userID` | A | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| POST | `/account/createAccount` | S | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| PUT | `/account/updateAccount` | A | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| GET | `/accountAudit/audit/:auditID/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| GET | `/accountAudit/audit/:auditID/pdf/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| GET | `/accountAudit/customer/:customerID/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| GET | `/accountAudit/customers/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| GET | `/accountAudit/job/:jobId/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| POST | `/accountAudit/run/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| GET | `/accountAudit/whoami/:accountID/:userID` | S | [account-audit.md](invoicing/account-audit.md#3-api-reference) |
| GET | `/accountsReceivable/aging/:accountID/:userID` | M | [accounts-receivable.md](invoicing/accounts-receivable.md#3-api-reference) |
| GET | `/accountsReceivable/aging/:accountID/:userID/export` | M | [accounts-receivable.md](invoicing/accounts-receivable.md#3-api-reference) |
| ALL | `/ai-integration/*` | Authenticated | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| GET | `/analytics/clientRates/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/clientRates/:accountID/:userID/export` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/exclusions/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/jobBudgets/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| POST | `/analytics/rateAgreement/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/taxSeasonCapacity/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/timeAllocation/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/timeAllocation/:accountID/:userID/export` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/wipAging/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/analytics/yearEndPacket/:accountID/:userID` | S | [analytics.md](invoicing/analytics.md#3-api-reference) |
| GET | `/api/health/` | Public | [operations.md](platform/operations.md#3-operational-api-reference) |
| GET | `/api/health/check` | Public | [operations.md](platform/operations.md#3-operational-api-reference) |
| POST | `/auth/google` | Public; verified Google identity | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| POST | `/auth/logout` | Public | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| POST | `/auth/renew` | Authenticated | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| PUT | `/billing-review/:entryID/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/billing-review/distinct-entities/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/billing-review/earliest-unbilled-month/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/billing-review/pending/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/billing-review/pre-invoice/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/billing-review/reprocess-count/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| POST | `/billing-review/reprocess-with-overrides/:entryID/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| POST | `/billing-review/reprocess/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| PUT | `/billing-review/transaction/:transactionID/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/billing-review/weekly/:accountID/:userID` | M | [billing-review.md](invoicing/billing-review.md#3-api-reference) |
| GET | `/customer/activeCustomers/:accountID/:userID` | M | [customers.md](work/customers.md#3-api-reference) |
| GET | `/customer/activeCustomers/customerByID/:accountID/:userID/:customerID` | M | [customers.md](work/customers.md#3-api-reference) |
| POST | `/customer/createCustomer/:accountID/:userID` | M | [customers.md](work/customers.md#3-api-reference) |
| DELETE | `/customer/deleteCustomer/:customerID/:accountID/:userID` | M | [customers.md](work/customers.md#3-api-reference) |
| GET | `/customer/statement/:accountID/:userID/:customerID` | M | [customers.md](work/customers.md#3-api-reference) |
| PUT | `/customer/updateCustomer/:accountID/:userID` | M | [customers.md](work/customers.md#3-api-reference) |
| GET | `/healthz/` | Public | [operations.md](platform/operations.md#3-operational-api-reference) |
| GET | `/healthz/check` | Public | [operations.md](platform/operations.md#3-operational-api-reference) |
| GET | `/initialData/initialBlob/:accountID/:userID` | Authenticated | [initial-data-and-notifications.md](work/initial-data-and-notifications.md#3-api-reference) |
| POST | `/invoices/createInvoice/:accountID/:userID` | M | [month-end-finalize.md](invoicing/month-end-finalize.md#3-api-reference) |
| GET | `/invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID` | M | [create-invoice-engine.md](invoicing/create-invoice-engine.md#3-api-reference) |
| DELETE | `/invoices/deleteInvoice/:accountID/:invoiceID` | M | [invoices.md](invoicing/invoices.md#3-api-reference) |
| GET | `/invoices/downloadFile/:accountID/:userID` | M | [storage-and-downloads.md](platform/storage-and-downloads.md#3-api-reference) |
| GET | `/invoices/getInvoiceDetails/:invoiceID/:accountID/:userID` | M | [invoices.md](invoicing/invoices.md#3-api-reference) |
| GET | `/invoices/getInvoices/:accountID/:invoiceID` | M | [invoices.md](invoicing/invoices.md#3-api-reference) |
| GET | `/invoices/getInvoicesPaginated/:accountID/:userID` | M | [invoices.md](invoicing/invoices.md#3-api-reference) |
| POST | `/jobCategories/createJobCategory/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| DELETE | `/jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| GET | `/jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| PUT | `/jobCategories/updateJobCategory/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| POST | `/jobTypes/createJobType/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| DELETE | `/jobTypes/deleteJobType/:jobTypeID/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| GET | `/jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| PUT | `/jobTypes/updateJobType/:accountID/:userID` | M | [job-categories-and-types.md](work/job-categories-and-types.md#3-api-reference) |
| POST | `/jobs/createJob/:accountID/:userID` | M | [jobs.md](work/jobs.md#3-api-reference) |
| DELETE | `/jobs/deleteJob/:jobID/:accountID/:userID` | M | [jobs.md](work/jobs.md#3-api-reference) |
| GET | `/jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` | M | [jobs.md](work/jobs.md#3-api-reference) |
| GET | `/jobs/getSingleJob/:customerJobID/:accountID/:userID` | M | [jobs.md](work/jobs.md#3-api-reference) |
| PUT | `/jobs/updateJob/:accountID/:userID` | M | [jobs.md](work/jobs.md#3-api-reference) |
| GET | `/notifications/:accountID/:userID` | Self / M | [initial-data-and-notifications.md](work/initial-data-and-notifications.md#3-api-reference) |
| PUT | `/notifications/:accountID/:userID/read-all` | Self / M | [initial-data-and-notifications.md](work/initial-data-and-notifications.md#3-api-reference) |
| GET | `/notifications/:accountID/:userID/unread-count` | Self / M | [initial-data-and-notifications.md](work/initial-data-and-notifications.md#3-api-reference) |
| PUT | `/notifications/:notificationID/:accountID/:userID/read` | Self / M | [initial-data-and-notifications.md](work/initial-data-and-notifications.md#3-api-reference) |
| POST | `/payments/createPayment/:accountID/:userID` | M | [payments.md](ledger/payments.md#3-api-reference) |
| DELETE | `/payments/deletePayment/:accountID/:userID` | M | [payments.md](ledger/payments.md#3-api-reference) |
| GET | `/payments/getPayments/:accountID/:userID` | M | [payments.md](ledger/payments.md#3-api-reference) |
| GET | `/payments/getSinglePayment/:paymentID/:accountID/:userID` | M | [payments.md](ledger/payments.md#3-api-reference) |
| POST | `/payments/reversePayment/:accountID/:userID` | M | [payments.md](ledger/payments.md#3-api-reference) |
| PUT | `/payments/updatePayment/:accountID/:userID` | M | [payments.md](ledger/payments.md#3-api-reference) |
| POST | `/pending-payments/approve/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| PUT | `/pending-payments/approve/:paymentID/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| GET | `/pending-payments/counts/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| GET | `/pending-payments/file-preview/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| DELETE | `/pending-payments/file/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| GET | `/pending-payments/files/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| GET | `/pending-payments/list/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| GET | `/pending-payments/single/:paymentID/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| PUT | `/pending-payments/soft-delete/:paymentID/:accountID/:userID` | M | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| POST | `/pending-payments/upload/:accountID/:userID` | M + account 1 | [pending-payments.md](ledger/pending-payments.md#3-api-reference) |
| POST | `/quotes/createQuote` | M | [quotes.md](work/quotes.md#3-api-reference) |
| DELETE | `/quotes/deleteQuote/:accountID/:quoteID` | M | [quotes.md](work/quotes.md#3-api-reference) |
| GET | `/quotes/getActiveQuotes/:accountID/:quoteID` | M | [quotes.md](work/quotes.md#3-api-reference) |
| PUT | `/quotes/updateQuote` | M | [quotes.md](work/quotes.md#3-api-reference) |
| POST | `/recurringCustomer/createRecurringCustomer/:accountID/:userID` | M | [customers.md](work/customers.md#3-api-reference) |
| DELETE | `/recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId` | M | [customers.md](work/customers.md#3-api-reference) |
| GET | `/recurringCustomer/getActiveRecurringCustomers/:accountID/:userID` | M | [customers.md](work/customers.md#3-api-reference) |
| PUT | `/recurringCustomer/updateRecurringCustomer` | M | [customers.md](work/customers.md#3-api-reference) |
| POST | `/retainers/createRetainer/:accountID/:userID` | M | [retainers-and-prepayments.md](ledger/retainers-and-prepayments.md#3-api-reference) |
| DELETE | `/retainers/deleteRetainer/:retainerID/:accountID/:userID` | M | [retainers-and-prepayments.md](ledger/retainers-and-prepayments.md#3-api-reference) |
| GET | `/retainers/getActiveRetainers/:customerID/:accountID/:userID` | M | [retainers-and-prepayments.md](ledger/retainers-and-prepayments.md#3-api-reference) |
| GET | `/retainers/getSingleRetainer/:retainerID/:accountID/:userID` | M | [retainers-and-prepayments.md](ledger/retainers-and-prepayments.md#3-api-reference) |
| PUT | `/retainers/updateRetainer/:accountID/:userID` | M | [retainers-and-prepayments.md](ledger/retainers-and-prepayments.md#3-api-reference) |
| GET | `/time-tracker-staff/:accountID/:userID` | M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| POST | `/time-tracker-staff/:accountID/:userID` | M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| DELETE | `/time-tracker-staff/:accountID/:userID/:staffID` | M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| PUT | `/time-tracker-staff/:accountID/:userID/:staffID` | M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| GET | `/time-tracking/download/by-name/:accountID/:userID` | Self / M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| GET | `/time-tracking/history/:accountID/:userID` | Self / M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| GET | `/time-tracking/history/download/:accountID/:userID` | Self / M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| DELETE | `/time-tracking/template/delete/:accountID/:userID` | S + template owner account | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| GET | `/time-tracking/template/latest/:accountID/:userID` | Self / M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| GET | `/time-tracking/template/list/:accountID/:userID` | A; owner versions only | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| POST | `/time-tracking/template/upload/:accountID/:userID` | S + template owner account | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| POST | `/time-tracking/upload/:accountID/:userID` | Self / M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| GET | `/time-tracking/users/:accountID/:userID` | Self / M | [time-tracking.md](platform/time-tracking.md#3-api-reference) |
| POST | `/timesheets/ai/kickoff/:accountID/:userID` | Authenticated; own entries or M | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| GET | `/timesheets/countsByEmployee/:accountID/:userID` | M | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| DELETE | `/timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID` | M | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| GET | `/timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID` | Self / M (queryUserID) | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| GET | `/timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID` | Self / M (queryUserID) | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| GET | `/timesheets/getTimesheetEntries/:accountID/:userID` | M | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| GET | `/timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID` | Self / M (queryUserID) | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| POST | `/timesheets/moveToTransactions/:accountID/:userID` | M | [timesheets-and-ingestion.md](platform/timesheets-and-ingestion.md#3-api-reference) |
| POST | `/transactions/createTransaction/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| DELETE | `/transactions/deleteTransaction/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| GET | `/transactions/exportTransactions/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| GET | `/transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| GET | `/transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| GET | `/transactions/getTransactions/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| PUT | `/transactions/updateTransaction/:accountID/:userID` | M | [transactions.md](work/transactions.md#3-api-reference) |
| POST | `/user/createUser/:accountID/:userID` | S | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| DELETE | `/user/deleteUser/:accountID/:userID` | S | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| GET | `/user/fetchSingleUser/:accountID/:userID` | Self / M | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| PUT | `/user/updateUser/:accountID/:userID` | S | [accounts-users-auth.md](platform/accounts-users-auth.md#3-api-reference) |
| POST | `/workDescriptions/createWorkDescription/:accountID/:userID` | M | [work-descriptions.md](work/work-descriptions.md#3-api-reference) |
| DELETE | `/workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID` | M | [work-descriptions.md](work/work-descriptions.md#3-api-reference) |
| GET | `/workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID` | M | [work-descriptions.md](work/work-descriptions.md#3-api-reference) |
| PUT | `/workDescriptions/updateWorkDescription/:accountID/:userID` | M | [work-descriptions.md](work/work-descriptions.md#3-api-reference) |
| POST | `/writeOffs/createWriteOffs/:accountID/:userID` | M | [write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md#3-api-reference) |
| DELETE | `/writeOffs/deleteWriteOffs/:accountID/:userID` | M | [write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md#3-api-reference) |
| GET | `/writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID` | M | [write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md#3-api-reference) |
| GET | `/writeOffs/getWriteOffs/:accountID/:userID` | M | [write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md#3-api-reference) |
| PUT | `/writeOffs/updateWriteOffs/:accountID/:userID` | M | [write-offs-and-adjustments.md](ledger/write-offs-and-adjustments.md#3-api-reference) |

## Consistency-pass summary

- **25 feature documents checked and updated**, including calculation/edit sections, endpoint ownership, cross-links, source anchors and coverage notes.
- **4 original findings files reviewed and retained unchanged**; **3 overview/index/review files added**. The catalog contains all **32 Markdown documents**.
- **143 endpoints indexed**, each with one feature owner: ledger 26, work 43, invoicing 35 and platform 39. All 135 matrix entries and all 28 router mounts are covered.
- Static checks found **no missing, extra or duplicate feature contracts**, no broken local document links/anchors, and no missing or out-of-range source citations.
- **39 distinct findings confirmed: 7 P1, 29 P2 and 3 P3**. Eight duplicate notes were merged; no original finding was dropped as false.
- Only documentation was written. No code edits, git commands, integration tests, database writes or cloud operations were performed.

