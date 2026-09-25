# PDF statements

## 1. Purpose and UI

templateOne renders the invoice PDFs created by the Create Invoice page at /invoices/createInvoice and downloaded from the invoice register. The renderer is `src/pdfCreator/templateOne/templateOneOrchestrator.js:13`; UI page and route are `../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.js:17` and `../DS2_Frontend/src/Routes/GroupedRoutes/InvoiceRoutes/InvoiceRoutes.js:26`.

A separate **Statement of Account** PDF is downloaded from the customer profile through AnalyticsCalls. It uses a chronological transaction ledger and LETTER pages, not templateOne. Sources: `../DS2_Frontend/src/Services/ApiCalls/AnalyticsCalls.js:84`, `src/endpoints/customer/customer-statement.js:57`. Account-audit PDFs have another layout, described in [account-audit.md](account-audit.md).

## 2. Access rules

Invoice generation/download and the customer statement route require authenticated manager/admin/super admin/owner and accountID matching the session account through enforceAccountId. userID is not self-only. Customer statement reads also scope customerID by account. Frontend manager gates include owner ([F37](../_review/findings.md#f37)). Sources: `src/app.js:138`, `src/endpoints/customer/customer-router.js:5`, `src/endpoints/customer/customer-router.js:213`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`.

The renderer has no independent authentication: its caller supplies prepared data. Source: `src/pdfCreator/templateOne/templateOneOrchestrator.js:13`.

## 3. API references

This renderer guide owns no HTTP endpoint. Use these canonical contracts:

| Action | Contract |
|---|---|
| Generate invoice PDFs, drafts or final statements | [Generation and finalization](month-end-finalize.md#3-api-reference) |
| Download stored invoice ZIPs | [Storage and downloads](../platform/storage-and-downloads.md#3-api-reference) |
| Generate a customer Statement of Account | [Customers](../work/customers.md#statement-pdf) |
| Download an audit PDF | [Account audit](account-audit.md#3-api-reference) |

## 4. Data model

templateOne consumes an already-prepared invoiceDetails object: invoiceNumber, billingDate, dueDate, companyLogo, accountBillingInformation, customerContactInformation, outstandingInvoices, payments, transactions, writeOffs, retainers, invoiceTotal, preRetainerInvoiceTotal, retainerAppliedToInvoice, remainingRetainer, globalInvoiceNote and invoiceNote. It performs no SQL itself. Sources: `src/pdfCreator/templateOne/templateOneOrchestrator.js:13`, `src/pdfCreator/templateOne/templateFunctions/templateOneTotals.js:4`.

Its values originate in account/account_information, customer/customer_information and the invoice/payment/write-off/transaction/job/retainer tables described in [create-invoice-engine.md](create-invoice-engine.md). Monetary credits stay signed negative; formatter code does not convert payments/write-offs/retainers to absolute positive amounts. Sources: `src/pdfCreator/templateOne/templateFunctions/templateOnePayments.js:25`, `src/pdfCreator/templateOne/templateFunctions/templateOneWriteOffs.js:21`, `src/pdfCreator/templateOne/templateFunctions/templateOneRetainers.js:13`.

The customer Statement of Account uses the independent audit's raw customer and five ledger datasets from one database snapshot, including its account header. It persists neither an audit nor a new invoice. Source: `src/endpoints/customer/customer-statement.js:14`.

## 5. Read logic and printed sections

Template data order is whatever the engine supplies; the renderer does not sort, regroup, page database results or apply a new statement-membership gate. createPDFInvoices renders the customer PDFs concurrently and packages buffers with customerID/displayName/type metadata. Sources: `src/utils/createAndSavePDFs.js:8`, `src/pdfCreator/templateOne/templateOneOrchestrator.js:43`.

| Section, in order | What appears |
|---|---|
| Letterhead | 50-point-wide logo; account name/address/phone/email; INVOICE and generated invoice number; heavy rule. `src/pdfCreator/templateOne/templateFunctions/templateOneHeader.js:1`. |
| Bill To | business_name or customer_name, mailing street/city/state/ZIP/phone; billingDate formatted MM/DD/YYYY, with server-current fallback only when absent; supplied dueDate. `src/pdfCreator/templateOne/templateFunctions/templateOneBillTo.js:3`. |
| Beginning Balance | Engine-selected invoice date/number and one Outstanding column from remaining_balance_on_invoice, plus subtotal outstandingInvoiceTotal. The redundant Original Amount column is removed (fixed [F39](../_review/findings.md#f39)); mutable root/snapshot totals are not presented as immutable issued amounts. `src/pdfCreator/templateOne/templateFunctions/templateOneOutstandingCharges.js:10`. |
| Payments | All gated paymentRecords: payment_date, invoice number or No Attached Invoice, form, reference, signed amount. Null form/reference print empty. Subtotal paymentsReceivedTotal, falling back to paymentTotal. Difference from paymentTotal >$0.009 adds the reflected-in-beginning-balance note. `src/pdfCreator/templateOne/templateFunctions/templateOnePayments.js:14`. |
| Professional Services | Grouped job ID, job description, jobTotal to 2 decimals; transactionsTotal subtotal. Not individual time entries/hours/rates. Hidden job write-offs are already netted here. Null General-credit job IDs stringify as null. `src/pdfCreator/templateOne/templateFunctions/templateOneTransactions.js:9`. |
| Revisions | Only when writeOffRecords is nonempty: transaction_type, writeoff_reason, signed amount; no date/job column. Subtotal is writeOffsListedTotal, falling back to writeOffTotal; difference >$0.009 adds reflected-in-invoice-balance note. `src/pdfCreator/templateOne/templateFunctions/templateOneWriteOffs.js:12`. |
| Retainers And Pre-Payments | Only when retainerRecords nonempty: type_of_hold, starting_amount, current_amount and retainerTotal subtotal; these are selected latest active balances, not every historical draw. `src/pdfCreator/templateOne/templateFunctions/templateOneRetainers.js:9`. |
| Totals | If retainer records exist or retainerAppliedToInvoice!=0, print pre-retainer total, applied amount and remaining retainer. Always print Balance Due. Thus an exhausted retainer's draw is still shown. `src/pdfCreator/templateOne/templateFunctions/templateOneTotals.js:11`. |
| Notes/footer | account_statement first. Global and individual notes normalize null/undefined to empty strings. A Notes heading appears if either is nonempty, followed independently by global then individual text (fixed [F31](../_review/findings.md#f31)). account_interest_statement, when present, is an 8-point centered footer on the last page. `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:70`. |

The PDFs do not display a draft watermark based on isRoughDraft: the same renderer receives calculated detail for all modes. The draft distinction is in artifact routing and whether the ledger commits. Sources: `src/endpoints/invoice/invoice-router.js:346`, `src/pdfCreator/templateOne/templateOneOrchestrator.js:13`.

For the separate customer statement, the service reads customer, account header and all ledger history in one REPEATABLE READ READ ONLY transaction, builds the independent chronological ledger, then filters by day. Events before start determine opening balance; events after end are omitted; closing is the last included running balance or opening if none. Header current amount due is the audit's **current all-history rolling balance**, even for a historical date range. Source: `src/endpoints/customer/customer-statement.js:14`.

## 6. Calculations and pagination

### Amounts

templateOne does not recalculate invoice arithmetic. It formats balances/subtotals/job charges toFixed(2); individual payment/write-off/retainer rows use their supplied value converted to text, so those are not universally forced to two decimal places. For example, a numeric payment -50 can print -50 while its subtotal prints -50.00. Sources: `src/pdfCreator/templateOne/templateFunctions/templateOnePayments.js:14`, `src/pdfCreator/templateOne/templateFunctions/templateOneRetainers.js:13`.

Balance Due is invoiceTotal. preRetainerInvoiceTotal adds back the negative retainerPaymentTotal; retainerAppliedToInvoice is that signed draw; remainingRetainer is the latest signed balance. No extra deduction of remaining retainer occurs in the PDF. Sources: `src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:9`, `src/pdfCreator/templateOne/templateFunctions/templateOneTotals.js:24`.

### templateOne layout rules

The document is **A3**, Helvetica/Helvetica-Bold, with PDFDocument's default margins. Base lineHeight=20 and initial body offset=300. Letterhead and Bill To print once on page 1. Continuations show a 9-point “Statement NUMBER — CUSTOMER (continued)” header and resume topMargin+20. Sources: `src/pdfCreator/templateOne/templateOneOrchestrator.js:16`, `src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js:36`.

Beginning Balance, Payments, Professional Services, Revisions and Retainers share the table paginator:

1. Measure every cell at font size 12 within its own column width.
2. Row height = max(20,tallest measured cell)+4.
3. Heading height = 2×20+10 = 50. Closing-rule/subtotal height = 10 + subtotalLineCount×20.
4. The last row must carry that closing block. Its required height is rowHeight+subtotalHeight; other rows need rowHeight.
5. Maximum single-row required height = pageBottom - topMargin -20 continuation gap -50 heading. Reject any row exceeding it before rendering that table, with an error identifying the row and asking it to be shortened. It is not split across pages.
6. If heading plus first required row (or empty subtotal) will not fit, start a continuation before the heading.
7. Before every row, check required height; break and repeat section title/column headers as needed.
8. Draw the closing rule and subtotal with the last row. Update endOfGroupingHeight; the next table starts +25 points.

Source: `src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js:61`, `src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js:81`.

For a 40-point wrapped cell, the row uses 44 points, not 20. With one subtotal line the final row reserves 44+30=74 points. This prevents an isolated subtotal page. Source: `src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js:87`.

The totals block reserves 90 points with retainer detail or 40 without. It moves intact to a continuation when it will not fit. Source: `src/pdfCreator/templateOne/templateFunctions/templateOneTotals.js:11`.

Notes may span pages. A binary search finds the longest text prefix fitting the remaining space, then backs up to a word boundary, with character fallback for a single oversized word. Every character is consumed once. If even one character cannot fit, start a continuation. Keep the Notes heading with at least one text line. The measured interest footer stays at the bottom of the last page, adding a page if necessary. Source: `src/pdfCreator/templateOne/templateFunctions/templateOneNotes.js:32`.

### Statement of Account layout

This separate PDF is LETTER, margin 50, buffered pages. Header contains account/customer/date range and current rolling due. Rows show date, description, charge, credit and transaction running balance after an opening row. Row height=max(13,description height+2); break before page height-70 and repeat column headers at y=60. Reserve 40 points before the closing balance block. A note distinguishes transaction closing balance from current rolling due. Sources: `src/endpoints/customer/customer-statement.js:57`, `src/endpoints/customer/customer-statement.js:97`.

Chronological running balance adds billable work, subtracts normal payments/write-offs and adds positive reversals, rounding each event; invoice/retainer establishment rows are informational zero events. These are audit ledger calculations, not a second sum of every invoice. Source: `src/endpoints/accountAudit/account-audit-logic.js:441`.

## 7. Create, edit and delete

templateOne builds a memory buffer; it does not write a local PDF file. The orchestrator wraps buffers into S3 ZIPs. Every selected PDF is generated before finalized ledger writes; an oversized row or invalid note prevents reaching finalization. CSV-only mode still generates PDFs first. Sources: `src/pdfCreator/templateOne/templateOneOrchestrator.js:18`, `src/endpoints/invoice/invoice-router.js:346`.

Per-customer ZIPs upload before the DB transaction, combined final ZIP after commit. No compensation deletes are implemented. Combined PDF ZIP members include the customer ID and sanitize path characters, preserving same-name customers (fixed [F33](../_review/findings.md#f33)). Full key/order details: [month-end-finalize.md](month-end-finalize.md). Sources: `src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:60`, `src/pdfCreator/zipOrchestrator.js:56`.

No PDF edit/delete endpoint exists. Billed transaction edits copy invoice_file_location into snapshots and leave the already-generated document unchanged. The live invoice detail can therefore differ from its stored PDF. Source: `src/endpoints/billingReview/cascadeEdit.js:386`.

Customer Statement of Account renders current reads directly to response; it writes no S3 object, audit, invoice or notification. Source: `src/endpoints/customer/customer-router.js:220`.

## 8. Invariants and test evidence

| Existing spec | Assertions |
|---|---|
| test/pdfCreator/templateOnePagination.spec.js | Wrapped rows; many jobs/payments/write-offs/retainers; first-page letterhead; identified continuations; beginning-balance pagination; whole totals block; final row/subtotal together; oversized-row refusal; long notes; null payment text. |
| test/endpoints/invoice/billingDate.spec.js | Firm billing-date behavior feeding printed statement date. |
| test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js | Customer statement access, account isolation, unknown-customer error and PDF bytes; invoice generation/download routes. |
| test/endpoints/accountAudit/audit-pdf-breakdown.spec.js | Separate audit PDF arithmetic and legacy breakdown handling, not templateOne layout. |

Tests were read, not run. No PDFs were generated or visually rendered during this Markdown-only task.

## 9. Known limitations and open decisions

[F31](../_review/findings.md#f31) records fixed global-note omission and missing-global TypeError; [F39](../_review/findings.md#f39) records removal of the incorrect Original Amount column; [F33](../_review/findings.md#f33) records fixed duplicate archive member names. Saved artifacts are not regenerated after cascade edits. Dates, billed data and statement layout behavior above reflect current source, not a new accountant-approved design.

The historical report leaves closed-period adjustment policy, voiding, credit memos and true charge aging open. Its section 6 requires reviewed migrations/cutover, backend before frontend and BILLING_TIMEZONE. Production implementation of those steps is **not determined from the code**. Sources: `scripts/review-2026-09/FINAL_REPORT.md:56`, `scripts/review-2026-09/FINAL_REPORT.md:61`, `scripts/review-2026-09/FINAL_REPORT.md:67`.

Coverage: **0 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
