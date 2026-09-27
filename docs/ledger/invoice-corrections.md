# Credit memos, void and rebill, and client refunds

**H6 navigation:** Billing → Credit memos: `/billing/credit-memos`; invoice corrections: `/billing/invoices/:invoiceId`; Payments & Credits → Client credits and Refund history. [Route/permission and bookmark rules](../platform/workspace-navigation.md).

H3 implements the owner's correction decision. Only `admin` and `super admin`, matched case-insensitively by `requireAdmin`, may apply a correction. One admin acts alone; there is no approval or period-close workflow. Existing read access stays in place. Managers can inspect records and download documents but see an explanation instead of adjustment controls. Existing employee financial-page restrictions remain unchanged; shared read-only views never gain an adjustment control.

## Credit a finalized invoice

Open an invoice, choose **Credit memo**, enter a positive amount and reason, review, then finalize. The memo locks immediately. It reduces that original invoice's open obligation first. A paid portion requires explicit confirmation (`allowCreditExcess:true`) and creates noncash client credit. Cumulative unreversed memos cannot exceed the original **new net charges**, excluding its beginning balance. Optional API line allocations must identify source work on that invoice and sum exactly to the memo amount; cumulative line credits cannot exceed that line.

The original invoice and PDF remain byte-for-byte preserved. The memo has its own number and hash-verified PDF. Correct a mistaken memo through **Transactions → Credit memos → Reverse memo**, with a new reason; the linked compensating PDF and original memo both remain retrievable. Refunded or consumed memo credit prevents reversal. No memo is also entered as a payment or write-off.

## Void and rebill

Open the original finalized invoice, choose **Void and rebill**, select the corrected business, enter corrected charge descriptions/amounts and reason, then review the signed impact before finalizing. This issues a replacement with a new number and PDF and creates an immutable void record/PDF. The source row, original issue payload, original PDF, time/work rows and later issued statements are preserved. Original and replacement links remain on invoice detail; **Original — void** is a derived status, not an edit of issued evidence.

Reverse only the original's remaining uncredited new charges, never its brought-forward debt. A prior memo remains in evidence and is reconciled once. Payments are traced, reversed as applications, released as credit and reapplied to the corrected bill; no second receipt is created. Corrected charge lines live in the replacement's frozen issue payload and `rebill_links`, with the original source evidence. Do not sum them as new employee work or labor cost.

For a different business, cash stays in its source business unless the admin explicitly checks **Transfer released receipt credit**. The preview includes source/target balances, released funds, transferred funds and funds applied. Without a transfer, gross billed debt may rise while source held credit rises equally; aggregate debt **less held funds** changes only by the corrected charge delta. Both businesses remain separately reconciled. This clarifies the design's earlier unqualified aggregate-debt rule.

Later/absorbed originals correct the current statement carrier using append-only children. Already-void, unissued, zero/unsupported source basis, used/refunded source-credit dependencies, unresolved bounced checks, foreign work/business, and stale previews refuse. For reconstructed pre-cutover invoices, a reduced opening may lack reversible payment lineage; those void/rebill previews refuse with a reconciliation explanation rather than manufacture historical cash. Credit memos still use the known original charge cap and current open amount. No general unlock exists. A replacement is immediately sent and locked.

## Return client money

Use **Transactions → Client credits**, choose the client and business, select an available credit, enter positive amount/date/method/reference/reason, review the remaining credit, and record the refund. A cash refund needs no reference; check/other requires one. Dates cannot be future or precede the source. Refund history retains the source lot and a hash-verified PDF.

Returning unused receipt funds reduces held credit without changing AR. Returning an issued negative statement balance moves that balance toward zero without opening unrelated obligations. Retainer refunds still use the existing retainer events; these flows do not post twice. There is no bank integration or payment execution: the record documents money already returned. Receipt conservation is `applied + held + returned = received`. A bounced receipt whose funds were refunded refuses reversal until the dependency is reconciled; the system never silently deletes returned money.

## API and consistency

All routes are authenticated, scoped from the session account, and use real HTTP status codes. Financial writes require a UUID `Idempotency-Key`, nonempty reason (up to 2,000 characters), entity and a current ledger fingerprint; void commits use the preview fingerprint instead. Same-key/same-body replays the original result; changed input under a key or changed ledger returns409. Money uses integer cents. Account/customer advisory locks and database transactions serialize concurrent posting. Artifact creation precedes posting commit; storage/DB failure leaves financial rows and audit events unchanged. A late database rollback can leave an unreferenced private object, never an issued document or financial entry.

