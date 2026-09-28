# Office and Butler design verification

Recorded 2026-09-28. This documentation handoff covers ordinary extensions of the existing collaboration workspace. For the original Office and Butler pass below, the fresh reviewer disposition was **ship**: all five required screenshots were valid, the inherited world was maintained and no material fixes were requested. The later 2.20.13 library review and its narrower disposition are recorded separately at the end.

## Ground truth and scope

The source check covered `AgentOffice.tsx`, `AgentOffice.css`, `OfficePlanner.tsx`, `ButlerPreferences.tsx`, `TeamWorkspace.tsx`, `TeamWorkspace.css`, the base tokens in `src/styles.css`, `PRODUCT.md`, and the surface brief. Product code, shared tokens and incumbent design files were preserved. No new root DESIGN.md or design sidecar was introduced.

The shipped surface inherits the neutral backgrounds, blue accent, text colors, borders, body typography and existing button controls. Departments use bordered elevated surfaces with sunken member tiles; hierarchy is expressed through nesting. The office uses a role shelf and department area, stacking at the existing 760 px narrow-window breakpoint. Explicit Add controls and member destination selectors accompany dragging. Focus uses the inherited accent; drop highlighting is local and the department transition is disabled for reduced motion.

The source type hierarchy remains compact: the collaboration body is 14 px and workspace headings are 26 px. The office heading declares 22 px (20 px on narrow windows), while the shared content h2 rule declares 18 px; this pass records the source declarations without asserting a computed cascade result. Role and member names use 13 px; supporting labels use 11–12 px. These observations document this extension and do not create a new global type scale.

## Accepted first-viewport adaptation

The original brief placed an expanded planning area above the office. The build presents planning as its own Butler navigation destination, with the conversation visible there, and retains a collapsed entry above the Office. Both render `OfficePlanner`. This preserves conversation-first access while the Office foregrounds organization. The fresh reviewer accepted this adaptation; it is now recorded in the surface brief rather than promoted into a system-wide layout rule.

## Visual evidence

| Evidence | Recorded result |
| --- | --- |
| [Desktop office](../.impeccable/review/desktop.png) | Populated office, role shelf, independent member tiles and nested departments; planning entry collapsed. |
| [Narrow office](../.impeccable/review/mobile.png) | Stacked organization layout, two-column role shelf and reachable explicit Add controls. |
| [Desktop Butler](../.impeccable/review/butler-desktop.png) | Conversation, reviewed learning suggestion and proposal remain in the inherited collaboration shell. |
| [Narrow Butler](../.impeccable/review/butler-mobile.png) | Conversation and proposal wrap within the narrow layout; composer remains present. |
| [Butler rules](../.impeccable/review/butler-rules.png) | Expanded global/project instructions, learning preference and skill/source disclosures. |
| [Detection output](../.impeccable/review/detect.json) | Empty findings array (`[]`); corroborates the review but is not a substitute for visual or interaction checks. |

## Runtime evidence and limits

The runtime report at `../../meeting-room-qa/office-result.json` records `passed: true`, six requests, four departments, six members, zero runs started and an empty errors array. Its model-format result is “thinking toggle validated; effort rejected.” The persistence report at `../../meeting-room-qa/office-persistence-result.json` records `passed: true` and zero runs started for the same saved test profile. These reports support the tested organization/planning and persistence path without claiming that adopting or organizing a team executes work.

The runtime evidence uses a mock provider. It validates the exercised application/protocol behavior and does not measure real model reasoning quality, production endpoint compatibility, or the quality of real plans. Screenshot evidence covers the captured light-theme desktop/narrow states; it does not independently prove every interaction, every viewport, dark-theme rendering, or all items in the surface brief's FINISH list. This documentation pass did not rerun application tests or the build.

No new visual defect was reported by the fresh reviewer. The incumbent system-font stack and pre-existing workspace eyebrow styling were observed and left unchanged; neither was promoted into a new design rule. There was no approved visual-system change to document or repair.

## Library and role delegation extension, 2.20.13

