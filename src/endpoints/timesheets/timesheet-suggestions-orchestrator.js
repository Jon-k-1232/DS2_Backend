const { executeAiRequest } = require('../../ai_integrations');
const timesheetSuggestionsService = require('./timesheet-suggestions-service');
const { redactNotes } = require('../../utils/piiRedaction');
const { similarityScore } = require('../../utils/textSimilarity');

const MIN_SIMILARITY_THRESHOLD = 0.25;

const collectReferenceData = async (db, accountId) => {
   const [jobCategories, jobTypes, generalWorkDescriptions] = await Promise.all([
      db('customer_job_categories').where({ account_id: accountId, is_job_category_active: true }),
      db('customer_job_types').where({ account_id: accountId, is_job_type_active: true }),
      db('customer_general_work_descriptions').where({ account_id: accountId, is_general_work_description_active: true })
   ]);

   return {
      jobCategories,
      jobTypes,
      generalWorkDescriptions
   };
};

const findBestMatch = (value, candidates, accessors) => {
   if (!value || !Array.isArray(candidates) || !candidates.length) {
      return { match: null, score: 0 };
   }

   let bestMatch = null;
   let bestScore = 0;

   candidates.forEach(candidate => {
      const fields = accessors.map(accessor => (typeof accessor === 'function' ? accessor(candidate) : candidate[accessor])).filter(Boolean);

      const candidateScore = fields.reduce((score, field) => Math.max(score, similarityScore(value, field)), 0);

      if (candidateScore > bestScore) {
         bestMatch = candidate;
         bestScore = candidateScore;
      }
   });

   return { match: bestMatch, score: bestScore };
};

const buildFallbackSuggestion = (entry, referenceData) => {
   const { jobCategories, jobTypes, generalWorkDescriptions } = referenceData;

   const categoryResult = findBestMatch(entry.category, jobCategories, ['customer_job_category']);
   const jobTypeResult = findBestMatch(entry.category, jobTypes, ['job_description']);
   const generalWorkResult = findBestMatch(entry.category, generalWorkDescriptions, ['general_work_description']);

   // If category match is weak, fall back to notes
   if ((!categoryResult.match || categoryResult.score < MIN_SIMILARITY_THRESHOLD) && entry.notes) {
      const notesCategoryResult = findBestMatch(entry.notes, jobCategories, ['customer_job_category']);
      if (notesCategoryResult.score > categoryResult.score) {
         Object.assign(categoryResult, notesCategoryResult);
      }
   }

   if ((!generalWorkResult.match || generalWorkResult.score < MIN_SIMILARITY_THRESHOLD) && entry.notes) {
      const notesGeneral = findBestMatch(entry.notes, generalWorkDescriptions, ['general_work_description']);
      if (notesGeneral.score > generalWorkResult.score) {
         Object.assign(generalWorkResult, notesGeneral);
      }
   }

   if ((!jobTypeResult.match || jobTypeResult.score < MIN_SIMILARITY_THRESHOLD) && entry.notes) {
      const notesJobType = findBestMatch(entry.notes, jobTypes, ['job_description']);
      if (notesJobType.score > jobTypeResult.score) {
         Object.assign(jobTypeResult, notesJobType);
      }
   }

   const maxScore = Math.max(categoryResult.score, jobTypeResult.score, generalWorkResult.score);
   const confidence = maxScore ? Number(maxScore.toFixed(3)) : null;

   return {
      suggested_category: categoryResult.match ? categoryResult.match.customer_job_category : entry.category || null,
      suggested_job_category_id: categoryResult.match ? categoryResult.match.customer_job_category_id : null,
      suggested_job_type_id: jobTypeResult.match ? jobTypeResult.match.job_type_id : null,
      suggested_general_work_description_id: generalWorkResult.match ? generalWorkResult.match.general_work_description_id : null,
      ai_confidence: confidence,
      ai_reason: buildReasoningString({ categoryResult, jobTypeResult, generalWorkResult })
   };
};

const buildReasoningString = ({ categoryResult, jobTypeResult, generalWorkResult }) => {
   const reasons = [];

   if (categoryResult.match) {
      reasons.push(`Category matched ${categoryResult.match.customer_job_category} (score ${categoryResult.score.toFixed(2)})`);
   }

   if (jobTypeResult.match) {
      reasons.push(`Job type matched ${jobTypeResult.match.job_description} (score ${jobTypeResult.score.toFixed(2)})`);
   }

   if (generalWorkResult.match) {
      reasons.push(`Work description matched ${generalWorkResult.match.general_work_description} (score ${generalWorkResult.score.toFixed(2)})`);
   }

   return reasons.join(' | ') || null;
};

