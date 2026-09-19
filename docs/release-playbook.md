# Release playbook

How a wickrunAI version gets published, what its Release page has to say, and which past versions still need one.

This is a maintainer document. Nothing here changes code. It changes what a person sees when they land on a version's URL, and what lands in a watcher's inbox.

Related: [Building](BUILD.md) for the build and tag mechanics, [Repository metadata checklist](seo-checklist.md) for the repository's own metadata, [Launch kit](launch-kit.md) for the external channels a release feeds.

---

## Why a Release page is worth writing

The packages are published either way — `发布三平台版本.bat` pushes the tag and GitHub Actions builds and attaches eighteen files. So the Release page exists regardless. The question is only whether it says anything.

Two reasons it should.

**Each Release is a separately indexable URL.** `github.com/lifishard/wickrunAI/releases/tag/v2.9.0` is its own page with its own title and its own body. A repository's README is one page competing for one set of queries; fourteen Release pages are fourteen more, each one able to match a different specific phrase — "electron client source ip allowlist", "encrypted cross-device sync for chat history", "route failover quota exhausted". A body that reads `**Full Changelog**: …compare/v2.5.1...v2.8.0` matches none of them. That line is what seven of the current Release pages contain in full.

**Every published Release is pushed to watchers.** GitHub emails and in-app-notifies everyone watching the repository for releases. That is the only channel in this project that reaches people who already decided they were interested, and it fires whether or not the body is worth reading. Publishing an empty one spends the notification and returns nothing.

A third, smaller one: the Release body is what a packager, a mirror, or an LLM summarising the project quotes. A compare link cannot be quoted.

---

## The template

Copy this for every version. Keep the section order; drop a section only when it is genuinely empty, and never drop **Upgrade notes** when there is anything at all to say.

```markdown
# wickrunAI x.y.z — <three to six words naming the theme>

<Two or three sentences. What changed and why it matters to someone
already running the previous version. No adjectives that cannot be
checked. If one change dominates, say so here and let the rest be a list.>

## Added
- <Change.> <One clause on the consequence for the user, not the diff.>

## Fixed
- <Symptom as the user saw it.> <What it was.>

## Breaking changes
- <What stops working, and the exact action needed.>
  <If there are none, write: None.>

## Upgrade notes
- Quit the running version before installing. There is no auto-update.
- <Anything version-specific: a setting that must be re-entered, a
  migration that runs once, a file that moves.>
- Data directory is still `anyai`, deliberately, for compatibility with
  installs that started under the AnyAI name.

## Verification
<What was actually tested, and on what. State what was *not* verified —
the Android client on physical hardware, for example. A release note
that omits this reads as a claim that everything was checked.>

## Downloads
| Platform | File |
|---|---|
| Windows 64-bit | `wickrunAI-x.y.z-win-x64-setup.exe`, or `-portable.exe` |
| macOS Apple Silicon | `wickrunAI-x.y.z-mac-arm64.dmg` |
| macOS Intel | `wickrunAI-x.y.z-mac-x64.dmg` |
| Linux 64-bit | `wickrunAI-x.y.z-linux-x64.AppImage` or `.deb` |

Packages are not code-signed; Windows and macOS will warn about the
publisher. Verify against `SHA256SUMS.txt` in this Release, or build
from source.

**Full Changelog**: https://github.com/lifishard/wickrunAI/compare/vA.B.C...vx.y.z
```

### Rules for filling it in

- **Title names the theme, not the number.** "2.9.0" tells a reader nothing; "source-address allowlist and cross-device sync" tells them whether to read on. The number is already in the tag.
- **Each bullet states the consequence.** "Refactored the sync merge" is a diff. "Two devices that sync in either order end up with the same library" is a consequence.
- **Breaking changes never get folded into Added.** If a section has to be scanned for hazards, it has to be the section named after them.
- **Say what was not verified.** This repository already does this in its README, and the Release notes should not be the place where that habit lapses.
- **The compare link stays at the bottom.** It is useful. It is not a release note.

---

## Backfill list

Checked on 2026-09-18 against `git tag --list` and the GitHub Releases API.

### A. Tags with no Release page at all

These tags exist in the repository. Opening `…/releases/tag/<tag>` shows the bare tag, with no notes and no packages.

