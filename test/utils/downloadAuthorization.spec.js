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

      it('rejects non-strings and the empty string', () => {
         expect(isSafeBareFilename('')).to.equal(false);
         expect(isSafeBareFilename(null)).to.equal(false);
         expect(isSafeBareFilename(undefined)).to.equal(false);
      });
   });

   describe('resolveOwnDownloadPrefixes', () => {
      it('returns the invoicing prefix for a resolvable account name, and the audit prefix for a valid account id', () => {
         const prefixes = resolveOwnDownloadPrefixes({ accountName: 'James F. Kimmel & Associates', accountId: 1 });
         expect(prefixes).to.include('James_F__Kimmel___Associates/invoicing/');
         expect(prefixes).to.include('account_audits/1/');
      });

      it('returns an empty list for a blank name and a non-positive/non-integer id — never falls open', () => {
         expect(resolveOwnDownloadPrefixes({ accountName: '', accountId: 0 })).to.deep.equal([]);
         expect(resolveOwnDownloadPrefixes({ accountName: '', accountId: -1 })).to.deep.equal([]);
         expect(resolveOwnDownloadPrefixes({})).to.deep.equal([]);
      });
   });

   describe('resolveOwnLogoPrefixes', () => {
      it('matches the real account-1 logo shape on record (James_F__Kimmel___Associates/app/assets/logo.png)', () => {
         const prefixes = resolveOwnLogoPrefixes({ accountName: 'James F. Kimmel & Associates' });
         expect(prefixes).to.deep.equal(['James_F__Kimmel___Associates/app/assets/']);
         expect(isAuthorizedDownloadKey('James_F__Kimmel___Associates/app/assets/logo.png', prefixes)).to.equal(true);
      });

      it('is scoped strictly per account — one account\'s prefix never matches another\'s slug', () => {
         const ownPrefixes = resolveOwnLogoPrefixes({ accountName: 'TEST FIXTURE ACCOUNT' });
         expect(ownPrefixes).to.deep.equal(['TEST_FIXTURE_ACCOUNT/app/assets/']);
         expect(isAuthorizedDownloadKey('James_F__Kimmel___Associates/app/assets/logo.png', ownPrefixes)).to.equal(false);
      });

      it('never grows into a generic download area — a key under the same account\'s OWN invoicing prefix is still refused for logo purposes', () => {
         const prefixes = resolveOwnLogoPrefixes({ accountName: 'TEST FIXTURE ACCOUNT' });
         expect(isAuthorizedDownloadKey('TEST_FIXTURE_ACCOUNT/invoicing/final_invoices/not-a-logo.zip', prefixes)).to.equal(false);
      });

      it('returns an empty list (authorizes nothing) for a blank/unresolvable account name', () => {
         expect(resolveOwnLogoPrefixes({ accountName: '' })).to.deep.equal([]);
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
