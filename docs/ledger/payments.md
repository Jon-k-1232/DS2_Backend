# Payments

## Owner decision update — 2026-09-25

Pass 4 UI correction: background grid refreshes preserve focus in open payment forms (`GridFocus.test.js`).

Payment details tolerate customer lookups still loading and retain the stored customer ID. Sent receipts immediately show **Sent — locked** and **Open invoice history**, without an ordinary delete control (`SentScreens.test.js`).

Delete requests also guard pending clicks and display HTTP/network failures while retaining the record for an explicit retry. `DeleteFinancial.failure.test.js` and `user-mistakes-delete.spec.js` cover refusal, cancel, transport failure and a successful retry of an eligible unissued receipt.

An issued receipt cannot be edited, deleted or reversed through ordinary payment routes: HTTP 409 `SENT_INVOICE_LOCKED`, with the owning invoice number, even for metadata-only edits. Use the invoice detail exception flow to flag selected bounced receipts, reverse once and issue an archived revision or roll forward. New receipts against a sent invoice still append fresh balance snapshots; the parent remains unchanged. Payment pickers now use the latest child balance and exclude absorbed/settled chains. Unused bounced overpayment credit appends a zero retainer snapshot when locked; history/revision disclose the cancelled credit separately. Used excess refuses without writes. The mutation/mirror mechanics below apply only to unissued records. [Full contract](../invoicing/invoices.md).


Source review dated 2026-09-24. Paths are relative to `DS2_Backend`. Shared middleware, schema conventions, and statement calculations are in [ledger-conventions.md](ledger-conventions.md).

## 1. Purpose and UI

Payments reduce the customer's current billed debt. They can use received money or draw a retainer. Excess received money can become a new prepayment. An NSF/bounced payment is reversed by a new positive payment; the original is retained. (`src/endpoints/payments/payment-logic.js:428`, `src/endpoints/payments/payment-logic.js:1012`.)

| Location | Route and files |
| --- | --- |
| Account payments grid and add dialog | `/transactions/customerPayments`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:28`; `../DS2_Frontend/src/Pages/Transactions/TransactionGrids/PaymentsGrid.js:80`; `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Payment.js:61`. |
| Payment detail actions | `/transactions/customerPayments/deletePayment` and `/transactions/customerPayments/reversePayment`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/PaymentSubRoutes.js:40`. Components: `DeleteTransaction/DeletePayment.js` and `ReversePayment/ReversePayment.js` under `../DS2_Frontend/src/Pages/Transactions/TransactionForms/`. `EditTransaction/EditPayment.js` exists there, but both its `editPayment` route and navigation item are commented out. The update API remains available. (`../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/PaymentSubRoutes.js:55`, `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/PaymentSubRoutes.js:90`.) |
| Customer payments | `/customers/customersList/customerProfile/:customerId/customerPayments`; `../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.js:95`; `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfilePayments.js:1`. |
| Invoice payments | `/invoices/invoices/invoiceDetail/invoicePayments`; `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceSubRoutes.js:56`; `../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoicePayments.js:1`. |

The add form requires a customer, positive amount, payment method, and either an invoice or the hold option. `Retainer`/`Prepayment` methods require a selected retainer in the UI. The API's checks differ: method is optional, and the actual draw is controlled by `selectedRetainerID`, not the method's label. The form exposes hold and overpayment flags. (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Payment.js:61`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Payment.js:127`, `src/endpoints/payments/payment-logic.js:445`, `src/endpoints/payments/payment-logic.js:521`.)

## 2. Access rules

