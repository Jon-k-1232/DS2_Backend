const { _isAccountAllowed } = require('../../../src/endpoints/timesheets/auto-ingest-runner');

describe('auto-ingest-runner _isAccountAllowed', () => {
   const original = process.env.TIME_TRACKER_AI_FEATURE_FLAG;
   const originalList = process.env.TIME_TRACKER_AI_TEST_ACCOUNT_IDS;
   afterEach(() => {
      process.env.TIME_TRACKER_AI_FEATURE_FLAG = original;
      process.env.TIME_TRACKER_AI_TEST_ACCOUNT_IDS = originalList;
   });

   it('returns false for any account when flag is "off" or unset', () => {
      delete process.env.TIME_TRACKER_AI_FEATURE_FLAG;
      expect(_isAccountAllowed(9001)).to.equal(false);
      process.env.TIME_TRACKER_AI_FEATURE_FLAG = 'off';
      expect(_isAccountAllowed(9001)).to.equal(false);
   });

   it('returns true for any account when flag is "on"', () => {
      process.env.TIME_TRACKER_AI_FEATURE_FLAG = 'on';
      expect(_isAccountAllowed(9001)).to.equal(true);
      expect(_isAccountAllowed(1)).to.equal(true);
   });

   it('returns true only for listed accounts when flag is "test"', () => {
      process.env.TIME_TRACKER_AI_FEATURE_FLAG = 'test';
      process.env.TIME_TRACKER_AI_TEST_ACCOUNT_IDS = '9001, 42';
      expect(_isAccountAllowed(9001)).to.equal(true);
      expect(_isAccountAllowed(42)).to.equal(true);
      expect(_isAccountAllowed(99)).to.equal(false);
   });

   it('returns false in test mode when list is empty', () => {
      process.env.TIME_TRACKER_AI_FEATURE_FLAG = 'test';
      process.env.TIME_TRACKER_AI_TEST_ACCOUNT_IDS = '';
      expect(_isAccountAllowed(9001)).to.equal(false);
   });
});
