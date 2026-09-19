# Repository metadata checklist

Maintainer task list for the GitHub repository's own metadata. Nothing here changes the code; all of it changes how the repository is found and what a visitor sees before they read anything.

These commands could not be run from the working environment that produced this file — the GitHub CLI is not installed there. Run them on a machine where `gh auth status` reports a logged-in account with write access to `lifishard/wickrunAI`, then check them off.

```bash
gh auth status   # confirm you are logged in and have write access
```

## 1. Description

Current state: the description advertises an unrelated project in its second half. Search results truncate at roughly 125 characters, so everything after that is invisible in search and the visible part says nothing specific.

The replacement below is 124 characters up to the first period, so the whole differentiating claim survives truncation.

```bash
gh repo edit lifishard/wickrunAI --description "Orchestrates every AI model you own - open, closed, paid, free - in one desktop app, handing a failing task to the next one. BYOK: keys stay on your machine. Electron + React desktop, Capacitor Android client."
```

## 2. Homepage

Current state: points at `https://quanthinker.com`, an unrelated site. The homepage link is shown next to the description on the repository page and in some listings, so it should lead somewhere that helps a visitor.

```bash
gh repo edit lifishard/wickrunAI --homepage "https://github.com/lifishard/wickrunAI/releases"
```

## 3. Topics

Current state: zero topics. Topics are how GitHub's own topic pages and internal search find a repository at all, and they cost nothing.

Eighteen topics, under the limit of twenty, leaving room to add two later.

```bash
gh repo edit lifishard/wickrunAI \
  --add-topic ai-agent \
  --add-topic byok \
  --add-topic multi-model \
  --add-topic llm-client \
  --add-topic openrouter \
  --add-topic anthropic \
  --add-topic openai \
  --add-topic electron \
  --add-topic react \
  --add-topic desktop-app \
  --add-topic android \
  --add-topic capacitor \
  --add-topic llm-router \
  --add-topic failover \
  --add-topic agent-framework \
  --add-topic local-first \
  --add-topic privacy \
  --add-topic self-hosted
```

## 4. Discussions on, Wiki off

Discussions is currently off and the Wiki is on. That is backwards for a project with zero issues and zero stars: Discussions pages are indexed and give people somewhere to ask without filing a bug, while an empty Wiki is a dead link that competes with `docs/`.

```bash
gh repo edit lifishard/wickrunAI --enable-discussions --enable-wiki=false
```

If your `gh` version does not have `--enable-discussions`, use the API directly:

```bash
gh api -X PATCH repos/lifishard/wickrunAI -F has_discussions=true -F has_wiki=false
```

Move anything worth keeping out of the Wiki before turning it off. Long-form content belongs in `docs/`, where it lives in the repository, is reviewed with the code, and each page gets its own indexable URL.

## 5. Verify

```bash
gh repo view lifishard/wickrunAI --json description,homepageUrl,repositoryTopics,hasWikiEnabled,hasDiscussionsEnabled
```

## Still to do by hand

- **Record `docs/failover.gif`.** The README reserves a slot for it. The sequence to capture is the verified one: OpenRouter out of credit, handover to SenseNova where `glm-5.2` is short on quota, second handover, `kimi-k3` picks the task up and finishes, no human intervention at any point. Keep it under about fifteen seconds and make sure the route chips and the handover notice are legible.
- **Social preview image.** Settings → General → Social preview. This is the image every link to the repository renders as on social platforms and in chat apps; without one the link is grey and anonymous.
- **Release notes.** Each release's body is an indexable page. A release published with an empty body wastes it.
