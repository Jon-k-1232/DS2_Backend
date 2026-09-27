"""Record local source scope and verify the documentation mirror after H6."""
from pathlib import Path
import hashlib,json,re,sys
here=Path(__file__).resolve().parent
backend=here.parents[3]
root=backend.parent
before=json.loads((here/'source-before.json').read_text())
roots=['DS2_Backend/src','DS2_Backend/test','DS2_Backend/scripts','DS2_Backend/migrations','DS2_Frontend/src','DS2_Frontend/e2e/tests','DS2_Frontend/e2e/lib']
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for scope in roots for p in (root/scope).rglob('*') if p.is_file() and p.suffix in ['.js','.json','.py','.sql','.sh']}
changed=[{'path':name,'before':before.get(name),'after':files.get(name)} for name in sorted(set(before)|set(files)) if before.get(name)!=files.get(name)]
assert not any(r['path'].startswith(('DS2_Backend/src/','DS2_Backend/test/','DS2_Backend/migrations/')) for r in changed), 'Unexpected backend runtime/test/migration change'
(here/'source-changes.json').write_text(json.dumps({'changed_or_added':len(changed),'backend_runtime_changes':0,'changes':changed},indent=2)+'\n')
if '--source-only' in sys.argv:
 print(json.dumps({'changed_or_added_source_files':len(changed),'backend_runtime_changes':0}))
 raise SystemExit(0)
frozen=json.loads((here/'source-at-final-browser.json').read_text())
assert frozen['changes']==changed, 'Source changed during final browser acceptance'
vault=root/'DS2_Notes'
notes=[p for p in (backend/'docs').rglob('*') if p.is_file() and p.suffix in ['.md','.pdf']]
mismatch=[str(p.relative_to(backend)) for p in notes if not (vault/'Documentation'/p.relative_to(backend/'docs')).exists() or p.read_bytes()!=(vault/'Documentation'/p.relative_to(backend/'docs')).read_bytes()]
for source,target in [(root/'MEMORY.md',vault/'Change Log.md'),(backend/'scripts/review-2026-09/FINAL_REPORT.md',vault/'Reports/Full Review 2026-09.md')]:
 if source.read_bytes()!=target.read_bytes():mismatch.append(str(source))
assert not mismatch,mismatch
h6notes=[backend/'docs/platform/workspace-navigation.md',backend/'docs/scenarios/H6-navigation.md',backend/'docs/decisions/2026-09-26-run-H6-results.md']
missing=[]
for source in h6notes:
 for target in re.findall(r'\[[^]]+\]\(([^)]+)\)',source.read_text()):
  target=target.split('#')[0]
  if target and '://' not in target and not (source.parent/target).exists():missing.append([str(source),target])
assert not missing,missing
assert not any('RESULTS_PENDING' in p.read_text() or 'H6_VALIDATION_PENDING' in p.read_text() or 'H6_ACCEPTANCE_PENDING' in p.read_text() for p in [*h6notes,root/'MEMORY.md',backend/'scripts/review-2026-09/FINAL_REPORT.md'])
report={'changed_or_added_source_files':len(changed),'backend_runtime_changes':0,'source_unchanged_during_final_browser':True,'mirrored_markdown':sum(p.suffix=='.md' for p in notes),'mirrored_pdfs':sum(p.suffix=='.pdf' for p in notes),'mirror_mismatches':mismatch,'H6_broken_links':missing}
(here/'handoff-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
