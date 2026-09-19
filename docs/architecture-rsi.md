# Three layers of self-improvement in a multi-model client

**简体中文版：[architecture-rsi.zh-CN.md](architecture-rsi.zh-CN.md)**

Every claim in this document is checked against the source in this repository, with file and symbol named. Where the code disagrees with this text, the code is right and this text is a bug.

---

## The problem is not routing

Say you hold five API keys. Two are free tiers with daily caps, one is a gateway that resolves `auto/best-coding` to whatever it feels like today, one is a subscription CLI already signed in on your machine, and one you pay per token and would rather not.

The obvious framing is *routing*: given a request, pick the best model. That framing is wrong for this problem, in three separate ways, and getting it wrong is what makes most multi-model tooling feel worse than a single hard-coded key.

**First, "best" is not a property the program can see.** The program can measure latency, token cost and completion. It cannot see that route three is free until the 1st, that route four is billed to an employer, or that route five must not touch a particular client's data. Those are the constraints that actually decide the order, and all of them live in the user's head. A system that ranks routes for you is asserting it knows something it does not.

**Second, the unit of work is a task, not a request.** A request is stateless, and falling back between models per request is a solved problem — a proxy does it in twenty lines. A task has read nine files, asked the user two questions, written a draft, and is on minute twenty. When the route under it dies, "retry on another model" is not a recovery; it is a restart with amnesia. Everything difficult about this problem is about what survives the move.

**Third, most failures do not tell you what they are.** In field data from this application, roughly three quarters of finished tasks carry no user verdict at all — nobody sat there and clicked "this was useful." Any system that learns from outcomes has to decide what to do with the majority case of *not knowing*, and the two obvious answers (count it as success, count it as failure) both manufacture numbers.

So the design question is not "which model is best." It is: **what can a program legitimately learn from your own use, what must it refuse to conclude, and where does the boundary between program and user sit?** That boundary is what this document is about.

---

## Three layers

The architecture splits into three layers by what each one is allowed to change.

| Layer | Changes what | Timescale | Modules |
|---|---|---|---|
| **Execution** | This task, right now | Seconds | `src/lib/failover.ts`, `electron/tools/index.cjs` (`opKeyOf`/`onceOnly`), `electron/hooks.cjs`, `src/lib/skills.ts` |
| **Experience** | What the next task starts from | Days to weeks | `src/lib/observations.ts`, `src/lib/routing-memory.ts`, `src/lib/skills.ts` (merge) |
| **Meta** | Whether the first two layers are actually improving | Weeks | `src/lib/evals.ts` |

Recursive self-improvement is a loaded phrase, so here is the deflationary version of what it means in this codebase: **the system's own execution traces are the input to its later decisions, and there is a third layer whose only job is to check whether that loop is producing improvement or just producing numbers that go up.** Nothing here rewrites its own code and nothing runs unsupervised. The meta layer exists specifically because the first two layers are very good at generating the appearance of progress.

The layers are ordered by blast radius. A bug in the execution layer ruins one task. A bug in the experience layer quietly biases every decision for months. A bug in the meta layer means you never find out about the other two. Each layer is correspondingly more conservative than the one below it.

---

# Layer 1 — Execution

## 1.1 Failover: three concerns, and the module claims exactly one

`src/lib/failover.ts` is 92 lines. Its header comment separates three concerns and states which one the module owns:

- **Policy** — who should take over, free routes first or reliable ones first — belongs to the user. *The code does not know which route is paid and is not supposed to know.*
- **Trigger** — does this failure deserve a handover — belongs to the program.
- **Execution** — what travels with the task when it moves — belongs to the program, and lives elsewhere.

The module therefore does not sort, does not score, and does not pick a best model. It walks the user's order, skipping routes already known bad. An empty list means nothing happens.

This is a small file that gets a surprising amount of design right by subtraction, and the rest of this section is about the three decisions inside it.

### Scope inheritance: only `undefined` inherits

```ts
export function resolveFailover(
  session?: FailoverConfig, project?: FailoverConfig, app?: FailoverConfig,
): { config: FailoverConfig; from: FailoverScope | 'none' } {
  if (session) return { config: session, from: 'session' };
  if (project) return { config: project, from: 'project' };
  if (app)     return { config: app,     from: 'app' };
  return { config: { enabled: false, routes: [] }, from: 'none' };
}
```

Session overrides project overrides app. The load-bearing part is what counts as "not set": only `undefined` inherits. A level that is set counts even when it is an empty list, and even when it is an explicit `enabled: false`.

The reason, from the source comment: *"I don't want automatic handover for this one task" and "I have no opinion at this level" are two different statements, and they have to be sayable separately — otherwise a user who sets a global default can never turn it off for a single run.*

This is the kind of distinction that config systems collapse by accident, usually by treating an empty collection as absent. Once collapsed it cannot be recovered by adding a flag later, because the two states are already stored identically.

