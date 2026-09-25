# W — clients, job families and six-minute time

Owner run1 update (2026-09-25): W11 now asserts HTTP409 identifying the sent invoice for work edit/delete and linked job/customer deletion. New unbilled CRUD and existing manual/six-minute rounding remain unchanged.

Story: Scenario Client A buys tax and payroll work; a staff member corrects a duration and removes/re-enters a flat charge. All initial balances are zero. Hourly rate is 150, except the explicitly nonbillable/internal rows at 100.

| Step/action | Exact result (N; B always 0 before finalization) | Job-family totals |
|---|---|---|
| W01 create client with active mailing address, create tax/payroll jobs | 0 | 0 / 0 |
| W02 7 minutes → ceil(7/6)/10 = 0.2 h × 150 | 30 | 30 / 0 |
| W03 60 minutes → 1 h × 150 | 180 | 180 / 0 |
| W04 61 minutes → 1.1 h × 150 | 345 | 345 / 0 |
| W05 payroll charge 2 × 12.50 | 370 | 345 / 25 |
| W06 30 nonbillable minutes → 0.5 h × 100 = 50, excluded from bill | 370 | 395 / 25 |
| W07 correct first entry to 13 minutes → 0.3 h × 150 = 45 (delta +15) | 385 | 410 / 25 |
| W08 delete payroll charge, then re-enter it | 360, then 385 | 410 / 0, then 410 / 25 |
| W09 edit customer address/job notes; list/detail read back | 385 | 410 / 25 |
| W10 finalize A only, invoice 00001 | (0,385,0,0,0,385); N=B=385 | unchanged |
| W11 refuse ordinary billed edit/delete, linked job/customer deletion | N=B=385, rows unchanged | unchanged |

Nonbillable work is stamped on the statement but contributes zero. PDF has Tax 360, Payroll 25, Beginning Balance 0.00, New Charges 385.00 and Balance Due 385.00. Internal client with canonical account name `Clean Room CPA`, and a separate client marked nonbillable, each receives 60 minutes × 100: stored total/family 100, forced billable=false, N=B=0 even when caller asks for billable=true. Neither draws a selected retainer.

Expectation correction after first execution: the first test implementation said six stamped rows. There are **five** (three billable time, one flat, one nonbillable); deleting and re-entering a charge replaces a row rather than adding a second live charge. The hand-computed $385 and both family totals were unchanged.

CRUD control: an empty separate customer can be created/read/renamed/deleted; an unused job can be created/read/edited/deleted. Duplicate active customer name and duplicate active job type are refused. Foreign/absent references, invalid price/duration and protected related-row deletion are covered by R tests. Quarter-hour direct time without minutes is permitted: 0.25 × 75 = 18.75; with minutes=15 it must be 0.3 × 75 = 22.50.
