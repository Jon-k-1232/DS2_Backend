# Time tracking: templates, uploads, history and ownership

Source review: 2026-09-24. Paths beginning `src/`, `test/`, `scripts/` or `migrations/` are relative to DS2_Backend. `../DS2_Frontend/` identifies the frontend. This is a code review, not evidence of a running deployment. Tests below were read, not run.

## 1. Purpose and UI

Employees download a workbook, enter time, upload it, and retrieve previous uploads. Validation creates holding rows; it does not itself guarantee a billable transaction. Ingestion is documented in [timesheets-and-ingestion.md](timesheets-and-ingestion.md). The frontend routes are `/time-tracking/upload`, `/time-tracking/history`, `/time-tracking/update-template` and `/time-tracking/settings`. They render `UploadTimeTracker`, `TimeTrackerHistory`, `UpdateTimeTrackerTemplate` and `TimeTrackingSettings`, respectively. Sources: `../DS2_Frontend/src/Routes/PrimaryRouter.js:151`, `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:22`.

The component files are `../DS2_Frontend/src/Pages/TimeTracking/Upload/UploadTimeTracker.js`, `../DS2_Frontend/src/Pages/TimeTracking/History/TimeTrackerHistory.js`, `../DS2_Frontend/src/Pages/TimeTracking/TemplateUpdate/UpdateTimeTrackerTemplate.js`, and `../DS2_Frontend/src/Pages/Account/TimeTrackingSettings/TimeTrackingSettings.js`; their route imports are at `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:1`. API calls send file bytes as an ArrayBuffer, URI-encode `x-file-name`, and use blob responses for downloads. Source: `../DS2_Frontend/src/Services/ApiCalls/TimeTrackingCalls.js:18`.

## 2. Access rules

All these routes require a valid JWT and an active database user. `enforceAccountId` requires the URL account to equal that user's account, including for Super Admin. Time-tracking routes also apply `enforceSelfOrPrivileged` to `:userID`: self, or access level `manager`, `admin`, `super admin`, or `owner`, compared in lowercase. Sources: `src/app.js:150`, `src/endpoints/auth/jwt-auth.js:18`, `src/endpoints/auth/account-scope.js:7`, `src/endpoints/timeTracking/timeTracking-router.js:30`.

There are additional, different gates. Uploading or downloading by name for a different owner and listing other upload users inspect the **URL requester's database role**, accepting only `super admin`, `admin`, or `manager`. Template list inspects the authenticated user's role and accepts only Admin/Super Admin. Template upload/delete require Super Admin and account `TEMPLATE_OWNER_ACCOUNT_ID` (numeric environment value, default 1). Template latest is available to ordinary users for themselves. Staff management uses `requireManagerOrAdmin`, whose backend roles also include `owner`; frontend settings accepts only Manager/Admin/Super Admin. Sources: `src/endpoints/timeTracking/timeTracking-router.js:355`, `src/endpoints/timeTracking/timeTracking-router.js:789`, `src/endpoints/timeTracking/timeTracking-router.js:1037`, `src/endpoints/timeTracking/timeTracking-router.js:1207`, `src/endpoints/timeTracking/timeTracking-router.js:1370`, `src/endpoints/auth/jwt-auth.js:94`, `../DS2_Frontend/src/Routes/GroupedRoutes/TimeTrackingRoutes/TimeTrackingRoutes.js:25`.

## 3. API reference

In this section `A=:accountID`, `U=:userID`. Both are required path parameters. All tables inherit: **401** missing/invalid/expired JWT or inactive user; **403** account mismatch or failed role/self gate; **429** global rate limit; **500** unexpected database/S3/runtime failure unless a narrower handler below replaces it. JSON parsing can return **400**, and parser limits return **413**. The global JSON limit is 1 MB; raw tracker parsers allow 25 MB before the handler imposes 1 MB. Sources: `src/app.js:70`, `src/app.js:100`, `src/app.js:178`, `src/endpoints/timeTracking/timeTracking-router.js:38`. There is no client pagination, sorting or date filter on the S3 lists.

### Upload