The interface carries the distinction through rather than hiding it (`src/components/FailoverList.tsx`): each scope tab is marked when that level has its own setting, a line states which level is in effect and how many candidates it holds, and there is an explicit *"change this level back to inheriting"* action that clears the level rather than emptying it — which is the only way a user can express `undefined` through a UI.

### Which failures hand off, and the three that deliberately do not

```ts
export function shouldHandOff(info: ErrorInfo): string | null {
  if (info.blameModel) return "this route broke on its own";
  switch (info.kind) {
    case 'rate_limit':
    case 'quota':             return "this route's quota is temporarily used up";
    case 'auth':
    case 'route_unavailable':
    case 'routing_policy':    return "this route is currently unavailable";
    case 'tools_unsupported': return "this route doesn't support the tool calls this task needs";
    case 'multimodal':        return "this route can't see images";
    case 'context_too_long':  return "this route's context window can't hold it";
    case 'network':
    case 'timeout':           return "the connection keeps failing";
    default: return null;
  }
}
```

(Reason strings above are translated; the source carries them in Chinese.)

The function returns a *reason*, not a boolean, and `null` means "switching would not help." It looks only at the error — never at user preference, never at cost, never at history. Trigger and policy stay separated.

Three error kinds fall through to `default` and therefore never hand off. This is the most deliberate decision in the file, and the source says why:

- **`bad_param`** — the request itself is malformed. Every route will reject it identically. Handing off converts one clear 400 into five confusing ones.
- **`loop_detected`** — the model is stuck in a behavioural loop. That is a property of the conversation, not of the route. The next model inherits the same conversation and does the same thing.
- **`unknown`** — nobody could classify the cause. Handing off on unclassified errors, per the source comment, *"only burns the whole list one route at a time, and makes it look like it already tried everything."*

That last one is the interesting case, and it generalises well past this codebase. An unknown error is the one where retrying is most tempting and least justified, because "unknown" is exactly the state in which you have no evidence that the next attempt differs from this one. Worse, the failure is silent in a specific way: the user sees five routes attempted and concludes the system exhausted the options. It did not. It performed exhaustion.

A system that retries on unknown errors does not have a retry policy. It has a loop with a counter on it.

### Walking the list

```ts
const skip = [args.current, ...(args.tried ?? [])];
const at = args.order.findIndex((r) => sameRoute(r, args.current));
const ordered = at < 0 ? args.order : [...args.order.slice(at + 1), ...args.order.slice(0, at)];
const route = ordered.find(
  (r) => !skip.some((s) => sameRoute(s, r)) && dispatchable(args.health[r.profileId]?.[r.model]),
);
```

Start after the current route, wrap around, stop before returning to it. Routes already tried in this task are skipped, so one task makes at most one pass over the list — it cannot ping-pong between two routes that fail in alternation. Health is consulted as a filter, never as a ranking.

A route is `{ profileId, model }`: the same model under two credentials is two routes. This is not pedantry. Quota is enforced per credential, so a model that just hit its cap on key A may be immediately usable on key B, and a design that keys on model name alone cannot express the single most common recovery.

---

## 1.2 Idempotency keys derived from content, not from position

`electron/tools/index.cjs`. This is the piece that makes handover safe, and it exists because of a bug that only appears once you have handover.

The job ledger was originally keyed by position: `runId:${round}-${i}-${call.id}` — the round number, the index within the batch, and the call ID the model itself generated. That key is fine while one model runs the whole task. The moment another model takes over, **all three components change.** Same operation, new key, and the ledger's answer to "have we already done this?" becomes permanently "no."

Automatic handover is built on that answer. Getting it wrong once means a duplicate push, a duplicate issue, a duplicate irreversible external effect.

So a second key is derived from content:

```js
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
function opKeyOf(name, args) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ name, args: canonical(args && typeof args === 'object' ? args : {}) }))
    .digest('hex');
}
```

Same operation, same key, regardless of who issued it or in which round. Arguments are recursively key-sorted before hashing because different models serialise the same argument object in different field orders — without the sort, the ledger records nothing useful. **Arrays keep their order**, because order inside an array is meaningful.

### `onceOnly`: the list is deliberately two entries long

```js
function onceOnly(name, args) {
  if (name === 'github_api') return String(args.method || 'GET').toUpperCase() !== 'GET';
  if (name === 'project_memory_write') return args.mode !== 'replace';
  return false;
}
```

What is *not* on this list matters more than what is.

- **`run_command` is not on it.** The same `npm test` is supposed to run again. Blocking it and returning the previous run's result as though it were this run's is *more* dangerous than executing twice, because the caller then reasons about stale state believing it is current.
- **`write_file` / `edit_file` are not on it.** Writing identical content twice is idempotent by nature. Nothing is gained by intercepting it.
- **`project_memory_write` with `mode: 'replace'` is not on it,** for the same reason — replace is idempotent, append is not.

