# O — job credits and invoice adjustments

Owner run1 update (2026-09-25): O03 now expects the sent-statement409 for printed/hidden credits. New credits still append balance snapshots and are counted once. Older issued parents remain unchanged.

Story: Two clients each receive 200 of tax work and a 30 job write-off before invoicing. B=0 and N=170. Hidden credit mode groups tax as 170 and write-off total 0; shown mode groups tax as 200 and separate write-off -30. Neither mode changes what is owed.

1. Hidden client: create job credit30 → N170; edit30→40 → N160; delete → N200; recreate30 → N170. Job-family stored work remains200 at every step.
2. Finalize hidden client 00001 = (0,170,0,0,0,170). Finalize shown client 00002 = (0,200,0,-30,0,170). PDFs must reflect their display mode and both show170 due.
3. Hidden client's invoice-linked credit20 → B=N150; edit latest20→25 →145; delete →170; recreate20 →150. Linked credit larger than150 is refused.
4. Attempt edit/delete a preinvoice credit behind the statement timestamp → refused. Attempt to move a job credit onto an invoice/customer → refused. Newer-event guards prevent editing/deleting an older credit.
5. Credit-only client: job credit40 without work → N=-40/B0. Finalize skips, consumes no invoice number and creates no statement. Add work60 → N20. Finalize00003=(0,20,0,0,0,20). A general credit with no job is likewise retained once.
6. A pending job write-off250 against only200 work is permitted → N=-50/B0 and finalization skips. An invoice-linked write-off250 against a200 statement is refused atomically.
7. On the hidden client, add new work50 to the same job after linked credit20: N200/B150 in shown and hidden modes. Next statement must carry150 and charge50, without applying the20 twice.

Signed write-offs, reason/date/ownership validation, single/list responses, amount-change/latest-child refusal, ledger rollback on injected database error and immutable billed credit are tested. Run 3 settles negative-credit finalization: skip by default, issue only when individually selected, and carry signed credit forward. See [credit statements](15-credit-statements.md).

PDF expectation clarification: a zero statement write-off contribution does not mean no revisions may be listed. The linked20 credit in step7 is shown as `Total Revisions: -20.00 (reflected in invoice balance)` even in hidden-job-credit mode. Its financial contribution remains zero because the150 beginning balance already includes it. The first added generic PDF assertion incorrectly required this section to be absent; it was replaced with this exact line and amount, consistent with the documented payment/write-off display rules. No monetary oracle changed.