| Method | Route | Input / result |
|---|---|---|
| GET | `/invoices/:invoiceID/corrections` | Original, entity, open/cappable amounts, memos, void/replacement, fingerprint |
| POST | `/invoices/:invoiceID/credit-memos` | `entityId,amount,reason,date?,allowCreditExcess?,lines?,ledgerFingerprint` |
| POST | `/invoices/:invoiceID/void-rebill/preview` | `entityId,replacementEntityId,reason,date?,lines,transferReleasedCredit?`; read-only impact/fingerprint |
| POST | `/invoices/:invoiceID/void-rebill` | Preview inputs plus `previewFingerprint`; finalized replacement/void |
| GET | `/credit-memos` | `page,limit,customerId?,entityId?`; paged register |
| GET | `/credit-memos/:recordID` | Memo, lines and reversals |
| GET | `/credit-memos/:recordID/pdf` | Verified original memo PDF |
| POST | `/credit-memos/:memoID/reversals` | `entityId,reason,date?,ledgerFingerprint`; immutable reversal |
| GET | `/credit-memos/reversals/:recordID/pdf` | Verified compensating PDF |
| GET | `/credits/:creditID/refundable` | Source credit, remaining amount and fingerprint |
| POST | `/credits/:creditID/refunds` | `entityId,amount,date,method,reference?,reason,ledgerFingerprint` |
| GET | `/refunds` | Same register pagination/filter contract |
| GET | `/refunds/:recordID` | Immutable refund/source metadata |
| GET | `/refunds/:recordID/pdf` | Verified refund PDF |
| GET | `/invoice-voids/:recordID/pdf` | Verified void PDF; original/replacement archive uses existing invoice download |

Authority is checked before business/form validation for adjustment paths, so nonadmins get403 even with an invalid business selection. Validation returns400, authentication401, authority403, unknown/foreign source404, stale/locked/conflict409, infrastructure failure500. Every POST above is admin-only, including read-only void preview. GET routes preserve existing manager-level financial access. The private artifact routes enforce account ownership and SHA-256 before returning bytes.

## Statements, audit and storage

Seven audited append-only tables in migration042: `credit_memos`, `credit_memo_lines`, `credit_memo_reversals`, `invoice_voids`, `rebill_links`, `client_refunds`, `correction_postings`. Every new posting records the session actor/reason. No scheduled automation is introduced. New source tables have ownership guards, mutation/truncate guards, audit triggers and scoped indexes. Statement membership freezes the included correction rows. Subsequent PDFs show previously unprinted correction documents once; the informational rows never add the money again. The printed interest line is unchanged.

`correction_postings` changes the latest child on a current entity-scoped carrier, preserving balance-forward and absorption. Original obligation dates remain the aging basis. Account Audit and Audit Record show the correcting events and money returned; statements, AR and Create Invoice read the same corrected balances. Audit Record raw evidence includes every correction table and replay is deterministic.

Implementation: `src/endpoints/corrections/`; UI: `src/Pages/Corrections/`. See [hand-computed scenarios](../scenarios/H3-corrections.md), [results](../decisions/2026-09-26-run-H3-results.md), and [rollout](../platform/operations.md).

## H5 reporting

Net billed deducts effective credit memos/voided new charge components, adds memo reversals and counts replacement issues once. The work/cost cohort retains original identity across void/rebill, so repricing does not invent another time entry or cash receipt. Refunds are cash returned, and bad-debt write-offs remain separate from concessions and memo credits. H3's admin-only guard is unchanged. [Analytics formulas and oracles](../invoicing/analytics.md).

## H7 correction regressions

Malformed/null charge-line objects return 400 with no money, artifact metadata, audit or retry rows committed. Void/rebill retains original application lineage for reporting: a released cash-backed retainer draw remains cash-backed when applied to the replacement, including mixed funding and repeated replacements. This is a report reconstruction fix; no issued record or cash entry changes. Source fixed/recurring fee values belong to the surviving cohort once. [Combined oracle](../scenarios/H7-combined-lifecycle.md), [path evidence](../scenarios/round2-path-matrix.md).

## H8 readable history and readiness

The credit-memo register includes **Issued / Reversed** status, unbroken document numbers, named staff actors, loading, useful empty states and read-error retry. Reversal review blocks another selection until the selected memo and its balance read finish. A rejected post retains its input. Invoice memo history and refund registers use the same staff-name presentation; IDs are available in tooltips.

Correction list/detail and invoice-correction context responses add `actor_name` at read time from the same account's users, including inactive staff. These labels never enter stored correction documents, money calculations or ledger fingerprints. Missing identities say **Name not recorded** (or **System** for an absent staff actor); no other tenant's user can supply the name. The [page help](../platform/page-help.md) explains lower billed revenue versus cash, paid excess credit and linked reversals.
