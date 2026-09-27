# About DS2 pages

Generated from `DS2_Frontend/src/help/pageHelp.js`. Run `node scripts/docs/generate-page-help.js` from DS2_Backend; `--check` verifies this file. The shared information button uses this same content.

## Clients

Route: `/clients`

- What: Find client contact details, work, statements and money history in one place.
- Use: Search for an existing client before creating another. Open the client profile for their records.
- Business effect: Contact changes do not create charges or payments. Financial activity remains separate for each of our businesses and is recorded in the audit history.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit contact details when needed. Clients with financial history cannot simply be deleted; correct their records through the matching workflow.

## Work entries

Route: `/work/entries`

- What: Record time and charges for a client and the business doing the work.
- Use: Choose the client, our business and job before entering work. Use Receive payment for money received.
- Business effect: Billable work adds to unbilled work, not billed revenue until finalized. Time rounds up once to six-minute units; actual effort and captured staff cost support reports.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit or delete unissued work. Finalized work is locked; an admin uses a credit memo or Void and rebill. Generated recurring fees are changed through their period controls.

## Client jobs

Route: `/work/jobs`

- What: Organize the services and rates used for a client’s work.
- Use: Search within the selected client and business. Create a job before recording work that needs it.
- Business effect: A job alone creates no receivable or cash. Its rates guide new work; historical issued charges stay unchanged. Changes are audited.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit eligible job details. Referenced jobs may require correction of their dependent records before deletion; sent records stay locked.

## Work review

Route: `/work/review`

- What: Review imported time, client and job matches, rates and held entries before billing.
- Use: Resolve missing or incorrect information here; use Business assignments for unresolved tracker business names.
- Business effect: Only accepted billable work reaches billing. Covered recurring time remains separate from excess billable work; saved corrections retain their actor and reason.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Fix unissued work with a reason and recheck the client and business. Issued work requires an admin correction document.

## Business assignments

Route: `/work/review/entities`

- What: Resolve tracker entries whose business name could not be matched safely.
- Use: Choose the actual business for new held work. Use Billing businesses to maintain names and exact aliases.
- Business effect: Resolving new work can make it eligible for billing in that business. Historical tracker attribution alone does not move old balances; decisions are audited.
- Who: Admins and super admins manage business assignments.
- Correcting mistakes: A reason is required. Move only eligible unissued work; already issued records need an admin correction. Never create a business from a mistyped client name.

## Possible duplicates

Route: `/work/duplicates`

- What: Review records that may represent the same work or money more than once.
- Use: Compare the records and source evidence. Dismiss a false alarm; use the sent-record correction process for a finalized duplicate.
- Business effect: Flagging or dismissing changes no balance. Removing a permitted duplicate changes its financial effects and leaves audit evidence.
- Who: Managers and admins may review and flag. Only admins and super admins may remove a record that holds money, without a second approver.
- Correcting mistakes: A flag never unlocks sent records. Removal cannot erase issued evidence; use an admin correction and keep a clear reason.

## Create invoices

Route: `/billing/create`

- What: Prepare and finalize each client’s statement for one of our businesses.
- Use: Review ready recurring charges, unbilled work, balance forward and proposed credit use. Preview a draft before finalizing.
- Business effect: Finalize means sent and locked. New charges count as billed revenue; old debt carries forward without becoming new revenue or getting a younger age. Held credit is applied once.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Drafts stay editable. Finalized invoices and their records cannot be edited; admins use a credit memo, Void and rebill or the specific bounced-check process. Credit statements require individual selection.

## Invoices

Route: `/billing/invoices`

- What: Find original statements, their current balances and correction history.
- Use: Open an invoice to view its details or reprint its original. Use Create invoices for the next billing cycle.
- Business effect: Reprinting changes no debt, cash, revenue or aging. Current balances can differ from the original after later payments and corrections.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Finalized originals stay locked. Only admins and super admins can issue credit memos, Void and rebill or bounced-check corrections, with a reason.

