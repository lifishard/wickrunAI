# iPhone / iPad 的 App Store 构建准备

目标是个人开发者账号的 App Store 发布。用户当前没有 Mac、iPhone 或 iPad；本仓库使用 GitHub 托管 Mac 构建原生 Capacitor 工程。Electron 桌面工程不能直接打包 iOS。当前流程只构建并导出产物，不自动上传、提交审核或发布，也没有完成真机验收。

## 没有签名凭据也能先验证

推送 `feat/apple-mobile-release-2209`、`main` 或打开 PR 会运行 `iOS build` 的模拟器构建：Node 22、`macos-26`、`npm run mobile:prepare -- ios`、Xcode 编译。PR 不接触签名 secrets。手动运行的默认选项也是 `simulator`。

成功后下载 `ios-simulator-<run number>`。其中 `.app` ZIP 只能放入匹配的 Mac iOS Simulator，不能安装到实体 iPhone/iPad。此步骤证明原生项目可编译，不等于真机运行、App Store 兼容性或审核通过。

GitHub 官方将 `macos-26` 映射到 ARM64 托管 runner；脚本会再次要求 Xcode 26+ 和 iOS 26+ SDK，避免镜像变化带来旧 SDK 上传问题。Capacitor 7 原模板最低 iOS 14，而当前 Xcode 26 的官方部署范围从 iOS 15 开始；项目及 CI 采用 **iOS/iPadOS 15+**。SDK 26 不代表应用只能在 iOS 26 设备上使用。

## 账号开通后的签名材料

1. 用户本人完成 Apple Developer Program 注册、身份验证、付费及条款接受。个人账号的商店销售者名称为本人法定姓名。
2. 在 Apple Developer 创建明确的 App ID `dev.anyai.app`，创建 **Apple Distribution** 证书。保留生成证书请求时的私钥，将证书和私钥一起导出为带强密码的 `.p12`。macOS 官网版的 Developer ID Application 证书不能用于这一步。
3. 为 `dev.anyai.app` 创建 **App Store Connect** 分发 provisioning profile，选中同一团队、同一证书，下载 `.mobileprovision`。不选 Development、Ad Hoc 或 Enterprise，也不使用通配符 App ID。
4. 在 App Store Connect 创建对应 iOS 应用记录。显示名称可以是品牌，但必须确认名称可用、Bundle ID 一致。App Store 元数据、年龄分级、隐私政策、App Privacy、截图、支持地址、审核演示账号/说明和出口合规问卷都需要如实补全，签名成功不会替代这些项目。

在 GitHub 仓库 Settings → Environments **先创建并保护 `apple-app-store` 环境**：只允许 `main` 和当前准备分支，按团队实际权限设置人工审核/部署保护。YAML 中写环境名不会自动创建审核规则；规则配置前不要存放正式凭据。准备分支合并后移除它的分发权限。工作流没有任意 `ref` 输入，只构建当前触发提交；正式归档只接受这两个分支的手动运行。

将以下值保存在该环境的 Variables / Secrets：

| 类型 | 名称 | 内容 |
|---|---|---|
| Variable | `APPLE_TEAM_ID` | 10 位 Apple Team ID |
| Secret | `IOS_DISTRIBUTION_P12_BASE64` | 包含私钥的 Apple Distribution `.p12` 的 base64 |
| Secret | `IOS_DISTRIBUTION_P12_PASSWORD` | `.p12` 的导出密码 |
| Secret | `IOS_PROVISION_PROFILE_BASE64` | 对应 App Store Connect `.mobileprovision` 的 base64 |

证书和长期私钥保存在加密密码库或安全离线备份，不能提交 Git 或粘贴进聊天。base64 只是编码。工作流只在临时 runner 上创建钥匙串和 profile，检查过期、团队、精确 Bundle ID、App Store 类型和证书匹配后才签名；结束时恢复工程并清理凭据。强制取消可能跳过脚本清理，所以本方案限定 GitHub 托管的可销毁 runner，不直接用于共享持久 Mac。

## 手动归档与后续上传

在 Actions → iOS build → Run workflow，选择受信任的分支和 `app-store`。模拟器编译先通过，然后受保护环境批准后运行归档。只有 App target 配置签名，避免把 provisioning profile 错加到 CocoaPods 的框架目标。

归档完成后，`ios-app-store-<run number>` 包含 `.ipa`、`.xcarchive` ZIP 和 `ios-signing-verification.json`。导出使用 `app-store-connect`，校验导出应用的签名、团队、Bundle ID 和版本；不向 Apple 上传。版本来自已提交的工程与 package.json，CI 不自动增加 build number。下一次交付/上传应使用递增的应用版本和 build number，现有 release tag 不移动。

**App Store IPA 不能发给朋友直接安装。** 后续由维护者在受信任的 Mac 通过 Xcode Organizer 或 Transporter 上传到 App Store Connect，再完成处理、审核和发布。此处的 archive 不是“可随意侧载安装包”。如果上传前需要分发测试，可以单独使用 TestFlight；TestFlight 也不等于正式 App Review。

## 借朋友的 iPad 验收

可在受信任且装有 Xcode 26+ 的 Mac 上拉取同一提交，运行 `npm ci` 和 `npm run mobile:prepare -- ios`，打开 `ios/App/App.xcworkspace`。为本地 Debug 选择自己的开发者团队、Automatic Signing 和连接的 iPad，使用 **Apple Development** 与包含该设备的开发 profile；设备按提示信任 Mac，并开启 Developer Mode，然后由 Xcode Build and Run。不要把 CI 的手动 App Store profile用于这次安装，也不要在不受信任的朋友电脑上长期保留账号或私钥。

至少记录 iPad 型号、系统版本、应用版本/build number，并实测：横竖屏/分屏、软键盘遮挡、导入文件、100 MB 文件和 500 MB 任务限额、文件保存/分享、账号同步、前后台切换后的流式请求、断网恢复和远程桌面工具连接。iOS 不能直接运行 Electron、本地 shell 或桌面 MCP 子进程；相关能力需要已授权且在线的桌面桥接。后台挂起限制必须在真机确认。没有这份记录时，发布说明继续明确“未完成真机验收”。

## 官方依据（2026-09-27）

- [GitHub runner 镜像与标签](https://github.com/actions/runner-images/blob/main/README.md)
- [GitHub：Mac runner 上安装 Apple 证书](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
- [Apple：App Store SDK 最低要求](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
- [Apple：Xcode 系统和部署目标支持](https://developer.apple.com/xcode/system-requirements)
- [Apple：命令行 Archive / Export](https://developer.apple.com/library/archive/technotes/tn2339/_index.html)
- [Apple：开发 provisioning profile](https://developer.apple.com/help/account/provisioning-profiles/create-a-development-provisioning-profile)
- [Apple：向注册设备分发](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices)
- [Apple DTS：Xcode 当前 profile 缓存目录](https://developer.apple.com/forums/thread/812538)
