# Launch kit

Finished copy for every external channel, ready to paste. Nothing here is a suggestion to write something — it is the thing, written.

Read [Release playbook](release-playbook.md) first. Several items below have a published 2.9.0 Release page as a hard prerequisite, and one has the demo GIF as a hard prerequisite.

Two standing rules that override anything below:

- **Do not post the same thing to two communities on the same day.** Cross-posting is visible and it reads as a campaign. Space them out, and let the earlier one's comments change the later one.
- **Answer every comment yourself, within a few hours.** On Hacker News and on both subreddits, an unanswered thread is a dead thread, and a post-and-run is remembered.

---

## Prerequisite gate

Work down this list. Nothing in the channels section ships until its row is green.

| # | Prerequisite | Needed by | Why |
|---|---|---|---|
| 1 | 2.9.0 tagged, built, eighteen assets attached | everything | Every post links to Releases. A 404 or an empty page ends the visit. |
| 2 | 2.9.0 Release body written (from the playbook) | everything | See above. |
| 3 | README version badge says `2.9.0` | everything | It currently says 2.8.0. First thing a careful reader checks; a stale badge reads as an unmaintained project. |
| 4 | `docs/failover.gif` recorded and committed, README comment replaced with the image | Show HN, Product Hunt, both subreddits | The single claim that distinguishes this project is a thing that happens over fifteen seconds. Described in prose it is a feature list; shown, it is the reason to download. |
| 5 | Repository description, homepage and topics fixed | everything | See [seo-checklist.md](seo-checklist.md). The description currently advertises an unrelated project; the homepage points at an unrelated site. Both are visible in the first second of a visit from any of these channels. |
| 6 | A window of about six free hours | Show HN, Reddit | To answer comments. If you cannot sit with it, do not post it. |

---

## 1. Demo GIF: recording script

**Timing:** before everything else. Item 4 in the gate above.
**Prerequisite:** two credentials configured, one of which is genuinely out of credit; or a reproducible way to force the error.

### Output spec

- **Length:** 15 seconds hard ceiling. 13 is better. Above 15 the loop restarts before a reader finishes the first pass, and GitHub's viewport makes long GIFs feel broken.
- **Dimensions:** 1280×720 captured, exported at 960×540. GitHub renders README images at roughly 880px wide on desktop, so 960 gives a little margin without blurring on a HiDPI screen.
- **Frame rate:** 12 fps. Text-heavy UI GIFs gain nothing above that and the file size doubles.
- **File size:** under 5 MB. Above that GitHub is slow to load it and mobile users see nothing for several seconds. If the export is over, cut frame rate to 10 before cutting dimensions.
- **Colors:** generate a palette from the actual frames rather than using the default 256-color web palette — the interface uses flat panels, and default quantization bands them visibly.
- **No cursor trails, no click ripples, no zoom effects.** Nothing that reads as a produced video. The point is that this is a screen recording of a real thing.

### Tools

- **Windows:** ScreenToGif. Record region, trim on the built-in timeline, Export → GIF with "Octree" quantizer at 12 fps. It does the whole job in one application.
- **macOS:** Kap, export as GIF at 12 fps. Or record with QuickTime and convert: `ffmpeg -i in.mov -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -loop 0 docs/failover.gif`
- **Linux:** Peek, or the same ffmpeg line over a `wf-recorder` / `ffmpeg -f x11grab` capture.

### Shot list

Window sized so the composer, the route chip and the run journal are all visible without scrolling. Interface language: English, so the GIF works in both READMEs. Hide or blur the credential names if they carry anything identifying.

