<div align="center">

<img src="build/icon.png" width="96" alt="wickrunAI">

# wickrunAI · 灯芯AI

**Every AI model you own, in one app — and when one fails, the next one takes over mid-task.**

Open or closed, paid or free. Bring your own keys; they never leave your machine.

[![Version](https://img.shields.io/badge/version-2.9.0-1f6feb)](https://github.com/lifishard/wickrunAI/releases)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-lightgrey)](#install)
[![CI](https://github.com/lifishard/wickrunAI/actions/workflows/ci.yml/badge.svg)](https://github.com/lifishard/wickrunAI/actions/workflows/ci.yml)

[Download](https://github.com/lifishard/wickrunAI/releases) · [Docs](docs/README.md) · [Configuration](docs/CONFIGURATION.md) · [Building](docs/BUILD.md) · [Security](SECURITY.md)

**English** · [简体中文](README.zh-CN.md)

</div>

---

<!-- TODO: failover.gif -->

> **Demo slot — recording needed.** Capture the sequence that was verified end to end with no human intervention: a task running on **OpenRouter** hits an out-of-credit error, hands off to **SenseNova**, where **glm-5.2** turns out to be short on quota, hands off again, and **kimi-k3** picks the task up and finishes it. Three routes, two handovers, one task, nobody watching. Keep the route chips and the handover notice legible; about fifteen seconds is enough. Save it as `docs/failover.gif` and replace the comment above with `![Failover in progress](docs/failover.gif)`.

## 60 seconds to your first answer

1. **Download.** Grab the file for your platform from [Releases](https://github.com/lifishard/wickrunAI/releases) and run it. No account, no sign-up.
2. **Add one key.** Settings → API credentials → paste a Base URL and an API key, press **Test connection**. Pick the OpenRouter preset if you want a free route to start with. The key is encrypted into your OS keystore — Windows DPAPI, macOS Keychain, Linux libsecret.
3. **Send a message.** Choose a model next to the composer and ask something. That is the whole setup.

Then, when you want more: add a second key and put both routes in the failover list, add a working directory for file tools, or configure a search service. See [Configuration](docs/CONFIGURATION.md).

## How it compares

wickrunAI is one of many bring-your-own-key clients. What is specific to it is what happens when a model stops working in the middle of a task.

Only the wickrunAI column is a claim about this repository, verified against the source. For the other products, a cell says **—** wherever this table's authors have not verified the answer; **— does not mean the product lacks the feature.** Correct any of it by opening an issue.

| | wickrunAI | Chatbox | LobeChat | Cherry Studio | Open WebUI |
|---|---|---|---|---|---|
| Bring your own API key | Yes | Yes | Yes | Yes | Yes |
| Runs as a desktop application | Yes (Electron) | Yes | — | Yes | No — self-hosted web server |
| Automatic handover to the next route mid-task, carrying saved progress | Yes | — | — | — | — |
| Failover list scoped session → project → app, each level able to inherit or override | Yes | — | — | — | — |
| Route ranking computed from your own finished tasks | Yes | — | — | — | — |
| Keys encrypted into the OS keystore | Yes | — | — | — | — |
| Phone relays tool calls to your desktop over the LAN | Yes | — | — | — | — |
| Calls subscription CLIs installed on your machine (Claude Code, Codex, Kimi Code) | Yes | — | — | — | — |
| License | Apache-2.0 | — | — | — | — |

The four rows in the middle are the ones worth reading the code for:

- **[LLM failover](docs/llm-failover.md)** — which errors trigger a handover, and which three deliberately do not, because switching models cannot fix a malformed request, a behavioural loop, or a cause nobody identified.
- **[Multi-model router](docs/multi-model-router.md)** — done rates computed per hashed route alias, an eight-sample floor before any number is shown, and a reorder button you have to click, because the program does not know which of your routes is the free one.
- **[BYOK](docs/byok-ai-client.md)** — where the key goes and what never leaves the machine.
- **[Mobile remote bridge](docs/mobile-remote-bridge.md)** — how a phone with no file access still gets file, browser and CLI tools.

Full documentation index: **[docs/README.md](docs/README.md)**.

---

## What it is

wickrunAI is an open-source AI client for Windows, macOS, and Linux. Connect any service that uses the OpenAI-compatible API and use it to research topics, work through documents, read and write files, drive Chrome, or call the Claude Code installed on your machine.

On a long task you can have one model gather the material, pause, then hand the work to another model to organize or check it. wickrunAI keeps your requirements, the run journal, and the original evidence. Press Continue and the new model resumes from the saved position. You still need to check the result, above all citations, arithmetic, and generated files. See [Model handoff](docs/MODEL_HANDOFF.md) for how the relay works.

Use an API key from a model provider, or connect an official client you already run on your machine from the desktop model picker. Accounts, subscriptions, and API charges stay with the provider. An Android client connects to your computer over the local network; it has not been verified on a physical device yet.

The interface reads in Simplified Chinese, Traditional Chinese, and English, switchable from the top right. Most reference documents under `docs/` are in Chinese; the five concept pages linked above are in English.

## 2.3 Conversation isolation and three interface languages

Opening a new conversation no longer leaves the composer occupied by another running task. Run state is bucketed per conversation: each one runs its own route, none of them locks another's composer, and queued input only joins the queue of the conversation it belongs to. Quota was always counted per route (credential, model, endpoint), and the run lock now matches that same granularity. Conversations in one project share its rules, memory, documents, and prompts, but not the run queue or the quota.

Two conversations writing into the same directory tree would overwrite each other, so write access is registered per tree. While one holds it, the next waits and says which conversation is working there. Read-only runs neither register nor get blocked.

The interface reads in Simplified Chinese, Traditional Chinese, and English, switchable next to the model chip at the top right. The Simplified text is the translation source, Traditional is converted by OpenCC, and English comes from a dictionary. Text meant for the model does not follow the interface language: permission tool results, continuation instructions, and exported diagnostic reports stay in Chinese, because switching them would change how the model behaves.

Also in this line: the run-mode entry became a button, the bottom toolbar has an adjustable button density, deleting a conversation asks first, a pinned conversation still appears under its project, and team workspace notifications match the single-agent ones. See the [2.3.14 notes](docs/releases/v2.3.14.md).

## 2.2 Local clients, task guardrails, and large attachments

API routes and locally installed subscription clients have separate jobs: the API side handles the compatible interface and connection checks, while Local AI calls the official Codex or Claude Code client you are already signed in to. Helper models are dispatched on demand with visible progress, and the run journal stays on your machine.

Task execution gained optional context management and delivery guardrails. Understanding the request, asking when something is missing, editing under the project's rules, reviewing, testing, and reporting delivery state are all recorded by the program, and you can turn the whole flow off for a model that does not need it. An interruption, a stream ending, or a model stopping early preserves the scene, so unfinished work is not mistaken for finished.

Attachment limits are one text or code file up to 25MB, one image up to 20MB, and 100MB per selection. Originals stay in the local record and long text is paged in on demand, instead of quietly pushing a whole large file into every round of context. Saving large records moved to a dedicated background thread so it does not block the main process. See the [2.2.0 notes](docs/releases/v2.2.0.md).

## 2.1 Local clients and question cards

The model picker gained a Local AI entry. It detects Codex, Claude Code, and Kimi Code, and shows the connection state, models, and reasoning effort. Codex supports the official ChatGPT login; Claude and Kimi reuse the authorization their official clients already hold. Grok and other compatible services continue over the API. Capability differences, native client requirements, and the open connector interface are in [Local connections](docs/LOCAL_CONNECTIONS.md).

Chat and Work both support question cards, where the model asks you something and you pick an option or write your own answer. Drafts, answers, and pending operations stay on your machine, and the task continues from where it paused. Switching between a local client and the API keeps the same conversation and text attachments. See the [2.1.0 notes](docs/releases/v2.1.0.md).

## 2.0 Team workspace

The Single agent ⇄ Team workspace switch at the top opens a project team: members, task goals, workflows, isolated files, and delivery acceptance. Workflows support dragging nodes, branching, bounded loops, saved versions, and recovery after an interruption. Project records, drafts, and checkpoints stay on your machine, and project settings offer backup and restore.

The local Codex and Claude Code adapters are wired up; real calls need the official client and a valid login, and native permissions differ from the API tool allowlist. Project experience is adopted by you, with your own evidence; automatic RSI experiments are not implemented. See the [2.0.0 notes](docs/releases/v2.0.0.md), and the [2.0.1 notes](docs/releases/v2.0.1.md) for the interface pass and the mode-handoff fixes.

## What it can do

| Job | How |
|---|---|
| Research | Configure Tavily, Brave, or SearXNG, then read the source links in the answer |
| Work with files | Add a working directory, then have the model read material and produce documents or spreadsheets; open the result from its file card |
| Continue a long task | Pause, restart the app, or switch models, then resume from the saved run journal |
| Drive a browser | Launch the dedicated Chrome instance, sign in to the sites you need, then authorize the model |
| Code and repository work | Read GitHub repositories, search code, or call an installed Claude Code; run commands under your permission setting |
| Organize projects | Save shared instructions, reference documents, and prompts for a group of conversations |
| Use skills | Import a `SKILL.md` skill and call it with `/name` in a conversation |
| Run on a schedule | Set an interval, daily, weekly, or cron task; it needs the relevant device and services available when it fires |
| Inspect calls | Review connections, usage, and failures; on a rate limit it waits and retries under the recovery policy |

Models differ in what they support for tool calls, images, and reasoning parameters. On a new endpoint, test the connection first, then try a small task.

## Install

Download the file for your platform from [Releases](https://github.com/lifishard/wickrunAI/releases). Recent files use the `wickrunAI` prefix; older versions keep the names they were published under.

| Platform | File |
|---|---|
| Windows 64-bit | `wickrunAI-x.y.z-win-x64-setup.exe`, or `-portable.exe` to run without installing |
| macOS Apple Silicon | `wickrunAI-x.y.z-mac-arm64.dmg` |
| macOS Intel | `wickrunAI-x.y.z-mac-x64.dmg` |
| Linux 64-bit | `wickrunAI-x.y.z-linux-x64.AppImage` or `.deb` |

The packages are not code-signed, so Windows and macOS may warn about the publisher. Verify a download against `SHA256SUMS.txt` in the Release, or build from source as described below.

### First run

1. Open Settings → API credentials, add a Base URL and API key, and press Test connection.
2. Pick a model next to the composer and send one question to confirm you get a reply.
3. To work with local files, add a working directory under tool settings.
4. To search the web, configure a search service. To operate websites, launch Chrome from the tools panel and sign in.

The model choice is saved per conversation. Reasoning effort, tool permissions, task budgets, and the rest are covered in [Configuration](docs/CONFIGURATION.md).

### Finding free quota

The community list at [github.com/raullenchai/free-llm-api-resources](https://github.com/raullenchai/free-llm-api-resources) records which providers offer a free tier and what they rate-limit it to. It is a fork of [cheahjs/free-llm-api-resources](https://github.com/cheahjs/free-llm-api-resources).

wickrunAI has no affiliation with the authors of that list, or with any API provider named in it. This application makes no endorsement or recommendation of them, and is neither endorsed nor sponsored by them. Free tiers and their terms are set by each provider and can change at any time.

### Upgrading from an older version

The project has been called SenseNova Chat and AnyAI. Upgrading from AnyAI keeps the original data directory, so your configuration, conversations, run journal, and the tool browser's logins carry over. The directory is still named `anyai`, which is deliberate for compatibility.

Quit the old version before installing a new one. There is no auto-update; download new versions from Releases.

## Build from source

Node.js 20 or newer.

```bash
git clone https://github.com/lifishard/wickrunAI.git
cd wickrunAI
npm install
npm run dist:win
```

On macOS or Linux, use `npm run dist:mac` or `npm run dist:linux` for the last step. On Windows you can also double-click `打包桌面版.bat`.

Maintainers commit source with `同步到github.bat` and cut a release with `发布三平台版本.bat`, which pushes the version tag and lets GitHub Actions build and publish the packages. The release flow and the Android build are in [Building](docs/BUILD.md).

## Permissions and data

Tool permissions are set per conversation, and file tools only reach the working directories you name. Command-line and browser tools act on your computer or on websites, so check the task and the target before you authorize them.

On desktop, API keys go into the operating system's encrypted storage where it is available. Configuration, conversations, and task material stay on your machine; when you call a model or a tool, the relevant content goes to the service you configured. Key storage, remote connections, and permission limits are in [Security](SECURITY.md).

## Development and feedback

The desktop app runs on Electron 34 with a React 19, Vite, and TypeScript interface; the Android client uses Capacitor 7. See [Architecture](docs/ARCHITECTURE.md) and [Contributing](CONTRIBUTING.md).

Published versions are listed under [Releases](https://github.com/lifishard/wickrunAI/releases). Android on a physical device and the reasoning-parameter mapping for some providers still need verification. Image attachments need a model that accepts image input.

For a problem, open an [issue](https://github.com/lifishard/wickrunAI/issues) with the app version, your system, the endpoint, the model ID, and the steps to reproduce. Remove API keys and private content before attaching logs or a request preview.

## License

[Apache License 2.0](LICENSE). Keep the [NOTICE](NOTICE) file when you redistribute.
