const { scoreCandidates, normalize } = require('../../src/utils/fuzzyMatch');

describe('fuzzyMatch', () => {
   describe('normalize', () => {
      it('collapses whitespace and trims', () => {
         expect(normalize('  Foo   Bar  ')).to.equal('Foo Bar');
      });

      it('returns empty string for non-strings', () => {
         expect(normalize(null)).to.equal('');
         expect(normalize(123)).to.equal('');
      });
   });

   describe('scoreCandidates', () => {
      const candidates = [
         { id: 1, label: 'Acme Corporation' },
         { id: 2, label: 'Globex Industries' },
         { id: 3, label: 'Wayne Enterprises' }
      ];

      it('returns top match for a clear query', () => {
         const results = scoreCandidates('Acme Corp', candidates);
         expect(results[0].id).to.equal(1);
         expect(results[0].score).to.be.greaterThan(0.7);
      });

      it('respects scoreCutoff', () => {
         const results = scoreCandidates('xyz', candidates, { scoreCutoff: 90 });
         expect(results).to.have.lengthOf(0);
      });

      it('respects limit', () => {
         const results = scoreCandidates('Corp', candidates, { limit: 1, scoreCutoff: 0 });
         expect(results.length).to.be.at.most(1);
      });

      it('returns empty for empty query', () => {
         expect(scoreCandidates('', candidates)).to.deep.equal([]);
      });

      it('accepts string-only candidates', () => {
         const results = scoreCandidates('Acme', ['Acme Corp', 'Globex']);
         expect(results[0].label).to.equal('Acme Corp');
         expect(results[0].id).to.equal(null);
      });
   });
});