| # | Seconds | On screen | Notes |
|---|---|---|---|
| 1 | 0.0 – 2.0 | A task already running. Route chip reads **OpenRouter**. Text is streaming into the answer. | Start mid-stream, not at the composer. The first frame must show work in progress, because that is what the whole claim is about. No title card. |
| 2 | 2.0 – 4.0 | The error appears: out of credit on OpenRouter. | Hold long enough to read the error text. This is the only unpleasant frame and it has to be legible, or the rest looks like a feature demo instead of a recovery. |
| 3 | 4.0 – 6.5 | The handover notice: route chip changes to **SenseNova / glm-5.2**, with the reason line visible. | The reason line is the part people screenshot. Make sure it is not clipped. |
| 4 | 6.5 – 8.5 | Second failure: glm-5.2 short on quota. | Shorter hold than shot 2 — by now the viewer knows what an error looks like, and the surprise is that it happens *again*. |
| 5 | 8.5 – 11.0 | Second handover: route chip becomes **kimi-k3**. Text starts streaming again, continuing the same answer. | The single most important frame in the recording is the one where new text appends to old text under a different route name. If only one moment is legible, make it this one. |
| 6 | 11.0 – 14.0 | The task completes. Run journal visible showing three route entries and two handovers. | End on the journal, not on the answer. The answer is ordinary; the journal is the evidence. |
| 7 | 14.0 – 15.0 | Hold the final frame. | A beat before the loop, so the loop does not feel like a stutter. |

**Do not add captions, arrows or annotations.** The route chip and the handover notice already say it, and overlay text is the thing that makes a recording read as marketing.

**Check before committing:** open the GIF at 880px wide and read every route name and the handover reason without leaning in. If you cannot, the window was too large when you recorded. Re-record smaller rather than scaling up.

Commit as `docs/failover.gif`, then replace the `<!-- TODO: failover.gif -->` comment and the demo-slot blockquote in `README.md` with `![Failover in progress](docs/failover.gif)`. Do the same in `README.zh-CN.md`.

---

## 2. Show HN

**Timing:** a weekday, 08:00–11:00 US Eastern. Not Friday, not a US holiday. After the GIF is committed and the 2.9.0 Release is published.
**Prerequisites:** gate items 1–6, all of them. Especially 4 and 6.
**Where:** news.ycombinator.com/submit, title prefixed `Show HN:`, URL pointing at the repository, text in the text field.

### Title

```
Show HN: LLM client that hands a running task to the next key when one fails
```

76 characters. HN's title field caps at 80, so this is the one that fits. It describes the mechanism; it contains no adjective that cannot be checked, and it is not a question.

If you want the longer wording for somewhere without the cap, it is: *Show HN: Desktop LLM client that hands a running task to the next API key when one fails* (88 characters — HN will reject it).

### Body

```
I kept losing long tasks to quota errors. Not the model being wrong — the
model being unavailable, twenty minutes in, on a free tier I'd forgotten was
metered. So I built the client I wanted: you give it an ordered list of
routes (a credential plus a model ID), and when the one you're on stops
working, the task moves to the next one carrying its saved progress instead
of starting over.

The part I spent the most time on is which failures should *not* trigger a
handover. Rate limits, quota exhaustion, auth failures, a route that can't
take the tool calls this task needs, a context window that's too small — all
of those hand off. Three don't: a malformed request, a detected behavioural
loop, and any error nobody could classify. Switching models fixes none of
those, and auto-switching on unclassified errors just burns the whole list
one route at a time while making it look like the program tried everything.
The failover list itself is in your order, not a ranking — the program has no
idea which of your routes is the free one and shouldn't be guessing.

There's a second layer that scores routes from your own finished tasks:
done rate, median time, tokens per success. Three buckets, not two — done,
not done, and unknown — because in my own data only about a quarter of tasks
carry a user verdict, and folding the other three quarters into either side
manufactures a number. Nothing is shown below eight judged samples. It
produces a "reorder by done rate" button you have to click; it never
reorders your list for you.

Where it is now: Apache-2.0, Electron + React desktop for Windows/macOS/Linux,
Capacitor Android client that relays tool calls back to the desktop over the
LAN. Bring your own keys — they go into the OS keystore (DPAPI / Keychain /
libsecret) and there is no server of mine anywhere in the path. The chain in
the GIF is real and ran unattended: OpenRouter out of credit → SenseNova,
glm-5.2 short on quota → kimi-k3 finished the task.

Not verified yet: the Android client on physical hardware, and the
reasoning-effort parameter mapping for several providers. The packages aren't
code-signed, so Windows and macOS will warn about the publisher; there are
SHA256SUMS in each release and it builds from source with Node 20.

The design write-up, with the reasoning for the parts that are deliberately
counter-intuitive, is in docs/architecture-rsi.md.
```

