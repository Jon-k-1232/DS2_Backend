const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

const normalizeSecret = secret => {
   if (!secret || !secret.length) {
      throw new Error('AI integration secret is missing.');
   }

   if (Buffer.isBuffer(secret)) {
      return secret;
   }

   return Buffer.from(String(secret), 'base64');
};

const deriveKey = secret => crypto.createHash('sha256').update(secret).digest();

const generateSecret = () => crypto.randomBytes(32).toString('base64');

const encryptApiKey = (plainText, secret) => {
   if (typeof plainText !== 'string' || !plainText.length) {
      return null;
   }

   const normalizedSecret = normalizeSecret(secret);
   const iv = crypto.randomBytes(IV_LENGTH);
    const key = deriveKey(normalizedSecret);
   const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
   const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
   const authTag = cipher.getAuthTag();

   return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptApiKey = (sealed, secret) => {
   if (typeof sealed !== 'string' || !sealed.length) {
      return null;
   }

   const normalizedSecret = normalizeSecret(secret);
   const [ivHex, tagHex, payloadHex] = sealed.split(':');
   if (!ivHex || !tagHex || !payloadHex) {
      throw new Error('Stored AI integration key is malformed.');
   }

   const iv = Buffer.from(ivHex, 'hex');
   const authTag = Buffer.from(tagHex, 'hex');
   const payload = Buffer.from(payloadHex, 'hex');
   const key = deriveKey(normalizedSecret);
   const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
   decipher.setAuthTag(authTag);

   const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);

   return decrypted.toString('utf8');
};

const hasStoredApiKey = sealed => typeof sealed === 'string' && sealed.trim().length > 0;

module.exports = {
   encryptApiKey,
   decryptApiKey,
   hasStoredApiKey,
   generateSecret
};
