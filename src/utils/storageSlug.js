const { sanitizeAccountName } = require('./invoicePath');

/**
 * review/full-audit-2026-09 finding 1 (Astra round 9): every S3 key an
 * account's own data lives under used to be built/authorized by re-running
 * sanitizeAccountName() over the account's CURRENT, mutable account_name on
 * every request (see downloadAuthorization.js, zipOrchestrator.js,
 * addInvoiceDetail.js, account-router.js — all fixed to use this module
 * instead). Renaming an account to a string that happened to sanitize to a
 * DIFFERENT account's slug inherited that account's entire S3 namespace —
 * confirmed exploitable against account 1's real invoicing/logo objects.
 *
 * accounts.storage_slug (migrations/020.accounts_storage_slug.sql) is the
 * fix: assigned once, backfilled for existing rows to match
 * sanitizeAccountName()'s output exactly (so every existing S3 key stays
 * valid), NEVER recomputed from account_name again. This module is the ONLY
 * place in the codebase that should either (a) read that column, or (b)
 * compute a fresh one for a brand-new account — nothing else should call
 * sanitizeAccountName() to build or authorize a storage key.
 */

/** Reads the single source of truth for an existing account's S3 namespace. */
const getStorageSlug = async (db, accountId) => {
   const row = await db('accounts').select('storage_slug').where({ account_id: accountId }).first();
   return row ? row.storage_slug : null;
};

// review/full-audit-2026-09 findings 3+4 (Astra round 10): a fixed Postgres
// advisory lock namespace, held for the rest of the CALLING transaction
// (pg_advisory_xact_lock — released automatically on commit or rollback,
// never leaked). Every concurrent slug allocation across the whole table
// takes this same lock before checking anything, so "is this candidate
// free?" and "insert it" can never straddle two different transactions —
// see resolveNewAccountStorageSlug below. A single global key (rather than
// one keyed per base slug) is deliberately simple: allocation is rare
// (account creation), so serializing all of it is cheap, and a per-base key
// would still need to account for one request's suffixed candidate landing
// on a DIFFERENT request's base — see nextCandidateSlug's comment.
const STORAGE_SLUG_LOCK_NAMESPACE = 'accounts.storage_slug';

/**
 * The Nth candidate slug for a given base/account-id pair, in the fixed,
 * deterministic order both resolveNewAccountStorageSlug and migration 020's
 * backfill try them in: the bare base, then `<base>_<id>`, then
 * `<base>_<id>_2`, `<base>_<id>_3`, ... `attempt` is 0-based (0 = base).
 */
const nextCandidateSlug = (base, accountId, attempt) => {
   if (attempt === 0) return base;
   if (attempt === 1) return `${base}_${accountId}`;
   return `${base}_${accountId}_${attempt}`;
};

/**
 * Finds the first candidate in that fixed order that no OTHER row already
 * holds, checked against the live table one candidate at a time (never
 * computed from a static snapshot — findings 3+4: a snapshot-based check let
 * an unrelated, already-existing row's slug (e.g. a previously created
 * account literally named so it sanitizes to "<base>_<id>") silently
 * collide with this account's naively-suffixed candidate, aborting the
 * INSERT with 23505 even with nothing else running concurrently).
 */
const pickUnusedSlug = async (trx, base, accountId) => {
   for (let attempt = 0; ; attempt += 1) {
      const candidate = nextCandidateSlug(base, accountId, attempt);
      const existing = await trx('accounts').select('account_id').where({ storage_slug: candidate }).first();
      if (!existing) return candidate;
   }
};

/**
 * Computes the storage_slug for a BRAND-NEW account, mirroring migration
 * 020's own backfill/collision rule. `newAccountId` must already be reserved
 * (e.g. via `SELECT nextval(pg_get_serial_sequence('accounts','account_id'))`
 * in the same transaction — see account-service.js's createAccount) so the
 * collision suffix, if needed, is final and correct on the very first write.
 *
 * Astra round 10 (findings 3+4) reproduced two ways this used to fail even
 * though a brand-new account's id is always higher than every account it
 * could collide with:
 *  - Concurrency (finding 3): two real createAccount calls for "R10 Race"
 *    and "R10_Race" (sanitizeAccountName maps space and '_' to the SAME '_'
 *    individually, so both share one base) both ran their "is the base
 *    taken?" SELECT before EITHER had inserted — both saw it free and both
 *    tried to insert the bare base; one succeeded, the other hit 23505. Fixed
 *    by taking a transaction-held advisory lock (STORAGE_SLUG_LOCK_NAMESPACE
 *    above) before picking a candidate, so a second allocator's SELECT can
 *    only run after the first has fully committed (or rolled back) — it will
 *    then correctly see the first's slug as taken.
 *  - Non-concurrent, one-shot suffix (finding 4): even run strictly
 *    sequentially, always trying exactly `<base>_<newAccountId>` with no
 *    re-check could still collide with an unrelated, already-existing
 *    account whose OWN (unsuffixed) slug happened to equal that exact
 *    string — the create would fail outright (23505) instead of falling
 *    back further. Fixed by pickUnusedSlug walking `<base>_<id>`,
 *    `<base>_<id>_2`, `<base>_<id>_3`, ... against the live table until it
 *    finds one nothing else holds, rather than trying one fixed candidate
 *    and giving up.
 *
 * The UNIQUE index (accounts_storage_slug_key) remains the last line of
 * defence — belt and suspenders, not a substitute for the lock: if a 23505
 * on that constraint ever reaches here anyway (a future caller that forgets
 * to hold this same lock, or any other unforeseen gap), the caller
 * (account-service.js's createAccount) retries this whole resolution once
 * against the now-current namespace rather than surfacing a spurious 500 for
 * what is, from the caller's perspective, a perfectly valid create.
 */
const resolveNewAccountStorageSlug = async (trx, accountName, newAccountId) => {
   const base = sanitizeAccountName(accountName) || `account_${newAccountId}`;
   await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [STORAGE_SLUG_LOCK_NAMESPACE]);
   return pickUnusedSlug(trx, base, newAccountId);
};

module.exports = { getStorageSlug, resolveNewAccountStorageSlug, nextCandidateSlug };
