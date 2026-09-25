# Pending payments and the payment-image pipeline

Source review dated 2026-09-24. Backend paths are relative to `DS2_Backend`; Lambda paths start `../DS2_Lambdas/Process_Payment_Images/`. The Lambda virtual environment was excluded. The original review was read-only; subsequent local F16–F18 regressions and verification are in the [F8–F22 log](../_review/fixes-F8-F22.md).

## 1. Purpose and UI

An uploaded payment file is extracted into `customer_payments_processed` for human review. Extraction does **not** post a payment. Atomic approval posts the reviewed ledger entry and marks the queue row processed together. Here, `is_payment_processed` means approved/posted, not merely OCR completed. (`../DS2_Lambdas/Process_Payment_Images/database.py:138`, `src/endpoints/pendingPayments/pendingPayments-router.js:170`.)

| UI | Route/files and behavior |
| --- | --- |
| Pending payments | `/transactions/pendingPayments`; `../DS2_Frontend/src/Routes/GroupedRoutes/TransactionRoutes/TransactionsRoutes.js:29`; `../DS2_Frontend/src/Pages/Transactions/PendingPayments/PendingPaymentsPage.js:15`. Tabs are New, Processed, All, Upload. |
| Queue tabs | `../DS2_Frontend/src/Pages/Transactions/PendingPayments/tabs/NewPaymentsTab.js:25`, `../DS2_Frontend/src/Pages/Transactions/PendingPayments/tabs/ProcessedPaymentsTab.js:37`, `../DS2_Frontend/src/Pages/Transactions/PendingPayments/tabs/AllPaymentsTab.js:24`. Grid pages are zero-based in React and sent as `page+1`, size 20 initially. Processed offers the current month and prior 23 months and filters by payment date. (`../DS2_Frontend/src/Pages/Transactions/PendingPayments/tabs/ProcessedPaymentsTab.js:11`.) |
| Review | `../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.js:33`. Prefills matched customer, absolute amount, extracted date or today, method or `Check`, and invoice text. Loads customer profile and attempts invoice-number/ID matching against open invoices. |
| Upload/delete | `../DS2_Frontend/src/Pages/Transactions/PendingPayments/tabs/UploadTab.js:9`. Client checks PDF/10 MB, uploads, refreshes file list/counts, and disables file deletion when `has_processed` is true. |
| PDF preview/download | `../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/PaymentPdfPreview.js:7`; retrieves a blob by canonical source filename, forces PDF MIME for display, creates/revokes a browser object URL. |
| API adapter | `../DS2_Frontend/src/Services/ApiCalls/PendingPaymentsCalls.js:16`; approval POST at line 88, raw upload at line 96, file delete/preview at line 123. |

Review requires a selected customer, invoice and positive amount. It posts `selectedRetainerID:null` and does not expose `holdAsPrepayment` or `captureOverpayment`, though the backend approval core supports those options. It makes one atomic request; a missing atomic route is a hard failure, never a fallback to the retired two-call flow. The dialog protects against repeat submission while submitting/after success. (`../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.js:102`, `../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.js:148`.)

## 2. Access rules