## Invoice details and Void and rebill

Route: `/billing/invoices/:invoiceId`

- What: See the original invoice, work, payments, carried balance and linked corrections.
- Use: Use a credit memo for a post-issue discount or overcharge. Use Void and rebill to replace the invoice’s new charges.
- Business effect: Void and rebill keeps the original and issues a replacement with a new invoice number. It preserves payment history and handles excess as credit; moving funds between businesses must be explicit.
- Who: Managers and admins may read and reprint. Admins only: credit memos, Void and rebill and bounced-check corrections; super admins also qualify and no second approval is needed.
- Correcting mistakes: Finalized originals and replacement invoices are locked. Correct with linked documents and a reason; never edit the old invoice or count carried debt as a new charge.

## Credit memos

Route: `/billing/credit-memos`

- What: A credit memo lowers what a client owes on an invoice that was already sent, without changing the original invoice.
- Use: Correct an overcharge or give a discount after finalization. To replace the whole invoice, use Void and rebill instead.
- Business effect: It reduces the client’s balance and that invoice’s aging, and appears once on the next statement. Reports count it as a credit: lower billed revenue, not a payment or write-off. If already paid, the extra becomes client credit for the next bill or a refund.
- Who: Managers and admins may view. Only admins and super admins may issue or reverse a memo, acting alone with a reason.
- Correcting mistakes: A memo cannot be edited. Reverse a mistake with a linked document; the memo and original invoice remain preserved in the audit history.

## Quotes

Route: `/billing/quotes`

- What: Review proposed prices before billing a client.
- Use: This register is read-only. Review agreed services here, record actual work through Work entries and use Create invoices when ready to bill.
- Business effect: A quote is not an issued invoice, cash receipt or receivable and does not add billed revenue or aging. Changes remain part of the audit history.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Correct a quote before relying on it. Editing a quote does not alter a separate finalized invoice; an admin must correct that invoice explicitly.

## Recurring plans

Route: `/billing/recurring`

- What: Set a client’s recurring fee, business and billing calendar.
- Use: Choose the amount, frequency and start date once. Review generated periods here or in Create invoices; use ordinary work entry for extra services.
- Business effect: Opening Create invoices prepares due fees even when scheduled jobs are off. Each period is generated once and becomes billed revenue only at finalization. Covered time and excess work remain separate.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Plan edits affect future unprepared periods. Edit or skip ready periods with a reason; issued periods stay locked. Older excluded periods require explicit catch-up confirmation.

## Receive payment

Route: `/payments/receive`

- What: Record one cash or check payment and apply it across a client’s open invoices.
- Use: Select the correct client and our business, then review oldest-first amounts. Explain a different allocation. Use a credit memo for a discount, not a payment.
- Business effect: Applications reduce original invoice balances and aging. Any remainder becomes held client credit for that business, used on a later bill or explicitly refunded. Cash is recorded once; there is no bank connection.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Review before recording and refresh stale balances. Only admins can correct or cancel an unissued receipt or handle a whole bounced check; finalized applications stay locked and every correction is audited.

## Payment receipts

Route: `/payments/receipts`

- What: Find received payments and their invoice applications or remaining credit.
- Use: Open a receipt to trace a check across invoices. Use Receive payment to enter new money; use the legacy register for older payment records.
- Business effect: A receipt records cash once. Applying or moving its credit does not create another receipt or billed revenue. Original debt keeps its age.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Only admins and super admins correct allocations, cancel eligible entry mistakes or flag and reverse a complete bounced check, with a reason. Issued history cannot be erased.

## Receipt details

Route: `/payments/receipts/:receiptId`

- What: Trace one payment, its invoice applications, remaining credit and correction history.
- Use: Use this page to review allocations or investigate a returned check. A historical receipt points to its original payment or retainer workflow.
- Business effect: A whole bounced-check reversal restores all its applications at their original ages and removes remaining credit. Refunds or consumed funds may block reversal; no partial bounce is allowed.
- Who: Managers and admins may view these records. Only admins and super admins may apply adjustments, acting alone with a reason.
- Correcting mistakes: Unissued applications can be corrected without changing cash received. Issued applications stay locked. After an allowed reversal, an admin chooses statement revisions or the next statement; all earlier evidence remains.

