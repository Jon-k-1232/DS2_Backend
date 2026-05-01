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
});