| Item | Contract |
|---|---|
| Method/path | `POST /time-tracking/upload/A/U` |
| Input | Raw nonempty bytes, at most 1,048,576 bytes. Required `x-file-name` URI-encoded string; optional `x-file-type` MIME string. Optional query `ownerUserID`, otherwise `targetUserID`, otherwise U; must convert to positive finite integer. U is also validated as a positive finite integer. |
| Success | **201** `{message, storedKey, fileName, metadata, inserted_count, duplicates_skipped, duplicates_skipped_count, non_billable_rows:[{row,reason}], note}`. Metadata includes period and submitted-for/submitted-by IDs, names and emails. |
| Errors | **400** missing/bad filename encoding, empty/oversize body, invalid IDs, `.numbers`, inactive owner, workbook/row errors, incomplete normalized dates/durations or zero valid entries. **403** unauthorized on-behalf upload. **404** requester/owner/account missing. **409** identical tracker (`duplicate_of:{timesheet_name,uploaded_at,row_count}`) or every row already present (skipped-row details). **500** save/system failure. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:310`, `src/endpoints/timeTracking/timeTracking-router.js:567`, `src/endpoints/timeTracking/timeTracking-router.js:755` |

### Upload user selector

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracking/users/A/U` |
| Input | No optional parameters. |
| Success | **200** `{users:[{userId,displayName,email,accessLevel}],status:200}`; privileged URL requester sees active account users, others only themselves. |
| Errors | **400** nonfinite identifiers; **404** requester absent; shared errors above. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:789` |

### History

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracking/history/A/U` |
| Input | U is the owner whose history is requested. No pagination or filters. |
| Success | **200** `{history:[{id,key,fileName,uploadedAt,size}]}`; timestamp/size may be null; filename hides `.gz`. |
| Errors | **404** account/owner absent; shared errors above. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:831` |

### History download

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracking/history/download/A/U` |
| Input | Required query `key`: exact S3 key, nonempty string, safe syntax and owned by A/U. |
| Success | **200** original bytes, gunzipped when key ends `.gz`; attachment filename and `X-Tracker-Filename`; original MIME metadata or octet-stream. |
| Errors | **400** missing key; **403** unsafe/foreign/unowned key before S3 read; **404** missing owner/account or S3 `NoSuchKey`; **500** corrupt gzip or other fetch failure. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:905` |

### Download by stored timesheet name

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracking/download/by-name/A/U` |
| Input | Required query `ownerUserID` and `timesheetName`; name must be a bare safe filename. U is requester, query owner is file owner. |
| Success | **200** original bytes and download headers as above. |
| Errors | **400** missing/invalid owner/name or path-like name; **403** on-behalf gate; **404** missing account/users or no authorized matching object (candidate fetch errors are swallowed); **500** corrupt compressed data/system error. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:995` |

### Latest template

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracking/template/latest/A/U` |
| Input | No optional parameters. |
| Success | **200** workbook attachment with X-Tracker-Filename; rebuilt XLSX responses also include X-Tracker-Customers, X-Tracker-Employees and X-Tracker-Categories string counts. Filename comes from the latest stored owner template, even for a neutral-asset build. |
| Errors | **404** no qualifying stored template; **503** non-owner build failure; **500** other source/list/get failures. Owner rebuild failure falls back to raw owner bytes with **200**. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:1212`, `src/endpoints/timeTracking/timeTracking-router.js:1275` |

### Upload template version

| Item | Contract |
|---|---|
| Method/path | `POST /time-tracking/template/upload/A/U` |
| Input | Super Admin in owner account; raw bytes and `x-file-name`, optional MIME header. Nonempty, at most 1 MB. Extension inferred from filename/MIME, otherwise `.xlsx`; workbook contents are not validated here. |
| Success | **201** `{message,storedKey,fileName,accountID}`. |
| Errors | **400** missing/bad filename encoding or missing/oversize bytes; **403** wrong account/role; **500** S3/system error. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:1310` |

### List template versions

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracking/template/list/A/U` |
| Input | Authenticated Admin/Super Admin; no optional parameters. |
| Success | **200** `{templates:[{id,key,fileName,uploadedAt,size}]}` for owner account. Other accounts receive `{templates:[],managedByOwnerAccount:true}` without listing S3. |
| Errors | **403** other roles; **500** list/system error. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:1370` |

### Delete template version