What remains is the narrow class where *issuing the same arguments a second time is a second event in the world*: a non-GET GitHub API call, an appending memory write.

This is the correct shape for a deduplication rule and it is the one most systems get backwards. The temptation is to dedupe broadly and exempt narrowly, which produces a system that silently serves stale results. Here the default is to execute, and suppression is opt-in per operation with a written reason.

When a duplicate is caught, the result is not a silent no-op:

```js
return { ok: false, content: '', repeated: { at: done.at, callId: done.callId },
  error: `This exact operation was already performed in this task (call ${done.callId}) and was not repeated.
          Read that call's result if you need it; to genuinely do it again, change the arguments or state
          your reason, for the user to confirm.` };
```

The model is told what happened, where the earlier result is, and what it would take to override. A silent success would teach it that the operation is cheap; a silent failure would teach it to retry.

There is a third state, and it is the one that matters most. When the ledger says an operation *started* but has no reliable completion record — an interrupted run, a killed process — the tool returns `uncertain: true` and refuses to guess:

> This step began before the interruption but has no reliable completion record. Verify the external result first, then either skip it or explicitly allow a retry, to avoid repeating the operation.

Three states, not two: done, not done, and **don't know**. That distinction reappears at every layer of this system, and it is the single most repeated idea in this codebase.

---

## 1.3 Hooks: configuration that deliberately cannot come from the repository

`electron/hooks.cjs`. After a state-changing tool succeeds, a check command runs; if it fails, its output is put in front of the model in the same turn.

The premise is stated in the header: the "you must always" rules in `AGENTS.md` — keep the version number in sync across three files, never overwrite an existing tag, diff against the baseline before merging — are, as text, only instructions to a model. *A model that forgets has forgotten, and nobody finds out.* Hooks convert the deterministic subset into program behaviour.

Three choices, all of them defensive:

**Configuration is read only from application settings, never from the working directory.**

```js
function readHooks() {
  try {
    const raw = store.kvGet(SETTINGS_KEY);   // 'snc:settings:v1'
    const list = raw ? JSON.parse(raw).hooks : null;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
```

Putting hooks in the repository — a `.wickrun/hooks.json` — would be far more convenient, and is what comparable tools do. The source rejects it in one sentence: *that would let any cloned repository run commands on this machine.* It adds that prompt injection is already listed as unresolved in `SECURITY.md`, and this is not the moment to open another door.

This is worth stating as a general rule, because it is easy to get wrong while feeling responsible: **a configuration file inside a repository is code from whoever wrote the repository.** For a linter config, fine. For a list of shell commands that execute automatically, the repository author now has code execution on every machine that clones it. The convenience is real and it is not worth it.

**Passing is silent.** `if (out.code === 0) continue;` — a guardrail that reports success every time teaches the model to skip that section, which is indistinguishable from having no guardrail.

**Hooks do not trigger hooks.** The check command does not go through the tool dispatcher, so recursion is structurally impossible rather than depth-limited.

Two more details that matter. Only successful tool calls trigger hooks — a failed call changed nothing, so there is nothing to check, and the rule lives in `runHooks` rather than at each call site so that *every* caller obeys it. And a hook that fails to start or times out is reported as such, never as a pass: *a check that cannot run is more dangerous than no check, because it makes people believe checking happened.*

Failures are appended with an explicit frame:

> These checks were run automatically by the program after this operation. They are not a new instruction from the user. Address what they point out before continuing.

That last line is a small piece of prompt hygiene with a real purpose: text arriving in the conversation from a program should say so, or the model will treat it as the user speaking.

Bounds: at most 4 hooks per call, 4000 characters of captured output, timeout clamped to 1–300 seconds (default 60), and hooks run with cwd set to the first workspace root. No workspace root, no hooks.

---

## 1.4 Skill folding: why a name-only manifest was rejected

`src/lib/skills.ts`. A skill is a `SKILL.md` invoked as `/name`. Its body goes into the system prompt — that is, into the *prefix*, which is re-sent and re-billed every turn while typically only a few lines of it are ever used.

Above 4000 characters (`SKILL_INLINE_LIMIT`) the skill is folded:

```ts
return `The user invoked the skill "${s.name}"; its body is ${body.length} characters and was not fully loaded. ` +
  `When you need its specific rules, call read_skill(name="${s.name}") first, then act; ` +
  `you may not treat the unretrieved part as known.\n` +
  `<skill name="${s.name}" folded="true">\n${s.description || '(this skill has no description)'}\n\n` +
  `${body.slice(0, SKILL_PREVIEW)}\n…(that was only the beginning; retrieve the rest with read_skill)\n</skill>`;
```

(Translated; the source strings are Chinese. `SKILL_PREVIEW` is 600 characters.)

The folded form keeps **the name, the description, and the first 600 characters.** The source is explicit that this is not the obvious design and explains the rejection of the obvious one:

