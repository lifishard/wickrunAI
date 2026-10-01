# Android 预览版 / Android preview

这是公开测试 APK，可安装到 Android 手机和平板。尚未完成真机验收，不作为正式稳定版发布。

4.0.0 更新：加入共享与协作空间，可通过粘贴 `https://wickrunai.com/share#…` 链接在手机内打开共享内容；支持权限控制下的评论、协作群聊、项目与对话副本，以及把已收到的交接打开成未发送草稿。共享流程在手机上复制为私有、可编辑但不自动执行的流程；本机执行仍需桌面版。管家会话、派生会话及其执行记录不会进入共享空间。APK 与桌面安装包放在同一个 `v4.0.0` Release 中，下载页的 Android 入口指向该 APK；若缺少 APK，发布检查会阻止公开 Release。

**从已发布的 3.0.0 Android 预览版升级：先备份，再自行卸载旧版、安装 4.0.0。** 4.0.0 沿用原应用标识，但签名证书不同，无法直接覆盖安装。卸载旧版会删除未备份的手机本机数据；请在确认备份可用后再操作。云端已同步的数据按登录账号保留，但不要把未同步的内容视为已备份。

3.0.0 更新：与四平台版本统一。加入需单独授权的「今日管家」：可选择允许和拒绝的应用，设置排除、脱敏与仅加密保留规则；活动原文由 Android Keystore 加密保存在本机。电池优化设置只会打开系统授权页面，不会绕过系统限制。手机可查看和补充管家需求，持续分析与自动 Work 仍由选定的常开电脑执行。可导入有文字层的 PDF、Office 文档和常见文本文件；扫描 PDF 与旧版 PPT 需先转换。

2.20.26 更新：跟进桌面 2.20.26。暂停在后台回复完成或新对话建立期间仍然有效；回答、代码和工具输出增加随手可见的复制入口，代码复制保留原始空格、制表符与换行；支持独立的成品文本和可选追问卡片。

2.20.25 更新：跟进桌面 2.20.25。看图能力按实测判断，不再只凭模型列表的登记拦下图片；检测时一并确认这条路由认哪种图片写法。

2.20.24 更新：跟进桌面 2.20.24。第一次用某个模型时的请求格式检测撞上 TPM/RPM 限流，会等待后重试，不再直接停下。

2.20.23 更新：跟进桌面 2.20.23。协作空间的阶段预算卡住时，上限卡片会指出该调“本次运行总 tokens”还是成员每步上限。

2.20.22 更新：跟进桌面 2.20.22。协作空间里已停止的运行可以重新打开，从停下的地方接着跑，已完成的步骤不重跑；时间上限只计实际执行时间；只读前置记录的步骤不再因为运行目标里的“修改”要求被卡住。

2.20.21 更新：跟进桌面 2.20.21 的共享代码，包括协作空间在运行中调高上限并从检查点接着跑、长记录作为文档分段读取、换模型修复入口和调用额度自动退避。依赖电脑本机能力的工具（本机文件、命令行、屏幕控制）在手机上不提供。

2.20.14 更新：Android 新增 Google 登录、浏览器授权后返回 App、按账号隔离的本地存储及云同步。顶部只有一个登录／账号入口。未登录时的内容保留，可主动导入；退出后返回原本机工作区。保留 C 版手机布局。

已完成浏览器手机尺寸布局与交互检查及自动测试；POCO F5 真机、系统返回手势、系统键盘与横竖屏切换仍待复测。

- 下载 `wickrunAI-版本-android-preview.apk` 即可，不需要下载源码或 GitHub Actions ZIP。
- 支持基础对话、流式响应、文件输入和设备内 API Key 安全存储。
- Google 登录后可同步聊天、项目、技能、任务记录及模型配置；API 密钥通过独立加密通道保存。大型任务文件导出仍未完成。
- 4.0.0 使用固定的测试签名；后续 4.x 预览版发布前必须核对同一证书，签名不符则停止发布，不会让用户再次卸载升级。
- `SHA256SUMS.txt` 提供 APK 校验和，`SIGNATURE.txt` 记录测试签名验证结果。
- 此预发布版不替换桌面稳定版，不进入桌面自动更新渠道。

This 4.0.0 APK is an Android engineering preview for phones and tablets, not a stable release. Before moving from the published 3.0.0 preview, back up your phone data, uninstall the old app yourself, and install 4.0.0. The app ID is unchanged but the signing certificate differs, so Android cannot update it in place; unbacked-up local data is deleted on uninstall. It adds shared spaces, link opening by pasting a share URL, collaborative comments and chat, safe local copies, and handoff drafts. Shared workflows remain private and inert on the phone; local execution requires the desktop app. It retains the opt-in assistant, per-app privacy choices, and Android Keystore encryption for captured source text. Continuous analysis and automatic Work run on a selected always-on computer, while the phone can review and add needs. Physical-device acceptance remains pending. Google sign-in, browser return and account-isolated cloud sync are connected. The 4.0.0 preview uses a fixed signing certificate; future 4.x previews must match it or publishing stops. The matching APK, checksum, and signature verification are attached to the same versioned release as desktop packages.
