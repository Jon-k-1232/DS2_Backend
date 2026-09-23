const { matchCustomer, NEEDS_REVIEW_TIER } = require('../../src/ai_integrations/customerMatching');
const { canonicalNameKey } = require('../../src/utils/fuzzyMatch');

const customers = [
   { customer_id: 1, display_name: 'Acme Corp' },
   { customer_id: 2, display_name: 'Globex Industries' },
   { customer_id: 3, display_name: 'Smith, John' },
   { customer_id: 4, display_name: 'Smith, Jane' }
];

// Near-duplicate names that share a token. WRatio scores the shared-token pairs
// at 0.90-0.95, which used to auto-bill whichever household sorted first.
const nearDuplicates = [
   ...customers,
   { customer_id: 10, display_name: 'LTDFH III' },
   { customer_id: 11, display_name: 'LTDFH TOO' },
   { customer_id: 12, display_name: 'Donald Illsley' },
   { customer_id: 13, display_name: 'Wallace and Marilyn  Illsley' },
   { customer_id: 14, display_name: 'Jeff and Shelby Purdy' },
   { customer_id: 15, display_name: 'Kimmel Financial Partners' },
   { customer_id: 16, display_name: 'Jonathon and Kathy Kimmel' },
   { customer_id: 17, display_name: 'Timothy Oliverson' },
   { customer_id: 18, display_name: 'Suzanna Oliverson' }
];

const failingInvoker = () => Promise.reject(new Error('should not be called'));

const expectHeld = result => {
   expect(result.tier).to.equal(NEEDS_REVIEW_TIER);
   expect(result.customerId).to.equal(null);
};

