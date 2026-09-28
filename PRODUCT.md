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