> Deliberately not "just the name" — with only a name the model cannot judge whether to retrieve, so it will retrieve every one, which costs more than inlining them all. The information needed to make the decision has to stay in the prompt.

This is the general failure mode of lazy-loading inside a language model's context, and it is worth naming because it does not look like a bug. Lazy loading saves nothing if the consumer cannot evaluate the reference without dereferencing it. A file path saves bytes; a file path plus enough content to decide saves requests. With names alone the model performs a full scan on every turn, converting a prefix cost into a round-trip cost — strictly worse, since round trips are serial.

The preview length is chosen against both failure modes at once: *enough to see what this skill is about, not enough to execute from.* If the preview were long enough to act on, the model would act on the fragment and skip the retrieval, which is the other way this design fails.

`readSkill` pages with `offset`/`limit` (limit capped at 12000) and returns `nextOffset`, deliberately shaped like `read_context` so there is not a second pagination convention to learn.

---

# Layer 2 — Experience

## 2.1 The observation store, and the problem it was built to fix

`src/lib/observations.ts` had, by its own account, a specific pathology:

> Observations have been write-only until today: ninety days, several hundred tasks, complete traces including user feedback — and not one path from any of it back into the next decision.

This is the normal state of telemetry in an application that has no analytics backend. It accumulates, it is never read, and everyone assumes it is doing something.

`src/lib/routing-memory.ts` aggregates it into three numbers: **done rate, end-to-end active time, cost per success.** The header names the constraint the aggregation works under — *copy the metrics, don't invent new ones* — and states three rules, each of which the comments attribute to a specific failure in real testing.

## 2.2 The unit of measurement is a hashed route alias

Not a model name. The alias derives from model, credential and endpoint:

```ts
export async function routeAliasOf(model, profileId, routeKey, epoch) {
  return routeAlias(model + '::' + profileId + '::' + routeKey, epoch);
}
async function routeAlias(url, epoch) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(epoch + '::' + url));
  return 'route-' + [...new Uint8Array(hash)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join('');
}
```

Two independent reasons.

**Gateways.** A logical route like `auto/best-coding` counts as itself. Whatever the gateway resolved to behind the scenes may change from hour to hour, so attributing that run's outcome to some underlying base model is simply false — you did not observe that model, you observed the gateway's choice. The thing you can act on next time is the gateway entry, so that is the thing measured.

**The observation store holds no plaintext routes.** It stores the hash. The alias is exported so the interface can match "this candidate in the failover list" against "this row in the score table" by recomputing it — it cannot be reversed, and the irreversibility is intentional. The `epoch` salt means clearing your statistics genuinely orphans the old rows rather than leaving them re-linkable.

## 2.3 Three buckets, because two would be a lie

```ts
export function verdictOf(t: TaskObservation): Verdict {
  const fb = t.feedback?.outcome;
  if (fb === 'usable') return 'done';
  if (fb === 'partial' || fb === 'unresolved') return 'not_done';
  const a = t.acceptance;
  if (a.failed > 0) return 'not_done';
  if (t.status === 'completed' && a.total > 0 && a.passed === a.total && a.program > 0) return 'done';
  return 'unknown';
}
```

User feedback is authoritative when present. Absent feedback, a task counts as done only if it declared acceptance criteria, all of them passed, **and at least one was checked by the program** (`a.program > 0`).

That last clause is the load-bearing one. A model reviewing its own output is not independent verification. The instructions sent to the model say so; counting self-review as success in the statistics would take it back with the other hand, and the resulting number would be "how often the model said it succeeded" wearing the label "done rate."

Everything else is `unknown` — not guessed.

`doneRate`'s denominator is `done + notDone`. `unknown` is carried and reported as its own column, never folded in. The source gives the field measurement: **only about a quarter of tasks carry user feedback; the other three quarters are neither successes nor failures.** Folding 75% of your data into either bucket does not produce an approximate number, it produces a fabricated one — and because it is fabricated in a consistent direction, it will look stable, which is worse than looking noisy.

Three states rather than two, again. It was `done / not done / unknown` here; it was `completed / not started / uncertain` in the tool ledger; it will be `local / remote / can't tell` in the sync merge.

## 2.4 Sample floors, and what happens below them

```ts
export const MIN_RANK_SAMPLES = 8;   // below this, no rank
export const MIN_COST_SAMPLES = 20;  // cost figures are less stable, higher bar
```

`doneRate` is `null` below eight *judged* samples — not `0`. The distinction is the whole point: `0` is a claim about a route, `null` is the absence of one. `tokensPerDone` additionally requires 20 judged samples, at least one success, and no gaps in usage accounting (`costIncomplete`), because a route with unrecorded usage produces a cost figure that is confidently wrong.

`medianActiveMs` uses the median rather than the mean, since one long-tail task destroys a mean.

`falseDoneRate` measures something distinct and more interesting: tasks that *claimed* completion while acceptance still had failures, unchecked items, or unverifiable ones. It is the rate at which a route tells you it finished when it did not.

