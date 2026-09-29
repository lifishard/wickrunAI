# wickrunAI

Desktop workspace for people using their own AI connections to discuss and accomplish work. Existing chat, collaboration workflows, files, memory and independent quality review remain available.

## Office extension

Confirmed with the user: begin with a person's intended outcome, not a request to engineer a workflow or write acceptance criteria. Help clarify the request conversationally, show assumptions and propose responsibilities, outputs and completion checks for review. Planning and starting work are separate actions.

Role templates and department templates are reusable. Each placement creates an independent member instance with its own model and responsibilities. Departments can contain departments, move, split, combine and be copied. Organization hierarchy does not imply execution order or authority. Explicit workflows retain parallel work, handoffs, quality review and human decisions.

People may use character tiles and drag-and-drop to organize teams. Provide keyboard equivalents. The existing workflow editor remains available for detailed customization. Discussion and consensus never replace quality review. Ask the human when their decision is needed.

## Platform and inherited design

React desktop interface in Electron; existing CSS variables, typography, theme, controls and navigation are authoritative. This is an extension, not a visual redesign. Keep responsive narrow-window support.

## Compatibility and output

Automatically verify small, bounded protocol requests for the selected endpoint and model. Do not claim HTTP acceptance proves reasoning quality. Preserve previously displayed text and thinking when later output replaces it; presentation history is separate from model context.

## Android phone preview

<!-- impeccable:product-schema 1 -->

### Platform

web

### Product Purpose

wickrunAI supports conversations and tool-assisted work using the user's model credentials. Its existing React interface also runs in the Android Capacitor package.

### Operating Context

The user evaluates the phone interface on a POCO F5, with the smallest system font and no display enlargement. Browser viewport checks are supplemental evidence, not physical-device acceptance.

### Capabilities and Constraints

Preserve existing features and the wickrunAI brand. The user confirmed that the phone interface should prioritize quickly starting a conversation, one-handed input, and convenient model switching. Apply mobile improvements to both web and APK surfaces. Keep login discoverable and expose account management through one entry.

### Product Principles

- Organize controls around the primary conversation task.
- Keep visible controls compact without making touch targets difficult to hit.
- Preserve a usable composer when the keyboard opens.
- Distinguish verified behavior from untested device behavior.

### Evidence on Hand

User-supplied POCO F5 screenshots document oversized suggestion rows, excessive composer height, widely spaced ellipsis, and disproportionate menu controls in Android preview 2.20.12.
