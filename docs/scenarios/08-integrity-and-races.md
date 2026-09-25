# I — corrupt legacy links and changes while waiting for a lock

Owner run1 update (2026-09-25): Explicit fixture corruption/calendar shifts use `_sent-fixture` under a checked sandbox database/account and transaction-local trigger bypass. A corrupt foreign invoice link on a member still retains its original statement lock; the response reveals only that account-owned invoice. Normal routes never bypass triggers.

These additional oracles were written after coverage inspection and before their tests ran. They exercise defensive refusals without inventing a business correction for damaged data. Every corruption is restricted to ds2_scenarios, restored in finally, and followed by reconciliation. A refusal must preserve every row as it existed immediately before that request, including the deliberate corruption.

Starting clients:

- Integrity Funded: invoice00001=(0,200,0,0,0,200); receive100 retainer, enter20 funded work after issue. N=B200, R=-80; one legitimate unlinked payment20. The new work and its payment offset.
- Integrity Pending:100 unbilled work, N100/B0/R0. Integrity Target: N=B=R0.
- Integrity Manual: invoice00002=(0,100,0,0,0,100), receive40 retainer, manual draw20 pays the invoice. N=B80, R=-20.
- Integrity Excess: invoice00003=(0,100,0,0,0,100), receive150 with excess split. N=B0, R=-50.

Refusal oracles:

1. Funded-work deletion refuses two exact payment claims, a draw ordered before its root, a draw movement10 instead of20, a draw shared by another work row, a draw already covered by the statement, an exact payment missing its retainer identity, or payment19 disagreeing with work20. Each fixture is restored to N=B200/R-80.
2. Manual draw20 cannot be repriced50: the invoice has80 available but the retainer has only20 more. N=B80/R-20. A legacy draw without any unique matching snapshot refuses deletion and preserves the same amounts.
3. A legacy excess with two matching50 roots refuses to guess which root belongs to its receipt. Restore one genuine root, N=B0/R-50. NSF then yields N=B100/R0; a cancelled root whose current amount is corrupt (-1) blocks undo. Restore zero and undo NSF: N=B0/R-50 again.
4. A10 receipt or credit on Funded temporarily yields N=B190 (R-80). Corrupt its customer link to Pending: both financial edit and deletion refuse. Restore ownership then delete: Funded returns200. A normal receipt with a parent-invoice link and inconsistent future parent timestamp refuses repricing rather than silently rewriting a parent. Restore its real child link before deletion.
5. When a selected statement is deliberately changed to a child and no root remains, payment and linked-credit creation refuse. An orphan legacy10 receipt with no invoice cannot be NSF-reversed. Restore the fixture; Pending remains100.
6. Two deletes queued behind the same customer lock target one new25 entry: exactly one succeeds and one is not-found; Pending125 returns100, family total100. A queued customer move of25 followed by a stale delete moves25 once, refuses the delete with changed-by-someone-else, and yields Pending100/Target25. Deleting from its new owner restores Target0. A delete queued before Billing Review removes25 once; the reviewer then receives not-found.
7. A cancelled PostgreSQL query while Billing Review waits for the customer lock returns an error and leaves Pending100. A billed transaction whose corrupted invoice ID belongs to a foreign tenant refuses with invoice_missing; restoring its original link restores normal reconciliation.

V8 execution evidence is used to find missed throw sites, not to treat lines hit as proof that arbitrary input combinations are exhausted. Redundant guards that cannot be reached through the authenticated API with consistent foreign keys are explained separately in the execution report.

Additional legacy oracle before its test: if the excess50 is marked cancelled but its reversal event is missing, deleting the original receipt refuses; it must not remove cancelled money as though it were an untouched receipt. Restore the root and reconcile N=B0/R-50.

Response expectation correction: `invoice_missing` is the internal lock reason, not a serialized HTTP code. The Billing Review router returns HTTP409, code `invoice_locked`, and its missing-statement message. The scenario now asserts those public fields exactly; the financial refusal and unchanged-row requirements are unchanged.

## J — job dependencies, finalization races and invoice deletion

Written before these tests: Anchor bills100 as00001, N=B100. An otherwise unused job carrying a10 pending credit cannot move customer or be deleted; Anchor N90/B100, removing the credit restores100. The same job carrying a10 invoice receipt also cannot move/delete; N=B90, deleting receipt restores100. No-customer job creation refuses.

A synthetic legacy parent with no source work rows represents100 billed debt. A10 receipt leaves90 and blocks deletion through its child snapshot; removing receipt restores100, deleting the now-empty parent restores0. When payment and deletion queue behind a lock in that order, payment succeeds and deletion refuses newly linked activity; the same amounts apply. Two deletions of one legacy zero parent yield exactly one success and one not-found. A legacy zero parent's owner changed while deletion waits makes deletion refuse; fixture ownership is restored. These legacy parents have nonconforming `LEGACY-...` numbers and no issued artifact; they are controlled integrity fixtures, not new finalized statements.

Two same-customer finalizations of100 whose PDF uploads meet at a barrier yield one statement00002=(0,100,0,0,0,100) and one same-day conflict, with one stamped work row. Two different clients (100 and200) racing for00003 yield one success and one invoice-number conflict. The winner has B equal to its exact work amount, the loser B0; retrying the loser yields00004 at its own exact amount. Both possible winner identities are allowed, never two winners or a consumed number on refusal.

During a finalize upload, changing selected work100 to110, making it nonbillable, deleting it, or moving it to an empty target invalidates the statement. Expected next amounts are110,0,0, or source0/target100 respectively, all B0; the legitimate concurrent change survives. A10 receipt posted to Anchor during a rebill invalidates that rebill and leaves90 billed; undoing receipt restores100. No stale statement is committed.

A PostgreSQL trigger that suppresses an expected work or payment stamp must make finalize refuse and roll back its parent and every prior stamp. An unfunded100 case remains N100/B0; a20 funded case with100 held remains N=B0/R-80 and one pending20 payment. Suppressing a customer update must refuse and leave its prior profile and money untouched.
