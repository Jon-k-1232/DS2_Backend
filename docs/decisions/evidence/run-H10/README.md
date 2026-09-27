# H10 local performance and acceptance evidence

All financial measurements use only local ds2_local account1 in read-only mode, or synthetic ds2_scenarios/ds2_clean/account9001 fixtures. No reference-database, production, AWS, real-email or deployment action.

- `before.json`: immutable pre-H10 complete HTTP/phase/query counts and protected row hashes.
- `after.json`: final repeat of the same measurement script, plus all raw samples. Earlier after samples remain named separately when refreshed.
- `budgets-equivalence.json`: nineteen account-scale tests;2070 full equivalence entries (2028 invoice calculations, six input/eligibility comparisons, eight complete scoped view sets, four current/historical AR reports and24 analytics reports).
- `browser-budgets.json`: nine actual-row readiness budgets, with warmup and all three samples. `h9-browser-regression.json` additionally records cold-page startup.
- `query-plans-preview.json`: EXPLAIN ANALYZE/BUFFERS for original and joined views, available indexes and310 in-memory invoice PDF/CSV renders.
- `profile-balances.json`: supplementary profile balance replay of original readers/views and current readers against unchanged data.
- `recurring-prepare.json`: eight synthetic monthly plans; generate once and no-op replay.
- `validation-commands.json`: append-only attempts with command, environment, duration, exit and Mocha counts. `final-acceptance.json` selects only final accepted results and summarizes Jest/pytest/Playwright separately. The scenario log runs each file in its own process, serially.
- `migration-048-*.log`, `migration-049-*.log`: six manual local applications. No source/audit row/backfill effects.
- `drift.json`, `account1-after.json`, `account1-verification.json`: final independent drift,12 source/audit table fingerprints, seven retained reference counts and complete audit-chain verification.
- `retained-H9/`: exact historical H9 artifacts saved before its regression tests overwrite their default output paths; originals are restored after preserving the current H10 recheck.

Exploratory and failing-first logs remain for review. Only accepted zero-exit runs count toward completion; prior attempts and focused repetitions are not added to final totals. The docs mirror copies Markdown and sample PDFs, leaving raw logs/JSON here.