Ordering (`routeScores`): rankable routes first by done rate, then unrankable ones by sample count — queued to accumulate, not condemned.

## 2.5 The output is a button

`src/components/FailoverList.tsx`:

```ts
const rankable = routes.filter((r) => scoreOf(r)?.doneRate != null);
const suggested = (() => {
  const sorted = [...rankable].sort((a, b) => (scoreOf(b)!.doneRate ?? 0) - (scoreOf(a)!.doneRate ?? 0));
  let i = 0;
  return routes.map((r) => (scoreOf(r)?.doneRate != null ? sorted[i++] : r));
})();
```

Read that permutation carefully, because it encodes a claim. Only the *positions* held by rankable routes are rearranged. Under-sampled routes stay exactly where the user put them. The source comment:

> Only move the ones with enough samples to judge. Pushing the ones with no data to the back would turn "hasn't been used" into "isn't good" — that would be making it up.

This is the cleanest statement of the boundary this whole system is organised around. Sorting is a claim. Sorting an unmeasured item into last place is a claim about it that you have no evidence for, and it is self-fulfilling: a route sorted to the back is never selected, never accumulates samples, and never gets to escape the ranking it was given for having no samples. The obvious implementation — sort everything, nulls last — silently creates a trap that looks like data.

And the button has to be pressed. The label under it reads: *this is a suggestion, not an automatic action; the order is still yours. Routes with too few samples keep their positions and will not be pushed to the back by historical data.*

---

# Layer 3 — Meta

## 3.1 The layer whose job is to distrust the other two

`src/lib/evals.ts` opens with the reason it exists:

> This layer is the seatbelt that stops the layers below it from fooling themselves. Route scoring, skill success rates and retained corrections all produce numbers that *look* like improvement, and the only way to check them is to run a **fixed** set of tasks under different configurations and compare against the same ruler.

That is the honest statement of the problem with any learn-from-your-own-traces system. As the traces change, the population changes with them. Done rate rising after a configuration change tells you nothing on its own, because the tasks were not the same tasks. Held-fixed cases are the only instrument that measures the system rather than the week.

Cases come from real failures. `worthKeeping` accepts an observation only when `verdictOf(t) === 'not_done'` — successes have no discriminative power — and a failed task is saved as a regression case in one click. The task text is stored verbatim: *do not rewrite it; a rewritten task is not the task that failed.*

## 3.2 dev / holdout, and holdout decay

```ts
export const HOLDOUT_STALE_USES = 3;
export function staleHoldout(cases: EvalCase[]): EvalCase[] {
  return cases.filter((c) => c.split === 'holdout' && c.uses >= HOLDOUT_STALE_USES);
}
```

Two splits. New cases default to `dev`: *a case that goes straight into holdout is being declared held-out before anyone has looked at it, and you are about to look at it.*

The part not usually implemented is that **holdout decays.** Each case counts its `uses`; past three, `staleHoldout` flags it for rotation. The reasoning is that a case you have tuned against has already become development data, and measuring against it afterwards measures your own overfitting. Nothing enforces this at the type level — it cannot be — so the counter is stored on the case itself and the staleness is surfaced, which is as far as a program can go against a human who wants to keep using a stale holdout.

`report(store, split)` never mixes the two splits, and dedupes to the most recent result per case per configuration, so re-running does not dilute.

## 3.3 preserve-and-extend

```ts
const regressed = shared.filter((id) => base.get(id)!.done && !cand.get(id)!.done);
const gained    = shared.filter((id) => !base.get(id)!.done && cand.get(id)!.done);
return { regressed, gained, compared: shared.length,
         adopt: shared.length > 0 && regressed.length === 0 && gained.length > 0 };
```

The adoption contract: a candidate is adopted only when it gains on at least one case, **regresses on none**, and has cases in common with the baseline at all.

Not "higher average." The source:

> Looking only at the average makes "fixed two, broke one" look like net profit — but the one that regressed is precisely something that already worked, and the user notices that it broke before they notice anything else improved.

This is a stronger and more brittle criterion than an average, and both properties are intended. Strictly non-regressing adoption stalls sometimes; that is a feature, since the alternative is a system that ratchets forward on aggregate while shedding capabilities at the edges — the well-documented failure mode of optimising any single scalar over a heterogeneous task distribution. An average is a scalar. A per-case veto is not.

The source attributes the contract to DarwinX and the failure-to-regression-case pipeline to a practice it describes as Meta's internal one; those attributions are the source's, reproduced here rather than independently verified.

Verdict for an eval run uses the same rule as the route scorer — completed, all requirements passed, at least one program-verified. The comment names the reason directly: during a regression run *nobody is sitting there clicking verdicts*, so there is no user feedback to fall back on. If self-assessment were accepted here as a second-best, the regression suite would become a record of how often the model believed it was right.

---

# 2.9.0 — carrying the experience layer to another machine

