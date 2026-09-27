import os,pathlib,subprocess,json,re,time,sys,shutil
root=pathlib.Path('/Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend')
front=root.parent/'DS2_Frontend';out=root/'docs/decisions/evidence/run-H9';results=[]
if (out/'scenarios.log').exists() and not (out/'scenarios-before-calendar-fix.log').exists():shutil.copy2(out/'scenarios.log',out/'scenarios-before-calendar-fix.log')
steps=[
 ('unit',root,['node_modules/.bin/mocha','--require','test/setup.js','--recursive','--exclude','test/integration/**','test'],{'DS2_ENV_FILE':'.env.local'}),
 ('ordinary-integrations',root,['python3',str(out/'run-ordinary-integrations.py')],{}),
 ('scenarios',root,['npm','run','-s','test:scenarios'],{}),
 ('cleanroom',root,['npm','run','-s','test:cleanroom'],{}),
 ('lambda',root.parent/'DS2_Lambdas/Process_Payment_Images',['python3','-m','pytest','-q','tests'],{}),
 ('frontend-jest',front,['node_modules/.bin/react-scripts','test','--watchAll=false'],{'CI':'true'}),
 ('build',front,['npm','run','build'],{'CI':'true','NODE_OPTIONS':'--max-old-space-size=8192'}),
 ('playwright',front/'e2e',['npx','playwright','test','--workers=1'],{'NODE_OPTIONS':'--max-old-space-size=8192','PLAYWRIGHT_BROWSERS_PATH':str(front/'e2e/.browsers'),'PW_TEST_CONNECT_WS_ENDPOINT':'ws://127.0.0.1:3334/'}),
 ('drift',root,['node','scripts/drift-check.js','/tmp/drift.json'],{'DS2_ENV_FILE':'.env.local','DATABASE_NAME':'ds2_local','PGOPTIONS':'-c default_transaction_read_only=on'}),
 ('protected-data',root,['node','docs/decisions/evidence/run-H9/verify-protected.js'],{})
]
for name,cwd,cmd,extra in steps:
 print('START '+name,flush=True);start=time.time()
 with (out/(name+'.log')).open('w') as f:r=subprocess.run(cmd,cwd=cwd,env=dict(os.environ,**extra),stdout=f,stderr=subprocess.STDOUT)
 log=(out/(name+'.log')).read_text(errors='replace')
 row=dict(step=name,command=cmd,cwd=str(cwd),environment=extra,exit=r.returncode,seconds=round(time.time()-start,2))
 row['mocha_passing']=sum(map(int,re.findall(r'^\s+(\d+) passing(?=\s|$)',log,re.M)))
 row['mocha_failing']=sum(map(int,re.findall(r'^\s+(\d+) failing(?=\s|$)',log,re.M)))
 row['mocha_pending']=sum(map(int,re.findall(r'^\s+(\d+) pending(?=\s|$)',log,re.M)))
 if name=='ordinary-integrations':
  details=json.loads((out/'integration-counts.json').read_text());row['files']=len(details);row['mocha_passing']=sum(d['passing'] for d in details);row['mocha_failing']=sum(d['failing'] for d in details);row['mocha_pending']=sum(d['pending'] for d in details)
  if any(d['exit'] or d['failing'] or d['pending'] for d in details):row['exit']=1
 if name=='scenarios':row['files']=len(re.findall(r'^\s+\d+ passing(?=\s|$)',log,re.M))
 if name=='playwright' and (front/'e2e/test-results/results.json').exists():
  report=json.loads((front/'e2e/test-results/results.json').read_text());row['stats']=report['stats'];(out/'playwright-summary.json').write_text(json.dumps(report['stats'],indent=2))
 if name=='drift' and pathlib.Path('/tmp/drift.json').exists():shutil.copy2('/tmp/drift.json',out/'drift.json')
 results.append(row);(out/'final-command-results.json').write_text(json.dumps(results,indent=2));print(json.dumps(row),flush=True)
 if row['exit'] or row['mocha_failing'] or row['mocha_pending']:sys.exit(1)
print('COMPLETE: all required groups exited 0.',flush=True)
