# macOS 官网下载版：Developer ID 签名和公证

用户选择个人 Apple Developer Program 账号，Mac 通过官网下载；没有本地 Mac 或 Apple 真机，先使用 GitHub 托管 macOS runner。当前提交只准备发布链路，尚无证书、公证成功记录或真机验收。

`package.json` 继续保留 `identity: null`、`notarize: false`。只有仓库变量 `MACOS_SIGNING_ENABLED` **精确为 `true`**，Release 工作流才使用 `build/mac-signed.cjs`。开启后缺少凭据、签名、公证或验签失败都会阻断 macOS 产物上传及三平台发布，绝不退回未签名包。Windows、Linux 发布规则不变。

## 账号开通后准备一次

1. 由账号持有人完成 Apple Developer Program 注册、身份验证、付费和协议接受。个人账号使用本人法定姓名；公开证书会显示此姓名，不能把个人账号的商店销售者名称任意设成品牌。
2. 在 Apple Developer 的 Certificates, Identifiers & Profiles 创建 **Developer ID Application** 证书。它用于官网分发，不是 Apple Development、Apple Distribution 或 Developer ID Installer。生成证书请求时产生的私钥要长期安全备份；只下载 `.cer` 不包含私钥。可使用受信任的临时 Mac / Mac 云环境生成请求、下载并安装证书，再从钥匙串将证书和私钥导出为带强密码的 `.p12`。不需要购买 Mac 才能运行 CI，但证书创建与首次导出仍须由账号持有人在受控环境完成。
3. 在 App Store Connect → Users and Access → Integrations → App Store Connect API 创建 **Team API Key**（App Manager 权限），保存下载一次的 `.p8`，记下 Key ID 和 Issuer ID。本项目 electron-builder 25 路径要求带 Issuer 的团队 API key；不要混用较新 Xcode 才支持的个人 API key。若账户尚未获得 API 访问权限，先由账号持有人申请/启用。
4. 将 `.p12` 的 base64、导出密码和 `.p8` 原文分别存入下表 GitHub Actions Secrets；不要提交到 Git，也不要粘贴到聊天、日志或 issue。`.p12` 包含私钥，base64 不是加密。证书和 API key 各自在加密密码库/离线安全存储保留备份。

仓库 Settings → Secrets and variables → Actions：

| 类别 | 名称 | 内容 |
|---|---|---|
| Variable | `MACOS_SIGNING_ENABLED` | 初期留空；凭据备妥后设 `true` |
| Variable | `APPLE_TEAM_ID` | Apple 开发者账号的 10 位 Team ID |
| Variable | `MACOS_SIGNING_IDENTITY` | 证书名称，形如 `Legal Name (TEAMID1234)`；去掉 `Developer ID Application:` 前缀，末尾 Team ID 必须相同 |
| Secret | `MACOS_CERTIFICATE_P12_BASE64` | 含私钥的 `.p12` 文件 base64 |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| Secret | `MACOS_NOTARY_KEY_P8` | `.p8` 全文，保留 PEM 首尾行和换行 |
| Secret | `MACOS_NOTARY_KEY_ID` | API Key ID |
| Secret | `MACOS_NOTARY_ISSUER_ID` | Team API Key Issuer UUID |

使用 GitHub 托管的临时 runner；不在不受信任的 fork/PR 运行签名。`.p8` 只写入 `RUNNER_TEMP/wickrun-notary/AuthKey.p8`（0600），工作流结束时清理；electron-builder 管理导入证书的临时钥匙串。不要开启打印环境变量、shell trace 或公证 debug 日志。取消/强制终止可能跳过清理步骤，因此不把这一套直接移到持久的共享 runner。

## 首次验证与发布

1. 合并前可在准备分支手动运行 Release，保持 `dry_run=true`。未开签名开关时只验证原有未签名构建；开启后实际向 Apple 提交公证，但不公开 GitHub Release。
2. 查看 macOS job：构建 arm64 和 x64 的 `.app`，Developer ID 签名，向 Apple 公证并 staple，然后生成 DMG/ZIP。签名使用 Hardened Runtime 和安全时间戳。只声明 Electron 34/V8 所需的 `allow-jit`，不增加 `allow-unsigned-executable-memory`、调试权限、关闭库校验、App Sandbox 或无依据的设备权限。当前未发现摄像头/麦克风调用或必须加载未签名原生模块的代码；将来增加功能时重新审核。
3. 验证脚本重新打开两个架构的 DMG 和 ZIP，逐个验证里面的应用：深度严格签名、Developer ID 证书、Team ID、应用 ID、Hardened Runtime、时间戳、架构、stapled ticket 和 Gatekeeper。任一失败即停止。DMG 容器本身没有单独提交公证；分发的 `.app` 已签名、公证并附票据，ZIP 同样保留该票据。
4. 成功后 CI artifact 含 `mac-signing-verification.json` 和对应包的 SHA-256，可与最终安装包核对。这个记录只证明自动化分发检查，不能代替真正启动应用。必须在真实 Mac 上下载/隔离状态首次启动，测试聊天流、100 MB 文件、500 MB 任务回传、后台驻留、本机文件、MCP 子进程、远程桥接和退出；Apple Silicon 与 Intel 都要有验收记录。云 runner 无法证明使用者电脑的所有权限提示和实际交互可用。
5. 正式交付递增版本，同时同步 package.json、package-lock.json 两处和 src/lib/version.ts，使用新且不可变的标签。主分支 CI 通过后现有自动发布流程会触发；不要为试签推一个已用过的版本，也不要覆盖旧标签。发布说明根据本次产物实际状态写“未签名”或“Developer ID 签名并公证”，不能只因配置已存在就宣称完成。

当前 Windows 上可运行 `node --test tests/mac-signing.test.cjs` 验证凭据缺失、错团队、错误证书类型等拒绝逻辑。真正的 codesign、notarytool、stapler 和 Gatekeeper 必须在 macOS 和有效凭据下验收。本配置适配仓库锁定的 electron-builder 25.1.8；升级到 27 时需审查 `mac.sign` 新结构。

## 官方依据（2026-09-27 查阅）

- [Apple：创建 Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
- [Apple：分发前公证 macOS 软件](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) — Developer ID、Hardened Runtime、时间戳与 notarytool；公证是自动安全检查，不是 App Review。
- [Apple：App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)
- [Electron notarize 官方仓库](https://github.com/electron/notarize) — 现代 Electron 的 JIT 权限、团队 API key、票据验证。
- [electron-builder 25.1.8 源码](https://github.com/electron-userland/electron-builder/blob/v25.1.8/packages/app-builder-lib/src/macPackager.ts) — 本项目实际使用版本的字段及凭据选择行为。
- [electron-builder 当前公证文档](https://www.electron.build/docs/features/code-signing/notarization/) — 注意最新版 v27 字段层级与本项目不同。