The experience layer accumulates on one machine. It is worth something only if it survives getting a new laptop. 2.9.0 makes it portable, and the interesting engineering is entirely in what is *not* carried.

## 4.1 The security boundary is one file

`src/lib/sync-policy.ts` states its own role:

> This file is the only security boundary in the whole sync path. If the merge algorithm is wrong, the worst case is messy data. If this file is wrong, an API key or a command that will execute on someone else's computer has been sent out.

So it is **a whitelist**, and the header gives the reason in terms of failure direction: anything not in `SYNC_KEYS` does not sync, any settings field not in `SYNCABLE_SETTINGS` does not leave. New fields default to not-synced, *so that forgetting to update this file results in "one thing didn't sync" rather than "one more thing leaked."*

That is the correct default for any allow/deny decision and it is chosen surprisingly rarely, because a denylist is easier to write and the cost of the choice does not appear until the first field someone forgets.

Synced: conversations, projects, skills, scheduled tasks, observations, and a filtered subset of settings. Fourteen settings fields are listed. Alongside the whitelist are two documentation tables — `NEVER_SYNC_KEYS` and `DEVICE_LOCAL_SETTINGS` — that exist purely so the *reason* has somewhere to live: *"listing them here isn't for the implementation (the whitelist already excludes them), it's so that the next person who wants to add one sees the reason first."*

Sampled reasons, translated from the source:

- `snc:remote:token` — *the remote pairing token is the key to the bridge; syncing it copies that key to every drop point (cloud drive, USB stick, staging folder).*
- `snc:device:id` — *one per machine; sync it and two devices fight over the same drop file.*
- `tools` — *working directories, `claudeBin`, the Chrome port are machine-local paths that do not exist on the other machine.*
- `modelHealth` — *records whether a route is reachable **from this machine**; change network and the conclusion changes.*
- `grantLedger` — *what was approved on this machine; it is a local audit record.*

## 4.2 Why keys never sync, and why it is not a setting

```ts
export const SECRETS_NEVER_SYNC = true;
```

No toggle, and the source says none is planned. The argument is not "keys are sensitive," which would be an argument for encrypting them harder. It is structural:

> API keys are encrypted by `safeStorage`, with key material bound to this machine's system identity (Windows DPAPI / macOS Keychain / Linux libsecret) — the ciphertext would not open on another machine anyway, so syncing them would require decrypting to plaintext first and sending that, which is exactly the premise BYOK exists to hold.

The failure is therefore not a leak risk to be weighed; it is that implementing the feature requires performing the thing the product promises not to do. The remedies given are the two that keep keys where they are: enter a separate key on the second device, or relay tool calls back to the first machine over the remote bridge.

`stripProfileSecrets` carries only the *shape* of a credential profile — name, base URL, extra headers, routing preferences — sets `hasSecret: false` unconditionally, and filters credential-shaped extra headers. *Whether the other machine has this key is for its own secrets store to say, not for the sync package.*

## 4.3 Why hooks never sync

The reason is one sentence in the source and it is worth reproducing:

> Note that `hooks` is not in the list, and that is deliberate: a hook's content is a command line that executes automatically after a tool succeeds. Syncing hooks means anyone who can write to the drop point can get a command running on your desktop — that is a path from "can write a file" to "can execute code." Reconfigure hooks by hand when you change machines; there are only a few.

This is the same rule as §1.3, applied one level out. In §1.3 the untrusted source was a cloned repository; here it is a shared folder. Both cases reduce to: a hook list is executable content, so wherever a hook list can arrive from, code can arrive from. The sync design and the hooks design were made consistent deliberately, which is why the `hooks` field is absent from `SYNCABLE_SETTINGS` *and* listed with its reason in `DEVICE_LOCAL_SETTINGS`.

## 4.4 Two nets that fail differently

The whitelist filters by field name. A second pass scans values:

```ts
export const SENSITIVE_FIELD =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization|password|client[_-]?secret|secret|token|cookie|set-cookie)$/i;

export function assertSyncSafe(payload: unknown): void {
  const leaks = findSensitivePaths(payload);
  if (leaks.length) throw new Error(`credential fields found in the sync package, aborted: ${leaks.slice(0, 5).join(', ')}`);
}
```

The source is explicit about why both exist: *the whitelist filters field names, and a key could one day be put inside an object that is on the whitelist. Two nets that fail in the same way are one net.* `assertSyncSafe` throws — it aborts the sync rather than scrubbing and continuing, because a package that needed scrubbing is evidence that something upstream is wrong.

The regex is kept byte-identical with the `sensitive` list in `electron/data-backup.cjs`, and `tests/sync-policy.test.cjs` compares the two literally, so neither side can be quietly relaxed alone.