All six routes require a valid active-user JWT and role `manager`, `admin`, `super admin`, or `owner`. `enforceAccountId` requires integer URL `accountID` equal to the authenticated account. There is no self-or-privileged check on URL `userID`; creates/reversals use `req.user.user_id`. Stored account/customer links control edits and deletes. Authentication failure is HTTP 401; wrong role/account is HTTP 403. The frontend manager gate includes `owner` ([F37](../_review/findings.md#f37)). (`src/app.js:143`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/payments/payments-router.js:6`, `src/endpoints/payments/payments-router.js:44`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.)

## 3. API reference

Paths below include the `/payments` mount. Common middleware can also return HTTP 400/413 for JSON parsing/size, 429 for rate limiting, or 500 for an uncaught failure; see [API conventions](ledger-conventions.md#3-api-conventions). Input validation failures return **HTTP400**. Other ledger-state failures in these mutation routes remain **HTTP200 with JSON `status:500`**, even when a core rule internally carries 400, 404, 422, or 423. (`src/app.js:70`, `src/app.js:94`, `src/endpoints/payments/payments-router.js:26`.)

### Payment input fields

Create and update use `{payment:{...}}`; fields are sanitized before mapping. Delete needs only `payment.paymentID`. Unknown fields do not become arbitrary database columns. (`src/endpoints/payments/payments-router.js:22`, `src/endpoints/payments/payments-router.js:101`, `src/endpoints/payments/payments-router.js:125`, `src/endpoints/payments/paymentsObjects.js:3`.)

| Field | Type, requiredness, validation, and limits |
| --- | --- |
| `customerID` | Create: required numeric/coercible positive integer identifying a customer in this account; missing/invalid customer fails. Update: optional; a different valid positive ID is refused. It never reassigns the stored row. (`src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/payments/payment-logic.js:910`.) |
| `unitCost` | Required on create **and update**, including metadata-only update. Number/coercible string; absolute value rounded to cents must be greater than zero. Stored negative. Request maximum99999999.99; invoice/retainer limits also apply. Database `numeric(10,2)`. (`src/endpoints/payments/payment-logic.js:435`, `src/endpoints/payments/payment-logic.js:922`, `migrations/schema-snapshot-2026-09-22.sql:589`.) |
| `transactionDate` | Create: required real calendar date (YYYY-MM-DD or supported ISO timestamp), validated before mapping. Update: optional; an omitted date is preserved; explicit invalid/null/empty date refuses. Stored SQL `date`. No future-date prohibition here. (`src/endpoints/payments/payment-logic.js:438`, `src/endpoints/payments/payment-logic.js:989`.) |
| `selectedInvoiceID` | Create: required unless hold-only; convert with `Number(value)`, map falsy result to null, then account-scoped invoice lookup and customer check. A child or old parent can be selected; posting resolves the current chain. Update: no relinking; a nonzero different ID is refused when the stored row has an invoice. (`src/endpoints/payments/paymentsObjects.js:8`, `src/endpoints/payments/payment-logic.js:445`, `src/endpoints/payments/payment-logic.js:907`.) |
| `selectedRetainerID` | Optional numeric/coercible ID; convert with `Number(value)` and map falsy result to null. When supplied, requires an invoice, same-customer latest active retainer balance, and sufficient funds. Update cannot change funding; null/omitted does not detach the stored link. (`src/endpoints/payments/paymentsObjects.js:7`, `src/endpoints/payments/payment-logic.js:446`, `src/endpoints/payments/payment-logic.js:913`, `src/endpoints/retainer/retainer-logic.js:27`.) |
| `selectedJobID` | Optional positive integer scalar ID; malformed nonempty values refuse. A supplied valid ID must belong to this customer/account. Update omission leaves unchanged; explicit null/empty clears it. (`src/endpoints/payments/paymentsObjects.js:6`, `src/endpoints/payments/paymentsObjects.js:26`, `src/endpoints/payments/payment-logic.js:355`.) |
| `formOfPayment`, `paymentReferenceNumber` | Optional nullable strings, SQL varchar(50) each; no method enum; request limit50 characters. Update omission preserves the field. (`src/endpoints/payments/paymentsObjects.js:11`, `src/endpoints/payments/paymentsObjects.js:31`, `migrations/schema-snapshot-2026-09-22.sql:590`.) |
| `isTransactionBillable` | Optional boolean/coercible value; default true. Update omission preserves it. Its value does not bypass invoice movement. Parsing is described in conventions. (`src/endpoints/payments/paymentsObjects.js:13`, `src/endpoints/payments/paymentsObjects.js:33`, `src/endpoints/payments/payment-logic.js:540`.) |
| `note` | Optional nullable text, no field-specific length limit; new system links are stripped, stored system markers survive edits. (`src/endpoints/payments/payment-logic.js:380`, `src/endpoints/payments/payment-logic.js:987`.) |
| `holdAsPrepayment`, `captureOverpayment` | Create-only opt-ins; true only for boolean `true` or string `"true"`. Hold needs no invoice selection and no selected retainer. Split needs a positive invoice balance and no selected retainer. (`src/endpoints/payments/payment-logic.js:345`, `src/endpoints/payments/payment-logic.js:391`, `src/endpoints/payments/payment-logic.js:445`, `src/endpoints/payments/payment-logic.js:500`.) |
| `paymentID` | Required for update/delete/reverse, numeric/coercible positive integer identifying this account's payment. Missing/malformed/nonexistent IDs fail stored-row lookup. (`src/endpoints/payments/paymentsObjects.js:23`, `src/endpoints/payments/ledger-helpers.js:75`.) |
| `accountID`, `loggedByUserID` | Legacy input fields; URL account and authenticated creator override them. Update preserves the original creator. (`src/endpoints/payments/payment-logic.js:373`, `src/endpoints/payments/payment-logic.js:978`.) |

### Create

| Property | Contract |
| --- | --- |
| Method/path | `POST /payments/createPayment/:accountID/:userID` |
| Body | `{payment:{...}}`, using the create fields above. |
| Success | HTTP 200, `{status:200,message,...ledgerTables}`. It returns refreshed tables, not a dedicated `payment` field. `ledgerTables` is defined below. |
| Errors | Common 401/403/400/413/429; input-validation HTTP400 takes precedence; otherwise HTTP200/JSON500 for ledger state, including missing invoice without hold, hold with retainer, missing/foreign invoice/job/retainer, no usable current chain, absorbed newest-chain inconsistency, excessive amount without an eligible split, inactive/exhausted/insufficient retainer, or precommit database failure. See sections 6–7 for exact conditions. |
| Source | `src/endpoints/payments/payments-router.js:19`, `src/endpoints/payments/payment-logic.js:428`. |

### Single payment

| Property | Contract |
| --- | --- |
| Method/path | `GET /payments/getSinglePayment/:paymentID/:accountID/:userID` |
| Parameters | `paymentID` must convert to a positive integer; account/user as section 2. No body, paging, filter, or sort options. |
| Success | HTTP 200, `{status:200,message,activePaymentData:{activePayments:[rawPayment],grid}}`. |
| Errors | Common middleware errors; HTTP 200/JSON 404 for malformed, absent, or another account's ID; HTTP 200/JSON 500 for unexpected lookup/grid failure. |
| Source | `src/endpoints/payments/payments-router.js:64`, `src/endpoints/payments/payments-service.js:65`. |

### Update

| Property | Contract |
| --- | --- |
| Method/path | `PUT /payments/updatePayment/:accountID/:userID` |
| Body | `{payment:{paymentID,unitCost,...optionalUpdateFields}}`. |
| Success | HTTP 200, `{status:200,message,...ledgerTables}`. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing payment, billed event/draw, reversal row, attempted customer/invoice/retainer move, wrong-customer stored invoice or submitted job, zero/invalid amount, amount change on reversed original, direct-parent link repricing, newer child, invoice over-credit, missing/mismatched/ambiguous draw, newer retainer draw, transaction-owned draw, retainer overdraft, or precommit database failure. |
| Source | `src/endpoints/payments/payments-router.js:98`, `src/endpoints/payments/payment-logic.js:893`. |

### Delete

| Property | Contract |
| --- | --- |
| Method/path | `DELETE /payments/deletePayment/:accountID/:userID` |
| Body | `{payment:{paymentID}}`; other supplied links/amounts are ignored for deletion. |
| Success | HTTP 200, `{status:200,message,...ledgerTables}`. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing payment, billed event/draw, cross-customer stored invoice, newer invoice child, original still reversed, missing/mismatched/ambiguous or nonadjustable retainer draw, used/cancelled linked excess, unsafe reversal undo, or precommit database failure. |
| Source | `src/endpoints/payments/payments-router.js:122`, `src/endpoints/payments/payment-logic.js:820`. |

### Reverse / NSF

| Property | Contract |
| --- | --- |
| Method/path | `POST /payments/reversePayment/:accountID/:userID` |
| Body | `{payment:{paymentID,reason}}`. Reason is required text, trimmed and stripped of client system markers; it must remain nonempty. This includes `[reversal of payment #N]`, including nested attempts that become recognizable after another marker is removed. The same marker is stripped from ordinary receipt create/edit notes; only the server can create reversal identity. Genuine stored reversal markers survive edits. No separate reason length limit. |
| Success | HTTP 200, `{status:200,message,...ledgerTables}`. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing ID/reason/actor, missing payment, nonnegative original, already reversed by status or actual reversal row, retainer-funded original, absent/current-chain inconsistency, used/unsafe excess prepayment, or precommit database failure. Billed-original status alone does not prohibit reversal. |
| Source | `src/endpoints/payments/payments-router.js:40`, `src/endpoints/payments/payment-logic.js:1012`. |

### Paginated list

| Property | Contract |
| --- | --- |
| Method/path | `GET /payments/getPayments/:accountID/:userID` |
| Query | Optional `page=1`, `limit=20` (cap 500; parse rules in conventions), `search=''` (trimmed string; other types become empty). No supported client sort, customer, month, or amount filter. Fixed `created_at DESC`. |
| Success | HTTP 200, `{status:200,message,paymentsList:{activePaymentsData:{activePayments:[joinedRow...],grid,pagination,searchTerm}}}`. |
| Errors | Common middleware errors; HTTP 400/JSON 400 for invalid pagination; HTTP 500/JSON 500 for other query/grid errors. |
| Source | `src/endpoints/payments/payments-router.js:146`, `src/endpoints/payments/payments-service.js:32`. |

`ledgerTables` contains `paymentsList.activePaymentsData.{activePayments,grid}`, `accountRetainersList.activeRetainerData.{activeRetainers,grid,treeGrid}`, and `invoicesList.activeInvoiceData.{invoicesList,grid,treeGrid}`. All are whole-account lists, not the user's current page/search. They are read after commit. A refresh failure returns committed success with a reload warning; it never reports that the completed posting failed. (`src/endpoints/payments/payment-logic.js:273`, `src/endpoints/payments/payment-logic.js:305`.)

### Pass 2 input and committed-response contract

Create/update requests validate their raw object before coercion and check sanitized text again before mapping (`src/utils/ledgerInput.js`). Money must be a finite number or numeric string, nonzero after cent rounding, with magnitude at most99999999.99. Booleans/arrays/objects are refused. Customer IDs must be positive integer scalars; malformed nonempty optional selections refuse instead of becoming null. Dates must be real YYYY-MM-DD calendar dates or supported ISO timestamps. Required text cannot be blank; bounded text is limited to the schema character count, and notes must be text without null characters. These input errors return real HTTP400 and make no writes. Omitted optional update fields retain their documented meaning.

After a successful commit, a failed list refresh returns HTTP200 with `status:200`, `committed:true`, and a warning to reload without resubmitting. The write remains committed. Ordinary successful responses keep their existing tables. Tests: `scenario-what-if-01-values`, `02-retries` and `06-boundaries`.

## 4. Data model

| Table | Reads/writes |
| --- | --- |
| `customer_payments` | Read by account/payment, account/customer, reversal note, draw marker, or prepayment marker. Create/delete full row; update amount/date/method/reference/billable/job/note only. Columns: `payment_id`, `customer_id`, `account_id`, nullable `customer_job_id`, `retainer_id`, `customer_invoice_id`, `payment_date`, `payment_amount`, method/reference, billable, created timestamp/creator, `note`. (`migrations/schema-snapshot-2026-09-22.sql:581`, `src/endpoints/payments/payment-logic.js:978`.) |
| `customer_invoices` | Resolve account/customer roots/latest children. Insert/delete child snapshots; edit their remaining/paid state; update parent's remaining, signed `total_payments`, paid state. Does not delete a parent invoice. (`src/endpoints/payments/payment-logic.js:77`, `src/endpoints/payments/payment-logic.js:543`, `src/endpoints/payments/payment-logic.js:820`.) |
| `customer_retainers_and_prepayments` | Resolve/draw selected chain, create excess root, inspect references, delete an eligible draw/root, cancel/restore split excess. Starting/current amounts, active flag, parent, creator/timestamp and notes matter. (`src/endpoints/payments/payment-logic.js:396`, `src/endpoints/payments/payment-logic.js:520`, `src/endpoints/payments/payment-logic.js:673`.) |
| `customers`, `users`, `customer_jobs`, `customer_transactions` | Customer lock/ownership and list names; creator list name; job ownership; transactions referencing a draw/root block unsafe movement/deletion. (`src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/payments/payments-service.js:1`, `src/endpoints/payments/payment-logic.js:355`, `src/endpoints/payments/payment-logic.js:587`.) |

Ordinary amounts are negative; a reversal is positive with method `Reversal`. Retainer balances are negative available credit. The selected `retainer_id` on the payment need not be the newly created draw ID: `[retainer_draw:N]` records that exact child. Other markers are `[applied to …; customer referenced …]`, `[overpayment split: …]`, `[prepayment_retainer:N]`, `[reversal of payment #N]`, `[reversed …]`, and the excess root's `[cancelled by reversal of payment #N]`. Pending approval additionally supplies `[pending_payment:N]`. (`src/endpoints/payments/payment-logic.js:490`, `src/endpoints/payments/payment-logic.js:534`, `src/endpoints/payments/payment-logic.js:545`, `src/endpoints/payments/payment-logic.js:731`, `src/endpoints/payments/payment-logic.js:1053`, `src/endpoints/pendingPayments/pendingPayments-router.js:183`.)

## 5. Read logic

The account list selects all payment columns and customer/creator display names, inner-joining `customers` and `users` by their IDs and filtering `customer_payments.account_id`. Search ORs lowercase `LIKE '%term%'` over customer name, method, reference, note, payment/invoice/customer IDs cast to text, and formatted `YYYY-MM-DD` date. `%` and `_` remain LIKE wildcards; amount is not searched. Count and page rows are separate queries. Rows order only by creation timestamp descending, with no ID tie-break. (`src/endpoints/payments/payments-service.js:1`, `src/endpoints/payments/payments-service.js:32`.)

Single payment returns a raw row array filtered by payment ID and account. Customer payments return all this customer's account-scoped rows ordered by creation descending. Invoice lookup follows the payment's exact invoice ID; that ID can identify an event child rather than its root. Neither single nor customer lookup is paginated. (`src/endpoints/payments/payments-service.js:50`, `src/endpoints/payments/payments-service.js:65`.)

The customer profile packages that customer query as `customerPaymentData`. The invoice-detail screen resolves the selected invoice's root, obtains all root/child IDs, and selects account-scoped payments whose invoice link is any of those IDs, ordered by creation ascending. Thus its Payments tab covers the chain, not just payments linked directly to the selected parent. Initial application data uses the paginated account payment service. (`src/endpoints/customer/customer-router.js:125`, `src/endpoints/customer/customer-router.js:149`, `src/endpoints/invoice/invoice-router.js:476`, `src/endpoints/invoice/invoice-router.js:483`, `src/endpoints/initialData/initialData-router.js:105`.)

For posting, query current roots/latest children as described in conventions. Keep a live requested chain; otherwise remap to the largest current balance. Do not use the balance on an old selected snapshot. The frontend picker resolves latest children on the newest parent date and filters absorption markers; backend resolution is authoritative. (`src/endpoints/payments/payment-logic.js:99`, `src/endpoints/payments/payment-logic.js:179`, `src/endpoints/payments/payment-logic.js:537`, `../DS2_Frontend/src/Services/SharedFunctions.js:80`.)

An exact retainer draw marker must resolve to an account-scoped child of the same customer's selected chain. Missing, mismatched, or ambiguous links are refused. Legacy fallback searches child draws within ±1 second of payment creation, excludes draws claimed by another payment, and requires exactly one candidate; it does not choose the closest row. (`src/endpoints/payments/ledger-helpers.js:309`.)

An exact prepayment marker looks up that account's retainer row, requires the same customer and no other payment claiming its marker, then returns it. This exact-ID lookup itself does not revalidate root/type; subsequent usage checks resolve its chain. Legacy split discovery instead explicitly requires a Prepayment root with the parsed excess starting amount, an excess note, and timestamp within ±5 seconds, excludes other payments' roots, and refuses multiple candidates. A missing/foreign/already-claimed exact match returns no linked row; it does not fall back to a different guessed root. (`src/endpoints/payments/payment-logic.js:612`, `src/endpoints/payments/payment-logic.js:673`.)

## 6. Calculations

| Operation | Steps and example |
| --- | --- |
| Receipt | `tendered = round2(abs(unitCost))`; signed payment `p=-tendered`; `newRemaining=round2(oldRemaining+p)`. $500 less $120 becomes $380; parent `total_payments` changes by -$120. (`src/endpoints/payments/payment-logic.js:435`, `src/endpoints/payments/payment-logic.js:260`, `src/endpoints/payments/payment-logic.js:77`.) |
| Excess split | If tendered exceeds positive remaining and splitting is enabled without a selected retainer, applied amount equals remaining and excess is `round2(tendered-remaining)`. $150 against $100 produces payment -$100, invoice remaining $0, and a separate root with starting/current -$50. The payment table alone does not contain the full $150 receipt. (`src/endpoints/payments/payment-logic.js:495`, `src/endpoints/payments/payment-logic.js:545`.) |
| Hold only | With no invoice and hold enabled, create one Prepayment root starting/current `-tendered`. There is no payment or invoice snapshot. (`src/endpoints/payments/payment-logic.js:445`.) |
| Retainer draw | Use latest chain row; `newCurrent=round2(oldCurrent+abs(paymentAmount))`; active iff `<0`. Drawing $120 from -$300 creates a child at -$180; the payment is -$120. Parent retainer history is not overwritten by this draw. (`src/endpoints/payments/payment-logic.js:520`.) |
| Amount edit | `delta=round2(newMagnitude-oldMagnitude)`; invoice `newRemaining=round2(snapshotRemaining-delta)`; parent payment total changes by `-delta`; exact draw current changes by `+delta`. $100 payment edited to $130 reduces remaining by another $30 and consumes another $30 of retainer, if any. (`src/endpoints/payments/payment-logic.js:922`.) |
| Delete | Restore `round2(snapshotRemaining-signedPayment)` and change parent payment total by `-signedPayment`; remove the event child and payment. Deleting a -$120 receipt from $380 remaining restores $500. Deleting a +$120 reversal from $500 restores $380. (`src/endpoints/payments/payment-logic.js:820`.) |
| Reversal | New positive amount is `abs(original.payment_amount)`. Add it to the current chain and parent payment total. For the $150/$100/$50 split above, restore $100 billed debt and cancel the untouched $50 prepayment. Do not add $150 to the invoice. (`src/endpoints/payments/payment-logic.js:1012`, `src/endpoints/payments/payment-logic.js:731`.) |

At rounded zero the invoice is paid with today's paid date; otherwise it is unpaid with null paid date. These are cent calculations, not six-minute time rounding. Billing later displays all period payments, but only uninvoiced payments contribute a separate amount-due deduction; invoice-linked payments already moved the chain. (`src/endpoints/payments/payment-logic.js:77`, `src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:6`.)

## 7. Create, edit, delete, and side effects

### Create and current-chain guards

The entire receipt/draw/split operation runs in one transaction under the customer's `FOR NO KEY UPDATE` lock. Validate amount and date, lock the account-owned customer, and validate an optional job. Without an invoice, a selected retainer is refused; hold creates a Prepayment root; otherwise refuse. The hold branch does not check whether the customer actually has an open invoice. (`src/endpoints/payments/payment-logic.js:428`, `src/endpoints/payments/ledger-helpers.js:62`.)

Automatically banked roots use type `Prepayment` and label `Prepayment YYYY-MM-DD` from the current UTC date, not the entered receipt date. They copy customer/account, method/reference, authenticated creator and note, set starting/current to the negative held amount and active true, and append the hold/excess marker. The validated receipt date has no separate column in that root. (`src/endpoints/payments/payment-logic.js:396`, `migrations/schema-snapshot-2026-09-22.sql:722`.)

With an invoice, require it to exist in the account and belong to the customer. Resolve live roots on the newest invoice date. Preserve live same-day independent chains. An absorbed/older reference is redirected and annotated. If the newest roots are all absorbed, refuse rather than fall back. A remapped zero/negative chain is refused. A direct current zero balance cannot accept a positive receipt even with splitting, because splitting requires remaining greater than zero. (`src/endpoints/payments/payment-logic.js:99`, `src/endpoints/payments/payment-logic.js:179`, `src/endpoints/payments/payment-logic.js:461`, `src/endpoints/payments/payment-logic.js:495`.)

Validate the latest retainer balance if selected; insert its draw. Insert a child invoice snapshot cloned from the latest row, insert an excess root if needed, insert the payment linked to the new snapshot, and mirror the parent. Stamp new rows with database `clock_timestamp()` after the lock. Snapshot totals/creator are inherited as described in conventions; payment/draw/excess creators use the authenticated actor. All ledger writes commit or roll back together. No PDF, S3 object, or notification is generated here. (`src/endpoints/payments/payment-logic.js:316`, `src/endpoints/payments/payment-logic.js:520`, `src/endpoints/payments/payment-logic.js:537`, `src/endpoints/payments/ledger-helpers.js:30`.)

### Edit

Lock the stored payment's customer, then compare its linked invoice event (or payment row if no linked row exists) to the newest parent timestamp in SQL. At/before that statement means billed and is refused. A nonnegative payment is treated as a reversal and cannot be edited. Stored customer/invoice/retainer links and creator are immutable. A cross-customer stored invoice is refused. (`src/endpoints/payments/payment-logic.js:201`, `src/endpoints/payments/payment-logic.js:893`.)

Amount changes additionally require no existing reversal, a child rather than direct-parent invoice link, that child to be newest, and nonnegative resulting invoice balance. A retainer-funded amount change must resolve its exact unbilled draw, which must be latest in its retainer chain and not referenced by a work transaction. The adjusted draw cannot exceed zero. Validate plans before applying invoice, parent, retainer, and payment writes. (`src/endpoints/payments/payment-logic.js:587`, `src/endpoints/payments/payment-logic.js:926`.)

Metadata-only edits still require `unitCost` equal to the existing magnitude. They do not run the newest-child/draw repricing checks. They can change job/method/reference/billable/note and a valid date, preserve system markers, and leave created-at/creator unchanged. Excess-prepayment amounts and the explanatory split amounts in notes are not recalculated by this update path. (`src/endpoints/payments/payment-logic.js:922`, `src/endpoints/payments/payment-logic.js:978`.)

### Delete and reversal undo

Use only the stored ID/owner/links. Apply the billed gate, cross-customer-link check, newest-invoice-child rule, and no-existing-reversal rule. Resolve a retainer draw only when the payment actually has a retainer link; ordinary payments must not consume another row's draw. A moved draw must be unbilled, latest, and not owned by a transaction. (`src/endpoints/payments/payment-logic.js:820`, `src/endpoints/payments/payment-logic.js:226`, `src/endpoints/payments/payment-logic.js:587`.)

An overpayment root is deletable with its receipt only if its chain contains one row, current equals starting, no transaction/payment references its chain, and it is not cancelled. A used split must be unwound through its later entries first. Delete the eligible draw/excess root, restore the parent, delete the child snapshot, and delete the payment. The code never deletes a root invoice through this path. (`src/endpoints/payments/payment-logic.js:673`, `src/endpoints/payments/payment-logic.js:704`, `src/endpoints/payments/payment-logic.js:820`.)

The parent-restoration/snapshot-deletion block runs only for a linked row with a truthy parent ID. A legacy direct-parent link that gets past the billed guard does not trigger that block; the payment row can be removed without deleting or recomputing the root. (`src/endpoints/payments/payment-logic.js:856`.)

Deleting an unbilled latest reversal is the supported undo: remove its restored debt, remove the original's matching reversed marker, and restore its cancelled prepayment only if the cancellation belongs to this original, the root is still a one-row chain at zero, and no payment/transaction references it. Restoration sets current to starting and active according to the balance. A later/billed reversal cannot simply be removed. Neither payment deletion nor reversal undo resets the pending extraction record or deletes its source file. (`src/endpoints/payments/payment-logic.js:765`, `src/endpoints/payments/payment-logic.js:797`, `src/endpoints/payments/payment-logic.js:820`.)

### NSF reversal

Reason and authenticated creator are required. Lock the original's customer. Reject a nonnegative original, an existing reversal/status marker, and any retainer-funded payment. Resolve the current live chain; the chosen target may be paid at zero because reversal restores debt. A sent original can be reversed only through its selected-payment exception grant. Insert a new positive payment with current date, method `Reversal`, original reference/job, billable true, and `[reversal of payment #N] reason`; insert its invoice child. Mirror and annotate only unissued parents/originals; a sent original remains byte-for-byte unchanged and its exception history links the reversal. (`src/endpoints/payments/payment-logic.js:1012`.)

A linked excess root must be untouched. There is one legacy exception: if already cancelled by this same original, its chain has one row and its current amount is zero, cancellation is treated as already done; that early-return condition does not check reference counts. Otherwise a spent/changed/referenced excess refuses the entire NSF transaction. Cancellation appends a zero/inactive retainer snapshot when the original is locked; otherwise it updates the unissued row, and records `[cancelled by reversal of payment #N]`, preserving starting amount for possible undo. While the reversal exists, the original cannot be deleted or repriced; ordinary metadata edits remain subject to the billed gate. (`src/endpoints/payments/payment-logic.js:248`, `src/endpoints/payments/payment-logic.js:731`, `src/endpoints/payments/payment-logic.js:926`.)

## 8. Invariants and tests

The original documentation pass inspected tests; owner run 2 executed the full local suites. See [run 2 results](../decisions/2026-09-25-run-2-results.md).

| Rule | Test evidence |
| --- | --- |
| Create applies negative amount, child snapshot, parent mirror; zero refused | `test/integration/coverage-payments-pending.integration.spec.js:214`. |
| Delete restores parent and refuses a later event; plain cash does not delete retainers | `test/integration/coverage-payments-pending.integration.spec.js:676`, `test/integration/coverage-payments-pending.integration.spec.js:723`, `test/integration/coverage-payments-pending.integration.spec.js:736`. |
| Split creation, deletion, used-excess refusal, legacy linkage and forged markers | `test/integration/payment-reversal.integration.spec.js:838`, `test/integration/payment-reversal.integration.spec.js:865`, `test/integration/payment-reversal.integration.spec.js:879`, `test/integration/payment-reversal.integration.spec.js:889`. |
| Nested/unterminated marker handling and genuine marker preservation | `test/integration/payment-reversal.integration.spec.js:955`, `test/integration/payment-reversal.integration.spec.js:1042`, `test/integration/payment-reversal.integration.spec.js:1091`. |
| Exact draw, nearby unrelated draw, unique legacy draw/ambiguity | `test/integration/payment-reversal.integration.spec.js:1238`, `test/integration/payment-reversal.integration.spec.js:1271`, `test/integration/payment-reversal.integration.spec.js:1305`. |
| NSF split cancellation/undo and spent excess refusal; original cannot change while reversed | `test/integration/payment-reversal.integration.spec.js:1333`, `test/integration/payment-reversal.integration.spec.js:1352`, `test/integration/payment-reversal.integration.spec.js:1405`, `test/integration/payment-reversal.integration.spec.js:1442`. |
| Newest/same-day/absorbed rules, SQL timestamp precision and job ownership | `test/integration/payment-reversal.integration.spec.js:1461`, `test/integration/payment-reversal.integration.spec.js:1486`, `test/integration/payment-reversal.integration.spec.js:1505`, `test/integration/payment-reversal.integration.spec.js:1534`, `test/integration/payment-reversal.integration.spec.js:1592`. |
| Parsing and negative receipt/positive reversal conventions | `test/endpoints/payments/ledger-objects.spec.js:1`, `test/endpoints/payments/payment-integrity.spec.js:279`. |

## 9. Known limitations and open decisions

The current review report still calls for accountant review of historical payment-sign exceptions, duplicate statements, and parent mirrors. It identifies period locks, adjustment-only corrections, and voids instead of physical deletes as open policy choices. This source implements narrower timestamp/latest-event rules, not a universal closed accounting period. (`scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:59`.)

Manual create/reverse has no request idempotency key. Atomic pending approval adds its own row lock/link protection; it does not make repeated manual create calls idempotent. Postcommit refresh errors return committed success with a reload warning. Dates are calendar-validated at the HTTP boundary; accounting-period policy is unchanged. (`src/endpoints/payments/payments-router.js:19`, `src/endpoints/payments/payment-logic.js:305`, `src/endpoints/payments/payment-logic.js:438`, `src/endpoints/pendingPayments/pendingPayments-router.js:170`.)

Retainer-funded receipts cannot be reversed by the NSF route. Once billed, the ordinary delete/edit escape is also refused; the intended accountant-approved correction for every such historical case is **not determined from the code**. Hold-only records must be managed as retainers because no payment row exists. (`src/endpoints/payments/payment-logic.js:201`, `src/endpoints/payments/payment-logic.js:445`, `src/endpoints/payments/payment-logic.js:1012`.)

Rollout prerequisites, the settled optional-credit policy and remaining aging limitations are listed in [ledger conventions](ledger-conventions.md#9-known-limitations-and-open-decisions), sourced from report sections 3 and 6. This documentation did not apply migrations or verify production rollout. (`scripts/review-2026-09/FINAL_REPORT.md:67`.)

## Completion summary

Coverage: **6 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).


## Owner run 2 — retainers and duplicate review

Manual create now detects possible duplicates in the posting transaction: same customer, negative stored amount, date within three days, nonblank reference and method. Retainer-funded, reversal and pending-import payments are excluded. A manually held prepayment is checked as a retainer receipt. Removing a duplicate uses `deletePaymentCore`, preserving newest-snapshot order, used-excess and sent locks; it never subtracts cash twice. See [duplicate review](duplicates.md).

## Owner run 3 credit interaction

A chosen negative statement uses the same immutable sent boundary and exception workflow. A$20 bounced receipt can turn an issued−$10 credit into$10 current debt; scenario15 checks this and archives a revision without changing the original−$10 statement. Issuing a credit never creates another payment or deducts a retainer. See [credit scenarios](../scenarios/15-credit-statements.md).


## Owner decision 6 — hard Audit Record

Migration026 captures changes to this feature's audited customer/financial records through database triggers, including indirect writes, imports and deletes, with session actor/name, source, reason, request correlation and field-level before/after evidence. Rollbacks leave no events. The client profile **Audit Record** tab (Admin/Super Admin only) is separate from AI Audit and provides deterministic rolling balances, history, verified immutable PDF creation and exact reopening. See [the audit ledger contract](../platform/audit-ledger.md) for table coverage, API errors, historical reconstruction and integrity limits. Draft invoices remain editable and write nothing to the ledger; **finalize means sent and locked**. Existing narrow exception and retainer/duplicate rules remain in force.
