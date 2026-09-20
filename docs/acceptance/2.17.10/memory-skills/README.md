# 记忆与 Skills 注入质量小样本

本轮使用主仓 2.17.10 的生产 `selectTeamMemories`、`teamMemorySystemBlock`、`skillSystemBlock`、`readSkill` 和 API 请求辅助函数，固定 SenseNova `deepseek-v4-flash`，关闭自动接力，仅发送四个合成单轮案例。每例最多 2,000 输出 tokens，没有重试或扩展探测。

| 案例 | 生产注入结果 | 期望 | 实际 | 客观检查 | 实报 tokens | 时间 |
|---|---|---|---|---:|---:|---:|
| 无记忆、无 Skills | 两个注入块均为空 | `unknown` | `unknown` | 通过 | 192 | 2.417s |
| 相关 adopted 记忆、启用 JSON Skill | 选中 `launch-current@1`；Skill 已注入且可读取 | `zephyr-417` | `zephyr-417` | 通过 | 398 | 1.750s |
| 旧记忆与本轮纠正冲突 | 旧记忆被选中，但系统块声明本轮要求优先 | `cobalt-732` | `cobalt-732` | 通过 | 420 | 1.578s |
| 撤销/过期记忆、停用 Skill | 两条记忆分别因 invalid、expired 排除；Skill 块为空且不能读取 | `unknown` | `unknown` | 通过 | 197 | 2.069s |

四个响应都必须是只含字符串字段 `answer` 的有效 JSON，并与独立期望值完全相等；4/4 通过，错误知识输出为 0。供应商实报总用量为 1,207 tokens（输入 1,024、输出 183），这是用量遥测，不是账单。

这证明了这四个合成输入上的注入行为：相关已采用记忆可被模型使用，当前明确纠正能覆盖旧记忆，撤销/过期记忆与停用 Skill 没有进入提示。它没有覆盖完整 agent/team 闭环、长任务记忆、真实检索召回、折叠 Skill 的工具取回流程或普遍模型质量。

复现：

```powershell
& .\node_modules\.bin\electron.cmd .\scripts\run-memory-skills-quality-pilot.cjs .\artifacts\memory-skills-quality
node .\scripts\verify-memory-skills-quality-pilot.cjs .\artifacts\memory-skills-quality\anonymous-report.json
```

脚本只读日常配置，临时复制机器绑定的 Chromium `Local State` 以在内存中解密既有凭据，随后在任何模型请求和报告写入前删除副本。匿名报告不包含连接 ID、凭据、请求头、完整提示或绝对目录。

