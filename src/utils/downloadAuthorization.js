/**
 * Shared "does this authenticated account actually own this S3 key" gate for
 * routes that serve bytes from a CLIENT-SUPPLIED key (as opposed to a key the
 * server itself resolved from a DB row already scoped to the caller's
 * account — e.g. accountAudit's PDF route looks up `pdf_s3_key` via
 * `getAuditById(db, accountId, auditId)`, so the account filter has already
 * happened before any S3 call and this module does not apply there).
 *
 * review/full-audit-2026-09 finding 1: invoice-router.js's
 * GET /invoices/downloadFile/:accountID/:userID?fileLocation=<key> fetched
 * whatever key it was given with no ownership check at all. The URL's
 * :accountID is authenticated (enforceAccountId already guarantees
 * req.user.account_id === :accountID), but that only proves who is asking —
 * it says nothing about whose object the key points at. An account-9001
 * admin obtained the shared time-tracking template's key from
 * GET /time-tracking/template/list/9001/90013 (a route with its own,
 * separate ownership guard) and then handed that SAME key to downloadFile,
 * which happily streamed back the shared object because it never checked.
 *
 * Fix shape: resolve the areas of the shared bucket this account is actually
 * allowed to be served bytes from (its own invoicing exports), then require BOTH a syntactically-safe key AND a prefix match
 * before ever calling S3. Nothing under time_tracking/tracker_versions/ (the
 * shared template) or another account's prefix can ever match.
 *
 * Astra round 9, finding 1: these prefixes used to be derived by
 * re-sanitizing the account's CURRENT, mutable account_name on every call
 * (sanitizeAccountName in invoicePath.js) — an account admin could rename
 * their own account to a string that sanitizes to a DIFFERENT account's slug
 * and inherit that account's entire S3 namespace. Both resolvers below now
 * take an already-resolved `storageSlug` (accounts.storage_slug — see
 * src/utils/storageSlug.js and migrations/020.accounts_storage_slug.sql),
 * which is assigned once and never recomputed from account_name again. This
 * module does no sanitization of its own; it only trusts the caller's slug
 * verbatim, exactly as before, just from an immutable source.
 */

// Areas of the bucket that legitimately belong to one account and may be
// served back through a client-supplied-key download route.
const resolveOwnDownloadPrefixes = ({ storageSlug } = {}) => {
   const slug = storageSlug;
   const allowed = [];

   // Invoice PDF/CSV zip exports — see pdfCreator/zipOrchestrator.js
   // createAndSaveZip, which writes to `${slug}/invoicing/<subarea>/...`.
   if (slug) allowed.push(`${slug}/invoicing/`);

   // Audit PDFs are served only by the dedicated Super Admin audit route.

   return allowed;
};

/**
 * review/full-audit-2026-09 finding 2 (account_company_logo): the column is a
 * free-text field an account admin can set to any string (account-router.js
 * PUT /updateAccount had no validation at all), and it flows straight into
 * getObject() both when a statement/invoice PDF embeds the logo
 * (addInvoiceDetail.js loadCompanyLogo) and when the settings page reads it
 * back (account-router.js fetchAccountLogo, which hands the bytes back to
 * the client as base64) — so a bad value could point at, and leak, ANY other
 * object in the shared bucket. Deliberately its own resolver rather than
 * folded into resolveOwnDownloadPrefixes above: a logo key is trusted for a
 * different purpose (embedded in a generated PDF / returned as base64) than
 * a generic file download, so its allow-list should not grow or shrink just
 * because downloadFile's does. The real (account 1) value on record —
 * `James_F__Kimmel___Associates/app/assets/logo.png` — already lives under
 * this exact shape (see addInvoiceDetail.js's own fallbackS3Key), confirmed
 * read-only against the sandbox DB while building this fix.
 *
 * Astra round 9, finding 1: takes `storageSlug` (accounts.storage_slug), not
 * a raw account name — see the module header comment above.
 */
const resolveOwnLogoPrefixes = ({ storageSlug } = {}) => {
   const slug = storageSlug;
   return slug ? [`${slug}/app/assets/`] : [];
};

// Purely syntactic checks, independent of which prefixes are allowed.
// Express's own query-string parser (qs, via the default 'extended' query
// parser) already runs decodeURIComponent once on every query value, so a
// literal '%' surviving that single pass means the caller encoded it AGAIN
// client-side (e.g. '..' -> '%2e%2e' -> '%252e%252e') hoping a later,
// separate decode step would reveal '../' only after some earlier check had
// already passed it. Rejecting any leftover '%' closes that off without
// this module ever needing to decode anything itself.
const isSyntacticallySafeKey = key => {
   if (typeof key !== 'string' || key.length === 0) return false;
   if (key.includes('..')) return false;
   if (key.startsWith('/')) return false;
   if (key.includes('\\')) return false;
   if (key.includes('%')) return false;
   // \x7f (DEL) is a control character outside the \x00-\x1f range this used
   // to check — RESIDUAL finding, Astra round 9 — rejected here too.
   // eslint-disable-next-line no-control-regex
   if (/[\x00-\x1f\x7f]/.test(key)) return false;
   return true;
};

/**
 * review/full-audit-2026-09 finding 3 (pendingPayments): upload / delete /
 * preview all take a client-supplied FILENAME (not a full key — the route
 * prepends its own fixed prefix) with no hygiene at all. `isSyntacticallySafeKey`
 * above is the right base check (blocks '..', a leading '/', backslashes, a
 * residual '%', control bytes) but it still allows an EMBEDDED '/' — correct
 * for a full key, wrong for a bare filename, where any '/' would let the
 * caller smuggle in extra path segments the route never intended (e.g.
 * 'sub/dir/evil.pdf' reaching `${PREFIX}/sub/dir/evil.pdf`). A bare filename
 * may contain no path separator at all.
 */
const isSafeBareFilename = name => isSyntacticallySafeKey(name) && !name.includes('/');

// True only when `key` is syntactically safe AND sits under one of the
// caller's own allowed prefixes. An empty/missing prefix list (e.g. the
// account has no resolvable name) authorizes nothing — never falls open.
const isAuthorizedDownloadKey = (key, allowedPrefixes) => {
   if (!isSyntacticallySafeKey(key)) return false;
   return Array.isArray(allowedPrefixes) && allowedPrefixes.some(prefix => key.startsWith(prefix));
};

module.exports = {
   resolveOwnDownloadPrefixes,
   resolveOwnLogoPrefixes,
   isSyntacticallySafeKey,
   isSafeBareFilename,
   isAuthorizedDownloadKey
};
