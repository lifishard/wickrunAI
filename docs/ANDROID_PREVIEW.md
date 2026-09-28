# Android 预览版 / Android preview

这是公开测试 APK，可安装到 Android 手机和平板。尚未完成真机验收，不作为正式稳定版发布。

2.20.13 更新：采用用户选定的 C 版手机布局，建议改为简洁列表，点选后填入草稿；底部输入区约 113px 高，模型、Chat/Work 下拉选择、三点菜单和圆形发送按钮合并为一行；顶部菜单使用图标列表与紧凑语言选择。手机键盘回车换行，点击发送按钮发送。没有远程电脑能力时不显示代码改动入口。

已完成浏览器手机尺寸布局与交互检查及自动测试；POCO F5 真机、系统返回手势、系统键盘与横竖屏切换仍待复测。

- 下载 `wickrunAI-版本-android-preview.apk` 即可，不需要下载源码或 GitHub Actions ZIP。
- 支持基础对话、流式响应、文件输入和设备内 API Key 安全存储。
- 原生账号同步和大型任务文件导出尚未完成；聊天和设置仅保存在本机。
- 本包使用测试签名。后续预览版或正式版可能使用不同签名，无法直接覆盖安装；卸载前先备份需要保留的数据。
- `SHA256SUMS.txt` 提供 APK 校验和，`SIGNATURE.txt` 记录测试签名验证结果。
- 此预发布版不替换桌面稳定版，不进入桌面自动更新渠道。

This APK is an Android engineering preview for phones and tablets, not a stable release. Physical-device acceptance is pending. Native account sync and large task-file export are unavailable. It uses a debug signing key; later builds may require uninstalling this preview, so back up data first. Checksums and signature verification are included. Desktop stable releases and automatic updates are unaffected.
