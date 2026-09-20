# 2.17.1 验收报告

当前版本为未提交的源代码更新，包含 2.17.0 首批功能。未打包发布、未替换日常安装；OpenAI、日常 wickrunAI 及两个验收窗口均保留。

## 结论

| 范围 | 结果 | 证据 |
|---|---|---|
| 自动化 | 617/617，通过且无跳过 | automated-tests.txt |
| 类型检查与生产构建 | 通过；已有大包警告保留 | build.txt |
| 严格复核路径 | 完整接收路径匹配；异目录同名、POSIX 大小写、缺失版本不能通过 | tests/team-review-scope.test.cjs |
| 跨连接与模型生命周期 | 受控组合回归通过 | tests/context-lifecycle.test.cjs |
| 实际桌面复核闭环 | fail → 返工 → pass → 人工操作批准；两份文件均 ready | controlled-desktop.json、02/03 截图 |
| 实际模型桌面调用 | 网关 500，保留失败并停在待核实；无输出 | strategy-pilot.json、01 截图 |
| 固定替代模型连通性 | 402 payment_required，无输出与用量 | alternative-readiness.json |
| 三策略质量与收益 | **未完成**，不能给出排名、成功率或节省比例 | 需可用固定路由后重新试验 |

## 实际桌面操作

真实模型使用独立 `desktop-live` 数据目录与 `pilot-project` 合成项目。在 UI 中选择项目、进入协作空间、打开“单成员 · 最新版本汇总”、检查目录及预算后开始。固定路由 `dva/gpt-5-6-luna-max` 经已有本地网关返回 HTTP 500：`DEVIN_AGENTIC_HOME must be an absolute path inside the bridge sandbox`。应用没有产物，也没有宣称完成，保留失败步骤并等待核实。截图：`01-live-gateway-failure.png`。

已列出的另一固定路由 `oc/gpt-5.6-luna` 用一次“Reply only OK.”连通性请求核查，输出上限 16 tokens，返回 402。此项是直接网关预检，**不是应用 UI 成功试验**。没有修改网关环境、购买额度或轮番尝试所有模型。

两次都未返回实际用量。应用的 3,659 是保守预算记账，不是实报计费用量；报告中的 known token 小计为 0 必须与 missingInput/missingOutput 同读，不能解读为免费或未计费。

受控模型部分继续使用保留的原生 Electron 窗口，页面刷新加载 2.17.1 后，从任务的运行前检查新建运行。本轮把**合成测试主目录**初始状态设为 seed，确保 v1 draft 和 v2 ready 都有实际文件差异，避免只验证空差异版本。两位成员均使用实际 IPC、主进程网络及工具、文件副本、产物快照和权限检查；只有模型回答由本地确定性 HTTP 服务提供。复核先 fail，再针对新版本 pass；程序读回执行与复核两份 JSON 均为 ready 后，通过界面批准。没有再合并到主目录，主目录仍是 seed；合并功能已在 2.17.0 验收，本轮重点是新路径校验与请求身份。

受控运行 `teamrun-03791a2f-549c-4710-9d4d-e355b7eb01ad` 的 8 次请求均记录实际连接和模型。截图 `02-controlled-awaiting-acceptance.png`、`03-controlled-accepted.png`，产物摘要、版本、真实读取调用编号、批准事件和文件哈希在 `controlled-desktop.json`。

## 复现资料

- 固定题目及独立答案校验：`tests/fixtures/team-strategy-case.cjs`。同一 CSV 中混合旧 posted、最新 void 与更新金额，要求只取每个 ID 最新版本，再筛选 posted；输出应纳入 r2/r3/r4，总额 1250 cents，原输入字节不变。
- 已在测试项目预置单成员、讨论后执行、执行后复核三个固定版本。由于首条路由请求失败，后两种没有继续消耗请求；不能将它们登记为完成样本。
- 离线提取命令：`node scripts/report-team-strategy-pilot.cjs <独立验收数据目录>`。仅读取合成任务与文件，不加载密钥、不发起请求、不批准任务。
- 组合回归使用实际 runAgent 和持久存储，但模型与文件工具由受控边界提供，归档位置人工构造；没有模拟完整 OS 进程重启，更没有证明摘要语义质量。

## 下一步

先恢复一个可用固定路由，以同题三策略完成小样本试跑，再扩充题目和重复次数。之后补真实长任务、跨供应商与进程重启试验。代码层面的纯文本复核、订阅客户端工具证据、记忆相关性、任务级多路由成本和系统沙箱继续按路线图推进。
