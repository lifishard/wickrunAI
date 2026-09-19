# Repository metadata checklist

Maintainer task list for the GitHub repository's own metadata. Nothing here changes the code; all of it changes how the repository is found and what a visitor sees before they read anything.

Two ways to do it: the browser (Option A, no install) or the GitHub CLI (Option B). Both change the same settings — pick one.

**Status, checked 2026-09-19:** description, homepage and topics are done — 17 topics are live. **`android` did not take**; add it in the About panel (the repository ships an Android client and that is a term people search for). Discussions and the wiki still need the Settings → Features pass, and there is still no social preview image.


## Option A — do it in the browser, no `gh` needed

Everything in sections 1 to 4 can be done from the GitHub web UI in about three minutes. This is the shorter path if you do not already have the CLI.

1. **Description, homepage, topics** — open `https://github.com/lifishard/wickrunAI`, click the **gear icon** next to *About* in the right-hand column. The panel has a Description box, a Website box, and a Topics box (type a topic, press Enter, repeat). Paste the description from section 1, the URL from section 2, and add the eighteen topics from section 3. Click **Save changes**.
2. **Discussions on** — **Settings → General → Features**, tick **Discussions**, then **Set up discussions**.
3. **Wiki off** — same **Features** block, untick **Wikis**. Copy anything worth keeping into `docs/` first; turning the wiki off hides its content.
4. **Social preview** — **Settings → General → Social preview → Edit → Upload an image**. 1280x640 PNG. Without one, every link to this repository renders grey and anonymous in chat apps and on social platforms.

Verify by reloading the repository page: the About column should show the new description, the releases link, and a row of topic chips.

## Option B — the `gh` CLI

Install it first if you do not have it. On Windows: `winget install --id GitHub.cli`, then open a **new** terminal so `gh` is on `PATH`. Then `gh auth login` and pick GitHub.com, HTTPS, and login with a web browser.

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

- **A demo image — optional.** The README shows the handover notice as text, which carries the claim without any recording. If you want a picture, the cheap version is a still screenshot of the run journal after a handover has happened naturally; see section 1 of [launch-kit.md](launch-kit.md). Nothing waits on this.
- **Social preview image.** Settings → General → Social preview. This is the image every link to the repository renders as on social platforms and in chat apps; without one the link is grey and anonymous.
- **Release notes.** Each release's body is an indexable page. A release published with an empty body wastes it.
