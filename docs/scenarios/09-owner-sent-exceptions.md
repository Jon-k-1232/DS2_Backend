# Owner decisions 3 and 5 — sent statements and bounced checks

Executable: `scenario-lifecycle-12-sent-exceptions.integration.spec.js`. Only ds2_scenarios and local MinIO. These are literal arithmetic oracles, not calculations copied from application helpers.

| Sequence | Issued evidence | Current billed / next bill |
|---|---|---|
| Work500, finalize first | parent500, original PDF500 | 500 / 500 |
| Receive100 after issue | original parent/PDF unchanged; child400 | 400 / 400 |
| Finalize next | second parent400; receipt locked; old chain closing child0 | 400 / 400 |
| Flag selected receipt | actor/time/reason/IDs recorded; ordinary edits still409 | 400 / 400 |
| Reverse | new positive100 receipt and child500; original unchanged | 500 / 500 |
| Issue revision1 | same invoice number, revised issued500; separate correction and unchanged original PDFs in revision ZIP | 500 / 500 |
| Next ordinary finalize | beginning500 once, no new charge | 500 / 500 |

A second story starts100, receives20+30, issues50, flags both, and restores100 atomically. Two flags race into one active exception; two reverse requests create one batch. If new work25 and a new125 statement arrive before resolution, revising the absorbed50 statement refuses; roll-forward resolution preserves125 without charging again.

All-surface story: retainer80, funded work30, ordinary work100 and hidden credit20 issue80 with held credit50. Every frozen work/retainer/credit/job deletion/move refuses with 409 and identical state. New funded work10 leaves80 due and40 held; new invoice credit5 yields75; pending approval20 yields55, always via new snapshots. Injected payment failure leaves pending approval unprocessed and balance75.

Overpayment story: issue100, receive150 → applied receipt100, child0 and excess retainer50. Next zero statement shows/locks that receipt and credit. A bounce restores100 debt and cancels50 unused credit by a new zero retainer snapshot; original receipt/retainer remain unchanged. Revision due100 explicitly reports cancelled50, with the exact original PDF enclosed. If10 of excess already funded work, reversal refuses atomically and the40 remaining credit is preserved.

Legacy story: reconstruct only synthetic pre-cutover artifact-bearing rows, remove new issue metadata with the fixture maintenance helper, and verify GET locks without backfilling anything. First explicit flag records `legacy_issue_recorded` with historical parent timestamp and current operator event. Reversal/revision retains the original artifact and legacy disclosure.

The boundary matrix covers four route authorization gates, strict IDs, missing/cross-tenant records, malformed conditions/reasons/payment selections/actions, unissued/child targets, retainer-funded/already-reversed receipts, unsupported transitions, cancellation, repeated resolutions, DB faults at each state/money/evidence write, read/upload/invalid-archive failures, direct SQL UPDATE/DELETE/import links, frozen GET row metadata, and preserved original bytes. Refusals compare full relevant ledger/evidence/pending state; every money transition checks Create Invoice, Audit and AR. Frontend tests cover selection, transitions, errors, current balance refresh, original/revision download, lock notices and payment picker latest-child semantics.

Job-only coverage issues100 work less20 on a separate credit-only job, receives10 on a separate payment-only job and issues70. HTTP moves/deletions and direct SQL writes for each protected family all refuse with409/P0409, preserve every row and retain N=B70. Root-only raw changes also check the entire version family.