### If it gets traction, the comments you will get and the honest answers

Have these ready; do not improvise them.

- *"How is this different from LiteLLM / OpenRouter's own fallbacks?"* — Those fall back per request. This moves a task that is already running, with its journal and its evidence, and resumes from the saved position. Say that, and say that for single-request fallback a proxy is the better tool.
- *"Electron?"* — Yes. Say why: the browser automation, the OS keystore integration, and the local CLI adapters all needed a real desktop process, and shipping a Tauri rewrite was not a better use of the time than shipping the failover logic. Do not apologise for it.
- *"Why should I trust a client with my keys?"* — Point at `docs/byok-ai-client.md`, at the keystore, and at the fact that it is Apache-2.0 and reads in an afternoon. Do not claim it has been audited.
- *"Chinese-language project?"* — Yes, most of `docs/` is in Chinese, the code comments are in Chinese, and the interface does Simplified, Traditional and English. Say it plainly. Someone will find it in the first two minutes, and the only bad version of that exchange is the one where you sound like you were hiding it.

---

## 3. r/LocalLLaMA

**Timing:** at least four days after Show HN. Weekday, 09:00–12:00 US Eastern.
**Prerequisites:** gate items 1–5. This community will download it, so the Release has to be real.
**Flair:** Resources or Tutorial | Guide, whichever the sub currently has. Not "Discussion".

This sub runs local models. **The most likely failure mode for this post is sounding like an ad for cloud APIs.** Lead with the local-model angle, which is honest: an OpenAI-compatible endpoint is an OpenAI-compatible endpoint, and llama.cpp, Ollama and vLLM all serve one.

### Title

```
Built a desktop client where a running task fails over between endpoints — local server as one entry in the list, cloud as the backup (or the reverse)
```

### Body

```
Sharing something I built for a problem I kept hitting: a long task running
against my local server, and the server goes down, or I OOM it with a
context that got too big, or I'm out on a laptop that can't run the model at
all. The task dies and I start over.

So the client takes an ordered list of routes. A route is a credential plus a
model ID — a llama.cpp or Ollama or vLLM endpoint is just a route with a
localhost base URL. When the route you're on fails, the task moves to the
next one on your list carrying its saved progress and resumes, rather than
restarting. Order is yours: local first and a cloud key as the fallback for
when you're away from the box, or a cloud route first and local as the
free backstop — the program doesn't sort it for you and has no idea which of
your routes costs money.

Relevant to this sub specifically:

- context_too_long is one of the conditions that triggers a handover. If your
  local route has an 8k window and the next route on the list has 128k, a task
  that outgrows the first one moves instead of dying.
- tools_unsupported likewise. A small local model that can't do tool calls
  hands the task to one that can, mid-run.
- Three failure kinds deliberately do NOT hand off: malformed request,
  detected behavioural loop, and unclassified errors. Switching models fixes
  none of them, and auto-switching on "unknown" just walks your whole list
  into the same wall while looking like it tried.
- It scores your routes from your own finished tasks — done rate, median
  active time, tokens per success. Useful for the question this sub actually
  argues about, which is whether the quantized local one is good enough for
  your work: after eight judged tasks you have your own number instead of
  someone else's benchmark. Nothing is shown below that threshold, and
  tasks with no verdict go in a third "unknown" bucket rather than being
  counted as either.

Caveats up front: it's Electron. Keys go in the OS keystore, there's no
server of mine anywhere, Apache-2.0, and the whole failover module is about
90 lines you can read in five minutes (src/lib/failover.ts). The Android
client exists but hasn't been tested on physical hardware. Builds aren't
code-signed.

https://github.com/lifishard/wickrunAI

Happy to answer anything. The bit I'd most like feedback on: whether the
three non-handoff conditions are the right three, or whether there's a fourth
I'm missing.
```

The closing question is not decoration. Ending with a real technical question you actually want answered is the difference between a post this sub reads and a post it downvotes.

