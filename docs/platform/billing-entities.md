# Billing businesses (H1)

**H6 navigation:** Settings → Billing businesses `/settings/entities`, with cutover/detail links; Time & Work → Business assignments; Payments & Credits → Credit transfers. [Route/permission and bookmark rules](workspace-navigation.md).

Transfers preserve total held funds. Account Audit derives transfer amounts from the immutable transfer ledger: outgoing credit is not a draw for work, incoming credit is not a new receipt, and the combined lifetime prepaid total is not duplicated. Transfer entries are explicitly noncash.

One account may operate several legal businesses. Customers and staff stay account-wide; work, plans, money and statements belong to a billing business. An administrator manages **Settings → Billing businesses**, including legal/contact details, invoice prefix, default, activity, logo and exact tracker spellings. Prefixes cannot change after numbering starts. Deactivation refuses open billed balances or unused funds. Existing inactive records remain readable; new work and receipts require an active choice.

## Selection and ownership

Financial forms show the business explicitly. New entry defaults to a valid job choice, a saved account/customer choice, or the active account default. Changing business clears job, invoice and retainer choices. Existing-record editors retain their business. **Reassign billing business** lets an admin move unissued, unfunded work with a reason and current source hash. Issued work is refused. A business-specific job must first be changed to an appropriate shared job through the work editor; reclassification itself does not move job totals.

New financial inserts require an entity column or the validated request context. Composite account/entity foreign keys and a trigger reject cross-account/client/business links. Shared legacy jobs may remain unassigned. Unassigned tracker work may exist only in the holding area. A supplied entity does not grant a role or tenant permission.

`entity-context.js` uses AsyncLocalStorage. `auditContext.js` sets transaction-local `app.billing_entity_id`. Financial SELECTs resolve `billing_scope` read views; writes address public base tables and pass entity integrity triggers. The effective business is an explicit column, immutable legacy attribution or reviewed resolution—never today's default. Standalone reads have a read-only transaction; multi-business balances use a repeatable-read snapshot and separate engine calls. This distinction is essential for inherited statement dates, absorption and latest child snapshots.

## Tracker review

Normalize Unicode NFKC, case, punctuation and whitespace, retaining business words. Only one distinct exact active name/legal-name/alias match may post work. Unknown, ambiguous or inactive mappings are held before AI processing. **Time Tracking → Business assignments** pages through held evidence and requires a chosen active business, reason and unchanged source hash. Raw tracker text is retained. Repeated resolution and processed/deleted source rows are refused. An unused alias may be removed; a spelling already present in tracker evidence is retained.

## Statements, balances and reporting

Create Invoice runs for one business. Its sequence is locked by account, business and year; finalization freezes `<prefix>-<year>-<five digits>`, legal letterhead and logo digest into the issue. Sequence reservations are monotonic and old numbers are never rewritten. Logos are validated PNG/JPEG files, tenant-owned under unique entity keys; a missing or altered selected logo stops issuance. Original invoice artifacts remain immutable. The printed interest line is unchanged.

AR, client tabs, invoice/work/money lists, audit and analytics accept an optional `entityId`. All-business AR sums business rows; the client overview shows billed/next-statement/held-funds amounts for each business. A combined customer statement uses an account header and separate business sections, never one payable invoice combining companies. Saved Account Audit comparisons retain their business. Audit Record verifies the whole account chain before presenting the selected business, company-setting events and transfer counterparts.

H2 adds true original-debt aging under these business scopes. Revised analytics definitions remain H5.

## Transfers and permissions

**Transactions → Credit transfers** moves unused legacy retainer/prepayment funds between businesses for the same client. It appends a source balance snapshot and destination prepayment with one immutable transfer, reason and idempotency record. No customer-payment row or new cash receipt is created. The source and destination remain linked. Transfer-marked roots must not be re-imported as cash receipts by H2.

Only `admin` and `super admin`, case-insensitively through `requireAdmin`, can post a transfer, alone. Managers and employees can read its history. Validate two different businesses, source ownership, current snapshot, available cents and active destination. Same UUID key and input returns the committed response; changed input with that key or a stale new request returns409. H2 extends the screen with unused receipt-credit lots through `/credits/transfers`, preserving origin receipt lineage. Issued statement credit cannot be transferred as held cash.

No period close or approval workflow exists. H3 owns enforcement of the addendum on existing write-offs, refunds/adjustments, bounced-check exceptions and money-bearing duplicate removal. H1 applies it to new transfers from introduction.

