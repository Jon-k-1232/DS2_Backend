const {
   resolveOwnDownloadPrefixes,
   resolveOwnLogoPrefixes,
   isSyntacticallySafeKey,
   isSafeBareFilename,
   isAuthorizedDownloadKey
} = require('../../src/utils/downloadAuthorization');

describe('downloadAuthorization', () => {
   describe('isSyntacticallySafeKey', () => {
      it('accepts an ordinary multi-segment key', () => {
         expect(isSyntacticallySafeKey('Some_Account/invoicing/final_invoices/x.zip')).to.equal(true);
      });

      it('rejects non-strings and the empty string', () => {
         expect(isSyntacticallySafeKey('')).to.equal(false);
         expect(isSyntacticallySafeKey(null)).to.equal(false);
         expect(isSyntacticallySafeKey(undefined)).to.equal(false);
         expect(isSyntacticallySafeKey(42)).to.equal(false);
      });

      it('rejects "..", a leading slash, a backslash, a residual "%", and control bytes', () => {
         expect(isSyntacticallySafeKey('Some_Account/../etc/passwd')).to.equal(false);
         expect(isSyntacticallySafeKey('/Some_Account/invoicing/x.zip')).to.equal(false);
         expect(isSyntacticallySafeKey('Some_Account\\invoicing\\x.zip')).to.equal(false);
         expect(isSyntacticallySafeKey('Some_Account/invoicing/%2e%2e/x.zip')).to.equal(false);
         expect(isSyntacticallySafeKey('Some_Account/invoicing/\x00x.zip')).to.equal(false);
      });

      it('RESIDUAL finding (Astra round 9): rejects \\x7f (DEL) — outside the \\x00-\\x1f range previously checked', () => {
         expect(isSyntacticallySafeKey('Some_Account/invoicing/\x7fx.zip')).to.equal(false);
      });

      it('does NOT reject an embedded slash (full keys are multi-segment by design)', () => {
         expect(isSyntacticallySafeKey('Some_Account/invoicing/sub/dir/x.zip')).to.equal(true);
      });
   });

   describe('isSafeBareFilename', () => {
      it('accepts a plain filename', () => {
         expect(isSafeBareFilename('statement-2026-03.pdf')).to.equal(true);
      });

      it('rejects anything containing a path separator, unlike isSyntacticallySafeKey', () => {
         expect(isSafeBareFilename('sub/dir/evil.pdf')).to.equal(false);
         expect(isSafeBareFilename('sub\\dir\\evil.pdf')).to.equal(false);
      });

      it('rejects traversal, a leading slash, a residual "%", and control bytes', () => {
         expect(isSafeBareFilename('../../etc/passwd')).to.equal(false);
         expect(isSafeBareFilename('/etc/passwd')).to.equal(false);
         expect(isSafeBareFilename('%2e%2e%2fx.pdf')).to.equal(false);
         expect(isSafeBareFilename('evil\x00.pdf')).to.equal(false);
      });

      it('RESIDUAL finding (Astra round 9): rejects \\x7f (DEL)', () => {
         expect(isSafeBareFilename('evil\x7f.pdf')).to.equal(false);
      });

      it('rejects non-strings and the empty string', () => {
         expect(isSafeBareFilename('')).to.equal(false);
         expect(isSafeBareFilename(null)).to.equal(false);
         expect(isSafeBareFilename(undefined)).to.equal(false);
      });
   });

   // Astra round 9, finding 1: both resolvers below now take an
   // already-resolved `storageSlug` (accounts.storage_slug — immutable),
   // never a raw `accountName` re-sanitized on every call. The slug values
   // used here are exactly what sanitizeAccountName() (and, since migration
   // 020, the accounts.storage_slug backfill) produce for the corresponding
   // real names, so these stay meaningful without this module doing any
   // sanitization of its own.
   describe('resolveOwnDownloadPrefixes', () => {
      it('returns the invoicing prefix for a resolvable storage slug, and the audit prefix for a valid account id', () => {
         const prefixes = resolveOwnDownloadPrefixes({ storageSlug: 'James_F__Kimmel___Associates', accountId: 1 });
         expect(prefixes).to.include('James_F__Kimmel___Associates/invoicing/');
         expect(prefixes).to.include('account_audits/1/');
      });

      it('returns an empty list for a blank slug and a non-positive/non-integer id — never falls open', () => {
         expect(resolveOwnDownloadPrefixes({ storageSlug: '', accountId: 0 })).to.deep.equal([]);
         expect(resolveOwnDownloadPrefixes({ storageSlug: '', accountId: -1 })).to.deep.equal([]);
         expect(resolveOwnDownloadPrefixes({})).to.deep.equal([]);
      });

      it('trusts the given slug verbatim — it does not re-sanitize a raw account name passed by mistake', () => {
         // Documents the post-fix contract: this function no longer knows how
         // to sanitize anything. A caller that (incorrectly) passed a raw,
         // unsanitized name through as `storageSlug` gets it back verbatim,
         // not silently "fixed" — the real safety net is that every actual
         // caller in src/ now passes the immutable accounts.storage_slug
         // column instead (see src/utils/storageSlug.js).
         const prefixes = resolveOwnDownloadPrefixes({ storageSlug: 'James F. Kimmel & Associates', accountId: 1 });
         expect(prefixes).to.include('James F. Kimmel & Associates/invoicing/');
      });
   });

   describe('resolveOwnLogoPrefixes', () => {
      it('matches the real account-1 logo shape on record (James_F__Kimmel___Associates/app/assets/logo.png)', () => {
         const prefixes = resolveOwnLogoPrefixes({ storageSlug: 'James_F__Kimmel___Associates' });
         expect(prefixes).to.deep.equal(['James_F__Kimmel___Associates/app/assets/']);
         expect(isAuthorizedDownloadKey('James_F__Kimmel___Associates/app/assets/logo.png', prefixes)).to.equal(true);
      });

      it('is scoped strictly per account — one account\'s prefix never matches another\'s slug', () => {
         const ownPrefixes = resolveOwnLogoPrefixes({ storageSlug: 'TEST_FIXTURE_ACCOUNT' });
         expect(ownPrefixes).to.deep.equal(['TEST_FIXTURE_ACCOUNT/app/assets/']);
         expect(isAuthorizedDownloadKey('James_F__Kimmel___Associates/app/assets/logo.png', ownPrefixes)).to.equal(false);
      });

      it('never grows into a generic download area — a key under the same account\'s OWN invoicing prefix is still refused for logo purposes', () => {
         const prefixes = resolveOwnLogoPrefixes({ storageSlug: 'TEST_FIXTURE_ACCOUNT' });
         expect(isAuthorizedDownloadKey('TEST_FIXTURE_ACCOUNT/invoicing/final_invoices/not-a-logo.zip', prefixes)).to.equal(false);
      });

      it('returns an empty list (authorizes nothing) for a blank/unresolvable storage slug', () => {
         expect(resolveOwnLogoPrefixes({ storageSlug: '' })).to.deep.equal([]);
         expect(resolveOwnLogoPrefixes({})).to.deep.equal([]);
      });
   });

   describe('isAuthorizedDownloadKey', () => {
      const prefixes = ['Acme/invoicing/', 'account_audits/9001/'];

      it('authorizes a syntactically-safe key under an allowed prefix', () => {
         expect(isAuthorizedDownloadKey('Acme/invoicing/final_invoices/x.zip', prefixes)).to.equal(true);
      });

      it('refuses a key under a prefix that is not in the allow-list', () => {
         expect(isAuthorizedDownloadKey('OtherAccount/invoicing/final_invoices/x.zip', prefixes)).to.equal(false);
      });

      it('refuses an otherwise-matching key that is syntactically unsafe (defense in depth)', () => {
         expect(isAuthorizedDownloadKey('Acme/invoicing/../../etc/passwd', prefixes)).to.equal(false);
      });

      it('never authorizes anything when the allow-list is empty or missing — fails closed', () => {
         expect(isAuthorizedDownloadKey('Acme/invoicing/x.zip', [])).to.equal(false);
         expect(isAuthorizedDownloadKey('Acme/invoicing/x.zip', undefined)).to.equal(false);
         expect(isAuthorizedDownloadKey('Acme/invoicing/x.zip', null)).to.equal(false);
      });
   });
});
