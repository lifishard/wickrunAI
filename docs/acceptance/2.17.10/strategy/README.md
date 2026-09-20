# 三策略真实免费模型小样本对照

时间：2026-09-20。运行使用隔离保存的 2.17.9 生产引擎快照；主仓随后升到 2.17.10，新增界面/回答入口不改变本试验经过的三条策略运行路径，因此没有为版本号重发供应商请求。核心源码哈希见 `source-manifest.json`。输入仅为仓库现有的 `latest-revision-v1` 合成 CSV 题。固定路由为 SenseNova `deepseek-v4-flash`；运行前探测与全部六次正式请求均为 HTTP 200。没有启用自动接力，也没有使用付费路由。

三个策略均使用生产 `TeamRuntime` 与 `runAgent`，固定同一模型、60,000 token 工作流上限和 20,000 token 成员阶段上限。Electron IPC 的字节搬运在无界面脚本中替换为进程内 fetch；模型请求体、系统提示、预算闸门、讨论、文本复核、持久化与完成状态均走生产实现。

| 策略 | 客观答案 | 误报完成 | 请求 | 实报 tokens | 墙钟时间 | 相对单助手 tokens | 相对单助手时间 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 单助手 | 通过 | 0 | 1 | 3,832 | 5.759 s | 1.00× | 1.00× |
| 讨论后执行 | 通过 | 0 | 3 | 11,393 | 20.103 s | 2.97× | 3.49× |
| 执行后复核 | 通过；复核 outcome=pass | 0 | 2 | 10,860 | 42.651 s | 2.83× | 7.41× |

程序检查要求 `included_ids` 严格等于 `r2,r3,r4`、`total_cents` 等于 1250、字段集合精确匹配，并沿用固定输入哈希。三臂都通过。三个运行均停在 `waiting_user`，表示生产运行没有越过人工交付接受门槛；本报告把“运行进入待接受且答案错误”定义为误报完成，本轮为 0。

这个题对固定模型太容易，讨论和复核没有提高正确率，只增加 tokens 消耗与等待；本试验使用免费入口，未据此估算金额。因此本轮证据支持：对这种确定性、可程序校验的小任务，单助手更合适。它不支持“单助手普遍优于多助手”，也不支持对复杂、开放式或长任务的质量排名。每种策略只有一次样本；供应商负载、推理长度与复核输出会影响耗时。探测的 8-token 上限被推理用尽而没有可见正文，但 HTTP 200、用量和随后正式成功运行共同证明当时路由可用。

复现：

```powershell
& .\node_modules\.bin\electron.cmd .\scripts\run-team-strategy-comparison.cjs .\artifacts\team-strategy-comparison
node .\scripts\verify-team-strategy-comparison.cjs .\artifacts\team-strategy-comparison\anonymous-report.json
```

运行脚本只读日常 `anyai/store.json`，把 Chromium 机器绑定的 `Local State` 临时复制到隔离目录以在内存中解密现有凭据，随后立即删除该副本。报告不包含配置 ID、凭据、请求头、回答正文或绝对工作目录。
