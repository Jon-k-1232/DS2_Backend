"""Consolidate accepted commands, replacing superseded results without adding them twice."""
from pathlib import Path
import datetime
import json
import shutil

here = Path(__file__).resolve().parent
backend = here.parents[4]
read = lambda p: json.loads(p.read_text())
selected = {}
for folder in [here, here / 'final-rechecks', here / 'final-ui-rechecks', here / 'final-tooltip-rechecks']:
    for result in read(folder / 'validation-results.json'):
        result['evidence_log'] = str((folder / (result['name'] + '.log')).relative_to(here))
        selected[result['name']] = result

integration = sorted(p.name.removesuffix('.js') for p in (backend / 'test/integration').glob('*.spec.js'))
required = ['unit', *integration, 'scenarios', 'cleanroom', 'drift', 'lambda', 'frontend-jest', 'frontend-build', 'playwright']
assert set(required) == set(selected), 'Missing or unexpected validation commands'
commands = [selected[name] for name in required]
for row in commands:
    assert row['exit_code'] == 0, row['name']
    assert not any(row['counts'].get(key, 0) for key in ['failed', 'failing', 'skipped', 'pending']), row['name']

browser = read(backend.parent / 'DS2_Frontend/e2e/test-results/results.json')
assert not browser.get('errors'), 'Playwright reporter errors'
assert browser['stats']['expected'] == 184, browser['stats']
assert all(browser['stats'][key] == 0 for key in ['unexpected', 'skipped', 'flaky']), browser['stats']
assert selected['playwright']['counts']['passed'] == browser['stats']['expected']
protected = read(here.parent / 'account1-verification.json')
assert protected['valid'], 'Protected-data verification failed'
browser_end = datetime.datetime.fromisoformat(browser['stats']['startTime'].replace('Z', '+00:00')) + datetime.timedelta(milliseconds=browser['stats']['duration'])
assert datetime.datetime.fromisoformat(protected['checked_at'].replace('Z', '+00:00')) > browser_end, 'Run the protected-data census after the final browser suite'
drift = read(here.parent / 'drift.json')
assert drift['drift'] == 0 and drift['aggregateDiff'] == 0 and not drift['mismatches'], 'Nonzero drift'

counts = {
    'unit': selected['unit']['counts']['passing'],
    'integration': sum(selected[name]['counts']['passing'] for name in integration),
    'integration_files': len(integration),
    'scenarios': selected['scenarios']['counts']['passing'],
    'scenario_files': sum(name.startswith(('scenario-', 'path-matrix-')) for name in integration),
    'cleanroom': selected['cleanroom']['counts']['passing'],
    'lambda': selected['lambda']['counts']['passed'],
    'frontend_tests': selected['frontend-jest']['counts']['tests'],
    'frontend_suites': selected['frontend-jest']['counts']['suites'],
    'playwright': browser['stats']['expected'],
    'failed': 0, 'skipped': 0, 'pending': 0, 'flaky': 0,
    'drift': 0, 'drift_comparisons': drift['compared'],
}
shutil.copy2(backend.parent / 'DS2_Frontend/e2e/test-results/results.json', here / 'playwright-results.json')
report = {
    'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'accepted': True, 'required_commands': len(commands), 'targeted_rechecks': 9,
    'counting_note': 'Latest passing result per command. Scenario and clean-room counts overlap integration; no cross-suite grand total is claimed.',
    'counts': counts, 'build_passed': True, 'protected_account1_valid': True,
    'commands': commands,
}
(here / 'final-acceptance.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'commands'}, indent=2))
