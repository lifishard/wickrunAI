# wickrunAI Privacy Policy

> **DRAFT — not in effect.** Placeholders in square brackets are filled in once the company is registered and the hosting regions are confirmed, and the text must be reviewed by a lawyer licensed in British Columbia before it is published. It describes the behaviour of wickrunAI 4.1.1. Chinese version: [PRIVACY.zh-CN.md](PRIVACY.zh-CN.md).

Effective date: [Effective date]

[Company legal name] ("we", "us"), of [Registered address], British Columbia, Canada, makes the wickrunAI (灯芯AI) apps and online services. This policy explains what personal information we handle, why, and the choices you have. It is written to meet Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and British Columbia's Personal Information Protection Act (PIPA).

## 1. The short version

- **Without an account, the desktop app sends us nothing.** Your conversations, files and settings stay on your device. Requests to AI models go from your device directly to the provider you configured, with your own key.
- **With an account and cloud sync,** we store what you sync — including your saved model API keys — so your devices stay in step.
- **The web version** relays your model requests through our server to the provider you chose, without storing them.
- **The Butler** collects nothing until you agree, keeps raw records on your device for at most 24 hours, and can be told to forget.
- **We have no analytics, advertising or tracking,** we do not sell personal information, and we do not use your content to train AI models.

## 2. Information on your device

The desktop app stores your conversations, projects, settings and task records on your computer (in its user-data folder). Model API keys are encrypted with your operating system's keystore (Windows DPAPI, macOS Keychain, Linux libsecret); if no keystore is available, they are stored on the device without that encryption. The app also keeps local copies of recent model requests and responses for task recovery and review, and a local log of window crashes and memory use. None of this is sent to us unless you sign in and sync it.

The web version stores your data in your browser's storage, and keeps API keys in session storage that is cleared when the browser session ends, unless you sync them.

## 3. Information we collect

### 3.1 Account

You sign in with Google. We receive and store your Google account identifier, your verified email address and your display name. We do not receive your Google password. We keep a sign-in session (a cookie on the web, valid for 7 days; on other devices a token, of which we store only a hash) so you stay signed in.

### 3.2 Cloud sync

When you turn on cloud sync, we store the categories you sync: conversations, projects, skills, scheduled tasks, observations, model connection profiles (name and address of each provider), task history, Butler results (see section 3.6) and preferences. We also store the **model API keys** you saved, so your other devices can use them. Keys are encrypted at rest with AES-256-GCM using a key held by our servers; this protects them if storage is exposed, but it is not end-to-end encryption, so our systems can decrypt them to return them to your devices.

If you turn on **end-to-end encryption**, sync records and files are encrypted on your devices with keys that stay on your devices, plus a recovery key that only you keep. We cannot read that content, and we cannot recover it if you lose your devices and the recovery key. API keys are not covered by end-to-end encryption.

### 3.3 Files

Attachments and project documents can be transferred between your devices through a temporary relay (up to 110 MB per file, deleted after about 7 days). Media you generate or store in the cloud, and files you share, are kept in cloud object storage within your plan's limits.

### 3.4 Sharing and collaboration

When you share an item, we store it and its access settings, and we show the people you share with what their role allows: the item itself, comments with the author's name, the edit history with earlier versions and the name of each editor, chat messages with the sender's name, and project-board decisions with the reviewer's name, email and time. Space administrators can see member email addresses. If a link allows visitor comments, we set a cookie on the visitor's browser for 30 days and use a hashed form of the visitor's link token and IP address, kept only in memory, to limit abuse.

### 3.5 Web version requests

When the web version calls an AI model, your browser sends the request and your API key to our server, which forwards them to the provider you chose (only to a fixed list of supported providers) and streams the response back. We do not log or store the content of these requests or responses.

### 3.6 Butler (今日管家)

The Butler is off until you agree to the data scope it shows. With your consent, and only from the sources and apps you allow, it can read:

- **Browser pages:** the main visible text (up to 8,000 characters) of pages on sites you allow, through a browser extension the app generates. It skips private windows, sign-in and payment pages, and mail and chat sites.
- **Desktop apps:** the visible text of the foreground window of apps you allow (on Linux X11, the window title only). To help you choose, it lists the names of running apps.