---

## 4. r/selfhosted

**Timing:** at least three days after the r/LocalLLaMA post. Weekend mornings do well here.
**Prerequisites:** gate items 1–5.
**Flair:** Release or Software Development, per the sub's current set.

Different audience. This sub does not care about model quality; it cares about **what the thing phones home to, what it stores where, and whether it survives the author losing interest.** Lead with 2.9.0's sync, because a no-server sync design is exactly this sub's subject matter.

### Title

```
Cross-device sync for an AI client with no server: encrypted packages in a folder you already sync (Syncthing, a NAS share, a USB stick)
```

### Body

```
I maintain a desktop AI client and just shipped cross-device sync. The design
choice is the part worth posting here: there is no server, and there won't be
one.

The whole premise of the app is that your API keys stay on your machine.
Adding a sync server would mean standing up exactly the thing the app exists
to avoid — a box of mine holding everybody's conversations. So the drop point
is a folder. Whatever you already sync: a Syncthing share, a NAS mount, a
cloud-drive directory, a tailnet share, a USB stick you carry.

How it works:

- Each device writes exactly one file, <deviceId>.wsync, where deviceId is a
  random UUID with nothing machine-identifying in it. Devices never write to
  each other's files, so there are no write conflicts in the folder at all.
  Merging happens after reading, on each machine.
- Packages are sealed before they're written: scrypt (N=2^15) over a
  passphrase of 12+ characters, then AES-256-GCM, fresh salt and nonce per
  package, with format version/salt/nonce bound in as AAD so a tampered
  header fails authentication rather than steering an older parse path. The
  folder holds nothing but ciphertext, so "is this folder trustworthy" is a
  question you don't have to answer. The passphrase is entered per sync and
  never stored. There's no recovery path and there won't be one.
- Merging is deterministic and order-independent: later timestamp wins, exact
  ties broken by canonical serialization order — not because that's the
  "right" version, but so both machines pick the same one and your library
  stops flip-flopping. Merges are per record, so a skewed clock on one box
  can at worst pick the wrong version of one record, never overwrite the
  library. Deletions leave tombstones with a 90-day TTL.

What does NOT sync, and why, since that's the part I'd want to know:

- API keys. Not a setting, not a toggle. They're sealed by the OS keystore
  with key material bound to that machine's identity (DPAPI / Keychain /
  libsecret), so the ciphertext wouldn't open elsewhere anyway; syncing them
  would mean decrypting to plaintext first, which torches the entire premise.
  Second machine: enter its own key, or relay tool calls back to the first
  machine over the LAN bridge.
- Event hooks. A hook is a shell command that runs automatically after a
  tool call succeeds. If hooks synced, anyone who can write to your drop
  folder gets code execution on your desktop. That's a straight escalation
  from "can write a file" to "can run a command" and it's not worth the
  convenience of not retyping three hooks.
- Machine-local things by name: remote bridge address and token, working
  directories, Chrome port, CLI paths, window position. On merge, local
  values always win over whatever arrives in a package.

Same release also tightened the LAN bridge (the phone client relays tool
calls to the desktop). It now allowlists by source address — loopback,
RFC1918, CGNAT/100.64.0.0/10 which is where Tailscale hands out addresses,
and link-local. A connection from a public address gets the socket destroyed
with no response at all, not a 401. It still binds 0.0.0.0, because
Tailscale and WireGuard interfaces have to be able to reach it and their
addresses move around. If you want it working away from home the answer is
Tailscale, not a port forward, and the settings screen now says so with the
tailnet address labelled.

Apache-2.0, Electron, Windows/macOS/Linux, builds from source on Node 20.
Not code-signed. Android client exists, untested on physical hardware.

https://github.com/lifishard/wickrunAI
```

---

## 5. awesome-list PRs

**Timing:** after Show HN, regardless of how it went. These are slow-burn and independent of any launch.
**Prerequisites:** gate items 1, 2, 3, 5. Several of these lists check the repository description and topics as part of review, which is why item 5 is on this row.

