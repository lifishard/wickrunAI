<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.svg"><img src="public/brand/logo.svg" width="96" alt="wickrunAI"></picture>

# wickrunAI · 灯芯AI

**Every AI model you own, in one app — and when one fails, the next one takes over mid-task.**

Open or closed, paid or free. Bring your own keys; they never leave your machine.

[![Version](https://img.shields.io/badge/version-2.17.12-1f6feb)](https://github.com/lifishard/wickrunAI/releases)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android-lightgrey)](#install)
[![CI](https://github.com/lifishard/wickrunAI/actions/workflows/ci.yml/badge.svg)](https://github.com/lifishard/wickrunAI/actions/workflows/ci.yml)

[Download](https://github.com/lifishard/wickrunAI/releases) · [Docs](docs/README.md) · [Configuration](docs/CONFIGURATION.md) · [Building](docs/BUILD.md) · [Security](SECURITY.md)

**English** · [简体中文](README.zh-CN.md)

</div>

---

**When a route dies mid-task, the task does not.** This is the notice you get, verbatim, and the run continues from where it stopped:

```
This account is out of quota. Handed to glm-5.2 from your failover order;
the saved progress carries over.

This account is out of quota. Handed to kimi-k3 from your failover order;
the saved progress carries over.
```

Three routes, two handovers, one task, nobody watching. The order is a list **you** wrote — the program walks it, it does not decide for you which of your routes is the cheap one. [How it decides](docs/llm-failover.md).

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

The interface reads in Simplified Chinese, Traditional Chinese, and English, switchable from the top right. Most reference documents under `docs/` are in Chinese; the concept pages linked above are in English.

## 2.10 Exporting a conversation

Any conversation can be saved to a file, from the **Export** button in the header or the ⤓ icon on a sidebar row. Two formats: Markdown to read, paste into notes or send to someone, and JSON for the complete record. Tool steps and the model's reasoning are off by default and each has its own switch — most of the time what you want is the conversation itself.

What does not go into the file: **API keys, never.** The credential id the conversation used is stripped too — it means nothing on another machine and only reveals how many routes you have configured. Attachments keep their name, type and size; the text and image data stay behind, because a conversation with a few images would otherwise export as tens of megabytes.

After saving, the dialog shows the **full path** with buttons to open the containing folder or the file itself, and stays open until you close it. A toast would have shown the path for four seconds and then taken away the one thing you needed next.

## 2.9 Cross-device sync and a private-network relay

Conversations, projects, skills, scheduled tasks, task records and route scores now travel between your devices through a folder you choose: a Syncthing share, a cloud-synced directory, a drive on your LAN or Tailscale, even a USB stick. Every bundle is sealed with scrypt and AES-256-GCM under a passphrase you type each time and that is never stored, so the folder itself does not have to be trusted. Merging is per record and deterministic — syncing A into B and B into A give the same result, and syncing the same bundle twice changes nothing.

**API keys never sync. Not once.** They are locked to one machine by the operating system's keystore and would not decrypt elsewhere anyway. To use the same route on another device, enter a key there, or route the call through the relay. Hooks do not sync either, because a hook is a command line that runs automatically, and syncing one would let anyone who can write to that folder deliver executable content to your desktop.

The phone relay now judges where a connection came from, not only whether it carries the right token. Private ranges, CGNAT — which is where Tailscale addresses live — link-local and loopback get through; anything from the public internet is dropped without a reply, so a port scan cannot tell the difference between this and a closed port. Put both devices on the same Tailscale network and the address keeps working on any Wi-Fi, with nothing exposed to the internet. The remote settings page now labels each address by kind and puts the one that survives a network change first.

## 2.8 A regression set built from your own failures

A task recorded as not done can be saved as a regression case in one click, keeping the original wording rather than a rewritten version. Development and hold-out splits are scored separately and never mixed, and a hold-out case used three times prompts you to rotate it — a case you have already tuned against is development data.

A candidate configuration is adopted only when it gains **and** nothing regresses. Fixing two things while breaking one is not progress: the broken one was something that already worked. Verdicts come from program checks, never from a model grading its own output, because a regression set scored by the model under test measures nothing.

## 2.6–2.7 Route scores computed from your own finished tasks

Ninety days of task records are aggregated into the three yardsticks that matter — completion rate, median end-to-end time, tokens per success — plus a false-completion rate that measures how often a run claimed to be done while a required check had not passed. The statistical unit is the route, not the model name: a gateway alias like `auto/best-coding` can change what actually runs behind it, so a score attached to a model name is a score attached to something that moves.

Done, not done and **unclear** are three outcomes, not two. Unclear is excluded from the denominator rather than quietly counted as a failure. Below eight samples a route is not ranked at all, and below twenty no cost figure is shown.

The failover list shows each candidate's history next to it, with a **Reorder by history** button you have to click — a recommendation, not a replacement. The order stays yours, and routes without enough samples keep their position instead of being pushed down by an absence of data. Skills now record whether the tasks that used them finished, so *used often* no longer passes for *useful*. See [Multi-model router](docs/multi-model-router.md).

## 2.5 Event-driven guardrails and folded skills

Checks you would otherwise write down and hope the model remembers now run as programs. After a tool changes something, a command you configured runs, and its output is put in front of the model only when it fails — reporting every success just teaches the model to skip past the report. Hooks are read from the app's settings only, never from a working directory, so a repository you cloned cannot run commands on your machine.

A skill longer than 4000 characters is folded in the system prompt down to its name, description and opening excerpt, with the body fetched on demand. Deliberately *not* down to a bare code name: with only a name the model cannot judge whether it needs the skill, so it would fetch all of them, which costs more than leaving them inlined. After a compaction, the files this run is writing are read back at the tail of the context, so the cached prefix is left untouched.

## 2.4 Operation identity and automatic hand-off

When a route fails, the run moves to the next entry on a list **you** wrote instead of retrying the same model. The list is empty by default, and an empty list behaves exactly like earlier versions. Errors nobody can explain — a malformed parameter, a detected loop, an unidentified cause — deliberately do not trigger a hand-off, because switching models on those burns the whole list while looking like an attempt was made. The list is inherited across three scopes: this conversation, then the project, then the app, so a global preference can still be turned off for one task.

Hand-off needs an operation identity first, or automatic switching becomes automatic duplicate side effects. The ledger used to key operations by position — run, round, index, and the call id the model generated — every one of which changes when another model takes over, so "has this been done already?" always answered no. Each side-effecting call now also carries a key derived from its content, which points at the same ledger entry across models, rounds and restarts. See [LLM failover](docs/llm-failover.md), and [the architecture write-up](docs/architecture-rsi.md) for how these pieces fit together.

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

wickrunAI is an independent service and is not affiliated with, endorsed by, or owned by the authors of that list or any API provider named in it. Listing a provider is not a recommendation. Free tiers and their terms are set by each provider and can change at any time.

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

## Disclaimer

wickrunAI is an independent service and is not affiliated with, endorsed by, or owned by Anthropic, OpenAI, Google, xAI, SenseTime, Moonshot AI, OpenRouter, or any other model provider or service named in this repository. Product names, logos and trademarks are the property of their respective owners and are used here only to describe what this client can connect to.

Connecting to a provider requires your own account and credentials with that provider, and your use of their service is governed by their terms, not by this project's. Accounts, subscriptions, quotas and charges stay with the provider. This project neither resells nor proxies access to any of them.

## License

[Apache License 2.0](LICENSE). Keep the [NOTICE](NOTICE) file when you redistribute.
