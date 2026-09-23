const { getPaginationParams, getPaginationMetadata, MAX_PAGE_LIMIT } = require('../../../src/utils/pagination');

describe('fix 9: pagination.js — hard cap on page size', () => {
   it('exports a cap of 500', () => {
      expect(MAX_PAGE_LIMIT).to.equal(500);
   });

   it('passes an ordinary limit through unchanged', () => {
      const { limit } = getPaginationParams({ page: 1, limit: 20 });
      expect(limit).to.equal(20);
   });

   it('caps a limit above 500 down to 500', () => {
      const { limit } = getPaginationParams({ page: 1, limit: 1000000 });
      expect(limit).to.equal(500);
   });

   it('caps a limit exactly at the boundary correctly (500 passes through, 501 is capped)', () => {
      expect(getPaginationParams({ page: 1, limit: 500 }).limit).to.equal(500);
      expect(getPaginationParams({ page: 1, limit: 501 }).limit).to.equal(500);
   });

   it('computes offset using the CAPPED limit, not the requested one', () => {
      const { offset, limit } = getPaginationParams({ page: 3, limit: 5000 });
      expect(limit).to.equal(500);
      expect(offset).to.equal((3 - 1) * 500);
   });

   it('still rejects a non-positive-integer page/limit', () => {
      expect(() => getPaginationParams({ page: 0, limit: 20 })).to.throw(/Invalid pagination/);
      expect(() => getPaginationParams({ page: 1, limit: 0 })).to.throw(/Invalid pagination/);
      expect(() => getPaginationParams({ page: 'x', limit: 20 })).to.throw(/Invalid pagination/);
   });

   it('getPaginationMetadata is unaffected by the cap change (pure passthrough of whatever limit it is given)', () => {
      const metadata = getPaginationMetadata(1234, 2, 500);
      expect(metadata).to.deep.equal({ page: 2, limit: 500, totalItems: 1234, totalPages: 3 });
   });
});