**Ground rules.** One PR per list. Read that list's `CONTRIBUTING.md` before opening it — most of them have a required entry format and several auto-close PRs that ignore it. Alphabetical position matters in most of them; put the entry where it belongs, do not append to the end. And do not open all seven in one afternoon: maintainers of these lists talk to each other, and a burst reads as a campaign.

| List | Section to add under | Status |
|---|---|---|
| `sindresorhus/awesome` → not directly; go via the topic lists below | — | Do not PR the root list. It only accepts lists, not projects. |
| `steven2358/awesome-generative-ai` | "Chat" or "Desktop apps", whichever the current README uses | Highest value, highest traffic |
| `f/awesome-chatgpt-prompts`-adjacent clients lists — specifically `reorx/awesome-chatgpt-api` | "Desktop clients" / "Apps" | Good fit: the list is explicitly about bring-your-own-key clients |
| `Hannibal046/Awesome-LLM` | "LLM Applications" / "Tools" | Academic-leaning; the design doc helps here |
| `awesome-selfhosted/awesome-selfhosted` | "Automation" or "Personal Dashboards" — check current taxonomy | Strict: requires a license, a demo or screenshots, and active maintenance. The GIF satisfies the screenshot requirement. Read their guidelines in full; they reject for formatting. |
| `punkpeye/awesome-mcp-servers` and similar MCP lists | Only if/when MCP support is a documented feature | **Do not submit until this is true.** Listing under a capability the project does not document is how a project gets removed from every list at once. |
| `jamesmurdza/awesome-ai-devtools` | "Desktop IDE / clients" | Moderate traffic, easy review |
| `ai-collection/ai-collection` | Under the closest category | Large and loosely curated; low effort |

### The entry, in awesome-list house format

Most lists want: `- [Name](url) - Description.` — sentence case, one line, a real full stop, no marketing adjectives, no trailing whitespace.

**Standard (under ~120 characters, safe everywhere):**

```markdown
- [wickrunAI](https://github.com/lifishard/wickrunAI) - Desktop LLM client that hands a running task to the next API key when one fails.
```

**Where the list allows a longer line:**

```markdown
- [wickrunAI](https://github.com/lifishard/wickrunAI) - Bring-your-own-key desktop client for Windows, macOS and Linux that hands a running task to the next route when one fails, and ranks routes by your own completion rate.
```

**For awesome-selfhosted specifically**, which requires a language/license suffix:

```markdown
- [wickrunAI](https://github.com/lifishard/wickrunAI) - Desktop LLM client that hands a running task to the next API key when one fails, with no-server encrypted sync between your own devices. `Apache-2.0` `TypeScript`
```

Check the exact suffix convention in their README at the time you submit; they have changed it before.

### PR description, for any of them

```
Adds wickrunAI under <section>.

It's an Apache-2.0 desktop client (Electron, Windows/macOS/Linux) for
OpenAI-compatible endpoints. What makes it distinct from the other clients
already listed is mid-task failover: when a route stops working the running
task moves to the next route on a user-ordered list carrying its saved
progress, rather than the request-level retry that most clients do.

Active: current release is 2.9.0. Documentation is at docs/README.md, and
the design write-up is at docs/architecture-rsi.md.

I'm the author. Entry placed alphabetically; format matches the
surrounding lines. Happy to adjust the wording or the section.
```

Disclosing authorship is not optional. Several of these lists reject undisclosed self-submissions on sight, and all of them can tell.

---

## 6. V2EX · 分享创造

**发布时机：** Show HN 之后，中文渠道先发这里。工作日 10:00–12:00 或 20:00–22:00（北京时间）。
**前置条件：** 闸门第 1–5 项。中文 README 里的 GIF 也要换上。
**节点：** 分享创造（`/go/create`）。不要发 `/go/programmer`，那里会被认为是引流。

V2EX 的读者对「我做了个 XX」这句开头已经免疫了，但对「我遇到了一个具体问题，然后……」有耐心。别放 logo，别放三个 emoji 小标题，别在正文里说「欢迎 star」。

### 标题

```
做了个桌面 AI 客户端：一条路由挂了，正在跑的任务接着交给下一条，不从头再来
```

