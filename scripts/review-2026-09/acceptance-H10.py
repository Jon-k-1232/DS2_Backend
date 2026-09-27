"""Summarize completed H10 acceptance without rerunning or double-counting tests."""
import json, pathlib, re
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'docs/decisions/evidence/run-H10'
rows=json.loads((out/'validation-commands.json').read_text())
latest={row['step']:row for row in rows}
ordinary=sorted(p.stem for p in (root/'test/integration').glob('*.spec.js') if not p.name.startswith(('scenario-','path-matrix-')) and p.name!='clean-room-regression.integration.spec.js')
expected=['unit',*ordinary,'scenarios','cleanroom','lambda','frontend-jest','frontend-build','drift','playwright-full']
assert set(expected)<=set(latest), 'Acceptance commands still missing'
accepted=[latest[key] for key in expected]
assert all(r['exit']==0 and r['failing']==0 and r['pending']==0 for r in accepted)
log=lambda step:(out/latest[step]['log']).read_text()
for step in ['unit',*ordinary,'scenarios','cleanroom']:
 assert not re.search(r'^\s+\d+ (?:pending|failing)\b',log(step),re.M),step
pytest=log('lambda');match=re.search(r'(\d+) passed',pytest);assert match and not re.search(r'\d+ (?:failed|skipped|xfailed|xpassed|error)',pytest)
jest=log('frontend-jest');jm=re.search(r'Tests:\s+(\d+) passed,\s+(\d+) total',jest);js=re.search(r'Test Suites:\s+(\d+) passed,\s+(\d+) total',jest);assert jm and js and jm[1]==jm[2] and js[1]==js[2]
pw=json.loads((out/'playwright-results.json').read_text());stats=pw['stats'];assert stats['unexpected']==stats['skipped']==stats['flaky']==0
scenario_files=[p for p in (root/'test/integration').glob('*.spec.js') if p.name.startswith(('scenario-','path-matrix-'))]
scenario_summaries=re.findall(r'^\s+\d+ passing\b',log('scenarios'),re.M);assert len(scenario_summaries)==len(scenario_files)
summary={'unit':latest['unit']['passing'],'ordinaryIntegration':sum(latest[n]['passing']for n in ordinary),'ordinaryIntegrationFiles':len(ordinary),'scenarios':latest['scenarios']['passing'],'scenarioFiles':len(scenario_files),'cleanroom':latest['cleanroom']['passing'],'allIntegration':sum(latest[n]['passing']for n in ordinary)+latest['scenarios']['passing']+latest['cleanroom']['passing'],'allIntegrationFiles':len(ordinary)+len(scenario_files)+1,'lambda':int(match[1]),'jest':int(jm[1]),'jestSuites':int(js[1]),'playwright':stats['expected'],'failed':0,'skipped':0,'pending':0,'flaky':0,'build':'passed'}
summary['uniqueTests']=sum(summary[n]for n in ['unit','allIntegration','lambda','jest','playwright'])
report={'summary':summary,'acceptedCommands':accepted,'nonAcceptanceAttempts':[r for r in rows if r not in accepted],'counting':'Scenarios and clean-room are included in allIntegration; focused repetitions are excluded. Scenario runner executes every file serially.'}
(out/'final-acceptance.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(summary,indent=2))
