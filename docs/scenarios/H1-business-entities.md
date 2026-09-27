# H1 — business isolation and reviewed cutover

Use synthetic customers in ds2_scenarios and browser fixture account9001 only. Money calculations are hand-computed; compare B (billed) and N (next statement) independently in Create Invoice, Account Audit and AR, per business and summed.

| Step | Tax B / N | Advisory B / N | Explanation |
|---|---|---|---|
| Enter work100 tax,250 advisory | 0 /100 | 0 /250 | One client, two separate sets of work |
| Finalize each | 100 /100 | 250 /250 | Distinct prefixes and legal letterheads |
| Enter another tax40 | 100 /140 | 250 /250 | No movement to advisory |
| Finalize tax | 140 /140 | 250 /250 | Tax carries100 exactly once |
| Hold tax retainer80 | 140 /140 | 250 /250 | Held funds are separate from B/N |
| Admin transfers30 to advisory | 140 /140 | 250 /250 | Tax funds50, advisory funds30; total80, cash unchanged |

Direct cross-business use is refused. A transfer requires reason, source ownership, available amount, current snapshot and UUID key. Admin and Super Admin succeed individually. Employee/manager403 and every failed request preserve the whole database including audit/idempotency rows. Repeated identical request returns the original result, not another30.

Transfer reporting oracle: after moving30 from the80 tax retainer, tax shows50 available,80 originally prepaid and0 drawn for work; advisory shows30 available,0 newly prepaid and0 drawn. Combined available and originally prepaid both remain80. Immutable transfer rows establish the30 out/in; both ledger entries have zero cash/debt effect. Free-text notes and a payment-method label alone cannot establish a transfer.

Legacy split oracle: original live balance90 belongs to the default tax business. Review tax60/advisory30. Incorrect total89, changed source hash, replay with changed input and injected allocation-write failure all refuse without writes. Correct split yields B/N60 and30. Pay tax10 and advisory5, then write off advisory3: tax50/advisory22. Add tax10 and finalize: tax60, advisory22, source position not yet fully consumed. Finalize advisory: tax60/advisory22, two slice links and one completed source link. The original row remains byte-equivalent. Audit Record replay and all three balance views agree.

Tracker oracle: `Scenairo Advisory` has no exact match. It remains entity_unknown with no default attribution. Admin resolves the source hash to Advisory with a reason. Blank reason, stale/double resolution, processed source and nonadmin changes refuse. A new alias uses exact Unicode/case/punctuation normalization only. Inactive mappings do not post new work.

Reclassification oracle: unissued/unfunded shared-job work12 moves from tax N12 to advisory N12 with a reason and source hash. Stale retry refuses. After advisory finalization, changing its entity is refused; correction documents are required. Retainer-funded work is not reassigned without undoing its funding.

Deactivation refuses open billed balances or held funds. Missing/inactive/foreign manual choices, wrong invoice/job/retainer, duplicate prefixes, stale settings, default conflicts, foreign/altered logo and DB/storage failures are explicit errors. Existing printed records and the interest wording remain unchanged.

Executable evidence: `scenario-H1-entities.integration.spec.js`, `path-matrix-H1-entities.integration.spec.js`, `migration-H1.spec.js`, frontend `BillingEntities.test.js` and Playwright `business-entities.spec.js`, plus the full existing suites. Result counts are recorded in [H1 results](../decisions/2026-09-26-run-H1-results.md).

Default-only opening oracle: a preserved90 balance takes a5 payment, then carries85 into the first default-business statement. B/N stay85, the other business stays0, one consumption link is inserted, and the original row is unchanged even when it had no old issue/PDF lock.

## Client audit pagination

After the two-business 100/250 statements and tax-only carry-forward to140, client history includes the three corresponding invoice-number reservations and shows total390. Append30 unrelated firm-wide numbering events: the client's first25-posting page and total must remain identical, its finalized evidence stays visible, and whole-account chain verification includes all30 additional events. Numbering changes are retained in the ledger; they are not copied into every client's history.


## H2 correction to the default cutover oracle

The initial H1 tracker-based historical split is superseded. Pre-cutover U and P settled together remain default; no historical work is held. ExampleB100,U100000,P−100000 givesdefaultN100 andotherbusiness0. Recent genuine unbilled tracker-different work200 remainsdefault until an admin explicitly moves it, producingdefault0/other200. Original rows and reporting attribution remain intact. The [H2 scenarios](H2-receipts-and-aging.md) and `scenario-H2-cutover.integration.spec.js` prove amendment refusal/rollback, immutability, candidate reporting, role checks, retry, reasoned movement and new-work business requirements. Existing deliberate90→60/30 opening allocation coverage remains valid as an explicit reviewed action, never an automatic default.
