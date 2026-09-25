'use strict';
const { assertScenarioEnvironment, root } = require('./guard');
const { Client } = require('pg');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function reset() {
   assertScenarioEnvironment();
   const database = process.env.DATABASE_NAME;
   // The postgres maintenance database is used ONLY to create the guarded
   // scenario database; no application tables are queried or written there.
   const admin = new Client({ host: process.env.DB_DEV_HOST, port: 5433, user: 'ds2', password: process.env.DATABASE_PASSWORD, database: 'postgres', ssl: false });
   await admin.connect();
   try {
      if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) {
         await admin.query(`CREATE DATABASE "${database}"`);
      }
   } finally { await admin.end(); }
   const args = ['-X', '-1', '-v', 'ON_ERROR_STOP=1', '-h', process.env.DB_DEV_HOST, '-p', '5433', '-U', 'ds2', '-d', database];
   const options = { cwd: root, env: { ...process.env, PGPASSWORD: process.env.DATABASE_PASSWORD }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 };
   execFileSync('psql', [...args, '-c', 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
   const migrations = ['schema-snapshot-2026-09-22.sql', ...fs.readdirSync(path.join(root, 'migrations')).filter(n => /^\d{3}\./.test(n) && Number(n.slice(0,3)) > 18).sort()];
   for (const file of migrations) execFileSync('psql', [...args, '-f', path.join('migrations', file)], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
   execFileSync('psql', [...args, '-f', 'test/fixtures/clean-room-seed.sql'], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
   console.log(`Reset ${database}: schema baseline + forward migrations + clean-room seed.`);
}
if (require.main === module) reset().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { reset };
