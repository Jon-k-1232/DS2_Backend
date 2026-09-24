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

/**
 * Computes the storage_slug for a BRAND-NEW account, mirroring migration
 * 020's own backfill/collision rule. `newAccountId` must already be reserved
 * (e.g. via `SELECT nextval(pg_get_serial_sequence('accounts','account_id'))`
 * in the same transaction — see account-service.js's createAccount) so the
 * collision suffix, if needed, is final and correct on the very first write.
 *
 * Because a brand-new account's id is always higher than every account it
 * could possibly collide with (it doesn't exist yet), collision handling here
 * is simpler than the migration's general N-way case: if the base slug is
 * already taken, this new account is always the one that gets suffixed —
 * never an existing row (an existing row's slug is immutable and is never
 * rewritten by this function).
 */
const resolveNewAccountStorageSlug = async (trx, accountName, newAccountId) => {
   const base = sanitizeAccountName(accountName) || `account_${newAccountId}`;
   const existing = await trx('accounts').select('account_id').where({ storage_slug: base }).first();
   return existing ? `${base}_${newAccountId}` : base;
};

module.exports = { getStorageSlug, resolveNewAccountStorageSlug };
