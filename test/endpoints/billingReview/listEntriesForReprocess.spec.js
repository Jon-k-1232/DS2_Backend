const billingReviewService = require('../../../src/endpoints/billingReview/billingReview-service');

const buildDb = (rows) => {
   const _build = () => {
      const state = { whereChain: [], whereNullField: null, limit: null, orderBy: null };
      const builder = {};
      builder.where = (...args) => {
         if (args.length === 1 && typeof args[0] === 'object') {
            for (const [k, v] of Object.entries(args[0])) state.whereChain.push(r => r[k] === v);
         } else if (args.length === 2) {
            state.whereChain.push(r => r[args[0]] === args[1]);
         }
         return builder;
      };
      builder.whereNull = field => { state.whereChain.push(r => r[field] == null); return builder; };
      builder.whereNotNull = field => { state.whereChain.push(r => r[field] != null); return builder; };
      builder.orderBy = (f, dir) => { state.orderBy = { f, dir }; return builder; };
      builder.limit = n => { state.limit = n; return builder; };
      builder.select = field => {
         let matching = rows.filter(r => state.whereChain.every(p => p(r)));
         if (state.orderBy) {
            const { f, dir } = state.orderBy;
            matching = [...matching].sort((a, b) => (dir === 'desc' ? b[f] - a[f] : a[f] - b[f]));
         }
         if (state.limit) matching = matching.slice(0, state.limit);
         return Promise.resolve(matching.map(r => ({ [field]: r[field] })));
      };
      return builder;
   };
   return () => _build();
};

describe('billingReview-service listEntriesForReprocess', () => {
   const baseRow = { account_id: 1, is_processed: false, is_deleted: false };
   const rows = [
      { ...baseRow, timesheet_entry_id: 1, hold_reason: 'legacy_pre_ai', ai_attempted_at: null,            created_at: 1 },
      { ...baseRow, timesheet_entry_id: 2, hold_reason: 'bedrock_error', ai_attempted_at: new Date(),       created_at: 2 },
      { ...baseRow, timesheet_entry_id: 3, hold_reason: 'low_ai_confidence', ai_attempted_at: new Date(),   created_at: 3 },
      { ...baseRow, timesheet_entry_id: 4, hold_reason: null,            ai_attempted_at: null,             created_at: 4 },
      { ...baseRow, timesheet_entry_id: 5, hold_reason: 'ambiguous_category', ai_attempted_at: new Date(),  created_at: 5 },
      { account_id: 1, is_processed: true, is_deleted: false, timesheet_entry_id: 99, hold_reason: null, ai_attempted_at: new Date(), created_at: 0 },
      { account_id: 2, is_processed: false, is_deleted: false, timesheet_entry_id: 100, hold_reason: 'legacy_pre_ai', ai_attempted_at: null, created_at: 6 }
   ];

   it("'unprocessed' mode picks up rows where ai_attempted_at IS NULL", async () => {
      const db = buildDb(rows);
      const ids = await billingReviewService.listEntriesForReprocess(db, 1, { mode: 'unprocessed' });
      // Rows 1 and 4 have ai_attempted_at null; row 99 is processed; row 100 is wrong account.
      expect(ids).to.deep.equal([1, 4]);
   });

   it("'errored' mode picks up only bedrock_error", async () => {
      const db = buildDb(rows);
      const ids = await billingReviewService.listEntriesForReprocess(db, 1, { mode: 'errored' });
      expect(ids).to.deep.equal([2]);
   });

   it("'all_held' mode picks up every still-held row regardless of why", async () => {
      const db = buildDb(rows);
      const ids = await billingReviewService.listEntriesForReprocess(db, 1, { mode: 'all_held' });
      expect(ids).to.deep.equal([1, 2, 3, 5]);
   });

   it('respects the limit parameter and caps at 2000', async () => {
      const db = buildDb(rows);
      const ids = await billingReviewService.listEntriesForReprocess(db, 1, { mode: 'all_held', limit: 2 });
      expect(ids).to.have.lengthOf(2);
   });

   it('throws on unknown mode', async () => {
      const db = buildDb(rows);
      let caught = null;
      try { await billingReviewService.listEntriesForReprocess(db, 1, { mode: 'bogus' }); } catch (e) { caught = e; }
      expect(caught).to.be.an('error');
      expect(caught.message).to.contain('unknown reprocess mode');
   });

   it('account isolation: account 2 sees only its own row', async () => {
      const db = buildDb(rows);
      const ids = await billingReviewService.listEntriesForReprocess(db, 2, { mode: 'unprocessed' });
      expect(ids).to.deep.equal([100]);
   });
});
