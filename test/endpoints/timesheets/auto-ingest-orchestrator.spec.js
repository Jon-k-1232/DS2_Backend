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

const orchestrator = require('../../../src/endpoints/timesheets/auto-ingest-orchestrator');

describe('auto-ingest-orchestrator _gateDecision (customer ambiguity)', () => {
   const goodEmployee = { userId: 7, displayName: 'Eliza Smith' };
   const goodSuggestion = { suggested_general_work_description_id: 7, category_confidence: 0.95 };

   it('holds with AMBIGUOUS_CUSTOMER_MATCH when the matcher returned needs_review', () => {
      const result = orchestrator._gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: { customerId: null, score: 0.95, tier: 'needs_review', candidates: [{ id: 3, score: 0.9 }, { id: 4, score: 0.9 }] },
         suggestion: goodSuggestion
      });
      expect(result).to.deep.equal({ action: 'hold', reason: orchestrator.HOLD_REASONS.AMBIGUOUS_CUSTOMER_MATCH });
   });

   it('auto-inserts a reviewer-confirmed alias match', () => {
      const result = orchestrator._gateDecision({
         employeeMatch: goodEmployee,
         customerMatch: { customerId: 6, score: 0.95, tier: 'confirmed_alias' },
         suggestion: goodSuggestion
      });
      expect(result.action).to.equal('auto_insert');
   });
});

describe('auto-ingest-orchestrator _computeTimeAmounts (C1: 6-minute increments, rounded UP)', () => {
   // The firm bills in 0.1h (6-minute) units, rounded UP — Math.ceil(minutes / 6),
   // the SAME rule the frontend's TimeTrackingIncrements.js already applies.
   // Every expected value below is hand-computed independently of the
   // implementation: quantity = ceil(minutes / 6) / 10 hours, total =
   // round2(quantity × rate).
   const table = [
      // minutes, rate, quantity, total — arithmetic in the comment
      [1, 137.5, 0.1, 13.75], // ceil(1/6)=1 -> 0.1h; 0.1 × 137.50 = 13.75
      [7, 137.5, 0.2, 27.5], // ceil(7/6)=ceil(1.167)=2 -> 0.2h; 0.2 × 137.50 = 27.50
      [20, 137.5, 0.4, 55], // ceil(20/6)=ceil(3.333)=4 -> 0.4h; 0.4 × 137.50 = 55.00
      [60, 137.5, 1.0, 137.5], // ceil(60/6)=10 -> 1.0h; 1.0 × 137.50 = 137.50
      [68, 137.5, 1.2, 165], // ceil(68/6)=ceil(11.333)=12 -> 1.2h; 1.2 × 137.50 = 165.00
      [72, 137.5, 1.2, 165], // ceil(72/6)=12 -> 1.2h; 1.2 × 137.50 = 165.00
      [125, 137.5, 2.1, 288.75], // ceil(125/6)=ceil(20.833)=21 -> 2.1h; 2.1 × 137.50 = 288.75
      [1, 75, 0.1, 7.5], // ceil(1/6)=1 -> 0.1h; 0.1 × 75 = 7.50
      [7, 75, 0.2, 15], // ceil(7/6)=2 -> 0.2h; 0.2 × 75 = 15.00
      [20, 75, 0.4, 30], // ceil(20/6)=4 -> 0.4h; 0.4 × 75 = 30.00
      [60, 75, 1.0, 75], // ceil(60/6)=10 -> 1.0h; 1.0 × 75 = 75.00
      [68, 75, 1.2, 90], // ceil(68/6)=12 -> 1.2h; 1.2 × 75 = 90.00
      [72, 75, 1.2, 90], // ceil(72/6)=12 -> 1.2h; 1.2 × 75 = 90.00
      [125, 75, 2.1, 157.5] // ceil(125/6)=21 -> 2.1h; 2.1 × 75 = 157.50
   ];
   table.forEach(([minutes, rate, quantity, total]) => {
      it(`${minutes} min @ $${rate} -> ${quantity}h, $${total}`, () => {
         expect(orchestrator._computeTimeAmounts(minutes, rate)).to.deep.equal({ quantity, unitCost: rate, totalTransaction: total });
      });
   });

   it('rounds UP to the next 6-minute increment for every whole-minute duration (independent ceil(min/6) oracle, numeric(10,2) round trip)', () => {
      for (const rate of [0, 22.5, 45, 75, 90, 137.5, 187.5, 250]) {
         for (let minutes = 1; minutes <= 600; minutes += 1) {
            const { quantity, unitCost, totalTransaction } = orchestrator._computeTimeAmounts(minutes, rate);
            const expectedTenths = Math.ceil(minutes / 6); // independent of the implementation's own internals
            expect(Math.round(quantity * 100), `minutes=${minutes} rate=${rate}`).to.equal(expectedTenths * 10);
            expect(Math.round(totalTransaction * 100)).to.equal(Math.round((Math.round(quantity * 100) * Math.round(unitCost * 100)) / 100));
            expect(Math.abs(totalTransaction - quantity * unitCost)).to.be.below(0.0051);
         }
      }
   });
});