## Payment imports

Route: `/payments/imports`

- What: Review extracted payment information before recording it in the ledger.
- Use: Check the client, our business, amount, reference and invoice against the source image. Use Receive payment for a manual check covering multiple invoices.
- Business effect: A pending import is not cash posted to the account. Accepting it records the payment once and applies the supported invoice or retainer effect, with audit history.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Fix pending details before accepting. Repeated acceptance must not post twice; already posted money uses the authorized payment correction workflow.

## Client credits

Route: `/payments/credits`

- What: See unused receipt money and credits created by issued statements or correction documents.
- Use: Select the client and business to review available credit. Use Retainers & deposits for separately recorded retainers.
- Business effect: Held receipt credit does not reduce invoice debt until applied. Refunding it reduces funds held; refunding issued statement credit brings its negative billed balance toward zero. Credit itself is not new cash.
- Who: Managers and admins may view these records. Only admins and super admins may apply adjustments, acting alone with a reason.
- Correcting mistakes: Admins record actual money returned with date, method, reference and reason. Refunds are permanent journal entries; used or exhausted credit cannot be refunded again.

## Retainers and credits

Route: `/payments/retainers`

- What: Record deposits held for future work and inspect their remaining availability.
- Use: Use a retainer for funds specifically held this way. Use Receive payment for a check to allocate among invoices and Client credits for receipt overpayments.
- Business effect: A deposit records cash and available funds, not new billed revenue. Applications consume available funds once. Refunds and adjustments change availability without reducing invoice debt a second time.
- Who: Managers and admins may record deposits. Only admins and super admins may refund or adjust them, acting alone with a reason.
- Correcting mistakes: Unissued receipts have guarded edit and delete controls. Sent originals and saved refund or adjustment events cannot be edited; record a permitted new event and retain the history.

## Refund history

Route: `/payments/refunds`

- What: Review documents for money returned from client credit.
- Use: Download a refund record or trace its source. Start a new refund from Client credits; use the client’s retainer tab for retainer refunds.
- Business effect: Refunds reduce available credit and record cash returned. They are not new charges, payments received or write-offs. Their source and reason remain in the audit history.
- Who: Managers and admins may view these records. Only admins and super admins may apply adjustments, acting alone with a reason.
- Correcting mistakes: Posted refund documents are locked. Review the source and amount before recording; an admin must make any further correction through a supported new entry.

## Credit transfers

Route: `/payments/transfers`

- What: Move available credit between our businesses for the same client.
- Use: Use an explicit transfer when the client’s funds belong with another business. Do not change the original receipt’s business or use a transfer to record new cash.
- Business effect: Equal credit-out and credit-in entries preserve total funds. Transfers create no cash or revenue and keep the original source and both businesses in the audit record.
- Who: Signed-in staff can open this page; financial reads retain their role limits. Only admins and super admins may post a transfer, alone with a reason.
- Correcting mistakes: Transfers are recorded events, not editable replacements. Used, reserved or insufficient funds cannot be moved; correct with a new permitted transfer and retain the original history.

## Accounts receivable

Route: `/receivables/aging`

- What: See what clients owe on issued invoices, grouped by the original age of the debt and our business.
- Use: Use the report for unpaid issued balances. Use WIP / Unbilled for work not yet invoiced, and Advanced to reproduce an earlier report.
- Business effect: Carrying debt onto a later statement never restarts its age. Issued credits and held receipt credit are shown separately. Historical estimates and unknown ages remain identified; reading the report changes nothing.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Fix the underlying payment, work or invoice through its proper workflow, then refresh. Only admins apply adjustments; a report cannot edit locked invoices or erase audit history.