const buildSuggestionPayload = (entry, sanitizedNotes, fallbackSuggestion, aiSuggestion) => {
   const suggestion = {
      account_id: entry.account_id,
      timesheet_entry_id: entry.timesheet_entry_id,
      sanitized_notes: sanitizedNotes,
      suggested_category: fallbackSuggestion.suggested_category,
      suggested_job_category_id: fallbackSuggestion.suggested_job_category_id,
      suggested_job_type_id: fallbackSuggestion.suggested_job_type_id,
      suggested_general_work_description_id: fallbackSuggestion.suggested_general_work_description_id,
      ai_confidence: fallbackSuggestion.ai_confidence,
      ai_reason: fallbackSuggestion.ai_reason,
      ai_payload: null,
      status: 'pending',
      source: 'fallback'
   };

   if (aiSuggestion) {
      suggestion.suggested_category = aiSuggestion.suggested_category || suggestion.suggested_category;
      suggestion.suggested_job_category_id = aiSuggestion.suggested_job_category_id || suggestion.suggested_job_category_id;
      suggestion.suggested_job_type_id = aiSuggestion.suggested_job_type_id || suggestion.suggested_job_type_id;
      suggestion.suggested_general_work_description_id = aiSuggestion.suggested_general_work_description_id || suggestion.suggested_general_work_description_id;
      suggestion.ai_confidence = aiSuggestion.ai_confidence || suggestion.ai_confidence;
      suggestion.ai_reason = aiSuggestion.ai_reason || suggestion.ai_reason;
      suggestion.ai_payload = aiSuggestion.ai_payload || null;
      suggestion.status = aiSuggestion.status || suggestion.status;
      suggestion.source = aiSuggestion.source || 'ai';
   }

   return suggestion;
};

const mapAiSuggestions = aiResponse => {
   if (!aiResponse) return {};

   if (Array.isArray(aiResponse)) {
      return aiResponse.reduce((acc, suggestion) => {
         if (suggestion && suggestion.timesheet_entry_id) {
            acc[suggestion.timesheet_entry_id] = suggestion;
         }
         return acc;
      }, {});
   }

   if (aiResponse.payload && Array.isArray(aiResponse.payload.suggestions)) {
      return mapAiSuggestions(aiResponse.payload.suggestions);
   }

   return {};
};

const requestAiSuggestions = async ({ db, accountId, userId, sanitizedEntries, referenceData }) => {
   try {
      return await executeAiRequest({
         db,
         accountId,
         userId,
         request: {
            feature: 'timesheet_categorization',
            entries: sanitizedEntries.map(entry => ({
               timesheet_entry_id: entry.timesheet_entry_id,
               notes: entry.sanitized_notes,
               category: entry.category,
               duration: entry.duration
            })),
            context: {
               jobCategories: referenceData.jobCategories.map(category => ({
                  id: category.customer_job_category_id,
                  name: category.customer_job_category
               })),
               jobTypes: referenceData.jobTypes.map(jobType => ({
                  id: jobType.job_type_id,
                  description: jobType.job_description,
                  category_id: jobType.customer_job_category_id
               })),
               generalWorkDescriptions: referenceData.generalWorkDescriptions.map(description => ({
                  id: description.general_work_description_id,
                  description: description.general_work_description
               }))
            }
         }
      });
   } catch (err) {
      console.error(`[${new Date().toISOString()}] Failed to request AI suggestions: ${err.message}`);
      return null;
   }
};

const generateSuggestionsForEntries = async ({ db, accountId, entries, userId }) => {
   if (!db) throw new Error('Database instance is required to generate suggestions.');
   if (!accountId) throw new Error('Account ID is required to generate suggestions.');
   if (!Array.isArray(entries) || !entries.length) {
      return [];
   }

   const referenceData = await collectReferenceData(db, accountId);

   const sanitizedEntries = entries.map(entry => {
      const { sanitizedNotes } = redactNotes({
         notes: entry.notes,
         companyName: entry.company_name,
         firstName: entry.first_name,
         lastName: entry.last_name
      });

      // Return a copy without raw PII fields so downstream lacks access by default
      const { company_name, first_name, last_name, ...rest } = entry || {};
      return {
         ...rest,
         sanitized_notes: sanitizedNotes
      };
   });

   const aiResponse = await requestAiSuggestions({ db, accountId, userId, sanitizedEntries, referenceData });
   const aiSuggestionsMap = mapAiSuggestions(aiResponse);

   const suggestionsPayload = sanitizedEntries.map(entry => {
      const fallbackSuggestion = buildFallbackSuggestion(entry, referenceData);
      const aiSuggestion = aiSuggestionsMap[entry.timesheet_entry_id];

      return buildSuggestionPayload(entry, entry.sanitized_notes, fallbackSuggestion, aiSuggestion);
   });

   return timesheetSuggestionsService.upsertSuggestions(db, suggestionsPayload);
};

module.exports = {
   generateSuggestionsForEntries
};
