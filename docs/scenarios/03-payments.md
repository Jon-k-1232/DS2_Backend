# P — settlement, overpayment and NSF

Owner run1 update (2026-09-25): Issued parent rows retain original amounts; closing/current child snapshots carry absorption and receipts. Printed receipt edits/deletes/direct reversals require the new lock/exception rule. Unissued reversal/undo coverage remains. See [bounced-check oracle](09-owner-sent-exceptions.md).

Story: Scenario Payments starts with 300 work and statement 00001 = (0,300,0,0,0,300). Each successful/refused action checks N=B below and exact signed payment/invoice rows.

| Action | B=N | Other expected change |
|---|---|---|
| Partial receipt 100 | 200 | payment -100; parent payment total -100 |
| Edit latest receipt 100→120 | 180 | payment -120; total -120 |
| Delete latest receipt (caller supplies forged amount/link) | 300 | stored payment/link determine restoration |
| Exact receipt 300 | 0 | payment -300; paid flag/date set |
| Reverse for NSF | 300 | reversal +300; original marked reversed |
| Duplicate reverse / edit positive reversal / delete reversed original | refused, 300 | no additional row |
| Delete latest reversal | 0 | clear original reversed marker |
| Delete original receipt before next statement | 300 | unpaid again; no receipt remains |
| Pay 350 without split | refused, 300 | no excess or receipt |
| Pay 350 with captureOverpayment | 0 | applied -300, separate unused Prepayment -50 |
| Reverse split | 300 | +300 debt; cancel unused excess (0 inactive), not +350 |
| Undo reversal | 0 | restore excess -50 |
| Delete untouched split receipt | 300 | remove excess root and payment |
| Partial pay 100; advance 31 days; new work 50 | 250 | B=200 before new statement, new charges=50 |
| Finalize statement 00002 | 250 | (200,50,0,0,0,250); old chain absorbed at 0 |
| Edit/delete receipt now included in statement | refused, 250 | use reversal/correction workflow |
| Pay 25 tagged to old statement 00001 | 225 | remap to current chain, annotate original reference |

Extra spent-excess control: issue 100, receive 150 with split, fund 20 work from excess. R=-30, N=B=0 because charge/payment offset. Reversing/deleting original split receipt is refused until the use is undone. Manual retainer draw control uses 100 held against 80 billed: draw 30 leaves debt50/held70; edit draw→40 leaves40/60; delete restores80/100. No-invoice receipt without hold is refused; with hold it is banked separately (R group).

The spent-excess control has the same documented pending-payment diagnostic as R: exactly one unlinked payment totaling20, severity low, until its next statement. This does not indicate a balance mismatch.