It does not take screenshots, read your clipboard or browser history, or read files for this purpose. Raw records stay on your device, encrypted with the operating-system keystore, for at most 24 hours and 500 records; if the keystore is unavailable, the Butler does not collect. By default it sends redacted excerpts to the AI model you selected so it can write briefs and suggestions. If you are signed in, its derived results — signals, goals, briefs, suggested and accepted jobs, an audit trail, your feedback, and "forget" markers — sync with your account. Withdrawing consent for a source deletes its raw records; "forget" removes items on all your devices.

### 3.7 Phone remote, cloud relay and connectors

- **Phone remote** (off by default) lets a phone on your local network run tools on your computer, with a token. It does not go through our servers.
- **Cloud relay** (off by default) lets your devices pass tasks to each other through our servers; it reports your computer's name and which local AI clients are available.
- **Connector endpoints** let AI clients you authorize send tasks to your workspace. Task goals, results and images sent this way are stored until you delete them.

### 3.8 Updates and downloads

The app checks our public releases repository on GitHub for updates (about 20 seconds after launch and every 4 hours, unless you turn it off), and the download page looks up the latest release there. GitHub receives your IP address and the request under its own privacy policy.

### 3.9 Technical logs

We do not run analytics or crash reporting. Our hosting and storage providers may record standard technical logs, such as IP address, time and requested address, to operate and secure their networks.

### 3.10 Payments

We do not process payments yet. When paid plans launch, payments will be handled by a payment provider, and we will update this policy before collecting any payment information.

## 4. How we use information

We use personal information to: provide and secure your account and the Services; sync and deliver your data to your devices and to the people you share with; operate the Butler and other features you turn on; respond to you; prevent abuse; and meet legal obligations. We do not use it for advertising, we do not sell it, and we do not use your content to train AI models.

## 5. Who we share it with

- **Service providers** that host and store data for us: [Railway — hosting and database, region: Server region]; [Cloudflare — R2 object storage]; Google — sign-in. They may process information only on our instructions.
- **AI providers and other services you connect,** when you ask the app or the web version to send them a request.
- **People you share with,** as described in section 3.4.
- **Authorities,** when the law requires it, or to protect the rights, safety and property of users, the public or us.
- **A successor** if our business is merged or sold, under this policy.

## 6. Where information is stored

Our servers are located in [Server region], and object storage is provided by Cloudflare, which may store data in several countries. Information you sync may therefore be stored and processed outside Canada and outside the country where you live, and may be accessible to authorities there under local law.

## 7. How long we keep it

- Account and synced data: while your account is active; deleted within 30 days after you delete it or close your account, and from backups within a further [backup period] days.
- Files in the device relay: about 7 days. Unfinished uploads: 24 hours. Media no longer referenced: 48 hours.
- Shared items: deleting a shared item hides it from others; its edit history is kept until your account is deleted.
- Sign-in sessions: 7 days on the web; device tokens expire after 30 days. Sync devices inactive for 90 days are removed.
- Connector and relay tasks: until you delete them or your account.

## 8. Security

We use HTTPS, encrypt API keys at rest, offer end-to-end encryption for sync, hash sign-in tokens, restrict which providers the web relay can reach, and limit access to production systems. No system is perfectly secure; please use a strong Google account password and two-step verification.

## 9. Your rights and choices

In the app you can delete conversations, projects, files and saved keys, download or clear what the Butler remembered, sign devices out, and turn off sync, the Butler, the cloud relay and update checks. You can withdraw consent at any time; some features stop working without it. An in-app option to download or delete your whole account is planned; until it is available, write to admin@wickrunai.com and we will do it for you. You may also ask us to give you access to the personal information we hold about you, correct it, or delete it, by writing to admin@wickrunai.com. We will reply within 30 days. Depending on where you live, you may have further rights under local law. If you are not satisfied with our response, you can contact the Office of the Information and Privacy Commissioner for British Columbia or the Office of the Privacy Commissioner of Canada.

## 10. Children

The Services are not directed to children under 13, and we do not knowingly collect their personal information. If you believe a child has given us personal information, contact us and we will delete it.

## 11. Changes

We will post any change to this policy here with a new effective date, and notify you in the app or by email before a material change takes effect.

## 12. Contact

Privacy officer: [Name or title], [Company legal name], [Registered address] — admin@wickrunai.com
