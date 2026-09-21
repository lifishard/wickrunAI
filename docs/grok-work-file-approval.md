# Grok Work file approval — 2.18.4

Grok's current ACP permission requests for `Write` and `SearchReplace` include
`kind: edit` and `rawInput.file_path`, but omit the standard `locations` array.
wickrunAI previously discarded `rawInput`, then rejected these valid edits as
unscoped. The user saw “Grok Work 已禁用” before an approval could be displayed.

The adapter now recognizes these two observed input shapes, retains bounded
edit previews, and derives the target location from `rawInput.file_path`.
Targets still pass the existing absolute-path and workspace/symlink checks.
Conflicting standard locations or metadata, malformed inputs, unknown variants,
and unexpected input fields fail validation. Display titles never establish
filesystem authority. Other ACP providers do not inherit this compatibility rule.

The host rechecks the path when an approval is answered, so a directory changed
into a junction while the prompt is open cannot authorize an outside write.
Approval remains per operation; Grok's `allow_always` option is never selected.
Declines, interrupted results, and capability failures retain their existing
non-success states. The error message now describes the blocked operation
instead of implying that all Grok Work functionality is disabled.

Tests exercise actual captured Write/SearchReplace permission shapes through
the ACP adapter, real conversation host, approval queue, and durable job store.
They cover in-directory edits, outside/relative paths, conflicting scope,
malformed inputs, bounded previews, junction changes during approval, rejection,
and provider isolation. Live verification uses only newly created synthetic
README.md and NEW.md files through the same conversation host.

This change fixes file editing. It does not grant new shell, terminal, network,
delete, or unknown-tool permissions. See the existing scope checks for those
separate capabilities.
