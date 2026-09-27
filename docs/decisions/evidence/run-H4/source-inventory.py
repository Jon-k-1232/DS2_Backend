"""Inventory changed sources without Git; retained H3 hashes where available."""
from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parents[5]
out=Path(__file__).resolve().parent
previous=json.loads((out.parent/'run-H3/source-change-manifest.json').read_text())
old={r['path']:r['after_sha256'] for r in previous['files']}
cutoff=(out/'account1-before.json').stat().st_mtime
rows=[]
for folder in ['DS2_Backend/src','DS2_Backend/test','DS2_Backend/scripts','DS2_Backend/migrations','DS2_Frontend/src','DS2_Frontend/e2e/tests','DS2_Frontend/e2e/lib']:
 for p in (root/folder).rglob('*'):
  if not p.is_file() or p.suffix not in ['.js','.py','.sql','.md','.json'] or any(x in {'node_modules','__pycache__'} for x in p.parts):continue
  relative=p.relative_to(root).as_posix();sha=hashlib.sha256(p.read_bytes()).hexdigest()
  if p.stat().st_mtime>=cutoff or relative in old and sha!=old[relative]:rows.append(dict(path=relative,before_sha256=old.get(relative),after_sha256=sha,comparison='changed_from_retained_H3_hash' if relative in old else 'no_retained_H3_hash'))
(out/'source-change-manifest.json').write_text(json.dumps({'basis':'Source/test/script files modified since the H4 before census, compared to retained H3 hashes when available. No Git. Absence from prior inventory does not prove new authorship. Docs/graph files are described in the run report.','files':sorted(rows,key=lambda r:r['path'])},indent=2)+'\n')
print(len(rows),'source/test/script files inventoried')
