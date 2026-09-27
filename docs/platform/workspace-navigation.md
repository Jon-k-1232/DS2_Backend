# Workspace navigation and page rules

H6 implements the owner’s category-based workspace. Browser paths change; all **218 backend endpoint contracts** and existing ledger permissions remain unchanged. [Design](../decisions/2026-09-26-owner-requests-2.md), [run results](../decisions/2026-09-26-run-H6-results.md), [browser scenarios](../scenarios/H6-navigation.md).

## Navigation

| Category | Pages and canonical paths |
|---|---|
| Clients | Clients `/clients` |
| Time & Work | Work entries `/work/entries`; Client jobs `/work/jobs`; Work review `/work/review`; Business assignments `/work/review/entities`; Possible duplicates `/work/duplicates` |
| Billing | Create invoices `/billing/create`; Invoices `/billing/invoices`; Quotes `/billing/quotes`; Recurring plans `/billing/recurring`; Credit memos `/billing/credit-memos` |
| Payments & Credits | Receive payment `/payments/receive`; Payment receipts `/payments/receipts`; Payment imports `/payments/imports`; Client credits `/payments/credits`; Retainers & deposits `/payments/retainers`; Refund history `/payments/refunds`; Credit transfers `/payments/transfers` |
| Receivables | Accounts receivable `/receivables/aging`; Write-offs `/receivables/write-offs` |
| Reports | Billing performance `/reports/billing-performance`; Client rates `/reports/client-rates`; Time allocation `/reports/time-allocation`; WIP / Unbilled `/reports/wip-aging`; Job budgets `/reports/job-budgets`; Tax season capacity `/reports/tax-capacity`; Account audit `/reports/account-audit` |
| Time Tracking | Upload time tracker `/time-tracking/upload`; Your trackers `/time-tracking/history`; Employee trackers `/time-tracking/trackingAdministration` |
| Settings | Billing businesses `/settings/entities`; Account settings `/settings/account`; Account users `/settings/users`; Automations `/settings/automations`; Job categories `/settings/job-categories`; Job types `/settings/job-types`; Work descriptions `/settings/work-descriptions`; Tracker template `/settings/tracker-template`; Tracker settings `/settings/tracker` |

There are 39 sidebar leaves. The menu is filtered by the existing role of the signed-in user. Employees see their own upload/tracker history and the already permitted read-only credit-transfer history. Posting a transfer stays admin-only. Financial operators retain client, work, billing, payment and read-only adjustment pages. Business assignments, business/account settings and automations require admin; users, tracker templates and Reports remain Super Admin only. Catalogs and tracker staff settings keep their existing manager access. Opening a category expands it without changing the current page. Links highlight the owning page, including when a record or tab is open.

Only admin and super admin may apply write-offs and adjustments, case-insensitively. Moving a page does not authorize a new action. The server’s existing `requireAdmin` guard remains authoritative. Any one admin may act alone; there is no period close or approval workflow.

## Stable records and old links

| Existing browser prefix | Canonical destination |
|---|---|
| `/customers/customersList/customerProfile` | `/clients` |
| `/customers/customersList` | `/clients` |
| `/customers/recurringCustomers` | `/billing/recurring` |
| `/transactions/customerTransactions` | `/work/entries` |
| `/transactions/customerPayments` | `/payments/receipts` |
| `/transactions/pendingPayments` | `/payments/imports` |
| `/transactions/customerRetainers` | `/payments/retainers` |
| `/transactions/customerWriteOffs` | `/receivables/write-offs` |
| `/transactions/possibleDuplicates` | `/work/duplicates` |
| `/transactions/employeeTimeTrackerTransactions` | `/time-tracking/trackingAdministration` |
| `/jobs/jobsList` | `/work/jobs` |
| `/jobs/jobCategoriesList` | `/settings/job-categories` |
| `/jobs/jobTypesList` | `/settings/job-types` |
| `/jobs/workDescriptionsList` | `/settings/work-descriptions` |
| `/invoices/invoices/invoiceDetail` | `/billing/invoices/selected` |
| `/invoices/invoices` | `/billing/invoices` |
| `/invoices/createInvoice` | `/billing/create` |
| `/invoices/quotes` | `/billing/quotes` |
| `/invoices/accountsReceivable` | `/receivables/aging` |
| `/invoices/accountAudit` | `/reports/account-audit` |
| `/analytics/billingPerformance` | `/reports/billing-performance` |
| `/analytics/clientRates` | `/reports/client-rates` |
| `/analytics/timeAllocation` | `/reports/time-allocation` |
| `/analytics/wipAging` | `/reports/wip-aging` |
| `/analytics/jobBudgets` | `/reports/job-budgets` |
| `/analytics/taxSeasonCapacity` | `/reports/tax-capacity` |
| `/account/accountUsers` | `/settings/users` |
| `/account/accountSettings` | `/settings/account` |
| `/account/automations` | `/settings/automations` |
| `/time-tracking/billingReview` | `/work/review` |
| `/time-tracking/update-template` | `/settings/tracker-template` |
| `/time-tracking/settings` | `/settings/tracker` |

Redirects use replace, preserve query strings, fragments, IDs and available old location state, and finish behind the destination’s original role guard. The old group roots also redirect. Dashboard, login and personal Time Tracking paths remain valid. Existing notification destinations now use `/work/review?tab=needsReview`.

