"""Run the requested acceptance commands strictly one child at a time."""
from pathlib import Path
import datetime, json, os, re, subprocess, sys, time
root = Path(__file__).resolve().parents[5]
out = Path(__file__).resolve().parent
front = root.parent / 'DS2_Frontend'
mocha = ['node_modules/.bin/mocha', '--require', 'test/setup.js']
steps = [('unit', mocha + ['--recursive', '--exclude', 'test/integration/**', 'test'], root, {'DS2_ENV_FILE': '.env.local'})]
for file in sorted((root / 'test/integration').glob('*.spec.js')):
    envfile = '.env.scenarios' if file.name.startswith(('scenario-', 'path-matrix-')) else '.env.clean' if file.name == 'clean-room-regression.integration.spec.js' else '.env.local'
    steps.append((file.name.removesuffix('.js'), mocha + [str(file.relative_to(root)), '--exit', '--timeout', '180000'], root, {'DS2_ENV_FILE': envfile}))
steps += [
    ('scenarios', ['npm', 'run', '-s', 'test:scenarios'], root, {'DS2_ENV_FILE': '.env.scenarios'}),
    ('cleanroom', ['npm', 'run', '-s', 'test:cleanroom'], root, {'DS2_ENV_FILE': '.env.clean'}),
    ('drift', ['node', 'scripts/drift-check.js', '/tmp/drift.json'], root, {'DS2_ENV_FILE': '.env.local', 'DATABASE_NAME': 'ds2_local', 'PGOPTIONS': '-c default_transaction_read_only=on'}),
    ('lambda', ['python3', '-m', 'pytest', '-q', 'tests'], root.parent / 'DS2_Lambdas' / 'Process_Payment_Images', {}),
    ('frontend-jest', ['node_modules/.bin/react-scripts', 'test', '--watchAll=false'], front, {'CI': 'true'}),
    ('frontend-build', ['npm', 'run', 'build'], front, {'CI': 'true'}),
    ('playwright', ['npx', 'playwright', 'test', '--workers=1'], front / 'e2e', {'PLAYWRIGHT_BROWSERS_PATH': str(front / 'e2e/.browsers'), 'PW_TEST_CONNECT_WS_ENDPOINT': 'ws://127.0.0.1:3334/'}),
]
resume = sys.argv[1] if len(sys.argv) > 1 else None
results = []
if resume:
    start_at = next(i for i, step in enumerate(steps) if step[0] == resume)
    retained_names = {step[0] for step in steps[:start_at]}
    results = [row for row in json.loads((out / 'validation-results.json').read_text()) if row['name'] in retained_names]
    steps = steps[start_at:]
for i, (name, command, cwd, overrides) in enumerate(steps, 1):
    print(f'[{i}/{len(steps)}] {name}', flush=True)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    start = time.monotonic()
    with (out / (name + '.log')).open('w') as log:
        result = subprocess.run(command, cwd=cwd, env={**os.environ, 'SEND_REAL_EMAIL': 'false', 'RUN_SCHEDULED_AUTOMATIONS': 'false', **overrides}, stdout=log, stderr=subprocess.STDOUT)
    text = (out / (name + '.log')).read_text(errors='replace')
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    counts = {key: sum(map(int, re.findall(r'^\s*(\d+) '+key+r'\b', text, re.M))) for key in ['passing', 'failing', 'pending']}
    if name == 'frontend-jest':
        counts = {key: int(match.group(1)) if (match := re.search(pattern, text)) else None for key, pattern in {'tests':r'Tests:\s+(\d+) passed', 'suites':r'Test Suites:\s+(\d+) passed'}.items()}
    if name in ['lambda', 'playwright']:
        counts = {key: sum(map(int, re.findall(r'(\d+) '+key+r'\b', text))) for key in ['passed', 'failed', 'skipped', 'pending']}
    if name == 'frontend-jest':
        counts['skipped'] = sum(map(int, re.findall(r'Tests:.*?(\d+) skipped', text)))
    row = dict(name=name, command=command, cwd=str(cwd), environment=overrides, started_at=started, seconds=round(time.monotonic()-start, 2), exit_code=result.returncode, counts=counts)
    results.append(row)
    (out / 'validation-results.json').write_text(json.dumps(results, indent=2)+'\n')
    print(f'  exit={result.returncode} {counts} ({row["seconds"]}s)', flush=True)
    if result.returncode or any(counts.get(key, 0) for key in ['failing', 'failed', 'pending', 'skipped']):
        print(text[-6000:], flush=True)
        sys.exit(result.returncode or 1)
print('All sequential validation commands passed.', flush=True)
