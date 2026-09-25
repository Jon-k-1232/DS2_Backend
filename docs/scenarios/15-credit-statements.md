# Optional credit statements

Implemented by `test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js`, in guarded ds2_scenarios only. Finalize means sent and locked; drafts stay editable and write nothing to the ledger.

| Step | Next statement | Billed balance / AR | Pending behavior |
|---|---:|---:|---|
| $100 work, $150 general credit | -50 | 0 | Both pending |
| Preview or finalize without explicit selection | -50 | 0 | No stamp/lock/history/marker change |
| Select credit and finalize | -50 | -50 | Original rows/PDF frozen; no new payment |
| $20 new work | -30 | -50 | New work pending |
| Explicit same-day credit re-bill | -30 | -30 | Old -50 closed by a zero child, original preserved |
| $30 more work, finalize | 0 | 0 | Credit consumed exactly once |
| $61 later work, finalize | 61 | 61 | Normal positive statement |

Each row has a hand-written engine/Audit/AR oracle. Mixed batches skip credit customers without losing their work or write-offs. A separate $100 invoice less a $20 receipt and $90 general credit issues −$10; flagging/reversing that bounced $20 receipt restores $10 debt and allows an archived revision. A second hand oracle uses $130 general credit: $100 − $20 − $130 = −$50 issued; reversing $20 leaves −$30. Its revision explicitly remains a credit with no payment due. Both revisions preserve the original signed amount.

Negative PDFs print CREDIT STATEMENT, Credit balance with sign, No payment due, and carry-forward wording instead of a payment date. The issue records actual session actor and selection reason. Tests preserve original row/PDF bytes, check no synthetic payment, enforce strict booleans/IDs/reason, authentication/role/account boundaries,404s, same-day guards, locked edits, DB failure at every issuance evidence insert, storage failure, and fail-closed eligibility pricing. Failures compare full financial/evidence state before/after.

Validation/race status coverage from the existing finalize suites remains; those now use actual400/404/409 statuses. Default credit-skip coverage in scenario05 is retained, with explicit selection added here.
