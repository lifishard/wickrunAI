# wickrunAI documentation

wickrunAI orchestrates every AI model you have access to — open and closed, paid and free — inside one application, so they can divide up a task, and so that when one of them fails the work is handed to the next instead of stopping.

Back to the [English README](../README.md) · [简体中文 README](../README.zh-CN.md)

## Concepts

| Page | What it covers |
|---|---|
| [BYOK AI client](byok-ai-client.md) | What bring-your-own-key means here, where keys are stored, why nothing goes to a server of ours |
| [LLM failover](llm-failover.md) | Three-level scope inheritance, which errors trigger a handover and which deliberately do not, what travels with the task |
| [Multi-model router](multi-model-router.md) | Route scoring from your own task outcomes, why the unit is a hashed route alias, why it recommends instead of replacing |
| [OpenRouter from a desktop client](openrouter-desktop-client.md) | Connecting OpenRouter, and how its four distinct "no endpoints" failures are decoded |
| [Mobile remote bridge](mobile-remote-bridge.md) | How the phone gets file, browser and CLI tools by relaying calls to your desktop over the LAN |
| [Three layers of self-improvement](architecture-rsi.md) | The long-form design piece: what is actually hard about multi-model orchestration, the execution / experience / meta split, and the counter-intuitive trade-offs — also in [简体中文](architecture-rsi.zh-CN.md) |

## Reference

| Page | What it covers |
|---|---|
| [Architecture](ARCHITECTURE.md) | How the desktop and Android clients are put together |
| [Configuration](CONFIGURATION.md) | Reasoning effort, tool permissions, task budgets, and the rest |
| [Building](BUILD.md) | Building from source, the release flow, and the Android build |
| [Local connections](LOCAL_CONNECTIONS.md) | Calling Codex, Claude Code and Kimi Code clients installed on your machine |
| [Model handoff](MODEL_HANDOFF.md) | How the relay between models works |
| [Harness](HARNESS.md) | Task harness behaviour |
| [Adaptive context](ADAPTIVE_CONTEXT_PLAN.md) | Context management plan and [roadmap](ADAPTIVE_CONTEXT_ROADMAP.md) |
| [Delivery, recovery, observability](DELIVERY_RECOVERY_OBSERVABILITY_DESIGN.md) | Design and [roadmap](DELIVERY_RECOVERY_OBSERVABILITY_ROADMAP.md) |
| [Release notes](releases/) | Per-version notes |
| [Release playbook](release-playbook.md) | Release notes template, which past versions still need a Release page, and the ready-to-publish 2.9.0 notes |
| [Launch kit](launch-kit.md) | Finished copy for every external channel, with the order to publish in and what each item is blocked on |
| [Repository SEO checklist](seo-checklist.md) | Maintainer task list for repository metadata |

Most reference pages under `docs/` are written in Chinese. The concept pages above are in English; the design piece has a Chinese version alongside it.
