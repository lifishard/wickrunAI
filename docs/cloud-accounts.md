# Shared Google accounts: desktop + web

The repositories remain separate. `lifishard/wickrunAI-web` owns the Railway HTTP service and PostgreSQL database. `lifishard/wickrunAI` contains the installed desktop client. Both use Google’s stable account ID, not an email address supplied by a client, to select account data.

## Railway setup

In the existing Railway project, add a **PostgreSQL** database service. Keep the web application at one replica: browser sessions and pending desktop approvals currently live in that process. Restarting the web service requires browser sign-in again; saved account content, API keys, and desktop sessions remain in PostgreSQL.

Set these variables on the **web application service**, not just on the database:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://wickrunai-web-production.up.railway.app` |
| `DATABASE_URL` | Reference the database service's `DATABASE_URL`, e.g. `${{Postgres.DATABASE_URL}}`; use the actual service name |
| `CLOUD_ENCRYPTION_KEY` | A randomly generated 32-byte key encoded as Base64 |
| `GOOGLE_CLIENT_ID` | Existing Google **Web application** client ID |
| `GOOGLE_CLIENT_SECRET` | That client's secret |

Generate the encryption key on your own computer (this prints a new secret for you to copy into Railway):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not commit this value or send it in a chat. Keep a private backup alongside database recovery material. Changing or losing it makes previously saved API keys unreadable. This release does not include automatic key rotation. No secret uses a `VITE_` variable or enters the build image. Tables are created at application startup, when Railway's private database network is available.

In Google, register this exact redirect URI:

`https://wickrunai-web-production.up.railway.app/api/auth/callback/google`

Deploy the web `main` branch. No desktop service or second OAuth client is needed. Without `DATABASE_URL`, existing local preview remains usable and the account panel explains that cloud sync is unavailable. A configured database with a missing/invalid encryption key fails startup rather than silently saving plaintext keys.

The desktop release uses the Railway address above as its fixed trusted backend. Before changing `APP_ORIGIN` to a future Cloudflare domain, ship a desktop update pointing to that domain and update Google’s callback URI. Changing DNS alone does not update already installed clients.

## First sign-in

1. In the website, sign in with Google, open **Cloud sync**, and check the account email.
2. In the new desktop release, open **Google account → Sign in with Google**. The operating system opens the default browser. Google passwords are entered only there.
3. Compare the eight-character code in the desktop app and browser, then approve the desktop app. Return to the desktop and restart into the account workspace.
4. Existing guest content stays in its original workspace. Choose **Import local guest content → Import into this account** to copy it, including saved model API keys. Existing account records with identical IDs and existing cloud keys take priority; the original guest copies remain available.
5. Sign in with the same account on another device. Chat content, projects, skills, scheduled task definitions/history, and saved model API keys become available there.

Google sign-in does not include model credits. Each account uses API keys supplied by that account.

## Behavior and limits

- Sync runs on sign-in, shortly after changes, and every minute while idle. The panel provides a manual sync button. Running jobs pause synchronization until idle; account switching restarts the desktop into separate storage.
- Each accepted snapshot has a revision. A three-way merge combines independent records and propagates deletions. Conflicting changes to the same record require choosing local or cloud versions. Server writes use an atomic revision check; device clocks do not decide the winner.
- A failed/partial local apply has a recovery journal. First-sync and explicit conflict decisions keep a local recovery snapshot. These are recovery aids, not a substitute for PostgreSQL backups.
- Task execution logs are portable **read-only history** in the cloud panel. Files, local process state, folder access, grants, executable hooks, and device tool settings do not migrate. Imported conversations cannot automatically resume local tools. New skills and scheduled tasks are disabled on a new device until enabled there.
- API key values use a separate authenticated endpoint and AES-256-GCM encryption in PostgreSQL, bound to the account and profile. The backend can decrypt them; this is **not end-to-end encryption**. HTTPS protects transport. Desktop sign-in tokens are stored using the operating system's encrypted storage; no plaintext fallback is allowed. Desktop sessions expire after 30 days and can be revoked by signing out.
- Model keys are cached in the desktop's existing local secret store or the web tab's account-scoped session storage so existing model clients can use them. Local device access and deliberate content pasted into chats remain the user's responsibility. Ordinary chat/project content is not encrypted by the application in the database.
- One account snapshot is limited to 10 MiB and 5,000 records per collection; a model key is limited to 8 KiB. Oversized requests fail visibly instead of truncating history. Large binary attachments can reach this limit quickly; object storage is a future expansion.
- API key changes use last accepted write for that profile. Ordinary record conflicts are reviewed, but there is no separate secret-version conflict dialog.

## Verify after configuration

Use two independent browsers/devices with the same account. Create a small chat/project, add a skill and a test schedule, save a model key, and sync. Check that the second device sees these, then rename and delete a record and sync again. Sign in with another Google account and confirm the first account's content and keys are absent. Pause running tasks before this check. Restart the Railway service and confirm data persists after reauthentication.

Real Google authorization and the production database require your Railway/Google configuration. Automated tests use synthetic identities and keys; they do not request access to your Google account or incur model charges.

References: [Railway PostgreSQL](https://docs.railway.com/databases/postgresql), [Railway private networking](https://docs.railway.com/networking/private-networking), [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).
