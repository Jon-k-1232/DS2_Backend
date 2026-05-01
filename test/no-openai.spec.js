/**
 * Phase 1 cutover guard: no OpenAI references may live in src/.
 * Fails the test suite (and therefore CI) if any banned string reappears.
 *
 * Allowed locations: this file (the guard itself) and tests / fixtures that
 * intentionally mention the legacy name in narrative comments.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const BANNED_PATTERNS = [
   /\bopenai\b/i,
   /\bOPENAI_API_KEY\b/,
   /\bOPENAI_API_BASE_URL\b/,
   /\bOPENAI_VECTOR_STORE_ID\b/,
   /executeAiRequest/,
   /aiTrainingUploader/,
   /aiTimesheetJobRunner/,
   /timesheet-suggestions-orchestrator/,
   /aiSecrets/
];

const _walk = (dir, out = []) => {
   for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) _walk(full, out);
      else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) out.push(full);
   }
   return out;
};

describe('Phase 1 cutover: no-OpenAI guard', () => {
   const files = _walk(SRC_DIR);

   for (const pattern of BANNED_PATTERNS) {
      it(`src/ contains no match for ${pattern}`, () => {
         const offenders = [];
         for (const f of files) {
            const text = fs.readFileSync(f, 'utf8');
            // Allow comments that reference the legacy name explicitly for
            // historical context — only flag identifier-like usage.
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
               const line = lines[i];
               if (pattern.test(line)) {
                  // Permit a single-line comment that references the legacy
                  // name as part of a removal narrative.
                  const trimmed = line.trim();
                  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
                  offenders.push(`${path.relative(SRC_DIR, f)}:${i + 1}: ${trimmed}`);
               }
            }
         }
         if (offenders.length) {
            const err = new Error('Banned identifier found in src/:\n' + offenders.join('\n'));
            throw err;
         }
      });
   }
});
