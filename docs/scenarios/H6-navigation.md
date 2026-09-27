# H6 — navigation and workflow acceptance

[Workspace rules](../platform/workspace-navigation.md), [design](../decisions/2026-09-26-owner-requests-2.md), [run results](../decisions/2026-09-26-run-H6-results.md).

H6 changes browser navigation and shared interaction patterns. Existing monetary oracles remain authoritative: [H1](H1-business-entities.md), [H2](H2-receipts-and-aging.md), [H3](H3-corrections.md), [H4](H4-recurring.md), [H5](H5-honest-analytics.md). No money definition or API changes.

| Scenario | Expected outcome and no-write boundary |
|---|---|
| Every sidebar leaf | Its canonical URL, correct category/current link, live feature content, no error or denied access for an authorized synthetic role |
| Employee menu | Own upload/history plus existing read-only credit-transfer history; other guarded canonical and legacy financial URLs retain the existing refusal |
| Manager catalogs and adjustments | Catalog access remains; admin settings/actions stay unavailable; existing H3 API tests prove 403 and no writes |
| Historical list bookmark | Replace redirect preserves the query and fragment; refresh stays on the canonical page |
| Historical client tabs | Same customer ID and mapped tab; AI Audit/Audit Record keep their distinct permissions |
| Historical invoice bookmark | Explicit query/state identity resolves to the original invoice; absent identity offers selection recovery, never another client's invoice |
| Historical edit/delete/NSF bookmark | Stable record URL; reload fetches that ID under the current session; missing/foreign ID renders an error with no write form or mutation |
| Stale record/reference request | Late response is ignored after navigation/account/role change; no old customer data is shown or posted |
| Recoverable load failure | Error and retry remain on the same record; no write occurs; successful retry restores the form |
| Client receipts and credit context | Receipt headers and application history retain the selected client/business; credit/refund and Receive payment links carry those selections |
| Work → invoice → payment → correction | Existing end-to-end suites now use canonical paths; existing hand-computed totals, locks, retries, failure retention and read-only checks remain |
| Recurring → ready charges → invoice | Existing H4 browser scenarios retain period/catch-up/edit/skip/locked/double-submit assertions at the canonical Billing route |
| Keyboard | Category Enter/Space only expands; leaf links navigate; grid Enter opens the ID-based record; tabs/dialogs/help have labels; skip link focuses main content |
| Desktop/mobile | Header stays outside the expanded drawer, returns when collapsed, and remains readable at narrow width; account and notification controls remain in the viewport; the account menu receives pointer input and opens; choosing a mobile leaf closes the drawer |
| Unknown/malformed record link | Concise recovery or not-found message; no guessed ID, money, audit event or external request |

Browser cases run against fixture account 9001 only. The navigation fixture temporarily promotes that account's existing synthetic user to Super Admin and restores its exact prior role in finally. It does not use protected account 1 for navigation coverage. The existing read-only suite retains its own network write guard. All money mutations retain the existing local fixture cleanup and append-only audit evidence.

Invoice download regression: load a stable invoice URL, download its original file, and retain the selected invoice and tabs. A download failure is an in-page message, not a replacement for the loaded invoice. A mismatched or missing invoice response never renders another invoice; retry reissues the same scoped read.

User administration: an ordinary admin is refused; the Super Admin fixture creates one synthetic account-9001 user, opens its stable editor, reloads, edits and deletes it. Cancel leaves the row intact. A simulated server error leaves its details visible and releases the submit guard for retry. The exact owned-user request exception does not widen the suite’s general network guard. The user row is checked after each outcome; audit history is retained.