## Write-offs

Route: `/receivables/write-offs`

- What: Record an amount the firm decides not to collect or an allowed concession on unissued work.
- Use: Choose the correct client, our business and invoice or work. Use a payment for money received, a credit memo for an issued overcharge, and a refund for money returned.
- Business effect: A write-off reduces the relevant amount due or unbilled value. It is reported separately from cash and credit memos and leaves its reason and actor in the audit record.
- Who: Managers and admins may view these records. Only admins and super admins may apply adjustments, acting alone with a reason.
- Correcting mistakes: Only admins and super admins may create, edit or delete eligible write-offs. Sent write-offs stay locked; use a supported correction rather than changing issued evidence.

## Billing performance

Route: `/reports/billing-performance`

- What: Compare work entered, unbilled work, issued revenue, applied receipts and margin.
- Use: Choose matching dates and businesses. Use AR for unpaid invoice ages; use the cash figures when asking how much money was received or returned.
- Business effect: Billed revenue counts finalized new charges, less credit memos and voids, without counting balance forward twice. Margin uses captured staff costs; estimated or unknown costs are labeled.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Changing filters changes only the report. Correct source records through their workflow; sent records require an admin correction and historical cost evidence is not overwritten by today’s rate.

## Client rates

Route: `/reports/client-rates`

- What: Compare client work, issued billing and effective rates.
- Use: Use the same period and business when comparing clients. Use Billing performance for the full revenue, receipt and margin breakdown.
- Business effect: Unbilled work is separate from issued revenue. Credit memos and voids reduce net billed amounts; missing cost or rate evidence is identified rather than guessed.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Filters and exports are read-only. Correct source work before issue or use an admin correction for a finalized invoice; refreshing reflects those recorded events.

## Time allocation

Route: `/reports/time-allocation`

- What: Review where staff effort was spent across clients, services and businesses.
- Use: Use actual effort to understand workload, including covered or nonbillable time. Use billed-revenue reports to assess issued fees.
- Business effect: Worked-for business attribution describes effort and does not move historical client balances. Actual minutes and captured costs support margin; six-minute billing rounding is a separate calculation.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Correct eligible source time with a reason. Finalized records and captured history remain protected; changing a staff rate does not reprice old labor cost.

## WIP / Unbilled

Route: `/reports/wip-aging`

- What: Find billable work that has not yet been finalized on an invoice.
- Use: Use this to prepare billing and investigate older unbilled work. Use Accounts receivable for already issued debt.
- Business effect: Unbilled work is not billed revenue or cash. Historical cutoffs show what was unbilled at that time; held work is distinguished from work ready to bill.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Correct or release eligible work through Work review and bill through Create invoices. This report cannot change issued records or bypass required business assignments.

## Job budgets

Route: `/reports/job-budgets`

- What: Compare job expectations with recorded work and billing.
- Use: Use consistent dates, client and business selections to spot work needing review. Use the job or work page to change eligible inputs.
- Business effect: Budget analysis is read-only; it does not create debt, cash or adjustments. Issued revenue and captured cost evidence remain separate from entered work.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Correct the job or unissued work at its source. An admin correction is required for issued charges; report filters never rewrite them.

## Tax season capacity

Route: `/reports/tax-capacity`

- What: Review staff workload and tax-season service capacity.
- Use: Use recorded effort and consistent reporting dates for planning. Use Account users to maintain authorized staff settings.
- Business effect: Planning views create no charge, cash or receivable. Covered time and actual effort remain visible; historical cost estimates are identified.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Correct source time or future staff settings through the relevant page. Planning changes cannot edit sent invoices or rewrite prior cost evidence.

## Account audit

Route: `/reports/account-audit`

- What: Reconcile balances, unbilled work and available funds across clients and businesses.
- Use: Run a reconciliation when investigating a difference. Use the client’s Audit Record for the deterministic change history and immutable evidence documents.
- Business effect: The audit compares next-statement and issued-balance calculations without adding duplicate debt. It creates review evidence, not a payment, invoice or adjustment. Full audits run in the background.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Investigate findings and correct underlying records through authorized workflows. An audit is not permission to edit sent records or apply non-admin adjustments.