describe('customerMatching matchCustomer', () => {
   it('returns tier=exact on exact display_name', async () => {
      const result = await matchCustomer({
         searchName: 'acme corp',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.tier).to.equal('exact');
      expect(result.customerId).to.equal(1);
      expect(result.score).to.equal(1.0);
   });

   it('matches a legal-suffix / punctuation variant as an exact business-name match without Bedrock', async () => {
      const result = await matchCustomer({
         searchName: 'Acme Corporation',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.tier).to.equal('exact');
      expect(result.reason).to.equal('canonical_name_match');
      expect(result.customerId).to.equal(1);
   });

   it('returns tier=none when no candidate clears MATCH_THRESHOLD', async () => {
      const result = await matchCustomer({
         searchName: 'Zyxx Quaerendum',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.tier).to.equal('none');
      expect(result.customerId).to.equal(null);
   });

   it('escalates to Bedrock when fuzzy is in [matchThreshold, llmSkipThreshold) range', async () => {
      let invoked = 0;
      const fakeInvoker = ({ feature }) => {
         invoked += 1;
         expect(feature).to.equal('customer_match');
         return Promise.resolve({
            json: { match_id: 3, match_confidence: 0.78, reason: 'John Smith Jr is the son on the Smith, John account' },
            cost: 0.001
         });
      };
      // Force the LLM tier by setting llmSkipThreshold above any plausible fuzzy score.
      const result = await matchCustomer({
         searchName: 'John Smith Jr',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(invoked).to.equal(1);
      expect(result.tier).to.equal('llm_tiebreak');
      expect(result.customerId).to.equal(3);
      // The LLM's free-text reason echoes customer names and is persisted into
      // ai_payload downstream — it must never be passed through.
      expect(result.reason).to.equal('llm_picked');
      expect(JSON.stringify(result.reason)).to.not.contain('Smith');
   });

   it('returns tier=llm_no_match when Bedrock returns null match_id', async () => {
      const fakeInvoker = () => Promise.resolve({ json: { match_id: null, match_confidence: 0, reason: 'shared last name only: Smith' } });
      const result = await matchCustomer({
         searchName: 'Smithe',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(result.tier).to.equal('llm_no_match');
      expect(result.customerId).to.equal(null);
      expect(result.reason).to.equal('llm_returned_null');
   });

   it('returns tier=llm_invalid_id when Bedrock returns an unknown id', async () => {
      const fakeInvoker = () => Promise.resolve({ json: { match_id: 9999, match_confidence: 0.9 } });
      const result = await matchCustomer({
         searchName: 'John S.',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(result.tier).to.equal('llm_invalid_id');
   });

   it('returns tier=llm_error when Bedrock throws', async () => {
      const fakeInvoker = () => Promise.reject(new Error('rate limited'));
      const result = await matchCustomer({
         searchName: 'John S.',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: fakeInvoker,
         llmSkipThreshold: 1.01
      });
      expect(result.tier).to.equal('llm_error');
      expect(result.reason).to.contain('bedrock_error');
   });

   it('returns reason=empty_search for blank input', async () => {
      const result = await matchCustomer({
         searchName: '   ',
         customerCatalog: customers,
         accountId: 1,
         bedrockInvoker: failingInvoker
      });
      expect(result.reason).to.equal('empty_search');
   });

   describe('near-duplicate names (never auto-bill the wrong household)', () => {
      const run = (searchName, extra = {}) =>
         matchCustomer({ searchName, customerCatalog: nearDuplicates, accountId: 1, bedrockInvoker: failingInvoker, ...extra });

      it('"John Smith" resolves to "Smith, John" (not "Smith, Jane") via the canonical name', async () => {
         const result = await run('John Smith');
         expect(result.tier).to.equal('exact');
         expect(result.customerId).to.equal(3);
      });

      it('"Jane Smith" resolves to "Smith, Jane"', async () => {
         const result = await run('Jane Smith');
         expect(result.customerId).to.equal(4);
      });

      it('last name only ("Smith") ties the two Smith households -> needs_review with both candidates, no Bedrock call', async () => {
         const result = await run('Smith');
         expectHeld(result);
         const ids = result.candidates.map(c => c.id);
         expect(ids).to.include.members([3, 4]);
      });

      it('"Smith, J" is held (only one shared name token with either household)', async () => {
         const pickJohn = () => Promise.resolve({ json: { match_id: 3, match_confidence: 0.95, reason: 'guess' } });
         const result = await run('Smith, J', { bedrockInvoker: pickJohn });
         expectHeld(result);
      });

      it('a Bedrock tiebreak pick that shares only one name token is held, not auto-billed', async () => {
         const pickJohn = () => Promise.resolve({ json: { match_id: 3, match_confidence: 0.95, reason: 'guess' } });
         const result = await run('Smith, J', { bedrockInvoker: pickJohn, llmSkipThreshold: 1.01 });
         expectHeld(result);
         expect(result.reason).to.equal('llm_pick_insufficient_name_token_agreement');
      });

      it('"LTDFH" ties "LTDFH III" / "LTDFH TOO" -> needs_review listing both', async () => {
         const result = await run('LTDFH');
         expectHeld(result);
         expect(result.candidates.map(c => c.id)).to.include.members([10, 11]);
         expect(result.candidates[0].score - result.candidates[1].score).to.be.below(0.08);
      });

      it('two households that both contain the searched first + last name are held (margin rule)', async () => {
         const catalog = [
            { customer_id: 30, display_name: 'Joel and Angela Tufte' },
            { customer_id: 31, display_name: 'Joel and Misty Tufte' }
         ];
         const result = await matchCustomer({ searchName: 'Joel Tufte', customerCatalog: catalog, accountId: 1, bedrockInvoker: failingInvoker, llmSkipThreshold: 0.8 });
         expectHeld(result);
         expect(result.reason).to.equal('ambiguous_fuzzy_margin');
      });

      it('"LTDFH 3" is held (shares only the LTDFH token with either entity)', async () => {
         const result = await run('LTDFH 3', { bedrockInvoker: () => Promise.resolve({ json: { match_id: 10, match_confidence: 0.9 } }) });
         expectHeld(result);
      });

      it('"LTDFH III" and "LTDFH Too" each resolve to their own entity', async () => {
         expect((await run('LTDFH III')).customerId).to.equal(10);
         expect((await run('ltdfh too')).customerId).to.equal(11);
      });

      // Pure per-candidate WRatio scores 'Wallace Illsley' vs 'Donald Illsley' at
      // 0.69 and vs the joint 'Wallace and Marilyn Illsley' household at 0.86 — both
      // below llmSkipThreshold, so this now correctly reaches the LLM tiebreak
      // rather than being held by the fuzzy-only path directly (see
      // src/utils/fuzzyMatch.js scoreCandidates: fuzzball 2.2.6's extract() used to
      // leak state across candidates and could inflate a shared-surname score like
      // this pair's to ~0.95 depending on catalog order). Even a same-surname
      // Bedrock guess must still clear the 2-shared-token bar.
      it('"Wallace Illsley" is NOT auto-matched to "Donald Illsley" even when Bedrock guesses it', async () => {
         const guessDonald = () => Promise.resolve({ json: { match_id: 12, match_confidence: 0.9, reason: 'guess' } });
         const result = await run('Wallace Illsley', { bedrockInvoker: guessDonald });
         expectHeld(result);
         expect(result.reason).to.equal('llm_pick_insufficient_name_token_agreement');
      });

      it('still auto-matches a spouse to the joint household when two name tokens agree and the margin is clear', async () => {
         const result = await run('Shelby Purdy');
         expect(result.tier).to.equal('fuzzy_high');
         expect(result.customerId).to.equal(14);
      });

      // Pure scoring puts 'Kimmel Financial Partners' clearly ahead of 'Jonathon and
      // Kathy Kimmel' (0.80 vs 0.53 — no longer a fuzzy-score near-tie; the
      // 'ambiguous_fuzzy_margin' reason this used to hit is covered directly above
      // by the Tufte households test, which forces that branch with an explicit
      // llmSkipThreshold override instead of relying on two organic scores landing
      // close together). Below llmSkipThreshold either way, so this reaches the LLM
      // tiebreak; a Bedrock guess of the OTHER Kimmel household still can't clear
      // the 2-shared-token bar (shares only "kimmel"), so it stays held without a
      // reviewer-confirmed alias.
      it('a near-tie between two-token matches is held without a reviewer-confirmed alias', async () => {
         const guessOtherKimmelHousehold = () => Promise.resolve({ json: { match_id: 16, match_confidence: 0.7, reason: 'guess' } });
         const result = await run('Kimmel Financial Advisors', { bedrockInvoker: guessOtherKimmelHousehold });
         expectHeld(result);
         expect(result.reason).to.equal('llm_pick_insufficient_name_token_agreement');
      });

      it('a reviewer-confirmed alias breaks the near-tie', async () => {
         const confirmedAliases = new Map([[canonicalNameKey('Kimmel Financial Advisors'), 15]]);
         const result = await run('Kimmel Financial Advisors', { confirmedAliases });
         expect(result.tier).to.equal('confirmed_alias');
         expect(result.customerId).to.equal(15);
      });

      // The confirmed alias itself only shares one token ("oliverson") with the
      // search name, so _hasNameAgreement rejects it regardless of margin — it
      // never even reaches the confirmed_alias short circuit. Below
      // llmSkipThreshold, this falls to the LLM tiebreak; simulating Bedrock
      // guessing the VERY customer the alias points at proves the 2-token rule
      // beats a direct LLM pick too, not just the alias map.
      it('a reviewer-confirmed alias can never override the two-token rule', async () => {
         const confirmedAliases = new Map([[canonicalNameKey('Dana Oliverson'), 17]]);
         const guessAliasedCustomer = () => Promise.resolve({ json: { match_id: 17, match_confidence: 0.8, reason: 'guess' } });
         const result = await run('Dana Oliverson', { confirmedAliases, bedrockInvoker: guessAliasedCustomer });
         expectHeld(result);
         expect(result.reason).to.equal('llm_pick_insufficient_name_token_agreement');
      });

      it('duplicate display names are held instead of picking the first one', async () => {
         const dupes = [...nearDuplicates, { customer_id: 99, display_name: 'Acme Corp' }];
         const result = await matchCustomer({ searchName: 'Acme Corp', customerCatalog: dupes, accountId: 1, bedrockInvoker: failingInvoker });
         expectHeld(result);
         expect(result.reason).to.equal('duplicate_display_name');
         expect(result.candidates.map(c => c.id)).to.have.members([1, 99]);
      });
   });

   // DEFECT regression (C5): canonicalNameKey() strips ALL legal suffixes, so
   // 'Acme Inc' and 'Acme LLC' canonicalize to the identical key 'acme' and
   // used to match at tier=exact/score=1 with no review, no margin check and
   // no shared-token safeguard — silently billing a DIFFERENT legal entity
   // than the one on the tracker. conflictingLegalForms() now excludes an
   // explicit-legal-form conflict from both the canonical-exact tier and the
   // fuzzy/alias/LLM name-agreement check.
   describe('conflicting legal forms never auto-match (C5)', () => {
      it('"Acme LLC" searched against a catalog that only has "Acme Inc" is held, not matched exact/canonical', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme Inc' }];
         const result = await matchCustomer({ searchName: 'Acme LLC', customerCatalog: catalog, accountId: 1, bedrockInvoker: failingInvoker });
         expect(result.tier).to.not.equal('exact');
         expect(result.customerId).to.equal(null);
      });

      it('"Acme Inc" searched against a catalog that only has "Acme LLC" is likewise never auto-matched, even via the LLM tiebreak', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme LLC' }];
         const pickIt = () => Promise.resolve({ json: { match_id: 1, match_confidence: 0.9, reason: 'looks the same to me' } });
         const result = await matchCustomer({ searchName: 'Acme Inc', customerCatalog: catalog, accountId: 1, bedrockInvoker: pickIt, llmSkipThreshold: 1.01 });
         expectHeld(result);
         expect(result.reason).to.equal('llm_pick_insufficient_name_token_agreement');
      });

      it('"Acme Corp" still resolves to "Acme Corporation" (same canonical legal form, not a conflict)', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme Corporation' }];
         const result = await matchCustomer({ searchName: 'Acme Corp', customerCatalog: catalog, accountId: 1, bedrockInvoker: failingInvoker });
         expect(result.tier).to.equal('exact');
         expect(result.reason).to.equal('canonical_name_match');
         expect(result.customerId).to.equal(1);
      });

      it('a bare name with no legal suffix still resolves to the one candidate that has one (no conflict, existing rule unchanged)', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme Inc' }];
         const result = await matchCustomer({ searchName: 'Acme', customerCatalog: catalog, accountId: 1, bedrockInvoker: failingInvoker });
         expect(result.tier).to.equal('exact');
         expect(result.reason).to.equal('canonical_name_match');
         expect(result.customerId).to.equal(1);
      });

      // C5-1 regression: a shared generic 'Company'/'Co' token used to mask a
      // genuine LLC-vs-Inc conflict (both canonicalize 'co' as a legal form,
      // so the OLD any-overlap check treated them as compatible even though
      // 'llc' never appears on the Inc side and 'inc' never appears on the
      // LLC side). These names — unlike the plain Inc/LLC cases above — each
      // carry TWO legal-form tokens.
      it('"Acme Company LLC" vs catalog "Acme Company Inc" is never an exact/canonical match despite sharing the Company/Co token', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme Company Inc' }];
         const result = await matchCustomer({ searchName: 'Acme Company LLC', customerCatalog: catalog, accountId: 1, bedrockInvoker: failingInvoker });
         expect(result.tier).to.not.equal('exact');
         expect(result.customerId).to.equal(null);
      });

      it('"Acme Company LLC" vs "Acme Company Inc" is never auto-matched via the LLM tiebreak either', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme Company Inc' }];
         const pickIt = () => Promise.resolve({ json: { match_id: 1, match_confidence: 0.9, reason: 'shares Company' } });
         const result = await matchCustomer({ searchName: 'Acme Company LLC', customerCatalog: catalog, accountId: 1, bedrockInvoker: pickIt, llmSkipThreshold: 1.01 });
         expectHeld(result);
         expect(result.reason).to.equal('llm_pick_insufficient_name_token_agreement');
      });

      it('a reviewer-confirmed alias pointing at a conflicting legal form (Company LLC -> Company Inc) is never honored', async () => {
         const catalog = [{ customer_id: 1, display_name: 'Acme Company Inc' }];
         const confirmedAliases = new Map([[canonicalNameKey('Acme Company LLC'), 1]]);
         const result = await matchCustomer({ searchName: 'Acme Company LLC', customerCatalog: catalog, accountId: 1, bedrockInvoker: failingInvoker, confirmedAliases, llmSkipThreshold: 1.01 });
         expect(result.tier).to.not.equal('confirmed_alias');
         expect(result.customerId).to.not.equal(1);
      });
   });

   // DEFECT regression (C10): truncating the fuzzy candidate list to the
   // top-5 BEFORE looking up a reviewer-confirmed alias used to make the
   // match decision depend on catalog/tie order whenever a wide tie pushed
   // the alias's own customer outside the displayed top five.
   describe('confirmed-alias eligibility across a wide tie (C10)', () => {
      // Six candidates that all tie on fuzzy score against the search name
      // (same pattern astra-review4/run-C's extra-probe.js used: one shared
      // prefix, six single, similarly-shaped trailing words).
      const sixWayTie = [
         { customer_id: 1, display_name: 'Alpha Beta Consulting One' },
         { customer_id: 2, display_name: 'Alpha Beta Consulting Two' },
         { customer_id: 3, display_name: 'Alpha Beta Consulting Six' },
         { customer_id: 4, display_name: 'Alpha Beta Consulting Ten' },
         { customer_id: 5, display_name: 'Alpha Beta Consulting Red' },
         { customer_id: 6, display_name: 'Alpha Beta Consulting Sky' }
      ];
      // The alias points at id 6. Our C10 tie-break sorts ties by id ascending,
      // so a six-way tie is ALWAYS reported/displayed as [1,2,3,4,5] — id 6
      // NEVER appears in the top-5 `candidates` list, in ANY catalog input
      // order, precisely BECAUSE the sort is now deterministic. Picking id 1
      // here would prove nothing (id 1 always lands in the top 5 regardless
      // of whether alias eligibility is checked against the displayed top-5
      // or the full qualifying set — a truncation-before-alias-lookup bug
      // would still pass). Only id 6 — provably and permanently outside the
      // displayed candidates — can distinguish the two.
      const confirmedAliases = new Map([[canonicalNameKey('Alpha Beta Consulting'), 6]]);

      it('the alias resolves customer 6 in forward catalog order, even though 6 is absent from the displayed top-5 candidates', async () => {
         const result = await matchCustomer({ searchName: 'Alpha Beta Consulting', customerCatalog: sixWayTie, accountId: 1, bedrockInvoker: failingInvoker, confirmedAliases });
         expect(result.tier).to.equal('confirmed_alias');
         expect(result.customerId).to.equal(6);
         expect(result.candidates.map(c => c.id)).to.deep.equal([1, 2, 3, 4, 5]);
         expect(result.candidates.map(c => c.id)).to.not.include(6);
      });

      it('the alias STILL resolves customer 6 in reverse catalog order (same decision, not order-dependent)', async () => {
         const result = await matchCustomer({ searchName: 'Alpha Beta Consulting', customerCatalog: [...sixWayTie].reverse(), accountId: 1, bedrockInvoker: failingInvoker, confirmedAliases });
         expect(result.tier).to.equal('confirmed_alias');
         expect(result.customerId).to.equal(6);
         expect(result.candidates.map(c => c.id)).to.not.include(6);
      });

      it('and in a shuffled catalog order', async () => {
         const shuffled = [sixWayTie[3], sixWayTie[1], sixWayTie[5], sixWayTie[0], sixWayTie[4], sixWayTie[2]];
         const result = await matchCustomer({ searchName: 'Alpha Beta Consulting', customerCatalog: shuffled, accountId: 1, bedrockInvoker: failingInvoker, confirmedAliases });
         expect(result.tier).to.equal('confirmed_alias');
         expect(result.customerId).to.equal(6);
         expect(result.candidates.map(c => c.id)).to.not.include(6);
      });
   });
});
