# Work, jobs and customers: source-review findings

Reviewed 2026-09-24. These findings come from the current local implementation and reference schema. Reproduction ideas below were **not executed**. No application code, database contents or configuration was changed. Severity: P1 data loss/leak; P2 wrong result; P3 minor. Historical accountant repairs remain separately listed in `scripts/review-2026-09/FINAL_REPORT.md:45`.

## W01 — P1: customer-update response reads an arbitrary body account

**Evidence:** `src/endpoints/customer/customer-router.js:245`, `src/endpoints/customer/customer-router.js:251`, `src/endpoints/customer/customer-router.js:276`, `src/endpoints/customer/customer-service.js:1`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:3`.

**What happens:** PUT updateCustomer scopes its writes to the verified URL account, but refreshes customer and recurring lists using accountID destructured from the body. An account A privileged user can receive account B's active customer/contact and recurring billing information. The URL account guard does not protect this second source of account identity.

**Reproduction idea:** With A and B fixtures, authenticate as A manager. Send a complete valid update for A's customer/contact to A's URL, but set customer.accountID=B. Assert the response contains B's display names/contact details/subscriptions. Use a benign full update so validation does not mask the readback leak.

**Suggested fix:** Use trustedAccountId for both response queries, remove body account from read decisions, and add a regression asserting no B data appears in successful or failed A updates.

## W02 — P1: initial blob bypasses financial and contact role gates

**Evidence:** `src/app.js:123`, `src/app.js:147`, `src/endpoints/initialData/initialData-router.js:43`, `src/endpoints/initialData/initialData-router.js:65`, `src/endpoints/initialData/initialData-router.js:190`, `test/endpoints/initialData/initialDataUserFields.integration.spec.js:75`.

**What happens:** Plain User employees cannot call manager-only customer/transaction/invoice/payment APIs, but can fetch their account's same financial/contact data through initialBlob. The only role redaction removes cost_rate, billing_rate and email from the users roster. Customer contacts, job amounts, all retainers and first pages of other ledgers remain. Transaction unit_cost can also expose employee billing rates despite roster redaction. Existing tests retain the shell's top-level keys without checking minimal contents.

**Reproduction idea:** Authenticate as plain User. Confirm GET transactions returns403, then GET initialBlob with the same account returns customer contact fields, transaction quantities/rates/totals, invoices and retainers. Seed identifiable records in the first20 where applicable.

**Suggested fix:** Define explicit per-role projections. Ordinary staff should receive only the selectors/own data needed by upload/history; keep any required shell keys with safe contents. Test each protected field/list, not only the roster or top-level shape.

## W03 — P1: caller-supplied related IDs cross tenant boundaries in joined reads

**Evidence:** `src/endpoints/transactions/transactionsObjects.js:37`, `src/endpoints/transactions/sharedTransactionFunctions.js:596`, `src/endpoints/transactions/transactions-service.js:1`, `src/endpoints/job/job-router.js:59`, `src/endpoints/job/job-service.js:22`, `src/endpoints/jobType/jobTypeObjects.js:1`, `src/endpoints/jobType/jobType-service.js:18`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:26`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:3`, `migrations/schema-snapshot-2026-09-22.sql:1934`, `migrations/schema-snapshot-2026-09-22.sql:2094`.

**What happens:** Scoping the base row does not validate all related rows. Direct transaction CRUD checks customer/job/retainer but not logged-for employee or general work description account. Joined lists reveal the foreign employee/description label. Job CRUD accepts another account's job type/creator; refreshed jobs select type.* and creator name without related-account predicates. Job-type CRUD accepts another account's category and returns its label. Recurring create accepts a foreign customer ID, ignores the zero-row customer flag update, inserts an own-account recurring row, and returns the foreign customer's display name. The reference FKs enforce individual IDs, not account correspondence; recurring has no customer FK.

**Reproduction idea:** Use A/B tenants. As A manager, create a transaction on A's customer/job using B's user and description IDs; inspect A's list for B's labels. Separately create A's job with B's type, an A type with B's category, and A's recurring row with B's customer ID; inspect each success/initial-blob response. These requests need existing globally valid IDs, not a forged URL account.

**Suggested fix:** Resolve every submitted relation in the trusted account before writes and enforce customer/job consistency wherever applicable. Scope joined tables as defense in depth; use composite account+ID FKs where practical. Audit pre-existing mismatches. Derive creator from session and preserve it on edit.

**Related integrity paths:** Quote mappers accept customer/job/creator IDs without ownership or customer/job correspondence checks. Category/type/general-description/job/recurring creator fields can spoof attribution; several updates overwrite creator. Quote list itself has no joined customer leakage, but these links can corrupt ownership semantics (`src/endpoints/quotes/quotesObjects.js:1`, `src/endpoints/jobCategories/jobCategoriesObjects.js:1`, `src/endpoints/workDescriptions/workDescriptionsObjects.js:1`, `src/endpoints/job/jobObjects.js:18`, `src/endpoints/recurringCustomer/recurringCustomerObjects.js:31`).

## W04 — P2: customer and recurring saves can partially commit

**Evidence:** `src/endpoints/customer/customer-router.js:259`, `src/endpoints/customer/customer-router.js:264`, `src/endpoints/customer/customer-service.js:124`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:33`.

