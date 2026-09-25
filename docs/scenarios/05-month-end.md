# M — selective month-end, rolling debt, aging and deletion

Story: Month A gets100 work, Month B gets200 and Month Credit gets50 less a75 pending write-off. All billed balances start0. N values100,200,-25.

| Action | Expected |
|---|---|
| Finalize only A and Credit | A00001=(0,100,0,0,0,100); Credit skipped, B still unbilled200 |
| Same-day finalize A again | successful skipped result, no row/number/artifact |
| Same-day allowSameDayRebill A | 00002=(100,0,0,0,0,100), first chain closes with a new0 child/marker; issued parent100 retained |
| Advance31 days | A100 solely bucket31–60; B AR absent |
| Advance30 more days | A100 solely bucket61–90 |
| Advance30 more days | A100 solely over90; oldest-open work aged91 days |
| Pay40 on current A | B=N60 in over90 |
| Add A work25 today | N85/B60; pending work does not change AR |
| Finalize A and B | A00003=(60,25,0,0,0,85); B00004=(0,200,0,0,0,200) |
| After month2 | A85/B200 in0–30; older buckets0; old A current chain absorbed0 |
| Next-day/next cycle balance only | rolling beginning remains85, never sum historical100+100+85 |

Each statement verifies signed components, number, due date +16 days, PDF beginning/new-charge/payment lines, audit0 difference and aging. A's oldest partly-open charge remains the old100 charge because new25 alone does not cover85; B's200 work remains old although its first statement is today.

Deletion control: a separate issued zero/no-linked-work statement00005=(0,0,0,0,0,0) refuses deletion with409 and remains archived. A statement with work, children, absorbed source/target chains or nonzero beginning balance cannot be deleted; absent and foreign IDs cannot delete anything. Safe unissued empty-parent deletion remains covered separately; issued invoice numbers are retained.

Finalize failure matrix: invalid/empty/duplicate/foreign selection, missing mailing contact, numbered-series exhaustion, stale ledger fingerprint, concurrent same-day run, transaction/payment stamping races and injected precommit database/storage failures leave no new committed statement. Postcommit combined-export or register-refresh failure must report committed identities/warnings so a careless retry cannot duplicate a statement. See R tests and existing finalize regressions.
