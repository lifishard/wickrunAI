# Multi-model router: scoring routes by what they actually finished

wickrunAI keeps a local record of how every route performed on your own tasks, aggregates it into a done rate, and offers to reorder your failover list by it. It offers. It does not act. This page describes `src/lib/routing-memory.ts`, `src/lib/observations.ts`, and `src/components/FailoverList.tsx`.

## The problem this solves

Observation data was write-only: ninety days, hundreds of tasks, complete traces with user feedback, and not one path from any of it back into the next decision. The routing memory module closes that loop with three numbers — done rate, end-to-end duration, cost per success — and the source instructs itself to reuse those and not invent new metrics.

## Constraint A: the unit is a route alias, not a model name

Statistics are grouped by an alias derived from the model ID, the credential profile, and the base URL, hashed together with the store epoch:

```
alias = "route-" + first 8 bytes of SHA-256("<epoch>::<model>::<profileId>::<routeKey>") in hex
```

The alias is stored instead of the plain route, and it is not reversible. The interface matches your failover candidates against the score table by recomputing the same hash, never by decoding.

Grouping by alias rather than model name matters for gateways. A logical route such as `auto/best-coding` counts as its own row, because the gateway behind it can change which model actually executes at any time. Crediting those results to whichever base model happened to serve them would be wrong.

The same model under two credentials is two rows, which is the behaviour you want when one of the two has a different tier or a different rate limit.

## Constraint B: "unknown" is a third outcome, not a rounding error

`verdictOf` returns `done`, `not_done`, or `unknown`:

- Explicit user feedback wins. `usable` is done; `partial` and `unresolved` are not done.
- Without feedback, any failed acceptance check is not done.
- Without feedback, a task counts as done only if it completed, declared acceptance criteria, passed all of them, **and at least one of those checks was program-verified**. A model reviewing its own work is not independent verification — the instruction sent to the model says so, and the statistics are not allowed to then count it as success.
- Everything else is `unknown`. No guessing.

The done rate's denominator is `done + notDone` only. `unknown` is reported separately. In real field data roughly three quarters of tasks had no user feedback, and folding those into either side would have manufactured a number.

`falseDone` is tracked separately: tasks that claimed completion while acceptance still contained failures, unchecked items, or items that could not be verified.

## Constraint C: not enough samples means no number

```
MIN_RANK_SAMPLES = 8    // below this, no ranking at all
MIN_COST_SAMPLES = 20   // cost figures are noisier, so a higher bar
```

Below eight judgeable outcomes, `doneRate` is `null` — not zero. The comment names the failure mode directly: reporting a done rate computed from three calls is the easiest way for a system like this to crash into a wall.

Cost per success additionally requires that no usage data was missing; if any request failed to record its token usage, `costIncomplete` is set and the cost figure stays `null`.

Duration uses the **median** of active milliseconds, not the mean, because long-tail tasks destroy a mean.

The sort puts rankable routes first by done rate descending, then unrankable ones by sample count descending — waiting to accumulate, not buried.

## Why it recommends instead of replacing

The failover list shows each candidate's done rate inline, or "not enough samples (n judgeable)" when it is below the bar. When more than one candidate is rankable, a button appears:

> Reorder by historical done rate (n have enough samples)

and beside it:

> This is a suggestion, not something done automatically: the order is still yours. Routes without enough samples keep their position and will not be pushed to the back by historical data.

Two design decisions are encoded there. First, nothing is reordered until you click. The program does not know which route is free, which one you are in the mood for, or which one your employer requires — and the code says it is not supposed to know.

Second, the reorder is a permutation restricted to the rankable subset. Positions holding an unrankable route are left exactly as they are, and only the rankable positions are refilled in done-rate order. Sorting unmeasured routes to the back would turn "never used" into "bad", which the source calls what it is: fabrication.

## Related

- [Failover between models](llm-failover.md)
- [What BYOK means here](byok-ai-client.md)
