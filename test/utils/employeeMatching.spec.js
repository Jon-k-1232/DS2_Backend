const { matchEmployee } = require('../../src/utils/employeeMatching');

describe('employeeMatching matchEmployee', () => {
   const employees = [
      { user_id: 7, display_name: 'Eliza Smith' },
      { user_id: 8, display_name: 'Bob Jones' },
      { user_id: 9, display_name: 'Maria López' }
   ];

   it('matches exact display name', () => {
      expect(matchEmployee('Bob Jones', employees)).to.deep.equal({ userId: 8, displayName: 'Bob Jones' });
   });

   it('matches case-insensitively', () => {
      expect(matchEmployee('eliza smith', employees)).to.deep.equal({ userId: 7, displayName: 'Eliza Smith' });
   });

   it('collapses double whitespace', () => {
      expect(matchEmployee('Eliza   Smith ', employees)).to.deep.equal({ userId: 7, displayName: 'Eliza Smith' });
   });

   it('NFKC-normalizes accented characters', () => {
      expect(matchEmployee('Maria López', employees)).to.deep.equal({ userId: 9, displayName: 'Maria López' });
   });

   it('returns null for unknown name', () => {
      expect(matchEmployee('Mystery Person', employees)).to.equal(null);
   });

   it('returns null for empty input', () => {
      expect(matchEmployee('', employees)).to.equal(null);
      expect(matchEmployee(null, employees)).to.equal(null);
   });

   it('returns null when catalog is empty', () => {
      expect(matchEmployee('Eliza Smith', [])).to.equal(null);
   });

   // DEFECT regression (C7): two employees can share a display name (hired
   // twice, e.g. "Alex Jones" at two different rates). This is the LEGACY
   // name-only fallback (auto-ingest-orchestrator.js prefers the validated
   // entry.user_id whenever it is present) — for a row with no user_id at
   // all, silently returning whichever "Alex Jones" happened to sort first
   // used to price the work at the WRONG employee's rate. A duplicate
   // normalized name must be refused (null), not guessed.
   it('refuses (returns null) when the name matches more than one catalog entry', () => {
      const duplicateNamed = [
         { user_id: 90011, display_name: 'Alex Jones', billing_rate: 75 },
         { user_id: 90012, display_name: 'Alex Jones', billing_rate: 150 }
      ];
      expect(matchEmployee('Alex Jones', duplicateNamed)).to.equal(null);
      expect(matchEmployee('alex   JONES', duplicateNamed)).to.equal(null);
   });

   it('still resolves the unique match when duplicates exist for a DIFFERENT name', () => {
      const catalog = [
         { user_id: 90011, display_name: 'Alex Jones', billing_rate: 75 },
         { user_id: 90012, display_name: 'Alex Jones', billing_rate: 150 },
         { user_id: 90013, display_name: 'Eliza Smith', billing_rate: 90 }
      ];
      expect(matchEmployee('Eliza Smith', catalog)).to.deep.equal({ userId: 90013, displayName: 'Eliza Smith' });
   });
});