Client detail is `/clients/:customerId`: Overview at the root, then `statements`, `work`, `jobs`, `receipts`, `credits`, `aiAudit`, `auditRecord` and `edit`. AI Audit remains Super Admin; Audit Record remains admin/Super Admin. The selected business carries across that client’s tabs and resets on another client. The Receipts tab shows receipt headers as well as the application history. Credits & retainers explains separate funds and links to the same client/business’s credit controls. Receive payment can be opened with those selections already filled.

Invoice detail is `/billing/invoices/:invoiceId` with `work`, `payments`, `write-offs`, `balance-forward` and `retainers`. Old invoice links recover the ID from their query (`invoiceId`, `invoiceID`, `customer_invoice_id`) or their existing row state, preferring the original parent ID. A link without an ID offers a list-selection recovery screen; it never chooses the last viewed or newest invoice.

Record editors fetch the URL record from the existing tenant-scoped GET endpoint. Jobs, users and catalogs use `/:recordId/edit` and `/:recordId/delete`; write-offs and retainers expose their existing delete workflow. Work uses `/work/entries/:customerId/:recordId/edit` or `/delete`, since its existing read API requires both identities. Historical payment actions use `/payments/receipts/legacy/:recordId/delete` or `/reverse`. If the loaded payment belongs to an H2 receipt, the browser redirects to that receipt’s protected workflow. Legacy payment entry/history remains one link from Payment receipts, at `/payments/receipts/legacy`.

## Shared interaction rules

- The header title and breadcrumbs follow the current route. Quick actions open Enter time, Create invoices, Receive payment and Recurring plans. Enter time opens the ordinary time form in one click. Invoice corrections are available directly from invoice detail.
- Desktop navigation and header offsets share the 290-pixel drawer width. The content can shrink, long titles truncate, and mobile navigation closes after selecting a destination. A skip link and focus target make the main content reachable by keyboard.
- Category buttons expose expanded state; leaf links expose the current page. Detail tabs are actual links with keyboard navigation. Dialogs have programmatic titles, icon actions have labels, and help controls are keyboard-operable. Icons are bundled locally.
- Missing/invalid IDs, load errors, loading and empty receipt lists have distinct messages. Failed record/reference loads expose an explicit retry. A stale request cannot replace a newer record, business selection or session’s reference lists. Editors retain their existing input-validation, in-flight-submit and sent-lock protections.
- Paginated grids remain local to their feature. Shared reference lists load separately for the session; failure is visible and retryable, and obsolete responses cannot populate another account or role’s context. Client filters do not overwrite those shared lists.
- Receipt, credit, correction and recurring writes use the H1–H5 reason, preview/fingerprint, in-flight and idempotency controls. All writes keep the session actor and audit journal. H6 adds no financial write path, new table, migration or change to balance/aging/rounding/interest rules.

## Validation and rollout

Jest tests cover the route adapter, navigation, ID-based loads, missing records, permission gates, stale responses, reference-list retries and client-context links. Playwright traverses every sidebar leaf and old route family, exercises record redirects, refresh/back, keyboard/focus, collapsed/expanded/mobile layouts, and retains the complete H1–H5 happy/unhappy workflows. See the run results for exact executed counts.

Deploy the reviewed frontend only after the H1–H5 backend/schema are present. The static host must serve the SPA entrypoint for canonical and historical browser paths, as it did for previous React routes. No API rename, migration, backfill or backend restart is required for H6. Keep email and automations at their explicitly reviewed settings.

## H9 loading update

All workspace page modules and record groups are loaded by React.lazy with the consistent accessible RouteLoading fallback. Idle prefetch loads Transactions/Enter time and Create invoices for authorized roles. Canonical URLs, compatibility redirects and role gates remain unchanged.

See [bounded loading and save responses](../platform/performance.md) for the current wire contract and [H9 results](../decisions/2026-09-26-run-H9-results.md) for full regression evidence. These details supersede older full-list/grid response descriptions in this guide. Committed refresh warnings still mean saved: reload, do not resubmit.

## H8 page help and keyboard behavior

Every sidebar destination and client-profile tab has an accessible **About this page** information button in the shared header. It opens five plain-language bullets with purpose, use/alternatives, business effects, roles and correction limits. Enter/Space open it; Escape or Close dismisses it and restores focus. Route changes select the matching tab's content. Late customer or invoice grid loads respect an already focused control or dialog.

The single source is `DS2_Frontend/src/help/pageHelp.js`; [the generated owner guide](page-help.md) is checked byte-for-byte by Jest and `node scripts/docs/generate-page-help.js --check`. Button text retains the sentence case written by each page. [H8 browser coverage](../scenarios/H8-browser-and-help.md) covers all destinations, tabs, error recovery and 1280px layouts.

Payment imports uses sentence-case tabs, names the extracted payer and matched client plainly, and distinguishes failed reads from empty lists with a reload action. Superseded month/page responses cannot replace the current selection. Ordinary grids inherit **No records to show for this selection** rather than a technical row-count message.

Shared ordinary grids put document numbers and names first, omit internal-key columns, use sentence-case headers and explain empty selections. Row keys still drive navigation and guarded actions; audit evidence and server export contracts are unchanged. The quote register now receives same-account client, service and creator labels. Account Audit disables old selections while loading or after a read error, clears stale rows on failure and ignores responses from an older search.