## Upload time tracker

Route: `/time-tracking/upload`

- What: Submit a completed spreadsheet of staff work for validation and processing.
- Use: Use the current template and confirm its owner and dates. Correct rejected rows before uploading again; use Your trackers to follow progress.
- Business effect: Accepted rows can become work for billing after matching and business review. Time is billed in six-minute units and retains actual effort and initial cost evidence. Duplicate review prevents accidental reposting.
- Who: Signed-in staff can upload within their permitted ownership scope; managers and admins have the supported staff-management options.
- Correcting mistakes: Validation failures do not authorize guessing a client or business. Correct the source or held entry; sent work stays locked and needs an admin correction.

## Your trackers

Route: `/time-tracking/history`

- What: Follow your uploaded files and their validation or processing results.
- Use: Check status and errors before trying an upload again. Use Upload time tracker for a corrected file and Work review for authorized matching corrections.
- Business effect: Viewing or downloading history changes no balance. Only accepted posted work can affect billing; the uploaded source remains evidence.
- Who: Signed-in staff see their permitted tracker history; broader staff review belongs in Employee trackers.
- Correcting mistakes: Use the error explanation to correct the source. Do not re-enter already posted work to clear a status; finalized work requires an admin correction.

## Employee trackers

Route: `/time-tracking/trackingAdministration`

- What: Review staff tracker submissions, status and imported time.
- Use: Use this for staff-wide tracker follow-up. Use Work review for client, job and billing corrections; employees use Your trackers for their own files.
- Business effect: Tracker status is not a payment or invoice. Accepted work may feed billing; uploads, review decisions and processing retain audit evidence.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Resolve validation or held-work problems at their source. Do not delete or rewrite sent work; use the supported admin correction workflow.

## Business settings

Route: `/settings/entities`

- What: Manage our billing businesses, legal names, invoice details and tracker aliases.
- Use: Add a real firm business or maintain an existing one. Client companies belong in Clients, not in this list.
- Business effect: Each business keeps its own balances, credit and invoice numbering. Old issued letterheads stay frozen. Changing a tracker alias does not automatically move old money.
- Who: Admins and super admins manage businesses. Any admin may act alone; financial transfers and reassignments require a reason.
- Correcting mistakes: Keep at least one active default business. Deactivate a referenced business instead of erasing its history; use explicit unissued-work moves or correction documents for mistaken financial assignments.

## Opening balances

Route: `/settings/entities/cutover`

- What: Review the initial business assignment of existing balances and funds.
- Use: Use only for a reviewed cutover or permitted amendment. Use normal billing and payment pages for current activity.
- Business effect: Pre-cutover open debt, unbilled work, pending adjustments and credits stay together in the default business unless explicitly reassigned. Other businesses start at zero; tracker attribution alone moves no money.
- Who: Admins and super admins review and apply eligible opening assignments with a reason.
- Correcting mistakes: Applied manifests and original records remain immutable. Stale or incompatible changes are refused; correct through a supported amendment before activity blocks it.

## Account settings

Route: `/settings/account`

- What: Maintain the firm account’s contact and general settings.
- Use: Use Billing businesses for each issuing company’s details and Account users for staff permissions.
- Business effect: General settings do not post cash or change client balances. Issued invoices retain their original saved details; account changes are audited.
- Who: Admins and super admins can edit account settings.
- Correcting mistakes: Review before saving and correct eligible settings here. Renaming the firm does not erase its storage ownership, issued documents or audit history.

## Account users

Route: `/settings/users`