All ten routes require active-user authentication and exact allowed roles `manager`, `admin`, `super admin`, `owner`. Account URL must be an integer matching the authenticated account; URL `userID` has no self-or-privileged check. Approval and upload metadata use the authenticated user. Frontend manager gating includes `owner` ([F37](../_review/findings.md#f37)). (`src/app.js:155`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/jwt-auth.js:94`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/pendingPayments/pendingPayments-router.js:16`, `src/endpoints/pendingPayments/pendingPayments-router.js:168`, `src/endpoints/pendingPayments/pendingPayments-router.js:279`, `../DS2_Frontend/src/Routes/ManagerAndAdminProtectedAccess.js:9`.)

Automated upload is available only to account **1**, using a fixed James F. Kimmel & Associates S3 prefix. Other accounts receive HTTP 403 even if their role is allowed. Queue reads remain scoped to their account. File delete/preview additionally require a queue row with the same canonical physical filename and account. A soft-deleted row proves ownership for deletion retries, but preview requires nondeleted evidence. Unknown and other-account files both return 404 before S3 access. (`src/endpoints/pendingPayments/pendingPayments-service.js:3`, `src/endpoints/pendingPayments/pendingPayments-service.js:19`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`, `src/endpoints/pendingPayments/pendingPayments-router.js:274`, `src/endpoints/pendingPayments/pendingPayments-router.js:337`, `src/endpoints/pendingPayments/pendingPayments-router.js:399`.)

Lambda uses its configured IAM/database credentials, `ACCOUNT_ID`, `DB_ACCOUNT_ID` and `CREATED_BY_USER_ID`; it does not impersonate the browser uploader from S3 metadata. Checked-in production Terraform sets all three account/creator values to 1. Actual deployed settings are **not determined from the code**. (`../DS2_Lambdas/Process_Payment_Images/config.py:24`, `../DS2_Lambdas/Process_Payment_Images/database.py:161`, `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:204`.)

## 3. API reference

All pending-payment errors below are real HTTP errors and generally return `{status:<same HTTP code>,message}`. Common 401/403, parser 400/413, rate-limit 429 and uncaught 500 are described in [ledger conventions](ledger-conventions.md#3-api-conventions). There is no standalone queue-edit endpoint. (`src/endpoints/pendingPayments/pendingPayments-router.js:27`, `src/endpoints/pendingPayments/pendingPayments-router.js:433`.)

### List

| Property | Contract |
| --- | --- |
| Method/path | `GET /pending-payments/list/:accountID/:userID` |
| Query | Optional `page=1`, `limit=20` capped at 500; parseInt rules in conventions. `search=''`: trimmed string, other types become empty. `status='new'`: recognized `new`, `processed`, `all`. **Unknown status is not rejected and adds no processed/deleted filter.** Optional numeric/coercible `month`, `year` apply only when both converted values are truthy; no month/year range validation. No client sort; fixed creation descending. |
| Success | HTTP 200 `{payments:[queueRow...],pagination:{page,limit,totalItems,totalPages},message,status:200}`. Rows expose canonical `source_file` for preview and original stored dedup identity as `source_reference`. |
| Errors | Common errors; 400 invalid pagination; 500 unexpected query failure. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:34`, `src/endpoints/pendingPayments/pendingPayments-service.js:45`. |

### Counts

| Property | Contract |
| --- | --- |
| Method/path | `GET /pending-payments/counts/:accountID/:userID` |
| Parameters | Account/user only; no list-search/month filters accepted. |
| Success | HTTP 200 `{counts:{newPayments,processed,all},message:'Success',status:200}`. |
| Errors | Common errors; 500 database/count error. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:77`, `src/endpoints/pendingPayments/pendingPayments-service.js:75`. |

### Single

| Property | Contract |
| --- | --- |
| Method/path | `GET /pending-payments/single/:paymentID/:accountID/:userID` |
| Parameters | Queue ID, numeric/coercible positive integer. No body/paging/filter/sort. |
| Success | HTTP 200 `{payment:rawQueueRow,message:'Success',status:200}`; can return processed/deleted rows. |
| Errors | Common errors; 404 malformed, absent or other-account queue ID; 500 unexpected failure. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:92`, `src/endpoints/pendingPayments/pendingPayments-logic.js:10`. |

### Soft-delete one extracted payment

| Property | Contract |
| --- | --- |
| Method/path | `PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID` |
| Parameters/body | Required positive integer/coercible queue URL ID; no business body fields. |
| Success | HTTP 200 `{payment:updatedQueueRow,counts,message,status:200}`. |
| Errors | Common errors; 404 malformed/missing/foreign ID; **500** already processed/already deleted at the initial read, or unexpected failure; **409** if state changes between the read and conditional deletion. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:107`, `src/endpoints/pendingPayments/pendingPayments-logic.js:29`. |

### Atomic approval

| Property | Contract |
| --- | --- |
| Method/path | `POST /pending-payments/approve/:accountID/:userID` |
| Body | Required `{pendingPaymentId,payment:{...}}`. Queue ID converts to a positive integer. `payment` must be a nonnull object, not an array. Payment fields, DB lengths, dates, rounding, ownership, flags and balance limits are exactly the [create-payment fields](payments.md#payment-input-fields): required customer, amount and date; invoice unless hold-only; optional job/retainer/method/reference/billable/note/hold/split flags. Reviewed values need not equal the extracted values. |
| Success | HTTP 200 `{status:200,message,payment,prepaymentRetainer,pendingPayment,counts,paymentsList,accountRetainersList,invoicesList}`. `payment` is null for hold-only; `prepaymentRetainer` is null unless hold/split. Refreshed ledger lists have the payment-route shape. |
| HTTP 400 | Missing/invalid queue ID or payment object; invalid rounded amount/date/customer ID; missing invoice without hold; retainer-funded hold without invoice. |
| HTTP 404 | Queue row absent in account, account-owned customer missing, or selected invoice missing in account. |
| HTTP 409 | Queue already processed/deleted, or an existing account payment note already has `[pending_payment:N]`. |
| HTTP 422 | Payment business refusal: wrong-customer job/invoice/retainer, missing/live-chain inconsistency, remapped nonpositive target, payment exceeds invoice without eligible split, inactive/exhausted/insufficient retainer. |
| Other errors | Common errors; 500 unexpected DB/core/refresh failure. A refresh failure can follow a committed approval; retry then returns 409. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:154`, `src/endpoints/payments/payment-logic.js:428`. |

### Retired approval

| Property | Contract |
| --- | --- |
| Method/path | `PUT /pending-payments/approve/:paymentID/:accountID/:userID` |
| Parameters/body | Legacy URL retained; authenticated account gate still applies. Payment ID/body are not used to mutate or validate a record. |
| Response | Always HTTP 410 `{status:410,message:'This endpoint no longer posts payments…'}` after middleware; directs clients to the atomic POST. No successful ledger/queue mutation. |
| Other errors | Common middleware errors, including auth/account rejection before 410. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:216`. |

### Upload

| Property | Contract |
| --- | --- |
| Method/path | `POST /pending-payments/upload/:accountID/:userID` |
| Headers/body | Required `x-file-name`: URI-encoded bare filename; decoded once. Optional `x-file-type`, default `application/pdf`, is passed to S3. Raw nonempty Buffer body, maximum **10,485,760 bytes**. Browser sends `application/octet-stream`. Route raw parser limit is 25 MB; application JSON parsing can run earlier for JSON content types. Extension is checked case-insensitively for `.pdf`; no PDF magic/content inspection. |
| Filename rules | Nonempty string; no `..`, slash, backslash, residual `%`, or control byte. No separate filename-length cap. Reusing the exact filename targets the same S3 key. |
| Success | HTTP 200 `{message,fileName:decodedName,s3Key,status:200}`. No queue row or file-status row is inserted. |
| HTTP 400 | Missing filename, missing/nonbuffer/empty body, more than 10 MiB after parsing, non-PDF extension, unsafe filename. |
| Other errors | 403 account not 1; common errors; 413 parser-size failure; 500 URI decode exception or S3/other upload failure. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:18`, `src/endpoints/pendingPayments/pendingPayments-router.js:233`, `src/utils/downloadAuthorization.js:90`, `src/utils/downloadAuthorization.js:115`, `../DS2_Frontend/src/Services/ApiCalls/PendingPaymentsCalls.js:96`. |

### File list

| Property | Contract |
| --- | --- |
| Method/path | `GET /pending-payments/files/:accountID/:userID` |
| Parameters | Account/user only. No paging/search/sort/filter parameters. |
| Success | HTTP 200 `{files:[{source_file,uploaded_at,payment_count,processed_count,has_processed}],message:'Success',status:200}`. Count fields are DB aggregate values, not explicitly number-normalized. |
| Errors | Common errors; 500 query failure. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:300`, `src/endpoints/pendingPayments/pendingPayments-service.js:150`. |

### Delete file and extracted rows

| Property | Contract |
| --- | --- |
| Method/path | `DELETE /pending-payments/file/:accountID/:userID` |
| Body | `{fileName:<required safe bare filename string>}`. It is the exact DB source name, not a full key; no URI decoding in this handler. |
| Success | HTTP 200 `{counts,message:'File and associated pending payments deleted.',status:200}`. Deletes matching archived objects and the pending key, then soft-deletes all eligible sibling rows under one DB lock. |
| Errors | Common errors; 400 missing/unsafe filename or any processed sibling for the canonical file/account; 404 no ownership row; 500 DB/other error. S3 listing/deletion errors return 500 and roll back queue flags; retry completes idempotently after any partial object deletion. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:315`. |

### File preview

| Property | Contract |
| --- | --- |
| Method/path | `GET /pending-payments/file-preview/:accountID/:userID` |
| Query | Required `fileName`: safe bare filename string. No other supported paging/filter/sort inputs. |
| Success | HTTP 200 raw bytes, `Content-Type` from stored object metadata or `application/pdf`, `Content-Length` equal to body length. No JSON success envelope. |
| Errors | Common middleware errors; 400 missing/unsafe name; 404 no ownership row, missing object, or any caught DB/S3 preview failure. |
| Source | `src/endpoints/pendingPayments/pendingPayments-router.js:376`. |

## 4. Data model and file identity

| Queue column | Type/use |
| --- | --- |
| `payment_id`, `account_id` | Identity primary key; required integer account. Queue ID is separate from posted payment ID. |
| `customer_id`, `matched_customer_id` | Nullable integers; unmatched extraction inserts null. Customer FKs use `ON DELETE SET NULL`. |
| `customer_name`, `matched_customer_name` | Required text default empty; extracted and suggested names. |
| `customer_invoice_id`, `customer_job_id`, `retainer_id` | Required **text**, default empty, unlike posted ledger integer links. Invoice extraction commonly carries a number such as `INV-2026-…`, not a DB row ID. |
| `payment_amount`, `payment_date` | Nullable `numeric(12,2)` and date. Extraction is not forced into the ledger's negative convention; reviewed posting normalizes the amount. |
| Method/reference/billable | `form_of_payment` varchar(30); reference text; billable boolean default true. |
| Review state | `is_payment_processed` false, `deleted` false; nullable timestamp `date_processed`. |
| Audit/file fields | `note`, `source_file`, `file_location` text default empty; `created_at` timestamp default now; creator integer default 1. Current Lambda inserts source filename but not file location. |
| Sources | `migrations/schema-snapshot-2026-09-22.sql:617`, `migrations/schema-snapshot-2026-09-22.sql:1990`, `../DS2_Lambdas/Process_Payment_Images/database.py:138`. |

The unique index is `(source_file,customer_name,payment_amount)`, without account/date/reference. To preserve two same-name/same-amount checks in one batch, the writer alters later DB filenames to `original.pdf#dup2-ref123` (or `#dup2` without reference). The actual S3 filename is not changed. Backend file operations strip the reserved trailing duplicate token and use one physical identity for all siblings, without rewriting historical dedup keys; see [F18](../_review/findings.md#f18). (`migrations/schema-snapshot-2026-09-22.sql:1542`, `../DS2_Lambdas/Process_Payment_Images/database.py:101`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:25`.)

Approval adds `[pending_payment:N]` to the posted payment or hold-only root. The queue gets `[posted_payment:P]` or `[posted_prepayment_retainer:R]`. It updates processed flag/time/note, but leaves original extracted customer, amount, invoice text and date intact. The reviewed ledger row can therefore differ from the queue display. (`src/endpoints/pendingPayments/pendingPayments-router.js:183`, `src/endpoints/pendingPayments/pendingPayments-service.js:110`.)

Other reads/writes are `customers` and `customer_invoices` for matching, and the complete payment-core tables on approval: payments, retainer/prepayment chains, invoice snapshots/parents and customer locks, with job ownership checks. The upload archive and LLM audit logs are separate S3 objects; there is no DB file-job manifest written by upload. (`../DS2_Lambdas/Process_Payment_Images/database.py:19`, `../DS2_Lambdas/Process_Payment_Images/database.py:56`, `src/endpoints/payments/payment-logic.js:428`, `src/endpoints/pendingPayments/pendingPayments-router.js:278`, `../DS2_Lambdas/Process_Payment_Images/llm.py:32`.)

## 5. Read logic

Queue list selects account-owned rows with canonical source_file and the original stored value as source_reference, with no joins. `new` means unprocessed and not deleted; `processed` means processed and not deleted; `all` means not deleted. Unknown status means neither condition. Month/year filter SQL `EXTRACT` from **payment_date**, not upload/approval time. Search ORs lowercased LIKE over extracted name, matched name, source, method and reference plus `YYYY-MM-DD` payment date; `%`/`_` are wildcards. Count and page queries are separate; order is created-at descending without ID tie-break. (`src/endpoints/pendingPayments/pendingPayments-service.js:21`, `src/endpoints/pendingPayments/pendingPayments-service.js:45`.)

Counts run three independent account queries: new, processed, all, always excluding deleted. They are not one consistent snapshot and ignore the list's search/month. Single is account/ID `.first()` with no state filter. (`src/endpoints/pendingPayments/pendingPayments-service.js:75`, `src/endpoints/pendingPayments/pendingPayments-service.js:95`.)

File list groups nondeleted rows with nonempty source by canonical `source_file` (duplicate receipt suffix removed): earliest extraction-row timestamp as `uploaded_at`, count rows, sum processed flags, boolean-any processed. Order is earliest timestamp descending. It never lists S3 directly. A file with zero extracted rows, a newly uploaded unprocessed object, or all rows deleted is absent. `uploaded_at` is not the browser upload metadata timestamp. (`src/endpoints/pendingPayments/pendingPayments-service.js:150`.)

Preview first proves canonical-file ownership through a nondeleted queue row. It lists the processed prefix and takes the first object whose key ends with `/fileName`; no month is required. If that lookup fails or returns none, it fetches the pending-prefix exact key. It does not use queue `file_location` or a persisted exact archive key. (`src/endpoints/pendingPayments/pendingPayments-service.js:184`, `src/endpoints/pendingPayments/pendingPayments-router.js:399`.)

Lambda's customer catalog is active customers in `DB_ACCOUNT_ID`, sorted by display name with fallback to customer name. Missing DB credentials/catalog failure returns an empty list, so matching remains unresolved. Invoice matching queries account-scoped invoice number via `ILIKE`, joins its customer, and returns one row without a tie-breaking order. The input is bound, but `%`/`_` still have ILIKE meaning. (`../DS2_Lambdas/Process_Payment_Images/database.py:19`, `../DS2_Lambdas/Process_Payment_Images/database.py:56`.)

## 6. Extraction, matching, normalization, and calculations

### Entry and OCR

The backend stores raw bytes at `James_F__Kimmel___Associates/payments/processing_pending/<canonicalName>`, with authenticated uploader, account and ISO upload-time metadata. Checked-in Terraform configures an S3 ObjectCreated trigger for that prefix and **lowercase `.pdf` suffix**, a 900-second Lambda and 1,024 MB memory. The backend accepts .PDF and mixed case and canonicalizes the stored/returned suffix to .pdf so it matches this trigger (fixed [F36](../_review/findings.md#f36)). Actual event deployment is **not determined from the code**. (`src/endpoints/pendingPayments/pendingPayments-router.js:251`, `src/endpoints/pendingPayments/pendingPayments-router.js:278`, `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:191`, `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:248`.)

The handler processes only `event.Records[0]`, URL-decodes its key, skips unsupported extensions, and passes the key to `main`. Exceptions are logged and rethrown so S3-triggered asynchronous invocations can retry. CLI `main()` instead batches supported pending objects. Supported code extensions are PDF/JPG/JPEG/CSV; the checked-in automatic trigger only matches lowercase PDF. Download uses the configured bucket, not the event's bucket as an independent input. (`../DS2_Lambdas/Process_Payment_Images/process_payments.py:21`, `../DS2_Lambdas/Process_Payment_Images/config.py:70`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:41`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:63`.)

For JPEG, Textract returns LINE blocks. For each PDF page, use embedded text when its stripped length exceeds 20 characters; otherwise render at 2x scale and call Textract. Join page text with a page-break separator. CSV bypasses OCR/LLM. (`../DS2_Lambdas/Process_Payment_Images/ocr.py:18`, `../DS2_Lambdas/Process_Payment_Images/ocr.py:34`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:189`.)

### LLM, fallback parsing, and references

If enabled and OCR is nonempty, redact sensitive PII while keeping names, then send the first 12,000 OCR characters plus filename to Bedrock extraction. The call uses temperature 0 and default 2,048 output tokens; strips Markdown fences and parses returned JSON. Extraction expects payment dictionaries with names; invalid output/call failure becomes no extracted payments, enabling filename fallback. Models are environment-driven; Terraform specifies Sonnet 4.5 IDs, which are configuration evidence only. (`../DS2_Lambdas/Process_Payment_Images/pipeline.py:200`, `../DS2_Lambdas/Process_Payment_Images/llm.py:76`, `../DS2_Lambdas/Process_Payment_Images/llm.py:106`, `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:220`.)

Filename fallback recognizes leading `M-D-YY[YY]` or `M.D.YY[YY]`, `$` amounts with commas/decimals, parenthesized `INV-YYYY-N` or `INC-YYYY-N`, and `Check #N`/`Ch #N`. Two-digit year gets `20` prepended; invalid date returns empty. Amount is Python `round(float(...),2)`, not the ledger's JavaScript rounding. Names precede the amount/check token and have payment words removed; `for …` and `paid by …` become notes. Numbered `N)` segments can yield several payments. If fallback amount is absent, `Deposit amount $…` in OCR can supply it. (`../DS2_Lambdas/Process_Payment_Images/filename_parser.py:19`, `../DS2_Lambdas/Process_Payment_Images/filename_parser.py:79`, `../DS2_Lambdas/Process_Payment_Images/filename_parser.py:106`, `../DS2_Lambdas/Process_Payment_Images/filename_parser.py:160`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:215`.)

Filename method matching takes the first matching keyword in configured order: `cc payment`, `cc pymt`, `cc pay`, `credit card` → `credit_card`; `check`, `chek`, `cheque`, `deposit` → `check`; `wire` → `wire`; `ach`, `zelle`, `venmo` → `ach`; `money order` → `money_order`. No keyword means empty. Normalization lowercases/trims and maps `credit card/ccpayment/cpayment/debit` to `credit_card`, `cheque` to `check`, `wire transfer` to `wire`, `money order` to `money_order`; standard codes and cash stay themselves; unknown methods remain their lowercase text. (`../DS2_Lambdas/Process_Payment_Images/filename_parser.py:25`, `../DS2_Lambdas/Process_Payment_Images/filename_parser.py:70`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:47`.)

Reference cleanup removes exact `credit_card` references first, then rejects references matching account/routing labels or suspicious long MICR-adjacent digits. A filename check reference can override a payment reference when both amounts are truthy and differ by **less than $0.50**, choosing the first differing match. Then missing non-card references are enriched from OCR; claimed invoice numbers are tracked across files to reduce reuse. (`../DS2_Lambdas/Process_Payment_Images/pipeline.py:297`.)

OCR reference heuristics use labeled check/hash/no/fraction patterns and repeated check digits, excluding account/routing/invoice numbers. First match a unique amount page with one check; then use name proximity for multi-check pages; finally use the first unused reference on an amount-matching page. Name proximity uses name words of at least 3 characters, a 4-character prefix and 300-character neighborhood, with a 200-character penalty for a name after the reference. The amount regex uses the **integer part** and optional decimals, not an exact-cents comparison. Leading-zero-normalized references are treated as used; fallback rejects references equal to the integer amount or a year 2020–2029. These are heuristics, not bank reconciliation. (`../DS2_Lambdas/Process_Payment_Images/reference_finder.py:21`, `../DS2_Lambdas/Process_Payment_Images/reference_finder.py:59`, `../DS2_Lambdas/Process_Payment_Images/reference_finder.py:139`, `../DS2_Lambdas/Process_Payment_Images/reference_finder.py:169`, `../DS2_Lambdas/Process_Payment_Images/reference_finder.py:227`, `../DS2_Lambdas/Process_Payment_Images/reference_finder.py:280`.)

### CSV and normalized row

CSV is UTF-8 with optional BOM. Aliases are `customer_name/name`, `payment_amount/amount`, `form_of_payment/payment_type`, `invoice_number/customer_invoice_id`, `check_number/payment_reference_number`, `payment_date/date`, `note/memo/notes`. Amount removes `$`/commas then uses the same Python amount parser. Keep a row when it has a name or truthy amount. CSV dates are copied as text for later DB handling. (`../DS2_Lambdas/Process_Payment_Images/pipeline.py:109`.)

Normalize names, invoice/date/reference strings and note; missing amount becomes empty string, not zero. Set configured account/creator, blank job/retainer/customer links before matching, billable true and local current timestamp at second precision. Notes undergo deterministic numeric-PII redaction. Customer IDs unresolved by matching become SQL null. Invalid extracted money/date is not rescued by the approval validation because insertion happens earlier. (`../DS2_Lambdas/Process_Payment_Images/pipeline.py:47`, `../DS2_Lambdas/Process_Payment_Images/database.py:126`.)

Deduplicate across the invocation using SHA-256 of lower/trimmed name, **stringified amount**, date and lower/trimmed reference; first occurrence wins. Filename is not in this fingerprint. Separate files with the same four values collapse in batch mode, while different numeric spellings can produce different hashes. DB conflict handling is separate and uses the coarser source/name/amount unique key. (`../DS2_Lambdas/Process_Payment_Images/pipeline.py:74`, `../DS2_Lambdas/Process_Payment_Images/database.py:151`.)

### Customer matching

1. Empty catalog leaves entries unmatched. Empty extracted name skips even invoice-based matching. Otherwise an account-scoped invoice-number lookup wins when found. (`../DS2_Lambdas/Process_Payment_Images/customer_matching.py:29`.)
2. Build raw/title/initial-stripped name variants and a filename-name variant keyed by equal numeric amount across the batch. Duplicate display/personal names overwrite earlier entries in the lookup dictionaries; equal-amount filename hints also overwrite earlier hints. (`../DS2_Lambdas/Process_Payment_Images/customer_matching.py:43`, `../DS2_Lambdas/Process_Payment_Images/customer_matching.py:79`.)
3. Rank display names with RapidFuzz WRatio, top N per variant, threshold cutoff. For names not recognized as businesses, also rank personal customer names. Merge each display name's maximum score, then take top N. Defaults are threshold **62**, N **5**, confident-skip threshold **90**; production Terraform overrides the first threshold to **30**. (`../DS2_Lambdas/Process_Payment_Images/config.py:35`, `../DS2_Lambdas/Process_Payment_Images/customer_matching.py:96`, `../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf:212`.)
4. No candidate means unmatched. Top score >=90 uses the top name directly. Otherwise ask the matching LLM. A returned name present in the overall catalog is accepted; `None` leaves unmatched; another invalid nonempty return falls back to the fuzzy top. Missing model/error can return `None`. Matched ID/name is stored, but not the score or full candidate history. Approval still requires human review. (`../DS2_Lambdas/Process_Payment_Images/customer_matching.py:125`, `../DS2_Lambdas/Process_Payment_Images/llm.py:236`.)

## 7. Create, approve, delete, files, and audit trail

### Ingestion and archive writes

Lambda loads secrets when configured outside local stage, loads the catalog, and downloads to a temporary directory. Each successfully parsed file is put in the processed-file list **even if it yielded zero payments**. It deduplicates/matches the combined rows and writes the queue. Connection timeout is 10 seconds, statement timeout 30 seconds, idle-in-transaction timeout 60 seconds. A nonempty import without a DB host raises and retains all pending sources. (`../DS2_Lambdas/Process_Payment_Images/config.py:87`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:141`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:247`, `../DS2_Lambdas/Process_Payment_Images/database.py:86`.)

The writer uses one atomic transaction for the entire extracted batch (all files selected by that invocation), `ON CONFLICT DO NOTHING`, and one final commit. Any row or commit error rolls back every new row, closes the resources, and propagates failure before any source is archived/deleted. A nonempty import without configured DB access is refused. Success returns/logs only committed insert count; retry conflicts count as zero. This fixes [F5](../_review/findings.md#f5). (`../DS2_Lambdas/Process_Payment_Images/database.py:138`.)

For each processed file, try PDF redaction, upload to `processed_payments/<YYYY_MonthName>/<originalFilename>` (leading filename date determines month; otherwise `unknown_month`), then outside local stage delete the original pending key. The archive helper propagates errors and verifies HEAD ContentLength against the local archived bytes before deletion (fixed [F6](../_review/findings.md#f6)). Missing bucket, upload/HEAD failure or size mismatch keeps that pending source. Other committed files in a batch can finish archival; failed archives are logged and raise after temporary-file cleanup. The S3 Lambda handler rethrows failures so asynchronous invocations can retry; it does not return a success-shaped invocation with a statusCode of 500. Zero-extraction files can still be archived; a failed database batch never reaches archival. Per-file exceptions earlier in parsing enter the failed list; there is no persistent failed-file row or notification written here. (`../DS2_Lambdas/Process_Payment_Images/pipeline.py:251`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:267`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:13`, `../DS2_Lambdas/Process_Payment_Images/s3_ops.py:28`.)

Text redaction uses Comprehend above confidence 0.85 for address, phone, email, SSN, bank/routing/card/CVV/expiry, driver/passport identifiers; extraction preserves names. Text chunks are bounded at 99,000 bytes. Failure falls back to regex for labeled numbers, SSNs, card-like sequences and standalone 7+ digits. Persisted notes always use the numeric regex redactor. This describes the implemented patterns, not a guarantee that every sensitive string is detected. (`../DS2_Lambdas/Process_Payment_Images/pii.py:19`, `../DS2_Lambdas/Process_Payment_Images/pii.py:55`, `../DS2_Lambdas/Process_Payment_Images/pii.py:68`, `../DS2_Lambdas/Process_Payment_Images/pii.py:94`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:69`.)

PDF archive redaction obtains Textract bounding boxes, covers matching numeric areas and a lower MICR region, then replaces the local PDF. Bounding-box failure returns an empty list; outer redaction exceptions are logged and archiving continues. LLM audit writes timestamp/model/hash/counts and an **unredacted first-200-character response preview** to logs/S3; optional full debug content is redacted separately. Extracted names/amounts and matching results also appear in application logs. Log retention/access beyond checked-in infrastructure is **not determined from the code** reviewed here. (`../DS2_Lambdas/Process_Payment_Images/ocr.py:67`, `../DS2_Lambdas/Process_Payment_Images/ocr.py:109`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:269`, `../DS2_Lambdas/Process_Payment_Images/llm.py:32`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:207`.)

### Atomic approval

Validate queue ID and payment object, sanitize/map reviewed payment using URL account/authenticated creator, and strip client links. In **one DB transaction**, lock the account-owned queue row `FOR UPDATE`; refuse processed/deleted; search account payments for its pending marker; invoke `createPaymentCore` using that same transaction and append the trusted queue marker. The core takes the customer `FOR NO KEY UPDATE` lock and performs current-chain, amount, job, retainer and split checks. Then set processed true, processing timestamp (`now()`), and reciprocal posted marker. Any failure inside this transaction rolls back the payment, draws, invoice snapshot/mirror, excess root and queue update. (`src/endpoints/pendingPayments/pendingPayments-router.js:158`, `src/endpoints/pendingPayments/pendingPayments-service.js:110`, `src/endpoints/pendingPayments/pendingPayments-service.js:122`, `src/endpoints/payments/ledger-helpers.js:21`.)

Concurrent approvals serialize on the queue row; after one commits, the other sees processed and returns 409. The duplicate-marker query is additional protection. Hold-only approval has no payment row, so repeat protection there relies on the processed queue state. After commit, fetch full account ledger tables and counts. A response-refresh failure does not undo committed posting. Approval neither changes S3 objects nor rewrites extracted values to match reviewer corrections. (`src/endpoints/pendingPayments/pendingPayments-router.js:170`, `src/endpoints/pendingPayments/pendingPayments-router.js:188`, `src/endpoints/pendingPayments/pendingPayments-router.js:195`.)

### Queue/file deletion and later ledger edits

Single soft-delete reads state and rejects processed/already deleted; its conditional UPDATE requires unprocessed and nondeleted state. If approval or another deletion wins after the read, it returns 409 without hiding the posted row ([F16](../_review/findings.md#f16), fixed). No payment/retainer/invoice/S3 object is reversed or deleted by single soft-delete. (`src/endpoints/pendingPayments/pendingPayments-router.js:112`, `src/endpoints/pendingPayments/pendingPayments-service.js:101`.)

File deletion resolves canonical identity, locks every sibling receipt row, refuses if any is processed, deletes matching archive objects and the pending key, then marks all unprocessed siblings deleted. Storage errors return 500 and roll back queue flags; an S3 deletion already completed cannot be rolled back, but retry is idempotent. Preview requires at least one nondeleted owned sibling ([F17](../_review/findings.md#f17), fixed). File grouping, ownership, preview and deletion all strip the reserved trailing `#dupN[-ref...]` receipt suffix ([F18](../_review/findings.md#f18), fixed); stored source_file remains the dedup identifier, and list rows expose it separately as source_reference. Existing suffixed rows need no data rewrite. (`src/endpoints/pendingPayments/pendingPayments-router.js:337`, `src/endpoints/pendingPayments/pendingPayments-router.js:351`, `src/endpoints/pendingPayments/pendingPayments-service.js:136`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`.)

After approval, corrections belong to the posted payment/retainer APIs and their billed/latest-chain guards. Deleting an eligible posted payment does not set its queue row back to new. The retired PUT never changes review state. There is no queue restore or direct queue metadata edit route in this router. (`src/endpoints/payments/payment-logic.js:820`, `src/endpoints/pendingPayments/pendingPayments-router.js:224`.)

## 8. Invariants and tests

The original review read the existing tests and used fake-dependency checks. Remediation now executes the real writer/pipeline/handler with transaction-aware DB and S3 fakes under `test/lambda/payment-durability.spec.js`; failures and retries are covered without cloud access.

| Behavior | Test evidence |
| --- | --- |
| Queue CRUD, malformed/missing IDs, processed/deleted refusals | `test/integration/coverage-payments-pending.integration.spec.js:988`. |
| Approval posts and marks once; retry/concurrency/refusal rolls back; retired PUT returns 410 | `test/integration/payment-reversal.integration.spec.js:1140`, `test/integration/payment-reversal.integration.spec.js:1163`, `test/integration/payment-reversal.integration.spec.js:1187`, `test/integration/payment-reversal.integration.spec.js:1199`, `test/integration/payment-reversal.integration.spec.js:1222`. |
| Upload account gate/filename checks, owned upload, foreign file delete/preview refusal | `test/integration/coverage-pending-payments-authz.integration.spec.js:139`, `test/integration/coverage-pending-payments-authz.integration.spec.js:214`, `test/integration/coverage-pending-payments-authz.integration.spec.js:244`, `test/integration/coverage-pending-payments-authz.integration.spec.js:282`. These do not prove archive deletion. |
| No fallback posting and repeat-submit protection | `../DS2_Frontend/src/Services/ApiCalls/PendingPaymentsCalls.test.js:1`, `../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.test.js:1`. |
| Unmatched rows use null; same-name/amount duplicates receive suffix | `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:141`, `../DS2_Lambdas/Process_Payment_Images/tests/test_database.py:174`. They do not prove suffix-to-S3 identity or per-row rollback isolation. |
| Numeric note redaction and text-service failure fallback | `../DS2_Lambdas/Process_Payment_Images/tests/test_pii_barrier.py:36`. This is not a full PDF-redaction or log-preview guarantee. |

## 9. Known limitations and open decisions

F5 and F6 are fixed by atomic imports and verified archival. F16–F18 are fixed and verified by `review-pending-files.integration.spec.js` (7 tests); [F36](../_review/findings.md#f36) is fixed by canonical upload extensions. The UI's upload list cannot show genuinely zero-row processing/error files because its API groups existing queue rows. Its `payment_count===0` processing/error display therefore has no source row under this query. The advertised processing time is UI copy, not a completion guarantee. No reliable end-to-end retry/reconciliation mechanism for every failed/zero-row file is established by this pipeline. (`src/endpoints/pendingPayments/pendingPayments-service.js:150`, `../DS2_Frontend/src/Pages/Transactions/PendingPayments/tabs/UploadTab.js:87`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:264`.)

The review dialog requests the first 1,000 customers, while shared server pagination caps the result at 500. It does not page the rest in that call. It also cannot approve hold-only or excess-split cases through its present form, although the atomic backend can. (`../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.js:33`, `src/utils/pagination.js:4`, `../DS2_Frontend/src/Pages/Transactions/PendingPayments/components/ReviewPaymentDialog.js:102`.)

File naming is the only ownership/archive association here; no exact immutable S3 object/version is persisted by upload. Same-name replacement, batch dedup and LLM/fuzzy extraction are not proof that the bank deposit total equals posted cash. Reconciliation and retention policy are **not determined from the code**. (`src/endpoints/pendingPayments/pendingPayments-router.js:278`, `src/endpoints/pendingPayments/pendingPayments-service.js:184`, `../DS2_Lambdas/Process_Payment_Images/pipeline.py:74`.)

Report sections 3 and 6 retain the historical accountant decisions and rollout requirements. In particular, deploy backend before the frontend's atomic-only approval, review schema migrations/backfills and account storage ownership, and verify runtime settings. This task did not deploy Terraform, migrations, Lambda or application code. (`scripts/review-2026-09/FINAL_REPORT.md:45`, `scripts/review-2026-09/FINAL_REPORT.md:67`.)

## Completion summary

Coverage: **10 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).

F5 regression: `test/lambda/payment-durability.spec.js` invokes the actual Python writer and pipeline with transaction-aware DB/S3 fakes: bad middle row, archive/delete prevention, idempotent committed counts, commit failure and missing DB configuration (5 passing). No cloud calls or production data writes.

F6 regression: `test/lambda/payment-durability.spec.js` F6Cases covers failed upload/HEAD/size/bucket, retry after committed DB rows, mixed batch archival, verified redacted PDF bytes, image input, and Lambda failure propagation. F5+F6 total: 13 passing. HEAD checks object presence/length; it is not an independent content checksum or retention guarantee.

F36 fixed: accepted `.pdf`, `.PDF` and mixed-case extensions are stored with a lowercase `.pdf` suffix, matching the checked-in notification. `fileName` and `s3Key` return the canonical identity; basename case is preserved. `review-upload-extension.spec.js` checks the real upload router against the Terraform suffix with no cloud call. Existing uppercase objects are not renamed by this change.