describe('auto-ingest-orchestrator _resolveEmployeeMatch (C7)', () => {
   // Two "Alex Jones" records at different rates (rate lives on the `users`
   // row keyed by user_id, not shown here — the point is which user_id wins).
   const duplicateNamedCatalog = {
      employees: [
         { user_id: 90011, display_name: 'Alex Jones', billing_rate: 75 },
         { user_id: 90012, display_name: 'Alex Jones', billing_rate: 150 }
      ]
   };

   it("uses the validated entry.user_id (the tracker OWNER) — never a name match — when two employees share a display name", () => {
      // The row was uploaded/validated under owner 90012's id; entry.user_id
      // is the source of truth regardless of what the free-text employee_name
      // string says or which duplicate happens to sort first.
      const entry = { employee_name: 'Alex Jones', user_id: 90012 };
      const match = orchestrator._resolveEmployeeMatch(entry, duplicateNamedCatalog, {});
      expect(match).to.deep.equal({ userId: 90012, displayName: 'Alex Jones' });
   });

   it('the OTHER owner id resolves to the OTHER record (proves it is not just always picking one)', () => {
      const entry = { employee_name: 'Alex Jones', user_id: 90011 };
      const match = orchestrator._resolveEmployeeMatch(entry, duplicateNamedCatalog, {});
      expect(match).to.deep.equal({ userId: 90011, displayName: 'Alex Jones' });
   });

   it('a reviewer override (logged_for_user_id) wins even over a validated entry.user_id', () => {
      const entry = { employee_name: 'Alex Jones', user_id: 90011 };
      const match = orchestrator._resolveEmployeeMatch(entry, duplicateNamedCatalog, { logged_for_user_id: 90012 });
      expect(match).to.deep.equal({ userId: 90012, displayName: 'Alex Jones' });
   });

   it('a legacy row with NO user_id falls back to the free-text name match, which refuses (null) on a duplicate name', () => {
      const entry = { employee_name: 'Alex Jones', user_id: null };
      const match = orchestrator._resolveEmployeeMatch(entry, duplicateNamedCatalog, {});
      expect(match).to.equal(null);
   });

   it('a legacy row with no user_id still resolves a UNIQUE name normally', () => {
      const catalog = { employees: [...duplicateNamedCatalog.employees, { user_id: 90013, display_name: 'Eliza Smith', billing_rate: 90 }] };
      const entry = { employee_name: 'Eliza Smith', user_id: null };
      expect(orchestrator._resolveEmployeeMatch(entry, catalog, {})).to.deep.equal({ userId: 90013, displayName: 'Eliza Smith' });
   });
});

describe('auto-ingest-orchestrator _decideBillable', () => {
   const historyAlwaysBillable = { workDescToBillableMap: new Map([[7, { billable: 50, nonBillable: 0 }]]) };
   const suggestion = { suggested_general_work_description_id: 7 };

   it('never bills non-work time, even when history says the work desc is billable', () => {
      for (const entry of [
         { category: 'Vacation', notes: 'vacation at Arroyo Roble' },
         { category: 'Sick Day', notes: 'sick day (approved by Jim)' },
         { category: 'Holiday', notes: 'Memorial Day' },
         { category: 'PTO', notes: '' },
         { category: 'Personal Appointment', notes: 'Barber shop' },
         { category: 'Administrative', notes: 'Lunch' }
      ]) {
         expect(orchestrator._decideBillable({ entry, suggestion, customerPatterns: historyAlwaysBillable }), JSON.stringify(entry)).to.equal(false);
      }
   });

   it('keeps client work that merely mentions those words billable', () => {
      const entry = { category: 'Monthly Services', notes: 'reviewed and calculated baseline sick pay for client payroll' };
      expect(orchestrator._decideBillable({ entry, suggestion, customerPatterns: historyAlwaysBillable })).to.equal(true);
   });
});

