const { _gateDecision, HOLD_REASONS } = require('../../../src/endpoints/timesheets/auto-ingest-orchestrator');

describe('auto-ingest-orchestrator _gateDecision', () => {
   const goodEmployee = { userId: 7, displayName: 'Eliza Smith' };
   const goodCustomer = { customerId: 1, displayName: 'Acme Corp', score: 1.0, tier: 'exact' };
   const goodSuggestion = { suggested_general_work_description_id: 7, category_confidence: 0.95 };

   it('auto_inserts when employee, customer, and category are all confident', () => {
      const result = _gateDecision({ employeeMatch: goodEmployee, customerMatch: goodCustomer, suggestion: goodSuggestion });
      expect(result.action).to.equal('auto_insert');
   });

   it('holds with EMPLOYEE_NOT_MATCHED when employee is null', () => {
      const result = _gateDecision({ employeeMatch: null, customerMatch: goodCustomer, suggestion: goodSuggestion });
      expect(result.action).to.equal('hold');
      expect(result.reason).to.equal(HOLD_REASONS.EMPLOYEE_NOT_MATCHED);
   });

   it('holds with NO_MATCHING_CUSTOMER when customerId is null', () => {
      const result = _gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: { customerId: null, score: 0, tier: 'none' },
         suggestion: goodSuggestion
      });
      expect(result.reason).to.equal(HOLD_REASONS.NO_MATCHING_CUSTOMER);
   });

   it('holds with BEDROCK_ERROR when suggestion is null', () => {
      const result = _gateDecision({ employeeMatch: goodEmployee, customerMatch: goodCustomer, suggestion: null });
      expect(result.reason).to.equal(HOLD_REASONS.BEDROCK_ERROR);
   });

   it('holds with MISSING_REQUIRED_FIELD when no GWD ID', () => {
      const result = _gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: goodCustomer,
         suggestion: { suggested_general_work_description_id: null, category_confidence: 0.95 }
      });
      expect(result.reason).to.equal(HOLD_REASONS.MISSING_REQUIRED_FIELD);
   });

   it('holds with AMBIGUOUS_CATEGORY when combined confidence < 0.65', () => {
      const result = _gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: goodCustomer,
         suggestion: { suggested_general_work_description_id: 7, category_confidence: 0.55 }
      });
      expect(result.reason).to.equal(HOLD_REASONS.AMBIGUOUS_CATEGORY);
   });

   it('holds with LOW_AI_CONFIDENCE when 0.65 <= combined < 0.85', () => {
      const result = _gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: goodCustomer,
         suggestion: { suggested_general_work_description_id: 7, category_confidence: 0.78 }
      });
      expect(result.reason).to.equal(HOLD_REASONS.LOW_AI_CONFIDENCE);
   });

   it('holds with LOW_AI_CONFIDENCE when fuzzy_high tier but score < FUZZY_HIGH_THRESHOLD', () => {
      const result = _gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: { customerId: 1, displayName: 'Acme', score: 0.88, tier: 'fuzzy_high' },
         suggestion: { suggested_general_work_description_id: 7, category_confidence: 0.95 }
      });
      // combined is min(0.95, 0.88) = 0.88, above 0.85 threshold,
      // but the fuzzy_high score check should trip the LOW_AI_CONFIDENCE hold.
      expect(result.action).to.equal('hold');
      expect(result.reason).to.equal(HOLD_REASONS.LOW_AI_CONFIDENCE);
   });

   it('combined confidence is gated by the weakest leg', () => {
      // Strong category, weak customer match (just at floor 0.65) -> still holds.
      const result = _gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: { customerId: 1, score: 0.66, tier: 'llm_tiebreak' },
         suggestion: { suggested_general_work_description_id: 7, category_confidence: 0.99 }
      });
      expect(result.action).to.equal('hold');
      expect(result.reason).to.equal(HOLD_REASONS.LOW_AI_CONFIDENCE);
   });
});
