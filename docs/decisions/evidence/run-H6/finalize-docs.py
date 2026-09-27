"""Write H6 results from accepted local evidence, never predicted test counts."""
from pathlib import Path
import json,re
here=Path(__file__).resolve().parent
backend=here.parents[3]
root=backend.parent
accepted=json.loads((here/'acceptance/final-acceptance.json').read_text())
protected=json.loads((here/'account1-verification.json').read_text())
assert accepted['accepted'] and protected['valid']
c=accepted['counts'];n=lambda x:f'{x:,}'
after=json.loads((here/'account1-after.json').read_text())['tables']
graph=(here/'graphify-refresh.log').read_text()
files=int(re.search(r'Corpus: (\d+) code files',graph)[1])
nodes,edges,communities=map(int,re.search(r'Graph: (\d+) nodes, (\d+) edges, (\d+) communities',graph).groups())
notes=int(re.search(r'Obsidian: (\d+) notes',graph)[1])
source=json.loads((here/'source-changes.json').read_text())
protected_text='| Account-1 table | Final rows | Retained reference / H6 baseline |\n|---|---:|---|\n'+'\n'.join(f'| `{t}` | {n(after[t]["count"])} | matches |' for t in protected['reference_counts'])
protected_text+='\n\nAll **12 account-1 counts and complete row digests** match the pre-H6 capture; the **207,272-event** audit chain verifies. Intended and observed H6 migration effects on account 1: **none, zero rows**. The comparison uses the retained reference census without connecting to `ds2_ref_20260922`. [Before](evidence/run-H6/account1-before.json), [after](evidence/run-H6/account1-after.json), [verification](evidence/run-H6/account1-verification.json).'
validation=f'''| Required command | Accepted result |
|---|---:|
| Backend unit | {n(c['unit'])} passed |
| Integration, one file at a time | {n(c['integration'])} passed / {c['integration_files']} files |
| Standalone scenarios | {n(c['scenarios'])} passed / {c['scenario_files']} files |
| Clean-room | {c['cleanroom']} passed |
| Lambda pytest | {c['lambda']} passed |
| Frontend Jest | {c['frontend_tests']} passed / {c['frontend_suites']} suites |
| CI production build | passed |
| Full remote Playwright | {c['playwright']} passed |
| Read-only drift | 0 / {n(c['drift_comparisons'])} client/business comparisons |

All **{accepted['required_commands']} required commands** have accepted exit-0 results. Accepted tests have **zero failures, skipped, pending or flaky cases**; browser retries are disabled. The [consolidated manifest](evidence/run-H6/acceptance/final-acceptance.json) identifies the command and evidence log for each accepted result. [Full browser JSON](evidence/run-H6/acceptance/playwright-results.json), [drift](evidence/run-H6/drift.json).

The focused visual/keyboard/refund recheck is recorded separately and is not added to the full-suite count. It covers final header/menu presentation, the exact stale-refund refusal and settled drawer screenshots after visual refinements. Additional header geometry checks prove the controls remain in the viewport, receive pointer events and open the account menu. [Visual review](evidence/run-H6/visual-review.json), [focused results](evidence/run-H6/visual-final-results.json), [header geometry](evidence/run-H6/header-geometry-results.json). All prior failure diagnostics remain available; only the accepted results above form this verdict.'''
p=backend/'docs/decisions/2026-09-26-run-H6-results.md';s=p.read_text().replace('PROTECTED_RESULTS_PENDING',protected_text).replace('VALIDATION_RESULTS_PENDING',validation)
s=re.sub(r'Offline Graphify processed .*?\[Graph log\]\(evidence/run-H6/graphify-refresh.log\)\.',f'Offline Graphify processed **{n(files)} code files** into **{n(nodes)} nodes**, **{n(edges)} edges**, **{n(communities)} communities** and **{n(notes)} graph notes**, with zero model calls. [Graph log](evidence/run-H6/graphify-refresh.log).',s)
s=s.replace('Final source scope, visual review and mirror verification are recorded in the accompanying evidence after browser acceptance.',f'The [source inventory](evidence/run-H6/source-changes.json) records **{source["changed_or_added"]} changed or added source/test files**, with **zero backend runtime/test/migration changes**. [Expanded desktop viewport](evidence/run-H6/screenshots/desktop-expanded-viewport.png), [collapsed desktop](evidence/run-H6/screenshots/desktop-collapsed.png) and [390px layout](evidence/run-H6/screenshots/mobile.png) passed visual review. The expanded full-page capture omitted fixed header controls; the viewport capture, hit testing and menu interaction independently verify their availability. `handoff-verification.json` records the exact document mirror and link checks. The ordinary account-1 read-only suites remain protected by their unchanged network guard; user-management testing uses only its exact owned synthetic user.')
p.write_text(s)
summary=f'''- **Accepted validation.** All {accepted['required_commands']} required commands exited 0: unit {n(c['unit'])}; integration {n(c['integration'])} / {c['integration_files']} files; standalone scenarios {n(c['scenarios'])} / {c['scenario_files']} files; clean-room {c['cleanroom']}; Lambda {c['lambda']}; Jest {c['frontend_tests']} / {c['frontend_suites']} suites; CI build passed; full remote Playwright {c['playwright']} passed. Zero final failures, skips, pending or flaky tests. Scenario/clean-room totals overlap integration. Final visual/keyboard rechecks are separate, not double-counted. Drift 0 / {n(c['drift_comparisons'])} client/business comparisons.
- **Protected data and rollout.** No migration or backfill; 047 remains next free. Required account-1 counts remain 338/39,052/1,005/657/2,253/28,255/23 and all 12 captured table digests are unchanged. The 207,272-event audit chain verifies. Retained reference counts match without connecting to that database. No backend runtime/API/schema change or restart; deployment is frontend-only and remains an operator action. No Git, production/AWS, real-email or deployment action was performed.
- **Verification repairs and handoff.** Existing employee transfer-history access is retained. Invoice downloads leave the loaded detail visible. User deletion handles transport failures and double submits; a synthetic Super Admin CRUD browser flow verifies the session actor in its audit events. Account-menu keyboard focus and role-appropriate Home links, settled drawer transitions and narrow recurring-filter labels are covered. Offline Graphify: {n(files)} files, {n(nodes)} nodes, {n(edges)} edges, {n(communities)} communities and {n(notes)} notes, with no model calls. Documentation and the Obsidian mirror are synchronized. No owner decision is blocking H6.
'''
p=root/'MEMORY.md';s=p.read_text().replace('H6_VALIDATION_PENDING',summary);p.write_text(s)
p=backend/'scripts/review-2026-09/FINAL_REPORT.md';s=p.read_text().replace('H6_ACCEPTANCE_PENDING',summary+'\n[Accepted command manifest](../../docs/decisions/evidence/run-H6/acceptance/final-acceptance.json), [protected verification](../../docs/decisions/evidence/run-H6/account1-verification.json), [route rules](../../docs/platform/workspace-navigation.md).');p.write_text(s)
print('Updated H6 results, workspace MEMORY and FINAL_REPORT from accepted evidence.')
