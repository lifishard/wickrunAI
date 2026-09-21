# Local image input — 2.18.3

Local conversations now send image bytes separately from the portable text
transcript. Numbered placeholders retain their original message roles and order.
The same path is used when resuming a conversation or consuming a new input.
Attachment contents remain reference material rather than user instructions.

| Connection | Image transport | Verification on this Windows machine |
| --- | --- | --- |
| Grok | ACP `image` content blocks | Identified a blue circle and an orange square from a synthetic PNG |
| Codex | App-server `image` inputs | Identified the same shapes from the PNG |
| Claude Code | JSONL user message containing base64 image blocks; stream-json output | Protocol accepted by installed Claude Code 2.1.270; configured upstream rejected authentication with HTTP 403 |
| Kimi | ACP `image` content blocks when advertised | Covered by adapter tests; no live model test |
| Claude Desktop | Manual handoff | Still requires attaching images in the official app; the application explains this limitation |

Grok advertises `promptCapabilities.image: false` even though its image parser
accepts ACP image blocks. A Grok-specific compatibility exception is supported by
the official [prompt parser](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/prompt_parser.rs)
and the live test. Other ACP clients retain capability negotiation.

Codex isolation overrides also needed repair: quoted server names created new,
invalid MCP entries, and null optionals from config/read became invalid TOML.
The corrected override retains each server definition, omits null fields, and
sets enabled=false. The user's saved configuration is unchanged.

Accepted inline images: PNG, JPEG, GIF, WebP; at most 20 MiB per image, 100 MiB and
100 images per turn. A model or service may impose stricter limits. File paths
and remote URLs are rejected at the local IPC boundary. Image bytes are not
duplicated in dispatch journal records. Invalid inputs never silently fall back
to a text-only request.

Tests cover real transcript construction, resume/recovery, all four host routes,
native protocol payloads, unsupported ACP capability, malformed inputs, Codex
configuration isolation, and Claude's structured terminal result requirement.
Live tests used a synthetic image with no user information, not the user's
screenshot. Claude's HTTP 403 is a service access limitation and remains unresolved.

Protocol references: [Codex App Server](https://learn.chatgpt.com/docs/app-server),
[Claude CLI](https://code.claude.com/docs/en/cli-reference),
[ACP image content](https://agentclientprotocol.com/protocol/v1/content).
