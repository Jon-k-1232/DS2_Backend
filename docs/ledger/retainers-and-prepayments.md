# Retainers and prepayments

Source review dated 2026-09-24. Shared rules are in [ledger-conventions.md](ledger-conventions.md); exact receipt/split/reversal behavior is in [payments.md](payments.md).

## 1. Purpose and UI

A retainer/prepayment holds credit for a customer. One root records the starting credit; children record subsequent balances after draws. Available money is the latest negative balance, not the sum of the chain. Receiving a retainer alone does not reduce an invoice. A payment or funded work transaction must draw it. (`src/endpoints/retainer/retainer-service.js:3`, `src/endpoints/retainer/retainer-logic.js:27`, `src/endpoints/transactions/sharedTransactionFunctions.js:592`.)

| UI | Route and files |
| --- | --- |
| Retainer grid/add | `/transactions/customerRetainers`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:31`; `../DS2_Frontend/src/Pages/Transactions/TransactionGrids/RetainersGrid.js:7`; `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Retainer.js:25`. |
| Delete | `/transactions/customerRetainers/deleteRetainer`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/RetainerSubRoutes.js:36`; `../DS2_Frontend/src/Pages/Transactions/TransactionForms/DeleteTransaction/DeleteRetainer.js:1`. |
| Edit availability | `EditRetainer.js` exists under frontend `Pages/Transactions/TransactionForms/EditTransaction`, but the `editRetainer` route is commented out. The backend update endpoint is implemented. (`../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/RetainerSubRoutes.js:43`.) |
| Customer history | `/customers/customersList/customerProfile/:customerId/retainersAndPrePayments`; `../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.js:96`; `../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerRetainers.js:4`. |
| Invoice tab | `/invoices/invoices/invoiceDetail/invoiceRetainers`; `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceSubRoutes.js:59`; `../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceRetainers.js:1`. |

The add form offers exactly `Retainer` and `Prepayment`, plus a label, method/reference, amount and note. It displays `quantity * unitCost`, but the retainer API maps **unitCost alone** to the balance. No separate retainer payment-date column is written by this mapper. (`../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Retainer.js:58`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Retainer.js:77`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Retainer.js:87`, `src/endpoints/retainer/retainerObjects.js:9`.)

## 2. Access rules

