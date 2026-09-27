# H10 — batched reads preserve the financial lifecycle

Run `DS2_ENV_FILE=.env.scenarios node_modules/.bin/mocha --require test/setup.js test/integration/scenario-H10-equivalence.integration.spec.js --exit --timeout 180000`. Its reset rebuilds only ds2_scenarios; account1 here is synthetic. Account-scale equivalence/budgets use ds2_local account1 read-only. No preparation/finalize POST is sent to protected account1.

## Hand oracle

One client has businesses A and B. No prior balance, retainer or credit. Dollar amounts below are independently specified.

| Event | A billed debt | A next statement | A available held credit | B billed debt / next statement |
|---|---:|---:|---:|---:|
| Enter A100 and B40 work | 0 | 100 | 0 | 0 /40 |
| Finalize each business | 100 | 100 | 0 | 40 /40 |
| Receive A130; allocate100 | 0 | 0 | 30 | 40 /40 |
| Enter A50 new work | 0 | 20 | 30 | 40 /40 |
| Admin credits B10 | 0 | 20 | 30 | 30 /30 |
| Finalize A again explicitly | 20 | 20 | 0 | 30 /30 |

At every stage compare complete new/original invoice inputs and receipt states for every client in both businesses, independently check AR billed debt, and assert no read changed any table or audit event. Fingerprints stay on command reads; reporting equality excludes only that unused command token. The next A finalize consumes30 exactly once. The B memo never moves A cash.

Eight other synthetic clients receive monthly10 plans due today. Real prepare creates eight ordinary charge occurrences (80 total); the second prepare creates zero. This is the preparation timing oracle without writing protected account1. Original, optimized and shared-snapshot analytics produce identical response JSON after financial events.

## Refusals and existing mistake coverage

Inject failures in statement evidence, batched AR, analytics snapshot and packet snapshot. Each route returns500 with the existing message and all business/audit rows unchanged. Wrong account403, unknown business404 and forbidden staff403 also leave all rows unchanged. The full H2/H3/H4/H7 path suites retain wrong-invoice/entity, over-application, stale/double submit, finalization locks, correction permissions and database/storage failure coverage. No screen or command contract is removed or replaced.

Migration tests exercise UPDATE, NO KEY UPDATE, SHARE and KEY SHARE row locks through the normal scoped query path. Another transaction's UPDATE NOWAIT must fail55P03 against the physical work/job row. Joined reporting views are never used for locking reads.

## Account-scale acceptance

`performance-H10.integration.spec.js` covers all338 protected clients × three businesses × two write-off display modes, complete original/new view rows, historical/current AR and six analytics reports. Data-dependent budget tests may skip only when the account-scale dataset is absent; it is present on this machine, so acceptance requires zero skips. Playwright's nine page budgets use real GET data after workspace navigation, with a single warmup and three measured runs; all three samples and medians are retained. First Create Invoice rows must appear within1,000ms, all balances/controls within1,500ms; AR1,000ms, Audit list1,500ms, every analytics page2,000ms.

SQL unordered sets are compared as deterministic canonical JSON bytes; ordered public report responses are also compared without normalization. No value/type/decimal/record may differ. The independently computed engine/Audit/AR drift must remain0. See [H10 results](../decisions/2026-09-26-run-H10-results.md) for exact final counts and timings.