| Tag | Notes already written | What to do |
|---|---|---|
| `v1.0.0` | — | Lowest priority. It predates the wickrunAI name; a two-line Release saying "first public tag, published as SenseNova Chat" is enough. |
| `v1.3.2` | [`docs/releases/v1.3.2.md`](releases/v1.3.2.md) | Paste the existing notes into a Release. |
| `v1.3.3` | [`docs/releases/v1.3.3.md`](releases/v1.3.3.md) | Paste the existing notes into a Release. |
| `v2.0.0` | [`docs/releases/v2.0.0.md`](releases/v2.0.0.md) | **Highest priority of this group.** The README devotes a whole section to 2.0 (team workspace), and the link it implies leads to an empty page. |
| `v2.0.1` | [`docs/releases/v2.0.1.md`](releases/v2.0.1.md) | Paste the existing notes into a Release. |

For a tag this old, create the Release *without* attaching packages rather than rebuilding them. A Release with notes and no binaries is honest; a Release with binaries rebuilt today from an old tag is a different artefact from what people actually ran.

### B. Release pages whose body is only the auto-generated compare link

These have all eighteen packages attached and a body of exactly one line. They are the ones actually costing something, because they already received the watcher notification.

| Tag | Body today | Source material for a real body |
|---|---|---|
| `v2.1.4` | compare link only | — |
| `v2.3.1` | compare link only | — |
| `v2.3.14` | compare link only | [`docs/releases/v2.3.14.md`](releases/v2.3.14.md) — already written, just not published |
| `v2.4.0` | compare link only | Idempotency keys (`opKeyOf` / `onceOnly` in `electron/tools/index.cjs`) |
| `v2.4.1` | compare link only | — |
| `v2.5.1` | compare link only | Event-hook guardrails (`electron/hooks.cjs`) and skill folding (`src/lib/skills.ts`) |
| `v2.8.0` | compare link only | Route done-rate scoring, backfilling past tasks, per-task regression sets (`src/lib/routing-memory.ts`, `src/lib/evals.ts`) |

Editing a published Release's body does **not** re-notify watchers, so backfilling these is free of the "don't spam people" objection.

### C. Versions that were developed but never cut a tag

`2.5.0`, `2.6.0` and `2.7.0` appear in the feature history but have no tag and no commit of their own — the work shipped inside `2.5.1` and `2.8.0`. **Do not create tags for them retroactively.** A tag that points at a commit which was never that version is worse than a gap. Describe the features under the version that actually shipped them, which is what the table above does.

Same for `2.1.2`, `2.3.10` and `2.1.4`-adjacent commits: `2.1.2` and `2.3.10` have commits but no tag. Leave them.

### D. Notes written but not published, and versions with neither

`docs/releases/` stops at `v2.3.14`. Everything from `2.4.0` onward has no notes file. Either start writing one per version again, or accept that the Release page is now the primary record and stop maintaining the directory. **Pick one** — a directory that covers 1.3.1 through 2.3.14 and then stops looks like the project was abandoned in that range.

Recommended: keep `docs/releases/<tag>.md` as the source of truth, write it first, then paste it into the Release page. That way the notes survive independently of GitHub and the repository carries its own history.

### E. 2.9.0

No tag, no Release, notes below. This is the next thing to publish.

---

## Ready to publish: wickrunAI 2.9.0

Paste the English block into the Release body. Paste the Chinese block after it, under the `---` separator, or save it as `docs/releases/v2.9.0.md` and link to it — pick whichever you do for the rest of the project and stay consistent.

Before publishing, confirm: `package.json`, `src/lib/version.ts` and the README version badge all read `2.9.0`. The README badge currently reads `2.8.0`.

### English

