# LLM failover: handing a running task to the next route

When the route you are on stops working, wickrunAI hands the task to the next route on a list you ordered yourself, carrying the saved progress rather than starting over. This page describes the mechanism as implemented in `src/lib/failover.ts`, `src/lib/errors.ts`, `src/lib/handoff.ts`, and `src/components/FailoverList.tsx`.

A route here is a pair: a credential profile plus a model ID. The same model under two different credentials is two different routes.

## The module draws a line around itself

The header comment in `failover.ts` separates three concerns and claims only the middle one:

- **Policy** — who should take over, free routes first or expensive ones first — belongs to the user. The code does not know which route is paid and is not supposed to know.
- **Trigger** — does this particular failure deserve a handover — belongs to the program.
- **Execution** — what travels with the task when it moves — belongs to the program, and lives elsewhere.

So the failover module does not sort, score, or pick "the best" model. The list is in the order you put it in, and the program walks down that order, skipping routes already known to be broken. An empty list means nothing happens.

## Three-level inheritance: session > project > app

`resolveFailover(session, project, app)` returns the first level that is defined, and reports which level that was.

The rule is that only *undefined* inherits. A level that is set counts, even when it is an empty list or an explicit off switch. The reasoning in the source: "I do not want automatic handover for this one task" and "I have no opinion at this level" are two different statements, and a user who has set a global default must still be able to turn it off for a single run.

The interface surfaces this. Each scope tab is marked when that level has its own setting, a line states which level is actually in effect and how many candidates it holds, and there is an explicit "change this level back to inheriting" action that clears the level rather than emptying it.

## Which failures trigger a handover

`shouldHandOff(info)` returns a reason string, or `null` meaning switching would not help. The decision looks only at the error, never at user preference.

First, any error already classified as the route's own fault (`blameModel`) hands off.

Then, by error kind:

| Error kind | Hands off | Reason given |
|---|---|---|
| `rate_limit` | Yes | This route's quota is temporarily used up |
| `quota` | Yes | This route's quota is temporarily used up |
| `auth` | Yes | This route is currently unavailable |
| `route_unavailable` | Yes | This route is currently unavailable |
| `routing_policy` | Yes | This route is currently unavailable |
| `tools_unsupported` | Yes | This route does not support the tool calls this task needs |
| `multimodal` | Yes | This route cannot read images |
| `context_too_long` | Yes | This route's context window cannot hold it |
| `network` | Yes | The connection keeps failing |
| `timeout` | Yes | The connection keeps failing |
| everything else | No | — |

## Which failures deliberately do not trigger one

Three kinds are left in place on purpose, and the source says why: switching cannot fix them.

- **`bad_param`** — a 400 where some field sent downstream is not accepted by this model. The request itself is malformed for that model. Handing the same malformed request to the next model is not a fix.
- **`loop_detected`** — a behavioural problem that has nothing to do with which model is answering. A new model will loop the same way.
- **`unknown`** — the cause could not be determined. The comment is blunt about this one: automatically switching on errors you cannot explain "just burns through the whole list one by one, while making it look like everything possible was tried."

`model_missing` — an ID that does not exist upstream — is likewise not in the switch, and is not something the next route can repair for you.

This is the part most worth copying if you are building something similar. An automatic failover that triggers on everything converts one clear failure into N obscure ones and destroys the signal that told you what was wrong.

## Choosing the next route

`nextRoute` starts at the position after the current route, wraps around, and stops before returning to it:

1. Ask `shouldHandOff`. If it says no, or the list is empty, do nothing.
2. Build the skip set from the current route plus every route already tried in this task.
3. Rotate the user's list so it begins after the current route.
4. Take the first candidate that is not in the skip set and whose recorded health says it is dispatchable.

Because tried routes are never retried, one task walks the list at most once. It cannot ping-pong between two routes.

## What travels with the task

`createContextHandoff` builds a new conversation from the saved run state rather than replaying the old context window. The draft it produces contains:

- Your original requirements and any follow-ups, extracted from the working messages.
- A checkpoint note: status, blocker, memory summary (facts, decisions, unresolved items, next steps), milestones, requirements with their checks and verification, the last twelve pieces of evidence, the files touched with their direction, and the pending tool calls from the cursor onward.
- The most recent visible answer, truncated, labelled as historical material that may not be finished.
- An instruction to verify existing results before redoing work.

Two constraints are written into the code as comments. The checkpoint carries portable working notes — never hidden reasoning, never a new user instruction. And the handoff is a local draft only: no tool dispatch, no backend agent, no implicit continuation. The new conversation waits for you.

Original evidence stays retrievable. `withHandoffArchive` moves the source run's context archive and steps into the new conversation's memory, so the material can be looked up without resending the entire old window.

## A real sequence

The scenario this was built against, verified end to end with no human intervention: OpenRouter runs out of credit, the run hands off to SenseNova, `glm-5.2` there has insufficient quota, the run hands off again, and `kimi-k3` picks the task up and finishes it. Three routes, two handovers, one task.

## Related

- [Multi-model routing and route scores](multi-model-router.md)
- [Using OpenRouter with wickrunAI](openrouter-desktop-client.md)
