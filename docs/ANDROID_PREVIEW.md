# Android 预览版 / Android preview

这是公开测试 APK，可安装到 Android 手机和平板。尚未完成真机验收，不作为正式稳定版发布。

2.20.23 更新：跟进桌面 2.20.23。协作空间的阶段预算卡住时，上限卡片会指出该调“本次运行总 tokens”还是成员每步上限。

2.20.22 更新：跟进桌面 2.20.22。协作空间里已停止的运行可以重新打开，从停下的地方接着跑，已完成的步骤不重跑；时间上限只计实际执行时间；只读前置记录的步骤不再因为运行目标里的“修改”要求被卡住。

2.20.21 更新：跟进桌面 2.20.21 的共享代码，包括协作空间在运行中调高上限并从检查点接着跑、长记录作为文档分段读取、换模型修复入口和调用额度自动退避。依赖电脑本机能力的工具（本机文件、命令行、屏幕控制）在手机上不提供。

2.20.14 更新：Android 新增 Google 登录、浏览器授权后返回 App、按账号隔离的本地存储及云同步。顶部只有一个登录／账号入口。未登录时的内容保留，可主动导入；退出后返回原本机工作区。保留 C 版手机布局。

已完成浏览器手机尺寸布局与交互检查及自动测试；POCO F5 真机、系统返回手势、系统键盘与横竖屏切换仍待复测。

- 下载 `wickrunAI-版本-android-preview.apk` 即可，不需要下载源码或 GitHub Actions ZIP。
- 支持基础对话、流式响应、文件输入和设备内 API Key 安全存储。
- Google 登录后可同步聊天、项目、技能、任务记录及模型配置；API 密钥通过独立加密通道保存。大型任务文件导出仍未完成。
- 本包使用测试签名。后续预览版或正式版可能使用不同签名，无法直接覆盖安装；卸载前先备份需要保留的数据。
- `SHA256SUMS.txt` 提供 APK 校验和，`SIGNATURE.txt` 记录测试签名验证结果。
- 此预发布版不替换桌面稳定版，不进入桌面自动更新渠道。

This APK is an Android engineering preview for phones and tablets, not a stable release. Version 2.20.23 brings the shared code up to desktop 2.20.23, including reopening a stopped team run and clearer segment budget fixes. Tools that need the computer itself (local files, command line, screen control) are not offered on the phone. Physical-device acceptance is pending. Google sign-in, browser return and account-isolated cloud sync are connected. Real Google authorization on a physical Android device is still pending acceptance. Large task-file export remains unavailable. It uses a debug signing key; later builds may require uninstalling this preview, so back up data first. Checksums and signature verification are included. Desktop stable releases and automatic updates are unaffected.
