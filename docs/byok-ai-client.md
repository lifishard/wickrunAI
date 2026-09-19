# BYOK AI client: what "bring your own key" means in wickrunAI

BYOK means the application ships with no API key and no account of its own. You paste in a key you obtained from a model provider, and every request goes from your machine straight to the endpoint you configured. There is no wickrunAI server in the path, because there is no wickrunAI server.

This page describes what the code actually does. Source: `electron/store.cjs`, `src/lib/observations.ts`, `src/lib/transport.ts`.

## Where the key is stored

Desktop configuration lives in a single file, `store.json`, under Electron's `userData` directory. Two kinds of content are treated differently:

- Ordinary settings and conversation records are written as plain JSON.
- API keys go through Electron `safeStorage` before they are written. The ciphertext is base64-encoded and stored in the same file.

`safeStorage` delegates to the operating system:

| Platform | Backing store |
|---|---|
| Windows | DPAPI |
| macOS | Keychain |
| Linux | libsecret |

If the platform cannot provide encryption, the key is stored in clear text and the store marks that fact in its metadata so the interface can warn you. The code does not silently pretend the key is protected.

One consequence worth knowing: on macOS and Linux, `safeStorage` is tied to application identity, so copying `store.json` to another machine or another application name is not guaranteed to decrypt. wickrunAI deliberately keeps the older internal identity and data directory name (`anyai`) so that upgrading does not strand your existing keys and conversations.

## What leaves your machine

When you send a message, the request goes to the Base URL you configured, carrying the key for that credential profile. That is the only outbound path the model side uses. Accounts, subscriptions, billing, and rate limits stay with the provider you chose.

Tool calls are separate. File tools reach only the working directories you name. Shell and browser tools act on your own computer, under the permission setting for that conversation.

## Statistics are stored hashed, not in clear

wickrunAI keeps a local record of how each route performed, so it can later show you a done-rate per route. That record does not contain the route in clear text. Routes are stored as an alias: a SHA-256 hash over the epoch, the model ID, the credential profile ID, and the route key, truncated to eight bytes and rendered as `route-<hex>`.

The alias is not reversible, and that is intentional — the comment in `src/lib/observations.ts` says so explicitly. The interface can still line up "the candidate in your failover list" with "this row in the score table" only by running the same hash again over the candidate, never by decoding the alias.

The snapshot projection that builds those records is documented as a pure projection in which raw text, titles, paths, headers, and error messages never enter the index.

## Related

- [Failover between models](llm-failover.md)
- [Multi-model routing and route scores](multi-model-router.md)
- [Security policy](../SECURITY.md)
