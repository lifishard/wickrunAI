# Apple 与 Android 发布准备

更新：2026-09-27。**本轮交付是工程预览和发布准备，不是已经完成签名、真机验收或商店审核的正式移动版。** 本文中的检查框和记录模板须根据实际构建与测试填写，不能因脚本存在而标记通过。

已选路线：个人 Apple Developer Program；Mac 官网下载 DMG/ZIP；iPhone/iPad 直接提交 App Store；Android 先提供 APK。用户将借朋友的 Mac 和 iPad 测试，已有 OPPO Pad 2；iPhone 真机尚未安排。TestFlight 可选，不是直接提交 App Store 的前置条件。[Apple 发布流程](https://help.apple.com/xcode/mac/current/en.lproj/dev067853c94.html)

## 先看目前还缺什么

| 环节 | 当前状态 | 进入下一步的条件 |
| --- | --- | --- |
| Apple 个人会员 | 点击 Enroll 后立即显示未知错误；双重认证已确认开启 | 解决注册错误、完成本人核验/付款/协议、会员激活 |
| Mac 官网正式签名 | 已准备独立签名配置及 CI 验证路径 | 按 [MACOS_SIGNING.md](MACOS_SIGNING.md) 配置凭据，实际签名、公证、验包并在 Mac 安装 |
| iPhone/iPad | macOS CI 已成功编译未签名模拟器应用 | 签名归档；设备验收；补齐下列移动功能和审核材料后再提交 |
| Android APK | CI 已成功生成并验证 debug APK | release 使用长期密钥；OPPO Pad 2 验收 |
| 原生账号同步 | 当前明确为“仅存本机” | 完成移动端认证与同步实现并验收，或重新明确首版产品范围 |
| 原生文件回传/导出 | 大型任务产物的原生接收、保存和导出尚未完成 | 完成 Android/iOS 系统文件保存及分享流程，验证大小、数量、恢复与错误处理 |
| 真机记录 | 本文不声明任何设备已通过 | 按文末模板记录设备、安装包、结果与证据 |

签名证明发布者身份；macOS 公证是自动安全检查；App Store 审核评估应用及材料。三者不能互相替代。Electron 只用于现有桌面版本，iPhone/iPad 使用独立 Capacitor iOS 工程。[Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Capacitor 平台要求](https://capacitorjs.com/docs/v7/getting-started/environment-setup)

### 已验证的构建记录

- Android：提交 `fb2e261` 的[构建记录](https://github.com/lifishard/wickrunAI/actions/runs/36360598119)已通过完整测试、APK 编译、debug 签名验证和上传；[测试包 artifact](https://github.com/lifishard/wickrunAI/actions/runs/36360598119/artifacts/10945228724)内含 APK 和校验和。
- iOS：提交 `4365ed1` 的[构建记录](https://github.com/lifishard/wickrunAI/actions/runs/36361316699)已通过签名规则测试、Swift UTF-8 边界测试和 Xcode 模拟器编译；[模拟器 artifact](https://github.com/lifishard/wickrunAI/actions/runs/36361316699/artifacts/10945921254)用于 Mac 上的 iOS Simulator，不能直接安装到 iPad。
- 两次早期 iOS CI 分别发现并推动修复了分块 BOM 字符丢失和读取 Xcode 版本时的管道异常。成功编译不代表已在模拟器启动验收、完成真机测试或生成正式签名安装包。
- GitHub Actions artifact 需要有权访问的 GitHub 会话，保留期为 14 天。上述记录引用具体提交，不自动代表后续提交也已通过。

## Apple 注册：处理当前的 Enroll 错误

已确认双重认证开启，不要把“重新开启双重认证”当作唯一解决方案。未知错误无法仅凭提示定位原因，也不能归因于 wickrunAI 代码。

1. 由本人在干净的浏览器会话中登录 [Apple Developer 注册入口](https://developer.apple.com/programs/enroll/)，保持真实账户信息，重试一次；记录发生时间、浏览器、地区、准确错误原文与已去除个人资料的截图。
2. 网页仍报错时，在支持的 Apple 设备上尝试官方 Apple Developer app 的 Account → Enroll Now。借用设备时使用自己的账号并按 Apple 的身份验证要求操作；不要使用朋友的开发者身份代办，也不要留下账号或支付信息。[官方 app 注册说明](https://developer.apple.com/help/account/membership/enrolling-in-the-app/)
3. 两个入口都失败，进入 [Apple Developer Support](https://developer.apple.com/support/) 的会员/账户支持，说明“个人申请、双重认证已开启、点击 Enroll 即出现未知错误”，附上上述复现信息。若已有支持案例号，继续同一案例；不要在未确认原订单状态前重复付款。
4. 会员获准后，由本人完成条款与付款，再配置签名。注册、证件核验、付款与协议接受均由账号持有人完成。

个人会员的 App Store 销售者名称是本人法定姓名，不能直接替换为 wickrunAI。标准年费为 99 美元，实际币种、地区价格及税费以结账页为准。组织会员需要真实法人实体、相应权限，通常还需 D‑U‑N‑S；本次不走组织或企业内部分发路线。[Apple 注册要求](https://developer.apple.com/help/account/membership/program-enrollment/)

## 工程入口与构建环境

以下命令在本桌面仓库根目录执行。工程生成脚本读取 `package.json` 版本，将 Web 资源同步到原生工程，再安装本仓库维护的原生插件与配置；不要只运行裸 `cap sync` 后省略本项目配置步骤。

```sh
npm run mobile:prepare -- android
npm run mobile:prepare -- ios
```

- 通用：Node 20+，仓库依赖与锁文件一致。`build:mobile` 只执行类型检查和 Web 构建，不运行桌面原生 MCP 打包。
- Android：JDK 21、Android SDK、构建工具和已接受的 SDK 条款；Windows 可通过 Android Studio 配置。当前生成工程 `minSdkVersion=23`、`compileSdkVersion=35`、`targetSdkVersion=35`。
- iOS：在 Mac 或 GitHub 托管 macOS runner 上运行，安装匹配的 Xcode、命令行工具与 CocoaPods。当前配置最低部署目标为 iOS 15。
- 当前移动 application ID 为 `dev.anyai.app`，Mac 桌面 ID 为 `dev.anyai.desktop`。会员激活后确认移动 App ID 可以注册且归此团队；如需调整，应在首次商店记录和正式安装分发之前统一修改工程配置、签名配置及相关文档。
- `wickrun-web/node_modules` 是指向桌面仓库的 junction：不要在 Web 仓库运行依赖安装或 prune。借用 Mac 时使用独立、可重复的桌面仓库 checkout，不复制 Windows 的 junction。

当前 App Store 上传要求自 2026-04-28 起为 Xcode 26+ 和 iOS/iPadOS 26 SDK+；自 2026-09-09 起最低部署目标至少 iOS 13。Capacitor 7 的框架最低要求 Xcode 16 不等于当前商店要求。SDK 版本也不等于用户设备最低系统版本。[Apple 当前要求](https://developer.apple.com/news/upcoming-requirements/)、[Xcode 兼容表](https://developer.apple.com/xcode/system-requirements)

## Mac 官网安装包

证书类型、仓库开关、精确 Secrets 名称、验证产物与操作顺序以 [MACOS_SIGNING.md](MACOS_SIGNING.md) 为准，不在本文维护第二份凭据清单。

1. Apple 会员激活后，准备 Developer ID Application 证书及对应私钥、公证认证。Developer ID Installer 只在将来发布 `.pkg` 安装器时考虑；Apple Development 不能替代官网发布签名。
2. 按专门文档运行不公开 Release 的首次签名构建，检查两个架构的 DMG/ZIP 及签名报告。开启正式签名开关后，缺少凭据或公证失败应阻断发布。
3. 借朋友的 Mac，从实际下载地址安装最终包，记录芯片、系统版本和文件 SHA-256；核验首次启动、流式聊天、文件、桌面 MCP、后台驻留、重启与退出。一个架构的验收不能自动覆盖另一架构。
4. 使用新版本和新标签发布。配置存在、CI 跑过未签名包或只得到公证成功，都不能写成“真实 Mac 已验收”。

## iPhone/iPad：开发测试后直接提交 App Store

证书、profile、CI 凭据与导出方式以 [IOS_SIGNING.md](IOS_SIGNING.md) 为准。借来的 Mac/iPad 是当前可执行的测试路径，GitHub macOS runner 用于可重复构建。

1. 在借用 Mac 上准备工程后运行 `npm run cap:open:ios`，确认自己的 Team、Bundle ID 和签名设置。通过 Xcode 的开发签名安装到 iPad；如果远程交付测试包，可注册设备并使用相应 Ad Hoc profile。
2. **App Store 导出的 IPA 不能当作开发或 Ad Hoc 包直接侧载。** 也可选择 TestFlight 方便远程测试，但不是必须。TestFlight build 最多测试 90 天，首次外部测试需要 Beta App Review；通过该审核不等于 App Store 正式审核通过。[Apple 测试渠道](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)、[TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
3. 补齐 iPhone 真机。记录 iPad 的横竖屏、分屏、软键盘、安全区、文件选择和流式恢复；iPad 和模拟器检查不能写成 iPhone 真机检查。
4. 完成功能与设备验收后，使用 Apple Distribution 和匹配的 App Store profile（或受支持的自动签名）构建 archive，上传到 App Store Connect；先创建 app 记录并处理账号协议。[创建记录](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app)、[App Store profile](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile)
5. 填好支持/隐私链接、截图、年龄分级、出口合规和审核说明，给审核人员可实际使用的受限测试账号或凭据，提交 App Review。可以选择审核后手动发布；不要承诺通过时间或结果。

仓库 `iOS build` 工作流默认生成未签名的模拟器产物。账号与保护环境配置好后，手动选择 `app-store` 才归档并导出 IPA；当前工作流**不自动上传、提交审核或发布**。成功后按 [IOS_SIGNING.md](IOS_SIGNING.md) 获取签名报告，由受信任 Mac 上的 Xcode Organizer 或 Transporter 继续上传。模拟器 ZIP 只用于 Mac 上匹配的 iOS Simulator。

## Android：先在 OPPO Pad 2 验证

```sh
# 工程预览 APK，使用 debug 签名
npm run android:apk

# 长期正式密钥已通过环境变量配置后
npm run android:release

# 可选 AAB 格式构建，不代表已满足 Play 上架要求
npm run android:aab
```

输出分别在 `android/app/build/outputs/apk/debug/`、`android/app/build/outputs/apk/release/`、`android/app/build/outputs/bundle/release/`。根据实际构建结果取包；没有文件或命令失败时不得把工程目录当成已交付 APK。

`android:release` 和 `android:aab` 必须取得以下环境变量，缺失时会失败，不会退回 debug 签名：

| 名称 | 配置方式 |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | 指向仓库之外、确实存在的长期 release keystore 绝对路径 |
| `ANDROID_KEYSTORE_PASSWORD` | 从本地密码库或 GitHub Actions Secrets 注入，不写入脚本 |
| `ANDROID_KEY_ALIAS` | keystore 中正式签名 key 的 alias |
| `ANDROID_KEY_PASSWORD` | 从安全存储注入该 key 的密码 |

使用 GitHub Actions 时，在仓库先创建并保护 `android-release` Environment，仅允许受信任的发布分支；按实际权限设置审核规则后再放正式密钥。环境 Secrets 使用 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`，Variable `ANDROID_SIGNING_CERT_SHA256` 保存预期公开证书 SHA-256 指纹。工作流将 keystore 临时还原到 `ANDROID_KEYSTORE_PATH`，构建后检查证书指纹；base64 只是编码，不是加密。

在 Actions → **Android APK** 手动选择 `debug` 或 `release`。成功后下载 `android-debug-<commit>` 或 `android-release-<commit>` artifact；内含 APK 和 `SHA256SUMS.txt`，release 还含公开签名指纹。产物保留 14 天，需将正式候选包保存在受控位置。该工作流不自动创建 GitHub Release，也不上传 Google Play；CI 产物不能表述成已经公开发布。

正式签名无需购买第三方证书。妥善备份 keystore 及密码；直发 APK 丢失原签名私钥可能导致无法覆盖升级。校验最终包的 `apksigner verify --verbose --print-certs` 结果，记录公开证书指纹和 APK SHA-256。在 OPPO Pad 2 先测 debug，再对真正要分发的 release 包做首装和覆盖升级。debug 与 release 签名不同，不能把两者互相覆盖失败直接当成应用升级缺陷；清理测试数据前先备份。[Android 签名](https://developer.android.com/studio/publish/app-signing)

本次 `android:aab` 仅准备格式和签名路径：当前 target API 35 **不满足** 2026-08-31 起普通手机/平板新应用及更新的 Google Play API 36+ 要求。后续 Play 路线还需升级并验证目标 SDK、配置 Play App Signing 和商店资料；新个人 Play 账号通常有 12 名测试者连续 14 天的封闭测试要求。AAB 也不是给用户直接点击安装的 APK。[Play API 要求](https://support.google.com/googleplay/android-developer/answer/11926878)、[AAB](https://developer.android.com/guide/app-bundle)、[个人账号测试](https://support.google.com/googleplay/android-developer/answer/14151465)

Android 开发者身份验证与签名是两件事。当前官方时间表：2026-09-30 在巴西、印尼、新加坡、泰国先覆盖参与应用商店的安装；2027 年向全球认证设备上的所有 app 扩展。仅在 Play 外分发者应准备 Android Developer Console 身份/应用注册，具体路径以控制台为准。不要沿用旧公告宣称所有地区的网站 APK 已立即禁止侧载。[当前官方指南](https://developer.android.com/developer-verification/guides)

## 移动端必须补齐或明确的能力

- **账号与数据**：原生应用当前显示“仅存本机”；网页版可登录同步，但 Web 与原生本地数据分别保存。该提示避免无效登录，并未实现原生同步。跨设备账号同步仍是既定产品目标中的未完成项。
- **文件输入**：附件入口与桌面工作目录权限分开；支持的文本/代码与图片类型仍按共享附件限制校验。文本 25 MB、图片 20 MB、单轮附件合计 100 MB，与任务产物回传的限制不是同一套规则。
- **文件输出**：既有桌面/网页回传能力为 100 MB/文件、500 MB/任务、50 文件。本轮不降低这些规则，但不能据此声称原生应用已有同等文件接收、断点恢复、保存和导出能力。该流程完成后才能在移动端宣传同等交付支持。
- **工具边界**：移动端不运行 Electron、桌面浏览器自动化、本机 shell 或 Node/stdio MCP 子进程；不访问整台设备文件系统。若提供远程 MCP/桌面桥接，需另测 HTTPS、鉴权、断线和用户授权，页面文案与可用能力一致。
- **后台**：流式连接切到后台或锁屏可能被系统中断。应保留已有消息并给出可恢复状态，不能承诺无限后台运行；不得借无关音频/定位模式维持连接。
- **隐私与审核**：说明哪些聊天/文件会发给哪个模型提供商或远程工具，在向第三方 AI 共享个人数据前取得明确许可。自带 API key 不自动豁免这项要求；审核人员需能完整体验功能。涉及收费或外部购买入口时按实际商业模式再检查商店规则。[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- **隐私清单**：本仓库维护 `native/ios/PrivacyInfo.xcprivacy`，准备脚本将其加入原生工程。Preferences 使用 UserDefaults 时的 `CA92.1` 等理由须与实际用途相符；清单不能代替隐私政策或 App Store Connect 的 App Privacy 填报。[Capacitor Preferences](https://capacitorjs.com/docs/v7/apis/preferences)、[App Privacy](https://developer.apple.com/app-store/app-privacy-details/)

## 设备验收记录模板

每个安装包、架构和设备复制一份记录。结果填“通过 / 失败 / 未测 / 不适用”，失败要留复现步骤；不适用要写明原因。桌面浏览器模拟、云 runner 和模拟器结果分别记录，不归入真机列。

```text
测试日期与人员：
Git commit / 产品版本 / 平台 build number：
设备型号 / CPU 架构 / 系统版本：
安装来源与包文件名：
包 SHA-256 / 公开签名指纹或 Apple Team ID：
签名方式：debug / Development / Ad Hoc / Developer ID / App Store
证据位置（去除账号、密钥及私人文件）：
结论与阻塞项：
```

| 场景 | 操作及应观察的结果 | 结果 / 证据 |
| --- | --- | --- |
| 首次安装与启动 | 从实际渠道安装；权限/安全提示符合预期；无崩溃或白屏 | 未测 |
| 同签名升级 | 从上一测试版本覆盖安装；聊天和设置可读；版本变新 | 未测 |
| 流式模型请求 | 可用测试 key 发请求，逐段显示；取消停止；错误可理解 | 未测 |
| 密钥保存 | 重启后按设计可用；退出/删除行为明确；日志与导出不包含密钥 | 未测 |
| 文件选择 | 文本/代码与支持的图片加入对话；取消、拒绝权限、超限不损坏已有附件 | 未测 |
| 文件回传与保存 | 将支持的任务结果保存到系统 Files/下载目录或分享目标，并能重新打开 | 未测；原生功能待完成 |
| 大型产物 | 按实际支持范围覆盖 100 MB 单文件、500 MB 单任务、50 文件及超限边界；检查断线恢复 | 未测；原生流程待完成 |
| 账号同步 | 两台设备、token 过期、冲突、退出及删除流程；本地数据不误归另一账号 | 未测；原生同步待完成 |
| 断网与后台 | 请求中断网、锁屏、切应用再返回；已有内容保留，恢复/重试状态准确 | 未测 |
| 平板交互 | iPad/OPPO 横竖屏、分屏、键盘、滚动、弹窗、返回手势无阻断 | 未测 |
| iPhone 交互 | 小屏真实设备的键盘、安全区、图片/文件、分享和恢复 | 未测；设备待安排 |
| Mac 专属工具 | 按声明范围测试文件、MCP、桌面工具与权限提示 | 未测；移动端不适用 |
| 审核资料一致 | 页面、截图、隐私政策、数据路径和实际功能一致；审核测试凭据可用 | 未测 |

## 放行条件与版本纪律

1. **工程预览**：允许交付明确标记的构建及未测项，用于开发与受控验收；不得标为 App Store 正式可用。
2. **签名候选包**：账号、证书/profile/keystore 均可用；所选渠道的签名校验通过；凭据不出现在 Git、日志或附件中。Apple 精确配置按两个专门签名文档执行。
3. **正式分发**：阻断性功能与设备问题关闭；上表具有可追溯记录；渠道要求及隐私资料齐备。App Store 还须通过 Apple 审核，不能用 TestFlight 或 Mac 公证结果代替。

版本由 `package.json` 统一驱动原生配置：Android `versionCode = major × 1000000 + minor × 1000 + patch`；iOS marketing/build version 同步产品版本。每次交付递增版本并同步 `package.json`、`package-lock.json` 两处与 `src/lib/version.ts`，不要覆盖已有 release tag。同一个已上传 build 需要修复时使用新版本/编号，而不是替换旧产物。

合并到主分支可能在现有 CI 成功后自动创建新标签并发布桌面三平台安装包。工程预览期间先在准备分支执行构建与验证，确认签名开关、发布说明和产物状态后再走正式流程。Android/iOS 的专门工作流提供构建产物；以真实执行记录确认状态，不能将桌面自动发布成功视为移动端已发布。
