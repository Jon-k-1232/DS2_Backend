const { normalizeAccessLevel, CANONICAL_ACCESS_LEVELS } = require('../../../src/endpoints/user/userObjects');

describe('fix 7: userObjects.normalizeAccessLevel — canonical access_level enforcement', () => {
   it('exposes the exact canonical set the frontend role gates check against', () => {
      expect(CANONICAL_ACCESS_LEVELS).to.deep.equal(['Super Admin', 'Admin', 'Manager', 'User']);
   });

   CANONICAL_ACCESS_LEVELS.forEach(level => {
      it(`accepts the canonical value "${level}" unchanged`, () => {
         expect(normalizeAccessLevel(level)).to.equal(level);
      });
   });

   it('normalizes case/whitespace variants to the canonical casing', () => {
      expect(normalizeAccessLevel('super admin')).to.equal('Super Admin');
      expect(normalizeAccessLevel('SUPER ADMIN')).to.equal('Super Admin');
      expect(normalizeAccessLevel('  admin  ')).to.equal('Admin');
      expect(normalizeAccessLevel('manager')).to.equal('Manager');
      expect(normalizeAccessLevel('user')).to.equal('User');
   });

   it('rejects a legacy/non-canonical value like "employee" instead of silently persisting it', () => {
      expect(() => normalizeAccessLevel('employee')).to.throw(/Invalid access level/);
   });

   it('rejects an empty/missing value', () => {
      expect(() => normalizeAccessLevel(undefined)).to.throw(/Invalid access level/);
      expect(() => normalizeAccessLevel('')).to.throw(/Invalid access level/);
   });

   it('attaches status 400 to the thrown error so route handlers can respond with 400 instead of a generic 500', () => {
      try {
         normalizeAccessLevel('bogus-role');
         throw new Error('expected normalizeAccessLevel to throw');
      } catch (err) {
         expect(err.status).to.equal(400);
      }
   });
});
