# H7 — both rounds of owner decisions in one client lifecycle

Hand oracle, written before execution. All figures are dollars. One synthetic client has Tax (A) and Advisory (B); these are managed businesses in `ds2_scenarios`, not account 1 in `ds2_local`. Existing H1–H5 oracles remain the detailed calendars, cutover, attribution and correction examples. This scenario joins their money paths rather than adding their test totals together.

`B` is issued debt, `N` includes unbilled work and pending adjustments before proposed receipt credit; held receipt money and retainers remain separate. Each step checks both businesses against Create Invoice, independent Account Audit, original obligations and AR. Preview is read-only, saved drafts are editable, and finalize captures immutable original evidence.

| Step | Calculation | A billed | B billed | Held receipt A / B | B retainer |
|---|---|---:|---:|---:|---:|
| A work and concession | 68 actual minutes round up to 72 billed minutes × $100/hour = $120; charge $80; concession $20. Draft $180, then issue. | 180 | 0 | 0 / 0 | 0 |
| B retainer | Receive $100; no bill or new AR. | 180 | 0 | 0 / 0 | 100 |
| A receipt | One check $250 pays original $180, leaves $70. | 0 | 0 | 70 / 0 | 100 |
| Explicit transfer | Move $40 of existing cash credit to B, no new receipt. | 0 | 0 | 30 / 40 | 100 |
| B work and recurring fee | Monthly fee $125; covered time $60 is nonbillable; excess charge $40 paid from retainer. N=$125; apply held $40 at issue. | 0 | 85 | 30 / 0 | 60 |
| Retainer events | Refund $20, then noncash increase $10; no AR effect. | 0 | 85 | 30 / 0 | 50 |
| A paid-invoice memo | Memo $20 becomes statement credit; original paid invoice stays frozen. | -20 | 85 | 30 / 0 | 50 |
| A refund | Return $10 of memo credit. | -10 | 85 | 30 / 0 | 50 |
| Optional credit statement | Default skip writes nothing; explicit selection issues -$10. | -10 | 85 | 30 / 0 | 50 |
| A later charge | -$10 + $50 = raw N $40; use held receipt $30 once. | 10 | 85 | 0 / 0 | 50 |
| B correction | Memo $15 reduces $85 to $70. Void original net charges $165 less memo $15; rebill $170. Existing $80 funding remains, so $170 - $80 = $90. | 10 | 90 | 0 / 0 | 50 |
| Full A check bounces | Restore its $180 direct application, $30 later A use and $40 B use. No partial reversal. | 220 | 130 | 0 / 0 | 50 |
| Resolve and collect | Roll forward adds no charge. New cash receipts $220 and $130 settle their own businesses. | 0 | 0 | 0 / 0 | 50 |

A's first invoice is aged 45 days before receiving the check; later statements cannot make its debt current. After the bounce, A has $180 in 31–60 days and $40 in 0–30; B has $130 in 0–30. Replaying the saved knowledge cutoff before the bounce must still show A $10/B $90. Original invoice rows and stored artifact bytes must remain unchanged through every correction.

Before the bounce, report gross issues $585 ($200 A + $165 B + $50 A + $170 replacement), prebill concessions $20, memos $35, voided net charges $150: **net billed $380**. Collections are $250 from the A check (including transferred/later credit) plus $40 retainer draw = **$290**; cash received is $250 + $100 = **$350** and cash returned is $10 memo refund + $20 retainer refund = **$30**. Noncash retainer increase is never cash. Debt is $380 − $290 + $10 returned statement credit = **$100**. Actual labor is 68/60 × $30 = $34 for A plus 36/60 × $30 = $18 covered effort for B: **$52**, unaffected by changing today's staff cost to $90. Final net margin before bounce is $380 − $52 = **$328**; supporting work must not duplicate on rebill.

The same client also exercises duplicate flag/dismiss/remove, an editable draft, a sent-work edit refusal, recurring retry/issued locks, wrong-business payment refusal, manager adjustment refusal, immutable Audit Record capture/verification, reason/session attribution and system recurring provenance. No email or scheduler is enabled. No approval workflow, period close, bank/online payment or interest calculation is introduced; the printed interest template stays unchanged.

Boundary oracles in `path-matrix-H7-boundaries.integration.spec.js`: null/scalar allocation and charge rows and array-shaped IDs return 400; impossible UTC calendar/time components and unsupported year zero in dates/timestamps return 400 rather than a database 500 or misleading empty report; valid year one and leap-day microseconds remain accepted. A correction cannot predate its original application; a retry against another receipt/application returns 409 while the same target replays exactly. Every rejection compares counts and full row digests for every public table, excluding nontransactional sequences. The separate [customer-form transport/double-click oracle](ui-mistakes.md#h7-customer-transport-and-repeated-click-oracle) covers the existing client screen repaired during full validation.