This pass adds the full bundled directory of 279 roles across 18 categories, role search and batch import, previewed source changes, built-in department compositions, cross-project personal department reuse and multiple chat roles. `PRODUCT.md` and the last section of the surface brief remain authoritative. The documenter checked `AgentRolePicker.tsx`, `AgentOffice.css`, the base palette and typography declarations in `src/styles.css`, the library runtime report and its test procedure. This is an ordinary extension of the existing office shelf and department floor, with no approved change to the global visual system.

The extension reuses neutral surfaces, the inherited blue accent, existing button and field controls, character tiles and compact body typography. Search, category and batch actions precede bounded lists. Department entries disclose membership before assembly. Narrow office windows retain the existing stacked layout. These are local composition observations, not new palette, type or spacing tokens.

### Review finding and resolution

The initial fresh reviewer disposition was **fix** for one scored finding: the chat role menu's controls and enabled-worker text hid selectable role rows below its first viewport. The implementation shortened the instruction, paired search and category controls, collapsed the enabled roster into an expandable summary, limited role summaries to two lines and positioned the popup within the viewport. The same reviewer then marked the listed finding **Resolved**, found no visible regressions from that fix and returned **ship at the scored-fix scope**. This result does not constitute a blanket whole-surface approval or a claim that every workflow was visually reviewed.

Post-fix geometry checks reported a complete selectable role row and its checkbox visible without scrolling at the tested desktop and narrow sizes, including eight enabled workers. The recorded states use a 1280 × 920 desktop viewport and a 720 × 960 narrow viewport. The popup behavior and compact control arrangement remain local to this picker; they do not establish a global menu system.

### Captures and reports

| Evidence | Scope |
| --- | --- |
| [Role library, desktop](../.impeccable/review/library/library-roles-desktop.png) | Category-filtered role shelf and populated department area. |
| [Role library, narrow](../.impeccable/review/library/library-roles-narrow.png) | Stacked office with an imported role found by search. |
| [Department library, desktop](../.impeccable/review/library/library-departments-desktop.png) | Built-in composition details and assembled office. |
| [Department library, narrow](../.impeccable/review/library/library-departments-narrow.png) | Department library and office in the narrow layout. |
| [Chat role menu, desktop](../.impeccable/review/library/library-chat-roles-desktop.png) | Search and selectable role row with two enabled workers. |
| [Eight-worker chat menu, desktop](../.impeccable/review/library/library-chat-eight-desktop.png) | Collapsed enabled roster and a complete selectable role row after the fix. |
| [Eight-worker chat menu, narrow](../.impeccable/review/library/library-chat-eight-narrow.png) | The same eight-worker condition with the menu inside the narrow viewport. |
| [Library runtime report](../.impeccable/review/library/library-result.json) | `passed: true`; 279 built-in roles, two imported custom roles, one personal department, two reused members, five assembled departments, two selected workers, zero runs started and no errors. |
| [Library detection output](../.impeccable/review/library/detect.json) | One recorded run returned `[]`; this is supporting evidence, not exhaustive visual or interaction approval. |

The runtime procedure exercises batch placement, two Markdown imports, source-update preview and selective adoption, personal department reuse in another project, built-in department assembly and two-role chat configuration. It checks distinct member identities, disabled/unconfigured reused members, retained role instructions in worker configuration and no organization runs started. The two selected workers in the JSON report describe that runtime scenario; the separate eight-worker captures and geometry checks cover the denser picker state.

### Evidence limits

Source-update checks used mocked upstream commit, tree and Markdown responses. They establish behavior for the supplied unchanged/changed fixtures, not availability or correctness of the live upstream service. The isolated model profile and role-configuration checks do not establish real model reasoning quality, production endpoint compatibility or a completed live multi-agent conversation. In particular, `runsStarted: 0` supports organization without execution; it is not evidence that worker execution succeeded. Actual worker prompt propagation remains a separate runtime verification concern from this visual handoff.

The screenshots cover the recorded light-theme desktop and narrow states. They do not independently prove every import failure, source conflict, viewport, dark theme or all items in the surface brief's FINISH list. This documentation pass did not rerun the build, detection or application tests. No source, shared tokens, root DESIGN.md or design sidecar was changed by this pass. The inherited system-font stack and pre-existing eyebrow styling were left unchanged and were not canonized as new rules; no broader redesign was authorized.
