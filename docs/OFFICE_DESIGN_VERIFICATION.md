# Office and Butler design verification

Recorded 2026-09-28. This documentation handoff covers an ordinary extension of the existing collaboration workspace. Fresh reviewer disposition: **ship**. All five required screenshots were valid; the inherited world was maintained and no material fixes were requested.

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
