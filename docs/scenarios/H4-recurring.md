# H4 recurring billing oracles

All fixtures are synthetic in ds2_scenarios, ds2_clean, or account 9001 of ds2_local. No account-1 test writes in the local copy, no real email, no AWS and no reference-database access. Scenario API requests use session identities and the selected business. For each money step compare Create Invoice, independent Account Audit and AR; ordinary refutations hash every committed table before/after.

| Scenario | Hand-computed expected result |
|---|---|
| Monthly Jan–Mar 2026, fee $125, due day 1 | Three periods/charges, $375 unbilled. A second/concurrent open and same-key retry add $0. |
| Edit February to $100; skip March with reason | January $125 + February $100 = $225. March remains a skipped tombstone and nonbillable retained charge. |
| Covered work $60 and explicit excess $40 | Covered work contributes $0 billed; fee $225 + excess $40 = $265. Finalize gives billed/current/next balance $265, zero drift. |
| Monthly day 31, Jan–Mar 2024, $10 | Jan31, Feb29, Mar31: $30. |
| Monthly day 31, Jan–Apr 2025, $10 | Jan31, Feb28, Mar31, Apr30: $40. |
| Quarterly from Nov2025, day31, through Aug2026, $10 | Nov30, Feb28, May31, Aug31: $40. Period ends are Jan31, Apr30, Jul31 and Oct31. |
| Semiannual from Aug2025 through Aug2026, day31, $10 | Aug31, Feb28, Aug31: $30. |
| Annual from Feb2024 through Feb2026, day31, $10 | Feb29 2024, Feb28 2025, Feb28 2026: $30. No 365-day drift. |
| February2025 bill days29,30,31 | Each clamps to Feb28; inclusive end Feb28 permits one $125 fee. |
| End Feb15 2026, start Jan1 | Day1 creates Jan/Feb full fees ($250); day20 creates January only ($125). No proration. |
| Start Jan15, day1, end Mar1 | February and March only, $250. |
| Rate $125→$200 after January generated | January stays $125; February is $200; total $325. Deactivate before March: no March fee, two pending rows remain available for disposition. |
| 14 due monthly periods at $125 | First prepare creates12 = $1,500, reports2 outstanding and blocks invoice creation. Explicit skip of2 creates no money; repeated prepare stays12 fees plus2 skipped periods. |
| Finalize before preparing the one $125 fee | First response409 lists the committed fee and creates0 invoices; after review, one invoice for$125. The issued occurrence cannot be edited/skipped/deleted. |
| Eight legacy monthly plans at Sep26 cutover | Fees $500+$350+$383.18+$425+$837.36+$225+$300+$500 = $3,520.54 when their first October period is eventually generated. Migration itself creates $0 charges and $0 invoices; first automatic period Oct1. |

Negative/zero/fractional-cent/nonfinite fees, absent entity, invalid dates, end before start, invalid day/frequency/boolean, foreign or closed job, wrong client/business/occurrence, missing reason/key/version, stale or reused keys, double-clicks and database failures are rejected atomically. Different-business/calendar changes after history are409. Employee writes are403. Admin, super admin and manager may manage unissued recurring fees; this does not grant adjustment permissions on issued records.

Migration tests prove plain SQL, repeat application, legacy conversion/held unsupported cadence, no automated charge at cutover, scope/audit/truncate guards, mandatory staff on ordinary work, and a valid audit chain. UI tests verify plan forms, combined filters, retained values after failure, deactivation, ready fees in Create Invoice with scheduling off, catch-up, edit/skip reasons, retries and sent locks. Existing UI/route/financial regressions remain part of acceptance.

Sources: `test/integration/scenario-H4-recurring.integration.spec.js`, `test/integration/path-matrix-H4-recurring.integration.spec.js`, `test/scripts/migration-H4.spec.js`, `test/endpoints/recurringCustomer/recurring-calendar.spec.js`, frontend recurring/Create Invoice tests and `e2e/tests/recurring-billing.spec.js`. Exact executed counts and artifacts: [H4 results](../decisions/2026-09-26-run-H4-results.md).

The legacy six-client clean-room seed receives the same043 cutover after insertion, so its pre-cutover manually entered work remains the original oracle. Historical profile/creator fixtures now use a supported Monthly cadence instead of a test-name string. Their attribution/tenant assertions are preserved. The independent billable choice survives hours edits; new-work coverage resets when switching business, and saved work retains its stored billable flag.
