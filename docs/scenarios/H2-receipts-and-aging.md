# H2 hand-computed money and mistake oracles

These are independent expected amounts. Specs run only in `ds2_scenarios`; browser fixtures use account 9001 in `ds2_local`. Every refused API operation compares every table's row digest, including audit evidence, before and after.

| Scenario | Hand calculation |
|---|---|
| Three original invoices: $300, $450, $400; receipt $1,000 | Apply $300 + $450 + $250 = $1,000. Remaining balances: $0, $0, $150. Gross receipt $1,000; no held credit. |
| Same $1,150 debt; receipt $1,500 | Apply $300 + $450 + $400 = $1,150. Held credit $350; B = $0. Next new charge $500: raw N = $500, proposed credit use $350, invoice total $150. Final B = $150; credit use records no new cash. |
| Bounce the $1,500 receipt after its $350 credit was used | Reopen the original $300 + $450 + $400 and the new $500, retaining their original ages. B = $1,650; held credit $0. Original receipt/PDF unchanged; reversal applications total $1,500. |
| Jan 1 charge $100, Feb 1 charge $80, Mar 1 charge $50; March 15 payment $150 | At March 20: January $0, February $30 in 31–60 days, March $50 in 0–30 days. B = $80. Two newer statement rollovers never make February debt current. |
| Reverse that $150 payment | Original $100 / $80 / $50 restored. At March 20: 61–90 days = $100; 31–60 days = $80; 0–30 days = $50. B = $230. Before the reversal's effective date, or with a recorded cutoff before reversal, B = $80. |
| Boundary ages | Days 0 and 30 belong in 0–30; 31 and 60 in 31–60; 61 and 90 in 61–90; 91 in over 90. An unknown date stays in the unknown bucket. |
| Legacy carried balance $80; original charges $100 / $80 / $50 | Known total reductions are $150. Unless exact independent links prove otherwise, FIFO leaves February $30 and March $50. The source manifest labels this estimated historical allocation. No new receipt plugs a difference. |
| Legacy U and P cancel | Default B = $100, U = $100,000, P = −$100,000 gives N = $100. Tracker attribution to advisory leaves that business's B/U/P/N at $0. No historical work is held. |
| Genuine legacy advisory work of $200 after the last issued statement | Initially default U/N = $200 and advisory = $0. The candidate report makes no writes. A reasoned admin move gives default $0 and advisory U/N = $200. Reporting attribution is unchanged. |
| Post-cutover work | Missing manual business returns HTTP 400; unknown tracker business is held. Selecting or mapping a business permits posting only to that business. |
| Credit transferred between businesses | Receive $100 in A; transfer $40 then $10 to B. Held A = $50, B = $50; cash = $100. B's new $30 bill uses $30, leaving B credit $20. A whole-check bounce restores B debt $30 and cancels all held funds, preserving the original cash record. |
| Mistaken unissued cash receipt of $10 | Admin cancellation adds compensating events, leaves available funds $0 and makes no NSF claim. An identical retry writes nothing; reusing its key for changed input conflicts. |

API matrices cover nonpositive/fractional amounts, applied total above check, invoice cap, repeated invoice lines, wrong client/business/tenant, invalid/backdated/future dates, stale lists, double submit, duplicate checks, non-admin corrections/transfers, finalization locks, partial bounce, full reversal, and injected failures. Receipt headers and all applications remain atomic. The UI replaces the manual multiple-payment loop with editable oldest-first lines, an explicit remainder, review/confirm and a single pending submit. A stale response preserves the entered check and requires refresh.

Executable sources: `scenario-H2-receipts.integration.spec.js`, `scenario-H2-cutover.integration.spec.js`, `path-matrix-H2-receipts.integration.spec.js`, `path-matrix-H2-credit-transfers.integration.spec.js`, migration-H2 and receipt-values unit specs, frontend Payments/ReceiptCreditTransfer/AR/AuditPrint specs, and `e2e/tests/receive-payment.spec.js`. Accepted counts are recorded in [H2 results](../decisions/2026-09-26-run-H2-results.md).