### 正文

```
起因是一个很蠢的场景：一个长任务跑了二十分钟，撞上 OpenRouter 的额度用尽，
整件事作废，重来。不是模型答错了，是模型不可用了 —— 这两件事的解法不该一样。

所以做了这个东西。你自己排一份路由名单（一条路由 = 一份凭据 + 一个模型 ID），
当前这条失灵的时候，任务带着已经保存的进度交接给下一条，从断点接着跑。

花时间最多的地方不是「怎么交接」，是「什么时候不该交接」：

- 会交接的：限流、额度用尽、鉴权失败、这条路由不支持本次要用的工具调用、
  上下文窗口装不下、网络反复不通。
- 刻意不交接的三类：请求本身写错了（bad_param）、检测到行为死循环
  （loop_detected）、以及说不清原因的（unknown）。换个模型这三样一个都治不好。
  对说不清的错误自动换人，只会把整张名单挨个烧一遍，还让人以为已经尽力了。

名单的顺序是你排的，程序不替你排。它压根不知道你哪条路由是免费的、哪条是
按 token 计费的 —— 这个信息只有你有，那这个决定就该归你。

另外有一层会拿你自己跑完的任务给路由记分：做成率、端到端耗时中位数、
每做成一次花多少 token。三个桶而不是两个 —— 做成、没做成、不知道。
因为现场数据里只有大约四分之一的任务有明确的人工反馈，把剩下四分之三
硬塞进任何一边都是在编数字。样本不到八条就不给数字，只显示「还在攒」。
算出来的结果是一个「按做成率重排」的按钮，你点它才排 —— 而且样本不足的
路由保持原位，不会被挤到后面去，因为「没被用过」不等于「不好」。

2.9.0 刚加了跨设备同步：没有服务器，落点是一个你自己指的文件夹（网盘目录、
Syncthing 共享目录、NAS、U 盘都行），同步包 scrypt + AES-256-GCM 封好再落地，
落点上躺的永远是密文。API 密钥一次也不同步，事件钩子也不同步 —— 钩子是一条
会自动执行的命令行，同步它等于让任何能往那个文件夹写东西的人在你桌面上
执行命令。

Apache-2.0，Electron + React，Windows / macOS / Linux。密钥进系统密钥库
（DPAPI / Keychain / libsecret），全程没有我这边的任何服务器。安装包没有
代码签名，系统会提示发布者不明，介意的话可以自己从源码构建（Node 20）。
Android 端有，但还没在真机上验证过。

https://github.com/lifishard/wickrunAI

设计取舍写在 docs/architecture-rsi.zh-CN.md，包括几个反直觉的地方
（为什么是推荐而不是自动替换、为什么「不知道」要单独一个桶、
为什么一次删除会输给一次更晚的编辑）。
```

---

## 7. 少数派

**发布时机：** V2EX 之后至少五天。少数派的读者和 V2EX 重合度不低，隔开发。
**前置条件：** 闸门第 1–5 项，加上中文 README 的 GIF。
**栏目：** 「效率工具」或「派评」，按当期征稿方向投。

少数派要的是**使用场景和体验**，不是特性清单。上面几份稿子的技术密度在这里是负分。写成一篇「我为什么需要这个 / 它怎么改变了我的流程」的文章，技术细节压到最后一节。

### 标题

```
一个长任务跑到一半，模型没额度了 —— 我做了个会自己换人的 AI 客户端
```

### 正文