On receive, `graftDeviceLocal` applies local settings, overlays the whitelisted incoming fields, then overlays the device-local fields back from local — *so no matter what a package contains, local wins.* A `remote.token` or a `hooks` array smuggled into a package is overwritten by the local value before it reaches anything. `hasSecret` is likewise re-derived from local: the package always says `false`, but this machine may actually hold that key.

## 4.5 Merge: determinism above correctness

`src/lib/sync-merge.ts` states its goal as: after two devices sync, both hold identical contents, **independent of who merged first or how many times.** Everything else is subordinate:

> - Later timestamp wins
> - Same timestamp, compare content: the lexicographically smaller canonical serialisation wins
>
> The second rule looks arbitrary. Its purpose is not to "pick the right one," it is to make both sides pick the same one. When timestamps collide there is no way to tell which is newer anyway; picking arbitrarily but identically beats each side picking its own.

That is the correct priority for a system with no authority, and stating it plainly is unusual. Convergence is checkable; correctness under a colliding timestamp is not defined. A tie-break that is arbitrary-but-total gives a property you can test. A tie-break that tries to be smart gives neither.

Clocks are explicitly untrusted, and explicitly not corrected: *correcting them needs an authoritative clock, and this system has no server.* What is done instead is to bound the damage — **merges are always per record, never a wholesale replacement** — so a skewed clock can at worst pick the wrong version of one record, rather than letting a stale store overwrite a current one.

`canonical()` sorts keys before serialising, so both machines compute the same string. Output is sorted by id, so the merged state is byte-identical on both sides.

## 4.6 Tombstones, and why a deletion loses to a later edit

Without deletion markers, a record deleted on one machine comes straight back from the other. So deletions leave tombstones `{ id, deletedAt, by? }`, with `by` recorded for diagnosis only and *not* used in any decision.

Two choices here run against the intuitive design.

**When both machines deleted the same record, the merge keeps the *earlier* deletion time.**

```ts
if (!prev || t.deletedAt < prev.deletedAt) graves.set(t.id, t);
```

> Take the earlier rather than the later, because *when* the deletion happened determines whether it can suppress an edit. Taking the earlier is more conservative — edits win more easily, data is lost less easily.

**A deletion loses to any edit that came after it.**

```ts
if (stampOf(item) > grave.deletedAt) {
  graves.delete(id);       // edited after deletion — that edit is the later intent
  items.push(item);        // the record comes back, the tombstone is void
}
```

Both choices are asymmetric in the same direction, and the asymmetry is the argument. The two errors are not equal in cost: a deletion that fails to propagate leaves a record you can delete again in two seconds, while an edit that loses to a deletion is work that no longer exists anywhere. Given that, the tie should go to the edit every time — and both the earlier-deletion rule and the resurrection rule are ways of spending the ambiguity in that direction.

Tombstones expire after 90 days, matching observation retention, with the reason for a long TTL stated: *clearing them too early lets an old record resurrect from another device, so the TTL has to exceed the longest plausible time two devices spend out of contact.*

## 4.7 Observations do not merge like a collection

```ts
droppedTasks:  Math.max(local.droppedTasks  ?? 0, remote.droppedTasks  ?? 0),
writeFailures: Math.max(local.writeFailures ?? 0, remote.writeFailures ?? 0),
```

Tasks merge per record, but the counters cannot be added: **syncing the same data twice would double them, and these numbers are denominators for route done rates.** Doubling a denominator silently rewrites every conclusion the experience layer has reached. They are monotonic local counters, so `max` is at least never an overstatement.

`ignoredRecordIds` takes the union — *if either device says "don't count this one," don't count it.* `epoch` does not merge and local always wins, because *changing the epoch means the user cleared their statistics, and clearing is an explicit local intent that another device should not be able to undo.*

Settings merge whole, not per field:

> Not field-level, because settings fields constrain each other (the failover list references ids in `keyProfiles`). Taking the newest value of each field independently can assemble a configuration that never existed on either machine and contradicts itself. Taking the newest whole does discard the other side's changes, but what it discards is a coherent older configuration.

## 4.8 The envelope

`electron/sync-crypto.cjs`: scrypt (N=2¹⁵, r=8, p=1, 32-byte key) over a passphrase of at least 12 characters, then AES-256-GCM with a fresh 16-byte salt and 12-byte nonce per package. Format, version, salt and nonce are bound in as AAD, *because without that, editing the header — lowering the version number to steer an old parse path — would not break the tag, which leaves a downgrade route open.* KDF parameters are written into the header so that packages sealed under today's parameters still open after the parameters change.

Sealed packages are capped at 64 MB so a malformed one cannot exhaust memory. There is no recovery path for a forgotten passphrase and the source says there will not be one: *a backdoor is the actual security level of any system that has one.*

The drop point (`electron/sync-folder.cjs`) is a folder, not a server, *because standing up a server that collects everyone's conversations means inviting back exactly the trust this application declines.* Each device writes exactly one file, `<deviceId>.wsync`, where the device id is a random UUID with nothing machine-identifying in it, *because the filename will be sitting in that folder where people can see it.* Devices never write to each other's files, so there are no write conflicts in the folder at all; merging happens after reading, on each machine. The folder must be an absolute path and must not be a symlink.