**What happens:** Customer update commits the customer row, then contact, then recurring changes independently. A later error returns failure after earlier changes persist; zero-row contact updates are also ignored. Dedicated recurring create sets customers.is_recurring first and can fail insertion afterward, leaving the flag true without a subscription.

**Reproduction idea:** Update an existing customer's name and submit a contact state longer than the schema's two-character limit. Expect body status500 but the new name persists. Alternatively enable recurring with invalid billingCycle; customer/contact writes survive the recurring failure. For standalone recurring create, fail the insert after its flag update.

**Suggested fix:** Validate first; perform the full save in one transaction with owned-row existence/affected-count checks. Coordinate customer state with the ledger lock when the policy requires serialization. Add rollback assertions for each later write failure.

## W05 — P2: ending a recurring record leaves the customer recurring flag true

**Evidence:** `src/endpoints/recurringCustomer/recurringCustomer-router.js:135`, `src/endpoints/customer/customer-service.js:120`, `../DS2_Frontend/src/Pages/RecurringCustomer/RecurringCustomerForms/AddCustomer/FormSubComponents/RecurringOptions.js:43`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:7`.

**What happens:** Dedicated DELETE deactivates the subscription and stamps end_date, but never clears customers.is_recurring. Dedicated PUT isActive=false has the same mismatch. The add-recurring selector excludes customers marked recurring, while transaction defaults continue treating their work as covered by a monthly charge.

**Reproduction idea:** Create the only active recurring row for a customer, delete it through the dedicated API, reload initial data, and inspect customers.is_recurring. Then inspect add-recurring options and the Time form's non-additional billable default.

**Suggested fix:** In a transaction, reconcile the flag from remaining active subscriptions after create/update/delete. Decide whether dates also define active subscription status. Test the last-subscription and multiple-subscription cases.

## W06 — P2: joined timestamps prevent selecting the latest customer-job version

**Evidence:** `src/endpoints/job/job-service.js:41`, `src/endpoints/job/job-router.js:247`, `src/endpoints/job/job-service.js:22`, `src/endpoints/customer/customer-router.js:171`.

**What happens:** getActiveCustomerJobs uses SELECT * across jobs, types and categories, which have overlapping created_at/account/creator columns. Later duplicate fields replace job fields in a normal object result. The reducer replaces a root only when a candidate's exposed created_at is strictly later; versions sharing category/type therefore compare equal and the original root can remain. Account jobs similarly selects types.* after jobs.*, replacing job metadata. Customer-profile tree totals instead choose greatest child ID, so these views can disagree.

**Reproduction idea:** Create a root job with current total0, add a $100 transaction to create a later version using the same type/category, and GET getActiveCustomerJobs. Compare its selected total/version with raw jobs and customer-profile tree. Inspect returned created_at against the category/type timestamp.

**Suggested fix:** Select jobs.* plus explicitly aliased related labels only. Choose latest family version by job created_at and job ID with deterministic tie-breaking. Add a root+multiple-version HTTP test; the existing simple customer-jobs case does not exercise this (`test/integration/coverage-jobs-masterdata.integration.spec.js:376`).

## W07 — P2: a new job-total snapshot can restore stale metadata

**Evidence:** `src/endpoints/job/job-service.js:106`, `src/endpoints/transactions/sharedTransactionFunctions.js:461`, `src/endpoints/transactions/sharedTransactionFunctions.js:478`, `src/endpoints/job/job-router.js:185`.

**What happens:** getRecentJob filters the exact supplied job ID, although transaction family totals include all versions. Updating notes/agreed amount on the current version affects that named row only. Later repricing a transaction attached to an older row copies that older row's metadata into the newest snapshot, making the latest version's notes/agreed amount revert.

**Reproduction idea:** Create a root and transaction, then a generated version. Edit that version's notes/agreed amount. Change the amount of the transaction still pointing to the root. Check the newest inserted job row: total is recomputed correctly but notes/agreed amount come from the root.

**Suggested fix:** Define which fields are family-wide and resolve the latest owned family metadata before snapshot insertion. Preserve the correct current metadata while summing transactions across the family. Add a regression combining metadata edit and repricing an older-linked entry.

## W08 — P2: direct transaction API accepts internally inconsistent prices

**Evidence:** `src/endpoints/transactions/transactionsObjects.js:51`, `src/endpoints/transactions/transactionsObjects.js:78`, `src/endpoints/transactions/sharedTransactionFunctions.js:590`, `src/endpoints/timesheets/auto-ingest-orchestrator.js:541`.

**What happens:** Direct create/update number-coerce quantity/rate and trust independent absolute totalTransaction. They do not recompute price, require finite/nonnegative values, or enforce six-minute Time increments. Job/invoice totals use totalTransaction while detail quantity/rate can imply a different amount. Update also maps quantity0 to1. Tracker ingestion computes its own consistent rounded price, so entry paths differ.

**Reproduction idea:** POST a valid Time entry with quantity1, unitCost100, totalTransaction1, billable=true. Verify stored detail says one hour at100 while job/invoice contribution is1. Submit quantity0.11 to show direct Time entries need not use 0.1-hour increments. No database experiment was run for this review.

**Suggested fix:** Centralize finite numeric validation and pricing in the shared core, with an explicitly authorized rate/amount override policy if required. Derive Time quantity from duration in six-minute increments and verify Charge arithmetic. Add direct HTTP tests, not only ingestion calculator tests.

## W09 — P2: direct entry bypasses internal-customer billability policy

**Evidence:** `src/endpoints/timesheets/internal-customers.js:75`, `src/endpoints/timesheets/timesheets-router.js:310`, `src/endpoints/billingReview/billingReview-service.js:314`, `src/endpoints/transactions/sharedTransactionFunctions.js:590`, `src/endpoints/transactions/sharedTransactionFunctions.js:603`.

**What happens:** Tracker approval/ingestion makes internal work non-billable. Direct Time/Charge create/update uses only the submitted flag and does not check the internal resolver or customer-level is_billable. It can add internal billable debt and draw a retainer, despite the policy applied by the other entry paths.

**Reproduction idea:** Configure an owned customer in INTERNAL_CUSTOMER_IDS. Apply a tracker row for it and observe false billability. Then direct-POST equivalent work with isTransactionBillable=true; it remains true and contributes to billing. Repeat update on previously non-billable work.

**Suggested fix:** Apply the internal/customer billability policy in the shared core used by all paths, or define an explicit privileged override with audit evidence. Test create and update across both direct and tracker routes.

## W10 — P2: permitted customer hard-delete leaves contact data behind

**Evidence:** `src/endpoints/customer/customer-router.js:331`, `src/endpoints/customer/customer-router.js:356`, `src/endpoints/customer/customer-service.js:132`, `migrations/schema-snapshot-2026-09-22.sql:404`, `migrations/schema-snapshot-2026-09-22.sql:1862`.

**What happens:** A newly created unused customer has a customer_information row. Delete guards do not consider it; delete removes only customers. The reference schema has account/creator FKs on information but no customer FK, so its contact/PII row remains orphaned. Quotes likewise lack a customer FK and are absent from the explicit guards.

**Reproduction idea:** Create a nonrecurring customer with contact details and no ledger/job records. Delete it, then query customer_information by the deleted customer ID in a sandbox. Expect the contact row still present though normal joined views no longer show it.

**Suggested fix:** Decide retention requirements, then atomically delete dependent contact rows or soft-deactivate the customer. Add appropriate FK behavior and explicitly account for quotes/other unguarded relationships. Test resulting related rows, not only removal from the active list.

## W11 — P2: customer deletion races ledger/job creation

**Evidence:** `src/endpoints/customer/customer-router.js:324`, `src/endpoints/customer/customer-router.js:331`, `src/endpoints/customer/customer-router.js:356`, `src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/job/job-router.js:67`, `migrations/schema-snapshot-2026-09-22.sql:1942`.

**What happens:** Customer delete performs checks and DELETE outside a transaction and without acquiring the customer lock used by job/financial writers. A job can be committed after checks finish but before DELETE. The schema has no customer FK on jobs (nor on core transactions), so delete can succeed and orphan newly committed history. Later INNER JOIN reads hide orphaned work.

**Reproduction idea:** Start with a customer with no related history. Pause DELETE after its last guard read. Create a job for that customer through the normal locked job API and let it commit. Resume DELETE; verify customer gone and job retained. This uses two concurrent sandbox requests with a test hook; it was not run here.

**Suggested fix:** Acquire the same owned customer FOR NO KEY UPDATE lock before all guard reads and hold it through deletion in one transaction. Use raw relation existence queries and appropriate FKs as a second layer. Add a two-connection race regression.

## W12 — P2: job-type update/delete detach a rejecting response refresh

**Evidence:** `src/endpoints/jobType/jobType-router.js:76`, `src/endpoints/jobType/jobType-router.js:100`, `src/endpoints/jobType/jobType-router.js:112`, `src/app.js:7`.

**What happens:** PUT and DELETE call the async response-refresh helper without await or return. If the post-write query rejects, the surrounding catch and Express async-error wrapper cannot observe that detached promise. The write has committed, the request has no handled response, and the rejection can terminate a Node process using default unhandled-rejection behavior. Create already awaits this helper.

**Reproduction idea:** Stub getActiveJobTypes to reject only after a successful job-type update/delete. Observe that the route does not send its documented error envelope and an unhandled rejection is emitted. Use an isolated process for a regression so the test runner is not terminated.

**Suggested fix:** Await the refresh inside the existing try/catch, and test a failed refresh after successful mutation. Report that the mutation may already have committed.

## W13 — P2: customer profile counts retainer payments twice in its payment display

**Evidence:** `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:11`, `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:22`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:10`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:238`.

**What happens:** paymentTotal already includes all eligible uninvoiced payments, including Retainer/Prepayment. retainerAppliedToInvoice is a subset of paymentTotal. The profile renders their sum as Payments Since Last Bill, doubling that subset. It also excludes invoice-tagged receipts although the backend separately calculates paymentsReceivedTotal for all listed receipts. Amount due uses the correct paymentTotal once; the profile breakdown is inconsistent.

**Reproduction idea:** Give invoice preview a −$50 eligible payment total containing a −$20 retainer payment. Backend returns paymentTotal−50 and retainerAppliedToInvoice−20. Profile label shows−70; due math credits only50. Add a tagged payment to demonstrate the difference from all receipts.

**Suggested fix:** Choose the label's meaning: show paymentsReceivedTotal for all receipts since the statement, or paymentTotal for unapplied credits with a matching label. Never add the retainer subset again. Add a component assertion with both cash and retainer payments.

## W14 — P2: customer statement PDF can combine different ledger states

**Evidence:** `src/endpoints/customer/customer-statement.js:18`, `src/endpoints/accountAudit/account-audit-service.js:19`, `src/endpoints/customer/customer-statement.js:26`, `src/endpoints/invoice/createInvoice/billingSnapshot.js:27`.

**What happens:** The PDF builder independently reads five tables through the ordinary db connection and then calculates running/current balances. It does not use the consistent read snapshot used by invoice preview. A transaction/payment pair committed between those reads can appear only on one side of the generated statement, showing a balance that never existed as a committed ledger state.

**Reproduction idea:** In a two-connection test, allow the PDF's transaction read to finish, delay its payment read, commit an atomic $100 retainer-funded entry plus −$100 auto payment, then resume payment read. The generated data contains the credit but not the new charge. Reverse read timing for the opposite mismatch. Compare against before/after committed states.

**Suggested fix:** Run customer, ledger and header reads inside one REPEATABLE READ READ ONLY transaction, following the existing billing snapshot pattern. Add a controlled concurrent-commit regression verifying both halves are from the same snapshot.

## Output summary

Files written: `docs/work/transactions.md`, `docs/work/jobs.md`, `docs/work/job-categories-and-types.md`, `docs/work/work-descriptions.md`, `docs/work/customers.md`, `docs/work/quotes.md`, `docs/work/initial-data-and-notifications.md`, and this file. Coverage: **51 method/path endpoints (49 distinct handlers)**. Findings: **14 total — 3 P1, 11 P2, 0 P3**. No git command, executable test, database operation or application edit was performed.