| Item | Contract |
|---|---|
| Method/path | `DELETE /time-tracking/template/delete/A/U` |
| Input | Super Admin in owner account; JSON `{key:string}` required. Safe exact versions prefix, non-folder object and basename beginning `timeTracker_` case-insensitively. |
| Success | **204** no body; S3 delete does not require the object to exist. |
| Errors | **400** missing/unsafe/wrong-prefix key; **403** wrong account/role; **500** delete/system error. |
| Source | `src/endpoints/timeTracking/timeTracking-router.js:1431` |

### List billing notification staff

| Item | Contract |
|---|---|
| Method/path | `GET /time-tracker-staff/A/U` |
| Input | Manager/Admin/Super Admin/Owner; U is not an ownership selector. |
| Success | **200** `{staff:[{id,user_id,is_active,created_at,display_name,email,account_id}],availableUsers:[{user_id,display_name,email}],activeStaffUserIds}`. |
| Errors | **400** nonfinite account in handler (account-scope normally rejects first); shared errors. |
| Source | `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:12`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:30`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:1` |

### Add staff

| Item | Contract |
|---|---|
| Method/path | `POST /time-tracker-staff/A/U` |
| Input | Required nonempty array `userIds`; values converted to numbers, deduplicated and intersected with account users. Unknown/foreign IDs are ignored, not rejected. |
| Success | **201** same response fields. Existing staff rows are reactivated. If no submitted ID belongs to the account, staff and activeStaffUserIds are empty even when a roster already exists; availableUsers is still queried. |
| Errors | **400** empty/nonarray userIds or invalid account; shared errors. |
| Source | `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:55`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:39` |

### Change staff status

| Item | Contract |
|---|---|
| Method/path | `PUT /time-tracker-staff/A/U/:staffID` |
| Input | Required JSON `isActive` literal boolean; staffID is scoped through account users. |
| Success | **200** same staff response; nonexistent/foreign staff ID updates zero rows. |
| Errors | **400** nonboolean status or invalid account; shared errors. |
| Source | `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:79` |

### Delete staff

| Item | Contract |
|---|---|
| Method/path | `DELETE /time-tracker-staff/A/U/:staffID` |
| Input | Required staffID path; scoped through account users. |
| Success | **200** same staff response, including zero-row deletes. |
| Errors | **400** invalid account; shared errors. |
| Source | `src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:103` |

## 4. Data model and storage

| Data | Read/write use |
|---|---|
| `users` | Account, owner/requester ID, display name, email, role, active flag; template employee list and email recipients. `src/endpoints/timeTracking/timeTracking-router.js:97`; `src/endpoints/timeTracking/template-builder.js:220`. |
| `accounts` + `account_information` | Account inner join for upload/history; immutable storage_slug for namespace. Missing information row makes the joined account unavailable. `src/endpoints/timeTracking/timeTracking-router.js:107`; `src/endpoints/account/account-service.js:4`. |
| `timesheet_entries` | Account/user, employee name, stored timesheet filename, tracker start/end, date/entity/category/company/first/last/duration/notes, processed/deleted flags, created_at. Duration is positive whole minutes at upload. `src/endpoints/timeTracking/timeTracking-router.js:456`; `migrations/schema-snapshot-2026-09-22.sql:1013`. |
| `tracker_file_owners` | Exact `s3_key` primary key, account_id FK, user_id without FK, source and created_at. Source enum: upload, recorded-upload, folder-at-backfill, path. Ownership survives user deletion at the table level. `migrations/021.tracker_file_owners.sql:45`. |
| `ai_category_training_examples` | Existing non-null transaction links retain a row's duplicate-detection effect even when the entry is deleted. `src/endpoints/timeTracking/trackerDuplicates.js:180`. |
| `template_downloads` | Account/user and three catalog counts for actual builds; best effort, not each HTTP request/cache hit. `src/endpoints/timeTracking/template-builder.js:1241`. |
| `time_tracker_staff` | Notification user membership, active status; joined users supply account and email. `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:1`. |

All tracker objects remain below the fixed root `James_F__Kimmel___Associates/time_tracking`. Versions use `tracker_versions/`. New submissions use `processed/{storage_slug}_{account_id}/user_{user_id}/{Last_First_timestamp-ms-random8.ext}.gz`. A missing slug uses `account_{accountID}` as the base before the account suffix. Last/first derive from the first and last display-name tokens; a one-word name supplies both. Whitespace becomes `_`; filename segments remove characters outside letters/digits/underscore/hyphen. Sources: `src/endpoints/timeTracking/timeTracking-router.js:41`, `src/endpoints/timeTracking/timeTracking-router.js:151`, `src/endpoints/timeTracking/timeTracking-router.js:552`, `src/endpoints/timeTracking/trackerFolderNames.js:20`.

Legacy layouts are `processed/{name-derived-account}_{accountID}/{Last_First}/{file}.gz` and flat `processed/{Last_First}/{file}.gz`. Flat files can belong only to `LEGACY_FLAT_TRACKER_ACCOUNT_ID`, default 1. A matching current display name grants **no** access. Sources: `src/endpoints/timeTracking/timeTracking-router.js:199`, `src/endpoints/timeTracking/timeTracking-router.js:214`.

## 5. Exact read logic

History discovers current slug/account and legacy name/account folders plus every listed first-level folder whose final numeric suffix is the canonical account ID. It adds each `user_ID` prefix and parents of exact database-owned legacy keys. S3 listing follows all continuation pages. Every resulting key is classified again: an exact account/user ID path is intrinsically owned; a shared name folder or legacy flat key requires an exact `tracker_file_owners` row for the requested account/user. Leading-zero/noncanonical IDs, extra depth and other owners fail. Folder markers are omitted, keys deduplicated, and results sorted by modification time descending with missing dates last. Sources: `src/endpoints/timeTracking/timeTracking-router.js:204`, `src/endpoints/timeTracking/timeTracking-router.js:240`, `src/endpoints/timeTracking/timeTracking-router.js:266`, `src/endpoints/timeTracking/timeTracking-router.js:831`, `src/utils/s3.js:58`.

By-name download tests safe variants: original basename, spaces replaced by underscores, invalid characters replaced/removed, and segment sanitization. It tries `.gz` beneath owned ID prefixes, then exact owned legacy keys; a final normalized comparison scans only authorized candidates. It never accepts an S3 hit as proof of ownership. Sources: `src/endpoints/timeTracking/timeTracking-router.js:1055`, `src/endpoints/timeTracking/timeTracking-router.js:1131`.

Latest/list templates read versions objects, omit folder markers, keep basenames matching `/^timetracker_/i`, and sort descending LastModified. Latest fetches the newest object's bytes even when the non-owner builder will ignore them. Sources: `src/endpoints/timeTracking/timeTracking-router.js:1212`, `src/endpoints/timeTracking/timeTracking-router.js:1370`.

Template catalogs select active account customers ordered display_name, active account users ordered display_name, and active `customer_general_work_descriptions` ordered general_work_description. Nonempty labels are mapped into lists; this is not the job-category catalog. Source: `src/endpoints/timeTracking/template-builder.js:206`.

Staff list joins staff to users, filters users.account_id, orders display_name and retains inactive staff/users in the staff list. Available users are active account users. activeStaffUserIds checks membership status only, so it can contain a deactivated user. Email and auto-ingest notification recipient queries require both user and staff active. Sources: `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:1`, `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:24`.

## 6. Validation, duplicate calculations and template construction

The parser reads **only the first worksheet**. B1 must exactly identify the intended active owner's display name and nonempty email; it does not choose another same-named user. B2/B3 must produce dates with start ≤ end. Row 5 contains headers; data starts at row 6. Required headers are Date, Entity, Category, Company Name, First Name, Last Name, Duration, Notes. Header matching normalizes case, Unicode and whitespace; duplicate recognized columns and missing headers fail. Time Range is informational and ignored. Sources: `src/timeTrackerValidation/validateUploadedTracker.js:48`, `src/timeTrackerValidation/validateUploadedTracker.js:88`, `src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:12`, `src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig.js:8`.

Blank rows are skipped. Lunch/Lunch Break categories, normalized for case/spacing, are skipped before ordinary validation. Remaining rows require date, entity, category, duration, notes and either company or both first/last name. Dates must be in `[tracker start − TRACKER_ENTRY_LOOKBACK_DAYS, min(tracker end,today)]`, default lookback 7. Other non-work labels are retained and reported as non-billable; their detailed category/entity/leading-note rules and work-word exceptions are in `src/timeTrackerValidation/nonWorkEntries.js:31`. Sources: `src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js:12`, `src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:28`.

Non-work detection applies NFKC normalization, lowercasing, punctuation-to-space conversion and whitespace collapse, then checks category, entity and notes in that order. The first match supplies a reason such as category:vacation or notes:sick day. A category/entity must match the entire label: optional `paid `, then paid time off, pto, vacation, holiday, sick, lunch, out of office, out of the office, ooo, personal or doctor. It may end with any repeated qualifiers day/days/time/leave/hour/hours/hr/hrs/break/appointment/appt/errand/off/request/visit. Sources: `src/timeTrackerValidation/nonWorkEntries.js:18`, `src/timeTrackerValidation/nonWorkEntries.js:31`, `src/timeTrackerValidation/nonWorkEntries.js:75`.

For notes, the phrase must start the text. Accepted leads are paid time off, pto, vacation, holiday; sick with optional day/leave/time; lunch with optional break; out of (the) office; ooo; personal plus appointment/appt/day/time/leave/errand; or doctor/doctor's plus appointment/appt/visit. The next word cancels the match when it is pay, payroll, paycheck(s), bonus(es), accrual(s), accrued, balance(s), policy/policies, schedule(s), notice(s), calendar(s), report(s), form(s), calculation(s), calc, letter(s), sign(s), card(s), party, observance, request(s), tracking, reconciliation, email(s), share, project(s), plan or planning. Lunch additionally excludes next words with, meeting, and, n, presentation and seminar. Thus “sick pay calculation” remains work, while “sick day” is non-work. Bare doctor at the start of a note is insufficient. Only an exact normalized Lunch/Lunch Break **category** causes the row to be dropped. Source: `src/timeTrackerValidation/nonWorkEntries.js:40`.

Duration accepts positive whole minutes, minute suffixes, decimal hours and hour/minute combinations. Explicit hours are multiplied by 60 and rounded to whole minutes. Values above 1,440 minutes, bare fractional minutes, zero, negatives and colon time notation fail. Integer tolerance is 0.000001 minutes. Thus `1.5 hours` becomes 90, `90` becomes 90, but bare `1.5` is invalid. Excel serial and supported string date conversions occur before normalization; some paths use permissive dayjs parsing, so this is not a universal strict-calendar validator. Sources: `src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:18`, `src/endpoints/timesheets/timesheetProcessingLogic/utils.js:8`, `src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:28`.

Duplicate detection computes SHA-256 over account, user, employee, date, entity, company, first/last, numeric duration and notes. Text is NFKC-normalized, lowercased, trimmed and whitespace-collapsed. **Category, filename and tracker period are excluded from each row fingerprint.** It first compares fingerprint **multisets** against uploads in the same period. Exact multiplicities produce identical-tracker 409. Otherwise matching dates consume existing occurrences one at a time; one existing row plus two identical incoming rows skips one and inserts one. Subsets/supersets are not identical files. Sources: `src/endpoints/timeTracking/trackerDuplicates.js:40`, `src/endpoints/timeTracking/trackerDuplicates.js:64`, `src/endpoints/timeTracking/trackerDuplicates.js:111`.

Both lookups are account/owner scoped. Retained history means processed OR not deleted OR a training-example row with non-null transaction_id. Therefore deleting an unprocessed, unlinked holding row permits re-upload; deleting a processed/linked row does not evade duplicate detection. Source: `src/endpoints/timeTracking/trackerDuplicates.js:180`.

Owner account, feature flag off: serve latest uploaded bytes unchanged. Owner, flag on: rebuild those bytes with owner catalogs, with raw-byte fallback on failure. **Every non-owner request builds from the committed neutral asset regardless of flag.** It verifies asset SHA-256 against its manifest; requires the eight allowed worksheets; replaces visible Employee Names and hidden customer/employee/category lists; clears entry rows; replaces only approved example cells; neutralizes metadata; restores validations/defined names; scans serialized content for forbidden tokens excluding legitimate own-catalog values; and rejects unexpected package parts. Failure is 503, never owner-byte fallback. Sources: `src/endpoints/timeTracking/timeTracking-router.js:1241`, `src/endpoints/timeTracking/template-builder.js:955`, `src/endpoints/timeTracking/template-builder.js:1143`.

B1 validates active employees; C6 onward validates work descriptions; D6 onward validates customers. Lookup sheets are veryHidden and protected with `TEMPLATE_PROTECT_PASSWORD`, default `jka-internal`; this workbook protection is not authentication. Data-row range defaults to 1,500. Cache key includes account, user and owner/non-owner mode; default cache window is 60 seconds. Cache hits skip catalog reads and template_downloads insert. The offline neutral-asset build and human review are separate from uploading a template. Sources: `src/endpoints/timeTracking/template-builder.js:8`, `src/endpoints/timeTracking/template-builder.js:278`, `src/endpoints/timeTracking/template-builder.js:861`, `src/endpoints/timeTracking/template-builder.js:1224`, `src/endpoints/timeTracking/assets/README.md:1`.

## 7. Create, edit, delete and side effects

Upload validates before opening its save transaction. Inside the transaction it takes `pg_advisory_xact_lock(hashtext('ds2.timesheet_upload'), ownerID)` **before** duplicate queries and filename allocation. This serializes concurrent submissions for the same employee. It gzips original bytes, uploads with original-content-type and URI-encoded stored-filename metadata, inserts only nonduplicate holding rows, and records exact file ownership with source `upload` in the same database transaction. On failure it rolls back and tries to delete the S3 object. S3 and PostgreSQL are not one atomic store; failed cleanup can leave an orphan. Sources: `src/endpoints/timeTracking/timeTracking-router.js:530`, `src/endpoints/timeTracking/timeTracking-router.js:552`, `src/endpoints/timeTracking/timeTracking-router.js:602`, `src/endpoints/timeTracking/trackerOwners.js:31`.

After commit it schedules eligible AI ingestion and looks up billing staff for success mail. Staff lookup is outside the email-send catch, so its failure can return 500 after the file/rows are committed ([F28](../_review/findings.md#f28)). Actual send errors are logged. Optional owner/requester success mail requires `TIME_TRACKER_SEND_USER_SUCCESS_EMAILS=1`; duplicates already on the staff list are omitted. Validation/system failure mail targets active tracker staff, falling back to `TIME_TRACKING_ADMIN_EMAILS`. SES needs FROM_EMAIL; actual delivery is not determined from the code. Sources: `src/endpoints/timeTracking/timeTracking-router.js:658`, `src/endpoints/timeTracking/timeTracking-router.js:670`, `src/endpoints/timeTracking/timeTracking-router.js:697`, `src/timeTrackerValidation/notifications.js:33`, `src/utils/email/sendEmail.js:44`.

There is no uploaded-tracker edit/delete endpoint. Deleting a holding row does not delete the workbook or ownership record; see the ingestion document. Template delete removes only an S3 object. Template upload uses a timestamp with **second** precision and no random suffix, so two uploads of the same extension in one second target the same key ([F7](../_review/findings.md#f7)). Source: `src/endpoints/timeTracking/timeTracking-router.js:1340`.

Staff add converts IDs with Number, keeps finite values, deduplicates and intersects them with account users; it does not require users active or prevalidate integer IDs. It upserts membership to active in one transaction. PUT/DELETE scope membership through account users, ignore affected count and refresh separately. Delete removes only membership. These calls do not send email, remove timesheets or delete notification history. Source: `src/endpoints/timeTrackerStaff/timeTrackerStaff-service.js:39`.

Ownership backfill is `scripts/timeTracking/backfill-tracker-owners.js`. Default execution reads all S3 objects under processed and recorded uploads/users, then writes a candidate CSV/report, not database rows. Canonical ID paths supply ownership directly. Legacy files first require an unambiguous recorded-upload basename/account match (processed/deleted records still count); otherwise a unique current user-folder match is proposed. Ambiguities remain unattributed. That folder inference occurs **only during reviewed backfill**, not during downloads. Sources: `scripts/timeTracking/backfill-tracker-owners.js:139`, `scripts/timeTracking/backfill-tracker-owners.js:177`.

Apply requires explicit DS2_ENV_FILE, DATABASE_NAME, `--apply --manifest <reviewed.csv>` and production acknowledgement for production-looking targets. Manifest header is exactly `database,bucket,legacy_account_id,s3_key,account_id,user_id,source,owner_display_name`; duplicate keys, invalid canonical IDs, wrong target identity and contradictory path owners fail. It recomputes drift (object missing, no longer attributable, changed owner) and refuses unless `--accept-drift`; accepting drift applies the **previously approved owner**, not a new guess. Apply locks `tracker_file_owners IN SHARE ROW EXCLUSIVE MODE` in one transaction, skips already-owned same-owner keys and aborts the whole run for a different existing owner. It never rewrites S3. Sources: `scripts/timeTracking/backfill-tracker-owners.js:249`, `scripts/timeTracking/backfill-tracker-owners.js:307`, `scripts/timeTracking/backfill-tracker-owners.js:333`, `scripts/timeTracking/backfill-tracker-owners.js:355`, `scripts/timeTracking/backfill-tracker-owners.js:395`.

## 8. Invariants and test evidence

| Invariant | Test evidence inspected |
|---|---|
| Own-user/account checks, foreign/missing objects, gzip round-trip, latest/list/upload/delete contracts | `test/integration/coverage-timetracking-timesheets.integration.spec.js:525`, `test/integration/coverage-timetracking-timesheets.integration.spec.js:564`, `test/integration/coverage-timetracking-timesheets.integration.spec.js:618`. |
| Same-named employees do not share legacy files | `test/integration/coverage-timetracking-timesheets.integration.spec.js:719`. |
| Owner flag-off passthrough; non-owner flag-off neutral build; fail-closed 503 | `test/integration/coverage-timetracking-timesheets.integration.spec.js:787`, `test/integration/coverage-timetracking-timesheets.integration.spec.js:915`, `test/integration/coverage-timetracking-timesheets.integration.spec.js:982`. |
| Catalog cache partition, visible-name replacement, strict dropdown/package controls | `test/endpoints/timeTracking/template-builder.spec.js:88`, `test/endpoints/timeTracking/template-builder.spec.js:243`, `test/endpoints/timeTracking/template-builder.spec.js:292`. |
| Multiset duplicate behavior and retained deleted history | `test/endpoints/timeTracking/trackerDuplicates.spec.js:52`, `test/endpoints/timeTracking/trackerDuplicates.spec.js:93`. |
| Full-row error collection, owner-scoped B1, duration/date/lunch validation | `test/endpoints/timesheets/tracker-validation.spec.js:40`, `test/endpoints/timesheets/tracker-validation.spec.js:199`, `test/endpoints/timesheets/tracker-validation.spec.js:234`. |
| Ownership planning, exact manifests and migration structure | `test/scripts/backfill-tracker-owners.spec.js:1`; `test/scripts/migration-021.spec.js:1`. These are test sources, not a claim that the tests passed during this review. |

## 9. Limitations and open decisions

Legacy files are intentionally invisible until migration 021 and reviewed backfill establish ownership. A deleted user's ownership rows survive, but download handlers still require a current user record, so survival alone is not an administrative retrieval feature. Actual bucket versioning/retention and historical backfill completion are not determined from the code. Sources: `migrations/021.tracker_file_owners.sql:45`, `src/endpoints/timeTracking/timeTracking-router.js:97`, `scripts/review-2026-09/FINAL_REPORT.md:72`.

Neutral builds still depend on a qualifying uploaded owner template being listable/fetchable, and their returned filename reflects that object. Catalog changes can take up to the cache window to appear. Template uploads do not regenerate the committed neutral asset. Sources: `src/endpoints/timeTracking/timeTracking-router.js:1212`, `src/endpoints/timeTracking/template-builder.js:1224`, `src/endpoints/timeTracking/assets/README.md:1`.

Pending accountant decisions about historical internal billing, job totals and credits are shared with ingestion and invoicing; upload validation does not repair historical billed data. See [operations.md](operations.md), and `scripts/review-2026-09/FINAL_REPORT.md:45`. Findings specific to this document: [F28](../_review/findings.md#f28) and [F7](../_review/findings.md#f7) in [consolidated findings](../_review/findings.md).

Coverage: **13 owned endpoint contracts**. See the [endpoint index](../README.md#endpoint-index) and [consolidated findings](../_review/findings.md).
