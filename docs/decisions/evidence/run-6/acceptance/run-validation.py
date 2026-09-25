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
    ('frontend-jest', ['node_modules/.bin/react-scripts', 'test', '--watchAll=false'], front, {'CI': 'true'}),
    ('frontend-build', ['npm', 'run', 'build'], front, {'CI': 'true'}),
]
results = []
for i, (name, command, cwd, overrides) in enumerate(steps, 1):
    print(f'[{i}/{len(steps)}] {name}', flush=True)
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    start = time.monotonic()
    with (out / (name + '.log')).open('w') as log:
        result = subprocess.run(command, cwd=cwd, env={**os.environ, **overrides}, stdout=log, stderr=subprocess.STDOUT)
    text = (out / (name + '.log')).read_text(errors='replace')
    text = re.sub(r'\x1b\[[0-9;]*m', '', text)
    counts = {key: sum(map(int, re.findall(r'^\s*(\d+) '+key+r'\b', text, re.M))) for key in ['passing', 'failing', 'pending']}
    if name == 'frontend-jest':
        counts = {key: int(match.group(1)) if (match := re.search(pattern, text)) else None for key, pattern in {'tests':r'Tests:\s+(\d+) passed', 'suites':r'Test Suites:\s+(\d+) passed'}.items()}
    row = dict(name=name, command=command, cwd=str(cwd), environment=overrides, started_at=started, seconds=round(time.monotonic()-start, 2), exit_code=result.returncode, counts=counts)
    results.append(row)
    (out / 'validation-results.json').write_text(json.dumps(results, indent=2)+'\n')
    print(f'  exit={result.returncode} {counts} ({row["seconds"]}s)', flush=True)
    if result.returncode:
        print(text[-6000:], flush=True)
        sys.exit(result.returncode)
print('All sequential validation commands passed.', flush=True)