## API

All paths are under `/billing-entities`; account and actor come from the verified session. A reason is required for human mutations. Failures use400/401/403/404/409/500; all unsuccessful database transactions roll back money, settings, audit and idempotency rows. Artifact staging may leave an unreferenced unique object after a database failure, never overwrite an issued artifact.

| Method | Path | Access | Contract |
|---|---|---|---|
| GET | `/` | Financial operator | Active and inactive businesses for selection |
| POST | `/` | Admin | Name, legal_name, unique uppercase invoice_prefix; optional letterhead/default fields; reason |
| GET | `/balances?customerId=` | Financial operator | Per-business B, next statement and held funds; aggregate totals |
| GET | `/review?limit=&offset=` | Admin | Unresolved evidence, source and sourceHash; paginated count |
| POST | `/review/:entryID/resolve` | Admin | entityId, expectedSourceHash, reason |
| GET | `/transfers` | Authenticated | Account transfer history |
| POST | `/transfers` | Admin | customerId, sourceEntityId, destinationEntityId, retainerId, expectedSnapshotId, amount, reason; UUID Idempotency-Key |
| GET | `/work/:transactionID` | Admin | Reclassification evidence and source_hash |
| POST | `/work/:transactionID` | Admin | entityId, expectedSourceHash, reason; unissued/unfunded only |
| GET | `/cutover` | Admin | Unsliced and unconsumed source positions, source hashes and total |
| POST | `/cutover` | Admin | reason, positions[{positionId,sourceHash,slices[{entityId,amount}]}]; UUID Idempotency-Key |
| GET | `/:entityID` | Admin | Settings, version and aliases |
| PATCH | `/:entityID` | Admin | Changed fields, expectedVersion, reason |
| POST | `/:entityID/aliases` | Admin | Exact alias, reason |
| DELETE | `/:entityID/aliases/:aliasID` | Admin | Reason; unused spelling only |
| GET | `/:entityID/logo` | Admin | Verified image data URL; missing404, wrong ownership/digest409 |
| POST | `/:entityID/logo` | Admin | PNG/JPEG base64 ≤750 KB, expectedVersion, reason |

## Legacy cutover and operations

