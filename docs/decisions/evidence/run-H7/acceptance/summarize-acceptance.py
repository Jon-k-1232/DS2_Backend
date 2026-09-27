"""Select the latest accepted result for each required command, without double counting."""
from pathlib import Path
import datetime,json,shutil
here=Path(__file__).resolve().parent
backend=here.parents[4]
selected={}
for folder in [here,*sorted(here.glob('final-*'))]:
    if not folder.is_dir() or not (folder/'validation-results.json').exists():continue
    for row in json.loads((folder/'validation-results.json').read_text()):
        row['evidence_log']=str((folder/(row['name']+'.log')).relative_to(here))
        selected[row['name']]=row
integration=sorted(p.name.removesuffix('.js') for p in (backend/'test/integration').glob('*.spec.js'))
required=['unit',*integration,'scenarios','cleanroom','drift','lambda','frontend-jest','frontend-build','playwright']
assert set(required)==set(selected), 'Missing or unexpected commands: '+str(set(required)^set(selected))
for name in required:
    row=selected[name]
    assert row['exit_code']==0, name
    assert not any(row['counts'].get(k,0) for k in ['failed','failing','skipped','pending']), name
browser_file=here/Path(selected['playwright']['evidence_log']).parent/'playwright-results.json'
if not browser_file.exists():browser_file=backend.parent/'DS2_Frontend/e2e/test-results/results.json'
browser=json.loads(browser_file.read_text())
assert not browser.get('errors'), browser.get('errors')
assert all(browser['stats'][k]==0 for k in ['unexpected','skipped','flaky']), browser['stats']
assert selected['playwright']['counts']['passed']==browser['stats']['expected']
protected=json.loads((here.parent/'account1-verification.json').read_text())
assert protected['valid']
end=datetime.datetime.fromisoformat(browser['stats']['startTime'].replace('Z','+00:00'))+datetime.timedelta(milliseconds=browser['stats']['duration'])
assert datetime.datetime.fromisoformat(protected['checked_at'].replace('Z','+00:00'))>end
shutil.copy2('/tmp/drift.json',here.parent/'drift.json')
drift=json.loads((here.parent/'drift.json').read_text())
assert drift['drift']==0 and drift['aggregateDiff']==0 and not drift['mismatches']
counts={'unit':selected['unit']['counts']['passing'],'integration':sum(selected[n]['counts']['passing'] for n in integration),'integration_files':len(integration),'scenarios':selected['scenarios']['counts']['passing'],'scenario_files':sum(n.startswith(('scenario-','path-matrix-')) for n in integration),'cleanroom':selected['cleanroom']['counts']['passing'],'lambda':selected['lambda']['counts']['passed'],'frontend_tests':selected['frontend-jest']['counts']['tests'],'frontend_suites':selected['frontend-jest']['counts']['suites'],'playwright':browser['stats']['expected'],'failed':0,'skipped':0,'pending':0,'flaky':0,'drift':0,'drift_comparisons':drift['compared']}
shutil.copy2(browser_file,here/'playwright-results.json')
report={'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'accepted':True,'required_commands':len(required),'counts':counts,'build_passed':True,'protected_account1_valid':True,'counting_note':'Latest passing result per command. Scenario and clean-room counts overlap integration.','commands':[selected[n] for n in required]}
(here/'final-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='commands'},indent=2))