All five endpoints require active-user authentication and role `manager`, `admin`, `super admin`, or `owner`. URL `accountID` must be an integer matching the authenticated account. No self-or-privileged check is applied to URL `userID`. Create uses the authenticated creator; updates preserve original creators. The frontend manager gate includes `owner` ([F37](../_review/findings.md#f37)). (`src/app.js:145`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/retainer/retainer-router.js:6`, `src/endpoints/retainer/retainer-router.js:24`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.)

## 3. API reference

All route business errors below use **HTTP 200 with a JSON error status**, except authentication/account/role/parser/rate-limit middleware. Every endpoint can receive the common HTTP 401/403/400/413/429/500 errors described in [conventions](ledger-conventions.md#3-api-conventions). There is no paginated retainer-router account-list endpoint. Whole-account history comes from initial-data loading and mutation responses. (`src/endpoints/retainer/retainer-router.js:13`, `src/endpoints/retainer/retainer-router.js:123`, `src/endpoints/initialData/initialData-router.js:110`.)

### Body fields

| Field inside `retainer` | Type, validation and limits |
| --- | --- |
| `customerID` | Create required numeric/coercible positive integer belonging to this account. Update optional; a different valid positive customer is refused. (`src/endpoints/retainer/retainerObjects.js:11`, `src/endpoints/payments/ledger-helpers.js:62`, `src/endpoints/retainer/retainer-logic.js:91`.) |
| `unitCost` | Create required; `round2(-abs(Number(value)))` must be negative. Update optional: nonfinite/omitted input preserves old starting balance; finite zero is refused; other finite input is normalized negative and rounded. Update checks nonzero **before** rounding, so a positive subcent input can round to zero. SQL `numeric(10,2)`; no request maximum beyond available-draw constraints. (`src/endpoints/retainer/retainer-logic.js:64`, `src/endpoints/retainer/retainer-logic.js:100`, `migrations/schema-snapshot-2026-09-22.sql:729`.) |
| `typeOfHold` | Create required truthy nullable string, varchar(50). API does not enforce the UI's two-value enum. Update omitted/empty/null preserves the type; a truthy value changes all chain rows. (`src/endpoints/retainer/retainerObjects.js:14`, `src/endpoints/retainer/retainerObjects.js:33`, `src/endpoints/retainer/retainer-logic.js:66`, `src/endpoints/retainer/retainer-logic.js:136`.) |
| `displayName` | Optional nullable string, varchar(100). Update omission preserves it; supplied value applies to all chain rows. (`src/endpoints/retainer/retainerObjects.js:13`, `src/endpoints/retainer/retainer-logic.js:132`, `migrations/schema-snapshot-2026-09-22.sql:727`.) |
| `formOfPayment`, `paymentReferenceNumber` | Optional nullable strings, varchar(50) each; no enum/request length validation. Update omission preserves; explicit nullable input clears; applies to all chain rows. (`src/endpoints/retainer/retainerObjects.js:17`, `src/endpoints/retainer/retainer-logic.js:132`, `migrations/schema-snapshot-2026-09-22.sql:731`.) |
| `note` | Optional nullable text. New client system markers stripped; update changes only the selected row and preserves its stored system markers. (`src/endpoints/retainer/retainer-logic.js:61`, `src/endpoints/retainer/retainer-logic.js:139`.) |
| `retainerID` | Required for update, numeric/coercible positive integer in this account. Delete/single use the URL instead. (`src/endpoints/retainer/retainerObjects.js:29`, `src/endpoints/payments/ledger-helpers.js:75`.) |
| Other state fields | Body `accountID`/`loggedByUserID` do not choose ownership/creator. Client parent, current balance, active flag and creation timestamp do not control the stored chain. (`src/endpoints/retainer/retainerObjects.js:9`, `src/endpoints/retainer/retainerObjects.js:24`, `src/endpoints/retainer/retainer-router.js:24`.) |

Nullable-string parsing and XSS sanitization follow conventions. SQL column limits are not preflight length validation. (`src/endpoints/payments/ledger-helpers.js:424`, `src/endpoints/retainer/retainer-router.js:18`.)

### Create

| Property | Contract |
| --- | --- |
| Method/path | `POST /retainers/createRetainer/:accountID/:userID` |
| Body | `{retainer:{customerID,unitCost,typeOfHold,...optionalFields}}`. |
| Success | HTTP 200, `{status:200,message,accountRetainersList:{activeRetainerData:{activeRetainers,grid,treeGrid}}}`; refreshed whole-account history. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: invalid/missing customer, customer outside account, nonnegative/invalid rounded amount, missing type, DB constraint/query failure, or post-commit refresh failure. |
| Source | `src/endpoints/retainer/retainer-router.js:13`, `src/endpoints/retainer/retainer-logic.js:55`, `src/endpoints/retainer/retainer-router.js:150`. |

### Update

| Property | Contract |
| --- | --- |
| Method/path | `PUT /retainers/updateRetainer/:accountID/:userID` |
| Body | `{retainer:{retainerID,...optionalFields}}`. Can address a root or child; starting balance/descriptors affect the chain. |
| Success | Same whole-account response as create. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing/malformed/foreign retainer, attempted customer reassignment, finite zero amount, nonzero balance change on cancelled prepayment, new starting credit below amount already drawn, or DB/refresh failure. There is no billed-statement refusal in this core. |
| Source | `src/endpoints/retainer/retainer-router.js:40`, `src/endpoints/retainer/retainer-logic.js:85`. |

### Delete

| Property | Contract |
| --- | --- |
| Method/path | `DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID` |
| Parameters/body | Required positive integer/coercible retainer URL ID. No business body fields. |
| Success | Same whole-account response as create. |
| Errors | Common middleware errors; otherwise HTTP 200/JSON 500: missing/malformed/foreign ID, selected child, cancelled root, any draw child, any transaction/payment reference to chain rows, a payment's prepayment-root marker, or DB/refresh failure. |
| Source | `src/endpoints/retainer/retainer-router.js:66`, `src/endpoints/retainer/retainer-logic.js:156`. |

### Single record

| Property | Contract |
| --- | --- |
| Method/path | `GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID` |
| Parameters | Positive integer/coercible retainer ID. No pagination/filter/sort query. |
| Success | HTTP 200, `{status:200,message,activeRetainerData:{activeRetainer:[rawRow],grid,treeGrid}}`. Singular key `activeRetainer`, but its value is an array. |
| Errors | Common middleware errors; HTTP 200/JSON 404 for invalid, missing, or other-account ID; HTTP 200/JSON 500 with generic failure message for unexpected errors. |
| Source | `src/endpoints/retainer/retainer-router.js:86`. |

### Active customer picker

| Property | Contract |
| --- | --- |
| Method/path | `GET /retainers/getActiveRetainers/:customerID/:accountID/:userID` |
| Parameters | Customer ID in URL; route does not prevalidate it as a positive integer. No supported pagination/search/sort fields. |
| Success | HTTP 200, `{status:200,message,activeRetainerData:{activeRetainers:[latestAvailableRow...],grid,treeGrid}}`. Query includes `rn` from window ranking. Unknown/other-account customer yields an empty array. |
| Errors | Common middleware errors; HTTP 200/JSON 500 on database/other failures, including malformed customer values rejected by PostgreSQL. |
| Source | `src/endpoints/retainer/retainer-router.js:123`, `src/endpoints/retainer/retainer-service.js:71`. |

## 4. Data model

`customer_retainers_and_prepayments` stores `retainer_id`, nullable `parent_retainer_id`, required customer/account, optional label, required type, starting/current `numeric(10,2)`, optional method/reference, required active flag and creator, creation timestamp, and text note. There is no invoice ID or receipt-date field. The customer row supplies the lock; customer/user tables supply account-grid names. (`migrations/schema-snapshot-2026-09-22.sql:722`, `src/endpoints/retainer/retainer-service.js:10`, `src/endpoints/payments/ledger-helpers.js:62`.)

Draws also touch `customer_payments`, `customer_transactions`, and sometimes `customer_invoices`. Transaction funding stores the **draw** ID on the work transaction, root ID on its automatic payment, and exact draw ID in the payment note. A manual invoice payment stores its selected retainer ID plus the exact note marker. (`src/endpoints/transactions/sharedTransactionFunctions.js:200`, `src/endpoints/transactions/sharedTransactionFunctions.js:608`, `src/endpoints/payments/payment-logic.js:520`.)

The important links/status are `[retainer_draw:N]` on payments; `[prepayment_retainer:N]` on an excess-producing payment; `[overpayment excess from payment on INV]` and `[cancelled by reversal of payment #N]` on its root. A hold-only pending approval may leave `[pending_payment:N]` on the root, with the queue's reciprocal `[posted_prepayment_retainer:N]`. These are parsed text links, not FK columns. (`src/endpoints/payments/ledger-helpers.js:168`, `src/endpoints/payments/payment-logic.js:545`, `src/endpoints/payments/payment-logic.js:731`, `src/endpoints/pendingPayments/pendingPayments-router.js:183`.)

## 5. Read logic

| Read | Exact query behavior |
| --- | --- |
| Account grid/refresh | Despite the name `getActiveRetainers`, returns **all** account rows, including inactive/history. Inner-joins customers/users for names. Orders `created_at DESC` only. Initial data and mutation responses use this service; frontend renders the tree. (`src/endpoints/retainer/retainer-service.js:10`, `src/endpoints/initialData/initialData-router.js:110`, `src/endpoints/retainer/retainer-router.js:150`.) |
| Customer profile | All raw rows by account and customer, no ordering or pagination. Packaged as `customerRetainerData` with grid/tree. (`src/endpoints/retainer/retainer-service.js:24`, `src/endpoints/customer/customer-router.js:125`, `src/endpoints/customer/customer-router.js:143`.) |
| Single | Raw row array filtered by account and retainer ID; not the whole chain. (`src/endpoints/retainer/retainer-service.js:28`.) |
| Active picker | Rank all this customer's account rows by `ROW_NUMBER() OVER (PARTITION BY COALESCE(parent_retainer_id,retainer_id) ORDER BY created_at DESC,retainer_id DESC)`. Only afterward keep `rn=1`, `current_amount<0`, `is_retainer_active=true`. Order resulting rows by creation descending. An exhausted latest row cannot expose an older balance. (`src/endpoints/retainer/retainer-service.js:71`.) |
| Single-chain latest | Resolve selected row to its parent ID when truthy, otherwise its own ID; if the selected positive ID is missing, retain the ID to find surviving orphan children. Scope chain by account and `(retainer_id=root OR parent_retainer_id=root)`; sort timestamp/ID descending, limit 1. Full-chain edits use the reverse ascending order. (`src/endpoints/retainer/retainer-service.js:38`, `src/endpoints/retainer/retainer-service.js:46`, `src/endpoints/retainer/retainer-service.js:91`.) |
| Reference guards | Read transactions/payments with any chain ID in `retainer_id`, scoped by account; separately search payments for exact `[prepayment_retainer:root]` text. (`src/endpoints/retainer/retainer-service.js:111`.) |
| Invoice detail tab | Fetch account rows with `created_at >= start_date AND created_at < end_date + interval '1 day'`, then filter to the invoice customer in JavaScript. No active/latest-chain filter and no explicit order. This window view differs from billing's remaining-retainer calculation. (`src/endpoints/retainer/retainer-service.js:20`, `src/endpoints/invoice/invoice-router.js:489`.) |
| Billing remaining retainer | Fetch all selected customers' account rows without a billing cutoff, ordered by database creation timestamp/ID and with an additional exact timestamp text column. In memory compare exact timestamp text (fallback JavaScript dates) then ID, keep the latest row per root, exclude explicit inactive or zero current, and sum current balances. (`src/endpoints/invoice/invoice-service.js:349`, `src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:33`.) |

## 6. Calculations

1. A directly entered root sets both amounts to `round2(-abs(unitCost))` and active true. A hold/split root instead receives the already rounded negative receipt/excess from the payment core. `round2` uses JavaScript `Math.round` plus epsilon; negative half-cent behavior can differ from negating a rounded positive value. (`src/endpoints/retainer/retainer-logic.js:64`, `src/endpoints/payments/payment-logic.js:396`, `src/endpoints/payments/ledger-helpers.js:11`.)
2. Available funds are `round2(max(0,-latest.current_amount))`. Require active and available greater than zero, then require draw magnitude no greater than available. (`src/endpoints/retainer/retainer-logic.js:37`.)
3. Draw balance is `round2(latest.current_amount + drawMagnitude)`. -$300 plus a $120 draw is -$180, available $180. Zero is inactive. The root's original balance remains historical. (`src/endpoints/payments/payment-logic.js:520`.)
4. Direct starting-amount edit: `delta = round2(newStarting - selectedRow.starting_amount)`. Require `round2(latestCurrent + delta) <= 0`. Shift every row's current by delta and set every starting amount to the new starting amount; recalculate active from `<0`. Root -$300 and child -$180 changed to a $400 starting credit become -$400 and -$280. The $120 draw is preserved. Reducing starting credit below $120 would exceed zero and is refused. (`src/endpoints/retainer/retainer-logic.js:100`.)
5. Remaining retainer display sums latest available negative balances. Applying a retainer uses a separate negative payment. Billing does not subtract both that payment and the remaining-held balance. Work-transaction retainer grouping is a display breakdown, not an additional amount-due deduction. (`src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:33`, `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:4`, `src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js:31`.)

## 7. Create, edit, delete, and draws

### Direct retainer operations

Create opens/reuses one transaction, strips client markers, forces a new root, locks the account-owned customer with `FOR NO KEY UPDATE`, validates amount/type, and writes a database `clock_timestamp()`. There is no automatic payment, invoice movement, PDF/S3 write, or notification. (`src/endpoints/retainer/retainer-logic.js:55`, `src/endpoints/payments/ledger-helpers.js:21`, `src/endpoints/payments/ledger-helpers.js:30`.)

Edit locks the stored owner's customer, reads root/chain/latest, and refuses valid customer reassignment. A cancelled excess cannot have a nonzero starting-amount delta. A lower starting credit cannot be less than already drawn. Balance/descriptor changes affect all chain rows; note edits affect only the selected row. Client current/active/parent/creator fields are ignored. Creators and creation times remain unchanged. There is **no billed-statement check** in this direct edit core, so even older chain rows can be shifted. (`src/endpoints/retainer/retainer-logic.js:85`.)

Delete locks the owner and permits only an unused root: no parent ID, no cancelled marker, no draw child anywhere, no transaction/payment reference to any chain ID, and no payment linking the root as excess. A child must be undone through its originating payment/work entry. A split excess must be removed through its originating payment. A cancelled excess must first be restored by undoing the reversal. Delete then removes the one root row. It has no separate billed-root gate. (`src/endpoints/retainer/retainer-logic.js:156`.)

### Manual invoice draws and excess

Manual payment creation re-resolves the latest chain balance while holding the customer lock, verifies account/customer and active capacity, and creates a child plus `[retainer_draw:N]` payment link in the same transaction as the invoice snapshot/payment/parent update. Manual payment amount edit/delete can move only its exact unbilled latest draw; a draw owned by a work transaction must be edited through that transaction. Legacy draws require a unique matching candidate, not a nearest-timestamp guess. (`src/endpoints/payments/payment-logic.js:520`, `src/endpoints/payments/payment-logic.js:226`, `src/endpoints/payments/payment-logic.js:587`, `src/endpoints/payments/ledger-helpers.js:309`.)

Overpayment splitting creates a separate negative root. Deleting the receipt can delete an untouched root; reversing the receipt cancels it to zero/inactive and retains starting amount. If it was spent, altered or referenced, the unsafe delete/NSF is refused. Reversal undo restores only the same untouched cancelled root. See [payments](payments.md#7-create-edit-delete-and-side-effects) for every link/guard. (`src/endpoints/payments/payment-logic.js:673`, `src/endpoints/payments/payment-logic.js:704`, `src/endpoints/payments/payment-logic.js:731`, `src/endpoints/payments/payment-logic.js:765`.)

### Work-transaction funding

Positive billable work with a selected retainer plans a same-customer draw under the customer lock, updates the job total, creates the draw, writes the transaction pointing to that draw, and creates an uninvoiced negative payment. Its method/reference are both `Retainer`, even when the chain's type is Prepayment. Its amount is negative rounded transaction total, date follows work date, and note is the exact draw marker. Nonbillable/zero work creates neither draw nor automatic payment. These writes share the transaction; training-example recording is also called in that transaction workflow. (`src/endpoints/transactions/sharedTransactionFunctions.js:200`, `src/endpoints/transactions/sharedTransactionFunctions.js:592`.)

Work edits use stored links and refuse already billed work/linked payment movement. With exact linkage, repricing shifts the affected draw and every later balance by the amount delta, preserving later draw sizes; available headroom is the minimum across affected rows. Unfund/delete removes the exact draw and shifts later balances back by its movement. Legacy linkage uses a compensating latest snapshot. The automatic payment amount/date/job stays synchronized. This differs from manual-payment mutation's stricter latest-draw requirement. (`src/endpoints/transactions/sharedTransactionFunctions.js:282`, `src/endpoints/transactions/sharedTransactionFunctions.js:313`, `src/endpoints/transactions/sharedTransactionFunctions.js:329`, `src/endpoints/transactions/sharedTransactionFunctions.js:375`, `src/endpoints/transactions/sharedTransactionFunctions.js:635`.)

Turning funded work nonbillable or to zero unfunds it; clearing funding on still-positive billable work or changing to a different retainer chain is refused. Changing a selected row within the same chain is treated through chain identity. New compensating events use the authenticated actor; editing work does not replace its original creator. (`src/endpoints/transactions/sharedTransactionFunctions.js:494`, `src/endpoints/transactions/sharedTransactionFunctions.js:619`.)

## 8. Invariants and tests

Tests were read, not run.

| Rule | Test evidence |
| --- | --- |
| Root creation, negative amount, client state ignored | `test/endpoints/retainer/retainer-rules.spec.js:104`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:895`. |
| Starting edit preserves drawn amount and prevents unsafe shrink | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:935`, `test/integration/payment-reversal.integration.spec.js:634`. |
| Delete refuses chain history/references/cancellation links | `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:981`, `test/integration/payment-reversal.integration.spec.js:666`, `test/integration/payment-reversal.integration.spec.js:710`. |
| Rank first, then exclude exhausted chains | `test/endpoints/retainer/retainer-rules.spec.js:92`, `test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js:1070`. |
| Exact draw, missing/mismatched draw refusal, legacy window | `test/endpoints/retainer/retainer-rules.spec.js:35`, `test/endpoints/retainer/retainer-rules.spec.js:52`, `test/endpoints/retainer/retainer-rules.spec.js:73`. |
| Funded transaction atomicity and concurrent capacity | `test/integration/transactions-ledger-seams.integration.spec.js:237`, `test/integration/transactions-ledger-seams.integration.spec.js:368`. |
| Unfund shifts later draws correctly; billed linked payments block movement | `test/integration/transactions-ledger-seams.integration.spec.js:389`. |

## 9. Known limitations and open decisions

Direct retainer edits rewrite historical balances/descriptors and have no statement lock or separate edit journal. Their appropriateness for closed accounting periods is an open policy decision; period locks, adjustment-only treatment and voids remain report items. The invoice-detail retainer tab's date-window history is not the same population as billing's latest remaining balance. (`src/endpoints/retainer/retainer-logic.js:85`, `src/endpoints/invoice/invoice-router.js:489`, `scripts/review-2026-09/FINAL_REPORT.md:59`.)

The report specifically flags a historical customer-228 statement with a retainer double-subtraction and leaves negative-credit finalization policy open. Its accountant decisions and migration/backend-before-frontend rollout requirements apply here; production rollout is **not determined from the code**. (`scripts/review-2026-09/FINAL_REPORT.md:53`, `scripts/review-2026-09/FINAL_REPORT.md:56`, `scripts/review-2026-09/FINAL_REPORT.md:67`.)

The API accepts arbitrary nonempty hold types; the UI exposes two. A retainer record does not prove a bank receipt was reconciled. Bank-reconciliation rules are **not determined from the code** in these endpoints. (`src/endpoints/retainer/retainer-logic.js:66`, `../DS2_Frontend/src/Pages/Transactions/TransactionForms/AddTransaction/Retainer.js:77`.)

## Completion summary

Coverage: **5 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