Migrations028–036 introduce the dimensions, guarded financial readers, default evidence and reviewed split support. See [rollout](operations.md#h1-business-cutover), [hand-computed scenarios](../scenarios/H1-business-entities.md) and [account1 inventory](../decisions/evidence/run-H1/account1-cutover-report.json).

The corrected default cutover keeps every pre-cutover open item together in James F. Kimmel & Associates: B, eligible U, pending P, held funds and valid existing plans. Tracker matches are reporting attribution only; unmatched legacy work is not held. Default N equals original single-scope N per client; other businesses start0. Sidecars preserve every original business row, rather than updating even mutable historical rows. Other account defaults derive from their own account name. Real-estate businesses require their actual owner-supplied name and letterhead through Settings.

An admin may split an unconsumed opening through **Opening balances**. Each source's nonzero, same-sign slices must equal its latest signed amount exactly. Application locks account and clients, compares source snapshot/hash and refuses any prior consumption, new target invoice or stale evidence. Scoped readers substitute the slices for the original aggregate chain. The first new statement appends the existing closing/absorption snapshot and immutable slice consumption. Only after every slice is consumed is the source position marked fully consumed. No original invoice is edited and no additional charge is created.

`node scripts/entity-cutover-report.js` inventories only the authorized local sandbox and compares original per-row hashes with the retained pre-H1 census. It writes exact attribution/review/position CSVs and a reconciliation JSON. The reference database is not accessed. Original remote artifact bytes are not fetched; their original database row hashes and paths are compared, and H1 writes only new artifact keys.

### Client audit history scope

The account audit chain captures and verifies every business configuration and numbering mutation. A client's Audit Record includes company-wide supporting events only from a database transaction that also posted to that client. It does not fill the client's pages with another client's numbering changes or unrelated settings edits. Business names still resolve at the original posting time, and transfer counterpart references remain visible. The H1 regression inserts 30 unrelated numbering events and proves the client's first page is unchanged while the full chain still verifies.

## H2 supported cutover amendment

GET `/billing-entities/cutover/amendment` plans an immutable superseding manifest. POST the same route requires admin, reason, current manifest hash and UUID. The CLI uses the same service. It refuses a changed source, an already superseded cutover or resumed billing/financial decisions. Migrations037–041 add append-only amendment/scopes evidence rather than editing old manifests or source rows. Scope precedence is explicit physical reassignment, then amended legacy default, then original H1 attribution.

GET `/billing-entities/cutover/candidates` is a read-only manager/admin report. It lists pre-cutover unbilled work with a tracker business different from default and a work date after the client's last issued statement, plus unmatched tracker rows. Nothing moves automatically. Settings → Opening balances displays the candidates. Admin-only reasoned `/work/:transactionID` reassignment moves an eligible unissued item after explicit review. New work still requires its business; unknown/ambiguous new tracker rows are held.

Account1 corrected totals are B41,015.00,U1,513,217.50,P−1,493,344.00,N60,888.50,held5,472.00 in default business; other businesses0 and held pre-cutover work0. Every original financial row remains unchanged. See [H1 correction history](../decisions/2026-09-26-run-H1-results.md#h2-correction--legacy-opening-default) and [H2 results](../decisions/2026-09-26-run-H2-results.md).


## H3 update — 2026-09-26

All H3 corrections require a matching source business. Wrong-business rebill has a separate target and explicit optional receipt-credit transfer. Retaining funds in the source business is the default; the preview shows gross billed balances and held funds separately. H2 opening routing stays unchanged.

[Correction contracts](../ledger/invoice-corrections.md) and [H3 results](../decisions/2026-09-26-run-H3-results.md).

## H4 recurring scope

New plans require a business. The eight legacy plans materialize the already effective default business under migration044 preflight/043; this does not move historical balances or use tracker reporting attribution. After occurrence history, business/calendar changes require ending the old plan and creating a new plan. Coverage defaults use the selected entity, while customers remain account-wide. [Recurring billing](../work/recurring-billing.md) and [rollout](operations.md#h4-rollout--recurring-billing).

## H5 historical reporting attribution

All six analytics pages accept active/inactive business filters and totals. Historical `legacy_billing_scopes.reporting_entity_id` and `reporting_basis` drive worked-for time/value, including raw tracker categories. Billed-by revenue, cash, statements and balances remain in the cutover-assigned business. Billing Performance displays both and labels ambiguous/no-source rows as unattributed legacy work. No H5 balance/entity migration occurs. [Analytics contract](../invoicing/analytics.md).

H5 regression validation also repaired new-business draft initialization: a delayed business-list response preserves entered fields and the decision reason. The browser and Jest regressions explicitly delay that response and verify one save after a double click. Admin-only business configuration remains unchanged.


H9 also applies the profile projection to active payment record editors and pending-payment review (`section=invoices`). Editors hydrate their exact selected job and retainer separately. Retainer deletion uses `section=payments` to check the complete client payment history, including links outside any grid page, without fetching jobs or work. Retainer credit transfer uses `section=retainers`; all business balances remain available for choosing the source. These projections retain the existing manager/admin read guards, selected-business behavior and failure recovery. The actual client profile still loads its full per-client history/tree views.

## H10 read-view migration

048 replaces only `billing_scope.customer_transactions` and `billing_scope.customer_jobs` with account-qualified joins to the same uniquely keyed attribution/review tables. It preserves column names, types and order; explicit IDs take precedence over amended legacy scopes, original attributions and reviewed resolutions. Physically shared (`NULL`) jobs keep their existing visibility rule. Invoice slices and absorption views are untouched. The original attribution function remains the independent equivalence oracle and still serves other consumers. No account-1 rows, audit events or backfills change. Existing unique indexes support these joins; measured plans did not justify another index. [H10 results](../decisions/2026-09-26-run-H10-results.md).

H10 forward migration049 separates `billing_reads` (the two joined nonlocking projections) from the original `billing_scope` views used by all row-lock modes. Writes still use public tables. Exact column order and attribution precedence are preserved; four physical-contention tests enforce the lock contract. Apply048 and049 together before H10 backend deployment; next migration050.


## H8 assignment-review presentation

Assignment cards prefer the client name supplied with the source rather than showing its raw key; the key remains in a tooltip, and missing names are explicitly unrecorded. Empty queues no longer claim to show rows 1 through 0. Loading and error states do not claim the queue is complete, and page/save controls wait for the current read. Assignment permissions, source checks, reasons and audit writes are unchanged.
