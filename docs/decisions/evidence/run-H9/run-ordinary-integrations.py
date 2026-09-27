import os,pathlib,subprocess,json,re,time
root=pathlib.Path.cwd();out=root/'docs/decisions/evidence/run-H9';rows=[]
files=sorted(p for p in (root/'test/integration').glob('*.spec.js') if not p.name.startswith(('scenario-','path-matrix-')) and p.name!='clean-room-regression.integration.spec.js')
for p in files:
 env=dict(os.environ,DS2_ENV_FILE='.env.local');start=time.time()
 with (out/(p.stem+'.log')).open('w') as f:r=subprocess.run(['node_modules/.bin/mocha','--require','test/setup.js',str(p.relative_to(root)),'--exit','--timeout','180000'],env=env,stdout=f,stderr=subprocess.STDOUT)
 log=(out/(p.stem+'.log')).read_text();counts={k:int(re.findall(r'^\s+(\d+) '+k+r'(?=\s|$)',log,re.M)[-1]) if re.findall(r'^\s+(\d+) '+k+r'(?=\s|$)',log,re.M) else 0 for k in ['passing','failing','pending']};row=dict(file=p.name,exit=r.returncode,seconds=round(time.time()-start,2),**counts);rows.append(row);(out/'integration-counts.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)
