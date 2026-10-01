# iOS native bridge source templates

Copy the four Swift files in this directory into the generated Capacitor App target, add them to Compile Sources, and set the initial controller in `Main.storyboard` to `WickrunViewController` (module `App`). Do not include `tests/main.swift` in the app target. The registration and API follow the [Capacitor 7 custom code guide](https://capacitorjs.com/docs/v7/ios/custom-code).

Set Capacitor's `loggingBehavior` to `none` in every build containing real credentials. Capacitor itself can log the start of plugin return values, including secret reads, even though these plugins do not log them.

- `SncHttp` implements the existing renderer `request`, `abort`, and `sncHttpEvent` contract. HTTPS is required, TLS validation remains system-managed, and redirects are refused so credentials cannot follow a redirect. No ATS exception or background execution entitlement is required. Stream bytes are incrementally decoded; the renderer still parses SSE. Idle and total resource timeouts are bounded to the requested timeout (1 second–30 minutes). Nonstream/error text bodies have a 32 MiB limit; this does not change the separate 100 MiB artifact transfer limit.
- `WickrunSecrets` exposes `get({key}) -> {value: string | null}`, `set({key,value})`, and `remove({key})`. It stores credentials in the app's Keychain service using `WhenUnlockedThisDeviceOnly`, without iCloud synchronization or a plaintext fallback. Credentials are unavailable while the device is locked. A missing key returns null; a Keychain failure rejects. The renderer must migrate old `Preferences` secrets only after a successful secure write, and delete the old copy afterward.
- All mutable network state and delegate callbacks use the main dispatch queue. URLSession performs network I/O asynchronously. Each request resolves/rejects once, and invalidates its ephemeral session when complete or cancelled. API credentials, URLs, and response content are never logged.

Run the independent Unicode decoder regression on macOS before compiling the Xcode target:

```sh
swiftc native/ios/SncUTF8Decoder.swift native/ios/tests/main.swift -o /tmp/wickrun-utf8-tests
/tmp/wickrun-utf8-tests
```

These sources were prepared on Windows, where Xcode and the Swift compiler are unavailable. A simulator build must still validate Capacitor registration and compilation. A physical iPhone and iPad must then validate model streaming (including Chinese/emoji), stopping before/after response headers, timeout/error handling, save/relaunch/remove credentials, lock/unlock behavior, and foreground/background interruption. The app does not promise long-running chat or schedule execution while suspended. This bridge does not implement mobile account sign-in, file sharing, or remote desktop tools.
