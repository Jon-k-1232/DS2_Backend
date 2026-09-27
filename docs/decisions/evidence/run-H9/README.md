# H9 evidence

`final-command-results.json`, `integration-counts.json`, `playwright-summary.json`, `accepted-summary.json`, `account1-verification.json` and `drift.json` are the final acceptance records once the complete run finishes. Earlier failing and interrupted logs are retained separately and are not acceptance results.

`run-required-checks.py` preserves the executed sequential command recipe, with its ordinary-file runner path changed from the original temporary file to the sibling `run-ordinary-integrations.py` for reproduction. It uses the authorized local databases and external browser server. Use one test process at a time. The managed frontend/backend and browser server must already be running; this recipe does not start them. It overwrites the final logs, so preserve an earlier evidence copy before repeating a review. The final protected-data check connects only to ds2_local.

`baseline.json` is the original captured payload/main-bundle and source/reference census. The initial reference census read violated the no-reference-access instruction; it was read-only and was reported to Jon. Do not connect to the reference database to repeat it. Use the retained counts and hashes instead. The temporary baseline script was blocked from rerunning.

`api-after.json` contains local read-only HTTP samples, actual EXPLAIN ANALYZE plans, parameters and index definitions. Reproduce with `node scripts/review-2026-09/measure-H9.js` from the backend, outside another timed test. `budgets.json` is produced by the read-only performance integration spec. `api-before-scoped-query-fix.json` and `api-before-cycle-query-fix.json` preserve the intermediate slow queries.

`bundle-after.json` contains every built JavaScript file, its raw/default-gzip byte count, and the manifest's initial entrypoints. `browser-before.json` and `browser-after.json` record local development-server readiness and API request inventories; the report explains their limits. Reproduce the built bundle inventory after the frontend build with `node docs/decisions/evidence/run-H9/measure-built-bundle.js` from the backend. The browser performance spec never issues/prepares account-1 invoices: the separate balance-ready case substitutes preparation with the real read-only recurring due preview.

Migration logs show 047 applied individually to the three local databases. It adds five indexes and changes no business or audit rows. `graphify.log` records the offline, code-only graph refresh with zero model calls. The [results](../../2026-09-26-run-H9-results.md) explain the final behavior, counts, calendar repairs and future rollout.

`commands-before-search-reset.json` and `playwright-before-search-reset.log` preserve the completed 267/268 browser pass that exposed an obsolete retainer failure interceptor. Its exact trace is in `retainer-projection-interceptor-failure/`. The corrected projection interceptor and client-switch search reset pass the two focused checks in `scope-projection-final-focused.log`, followed by the final full suite. Focused checks do not add to the distinct-test count.

`playwright-before-inline-client-fix.log` preserves the interrupted rerun stopped after discovering the inline review client picker gap. The two earlier focused guards pass in `scope-projection-final-focused.log`; that combined run also caught a duplicate error-text locator in the new inline test. The corrected inline-review error/retry money oracle passes in `inline-review-focused-playwright.log`; the final full suite contains 269 tests.

The Obsidian documentation mirror links non-Markdown H9 evidence back to these source files using relative filesystem links, avoiding a second copy of traces and raw logs while keeping the results links usable.

`playwright-before-invoice-wait-fix.log` and `invoice-wait-failure/` preserve the completed 268/269 run that hit several outgoing-grid lock labels during lazy navigation. The helper now awaits the selected invoice’s lock alert by invoice number. `invoice-wait-recheck.log` contains three focused repetitions with all reversal, revision and archived-byte assertions retained. Final acceptance still requires the full suite.
