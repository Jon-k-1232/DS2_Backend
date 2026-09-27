# Run H6 — navigation by category

2026-09-26. Local implementation of the owner’s UX request, following H1–H5 and the corrected H2 default-business cutover. [Design](2026-09-26-owner-requests-2.md), [workspace rules and route index](../platform/workspace-navigation.md), [scenario contract](../scenarios/H6-navigation.md).

## Delivered behavior

The workspace has eight categories and 39 sidebar leaves. Each existing H1–H5 feature is placed with related tasks. The sidebar exposes permitted destinations, expands a category without navigating, highlights the active page and automatically opens the category containing a deep link. Reports and user/template administration retain Super Admin access; business/account settings and automations retain Admin access; catalogs retain manager access. Employees retain the existing read-only credit-transfer history. Only admins apply adjustments, acting alone. No approval workflow or period close was added.

Browser routes use category-based paths. Old bookmarks use replace redirects that preserve query strings, fragments, IDs and existing row state. Clients, invoices and every implemented editor have stable ID URLs. Refresh/back no longer depend on a previously selected row. Old invoice links without an identity show selection recovery rather than guessing another record. Receipt-backed legacy payment links resolve to the protected receipt workflow; historical payment entry/history remains one link from the primary receipt list.

The common shell provides a current title, breadcrumbs, quick actions, responsive navigation and a skip link. Enter time opens its form directly; client links preselect the client/business for received money and credits. Client Receipts displays receipt headers and application history; Credits & retainers distinguishes held sources. Dialog and help controls are labelled and keyboard-operable. The header offset follows expanded/collapsed navigation, and menu icons are bundled locally. Recoverable record/reference loads display errors and retry; missing IDs and empty lists are distinct. Obsolete responses cannot replace a newer record, client/business or session’s reference lists. Invoice load errors are separate from download status, so a successful or failed download leaves the invoice available.

Existing form validation, confirmations, sent locks, reasoned corrections, in-flight checks and idempotency remain. User deletion now propagates failed requests into a visible, retryable message and blocks another submit while pending; the old form crashed after a failed transport returned no response. The account menu is named and sends each role to its permitted home. Recurring plan filters keep visible labels at narrow widths, and their action buttons wrap. No backend route, financial write path, table or monetary definition was added. Rolling statement snapshots/absorption, original-date aging, H2 cutover, printed interest, six-minute rounding and the append-only audit ledger remain unchanged.

## Before navigation

| Previous group | Contents before H6 |
|---|---|
| Customers | Customers List; Recurring plans |
| Transactions | Transactions; Credit transfers; Receive payment; Client credits; Refund history; Credit memos; Payment receipts; Payments; Possible duplicates; Pending Payments; Retainers and Deposits; Write Offs |
| Invoices | Invoices; Create Invoice; Accounts Receivable; Account Audit |
| Analytics | Billing Performance; Client Rates; Time Allocation; WIP / Unbilled; Job Budgets; Tax Season Capacity |
| Jobs | Customer Jobs; Job Types; Job Categories; Work Descriptions |
| Time Tracking | Upload Time Tracker; Your Trackers; Employee Trackers; Business assignments; Transaction Review; Upload Master Tracker Template; Time Tracking Settings |
| Settings | Account Users; Account Settings; Billing businesses; Automations |

Quotes had a route but no sidebar leaf. Several forms selected records solely from browser location state. Permissions were enforced by destination routes while some unauthorized leaves remained visible.

## After navigation

| Category | Contents after H6 |
|---|---|
| Clients | Clients |
| Time & Work | Work entries; Client jobs; Work review; Business assignments; Possible duplicates |
| Billing | Create invoices; Invoices; Quotes; Recurring plans; Credit memos |
| Payments & Credits | Receive payment; Payment receipts; Payment imports; Client credits; Retainers & deposits; Refund history; Credit transfers |
| Receivables | Accounts receivable; Write-offs |
| Reports | Billing performance; Client rates; Time allocation; WIP / Unbilled; Job budgets; Tax season capacity; Account audit |
| Time Tracking | Upload time tracker; Your trackers; Employee trackers |
| Settings | Billing businesses; Account settings; Account users; Automations; Job categories; Job types; Work descriptions; Tracker template; Tracker settings |