- What: Manage staff access, identities and rates.
- Use: Choose the least access needed for the job. Admin and super admin are the only roles allowed to apply financial adjustments.
- Business effect: New staff cost rates apply to future recorded work; old captured costs and issued revenue stay unchanged. Access and rate changes are audited.
- Who: Super admins manage account users. A manager role does not grant adjustment authority.
- Correcting mistakes: Correct future settings here. Users referenced by history have guarded deletion; do not erase financial evidence to remove a staff member.

## Automations

Route: `/settings/automations`

- What: Choose supported account reminders and scheduled workflow preferences.
- Use: Maintain recipients and timing preferences here. Use recurring plans for client billing schedules.
- Business effect: Account preferences cannot override the server’s email and scheduler switches. This local sandbox suppresses real email and scheduled jobs. Due recurring charges still prepare when Create invoices opens.
- Who: Admins and super admins manage these account preferences.
- Correcting mistakes: Review recipient choices before saving. Turning a preference off does not undo previously recorded work or an already sent message; changes are audited.

## Job categories

Route: `/settings/job-categories`

- What: Maintain the categories that group your service types.
- Use: Choose clear names that staff can recognize. Use Job types for individual services and Client jobs to assign them.
- Business effect: A category is a reference label, not debt, revenue or cash. Changes are audited and referenced financial records keep their protected history.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit eligible labels here. Deletion is guarded when dependent jobs or work still use the category; sent evidence cannot be removed.

## Job types

Route: `/settings/job-types`

- What: Maintain reusable service types and their pricing defaults.
- Use: Use these when setting up client jobs. Record performed services through Work entries.
- Business effect: Defaults guide new jobs and work; changing a type does not rewrite finalized charges or automatically create revenue. Changes are audited.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Correct eligible defaults and inspect dependent records before deletion. Sent records stay locked and financial corrections are admin-only.

## Work descriptions

Route: `/settings/work-descriptions`

- What: Maintain reusable wording for work entries.
- Use: Use clear service descriptions so staff and clients can understand the work. Use Work entries to record actual services.
- Business effect: A description alone changes no balance or report total. Using it on work can support billing; updates are kept in audit history.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Correct eligible wording here. Removing a referenced item is guarded and does not authorize rewriting sent invoice evidence.

## Tracker template

Route: `/settings/tracker-template`

- What: Maintain the spreadsheet template used for time uploads.
- Use: Use the supported workbook format and review the template before staff use it. Upload actual completed time on Upload time tracker.
- Business effect: Template changes affect future uploads, not existing work, invoices or cash. Validation protects the structure and account-specific information.
- Who: Super admins manage the shared tracker template.
- Correcting mistakes: Replace an incorrect template with a validated one. Existing accepted or issued work must be corrected through its own workflow; changing the template does not redo it.

## Tracker settings

Route: `/settings/tracker`

- What: Maintain staff and account choices used by time-tracker workflows.
- Use: Use this for tracker-specific settings. Use Account users for roles and cost rates, and Automations for reminder preferences.
- Business effect: Settings guide future processing and notifications; they do not themselves post debt or cash. Server email and scheduling switches still apply.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Correct eligible settings here and review affected held work separately. Existing uploads and sent records are not silently rewritten.

## Dashboard

Route: `/dashboard/app`

- What: Open the workspace and navigate to the task you need.
- Use: Choose Clients for a client’s records or the grouped navigation for billing, payments, reports and settings.
- Business effect: Navigation changes no balance, cash or audit history. Financial changes occur only through their permitted workflow.
- Who: Signed-in staff see destinations allowed by their role.
- Correcting mistakes: Return to the appropriate page to correct an entry. Finalized records remain locked and only admins can apply adjustments.

## Client overview

Route: `/clients/:customerId`

- What: See a client’s contact details and current balances.
- Use: Select our business to inspect a single ledger, or all businesses for an overview. Open the relevant tab for detailed activity.
- Business effect: Issued balances, unbilled work and held funds are distinct amounts. Viewing the profile posts nothing and does not net funds between businesses.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit contact details through Edit client. Correct money through its own workflow; finalized records stay locked and adjustments are admin-only.

## Client statements

