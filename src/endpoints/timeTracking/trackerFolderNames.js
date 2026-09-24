/**
 * Pure helpers for deriving a tracker "name folder" segment from a user's
 * display name. Used by timeTracking-router.js (to build the folder a NEW
 * upload's prefix parameter carries, and to sanitize file-name variants) and
 * by scripts/timeTracking/backfill-tracker-owners.js (to work out, ONE TIME
 * at backfill, which user a pre-existing unrecorded legacy object's name
 * folder most plausibly names). Extracted to a shared module — review/
 * full-audit-2026-09, Astra round 13 — so the backfill script's attribution
 * logic can never drift from the router's own folder-naming logic by
 * duplicating it.
 *
 * IMPORTANT: none of this is an authorization mechanism any more. A name
 * folder (current or former, produced by these helpers or not) is never, by
 * itself, proof of who owns an S3 object — see timeTracking-router.js's
 * buildKeyAuthorizer and trackerOwners.js. These helpers only ever inform a
 * ONE-TIME, human-reviewed backfill judgment call (recorded permanently in
 * tracker_file_owners) or a brand-new upload's own folder name.
 */

const sanitizeSegment = (value, fallback = 'unknown') => {
   if (!value) return fallback;
   const trimmed = value.trim();
   if (!trimmed) return fallback;
   return trimmed.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
};

const deriveUserNameSegments = userRecord => {
   const displayName = userRecord.display_name || '';
   const trimmed = displayName.trim();

   if (!trimmed) {
      return { firstName: 'User', lastName: 'Unknown' };
   }

   const parts = trimmed.split(/\s+/);
   if (parts.length === 1) {
      return { firstName: parts[0], lastName: parts[0] };
   }

   return {
      firstName: parts[0],
      lastName: parts[parts.length - 1]
   };
};

const buildUserFolder = userRecord => {
   const { firstName, lastName } = deriveUserNameSegments(userRecord);
   return sanitizeSegment(`${lastName}_${firstName}`);
};

module.exports = { sanitizeSegment, deriveUserNameSegments, buildUserFolder };