The [complete path/redirect map](../platform/workspace-navigation.md#stable-records-and-old-links) includes all list pages, client/invoice tabs and record editor forms. Legacy payment history is retained under `/payments/receipts/legacy`; it is linked from Payment receipts. Canonical work editors include both customer and transaction IDs because the unchanged read API requires them. Invoice detail tabs use `work`, `payments`, `write-offs`, `balance-forward`, and `retainers`.

## Migrations and protected data

H6 has **no migration or backfill**. Next free migration remains **047**. No account-1 row changes are intended. The protected database reference is not connected; the seven required counts are compared with the retained reference census from H2–H5. H6 additionally compares complete before/after digests of 12 account-1 tables including audit events.

| Account-1 table | Final rows | Retained reference / H6 baseline |
|---|---:|---|
| `customers` | 338 | matches |
| `customer_transactions` | 39,052 | matches |
| `customer_payments` | 1,005 | matches |
| `customer_writeoffs` | 657 | matches |
| `customer_invoices` | 2,253 | matches |
| `timesheet_entries` | 28,255 | matches |
| `users` | 23 | matches |

All **12 account-1 counts and complete row digests** match the pre-H6 capture; the **207,272-event** audit chain verifies. Intended and observed H6 migration effects on account 1: **none, zero rows**. The comparison uses the retained reference census without connecting to `ds2_ref_20260922`. [Before](evidence/run-H6/account1-before.json), [after](evidence/run-H6/account1-after.json), [verification](evidence/run-H6/account1-verification.json).

## Validation

| Required command | Accepted result |
|---|---:|
| Backend unit | 1,225 passed |
| Integration, one file at a time | 3,192 passed / 94 files |
| Standalone scenarios | 2,034 passed / 53 files |
| Clean-room | 18 passed |
| Lambda pytest | 17 passed |
| Frontend Jest | 494 passed / 79 suites |
| CI production build | passed |
| Full remote Playwright | 259 passed |
| Read-only drift | 0 / 1,014 client/business comparisons |

All **102 required commands** have accepted exit-0 results. Accepted tests have **zero failures, skipped, pending or flaky cases**; browser retries are disabled. The [consolidated manifest](evidence/run-H6/acceptance/final-acceptance.json) identifies the command and evidence log for each accepted result. [Full browser JSON](evidence/run-H6/acceptance/playwright-results.json), [drift](evidence/run-H6/drift.json).

The focused visual/keyboard/refund recheck is recorded separately and is not added to the full-suite count. It covers final header/menu presentation, the exact stale-refund refusal and settled drawer screenshots after visual refinements. Additional header geometry checks prove the controls remain in the viewport, receive pointer events and open the account menu. [Visual review](evidence/run-H6/visual-review.json), [focused results](evidence/run-H6/visual-final-results.json), [header geometry](evidence/run-H6/header-geometry-results.json). All prior failure diagnostics remain available; only the accepted results above form this verdict.

Commands run one test process at a time; every integration file is a separate command with the specified local environment. Scenario and clean-room counts overlap integration and are not a second grand total. Browser tests use only the supplied external Chromium connection, one worker and no retries. The navigation fixture uses account 9001, temporarily elevates its synthetic user where necessary and restores the prior role. Existing API/UI happy/unhappy and complete financial flows remain in the suite.

The added coverage includes every sidebar leaf; every historical list prefix; client/invoice tab mappings; every implemented historical edit/delete/NSF route; stable ID refresh; malformed/foreign/missing IDs; stale requests; retry; role visibility and direct-route refusal; keyboard category/skip/form interactions; and desktop/narrow navigation. Changed expectation tests assert the canonical destination while preserving their financial and refusal assertions. No existing feature assertion was silently dropped.

Earlier failed passes remain diagnostic logs, not accepted counts. The H1 employee transfer-history access was restored when browser regression caught an overly broad manager guard. Legacy text selectors now use the canonical labels and scope duplicate page/sidebar links. The stale-retainer-refund check now selects the exact $20 available-funds refusal instead of every alert on a page that also includes explanatory credit information; its unchanged-money assertions remain. Keyboard checks wait for usable content, route focus runs before interaction, and screenshots wait for completed drawer transitions. These caught route expectation changes, page-specific table/grid markers, missing local icon bundles and temporary compilation errors during implementation. The final accepted commands use the final source and are recorded separately.

## Documentation and operator handoff

Documentation now includes the before/after map, canonical frontend index, feature guide navigation notes, preserved API index, scenarios, design amendments and frontend-only rollout steps. Workspace MEMORY, FINAL_REPORT, Graphify and the Obsidian mirror are refreshed after verification.

Offline Graphify processed **554 code files** into **2,293 nodes**, **3,175 edges**, **348 communities** and **2,641 graph notes**, with zero model calls. [Graph log](evidence/run-H6/graphify-refresh.log). The [source inventory](evidence/run-H6/source-changes.json) records **121 changed or added source/test files**, with **zero backend runtime/test/migration changes**. [Expanded desktop viewport](evidence/run-H6/screenshots/desktop-expanded-viewport.png), [collapsed desktop](evidence/run-H6/screenshots/desktop-collapsed.png) and [390px layout](evidence/run-H6/screenshots/mobile.png) passed visual review. The expanded full-page capture omitted fixed header controls; the viewport capture, hit testing and menu interaction independently verify their availability. `handoff-verification.json` records the exact document mirror and link checks. The ordinary account-1 read-only suites remain protected by their unchanged network guard; user-management testing uses only its exact owned synthetic user.

Production deployment remains a separate operator action. H6 requires no backend restart because no runtime backend code changes. No Git commands or commits, production/AWS connection, reference-database access or real email was used. No owner decision blocks the chosen UX defaults.
