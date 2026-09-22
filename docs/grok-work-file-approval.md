# Grok Work permissions and progress — 2.18.7

## 2.18.7

Local incident records identified two distinct failures: rejected `fetch`
requests for public GitHub pages, and a `session/prompt` deadline expiring.
The generic permission message previously hid the distinction.

The adapter now accepts the observed `WebFetch` input (`variant` and HTTP(S)
`url`) and retains prior tool details for partial permission updates within
the same active session. Titles alone never establish authority. Unknown
inputs, conflicting targets, embedded URL credentials, and file URLs remain
rejected. Automatic edit mode honors host-validated read and edit classes;
native shell commands still require explicit approval. A task folder nested
inside an authorized root is accepted, while escaping junctions are rejected.

Grok thought chunks, tool updates, and plans now reach the renderer separately
from answer text. The activity panel shows the current notice even while an
earlier tool remains in progress. A local heartbeat reports elapsed silence
every 15 seconds; it does not claim the server is thinking or healthy.

An active Grok prompt has no automatic wall-clock or silence cutoff. The user
can still cancel; process exits, protocol failures, and upstream error replies
remain failures with preserved partial work and no automatic redispatch.
Initialization/configuration RPCs retain deadlines. Grok permission waits no
longer expire on the ordinary RPC timer. A rejected operation cannot replace
an independently returned failure or unknown-execution error.

Protocol reference: [ACP SessionUpdate](https://agentclientprotocol.github.io/typescript-sdk/types/SessionUpdate.html).

## 2.18.4

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
