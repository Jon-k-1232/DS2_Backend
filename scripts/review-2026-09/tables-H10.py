"""Write H10 measurements from retained evidence, without hand-transcribing timings."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[2];base=root/'docs/decisions/evidence/run-H10'
read=lambda name:json.loads((base/name).read_text())
before,after=read('before.json'),read('after.json')
s='## Before and after\n\nComplete HTTP responses, default business, median of three samples (milliseconds):\n\n| Read path | Before | After | After bytes |\n|---|---:|---:|---:|\n'
labels={'createInvoices':'Create invoices balances','recurringDue':'Recurring due preview','ar':'Accounts receivable','auditList':'Account Audit list','customerProfile':'Largest full client profile history','billingPerformance':'Billing performance','clientRates':'Client rates','timeAllocation':'Time allocation','wipAging':'WIP aging','jobBudgets':'Job budgets','taxSeasonCapacity':'Tax capacity','yearEndPacket':'Year-end packet'}
for k,label in labels.items():
 a,b=before['http'][k],after['http'][k];s+=f"| {label} | {a['medianMs']:,.1f} | {b['medianMs']:,.1f} | {b['samples'][1]['bytes']:,} |\n"
s+='\nInstrumented read/compute phases (milliseconds and business-query counts, excluding context-setting statements):\n\n| Phase | Before ms | After ms | Queries before → after |\n|---|---:|---:|---:|\n'
for k,label in [('recurringDuePreview','Recurring due/read'),('invoiceEligibility','Invoice eligibility'),('invoiceInputs','Invoice input evidence,310 clients'),('invoiceCalculation','Pure invoice arithmetic'),('previewSnapshot','Full preview snapshot and fingerprints'),('auditList','Audit list service, default options'),('auditRunAllClients','Audit independent calculation,338 clients'),('arAging','AR all-client calculation'),*[(n,n[3:])for n in ['getBillingPerformance','getClientRates','getTimeAllocation','getWipAging','getJobBudgets','getTaxSeasonCapacity']]]:
 a,b=before['phases'][k],after['phases'][k];s+=f"| {label} | {a['elapsedMs']:,.1f} | {b['elapsedMs']:,.1f} | {a['queryCount']:,} → {b['queryCount']:,} |\n"
s+='\nAudit service/default options and the HTTP list are different workloads; compare each only within its own row. Audit calculation above excludes saved results, narrative and storage. The account-wide arithmetic is unchanged.\n'
if (base/'profile-balances.json').exists():
 p=read('profile-balances.json');s+='\nSupplemental profile calculation replay on the unchanged largest client, original readers/views versus current readers (not a pre-change browser recording):\n\n| Profile calculation | Original ms | Current ms | Queries original → current |\n|---|---:|---:|---:|\n'
 for k,label in [('allBusinessBalances','All-business profile balances'),('singleBusinessCalculation','Selected-business invoice calculation')]:
  a,b=p['before'][k],p['after'][k];s+=f"| {label} | {a['medianMs']:,.1f} | {b['medianMs']:,.1f} | {a['queries']} → {b['queries']} |\n"
 a,b=p['before']['auditRunReadPhase'],p['after']['auditRunReadPhase'];s+=f"| Complete Audit read phase,338 clients (one sample) | {a['elapsedMs']:,.1f} | {b['elapsedMs']:,.1f} | {a['queries']:,} → {b['queries']:,} |\n"
 s+='\nOriginal and current calculation data are equal; only Audit generated_at (the execution timestamp) is excluded in this supplementary replay. Complete Audit reads include its independent raw ledger, per-client engine cross-check/savepoint and receivables section; narrative/PDF/persistence remain excluded. This isolates balances from the unchanged67MB client-history transfer; it sends no profile preparation/finalization POST.\n'
if (base/'browser-budgets.json').exists():
 s+='\nActual browser data readiness after navigation in an already loaded workspace, median of three measured runs after one warmup:\n\n| Page | First correct data ms | All balances/controls ms | Target ms |\n|---|---:|---:|---:|\n'
 for b in read('browser-budgets.json'):
  s+=f"| {b['name']} | {b['firstRowsMedianMs']:,} | {b['allReadyMedianMs']:,} | {b['budget']:,}"+(' first /1,500 complete'if b['name']=='create'else'')+' |\n'
if (base/'h9-browser-regression.json').exists():
 old=read('retained-H9/browser-after.json');new=read('h9-browser-regression.json');a=next(r for r in old if r['name']=='Create invoices data ready');b=next(r for r in new if r['name']=='Create invoices data ready')
 s+=f"\nSeparate cold-page comparison from the unchanged H9 browser test: actual Create Invoice rows and enabled controls **{a['interactiveMs']:,} → {b['interactiveMs']:,}ms**. This includes document/bootstrap/chunk startup and is not the loaded-workspace budget above. Cold startup remains visible; no skeleton timing is substituted for balance readiness.\n"
if (base/'query-plans-preview.json').exists():
 p=read('query-plans-preview.json');s+='\nEXPLAIN ANALYZE, database execution milliseconds:\n\n| Equivalent query | Original function view | Joined reporting view |\n|---|---:|---:|\n'
 for label,a,b in [('Eligible work','originalFunctionWorkView','batchedWorkView'),('Jobs','originalFunctionJobView','batchedJobView')]:
  s+=f"| {label} | {p['plans'][a][0]['Execution Time']:,.3f} | {p['plans'][b][0]['Execution Time']:,.3f} |\n"
 q=p['preview'];s+=f"\nPreview output: {q['clients']} clients; detail assembly {q['detailsMs']:,.1f}ms; CSV {q['csvMs']:,.1f}ms ({q['csvBytes']:,} bytes); {q['pdfs']} PDFs rendered in memory in {q['pdfMs']:,.1f}ms ({q['pdfBytes']:,} bytes). No upload/finalize or external storage call.\n"
if (base/'recurring-prepare.json').exists():
 s+='\nReal recurring preparation on eight synthetic plans: '+ '; '.join(f"{r['label']}: {r['elapsedMs']:,.1f}ms, {r['generated']} generated"for r in read('recurring-prepare.json'))+'. Protected account1 uses the due preview only.\n'
s+='\nRaw samples, individual query families, source digests and complete plans are retained in [H10 evidence](evidence/run-H10/README.md). No cross-request cache is used.\n\n'
p=root/'docs/decisions/2026-09-26-run-H10-results.md';text=p.read_text();start=text.index('## Before and after');end=text.index('## Dominant costs');p.write_text(text[:start]+s+text[end:])
