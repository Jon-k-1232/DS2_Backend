'use strict';
require('./guard');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { root } = require('./guard');
const files = fs.readdirSync(path.join(root, 'test/integration')).filter(n => /^(?:scenario-(?:lifecycle|what-if)|path-matrix-).*\.integration\.spec\.js$/.test(n)).sort();
if (!files.length) throw new Error('No scenario suites found.');
for (const file of files) {
   const result = spawnSync(process.execPath, ['node_modules/mocha/bin/mocha', '--require', 'test/setup.js', `test/integration/${file}`, '--exit', '--timeout', '180000', ...process.argv.slice(2)], {
      cwd: root, env: { ...process.env, DS2_ENV_FILE: '.env.scenarios' }, stdio: 'inherit'
   });
   if (result.error) throw result.error;
   if (result.status !== 0) process.exit(result.status || 1);
}