Route: `/clients/:customerId/statements`

- What: Review this client’s original statements and their later balance history.
- Use: Open an invoice for line details and correction documents. Use Create invoices to prepare the next statement.
- Business effect: Original totals stay frozen; later payments and corrections change the current balance. Carry-forward is not a second charge and does not reset aging.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Reprints change nothing. Admins correct sent invoices with linked documents; original invoices and PDFs cannot be edited.

## Client work

Route: `/clients/:customerId/work`

- What: Review time and charges recorded for this client.
- Use: Check the selected business and service details. Use Work entries to record new work or Work review for held imports.
- Business effect: Billable unissued work contributes to the next bill; it is not yet billed revenue. Covered time remains effort for cost reporting without duplicating the recurring fee.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit eligible unissued work. Finalized records stay locked; admins use invoice corrections and generated recurring work uses its period controls.

## Client jobs

Route: `/clients/:customerId/jobs`

- What: See this client’s jobs and service rates.
- Use: Choose the correct business and job for new work. Use the job catalog to maintain reusable service types.
- Business effect: Jobs guide work entry but do not themselves create debt, cash or billed revenue. Job and work changes are audited.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Edit eligible jobs; dependent work can prevent deletion. Changing a rate never rewrites a sent invoice.

## Client receipts

Route: `/clients/:customerId/receipts`

- What: Review this client’s received payments and their applications.
- Use: Use Receive payment for this client to record a check across invoices. Choose our business before reviewing balances.
- Business effect: Cash is received once; invoice applications reduce the original debt, and unapplied excess stays as held credit for that business.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Only admins correct applications, cancel eligible unissued mistakes or process a whole bounced check with a reason. Finalized history stays locked.

## Client credits and retainers

Route: `/clients/:customerId/credits`

- What: Review held retainers and their refund or adjustment history.
- Use: Use View client credits for unused receipt money or statement credit. Record an actual refund only when money is being returned.
- Business effect: Retainer events change available funds, not invoice debt a second time. Applications, refunds and noncash adjustments remain distinct in reports and the audit history.
- Who: Managers and admins may view these records. Only admins and super admins may apply adjustments, acting alone with a reason.
- Correcting mistakes: Only admins and super admins may refund or adjust. Saved events cannot be edited; record a permitted new event and never remove funds already used.

## Client AI Audit

Route: `/clients/:customerId/aiAudit`

- What: Review a reconciliation and explanatory findings for this client.
- Use: Use this to investigate discrepancies. Use Audit Record for the deterministic record-by-record change history.
- Business effect: An audit reads balances and creates review evidence; it does not issue invoices, record cash or change the amount owed. Findings need review against the underlying records.
- Who: Super admins can use these reports. Opening or exporting a report does not change the ledger.
- Correcting mistakes: Correct source records through their supported workflows. An audit finding does not unlock a sent invoice or authorize a non-admin adjustment.

## Audit Record

Route: `/clients/:customerId/auditRecord`

- What: Read who changed this client’s records, when and why, and create an immutable evidence document.
- Use: Use the timeline and verification tools to trace an entry. Choose a readable client record or the full evidence record when printing.
- Business effect: The append-only history links financial changes without posting additional debt, cash or revenue. Printed records preserve the evidence available when created.
- Who: Admins and super admins can view, verify and print the Audit Record.
- Correcting mistakes: History and printed evidence cannot be edited or deleted. Correct the underlying record through an authorized new action; the original change remains visible.

## Edit client

Route: `/clients/:customerId/edit`

- What: Update contact and client configuration details.
- Use: Use this for names, addresses and other client settings. Use Recurring plans for versioned recurring fees and dates.
- Business effect: Contact edits do not move money between businesses or rewrite issued letterheads. Changes are audited; recurring settings affect eligible future billing.
- Who: Managers, admins, super admins and the legacy owner role can use this page.
- Correcting mistakes: Correct eligible details and save once. Issued financial records remain locked, and removing a client with financial history is guarded.