```markdown
# wickrunAI 2.9.0 — source-address allowlist, and your history across devices

Two things in this release. The remote-control service that lets a phone
borrow your desktop's tools now refuses connections from public addresses
outright, instead of relying on a token alone. And a new **Sync** tab
carries conversations, projects, skills, scheduled tasks and accumulated
route statistics between your own machines through an encrypted package in
a folder you choose — with API keys and event hooks excluded permanently,
by design rather than by setting.

## Added

- **Source-address allowlist on the remote bridge.** The service accepts
  connections only from loopback, private ranges (10/8, 172.16/12,
  192.168/16, IPv6 fc00::/7), CGNAT (100.64.0.0/10 — where Tailscale
  hands out tailnet addresses), and link-local (169.254/16, fe80::). A
  connection from a public address is destroyed at the socket, with no
  401 and no response of any kind: a port scanner learns nothing. The
  listener still binds 0.0.0.0, because Tailscale and WireGuard virtual
  interfaces have to be able to reach it and their addresses change.
- **Tailscale addresses shown in Settings, labelled by tier.** The remote
  tab lists every address the service is reachable on and marks which
  bucket each one falls in — private network (CGNAT/tailnet), LAN,
  link-local, this machine. If you want the bridge to work away from
  home, the correct answer is now visible in the interface rather than
  buried in a document: install Tailscale, use the address labelled
  private network, forward no ports.
- **Sync tab: your own devices, your own folder.** Conversations,
  projects, skills, scheduled tasks, task records and route done-rate
  statistics travel between your machines. The drop point is a folder you
  name — a cloud-drive directory, a Syncthing share, a drive on your
  tailnet, a USB stick. There is no server, because adding one would mean
  asking you to trust exactly the thing this application exists to avoid.
- **Sync packages are encrypted end to end.** scrypt (N=2^15) over a
  passphrase of at least twelve characters, then AES-256-GCM, fresh salt
  and nonce per package, with the format version, salt and nonce bound in
  as additional authenticated data so a modified header fails the tag
  instead of steering an old parse path. The passphrase is entered per
  sync and never stored. What lies in the folder is ciphertext, so the
  folder itself does not have to be trustworthy. There is no recovery
  path if the passphrase is lost, and there will not be one — a recovery
  path is the real security level of a system that has one.
- **Merging is deterministic, idempotent and order-independent.** Later
  timestamp wins; on an exact tie, the lexicographically smaller
  canonical serialisation wins — not because that is the right version,
  but so that both machines pick the same one. Merging is per record, so
  a skewed clock on one device can at worst pick the wrong version of a
  single record, never overwrite a library. Counters that feed route
  statistics take the maximum of the two sides rather than the sum,
  because syncing the same data twice would otherwise inflate the
  denominator of every done rate.
- **Deletions propagate, and an edit after a deletion wins.** A deleted
  record leaves a tombstone so it does not come back from the other
  machine. Tombstones expire after 90 days, matching the observation
  retention window. When both machines deleted the same record, the
  *earlier* deletion time is kept, which makes edits more likely to
  survive — losing a deletion is recoverable, losing an edit is not.

## Fixed

- The remote-control service's own header comment claimed it bound to
  internal addresses only, while the code had always bound 0.0.0.0. Behind
  a home router those two descriptions behave identically; on a machine
  with a public IP or on café Wi-Fi they do not. The comment was wrong and
  the behaviour is now what the comment said it was, enforced at the
  connection layer.

## Breaking changes

None. Sync is off until you configure a folder and a passphrase. The
remote bridge behaves identically on every network where it previously
worked; the only connections newly refused are ones from public source
addresses, which were never a supported configuration.

## Upgrade notes

- Quit the running version before installing. There is no auto-update.
- **API keys do not sync, and never will.** Keys are encrypted by the OS
  keystore with key material bound to that machine's identity — Windows
  DPAPI, macOS Keychain, Linux libsecret — so the ciphertext would not
  open elsewhere anyway, and syncing them would mean decrypting to
  plaintext first, which is precisely the premise BYOK exists to hold. On
  a second device, either enter a key there or relay tool calls to the
  first machine over the remote bridge.
- **Event hooks do not sync either.** A hook is a command line that runs
  automatically after a tool succeeds. Syncing hooks would mean anyone
  able to write to your drop folder can get a command running on your
  desktop — an escalation from "can write a file" to "can execute code".
  Re-enter your hooks on each machine; there are usually only a few.
- Device-local settings stay local by name: the remote address and token,
  working directories, Chrome port, CLI binary paths, the currently
  selected route, cached model lists, route health, the authorisation
  ledger, window position. On merge, local values always win over
  whatever a sync package contains.
- Both machines must use the same passphrase. It is not stored anywhere,
  including in your settings.
- The data directory is still named `anyai`, deliberately, so installs
  that began under the AnyAI name keep their configuration.

## Verification

The failover chain was verified end to end with no human intervention: a
task on OpenRouter hit an out-of-credit error, handed off to SenseNova,
where glm-5.2 turned out to be short on quota, handed off again, and
kimi-k3 picked the task up and finished it. Three routes, two handovers,
one task.

Not verified: the Android client on physical hardware, and the
reasoning-parameter mapping for some providers.

## Downloads

| Platform | File |
|---|---|
| Windows 64-bit | `wickrunAI-2.9.0-win-x64-setup.exe`, or `-portable.exe` to run without installing |
| macOS Apple Silicon | `wickrunAI-2.9.0-mac-arm64.dmg` |
| macOS Intel | `wickrunAI-2.9.0-mac-x64.dmg` |
| Linux 64-bit | `wickrunAI-2.9.0-linux-x64.AppImage` or `.deb` |

Packages are not code-signed, so Windows and macOS may warn about the
publisher. Verify a download against `SHA256SUMS.txt` in this Release, or
build from source.

**Full Changelog**: https://github.com/lifishard/wickrunAI/compare/v2.8.0...v2.9.0
```

