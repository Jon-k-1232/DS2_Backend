# R — money received before work

Story: Scenario Retainer Large prepays 500 and buys two pieces of work. Retainer starting/current amounts are signed negatives; unused money is never an automatic bill deduction.

| Action | Charges / pending payments | R | N / B |
|---|---|---|---|
| Create 500 root before work | 0 / 0 | -500 | 0 / 0 |
| Fund 120 work | 120 / -120 | -380 | 0 / 0 |
| Fund 80 work | 200 / -200 | -300 | 0 / 0 |
| Edit first work 120→150 | 230 / -230 | -270 | 0 / 0 |
| Reduce starting receipt 500→300 | 230 / -230 | -70 | 0 / 0 |
| Attempt reduction to 229 (already used 230) | refused; unchanged | -70 | 0 / 0 |
| Set starting receipt exactly 230, then restore to 300 | unchanged | 0, then -70 | 0 / 0 |
| Delete second 80 work, then re-enter/fund 80 | 150 / -150, then 230 / -230 | -150, then -70 | 0 / 0 |
| Try funded 100 with only 70 available | refused atomically | -70 | 0 / 0 |
| Finalize invoice 00001 | (0,230,-230,0,-70,0) | -70 | 0 / 0 |
| Attempt receipt300→280 after issuance | HTTP409; original receipt and230 applied unchanged | -70 | 0 / 0 |

Root/child delete after use, reversal of a draw, billed work edit/delete and drawing past the remaining balance are refused. A post-issue reduction now refuses. Decision1 now provides a separate audited refund/adjustment journal; an ordinary edit is not a cash refund. PDF must show 230 before retainer, 230 applied, 70 remaining and 0 due at issue.

Scenario Retainer Small: receive 100; whole funded work of 150 is refused (no partial draw). Fund work of 100, then enter separate unfunded 50. Exact totals: charges 150, pending payments -100, held 0, next bill 50. Finalize invoice 00002 = (0,150,-100,0,0,50), B=N=50. Exhausted-chain further funding is refused.

Unused root control: create 40, edit to 25, delete; R -40→-25→0, N=B=0 throughout. Hold-only payment of 90 creates a Prepayment root, **no** customer_payments row: R=-90, N=B=0. Bad amount/type/owner, child deletion, used root, transaction/payment references, linked excess and cancelled roots are explicit refusal cases.

Expectation correction after initial run: Account Audit intentionally reports `unlinked_payments` for **valid pending retainer draws**, before finalization. The feature specification explicitly labels one such payment low and multiple medium. The tests now assert that exact diagnostic (count, sum, severity), alongside zero balance difference: first draw 1/$120; second 2/$200; repriced 2/$230; after deleting second 1/$150; small-retainer case 1/$100. After stamping on a statement it must disappear. No financial expectation changed and no other warning is accepted.


## Owner run 2 — retainers and duplicate review

Decision 1 now supplies explicit immutable refund and increase/decrease events. Ordinary root repricing is still distinct from recording money returned. Event-bearing chains reject direct edits/deletes even when not issued. See [run 2 hand oracle](10-owner-retainers-duplicates.md) for refund math, statements, races and three-view checks.
