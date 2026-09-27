"""Recheck the final backend edits, one process at a time, after acceptance."""
from pathlib import Path
import datetime,json,os,re,subprocess,time
out=Path(__file__).resolve().parent
root=out.parents[4]
results=json.loads((out/'validation-results.json').read_text())
(out/'results-before-final-code-checks.json').write_text(json.dumps(results,indent=2)+'\n')
names=['unit','coverage-transactions-retainers-writeoffs.integration.spec','review-related-ids.integration.spec','path-matrix-H4-recurring.integration.spec','scenario-H4-recurring.integration.spec']
for name in names:
 row=next(r for r in results if r['name']==name)
 env={**os.environ,'SEND_REAL_EMAIL':'false','RUN_SCHEDULED_AUTOMATIONS':'false',**row['environment']}
 print(name,flush=True)
 start=time.monotonic();row['started_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (out/(name+'.log')).open('w') as log:r=subprocess.run(row['command'],cwd=row['cwd'],env=env,stdout=log,stderr=subprocess.STDOUT)
 text=re.sub(r'\x1b\[[0-9;]*m','',(out/(name+'.log')).read_text(errors='replace'))
 counts={k:sum(map(int,re.findall(r'^\s*(\d+) '+k+r'\b',text,re.M))) for k in ['passing','failing','pending']}
 row.update(exit_code=r.returncode,seconds=round(time.monotonic()-start,2),counts=counts,final_recheck_reason='Final recurring relation guard, source metadata, fixture cutover and PDF label changes.')
 (out/'validation-results.json').write_text(json.dumps(results,indent=2)+'\n')
 print(r.returncode,counts,flush=True)
 if r.returncode or counts['failing'] or counts['pending']:print(text[-5000:]);raise SystemExit(r.returncode or 1)
