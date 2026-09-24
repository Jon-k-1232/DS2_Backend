# Time-tracker template assets

- `neutral-template.xlsx` — the reviewed, committed, tenant-neutral base
  workbook every **non-owner** `/template/latest` download is built from
  (see `_buildFromNeutralAsset` / `_loadNeutralAsset` in
  `../template-builder.js`). It carries the real firm template's eight
  sheets (`Time`, `Employee Names`, `Instructions`, `Categories`, `Entity`,
  `__customers`, `__employees`, `__categories`) and structure — column
  layout, data validations, the three lookup defined names — with every
  customer/employee/roster row cleared and every representation Astra round
  10 proved can carry an identity even in an "allowed" part (rich text,
  formulas, hyperlinks, quoted number formats, extra defined names,
  theme/font metadata, comments) flattened, dropped, or reset. The two
  Instructions worked-example cells that used to name the real firm's own
  employee now hold the literal placeholder `Employee Name`.
- `neutral-template.manifest.json` — `sha256` of the asset (checked by
  `_loadNeutralAsset` on every non-owner build; a mismatch throws rather than
  serving unverified bytes), the source file's name and sha256, when it was
  generated, the sheet list, the full package part list, and
  `forbiddenTokens` (every customer/employee name/token the source workbook's
  own roster carried, plus a best-effort pull from `ds2_local` account 1),
  and `exampleCellAddresses` (the `"Sheet!A1"`-style addresses of the
  worked-example cells the build script found and replaced — the runtime
  writes each tenant's own employee name to exactly these addresses, rather
  than re-searching by content: the placeholder text is a plain, friendly
  string that collides with the real Instructions sheet's own, unrelated
  field-label cell of the same text). forbiddenTokens is
  used both by the build script's own final gate and by the runtime's cheap
  per-build insurance check (`_assertNoForbiddenTokens`).

## Regenerating

Run the build script by hand — it is **not** part of any request path, CI
job, or migration, and it is never run automatically:

```
node scripts/timeTracking/build-neutral-template.js <input.xlsx>
```

`<input.xlsx>` should normally be a fresh `GET /template/latest` capture of
the real, OWNER-account template (e.g. `test/fixtures/timetrackers/real-base.xlsx`,
refreshed the same way if the firm's real template changes). The script is
fail-closed end to end: enumerates the input's worksheets two independent
ways (ExcelJS's parsed model and a real XML parse of `workbook.xml`) and
requires them to be exactly the eight known sheets; allows only the package
parts the real template has; and ends with a gate that decodes every
text-bearing part of the result and refuses to write anything if anything
from the input's own roster still appears. See the comment block at the top
of the script for the full list of steps.

**Regenerate this asset whenever the real firm template's structure
changes** (a new column, a new validation, a new sheet) — not for routine
per-tenant content changes, which the runtime already handles per request.

After running it:

1. Read the printed summary — it lists what was flattened/stripped/reset,
   cell by cell where relevant.
2. Look at the two output files yourself before committing them. This
   script proves the absence of the SPECIFIC risky shapes it knows to check
   for; it is not a substitute for a human looking at the file.
3. Run the unit suite (`test/endpoints/timeTracking/template-builder.spec.js`)
   and the integration coverage
   (`test/integration/coverage-timetracking-timesheets.integration.spec.js`,
   `test/integration/tracker-excel-end-to-end.integration.spec.js`) to
   confirm nothing regressed.

## Why this exists

See the design-decision comment above `buildTemplate` in
`../template-builder.js`: a runtime scrub of whatever the owner happens to
have uploaded — no matter how thorough — cannot be proven to catch every
representation OOXML supports for carrying a name. Astra round 10 (2026-09-23)
found two concrete ways past the prior "fail-closed allowlist + scrub"
design (an equivalent-XML bypass of the worksheet allowlist, and several
"allowed" package parts — hyperlinks, formulas, rich text, validation
messages, number formats, defined names, theme metadata — that still exposed
the real firm's identity). Rather than chase each new representation at
request time forever, non-owner downloads now come from a base that has
already been proven, once, offline, to contain none of it.

Owner requests (the template's own owner account downloading or
re-ingesting its own uploaded bytes) are unaffected by any of this — that
path keeps rebuilding from the owner's own bytes, same as before, since
there is no cross-tenant leak to prevent when an account is only ever
handed back its own data.