```
## 那二十分钟

事情是这样的。我让模型整理一批资料，任务跑了大概二十分钟，已经读完了七八个
文件，正在往下写。然后它停了 —— 不是答错，是 OpenRouter 那边免费额度用完了。

我手上其实还有两个别家的 key。但没用，因为这一整件事的上下文都在刚才那条
连接里：读过哪些文件、用户提的要求是什么、写到哪一段了。换一个客户端窗口
重新开始，等于让另一个模型从零把这二十分钟再走一遍。

一次两次可以忍。变成每周都遇到的时候，我开始觉得这不该是我的问题。

## 于是做了 wickrunAI

它的核心就一件事：**你排一份路由名单，当前这条失灵的时候，正在跑的任务带着
已保存的进度交给下一条，从断点继续，而不是从头再来。**

一条「路由」是一份凭据加一个模型 ID。同一个模型挂在两份 key 下面算两条路由 ——
因为额度是按 key 算的，不是按模型算的。

实际用起来是这样：在设置里把你手上的几条路由拖成一个顺序，免费的排前面还是
稳的排前面随你。然后就不用管了。任务撞墙的时候界面上会出现一条交接提示，
写着为什么换、换给了谁，然后文字继续往下流，接着上一句写。

这段是真的发生过的，也是 README 里那张动图录的东西：一个任务在 OpenRouter
上撞到额度用尽，交给 SenseNova，那边的 glm-5.2 额度也不够，再交一次，
kimi-k3 接手把它做完了。三条路由，两次交接，一个任务，全程没人看着。

## 它不会替你做的事

做这个东西的过程里，我删掉的功能比加上的多，说两个。

**第一，它不替你决定用哪条路由。** 程序不知道你哪条是免费的、哪条按 token 收费、
哪条是公司报销的。这个信息只有你有。所以名单的顺序永远是你排的，界面上有一个
「按历史做成率重排」的按钮，但你得自己点，而且点完样本不够的那几条会留在原位 ——
「没被用过」和「不好用」是两件事，把没数据的一律挤到后面，等于替它们编了个结论。

**第二，不是所有失败都值得换人。** 请求参数写错了、模型陷进了行为死循环、
以及压根说不清原因的错误 —— 这三类不触发交接。换个模型一个都治不好，
而对说不清的错误自动换人，只会把你整张名单挨个烧一遍，最后还让你以为
「它已经尽力了」。

## 记分这件事

用了一段时间之后，它开始能回答一个我一直想知道的问题：**我这几条路由，到底
哪条真的能把事做完？**

它会统计你自己跑完的任务：做成率、端到端耗时的中位数、每做成一次花掉多少
token。注意是三个桶不是两个 —— 做成、没做成、**不知道**。因为大部分任务
跑完之后我并不会专门去点一下「这个结果可用」，实际数据里只有四分之一左右
有明确反馈。把剩下那四分之三算进成功或者失败任何一边，得到的都是假数字。
所以它们单独一个桶，单独报出来。

样本不到八条就不出数字，只说「还在攒」。拿三次调用报一个做成率，是这类
东西最容易翻的车。

## 2.9.0：换台电脑，记录跟着走

最近这版加了跨设备同步。会话、项目、技能、定时任务、任务记录和上面那套
路由统计，都能在你自己的几台机器之间流动。

**没有服务器。** 落点是一个你自己指的文件夹 —— 网盘的同步目录、Syncthing
的共享文件夹、NAS、甚至一个 U 盘。因为这个应用的前提就是「你的密钥不离开
你的机器」，我再自己建一个收全部对话的服务器，等于把刚拒绝掉的那份信任
又请回来。

同步包出门前用 scrypt 派生口令再 AES-256-GCM 封上，落点上躺的永远是密文，
所以那个文件夹本身安不安全这个问题不需要回答。口令每次现输，不保存，
两台机器得用同一串，忘了只能重配一次。

**API 密钥一次也不同步。** 这不是一个开关，是设计。密钥由操作系统的加密存储
保管，密钥材料绑定这台机器的系统身份，密文搬过去本来也解不开；硬要同步就得
先解密成明文，那正好把整套东西的前提推翻。第二台设备要么自己填一个 key，
要么用遥控功能把工具调用转发回第一台执行。

**事件钩子也不同步。** 钩子是一条在工具执行成功之后自动跑的命令行。如果它
跟着同步走，那么任何能往你那个文件夹里写东西的人，都能让一条命令在你的桌面上
跑起来。换设备手动重配几条，比这个风险划算得多。

## 现在能用到什么程度

Windows / macOS / Linux 桌面端，Electron + React，Apache-2.0。密钥进系统
密钥库（Windows DPAPI / macOS 钥匙串 / Linux libsecret）。任何 OpenAI 兼容的
接口都能接，也能直接调用你机器上已经登录的 Codex、Claude Code、Kimi Code。
界面有简体、繁體和 English。

要说清楚的几件事：安装包没有代码签名，Windows 和 macOS 会提示发布者不明，
介意的话可以用 Release 里的 SHA256SUMS 校验，或者自己从源码构建（Node 20）。
Android 端做出来了，但还没在真机上验证过。部分供应商的思考强度参数映射
也还没验完。文档大部分是中文的，其中几篇概念页是英文。

下载和源码：https://github.com/lifishard/wickrunAI
```

