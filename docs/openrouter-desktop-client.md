# Using OpenRouter from a desktop client

OpenRouter exposes an OpenAI-compatible endpoint, so wickrunAI connects to it as an ordinary credential profile. What is specific to OpenRouter is the way it fails, and wickrunAI has that decoded. Source: `src/lib/api.ts`, `src/lib/errors.ts`.

## Connecting

OpenRouter is the first entry in the Base URL preset list, labelled as including free-model routing:

```
https://openrouter.ai/api/v1
```

Steps:

1. Settings → API credentials → add a credential profile.
2. Pick the OpenRouter preset as the Base URL, or paste it.
3. Paste your OpenRouter key and press Test connection.
4. Choose a model next to the composer and send one message to confirm.

The key is encrypted into the OS keystore — see [BYOK](byok-ai-client.md). Billing stays entirely on your OpenRouter account.

## Decoding OpenRouter's failure modes

A gateway does not fail like a single provider. OpenRouter returns 404 for a model ID that exists but currently has no eligible endpoint for your request, which reads as "model not found" unless something tells you otherwise. wickrunAI matches the routing reason before generic HTTP handling, and maps four distinct situations:

| Upstream signal | Classified as | What it actually means |
|---|---|---|
| data policy / guardrail restrictions / ZDR violation / zero data retention | `routing_policy` | Your account's privacy settings excluded every endpoint that could serve this |
| no endpoints supporting image / vision input | `multimodal` | The model has no endpoint accepting image input right now |
| no endpoints supporting tools or functions | `tools_unsupported` | The model has no endpoint accepting tool calls right now |
| no available endpoints / 0 endpoints | `route_unavailable` | Nothing eligible is serving this request at the moment |

Each classification carries concrete fixes rather than a generic retry prompt. The privacy one, for example, points at `https://openrouter.ai/settings/privacy` to check the zero-data-retention and free-endpoint settings, tells you to adjust them only if you actually accept that endpoint's data policy, and states plainly that this is not a typo in your model ID or Base URL and that the application will not loosen your account's privacy restrictions on your behalf.

The image one adds a detail that costs people a lot of time: images already in the conversation history are re-sent with the context, so deleting only the current attachment may still be rejected.

The tools one notes that even plain text chat can involve the built-in question tool, so a task can need tool support where you did not expect it.

## Why this matters for failover

All four of these classifications are in the hand-off set. See [failover](llm-failover.md): `routing_policy`, `route_unavailable`, `tools_unsupported`, and `multimodal` each trigger a handover to the next route on your list, carrying the saved progress.

This is what makes OpenRouter's free routes usable for real work. A free route that loses its eligible endpoints mid-task is not a dead end; it is a handover to whatever you put next in the list. The verified sequence behind this design was exactly that: OpenRouter out of credit, next route short on quota, third route finishing the task, nobody watching.

If you want to find free tiers to stack behind each other, the community list linked from the README catalogues which providers offer one and how they rate-limit it. wickrunAI has no affiliation with those providers and endorses none of them.

## Related

- [Failover between models](llm-failover.md)
- [Multi-model routing and route scores](multi-model-router.md)