### 简体中文

```markdown
# wickrunAI 2.9.0 —— 来源网段放行，以及跨设备带走自己的记录

这一版两件事。手机借用桌面工具的遥控服务，现在直接拒绝来自公网地址的连接，
不再只靠一个令牌把关；新增的「同步」页签，把会话、项目、技能、定时任务和
积累下来的路由统计，通过一个加密包在你自己的几台机器之间带走 —— 而 API
密钥和事件钩子永不参与，这是设计，不是一个可以打开的开关。

## 新增

- **遥控服务按来源地址放行。** 只接受回环、私有网段（10/8、172.16/12、
  192.168/16、IPv6 fc00::/7）、CGNAT（100.64.0.0/10，Tailscale 的 tailnet
  地址就发在这一段）和链路本地（169.254/16、fe80::）。来自公网地址的连接在
  socket 层直接掐断，不回 401，什么都不回 —— 扫端口的人得不到任何信号。
  监听仍然绑 0.0.0.0，因为 Tailscale 和 WireGuard 的虚拟网卡也得进得来，
  而那些网卡的地址是会变的。
- **设置里能看到可用地址，并标注档位。** 遥控页签列出服务可达的每一个地址，
  并标明它属于哪一档：私有网络（CGNAT/tailnet）、局域网、链路本地、本机。
  想在外面也能用，正确做法现在直接写在界面上而不是埋在文档里：装 Tailscale，
  用标了「私有网络」的那条地址，一个端口都不用转发。
- **同步页签：你自己的设备，你自己的文件夹。** 会话、项目、技能、定时任务、
  任务记录和路由做成率在几台机器之间流动。落点是你自己指的一个文件夹 ——
  网盘目录、Syncthing 共享目录、tailnet 上挂的共享盘，甚至一个 U 盘。
  没有服务器，因为再自建一个收全部对话的服务器，等于把这个应用刚拒绝掉的
  那份信任又请回来。
- **同步包端到端加密。** 口令至少 12 位，经 scrypt（N=2^15）派生，再用
  AES-256-GCM 封装，每个包一份新 salt 和新 nonce；格式版本、salt、nonce 一起
  作为附加认证数据绑进去，改包头会让认证标签直接失败，而不是诱导出一条旧的
  解析路径。口令每次现输，不保存。落点上躺的永远是密文，所以这个文件夹本身
  不需要可信。忘了口令没有找回途径，以后也不会有 —— 有后门的话，后门就是
  整套东西的实际安全等级。
- **合并是确定性的、幂等的、与方向无关的。** 时间戳大的赢；完全相同就比
  规范化序列化后的字典序 —— 这一条的作用不是「选对」，是让两台机器选得一样。
  合并一律逐条进行，所以一台设备的时钟偏了，最坏是单条记录选错版本，
  而不是整个库被旧数据盖掉。给路由统计当分母用的计数器取两边最大值而不是
  相加，否则同一份数据同步两次就会让每一个做成率的分母凭空翻倍。
- **删除会传播，而删除之后的编辑会赢。** 删掉的记录留下一个墓碑，不会被另一台
  设备原样同步回来。墓碑保留 90 天，和任务观测的保留期一致。两台都删过同一条时
  取更早的那次删除时间 —— 这会让编辑更容易存活，因为丢掉一次删除还能再删，
  丢掉一次编辑找不回来。

## 修复

- 遥控服务自己的注释一直写着「默认只绑内网地址」，而代码一直是
  `listen(port, '0.0.0.0')`。在路由器后面这两句话效果一样，可这台机器一旦
  拿到公网 IP，或者插进咖啡店的公共 Wi-Fi，就完全不是一回事。注释是错的，
  现在行为变成了注释原本承诺的样子，并且在连接层强制执行。

## 破坏性变更

无。同步在你配好文件夹和口令之前不会启动。遥控服务在所有原本能用的网络里
行为完全一致；新被拒绝的只有来自公网来源地址的连接，而那从来就不是一种
受支持的配置。

## 升级注意

- 安装前请先退出正在运行的旧版本，本程序没有自动更新。
- **API 密钥不同步，一次也不会。** 密钥由操作系统的加密存储保管，密钥材料
  绑定这台机器的系统身份（Windows DPAPI / macOS Keychain / Linux libsecret），
  密文搬到另一台机器上本来就解不开；硬要同步就只能先解密成明文再发出去，
  而那正好推翻了 BYOK 这套东西赖以成立的前提。第二台设备要么自己填一个 key，
  要么用遥控把工具调用转发回第一台执行。
- **事件钩子也不同步。** 钩子是一条在工具成功之后自动执行的命令行。同步钩子
  意味着任何能往你的落点文件夹写东西的人，都能让一条命令在你的桌面上跑起来 ——
  那是一条从「能写文件」到「能执行代码」的升级路径。换设备请手动重配，
  通常也就几条。
- 本机相关的设置按字段留在本机：遥控地址和令牌、工作目录、Chrome 端口、
  命令行客户端路径、当前选用的路由、模型列表缓存、路由健康、授权台账、
  窗口位置。合并时本机值永远压过同步包里的值。
- 两台设备必须用同一串口令。口令不保存在任何地方，包括你的设置里。
- 数据目录仍然叫 `anyai`，这是刻意保留的，让从 AnyAI 时期一路升上来的安装
  保住自己的配置。

## 验证

失灵交接链路已端到端验证，全程无人介入：一个任务在 OpenRouter 上撞到额度
用尽，交接给 SenseNova，那边 glm-5.2 额度不足，再次交接，kimi-k3 接手把任务
做完。三条路由，两次交接，一个任务。

尚未验证：Android 客户端在真机上的表现，以及部分供应商的思考参数映射。

## 下载

| 平台 | 文件 |
|---|---|
| Windows 64 位 | `wickrunAI-2.9.0-win-x64-setup.exe`，或 `-portable.exe` 免安装运行 |
| macOS Apple Silicon | `wickrunAI-2.9.0-mac-arm64.dmg` |
| macOS Intel | `wickrunAI-2.9.0-mac-x64.dmg` |
| Linux 64 位 | `wickrunAI-2.9.0-linux-x64.AppImage` 或 `.deb` |

安装包没有代码签名，Windows 和 macOS 可能提示发布者不明。请用本 Release 里的
`SHA256SUMS.txt` 校验下载，或者自己从源码构建。

**完整变更**: https://github.com/lifishard/wickrunAI/compare/v2.8.0...v2.9.0
```

---

## Cutting a release: the order of operations

1. Version number in three places — `package.json`, `src/lib/version.ts`, and the README badge. The release verification test checks the first two against each other; **the badge is not checked by anything and is the one that goes stale.**
2. Write `docs/releases/v<x.y.z>.md` first, from the template above, while the changes are still fresh.
3. Commit with `同步到github.bat` (runs the regression tests and type check first).
4. Cut with `发布三平台版本.bat` — pushes the version tag, GitHub Actions builds and publishes the three platforms. A formal Release only accepts a tag build, so nothing ships from untagged or stale source.
5. Once Actions finishes and the eighteen assets are attached, **paste the notes into the Release body.** This is the step that currently gets skipped, and it is the step that turns a build into a page worth landing on.
6. Only then work through [Launch kit](launch-kit.md). Several items there have the Release page as a hard prerequisite — a link to a Release whose body is a compare link is worse than no link.

## A standing rule

Never publish a Release whose body is only the compare link. If there is genuinely nothing to say, the version did not need a Release; if there is something to say, thirty minutes at publish time is cheaper than the same thirty minutes reconstructed from a diff eight months later — which is exactly the position the seven Releases in section B are in now.