---

## 8. Product Hunt

**发布时机：** 最后一个。Show HN 和两个 subreddit 都跑完、评论都回完之后。周二到周四，太平洋时间 00:01 上线。
**前置条件：** 闸门全部六项。Product Hunt 的落地页效果高度依赖第一屏那张图，也就是 GIF。

Product Hunt 的读者不看代码。这里的文案可以比别处外向一点，但仍然不要用 "revolutionary" 这种词 —— 这个产品的可信度全部来自它听起来像个诚实的工程项目。

### Tagline（60 字符以内）

首选，48 字符：

```
When one AI model fails, the next one takes over
```

备选，58 字符：

```
Your AI task keeps running when a model runs out of credit
```

备选，45 字符：

```
Every AI key you own, with automatic failover
```

三个都不含形容词，都在讲机制。

### Description

```
wickrunAI is an open-source desktop client that runs every AI model you
have access to — open or closed, paid or free — from one window.

The thing it does that other bring-your-own-key clients don't: when the
model you're using stops working mid-task, your task doesn't. It moves to
the next route on a list you ordered yourself, carrying its saved progress,
and picks up where it left off. Out of credit, rate limited, context window
too small, tool calls unsupported — all of it hands over. You watch the
route name change and the text keep going.

It also learns which of your routes actually finish work. Done rate, median
time, tokens per success, computed from your own completed tasks — not a
benchmark someone else ran. After eight judged tasks you get a number, and
a button to reorder your list by it. A button you press; it never reorders
for you, because it has no idea which of your keys is the free one.

Your keys go into your operating system's keystore and never leave your
machine. There is no server in the path. Version 2.9.0 syncs your
conversations, projects and skills between your own devices through an
encrypted package in a folder you already have — still no server, and API
keys are excluded permanently by design.

Windows, macOS, Linux. Apache-2.0. Android client relays tool calls back to
your desktop over the LAN.
```

### 第一条评论（作为 maker 自己发，上线后立刻）

```
Maker here. I built this because I lost a twenty-minute task to a quota
error on a free tier I'd forgotten was metered — and I had two other keys
sitting right there, useless, because all the context was in the connection
that had just died.

The part I'd point you at if you only look at one thing: three kinds of
failure deliberately do NOT trigger a handover — a malformed request, a
detected behavioural loop, and any error that couldn't be classified.
Switching models fixes none of them, and auto-switching on unknown errors
just burns your whole list one route at a time while looking like it tried
everything.

Fully open source, Apache-2.0, builds from source. The packages aren't
code-signed yet, so Windows and macOS will warn about the publisher —
there are SHA256SUMS in every release. The Android client exists but
hasn't been tested on physical hardware; I'd rather say that here than
have you find out.

Happy to answer anything.
```

---

## Timing summary

| Day | Channel | Blocked on |
|---|---|---|
| −7 to −1 | Record GIF, fix README badge, publish 2.9.0 Release, fix repository metadata | — |
| 0 | Show HN | Everything above. Six free hours. |
| +4 | r/LocalLLaMA | Show HN comments answered |
| +7 | r/selfhosted | — |
| +7 onward | awesome-list PRs, one every few days | Repository metadata fixed |
| +10 | V2EX 分享创造 | 中文 README 的 GIF |
| +15 | 少数派 | V2EX 的反馈可以用来改稿 |
| +20 | Product Hunt | 前面全部跑完 |

If the GIF is not recorded, none of this ships. It is the one asset every other item depends on, and it is the only one that cannot be written.
