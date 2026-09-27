# Customers, contact information and recurring customers

**H6 navigation:** Clients: `/clients` and `/clients/:customerId`; Overview, Work, Jobs, Statements, Receipts, Credits & retainers, AI Audit, Audit Record and Edit client tabs. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

## Owner decision update — 2026-09-25

Customer deletion first refuses an issued statement dependency with HTTP 409 naming the invoice; the database trigger is the final barrier. Normal contact/profile changes remain permitted, but frozen issue payload and archived PDFs preserve the original billing contact/content. Cross-account and existing linked-row guards remain. [Sent contract](../invoicing/invoices.md).


## 1. Purpose and UI

`/clients` displays `CustomerGrid` and the `NewCustomer` dialog. `/billing/recurring` displays `RecurringCustomerGrid` and `AddRecurringCustomer`. Rows open `/customers/customersList/customerProfile/:customerId/customerInvoices`; profile subroutes include customer invoices, transactions, jobs, payments, retainers and edit. Components are in `src/Pages/Customer/CustomerProfile/` in the frontend (`../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerRoutes.js:20`, `../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.js:92`, `../DS2_Frontend/src/Pages/RecurringCustomer/RecurringCustomerGrids/RecurringCustomerGrid.js:17`).

`CustomerProfile` shows contact/activation/recurring data, calls invoice preview for balances, and offers a dated statement PDF. The default PDF range is start of this year through today. `EditCustomerProfile` saves changes and offers customer deletion; recurring-grid rows navigate to the same profile (`../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:12`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:51`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:125`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/EditCustomerProfile.js:156`). Review date: 2026-09-24. All verification here is source/test reading, not a live database check.

Customer grid starts at20 rows and debounces search by300ms. `NewCustomer` combines NameForm, AddressForm, AddressTypeSelections, CustomerSettings and optional RecurringCustomerForm. Defaults: individual, active, billable, all four address flags true, recurring=false, start date today (`../DS2_Frontend/src/Pages/Customer/CustomerGrids/CustomerGrid.js:12`, `../DS2_Frontend/src/Pages/Customer/CustomerForms/AddCustomer/NewCustomer.js:14`, `../DS2_Frontend/src/Pages/Customer/CustomerForms/AddCustomer/NewCustomer.js:77`).

## 2. Access rules

Both `/customer` and `/recurringCustomer` mounts require authentication. Every customer route installs `requireManagerOrAdmin`; the recurring router installs it for the whole router. Exact lowercase roles: `manager`, `admin`, `super admin`, `owner`. Frontend manager routing permits the same four roles (`src/app.js:122`, `src/app.js:144`, `src/endpoints/customer/customer-router.js:30`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:13`, `src/endpoints/auth/jwt-auth.js:94`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`).

Cookie JWT precedes Bearer; JWT subject email resolves the current database user. Authentication failures return HTTP 401; role rejection returns HTTP 403. `enforceAccountId` checks integer URL account equals session account, else HTTP 403. There is no self-or-privileged check on `userID`. Dedicated recurring PUT has no URL account and uses the session account (`src/endpoints/auth/jwt-auth.js:7`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/customer/customer-router.js:5`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:8`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:81`).

