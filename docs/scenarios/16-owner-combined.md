# All five owner decisions in one lifecycle

`test/integration/scenario-lifecycle-16-owner-combined.integration.spec.js` exercises real HTTP routes, local PostgreSQL and local MinIO. No external delivery occurs. Finalize is the owner's confirmed sent/lock boundary; drafts stay editable and write nothing to the ledger.

| Step | Hand calculation | Next statement | Billed / AR | Retainer available |
|---|---|---:|---:|---:|
| Work, retainer, funded work, finalize #1 | 300 + 100 work - 100 draw | 300 | 300 | 100 |
| Refuse an edit of sent work | Original evidence stays frozen | 300 | 300 | 100 |
| Enter duplicate $40 work twice | 300 + 40 + 40 | 380 | 300 | 100 |
| Review visible flag; remove second entry | 380 - 40 | 340 | 300 | 100 |
| Receive check $100 | Billed 300 - 100; new work40 | 240 | 200 | 100 |
| Finalize #2; receipt is frozen | 200 + 40 | 240 | 240 | 100 |
| Flag bounced check and reverse once | 240 + 100 | 340 | 340 | 100 |
| Resolve roll-forward, finalize #3 | Carry340; no extra charge | 340 | 340 | 100 |
| Refund retainer $40 | Available100 - 40; debt unchanged | 340 | 340 | 60 |
| Owner goodwill credit $400 | 340 - 400 | -60 | 340 | 60 |
| Skip credit statement | Pending credit/refund event retained | -60 | 340 | 60 |
| Select credit statement; finalize #4 | Carry340 - 400 | -60 | -60 | 60 |
| New work $80; finalize #5 | Carry-60 + 80 | 20 | 20 | 60 |

Every transition checks engine, independent saved Account Audit and AR with zero differences in their common billed component. The test also verifies no writes on the locked edit/skip, duplicate visibility and removal history, exception transitions, printed refund evidence, no payment due on the credit PDF, and unchanged archived bytes for the earlier three issued statements. Retainer cash availability remains separate from debt. Scenario12 separately covers the reprint/resend revision option; scenario15 covers credit becoming debt after an NSF correction.

Run4 implements decision6 in [scenario18](18-audit-record.md). This combined lifecycle retains its per-feature actor/reason/history assertions; the shared HTTP helper now verifies captured request actors too.
