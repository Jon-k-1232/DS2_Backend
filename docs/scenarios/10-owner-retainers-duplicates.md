# Owner run 2: retainer events and duplicate review

Run alone on ds2_scenarios via `.env.scenarios` or `npm run -s test:scenarios`. Rebuild includes migration 024; all fixture events remain local. State-refusal assertions hash retainer_events, duplicate_flags/history and all original financial/customer tables before/after.

| Retainer step | Available credit | Next debt / billed debt | Evidence |
|---|---:|---:|---|
| Receipt 500; fund 120 work | 380 | 0 / 0 | Auto payment -120; first bill charges120/payments-120/held-380/due0 |
| Refund 80 | 300 | 0 / 0 | Actual session actor, method/reference/date/reason |
| Adjustment increase50 | 350 | 0 / 0 | Negative stored delta -50 |
| Adjustment decrease30 | 320 | 0 / 0 | Positive stored delta +30; total drawn remains120 |
| Next statement | 320 | 0 / 0 | Prints all three events once; original PDF unchanged |
| Refund all320 | 0 | 0 / 0 | Full refund prints even with zero retainer records |
| Increase50; race two40 refunds | 10 | 0 / 0 | One success, one409; no overdraft |
| Race10 draw vs10 refund | 0 | 0 / 0 | Exactly one wins; immutable event evidence survives |

The auxiliary pending-event chain (5 receipt then full5 refund) proves unsent journal-chain edits/deletion refuse; cancelled5 and overflow fixtures never revive funds. Invalid amounts/date/reasons/evidence/IDs, roles/accounts, missing roots, insufficient availability, write failures and history read failure commit nothing. Failed statement storage leaves pending events untouched. The PDF assertions parse actual local MinIO artifacts and customer statements.

| Duplicate step | Hand expectation |
|---|---|
| Two matching100 work entries | Next200/billed0; visible flag, actor/reason history |
| Dismiss + rescan | Same200; resolved pair not recreated |
| Manually flag and remove copy | Next100/billed0; job total100 |
| Add900 work; issue1000; receive100 twice | Debt800; same check reference flags second receipt |
| Remove second receipt | Debt900; original issued1000 immutable |
| Enter20 write-off twice; remove one | Next860 then880; billed900 |
| Enter200 retainer twice; remove one | Held400 then200; debt remains880/900 |
| Historical same100 work pairs + concurrent scans | Three unique pairs; removal closes all reviews for removed source; ordinary deletion restores job1000 |
| Flag sent work | Remove409; dismiss allowed; original invoice unchanged |

New-route refusal matrix includes malformed kind/IDs/action/filter/reason, self-reference, wrong customer/account/role, missing records, repeated/reversed pairs, used retainer/newer-payment dependency, and sent lock. Faults cover every evidence write and actual source deletion; all four manual creation hooks roll back the entire financial posting if flag-history insertion fails. History SQL rewrite is refused. Supplemental unit matching tests separate nonmatches from plausible candidates. Frontend Jest verifies confirmations, reason gating, success/error refresh, locked/missing actions and visible grid badges.

Exact acceptance counts and any limits are in [run 2 results](../decisions/2026-09-25-run-2-results.md).

Additional boundary coverage: positive/inactive retainer states and cross-customer chains refuse without writes. A concurrent $10 refund on a $100 retainer invalidates a pre-priced $50 statement; retry issues $50 due with $90 held, and audit/AR/engine agree. A maximum-length unbroken reason spans PDF pages without lost text or duplicate amounts. Changed-source duplicate reviews require dismissal and explicit fresh review; reopening preserves prior history and rolls back on each rejected/suppressed evidence write. Retainer balance snapshots cannot be flagged as source receipts.
