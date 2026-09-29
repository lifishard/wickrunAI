# Office extension direction contract

THESIS: A person describes an outcome; the workspace helps turn it into a reviewable team plan.

OWN-WORLD: Inherit wickrunAI's desktop tokens and controls. Character tiles represent reusable roles; departments represent real saved compositions, never fake activity.

STORY: Describe intent, discuss uncertainties, review a proposed team and steps, adopt a draft, then start via the existing preflight. Reorganizing people never runs work.

FIRST VIEWPORT: The dedicated Butler (管家) page exposes natural-language planning and the ongoing conversation. The Office keeps a collapsed planning entry above its organization area, leaving roles and saved departments prominent. This is the accepted implementation adaptation of the original planning-area-above-office brief; both entries use the same planner. Role shelf beside a department area; narrow windows stack them. Drag is the signature interaction, with explicit add/move controls for keyboard use. Only drop targets receive a brief highlight; respect reduced motion.

FORM: Extend the existing collaboration shell. No replacement navigation or new brand. Departments expose hierarchy, members and work purpose; technical graphs remain an optional editor.

FINISH: Verify fresh/empty and populated offices, drag and keyboard placement, nesting/cycle rejection, independent copying, plan adoption without execution, output preservation and narrow-window reachability. Seed: user-pinned office/role metaphor and confirmed conversation-first interaction; local extension, no direction roll.

DOCUMENTED DISPOSITION (2026-09-28): Fresh visual review: ship, with all five required screenshots valid and no material fixes. The inherited visual world remains authoritative. This ordinary extension does not establish a new DESIGN.md, theme or shared token set. See [Office design verification](OFFICE_DESIGN_VERIFICATION.md) for the evidence and its limits; the FINISH list is the intended verification scope, not a claim that screenshots prove every behavior.

## Library and role delegation extension, 2.20.13

THESIS: Find reusable expertise and assemble it without engineering a workflow first.

OWN-WORLD: Preserve the current office shelf, department floor, neutral surfaces, blue controls and user-requested character tiles. This is a local extension; no new visual world or concept roll.

STORY: Search or filter the complete role directory, select roles or a department composition, and create independent instances. The user confirmed built-in department combinations plus a cross-project personal library. Source changes are previewed and selected before adoption; existing member prompts and saved department snapshots remain independent.

FIRST VIEWPORT: The existing shelf switches between roles and departments, with search, category and explicit batch actions. Lists remain bounded and scrollable; narrow windows stack shelf and office. The chat composer exposes search and multiple role selection in its existing role menu. Compact instructions, paired search/category fields and a collapsed enabled-worker roster leave a complete selectable role row and its checkbox visible before scrolling in the captured desktop and narrow states, including eight enabled workers. The popup is positioned within the available viewport.

FORM: Roles retain their original prompts and source; department details show membership before assembly. Chat workers use actual bounded subagent execution and expose per-role status and full results. API execution is distinguished from external-client capabilities. Organizing never starts tasks.

FINISH: Check source-diff adoption, batch imports, cross-project reuse, independent instances, multi-role selection and actual worker prompt propagation. Capture desktop and narrow office states plus the chat role menu, obtain a fresh finish review and document the outcome without changing shared design tokens.

DOCUMENTED DISPOSITION (2026-09-28, 2.20.13): This extension exposes the bundled 279-role, 18-category directory, batch import and source-change previews, built-in department combinations, a cross-project personal department library and chat role delegation. The initial fresh review requested one fix: role rows were hidden below the chat menu's first viewport. After the local layout fix, the same reviewer marked that finding **Resolved**, reported no visible regressions from the fix and returned **ship at the scored-fix scope**. This is not blanket approval of the whole surface. The inherited visual system remains authoritative; no new DESIGN.md, sidecar or shared tokens were introduced. Captures, runtime evidence and mock-upstream/model limits are recorded in [Office design verification](OFFICE_DESIGN_VERIFICATION.md#library-and-role-delegation-extension-22013).
# 2.20.14 language and role-inspector refinement

The office keeps its established Operate surface. Role selection and role details share a row: library left, collapsible inspector right. The inspector body scrolls within a viewport-bounded panel. Both items stay in normal page flow while details are open, so they cannot float over the department floor below. Hiding details retains selection and returns focus to a visible reopen button; the department floor returns beside the library. The selected template has a pressed state.

UI labels, categories and built-in role names follow Simplified Chinese, Traditional Chinese and English. Search retains Chinese and English role aliases. Custom names and execution prompts are not rewritten; source descriptions and prompts are labeled as original. English translations live in the shared dictionary extension, not DOM replacement.

## 2.20.15 actionable assistant discussions

Preserve the assistant's existing Operate surface. A discussion proposal presents preparation steps, discussion rounds and expected output, synthesis, independent review and user acceptance in execution order. Per-role model selectors expose actual configured API routes before adoption. The user can repair a failed draft in place; raw replies remain collapsed and readable prose remains visible. Adoption creates drafts without starting work, and opens the existing task page with a real workflow preview. Original user materials accompany the task. Discussion and quality review retain separate member identities. No shared tokens or new visual system are introduced.

## Unified workspace assistant, 2.20.16

Operate mode, preserving the incumbent shell. Natural language produces a readable arrangement with concrete members, models and tasks; full workflow details collapse by default. Adoption saves configuration, followed by individually named work/meeting actions. Persisted receipts distinguish saved, pending and applied states. Human decisions open the existing controls. No new visual tokens, global navigation or branding.
