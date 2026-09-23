'use strict';
/*
   Lexer-based replacement for the old line-based assertPlainSql (finding N1, 2026-09 follow-up
   review). The old version (see git history / migrate.js's prior revision) split the file on
   '\n' and matched each line against a regex — which meant a bypass was as easy as putting the
   forbidden statement anywhere OTHER than alone on its own line: `COMMIT; -- comment`,
   `COMMIT;\r\n` (the old regex anchored on `;[ \t]*$`, which a trailing \r defeated),
   `SELECT 1; COMMIT;` on one line, or a `$body$`-shaped token sitting inside an ORDINARY comment
   or string earlier in the file (the old dollar-quote tracker keyed off any `$tag$`-looking text,
   quoted or not, so it could be tricked into treating real SQL as "inside" a dollar-quoted
   block). It also over-refused: a block comment that merely mentioned `BEGIN;` in prose tripped
   the same per-line regex.

   This version tokenizes the file for real before ever looking for a forbidden statement:
     1. Strip `--` line comments and C-style block comments (nesting-aware) to a single space.
     2. Consume '...'/"..." quoted tokens (including a doubled-quote escape and, for a
        standard_conforming_strings-off E'...' string, backslash escapes) as a single opaque
        token — never scanned for semicolons or keywords.
     3. Consume `$$...$$` / `$tag$...$tag$` dollar-quoted bodies the same way, matched on the
        exact tag (Postgres itself requires the closing tag to match).
     4. Split whatever text is left on `;` into statements, and reject any statement whose first
        keyword is transaction control (BEGIN/COMMIT/END/ROLLBACK/ABORT/SAVEPOINT/RELEASE/START
        TRANSACTION/PREPARE TRANSACTION) or a session/transaction setting that could change how
        the REST of the file is interpreted by the server (SET [LOCAL|SESSION] TRANSACTION,
        SET standard_conforming_strings — see the SET LOCAL standard_conforming_strings = on that
        migrate.js itself now runs before every file, precisely so the file never needs its own).
     5. A bare `\` outside all of the above is refused as a psql meta-command.

   The runner still submits the ORIGINAL sql to Postgres byte-for-byte (see migrate.js) — this
   module only ever produces a lexical projection used to decide accept/refuse; it never rewrites
   or re-serializes the file. Probe-verified against the bypass cases above, the two "must not
   over-refuse" cases (a block comment mentioning BEGIN;, nested different dollar tags), and all
   18 shipped migrations/NNN.*.sql files — see test/scripts/migrate.spec.js. This is a proposal
   lexer, not a certified general PostgreSQL parser: it covers the shapes this codebase's
   migrations and the known bypasses actually use.
*/
module.exports = (sql, label = 'migration file') => {
   const fail = reason => {
      throw new Error(`${label}: plain SQL required (${reason}). See migrations/README.md.`);
   };
   const statements = [];
   let text = '';
   let i = 0;
   while (i < sql.length) {
      const rest = sql.slice(i);
      if (rest.startsWith('--')) {
         const end = /[\r\n]/.exec(rest);
         i = end ? i + end.index + 1 : sql.length;
         text += ' ';
      } else if (rest.startsWith('/*')) {
         let depth = 1;
         i += 2;
         while (i < sql.length && depth) {
            if (sql.startsWith('/*', i)) {
               depth++;
               i += 2;
            } else if (sql.startsWith('*/', i)) {
               depth--;
               i += 2;
            } else i++;
         }
         if (depth) fail('unterminated comment');
         text += ' ';
      } else if (sql[i] === "'" || sql[i] === '"') {
         const quote = sql[i];
         // A leading E/e (e.g. E'...') is a Postgres escape-string literal: backslash escapes
         // are honoured inside it regardless of standard_conforming_strings. Ordinary '...'
         // strings only double the quote character itself to escape it.
         const escaped = quote === "'" && /(?:^|[^\w$])[eE]$/.test(sql.slice(0, i));
         let closed = false;
         i++;
         while (i < sql.length) {
            if (escaped && sql[i] === '\\') {
               i += 2;
               continue;
            }
            if (sql[i++] !== quote) continue;
            if (sql[i] === quote) {
               i++;
               continue;
            }
            // R1 fix (2026-09 second follow-up review): PostgreSQL concatenates two quoted
            // strings separated only by whitespace that includes a newline (optionally with '--'
            // line comments in the gap) as if the whitespace were absent — e.g.
            //   SELECT E'a'
            //   'b';
            // is ONE string, not two statements. A continued string keeps whatever escape mode
            // the FIRST literal had even though the continuation piece has no E prefix of its
            // own. Missing this let a real mid-file COMMIT hide in the "closed" half of a
            // continuation (accepted when it should have been refused) while also over-refusing
            // an actually-safe continued literal (refused as "unterminated" when it was fine).
            if (quote === "'") {
               const gap = /^(?:[ \t\n\r\f\v]|--[^\r\n]*(?:\r\n?|\n|$))+/.exec(sql.slice(i));
               if (gap && /[\r\n]/.test(gap[0]) && sql[i + gap[0].length] === "'") {
                  i += gap[0].length + 1;
                  continue;
               }
            }
            closed = true;
            break;
         }
         if (!closed) fail('unterminated quoted token');
         text += ' quoted_token ';
      } else {
         // R1 fix: PostgreSQL dollar-quote tags follow identifier syntax, which allows non-ASCII
         // "letter" characters (\u0080-￿), not just [A-Za-z_] — a tag like $é$ is legal and
         // real. Restricting the tag regex to ASCII meant $é$ was never recognized as a
         // dollar-quote delimiter at all, so its content (including a literal '--') was lexed as
         // ordinary text/comments instead of one opaque token: `$é$--$é$; COMMIT;` swallowed the
         // real trailing COMMIT into a same-line '--' comment match (wrongly ACCEPTED), while
         // `$é$; COMMIT; $é$;` — a real COMMIT safely INSIDE a properly closed $é$...$é$ body —
         // was wrongly REJECTED because the two '$'s were never paired into one token at all.
         const tag = /^(\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$)/.exec(rest);
         if (tag && (i === 0 || !/[\w$\u0080-￿]/.test(sql[i - 1]))) {
            const end = sql.indexOf(tag[1], i + tag[1].length);
            if (end < 0) fail('unterminated dollar quote');
            i = end + tag[1].length;
            text += ' quoted_token ';
         } else if (sql[i] === '\\') {
            fail('psql meta-command');
         } else if (sql[i] === ';') {
            statements.push(text);
            text = '';
            i++;
         } else {
            text += sql[i++];
         }
      }
   }
   statements.push(text);
   for (const statement of statements) {
      const normalized = statement.trim().replace(/\s+/g, ' ');
      if (
         /^(?:BEGIN|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE)\b|^(?:START|PREPARE) TRANSACTION\b|^SET (?:(?:LOCAL|SESSION) )?(?:TRANSACTION|standard_conforming_strings)\b|^SET SESSION CHARACTERISTICS AS TRANSACTION\b/i.test(
            normalized
         )
      ) {
         fail('transaction control or string-lexing setting');
      }
   }
};