describe('auto-ingest-orchestrator _resolveCustomerJob (tax-year handling)', () => {
   const job = (id, desc) => ({ customer_job_id: id, job_type_id: id * 10, job_description: desc });
   const patternsWith = (parentJobs, history = []) => ({
      parentJobs,
      workDescToJobMap: new Map(history.map(([wd, jobId, count]) => [wd, { customer_job_id: jobId, count }])),
      workDescToBillableMap: new Map(),
      fewShots: []
   });
   // Step 4 (most recent open parent job) is the only DB read; stub it.
   const dbReturningMostRecent = jobId => () => {
      const chain = {
         where: () => chain,
         whereNull: () => chain,
         orderBy: () => chain,
         select: () => chain,
         first: async () => (jobId ? { customer_job_id: jobId } : undefined)
      };
      return chain;
   };
   const resolve = (patterns, entry, { workDescId = 7, recent = null } = {}) =>
      orchestrator._resolveCustomerJob(dbReturningMostRecent(recent), 1, 55, entry, { workDescId, patterns });

   it('holds missing_current_year_job when the notes name a year the customer has no job for (never falls back to another year)', async () => {
      const patterns = patternsWith([job(1, '2024 Personal Income Tax Return')], [[7, 1, 12]]);
      const result = await resolve(patterns, { date: '2026-03-10', category: 'Tax Return Preparation', notes: '2025 PITR prep, reviewed K-1s' });
      expect(result.jobId).to.equal(null);
      expect(result.holdReason).to.equal(orchestrator.HOLD_REASONS.MISSING_CURRENT_YEAR_JOB);
      expect(result.holdDetail).to.include({ requested_tax_year: '2025', year_source: 'notes', fallback_job_id: 1, fallback_job_year: '2024' });
   });

   it('uses the job for the year named in the notes when it exists', async () => {
      const patterns = patternsWith([job(1, '2024 Personal Income Tax Return'), job(2, '2025 Personal Income Tax Return')], [[7, 1, 12]]);
      const result = await resolve(patterns, { date: '2026-03-10', notes: '2025 PITR prep' });
      expect(result).to.deep.equal({ jobId: 2 });
   });

   it('still routes year-stamped monthly/payroll notes to the monthly job', async () => {
      const patterns = patternsWith([job(1, '2024 Personal Income Tax Return'), job(3, 'Monthly Bookkeeping')], [[7, 1, 12]]);
      const result = await resolve(patterns, { date: '2026-01-15', notes: 'processed January 2026 payroll' });
      expect(result).to.deep.equal({ jobId: 3 });
   });

   it('keeps a year-less job when the notes name a year (no other-year fallback involved)', async () => {
      const patterns = patternsWith([job(4, 'Tax Planning')], [[7, 4, 9]]);
      const result = await resolve(patterns, { date: '2026-03-10', notes: 'Discussed 2025 estimates' });
      expect(result).to.deep.equal({ jobId: 4 });
   });

   it('no year in notes: swaps a stale-year pick to the transaction tax year', async () => {
      const patterns = patternsWith([job(1, '2024 Personal Tax Return'), job(2, '2025 Personal Tax Return')], [[7, 1, 12]]);
      const result = await resolve(patterns, { date: '2026-03-10', notes: 'Prepared return' });
      expect(result).to.deep.equal({ jobId: 2 });
   });

   it('no year in notes and no current-year job: holds with the transaction-derived tax year', async () => {
      const patterns = patternsWith([job(1, '2023 Personal Tax Return')], [[7, 1, 12]]);
      const result = await resolve(patterns, { date: '2026-03-10', notes: 'Prepared return' });
      expect(result.jobId).to.equal(null);
      expect(result.holdReason).to.equal(orchestrator.HOLD_REASONS.MISSING_CURRENT_YEAR_JOB);
      expect(result.holdDetail).to.include({ requested_tax_year: '2025', year_source: 'transaction_date', fallback_job_year: '2023' });
   });

   it('customer with no open parent job -> missing_required_field', async () => {
      const result = await resolve(patternsWith([]), { date: '2026-03-10', notes: 'x' });
      expect(result.jobId).to.equal(null);
      expect(result.holdReason).to.equal(orchestrator.HOLD_REASONS.MISSING_REQUIRED_FIELD);
   });

   it('falls back to the most recent open job via the DB when nothing else matches', async () => {
      const patterns = patternsWith([job(8, 'General Consulting'), job(9, 'Advisory')]);
      const result = await resolve(patterns, { date: '2026-03-10', notes: 'xyz' }, { workDescId: null, recent: 9 });
      expect(result).to.deep.equal({ jobId: 9 });
   });
});

describe('auto-ingest-orchestrator _safePayload', () => {
   it('keeps candidate IDs for ambiguous matches but never names', () => {
      const payload = JSON.parse(
         orchestrator._safePayload(null, {
            customerId: null,
            displayName: null,
            score: 0.9,
            tier: 'needs_review',
            reason: 'ambiguous_fuzzy_margin',
            candidates: [{ id: 3, label: 'Smith, John', score: 0.9 }, { id: 4, label: 'Smith, Jane', score: 0.9 }]
         }, { reason: 'x', requested_tax_year: '2025' })
      );
      expect(payload.customer.candidates).to.deep.equal([{ id: 3, score: 0.9 }, { id: 4, score: 0.9 }]);
      expect(payload.hold).to.deep.equal({ reason: 'x', requested_tax_year: '2025' });
      expect(JSON.stringify(payload)).to.not.contain('Smith');
   });
});
