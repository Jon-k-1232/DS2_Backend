"""Sequential local H8 acceptance. No server lifecycle or Git commands."""
import json, os, pathlib, re, subprocess, sys, time, shutil, hashlib
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/decisions/evidence/run-H8'
FRONT = ROOT.parent / 'DS2_Frontend'
OUT.mkdir(parents=True,exist_ok=True)
rows = json.loads((OUT/'validation-commands.json').read_text()) if (OUT/'validation-commands.json').exists() else []

def run(step, command, cwd=ROOT, environment=None):
    start = time.monotonic()
    attempt = 1 + sum(row['step']==step for row in rows)
    logfile = OUT / (step + ('' if attempt==1 else '-attempt-'+str(attempt)) + '.log')
    with logfile.open('w') as stream:
        try:
            result = subprocess.run(command, cwd=cwd, env={**os.environ, **(environment or {})}, stdout=stream, stderr=subprocess.STDOUT)
        except KeyboardInterrupt:
            result = SimpleNamespace(returncode=130)
    log = logfile.read_text(errors='replace')
    counts = {key: sum(map(int, re.findall(r'^\s+(\d+) ' + key + r'(?=\s|$)', log, re.M))) for key in ['passing', 'failing', 'pending']}
    row = dict(step=step, attempt=attempt, log=logfile.name, command=command, cwd=str(cwd), environment=environment or {}, exit=result.returncode, seconds=round(time.monotonic()-start, 2), **counts)
    rows.append(row)
    (OUT / 'validation-commands.json').write_text(json.dumps(rows, indent=2)+'\n')
    print(json.dumps(row), flush=True)
    if step.startswith('playwright-full'):
        shutil.copytree(FRONT/'e2e/test-results',OUT/(step+'-attempt-'+str(attempt)),dirs_exist_ok=True)
    if result.returncode:
        raise SystemExit(result.returncode)

def source_inventory():
    files=[]
    for directory in [ROOT/'src', ROOT/'test', FRONT/'src', FRONT/'e2e/tests', FRONT/'e2e/lib']:
        files.extend(p for p in directory.rglob('*') if p.is_file() and p.suffix in {'.js','.jsx','.ts','.tsx','.json','.css'})
    files.extend((ROOT/'migrations').glob('*.sql'))
    files.append(FRONT/'e2e/playwright.config.js')
    return {str(p.relative_to(ROOT.parent)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(files))}

def snapshot_measurements(stage):
    dest = OUT / ('measurements-' + stage)
    dest.mkdir(exist_ok=True)
    for item in json.loads((OUT/'prior-measurements/manifest.json').read_text()):
        source = ROOT/item['path']
        shutil.copyfile(source, dest/(source.parent.name+'-'+source.name))

requested = set(sys.argv[1:] or ['unit','integration','scenarios','cleanroom','lambda','jest','build','drift','playwright'])
if 'unit' in requested:
    run('unit', ['node_modules/.bin/mocha','--require','test/setup.js','--recursive','--exclude','test/integration/**','test'], environment={'DS2_ENV_FILE':'.env.local'})
if 'integration' in requested:
    files = sorted(p for p in (ROOT/'test/integration').glob('*.spec.js') if not p.name.startswith(('scenario-','path-matrix-')) and p.name!='clean-room-regression.integration.spec.js')
    for p in files:
        run(p.stem,['node_modules/.bin/mocha','--require','test/setup.js',str(p.relative_to(ROOT)),'--exit','--timeout','180000'],environment={'DS2_ENV_FILE':'.env.local'})
if 'scenarios' in requested:
    run('scenarios',['npm','run','-s','test:scenarios'])
    snapshot_measurements('api')
if 'cleanroom' in requested:
    run('cleanroom',['npm','run','-s','test:cleanroom'])
if 'lambda' in requested:
    run('lambda',['python3','-m','pytest','-q','tests'],cwd=ROOT.parent/'DS2_Lambdas/Process_Payment_Images')
if 'jest' in requested:
    run('frontend-jest',['node_modules/.bin/react-scripts','test','--watchAll=false'],cwd=FRONT,environment={'CI':'true'})
if 'build' in requested:
    run('frontend-build',['npm','run','build'],cwd=FRONT,environment={'CI':'true'})
if 'drift' in requested:
    run('drift',['node','scripts/drift-check.js','/tmp/drift.json'],environment={'DS2_ENV_FILE':'.env.local','DATABASE_NAME':'ds2_local','PGOPTIONS':'-c default_transaction_read_only=on'})
    shutil.copyfile('/tmp/drift.json',OUT/'drift.json')
if 'playwright' in requested:
    (OUT/'browser-source-before.json').write_text(json.dumps(source_inventory(),indent=2)+'\n')
    run('playwright-full-1',['npx','playwright','test','--workers=1','--retries=0'],cwd=FRONT/'e2e',environment={'PLAYWRIGHT_BROWSERS_PATH':str(FRONT/'e2e/.browsers'),'PW_TEST_CONNECT_WS_ENDPOINT':'ws://127.0.0.1:3334/'})
    import shutil
    shutil.copyfile(FRONT/'e2e/test-results/results.json',OUT/'playwright-results-1.json')
    snapshot_measurements('browser-1')

if 'playwright2' in requested:
    run('playwright-full-2',['npx','playwright','test','--workers=1','--retries=0'],cwd=FRONT/'e2e',environment={'PLAYWRIGHT_BROWSERS_PATH':str(FRONT/'e2e/.browsers'),'PW_TEST_CONNECT_WS_ENDPOINT':'ws://127.0.0.1:3334/'})
    import shutil
    shutil.copyfile(FRONT/'e2e/test-results/results.json',OUT/'playwright-results-2.json')
    snapshot_measurements('browser-2')

if 'playwright2' in requested:
    after=source_inventory()
    (OUT/'browser-source-after.json').write_text(json.dumps(after,indent=2)+'\n')
    assert after==json.loads((OUT/'browser-source-before.json').read_text()), 'Source changed between the two browser acceptance runs'
