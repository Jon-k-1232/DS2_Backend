/**
 * Covers the `Boolean(x) || true` bug (always evaluates true, so
 * is_active=false could never be saved) in the sibling jobType/
 * workDescriptions endpoints. Physically under test/endpoints/job/ per this
 * review's file-creation scope, but exercises those modules directly.
 */
const { restoreDataTypesJobTypeTableOnCreate, restoreDataTypesJobTypeTableOnUpdate } = require('../../../src/endpoints/jobType/jobTypeObjects');
const { restoreDataTypesWorkDescriptionTableOnCreate, restoreDataTypesWorkDescriptionTableOnUpdate } = require('../../../src/endpoints/workDescriptions/workDescriptionsObjects');

describe('jobTypeObjects is_job_type_active parsing', () => {
   const basePayload = overrides => ({
      accountID: 1,
      customerJobCategory: 3,
      jobDescription: 'Tax Return',
      bookRate: 100,
      estimatedStraightTime: 2,
      userID: 21,
      ...overrides
   });

   it('can save is_job_type_active=false explicitly (previously impossible)', () => {
      expect(restoreDataTypesJobTypeTableOnCreate(basePayload({ isActive: false })).is_job_type_active).to.equal(false);
      expect(restoreDataTypesJobTypeTableOnCreate(basePayload({ isActive: 'false' })).is_job_type_active).to.equal(false);
      expect(restoreDataTypesJobTypeTableOnUpdate(basePayload({ jobTypeID: 1, isActive: false })).is_job_type_active).to.equal(false);
   });

   it('still honors an explicit true', () => {
      expect(restoreDataTypesJobTypeTableOnCreate(basePayload({ isActive: true })).is_job_type_active).to.equal(true);
   });

   it('defaults to true only when the field is genuinely absent', () => {
      expect(restoreDataTypesJobTypeTableOnCreate(basePayload()).is_job_type_active).to.equal(true);
   });
});

describe('workDescriptionsObjects is_general_work_description_active parsing', () => {
   it('can save is_general_work_description_active=false explicitly (previously impossible)', () => {
      const created = restoreDataTypesWorkDescriptionTableOnCreate({ generalWorkDescription: 'Bookkeeping', estimatedTime: 1, isGeneralWorkDescriptionActive: false }, 1, 21);
      expect(created.is_general_work_description_active).to.equal(false);

      const updated = restoreDataTypesWorkDescriptionTableOnUpdate({
         generalWorkDescriptionID: 1,
         accountID: 1,
         generalWorkDescription: 'Bookkeeping',
         estimatedTime: 1,
         isGeneralWorkDescriptionActive: false,
         createdByUserID: 21
      });
      expect(updated.is_general_work_description_active).to.equal(false);
   });

   it('defaults to true only when the field is genuinely absent', () => {
      const created = restoreDataTypesWorkDescriptionTableOnCreate({ generalWorkDescription: 'Bookkeeping', estimatedTime: 1 }, 1, 21);
      expect(created.is_general_work_description_active).to.equal(true);
   });
});