Customer create stamps trusted account and session creator into contact/recurring records. Customer update scopes writes to the URL account and preserves contact creator, and uses that same verified account for both customer and recurring response lists (fixed [F1](../_review/findings.md#f1)). Recurring creation uses the session creator; edits preserve the stored creator. Dedicated recurring creation validates customer ownership, and embedded recurring updates require the row to belong to the selected customer (fixed [F2](../_review/findings.md#f2)) (`src/endpoints/customer/customer-router.js:40`, `src/endpoints/customer/customer-router.js:251`, `src/endpoints/customer/customer-router.js:276`, `src/endpoints/customer/customerObjects.js:40`, `src/endpoints/recurringCustomer/recurringCustomerObjects.js:28`, `src/endpoints/recurringCustomer/recurringCustomerObjects.js:41`).

Token verification accepts HS256 only. User lookup and role lookup both require `is_user_active=true`; a deactivated user cannot continue with an otherwise valid token. Authentication lookup exceptions are also returned as HTTP 401; an uncaught role-lookup failure reaches the global error handler (`src/endpoints/auth/auth-service.js:26`, `src/endpoints/auth/auth-service.js:46`, `src/endpoints/auth/jwt-auth.js:48`, `src/endpoints/auth/jwt-auth.js:77`).

## 3. API reference

Common transport errors: HTTP 401/403 above; HTTP 429 from the general 300/minute limiter unless test/disabled; malformed JSON HTTP 400; over-1-MB JSON HTTP 413. Uncaught errors use `err.status || 500`, production `{message:'Server error'}`, otherwise `{message,error}` (`src/app.js:70`, `src/app.js:94`, `src/app.js:100`, `src/app.js:178`). **E500** means HTTP 200 `{message,status:500}`. Customer handlers often use E500; dedicated recurring handlers let exceptions reach actual HTTP 500 (`src/endpoints/customer/customer-router.js:107`, `src/endpoints/customer/customer-router.js:305`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:20`).

### Create customer

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/customer/createCustomer/:accountID/:userID` | Required path IDs and `{customer:{...}}`; customer/contact/optional recurring fields below | HTTP 200 C, message `Successfully created customer.` | Common errors; missing customer object can fail sanitization outside catch ->actual HTTP 500. E500 for exact active duplicate display name; invalid/null/oversized fields, creator/FK failure, insert or refresh failure. `src/endpoints/customer/customer-router.js:29` |

### Customer profile

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/customer/activeCustomers/customerByID/:accountID/:userID/:customerID` | All path IDs required, SQL-compatible ID; no query filters/paging | HTTP 200 profile P below | Common errors; actual HTTP 404 `{message:'Customer not found.',status:404}` when no contact-joined row, including missing/foreign customer or no active contact; E500 for SQL/read failure. `src/endpoints/customer/customer-router.js:118` |

### Statement PDF

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/customer/statement/:accountID/:userID/:customerID` | Required path IDs; optional `start`, `end` strings parsed by dayjs. Start omitted means all history; end omitted means today. No validation of invalid/inverted ranges | HTTP 200 `application/pdf`, attachment `statement_<sanitized display name or ID>_<UTC YYYY-MM-DD>.pdf` | Common errors; actual HTTP 500 `{message,status:500}` for missing/foreign customer, SQL or PDF failure. Invalid range is not explicitly a 400. `src/endpoints/customer/customer-router.js:212`, `src/endpoints/customer/customer-statement.js:14` |

### Update/activate/deactivate customer

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/customer/updateCustomer/:accountID/:userID` | Required path IDs, `{customer:{...}}`, `customerID`, `customerInfoID`, full field mapping | HTTP 200 C plus `warnings:[string]`, message `Successfully updated customer.` | Common errors; E500 for missing/foreign customer or recurring references, sanitization/mapping, invalid DB fields, failed recurring write or readback. The customer must exist in the verified account before any write. Contact affected-row counts remain unchecked. Body accountID cannot change response-list ownership. `src/endpoints/customer/customer-router.js:239` |

### Delete customer

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/customer/deleteCustomer/:customerID/:accountID/:userID` | Required path IDs; customer must number-convert to positive integer; no body | HTTP 200 `{customersList:{activeCustomerData:{activeCustomers,grid}},message:'Successfully deleted customer.',status:200}` | Common errors; HTTP 200 body status404 for invalid/missing/foreign ID; E500 when any guarded relation exists, FK refusal, query/delete/refresh failure. `src/endpoints/customer/customer-router.js:316` |

### Active customers

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/customer/activeCustomers/:accountID/:userID` | Required path IDs; optional `page=1`, `limit=20`, `search=''` | HTTP 200 `{customersList:{activeCustomerData:{activeCustomers,grid,pagination,searchTerm}},message,status:200}` | Common errors; actual HTTP 400 for invalid pagination, actual HTTP 500 other failures. `src/endpoints/customer/customer-router.js:384` |

Page/limit use base-10 `parseInt`, reject NaN/<1, cap limit at 500; numeric prefixes/fractions are truncated. Offset=`(page-1)*limit`; metadata `{page,limit,totalItems,totalPages:ceil(totalItems/limit)}`. Non-string search becomes empty, strings trim. No client sort, inactive toggle or separate field filter is implemented (`src/utils/pagination.js:6`, `src/endpoints/customer/customer-router.js:391`).

### Create recurring customer

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| POST | `/recurringCustomer/createRecurringCustomer/:accountID/:userID` | Required path IDs, `{recurringCustomer:{...}}` including customer ID and recurring fields below | HTTP 200 `{recurringCustomersList:{activeRecurringCustomersData:{activeRecurringCustomers,grid}},message,status:200}` | Common errors; actual HTTP 500 mapping/SQL/FK/readback failure. HTTP 422 `Customer not found in this account.` for a missing/foreign customer before any write. Owned-customer validation precedes the ledger lock inside one transaction; the lock rechecks existence before changing customer flags or inserting recurring data. No duplicate or frequency/day/range validation. `src/endpoints/recurringCustomer/recurringCustomer-router.js:20` |

### Active recurring customers

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| GET | `/recurringCustomer/getActiveRecurringCustomers/:accountID/:userID` | Required path IDs; no search, paging, sort or date query | HTTP 200 `{activeRecurringCustomersData:{activeRecurringCustomers,grid},message,status:200}` | Common errors; actual HTTP 500 read failure. `src/endpoints/recurringCustomer/recurringCustomer-router.js:53` |

### Update recurring customer

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| PUT | `/recurringCustomer/updateRecurringCustomer` | Required `{recurringCustomer:{recurringCustomerID,...}}`; full recurring fields. Session account; stored customer ID is preserved | HTTP 200 `{recurringCustomer:{recurringCustomersData:[row],grid},message,status:200}` | Common errors; actual HTTP 404 missing/foreign recurring row; actual HTTP 500 malformed ID/body/SQL/readback failure. `src/endpoints/recurringCustomer/recurringCustomer-router.js:76` |

### Delete recurring customer

| Method | Path | Inputs | Success | Errors and triggers |
|---|---|---|---|---|
| DELETE | `/recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId` | Required path IDs; no body | HTTP 200 same envelope as recurring PUT | Common errors; actual HTTP 404 missing/foreign recurring row; actual HTTP 500 malformed ID/SQL/readback failure. Soft-deactivates, never physically deletes. `src/endpoints/recurringCustomer/recurringCustomer-router.js:121` |

Customer envelope **C** is `{customersList:{activeCustomerData:{activeCustomers,pagination,partial:true,changes}},changed:{customers?,deletedCustomers?,recurringCustomers?},committed:true,message,status:200,warnings?}`. `activeCustomers` is first20 full-detail customer rows; changed records identify the selected client and only its plans. Grid/tree copies and whole-account recurring refreshes are omitted.

Profile **P**: `{customerData:{customerData:contactObject,grid},customerRetainerData:{customerRetainers,grid,treeGrid},customerPaymentData:{customerPayments,grid},customerInvoiceData:{customerInvoices,grid,treeGrid},customerTransactionData:{customerTransactions,grid},customerJobData:{customerJobs,grid,treeGrid},message:'Successfully Retrieved Data.',status:200}`. The contact grid receives an object, so the array-oriented `createGrid` returns empty columns/rows; the frontend reads the contact object directly (`src/endpoints/customer/customer-router.js:138`, `src/utils/gridFunctions.js:6`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:20`).

| Customer/contact field | Requirement, type and stored meaning |
|---|---|
| `customerID`, `customerInfoID` | Required numeric identities for update. Customer-info update matches both plus account. Create generates them. |
| `customerName` | Required nonempty value for non-null `customer_name`; mapper turns empty/missing into null. varchar(100). No application name validator. UI builds first+space+last. |
| `customerBusinessName` | Optional varchar(100), empty/missing ->null; display_name prefers business name, otherwise customerName (varchar100, non-null). |
| `isCommercialCustomer`, `isCustomerActive`, `isCustomerBillable`, `isCustomerRecurring` | Boolean(value); omitted false and string `'false'` true. Full update can reset omitted flags. |
| `customerStreet`, `customerCity`, `customerState`, `customerZip`, `customerEmail`, `customerPhone` | Optional nullable strings; maximums 255,100,2,10,255,20 respectively. No application email/phone/ZIP/state-format validation. |
| `isCustomerAddressActive`, `isCustomerPhysicalAddress`, `isCustomerBillingAddress`, `isCustomerMailingAddress` | Boolean(value), omitted false, string `'false'` true. These are separate flags. |
| `accountID`, `userID` | Create trusts URL/session instead. Customer-update response uses the verified URL account; new recurring rows use the session creator and edits preserve attribution. Contact creator is preserved. |
| `recurringCustomerID` | Optional on customer update; determines whether to create, update, or deactivate an existing recurring row. Must belong to this account and customer before updating it. |

Source/limits: `src/endpoints/customer/customerObjects.js:1`, `src/endpoints/customer/customerObjects.js:12`, `src/endpoints/customer/customerObjects.js:28`, `migrations/schema-snapshot-2026-09-22.sql:404`, `migrations/schema-snapshot-2026-09-22.sql:833`, `../DS2_Frontend/src/Services/SharedPostObjects/SharedPostObjects.js:95`. Undefined optional update fields are passed to knex alongside flags/names; there is no documented patch schema.

| Recurring field | Requirement, type and stored meaning |
|---|---|
| `customerID` | Create number-coerced; owned-customer existence is required on dedicated create. Update dedicated route uses stored customer ID. Embedded customer route uses submitted customer ID. |
| `recurringCustomerID` | Required update identity, number-coerced; dedicated PUT and embedded customer updates require an account-scoped read. Embedded updates also require the stored customer to match. |
| `subscriptionFrequency` | Supported cadence, case-insensitive monthly/quarterly/semiannual/annual. Canonical H4 UI offers those four values. |
| `billingCycle` | Required integer 1–31; canonical H4 UI supports all days and clamps month-end. |
| `recurringAmount` | Required Number value, numeric(10,2); positive finite cents required by H4. |
| `startDate`, `selectedStartDate` | Optional; first truthy startDate, else selectedStartDate, else current dayjs timestamp. Stored DATE; omission on update resets to today. |
| `endDate` | Optional DATE; falsy ->null, including omitted update. H4 requires end>=start. |
| `isActive` | Optional; create defaults true only when undefined, otherwise a real boolean is required; update omits column only when undefined. String booleans are rejected. |
| `userID` | Untrusted and ignored for attribution. All creates stamp the session user; updates preserve the stored creator. |
| `accountID` | Ignored for recurring write ownership; dedicated PUT uses session, other routes use verified URL. |

Mapping and UI: `src/endpoints/recurringCustomer/recurringCustomerObjects.js:11`, `src/endpoints/recurringCustomer/recurringCustomerObjects.js:31`, `migrations/schema-snapshot-2026-09-22.sql:926`, `../DS2_Frontend/src/Pages/Customer/CustomerForms/AddCustomer/FormSubComponents/RecurringCustomerForm.js:6`, `../DS2_Frontend/src/Pages/RecurringCustomer/RecurringCustomerForms/AddCustomer/FormSubComponents/RecurringOptions.js:7`. All form objects are recursively XSS-sanitized; this does not validate the above business fields (`src/utils/sanitizeFields.js:8`).

## 4. Data model

| Table | Columns read/written |
|---|---|
| `customers` | ID/account, business/customer/display names, commercial/active/billable/recurring flags, default-now created_at. No creator column in the snapshot (`migrations/schema-snapshot-2026-09-22.sql:833`). |
| `customer_information` | ID/account/customer, six contact fields, active/physical/billing/mailing flags, creator, default-now created_at. No FK from customer_id to customers in the snapshot (`migrations/schema-snapshot-2026-09-22.sql:404`, `migrations/schema-snapshot-2026-09-22.sql:1862`). |
| `recurring_customers` | ID/account/customer, frequency/day/amount/start/end/active/creator. No created_at column and no customer FK (`migrations/schema-snapshot-2026-09-22.sql:926`, `migrations/schema-snapshot-2026-09-22.sql:2158`). |
| Ledger/profile relations | Retainers, payments, invoices, transactions, jobs and their label joins. Delete additionally reads write-offs and all recurring rows (`src/endpoints/customer/customer-router.js:125`, `src/endpoints/customer/customer-router.js:331`). |
| Account statement header | `accounts.*` plus first active mailing account-address row through invoice service (`src/endpoints/invoice/invoice-service.js:162`). |

Customer/recurring CRUD adds no note markers. Statement reads recognize existing invoice links and signed ledger values: normal payments and write-offs are stored negative; positive payments are reversals; retainers store remaining credit negative. Customer mutation does not rewrite these ledger fields (`src/endpoints/accountAudit/account-audit-logic.js:510`, `src/endpoints/accountAudit/account-audit-logic.js:530`, `src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:5`).

## 5. Read logic

| Read | Exact selection, filtering and order |
|---|---|
| Active customers | SELECT * customers INNER JOIN customer_information on customer ID; both accounts must equal request; customer active AND contact active true. Order customer_name ASC, no tie-breaker. Multiple active contacts duplicate list/count rows; no contact means invisible (`src/endpoints/customer/customer-service.js:1`, `src/endpoints/customer/customer-service.js:52`). |
| Customer search/page | Grouped parameterized OR LIKE on lowercase display/business/customer names, city/state/email and text customer ID. `%`/`_` remain wildcards. Count joined rows in separate query then ordered LIMIT/OFFSET. No street/phone/ZIP search (`src/endpoints/customer/customer-service.js:11`, `src/endpoints/customer/customer-service.js:56`). |
| Profile contact | customers.* and information.*, selected recurring columns. Owned customer ID; owned active contact INNER JOIN; owned active recurring LEFT JOIN. Customer need not be active. No ordering; router takes first contact/recurring combination (`src/endpoints/customer/customer-service.js:67`, `src/endpoints/customer/customer-router.js:125`). |
| Profile retainers | Raw account/customer retainer rows, no active filter or order (`src/endpoints/retainer/retainer-service.js:24`). |
| Profile payments | Payments.* with customer/creator labels via INNER JOIN; payment account/customer; created_at DESC, no billed/active filter (`src/endpoints/payments/payments-service.js:50`). |
| Profile invoices | Raw invoices account/customer; invoice_date ASC, includes parents and snapshots (`src/endpoints/invoice/invoice-service.js:110`). |
| Profile transactions | Transactions.* plus customer/employee/description/type labels, INNER JOIN all related rows, account/customer filters, created_at DESC (`src/endpoints/transactions/transactions-service.js:107`). |
| Profile jobs | Select job columns and explicit scoped type/category labels, ordered by job created_at then ID ascending. Tree root total uses the latest family row in that order; no sum across snapshots. Fixed F23; `review-job-selection.integration.spec.js`. |
| Recurring list | Recurring.* plus customer display_name INNER JOIN customer ID and account; recurring account and active=true. No customer-active/start/end-date filter and no ORDER BY (`src/endpoints/recurringCustomer/recurringCustomer-service.js:3`). |
| Recurring identity/delete guard | Identity read uses recurring ID+account. Customer delete guard uses customer ID+account and includes inactive subscriptions (`src/endpoints/recurringCustomer/recurringCustomer-service.js:14`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:19`). |
| Statement | Raw owned customer first, then parallel raw account/customer invoices, payments, write-offs, transactions, retainers, without active filters or joins. Orders: invoice_date+invoiceID ASC, payment_date+paymentID ASC, writeoff_date+writeoffID ASC, transaction_date+transactionID ASC, retainer created_at+ID ASC. Timestamp-bearing non-transaction rows also select created_at::text for microsecond comparisons. All reads, including the account header, share one REPEATABLE READ READ ONLY transaction (fixed [F27](../_review/findings.md#f27)) (`src/endpoints/customer/customer-statement.js:14`, `src/endpoints/accountAudit/account-audit-service.js:10`). |

Grid columns derive from the first row; positional grid IDs are not database identity. Trees use ID/parent maps with missing parents promoted to roots (`src/utils/gridFunctions.js:6`, `src/utils/gridFunctions.js:68`).

## 6. Calculations

### Customer identity and activation

Display name=`customerBusinessName || customerName`. Active-list membership requires both the customer and one contact active. Marking a customer inactive is allowed even with debt/work. Warning balance uses **one null-parent invoice**, invoice_date DESC then invoiceID DESC, and its stored remaining balance; >0 produces a two-decimal dollar warning. Separately count account/customer billable transactions with invoice NULL and warn if count>0. No warning sums snapshot chains, all same-day parents or all credits (`src/endpoints/customer/customerObjects.js:5`, `src/endpoints/customer/customer-service.js:154`).

Recurring settings now drive H4's entity-specific periodic charge generation. Create Invoice prepares due fees before reading eligibility; explicit catch-up and reasoned edit/skip controls preserve period history. Covered work and excess flags remain independent of the base fee. See [recurring billing](recurring-billing.md) for the complete calendar, cutover, concurrency and API rules.

### Profile balances from invoice preview

The frontend calls the separately mounted invoice create/preview endpoint with one customer, showWriteOffs=false and all isFinalized/isRoughDraft/isCsvOnly flags false. Backend calculation reads one REPEATABLE READ READ ONLY snapshot; those flags bypass PDF/ZIP creation and finalize writes. This is separate from the profile GET and the statement PDF endpoint (`../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:51`, `src/endpoints/invoice/invoice-router.js:307`, `src/endpoints/invoice/invoice-router.js:346`, `src/endpoints/invoice/createInvoice/billingSnapshot.js:27`).

The preview first gets max parent/self-parent invoice date and newest parent marker ordered invoice_date DESC, created_at DESC, ID DESC. It loads account/contact information, unbilled joined job/type transactions, payments/write-offs after that marker, all retainers, and outstanding invoice families (`src/endpoints/invoice/createInvoice/createInvoiceQueries.js:19`, `src/endpoints/invoice/invoice-service.js:183`, `src/endpoints/invoice/invoice-service.js:207`). Payment/write-off membership is created_at strictly after parent timestamp in PostgreSQL; no parent means all, legacy date-only marker uses >= date. It is not a payment/performed-date range (`src/endpoints/invoice/invoice-service.js:10`, `src/endpoints/invoice/invoice-service.js:288`, `src/endpoints/invoice/invoice-service.js:315`).

Outstanding input reads account/customer null-parent invoices created_at DESC, ID DESC, then all child rows of those IDs in the same order. Parents older than latest billing date are skipped as rolled forward. A parent without children is included if remaining>0. Latest child remaining=0 and paid=true closes its whole chain. Otherwise children+parent are included if any child remains positive, or if the current-invoice/payment-after-last-bill fallback applies. The calculator groups by invoice_number, excludes paid/zero groups without an in-scope payment/write-off, requires invoice_date<=last bill date and positive remaining, and keeps the first record unless a later invoice_date is found. It sums those remaining values (`src/endpoints/invoice/invoice-service.js:377`, `src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js:48`).

| Profile value | Actual formula |
|---|---|
| Current outstanding invoices total | Sum selected current-family remaining balances above. Older parents are not added again. |
| Last billed / due date / last statement balance | First outstanding record's invoice_date/due_date/total_amount_due. Missing dates show dash. These are not necessarily the most recently issued paid statement (`../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:49`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:195`). |
| Multiple outstanding invoices | Returned outstanding record count>1 (`../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:208`). |
| Charges this cycle | Sum billable unbilled transaction totals grouped by exact job; hidden negative job write-offs reduce groups, including adjustment-only groups. No old-unbilled date exclusion (`src/endpoints/invoice/invoice-service.js:263`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:65`). |
| `paymentTotal` | Signed sum of marker-qualified payments with no invoice link. Tagged payments already affect outstanding snapshots; they are excluded from this sum (`src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:11`). |
| `retainerAppliedToInvoice` | Subset of that same paymentTotal whose form is exactly Retainer or Prepayment (`src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:22`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:10`). |
| UI “Payments Since Last Bill” | `paymentsReceivedTotal`: all marker-qualified receipts, including tagged payments and retainer applications exactly once ([F13](../_review/findings.md#f13), fixed) (`../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:238`). |
| Starting/current retainer labels | Both derive from sum of each chain's latest active, nonzero current_amount, selected by exact created-at then ID, retaining negative credit sign. `remainingRetainer=retainerTotal`; the starting label does not mean sum of original deposits (`src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:33`, `src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:53`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:18`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfile.js:223`). |
| Amount due | `outstandingInvoiceTotal + transactionsTotal + paymentTotal + writeOffTotal`. Do not subtract unused retainer funds or the retainer payment subset a second time. Pre-retainer amount=`amountDue - retainerAppliedToInvoice`, removing that negative credit from the calculation (`src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:4`). |

With hidden write-offs, `writeOffTotal` contains invoice-linked credits only when their root is older than latest billing date (or date information is absent); current-chain adjustments already affected outstanding snapshots. If there is no unbilled work but an invoice-linked credit, effective showWriteOffs becomes true for **all** calculators, so all eligible credits appear once as separate adjustments. Totals are JavaScript Number sums, with NaN/type checks; these calculators do not round after every addition (`src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:23`, `src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:45`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:21`).

Example: outstanding $200 + work $150 + payments −$50 (including −$20 retainer) + write-offs −$10 = $290 due. Pre-retainer amount=$310. Unused retainer −$80 stays −$80. The profile payment label shows −$50; with an additional tagged −$30 receipt it shows −$80, while paymentTotal remains −$50 ([F13](../_review/findings.md#f13); formula citations above).

### Statement PDF: activity and current amount due

The customer, account header and five ledger datasets are read in one REPEATABLE READ READ ONLY transaction (F27). The activity ledger includes all recorded work, billed and unbilled. Billable transaction is a positive charge; non-billable is a zero-charge row. Normal negative payment becomes positive credit; a positive payment reversal becomes a charge. Write-off credit is absolute amount. Root invoice issuance and root retainer establishment are informational zero-charge/zero-credit rows, avoiding duplicate work/deposit charges (`src/endpoints/accountAudit/account-audit-logic.js:441`).

Sort events by performed/payment/write-off/invoice/retainer timestamp ascending; tied timestamps use retainer, work, invoice, payment/reversal, write-off order. Running balance starts 0 and each event applies `round2(previous+charge-credit)`. Opening balance is the last running value before start day. Include events through end day. Closing is last included running balance, or opening if none. This preserves old activity in opening balance instead of summing only selected dates (`src/endpoints/accountAudit/account-audit-logic.js:543`, `src/endpoints/customer/customer-statement.js:28`). Example: opening100, work50, payment−30, write-off−10 yields closing110.

The PDF's **current amount due** is the audit engine's full current rolling amount, even when the requested end date is historical. It is not the range's closing activity balance. The audit groups invoice root/snapshots, selects latest snapshot by exact timestamp+ID, and sums nonnegative remaining across parents on the newest invoice date. It does not resurrect older debt after the newest statement is paid (`src/endpoints/customer/customer-statement.js:73`, `src/endpoints/accountAudit/account-audit-logic.js:143`, `src/endpoints/accountAudit/account-audit-logic.js:736`).

Audit amount due, rounding to cents, is current statement remaining + all unbilled billable work with a job − pending job write-offs − pending adjustment-only write-offs − pending uninvoiced payments − pending invoice-linked credits on absorbed older chains. Current unbilled work is limited through the billing date; lifetime diagnostics still include future work. Pending payments/write-offs use the strict newest-parent created-at gate, preserving microseconds; missing timestamp falls back to >=invoice date. Current-chain write-offs already in remaining are not subtracted twice; missing root/date is treated as credit eligible. Unused retainers are not subtracted here (`src/endpoints/accountAudit/account-audit-logic.js:130`, `src/endpoints/accountAudit/account-audit-logic.js:804`, `src/endpoints/accountAudit/account-audit-logic.js:835`, `src/endpoints/accountAudit/account-audit-logic.js:883`, `src/endpoints/accountAudit/account-audit-logic.js:907`). The raw audit can include a job-ID-bearing orphan which the invoice query's INNER JOIN drops; historical-data parity is not guaranteed merely by the shared intent.

PDF is LETTER, margin50, measured row heights and page breaks, generated into memory and returned. It writes no snapshot/S3 object and sends no email. It prints account name or fallback James F. Kimmel & Associates, date/description/charge/credit/running balance, opening and closing (`src/endpoints/customer/customer-statement.js:57`, `src/endpoints/customer/customer-statement.js:98`).

## 7. Create, edit, and delete

Create sanitizes/maps and checks exact display_name equality against the **active joined customer list**. Case variants, inactive customers and customers with no active contact do not match this check. It is outside the transaction and has no uniqueness constraint here. Customer, contact and optional recurring inserts run in one transaction and roll back together. Response refresh is after commit; it may fail without undoing creation (`src/endpoints/customer/customer-router.js:42`, `src/endpoints/customer/customer-router.js:50`, `src/endpoints/customer/customer-router.js:61`, `src/endpoints/customer/customer-router.js:87`).

Update holds the owned customer ledger lock and commits customer, contact and optional recurring writes together. Missing owned contact or any later write failure rolls back the whole save ([F21](../_review/findings.md#f21), fixed). Customer/contact writes require an owned affected row. There is no duplicate-name check on update. Contact created-at/creator survive; customer created-at survives (`src/endpoints/customer/customer-router.js:260`, `src/endpoints/customer/customer-service.js:111`, `src/endpoints/customer/customer-service.js:124`, `src/endpoints/customer/customerObjects.js:40`).

Embedded recurring handling tests the raw recurring flag: truthy with no recurring ID inserts; falsy with positive recurring ID deactivates and stamps end_date now; truthy with positive ID updates. Before any write, an existing recurring ID must belong to the verified account and the same customer. These checks and writes run under the customer ledger lock. Deactivating the customer alone does not automatically deactivate recurring, jobs, contacts or ledger records. Warnings are emitted after any save with mapped active=false, not only on a true-to-false transition (`src/endpoints/customer/customer-router.js:264`, `src/endpoints/customer/customer-router.js:294`).

Hard customer delete validates a positive owned ID and holds `FOR NO KEY UPDATE` on that customer in one transaction, using the same lock as job/ledger writers. Raw existence checks cover jobs, retainers, invoices, payments, write-offs, transactions, recurring records and quotes, including inactive/zero/paid and malformed joined records. Any history refuses deletion and advises deactivation. A writer that commits first is seen by the guards; a writer after deletion fails its ownership lookup ([F25](../_review/findings.md#f25), fixed).

For a permitted unused-customer deletion, all owned active/inactive contact rows and the customer are deleted atomically ([F24](../_review/findings.md#f24), fixed). No new foreign keys or historical data repair are introduced. Existing schema behavior for other references remains: rate agreements/audit history cascade, processed-image and timesheet customer references become null, and suggestion references can refuse deletion. No S3-object cleanup is performed. `review-customer-delete.integration.spec.js` covers contact removal, quote retention, the concurrent writer race, and a raw job hidden by a scoped join.

Dedicated recurring create validates and locks the owned customer, then atomically inserts the recurring row and reconciles the customer flag ([F21](../_review/findings.md#f21), fixed). Multiple subscriptions remain allowed; foreign customer IDs are refused (fixed [F2](../_review/findings.md#f2)). Dedicated recurring PUT preserves stored customer ID and creator while updating other mapped fields. DELETE sets is_recurring_customer_active=false and end_date now, preserving the row. Create/PUT/DELETE and embedded saves recompute customers.is_recurring from any remaining active owned subscription under the same lock ([F22](../_review/findings.md#f22), fixed). The explicit subscription active flag defines membership; start/end dates bound H4 due generation and coverage; the active flag still controls membership (`src/endpoints/recurringCustomer/recurringCustomer-router.js:26`, `src/endpoints/customer/customer-service.js:120`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:90`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:135`).

Customer detail edits preserve financial snapshots; generated plan changes use the canonical versioned recurring controls and do not rewrite historical invoice snapshots, transaction amounts or payment markers. No notification sender is called from these CRUD handlers. Account information/contact name changes therefore affect future joined reads while already stored monetary history remains stored (`src/endpoints/customer/customer-router.js:247`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:33`).

## 8. Invariants, edge cases, and tests

| Rule | Source-read test evidence |
|---|---|
| Trusted customer create account/creator; failed recurring insert rolls customer/contact back | `test/endpoints/customer/customerCrud.integration.spec.js:90`, `test/endpoints/customer/customerCrud.integration.spec.js:120`. |
| Contact creator survives update; write-off-only history blocks delete; deactivation warns | `test/endpoints/customer/customerCrud.integration.spec.js:144`, `test/endpoints/customer/customerCrud.integration.spec.js:170`, `test/endpoints/customer/customerCrud.integration.spec.js:197`. |
| Paging, profile, deactivation and deletion guards | `test/integration/coverage-account-users-auth-misc.integration.spec.js:1569`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1609`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1648`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1714`. |
| Recurring create/list/update/delete; real scoped update and soft-delete assertions | `test/integration/coverage-account-users-auth-misc.integration.spec.js:1227`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1322`, `test/integration/coverage-account-users-auth-misc.integration.spec.js:1375`. Some comments still describe old defects; assertions were used. |
| Exact statement membership and audit/engine parity | `test/endpoints/accountAudit/statement-gate.spec.js:1`, `test/endpoints/accountAudit/engine-parity.spec.js:1`. `review-statement-snapshot.integration.spec.js` also verifies a consistent statement snapshot during a concurrent charge/payment commit. |
| Profile routing/edit UI expectations | `../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js:1`, `../DS2_Frontend/src/Pages/Customer/CustomerProfile/EditCustomerProfile.test.js:1`. |

## 9. Limitations and open decisions

F1 is fixed by `review-customer-response.integration.spec.js` (successful and failed updates). F2 is fixed by `review-related-ids.integration.spec.js`. Findings [F21](../_review/findings.md#f21), [F22](../_review/findings.md#f22), [F24](../_review/findings.md#f24), [F25](../_review/findings.md#f25), [F13](../_review/findings.md#f13) and [F27](../_review/findings.md#f27) in [consolidated findings](../_review/findings.md) record fixed partial saves (F21), fixed recurring-flag drift (F22), fixed contact orphans (F24), fixed unlocked deletion (F25), fixed profile payment double-counting (F13) and fixed statement snapshot consistency (F27). Multiple active contacts and different legacy response envelope shapes remain observable limitations; H4 validates recurring calendars/fees and selects one recurring summary deterministically for customer profile data (`src/endpoints/customer/customer-service.js:67`, `src/endpoints/customer/customer-statement.js:28`).

The accountant report lists same-day duplicate statements; 61 possibly double-credited bill-day write-offs for 28 customers ($8,331.75 supported/$12,208 possible); 904 parent payment-sign candidates adopted into migration 019 and 14 exceptions; parent/snapshot desync on invoices 2015/506; 5 jobless billable entries/$365 and 9 cross-customer links; $14.8K stale work on 51 customers; customer228's $472 remainder with suspected duplicate $153 retainer subtraction; 151 stale job totals; and $1.43M internal billable time. These are report figures, not fresh measurements (`scripts/review-2026-09/FINAL_REPORT.md:45`).

Owner decision 2 makes negative statement finalization optional: skip by default, explicitly select to issue and carry signed credit forward. H2 aging follows original unpaid obligations and preserves their dates through later statements. Sent records are locked and bounced receipts use the narrow exception workflow. H3 adds general credit memos, refunds and void/rebill; H4 prepares recurring charges. Period close and approval workflows remain outside the owner's scope. See [receipts and aging](../ledger/receipts-and-obligations.md), [corrections](../ledger/invoice-corrections.md) and [recurring billing](recurring-billing.md).

Rollout requires backup, reviewed ordered migrations and 019 rehearsal with saved skipped-row evidence; 020 immediately before new backend without intervening account creation; 021 before new backend, then reviewed tracker ownership backfill with count/readback/employee-isolation checks; backend before frontend; and review of `INTERNAL_CUSTOMER_IDS`/`BILLING_TIMEZONE=America/Phoenix`. No rollout actions were performed (`scripts/review-2026-09/FINAL_REPORT.md:67`, `migrations/README.md:1`).

Coverage: **10 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F2 verification: `test/integration/review-related-ids.integration.spec.js` covers forged related IDs on create/update, session creators, preserved update attribution, and historical malformed label joins. No historical production-copy rows are repaired by this change.


## Owner run 2 — retainers and duplicate review

Customer Retainers and PrePayments now includes an audited refund/adjust form and immutable history, including exhausted roots. Success refreshes profile balances. Customer statement PDFs include these events as informational entries with amount, before/after credit, method/reference/reason; running debt is unchanged. Common customer ledger grids also show possible duplicate badges. See [retainer events](../ledger/retainers-and-prepayments.md) and [duplicates](../ledger/duplicates.md).

## Owner run 3

Customer statement PDFs now label a negative rolling balance Credit balance (no payment due). This remains distinct from the statement transaction-basis running balance and separate retainer availability. See the [owner decisions](../decisions/2026-09-24-owner-decisions.md) and [combined scenario](../scenarios/16-owner-combined.md).


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.

## Run 5 presentation

The Audit Record tab now displays human business postings/field changes and shared USD formatting. Its Print option defaults to Client record and also offers Full evidence record; the printed-record list identifies the type. Existing role and tenant guards are unchanged. See [Audit Record](../platform/audit-ledger.md).

## Pass 3 response after a committed change

Customer/recurring, job, catalog, quote and user mutations in this guide preserve their successful response payload. If the mutation commits but rebuilding its response lists fails, the API returns HTTP 200 with `status: 200`, `committed: true` and a warning to reload without submitting the change again. Precommit errors retain their existing refusal and rollback behavior. This prevents a saved create, edit or delete from being reported as an unsuccessful write. Regression: `path-matrix-03-commit-outcomes.integration.spec.js`, with exactly one stored mutation checked for each create/update/delete. Drafts stay editable and write nothing to the ledger; finalize is the sent/lock boundary.

## H1 business scope (2026-09-26)

Customers remain account-wide. The profile’s business/all-business picker scopes its financial tabs. The all-business overview shows each business’s billed balance, next statement and held funds separately; choose one to inspect its detailed financial tables. Customer statements use distinct business sections under the account report header. Embedded recurring settings require a business when a plan is first created, as do standalone recurring forms; existing plans receive explicit default legacy attribution. H4 now generates audited occurrences; see [recurring billing](recurring-billing.md).

[Business entity contracts and rules](../platform/billing-entities.md) and [H1 results](../decisions/2026-09-26-run-H1-results.md) supersede earlier account-wide scope descriptions.

## H4 plan compatibility

The customer profile remains account-wide. Its legacy recurring summary selects the lowest active plan ID; the complete multi-plan view is `/billing/recurring`. Existing embedded create/update endpoints retain their payloads and response shapes. H4 fills the new anchor/entity/description fields and validates positive cents, supported cadence, dates/day and explicit boolean values. Legacy changes to a plan with generated history are refused with a link to canonical, reasoned versioned editing; unchanged plan values can accompany unrelated customer edits. Recurring membership is reconciled across all businesses. The canonical plan API, occurrence states, permanent skips and eight-plan cutover are documented in [recurring billing](recurring-billing.md).

## H7 customer submission recovery

The New Customer form allows one pending submission and shows a disabled Saving button until it finishes. A server refusal or transport failure displays its error and retains entered fields. Lost confirmation does not prove a failed database write: the operator must check the client list before explicitly retrying. The form never retries automatically. A confirmed successful response updates the client list and clears the draft as before. Ordinary customer-create permissions and API payloads are unchanged. `NewCustomer.test.js` covers success, rapid clicks, rejected transport, server refusal and body-status refusal; `e2e/tests/customers.spec.js` aborts a request, verifies zero new rows, then delays an explicit retry and proves exactly one stored customer.

## H9 customer directory and search

`GET /customer/lookup/:accountID/:userID` requires the existing manager/admin gate and account match. It returns `{status:200,customers:[compactIdentity]}`. Inputs `page`/`limit`/`search` use the bounded validation described in [performance](../platform/performance.md); limit defaults20, maximum100. Optional scalar positive `customerId` retrieves exactly that owned client, including inactive identities used by historical records. Missing/foreign selected ID404; invalid input400; auth401/403; failed read500. Search is case-insensitive over display/business/customer name or exact numeric ID, sorted display name then ID. It never returns contacts, email or address fields.

The initial directory uses **1,000** as the local/remote cutoff. Client grids retain their independent full-detail paginated API; picker identities are not grid/profile records. Create/edit/delete respond with changed client/deleted ID, only that client's recurring-plan records where relevant, and the first20 customers. `mergeWorkspace` patches the directory without replacing it with a page, including deactivation and crossing the threshold. Record pages load the exact selected identity. Current owned endpoint count: **11**. See `listViews.test.js`, `Lookups.test.js`, `path-matrix-H9-loading` and remote picker browser tests.

### Scoped entry-form reads (H9)

The write-off job picker adds `currentCycle=true` to the existing per-client endpoint. It searches/pages exact referenced job versions and preserves the former amount rule: sum only billable work without an invoice or retainer, grouped by exact job ID. Zero-valued historical groups remain selectable; IDs disambiguate identical descriptions. Lifetime `current_job_total` is never substituted for this amount. Client/business changes invalidate old choices. The current-cycle aggregate uses account-qualified unique-key joins with the exact `ds2_effective_entity` precedence: explicit entity, amended legacy billing scope, original attribution, then reviewed resolution. Read-only legacy equivalence tests compare both the rows and amounts with the existing scoped view.

Legacy payment and write-off invoice selectors request `GET /customer/activeCustomers/customerByID/A/U/C?section=invoices&entityId=E`. This projection returns only that client's invoice snapshots in `customerInvoiceData`, preserving current-chain/absorption selection rules without downloading jobs, work, payments or retainers. It rejects malformed sections and missing/foreign clients, retains existing role/business guards, and performs no writes. Full client-profile/history views remain unchanged. Late responses cannot reset an invoice/job or overwrite the new client's choices.


H9 also applies the profile projection to active payment record editors and pending-payment review (`section=invoices`). Editors hydrate their exact selected job and retainer separately. Retainer deletion uses `section=payments` to check the complete client payment history, including links outside any grid page, without fetching jobs or work. Retainer credit transfer uses `section=retainers`; all business balances remain available for choosing the source. These projections retain the existing manager/admin read guards, selected-business behavior and failure recovery. The actual client profile still loads its full per-client history/tree views.

## H10 balance reads

The per-business profile balance preview uses the same newly batched invoice input reader; aggregate profile balances retain independent Account Audit arithmetic. Full profile histories remain per-client and may still be large for the two exceptional job histories. H10 records that residual transfer separately from the account-wide calculation budgets. No contact, profile, historical-record or selector response shape changes. [H10 measurements](../decisions/2026-09-26-run-H10-results.md).


## H8 presentation and help

The client grid presents names before other details, omits internal-key columns and keeps search typing and header/dialog focus intact when a delayed page arrives. All client-profile tabs share route-specific help from the single page-help source; opening help changes no client or financial data.
