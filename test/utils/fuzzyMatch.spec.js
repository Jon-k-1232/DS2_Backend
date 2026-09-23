const { scoreCandidates, normalize, nameTokens, canonicalNameKey, sharedNameTokenCount, conflictingLegalForms } = require('../../src/utils/fuzzyMatch');

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

      it('documents why WRatio alone is unsafe: one shared token scores >= 0.90', () => {
         const results = scoreCandidates('Smith', [{ id: 1, label: 'Smith, John' }, { id: 2, label: 'Smith, Jane' }]);
         expect(results).to.have.lengthOf(2);
         expect(results[0].score).to.be.at.least(0.9);
         expect(results[0].score).to.equal(results[1].score);
      });

      // DEFECT regression: fuzzball 2.2.6's extract() scores every candidate
      // through one shared options object; WRatio mutates it (options.partial)
      // with no reset, so a candidate's score used to depend on which rows
      // preceded it in the catalog (see the long comment on scoreCandidates in
      // src/utils/fuzzyMatch.js). Scoring must be a pure function of
      // (query, label): identical regardless of catalog order.
      it('scores do not depend on the order of the candidate catalog', () => {
         const john = { id: 1, label: 'Smith, John' };
         const jane = { id: 2, label: 'Smith, Jane' };
         const scoresIn = list => Object.fromEntries(scoreCandidates('J. Smith', list).map(c => [c.id, c.score]));

         const baseline = scoresIn([john, jane]);
         expect(scoresIn([{ id: 3, label: 'Globex Industries' }, john, jane])).to.deep.equal(baseline);
         expect(scoresIn([john, { id: 3, label: 'Globex Industries' }, jane])).to.deep.equal(baseline);
         expect(scoresIn([jane, john])).to.deep.equal(baseline);

         const mixed = scoresIn([{ id: 4, label: 'Acme Corp' }, john, { id: 3, label: 'Globex Industries' }, jane]);
         expect(mixed[john.id]).to.equal(mixed[jane.id]);
      });

      // DEFECT regression (C10): a stable sort on tied scores used to keep
      // whichever order the caller's catalog array happened to hand candidates
      // in. With ties, that made the reported candidate order — and therefore
      // which candidates survive a limit=5 truncation — depend on catalog
      // order even though every individual score was already
      // order-independent (the test above).
      it('tied scores sort deterministically by id (then label), independent of catalog order', () => {
         const candidates = [
            { id: 3, label: 'Alpha Beta Consulting Six' },
            { id: 1, label: 'Alpha Beta Consulting One' },
            { id: 5, label: 'Alpha Beta Consulting Red' },
            { id: 2, label: 'Alpha Beta Consulting Two' },
            { id: 4, label: 'Alpha Beta Consulting Ten' }
         ];
         const forward = scoreCandidates('Alpha Beta Consulting', candidates, { limit: 0, scoreCutoff: 0 });
         const reverse = scoreCandidates('Alpha Beta Consulting', [...candidates].reverse(), { limit: 0, scoreCutoff: 0 });
         const shuffled = scoreCandidates('Alpha Beta Consulting', [candidates[2], candidates[4], candidates[0], candidates[3], candidates[1]], { limit: 0, scoreCutoff: 0 });
         expect(forward).to.deep.equal(reverse);
         expect(forward).to.deep.equal(shuffled);
         // Every candidate ties on score (same shared prefix, distinguished only
         // by the last word) — the tie-break must be id order.
         expect(new Set(forward.map(c => c.score)).size).to.equal(1);
         expect(forward.map(c => c.id)).to.deep.equal([1, 2, 3, 4, 5]);
      });
   });

   describe('legal-form conflicts (C5)', () => {
      it('Inc vs LLC is a conflict (different explicit legal forms)', () => {
         expect(conflictingLegalForms('Acme Inc', 'Acme LLC')).to.equal(true);
         expect(conflictingLegalForms('Acme LLC', 'Acme Inc')).to.equal(true);
      });

      it('Corp vs Corporation is NOT a conflict (same canonical legal form)', () => {
         expect(conflictingLegalForms('Acme Corp', 'Acme Corporation')).to.equal(false);
      });

      it('a name with no legal suffix never conflicts with one that has one', () => {
         expect(conflictingLegalForms('Acme', 'Acme Inc')).to.equal(false);
         expect(conflictingLegalForms('Acme Inc', 'Acme')).to.equal(false);
      });

      it('two names with the SAME explicit legal form do not conflict', () => {
         expect(conflictingLegalForms('Acme Inc', 'Acme Inc')).to.equal(false);
         expect(conflictingLegalForms('Red Rock Windows LLC', 'Blue Sky Doors LLC')).to.equal(false);
      });

      // DEFECT regression (C5-1): a shared generic token ('Company'/'Co', both
      // canonicalize to 'co') used to make the whole check pass even though
      // each side ALSO carried a genuinely different legal form the other
      // side lacked (llc vs inc) — because the old check only required ONE
      // overlapping form, not full set agreement. 'Acme Company LLC'
      // (['co','llc']) and 'Acme Company Inc' (['co','inc']) share 'co' but
      // disagree on llc/inc, so they must still conflict.
      it('a shared "Company"/"Co" token does not mask a genuine LLC-vs-Inc conflict', () => {
         expect(conflictingLegalForms('Acme Company LLC', 'Acme Company Inc')).to.equal(true);
         expect(conflictingLegalForms('Acme Co LLC', 'Acme Co Inc')).to.equal(true);
         expect(conflictingLegalForms('Acme Company Inc', 'Acme Co LLC')).to.equal(true);
      });

      it('two names that both carry Company/Co plus the SAME additional form do not conflict', () => {
         expect(conflictingLegalForms('Acme Company LLC', 'Acme Co LLC')).to.equal(false);
         expect(conflictingLegalForms('Acme Company Inc', 'Acme Co Incorporated')).to.equal(false); // 'incorporated' canonicalizes to 'inc'
      });
   });

   describe('name tokens', () => {
      it('drops legal suffixes, connectors and punctuation', () => {
         expect(nameTokens('Red Rock Windows & Doors, LLC')).to.deep.equal(['red', 'rock', 'windows', 'doors']);
         expect(nameTokens("Jake's Custom Framing")).to.deep.equal(['jakes', 'custom', 'framing']);
         expect(nameTokens('Acme Corporation')).to.deep.equal(['acme']);
      });

      it('canonicalNameKey is order / case / punctuation / suffix insensitive', () => {
         expect(canonicalNameKey('Smith, John')).to.equal(canonicalNameKey('john SMITH'));
         expect(canonicalNameKey('James F. Kimmel & Associates')).to.equal(canonicalNameKey('James F Kimmel & Associates'));
         expect(canonicalNameKey('Exodus Sales Collective LLC')).to.equal(canonicalNameKey('Exodus Sales Collective, LLC'));
         expect(canonicalNameKey('LTDFH III')).to.not.equal(canonicalNameKey('LTDFH TOO'));
         expect(canonicalNameKey('LLC')).to.equal('');
      });

      it('sharedNameTokenCount counts distinct identifying tokens in common', () => {
         expect(sharedNameTokenCount('Wallace Illsley', 'Donald Illsley')).to.equal(1);
         expect(sharedNameTokenCount('Wallace Illsley', 'Wallace and Marilyn Illsley')).to.equal(2);
         expect(sharedNameTokenCount('Acme Inc', 'Acme Corp')).to.equal(1);
         expect(sharedNameTokenCount('Smith Smith', 'Smith, John')).to.equal(1);
         expect(sharedNameTokenCount('', 'Smith, John')).to.equal(0);
      });
   });
});
