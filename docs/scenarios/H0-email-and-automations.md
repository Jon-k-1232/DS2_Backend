# H0 — email and scheduled automation expectations

These are local, synthetic expectations for [item1 of the integrated design](../decisions/2026-09-26-owner-requests-2.md#1-h0--email-and-automation-switches). There is no financial migration or new screen. Monetary scenario oracles remain unchanged. Actual counts and final validation are recorded in [H0 results](../decisions/2026-09-26-run-H0-results.md).

## Switch truth table

Both SEND_REAL_EMAIL and RUN_SCHEDULED_AUTOMATIONS follow the same exact-string rule independently:

| NODE_ENV | absent | true | false | empty, uppercase, whitespace, numeric or other text |
|---|---|---|---|---|
| production | on | on | off | on |
| development/test/staging/unset | off | on | off | off |

Changing SEND_REAL_EMAIL to false after an enabled send must still suppress the next attempt, even with a cached client. Scheduler off must register **zero** jobs in app startup and in a direct orchestrator call. Scheduler on registers the three existing Phoenix schedules; callbacks retain the existing reminder calls. The switch is a process setting, not an account preference. Tests stub scheduling before opting in and never start a real timer.

## Email caller matrix

`test/email-switches.spec.js` runs each actual caller with the actual sender twice, once off and once on with a stubbed SES implementation. Only synthetic `example.invalid` recipients are used.

| Caller | Expected subject fragment | Off | On, stubbed |
|---|---|---|---|
| tracker validation success | Time Tracker Ready for Billing | one suppression, zero SES clients/sends | one SES send |
| tracker validation failure | Time Tracker Validation Failed | same | same |
| tracker upload system error | Time Tracker Upload Error | same | same |
| Thursday reminder | due tomorrow | same | same |
| Friday reminder | due today | same | same |
| missing tracker reminder | Submit last week's | same | same |
| processed-timesheet success | Timesheet Processed Successfully | same | same |
| automation failure | DS2 Automation Error | same | same |

Off returns normally without FROM_EMAIL or AWS credentials. One structured log records subject, normalized to/cc/bcc and a valid UTC timestamp, without message bodies. Callers must not claim delivery in their completion logs. Invalid empty recipients/subject remain errors with zero SES construction and no outbox files. On retains the original Source/Destination/text/HTML/UTF-8 payload and SES MessageId/error contract; missing FROM_EMAIL refuses before constructing SES.

## Outbox and unhappy paths

- Unset EMAIL_OUTBOX_DIR: normal suppressed result, no disk write.
- Configured directory: one unique JSON file per attempt containing subject, recipients, text/HTML, timestamp and attachment metadata only. Directory0700/file0600 when created. Eight simultaneous attempts produce eight parseable distinct files. Subject text cannot choose the path. Existing files are not overwritten (`wx`).
- Directory creation or file-write failure: warning with suppression identity; still normal suppressed result with null outboxPath and zero SES construction. Never retry delivery because local recording failed.
- Enabled sending with an outbox path: SES stub receives one request; directory stays empty. Attachments retain the existing unsupported warning and are never silently delivered.
- Stubbed SES rejection while enabled: propagate the sender failure; existing caller-specific best-effort handling remains. No fallback transport.

`path-matrix-15-defensive-faults` preserves the enabled/missing-sender refusal and adds disabled/missing-sender success, asserting **every database table including audit evidence** is unchanged. `path-matrix-07-tracker-storage` explicitly enables email only after stubbing SES so its three upload/error-notification failure injections still reach the intended boundary. Their original rollback/committed-upload assertions remain. The tracker Excel end-to-end suite also opts in only after its SES capture stub is installed, preserving its notice-payload assertion. General test setup forces both switches false; scoped tests restore them.

## Existing behavior preserved

No route status/body, screen, financial record, immutable PDF, six-minute calculation, scheduler cadence or account recipient rule changes. Tracker upload remains201 after a committed upload even if its best-effort notices fail. Failed upload leaves no rows or owned file after normal cleanup. All existing lifecycle, route matrix, frontend Jest and full Playwright tests run in addition to the focused tests; passing switch tests alone is not full acceptance.
