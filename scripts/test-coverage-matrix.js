/* eslint-disable no-console */
/*
   Route coverage matrix: every mounted Express route vs. the test files whose
   describe/it titles or request paths reference it. Writes test/COVERAGE_MATRIX.md.
      node scripts/test-coverage-matrix.js
   Convention for coverage specs: title every describe with the exact
   "METHOD /mounted/route/:params" string so this matcher can see it.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
const mounts = {};
for (const m of appSrc.matchAll(/app\.use\('(\/[^']+)'[^;]*?,\s*(\w+)\);/g)) mounts[m[2]] = m[1];
const requires = {};
for (const m of appSrc.matchAll(/const\s+(?:\{\s*)?(\w+)(?:\s*\})?\s*=\s*require\('\.\/endpoints\/([^']+)'\)/g)) requires[m[1]] = m[2];

const routes = [];
for (const [variable, prefix] of Object.entries(mounts)) {
   const rel = requires[variable];
   if (!rel) continue;
   const file = path.join(ROOT, 'src/endpoints', `${rel}.js`);
   if (!fs.existsSync(file)) continue;
   const src = fs.readFileSync(file, 'utf8');
   for (const m of src.matchAll(/\.route\(\s*'([^']+)'\s*\)((?:\s*\.\w+\([^;]*?\))+)/gs)) {
      for (const mm of m[2].matchAll(/\.(get|post|put|delete)\(/g)) routes.push({ method: mm[1].toUpperCase(), route: prefix + m[1], file: path.relative(ROOT, file) });
   }
   for (const m of src.matchAll(/\w+Router\.(get|post|put|delete)\(\s*\n?\s*'([^']+)'/g)) routes.push({ method: m[1].toUpperCase(), route: prefix + m[2], file: path.relative(ROOT, file) });
}
const uniq = [...new Map(routes.map(r => [`${r.method} ${r.route}`, r])).values()].sort((a, b) => (a.file + a.route).localeCompare(b.file + b.route));

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.spec.js') ? [path.join(dir, d.name)] : []));
const specs = walk(path.join(ROOT, 'test')).map(f => ({ file: path.relative(ROOT, f), src: fs.readFileSync(f, 'utf8') }));

const stripParams = r => r.replace(/:\w+/g, '').replace(/\/+$/, '');
const rows = uniq.map(r => {
   const exact = `${r.method} ${r.route}`;
   const bare = stripParams(r.route);
   const hits = specs.filter(s => s.src.includes(exact) || s.src.includes(bare)).map(s => s.file);
   return { ...r, tests: hits };
});

const covered = rows.filter(r => r.tests.length).length;
const CAVEAT =
   'Caveat: this matrix counts route REFERENCES — a spec file whose describe/it title or a ' +
   'request path string contains the route — not exercised behaviour. A spec can reference a ' +
   'route in a comment or a skipped/pending test and still count as "covered" here; a route ' +
   "covered indirectly (helper function, different literal path string) won't. Treat this as a " +
   'starting point for finding gaps, not a substitute for reading the spec.';
const md = [
   '# Route coverage matrix',
   '',
   `Generated ${new Date().toISOString()} by scripts/test-coverage-matrix.js — ${covered}/${rows.length} routes referenced by at least one spec.`,
   '',
   `_${CAVEAT}_`,
   '',
   '| Method | Route | Router | Specs |',
   '|---|---|---|---|',
   ...rows.map(r => `| ${r.method} | \`${r.route}\` | ${r.file.replace('src/endpoints/', '')} | ${r.tests.length ? r.tests.map(t => `\`${t.replace('test/', '')}\``).join('<br>') : '**none**'} |`)
].join('\n');
fs.writeFileSync(path.join(ROOT, 'test/COVERAGE_MATRIX.md'), md);
console.log(`${covered}/${rows.length} routes covered → test/COVERAGE_MATRIX.md`);
console.log(CAVEAT);
rows.filter(r => !r.tests.length).forEach(r => console.log(`  MISSING ${r.method} ${r.route}`));