## 4.9 The bridge, tightened in the same release

`electron/remote-server.cjs` classifies source addresses into `loopback`, `private` (10/8, 172.16/12, 192.168/16, IPv6 `fc00::/7`), `cgnat` (100.64.0.0/10), `linklocal` (169.254/16, `fe80::`), `public` and `unknown`. Only the first four are accepted. A public source is destroyed at the socket with no response — *no 401, no 403, nothing; a port scanner gets no signal that anything is here.*

The header documents the bug plainly:

> The comment here used to say "binds internal addresses only," but the code has always been `listen(port, '0.0.0.0')` — all interfaces. Behind a router those two behave identically, but the moment this machine gets a public IP, or joins café Wi-Fi, `0.0.0.0` means a command-line entry point sitting by the front door.

Binding stays `0.0.0.0`, because Tailscale and WireGuard virtual interfaces have to be reachable and their addresses move. The fix is at the connection layer instead. CGNAT is on the allow list precisely because Tailscale allocates tailnet addresses from `100.64.0.0/10`, which is why *"install Tailscale"* works with zero code changes — and the settings screen now labels each address by tier (`private network`, `LAN`, `link-local`, `this machine`) so the correct answer is visible in the interface rather than buried in a document. Loopback is allowed deliberately, for Cloudflare Tunnel and reverse proxies, with the caveat written down that anything arriving that way must add its own authentication layer first, because a bearer token alone is not enough on the public internet.

---

# Five decisions that look wrong at first

## It recommends; it does not replace

The scorer has a done rate per route. Applying it automatically would be one line. It is a button instead, and the ranking permutation deliberately leaves under-sampled routes in place.

The justification is not caution, it is scope. The program measures completion. The user's actual objective function includes which key is free, which is billed to an employer, which has a data-residency constraint, and which one they are evaluating this week. None of that is observable from traces. A system that reorders on the one dimension it can see is not optimising the user's objective; it is optimising a proxy and presenting the result as a decision.

And the specific failure of auto-sorting nulls last is a trap that looks like data: a never-used route is sorted to the back, never gets selected, never accumulates samples, and never escapes. The measurement system would be creating the very data that justifies it.

## Unknown is a bucket, not a rounding error

In field data about three quarters of tasks carry no verdict. Assigning them to either side produces a number that is stable, precise, and false — and stable-and-precise is worse than noisy, because it invites trust.

The same three-state shape recurs everywhere: `done / not_done / unknown` in scoring, `completed / not_started / uncertain` in the tool ledger, `passed / failed / unverifiable` in acceptance. Each time, the third state is the one that is expensive to carry and tempting to collapse. Collapsing it is how a system starts telling itself stories.

## Unknown errors do not trigger failover

The one case where retrying is most tempting is the one where you have the least evidence that the next attempt differs. Beyond wasting the list, it produces a specific false impression: the user sees five routes tried and concludes the options were exhausted. Nothing was exhausted; exhaustion was performed.

## A deletion loses to a later edit

A deleted-then-edited record comes back and the tombstone is voided. When both sides deleted, the earlier deletion time is kept, making edits win more often.

The asymmetry is deliberate because the errors are not symmetric. A deletion that fails to propagate is two seconds of annoyance. An edit that loses to a deletion is destroyed work with no copy anywhere. Where a distributed system without an authority must guess, it should guess in the direction whose error is recoverable.

## Determinism beats correctness in the merge

On a timestamp tie the winner is whichever canonical serialisation sorts lower. That is not a judgement about which version is better; nothing in the system can make that judgement. It is a guarantee that both machines reach the same state.

Convergence is a property you can test. "Correct under a colliding timestamp" is not even defined. A system with no authoritative clock should optimise for the property it can actually verify, and say so.

---

# What this is not

- **Nothing rewrites its own code.** The self-improvement is: traces feed later decisions, and a third layer checks whether that loop produces improvement. The mechanism is measurement and adoption contracts, not code generation.
- **Nothing runs unsupervised.** The route scorer produces a button. The eval harness produces a comparison. Both wait for a human.
- **The meta layer exists because the other two are persuasive.** Any system that learns from its own traces will produce numbers that go up. `evals.ts` is the part that asks whether they mean anything, and its adoption contract is a per-case veto specifically so that an improving average cannot hide a capability that was lost.
- **Not verified:** the Android client on physical hardware; reasoning-effort parameter mapping for several providers. The packages are not code-signed.

The application is Apache-2.0 at [github.com/lifishard/wickrunAI](https://github.com/lifishard/wickrunAI). `src/lib/failover.ts` is 92 lines and `src/lib/routing-memory.ts` is 129; both are short enough to read in full, and the comments in them carry the reasoning this document paraphrases.
