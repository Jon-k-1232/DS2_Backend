# Customers, contact information and recurring customers

## 1. Purpose and UI

`/customers/customersList` displays `CustomerGrid` and the `NewCustomer` dialog. `/customers/recurringCustomers` displays `RecurringCustomerGrid` and `AddRecurringCustomer`. Rows open `/customers/customersList/customerProfile/:customerId/customerInvoices`; profile subroutes include customer invoices, transactions, jobs, payments, retainers and edit. Components are in `src/Pages/Customer/CustomerProfile/` in the frontend (`../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerRoutes.js:20`, `../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.js:92`, `../DS2_Frontend/src/Pages/RecurringCustomer/RecurringCustomerGrids/RecurringCustomerGrid.js:17`).

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

Customer envelope **C**: `{customersList:{activeCustomerData:{activeCustomers,grid}},recurringCustomersList:{activeRecurringCustomersData:{activeRecurringCustomers,grid}},message,status:200,warnings?}`; lists have no pagination in create/update responses (`src/endpoints/customer/customer-router.js:87`, `src/endpoints/customer/customer-router.js:275`).

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
| `subscriptionFrequency` | Required non-null varchar(255); no enum validation. UI offers Monthly/Quarterly/Yearly. |
| `billingCycle` | Required Number value for integer `bill_on_date`; UI offers 1 or 15, server does not enforce these or a 1–31 range. |
| `recurringAmount` | Required Number value, numeric(10,2); no positive/finite validation. |
| `startDate`, `selectedStartDate` | Optional; first truthy startDate, else selectedStartDate, else current dayjs timestamp. Stored DATE; omission on update resets to today. |
| `endDate` | Optional DATE; falsy ->null, including omitted update. No end>=start validation. |
| `isActive` | Optional; create defaults true only when undefined, otherwise Boolean; update omits column only when undefined. String `'false'` is true. |
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

Recurring amount/day/frequency are stored settings, not a charge calculation in these routers. Automatic generation of recurring charges from these fields is **not determined from the code** reviewed. Setting recurring does influence the transaction form's billability defaults; invoice transaction totals still depend on each entry's billable flag (`src/endpoints/recurringCustomer/recurringCustomerObjects.js:13`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/FormSubComponents/SharedTransactionsFunctions.js:7`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:81`).

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

Dedicated recurring create validates and locks the owned customer, then atomically inserts the recurring row and reconciles the customer flag ([F21](../_review/findings.md#f21), fixed). Multiple subscriptions remain allowed; foreign customer IDs are refused (fixed [F2](../_review/findings.md#f2)). Dedicated recurring PUT preserves stored customer ID and creator while updating other mapped fields. DELETE sets is_recurring_customer_active=false and end_date now, preserving the row. Create/PUT/DELETE and embedded saves recompute customers.is_recurring from any remaining active owned subscription under the same lock ([F22](../_review/findings.md#f22), fixed). The explicit subscription active flag defines membership; start/end dates remain descriptive and do not schedule activation (`src/endpoints/recurringCustomer/recurringCustomer-router.js:26`, `src/endpoints/customer/customer-service.js:120`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:90`, `src/endpoints/recurringCustomer/recurringCustomer-router.js:135`).

Customer/recurring edits have no billed-history gate and do not rewrite historical invoice snapshots, transaction amounts or payment markers. No notification sender is called from these CRUD handlers. Account information/contact name changes therefore affect future joined reads while already stored monetary history remains stored (`src/endpoints/customer/customer-router.js:247`, `src/endpoints/recurringCustomer/recurringCustomer-service.js:33`).

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

F1 is fixed by `review-customer-response.integration.spec.js` (successful and failed updates). F2 is fixed by `review-related-ids.integration.spec.js`. Findings [F21](../_review/findings.md#f21), [F22](../_review/findings.md#f22), [F24](../_review/findings.md#f24), [F25](../_review/findings.md#f25), [F13](../_review/findings.md#f13) and [F27](../_review/findings.md#f27) in [consolidated findings](../_review/findings.md) record fixed partial saves (F21), fixed recurring-flag drift (F22), fixed contact orphans (F24), fixed unlocked deletion (F25), fixed profile payment double-counting (F13) and fixed statement snapshot consistency (F27). Multiple active contacts/recurring rows, missing range validation and different response envelope shapes are also observable limitations (`src/endpoints/customer/customer-service.js:67`, `src/endpoints/customer/customer-statement.js:28`).

The accountant report lists same-day duplicate statements; 61 possibly double-credited bill-day write-offs for 28 customers ($8,331.75 supported/$12,208 possible); 904 parent payment-sign candidates adopted into migration 019 and 14 exceptions; parent/snapshot desync on invoices 2015/506; 5 jobless billable entries/$365 and 9 cross-customer links; $14.8K stale work on 51 customers; customer228's $472 remainder with suspected duplicate $153 retainer subtraction; 151 stale job totals; and $1.43M internal billable time. These are report figures, not fresh measurements (`scripts/review-2026-09/FINAL_REPORT.md:45`).

Negative statement finalization is skipped pending a credit carry-forward/credit-memo design. Aging measures statement age; oldest_open_charge_date is a FIFO estimate. Charge-level aging, period locks/adjustment-only corrections, voids rather than historical deletion, and persisted billing runs remain decisions (`scripts/review-2026-09/FINAL_REPORT.md:56`, `scripts/review-2026-09/FINAL_REPORT.md:61`).

Rollout requires backup, reviewed ordered migrations and 019 rehearsal with saved skipped-row evidence; 020 immediately before new backend without intervening account creation; 021 before new backend, then reviewed tracker ownership backfill with count/readback/employee-isolation checks; backend before frontend; and review of `INTERNAL_CUSTOMER_IDS`/`BILLING_TIMEZONE=America/Phoenix`. No rollout actions were performed (`scripts/review-2026-09/FINAL_REPORT.md:67`, `migrations/README.md:1`).

Coverage: **10 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F2 verification: `test/integration/review-related-ids.integration.spec.js` covers forged related IDs on create/update, session creators, preserved update attribution, and historical malformed label joins. No historical production-copy rows are repaired by this change.
