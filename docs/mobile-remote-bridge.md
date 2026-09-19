# Mobile remote bridge: giving the phone your desktop's tools

The Android client has no file system access, cannot drive Chrome, and has no `claude` CLI. Rather than shipping weaker tools on mobile, wickrunAI forwards every tool call from the phone to your desktop over the local network and executes it there. Source: `electron/remote-server.cjs` and `src/lib/transport.ts`.

## Shape of it

The desktop runs a small HTTP server. The phone posts tool calls to it and gets tool results back. That is the entire protocol.

**`GET /ping`** — unauthenticated. Returns `ok`, the application identifiers, and the host name. Its only job is letting the phone confirm the address is reachable before you troubleshoot anything else.

**`POST /tool`** — authenticated. Body is `{ name, args, ctx }`; the server calls `runTool(name, args, ctx)` and returns the result as JSON. A thrown error comes back as 400 with `{ ok: false, content: '', error }`.

Anything else is 404.

The client side is a plain `fetch` to `<configured url>/tool` with `Authorization: Bearer <token>`. When the remote bridge is not configured, the mobile client does not fail silently — tool calls return an error telling you to configure the desktop bridge in settings or do the work on the computer.

## Pairing and authentication

The token is 18 random bytes from `crypto.randomBytes`, base64url-encoded. You generate it on the desktop and type it into the phone once.

Comparison is `crypto.timingSafeEqual` after a length check, and a wrong token gets a bare 401 with no hint about why. An empty configured token never matches anything.

## Limits

Request bodies are capped at the same limit as the attachment batch policy (`MAX_BATCH` from `electron/attachments.cjs`); exceeding it destroys the request and returns a message telling you to send in smaller batches. The bridge deliberately shares that policy rather than defining a second one, because clients may carry attachment metadata through the same authenticated channel.

The default port is 8719.

## Exposure: read this part

The server calls `listen(port, '0.0.0.0')`. It binds every interface the host has, and `status()` reports the reachable LAN addresses so you can pick one on the phone. The token is therefore the only barrier between the listener and anything that can route to your machine.

There is no UPnP, no hole punching, and no relay service. The source states the intent directly: this is not built for public exposure — do not port-forward it.

Practical guidance: run it on a network you trust, keep the token to yourself, and stop the bridge when you are not using the phone. `stop()` closes the listener.

## What the phone gets

Everything in the desktop tool registry, since `/tool` dispatches through the same `runTool` entry point the desktop uses: files, shell, Chrome, documents, GitHub, web search, knowledge, verification, and the locally installed Claude Code client. The permission model does not change by being called from the phone — file tools still reach only the working directories you named, and command and browser tools still act on your computer under the conversation's permission setting.

The Android client is built with Capacitor. It has not yet been verified on a physical device.

## Related

- [What BYOK means here](byok-ai-client.md)
- [Local connections](LOCAL_CONNECTIONS.md)
- [Security policy](../SECURITY.md)
