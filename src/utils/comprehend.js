const { ComprehendClient, DetectPiiEntitiesCommand } = require('@aws-sdk/client-comprehend');

const REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-west-2';
const REDACTED_ENTITY_TYPES = new Set([
   'NAME',
   'EMAIL',
   'PHONE',
   'ADDRESS',
   'SSN',
   'BANK_ACCOUNT_NUMBER',
   'BANK_ROUTING',
   'CREDIT_DEBIT_NUMBER',
   'CREDIT_DEBIT_CVV',
   'CREDIT_DEBIT_EXPIRY',
   'PIN',
   'DRIVER_ID',
   'PASSPORT_NUMBER',
   'IP_ADDRESS'
]);

let cachedClient = null;
const getClient = () => {
   if (!cachedClient) cachedClient = new ComprehendClient({ region: REGION });
   return cachedClient;
};

const _setClientForTest = client => {
   cachedClient = client;
};

const _stringFallbackRedact = (text, knownNames = []) => {
   if (!text) return text;
   let out = text;
   for (const name of knownNames) {
      if (!name || name.length < 2) continue;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), '[REDACTED_NAME]');
   }
   out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[REDACTED_EMAIL]');
   out = out.replace(/(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g, '[REDACTED_PHONE]');
   out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
   out = out.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[REDACTED_CARD]');
   return out;
};

const detectAndRedact = async (text, { knownNames = [], languageCode = 'en' } = {}) => {
   if (!text || typeof text !== 'string') return { redacted: text, entities: [], usedComprehend: false };
   try {
      const client = getClient();
      const result = await client.send(
         new DetectPiiEntitiesCommand({ Text: text, LanguageCode: languageCode })
      );
      const entities = (result && result.Entities) || [];
      let redacted = text;
      const sortedEntities = [...entities].sort((a, b) => b.BeginOffset - a.BeginOffset);
      for (const entity of sortedEntities) {
         if (!entity.Type || !REDACTED_ENTITY_TYPES.has(entity.Type)) continue;
         const before = redacted.slice(0, entity.BeginOffset);
         const after = redacted.slice(entity.EndOffset);
         redacted = `${before}[REDACTED_${entity.Type}]${after}`;
      }
      redacted = _stringFallbackRedact(redacted, knownNames);
      return { redacted, entities, usedComprehend: true };
   } catch (e) {
      const fallback = _stringFallbackRedact(text, knownNames);
      return { redacted: fallback, entities: [], usedComprehend: false, error: e.message };
   }
};

module.exports = { detectAndRedact, _setClientForTest, _stringFallbackRedact, REDACTED_ENTITY_TYPES };
