# 执行框架组件登记：为什么存在、何时可以删

每个组件都是为了一类真实故障加上的，也都有成本：更多上下文、更多轮次、更多要维护的代码。
模型变强以后，有些保护会变成纯负担。这张表记下每个组件防的是什么、靠什么测试守住、
在什么条件下可以删掉或放松。新增组件时在这里加一行；删组件前先按「可删条件」拿数据说话，
而不是凭感觉。

「可删条件」都要用回归集（`src/lib/evals.ts`）同题对照来证明：
去掉组件后 holdout 做成率不下降、错误完成率不上升。单次跑通不算。

判定逻辑在 `src/lib/evals.ts`（`ablationVerdict`）：两边都跑过的题至少 5 道才给结论，有一道退步或错误完成率变高就是「保留」。
能关掉做对照的是：任务引导提示、项目记忆（不放进提示词）、技能；其他组件是底线或数据结构，要改代码才能关。
2.20.2 起回归集和组件对照不在用户界面里（这是开发者判断组件去留的工具，普通用户用不上），需要对照时在开发机上用脚本跑真实模型，结论写回这张表。

| 组件 | 防的是什么 | 代码 / 测试 | 可删或放松的条件 |
|---|---|---|---|
| 完成检查续跑（最多自动续跑两次） | 模型只回一句计划就收尾，被记成完成（2.2 审计：22 个「完成」都没有验收条件） | `src/lib/harness.ts`、`tests/harness.test.cjs` | 在 holdout 上关闭续跑，「只给计划就停」的比例 < 2% 且错误完成率不升 |
| 交付门禁（验收条件 + 程序核验） | 模型自评「做完了」但文件没改、内容不全 | `src/lib/delivery.ts`、`tests/delivery.test.cjs` | 不删。这是回归集判分的尺子；只能换成更强的程序核验 |
| 操作编号与重复拦截 | 换模型接手或重试时，同一个写操作（发 issue、推送、写记忆）做第二遍 | `electron/tools/index.cjs`、`tests/operation-key.test.cjs` | 不删。外部副作用不可撤回，和模型能力无关 |
| 未知结果先核实（uncertain） | 进程中断后不知道操作做没做，自动重发导致重复计费或重复写入 | `tests/context-lifecycle.test.cjs` | 不删 |
| 逐项修改前确认（审核模式） | 用户要求每处改动先看差异再落盘 | `src/lib/review-guard.ts`、`tests/grok-review-mode.test.cjs` | 用户选项，不按模型能力删 |
| 上下文分层与压缩、`read_context` 取回 | 长任务超窗口；压缩后丢了用户原话 | `src/lib/context-memory.ts`、`tests/context-contract.test.cjs` | 常用模型窗口足够放下 95 分位任务的完整历史，且压缩触发率 < 1% 时，可以提高触发阈值而不是删 |
| `read_context` 相关度排序（2.20.0） | 只认整串包含，换个说法就找不到历史原文 | 同上，`tests/memory-core.test.cjs` | 若换成向量检索且离线评测更好，可替换 |
| 循环检测（loop guard） | 模型反复调同一个失败的工具 | `tests/loop-guard.test.cjs` | 固定 15 例样本上 FP 0 保持、FN 降到 0 以前不删；模型变强后可只保留提示不停机 |
| 子代理限额（两路并发、单任务八次、不递归） | 子代理失控派发、费用和上下文爆炸 | `tests/subagents.test.cjs` | 限额数字可以随预算调整；「不递归」不删 |
| 纠错分流（知识缺口 → 项目记忆，流程问题 → 项目规范） | 纠错写错地方，下次照样犯 | `src/App.tsx` onCorrection | 有回归题证明同类错误复发率不降时，说明分流没起作用，应改设计而不是删 |
| 回归集固定验收（2.20.0） | 回放回归题时模型自己重定验收，拿自己的尺子判自己通过 | `src/lib/evals.ts` evalRequirements、`tests/evals.test.cjs` | 不删。这是其他所有「可删条件」的前提 |
| 项目记忆条目化（2.20.0） | 整段文字只能追加和整段覆盖：删不掉一条、同步会冲突、超长后截掉最早的 | `src/lib/memory-core.ts`、`tests/memory-core.test.cjs`、`tests/project-memory.test.cjs` | 不删（数据结构） |
| 记忆进提示词的预算与挑选 | 记忆越攒越多，每轮挤占上下文 | 同上 selectMemoryForPrompt | 常用模型窗口大到放下全部记忆且缓存命中率不降时，可以把预算调大；放得下时本来就是全放 |
| 记忆里的密钥遮盖 | 用户或模型把密钥、密码写进记忆，随云同步扩散 | 同上 redactSecrets | 不删 |
| 记忆候选要用户批准 | 从对话里自动记的东西不经确认就影响以后所有对话 | `src/lib/memory-core.ts` memoryCandidatesFrom、`tests/fixtures/memory-candidates.json`（2.20.1：调参组召回 39/40 误报 0/40，留出组 20/20、2/20；旧规则留出组 17/20、6/20）、`src/components/ProjectMemoryPanel.tsx` | 不删。可以改进提炼规则，但批准权留在用户 |
| 项目记忆与协作经验合一（2.20.1） | 两套记忆不互通：单人对话记的协作成员看不到，协作空间记的对话里也用不上，还只存在本机不同步 | `src/lib/team-memory.ts`（迁移与镜像）、`tests/team-runtime.test.cjs` | 不删（数据结构）。协作运行仍按创建时的 id@revision 冻结快照 |
| 删除留墓碑（180 天） | 一台设备删了，另一台同步时又把它带回来；删掉的候选又被提议 | `tests/cloud-data.test.cjs` | 墓碑保留期可以调整，机制不删 |
| 回想旧任务（按需、只查同项目） | 新对话默认零关联被理解成「完全查不到」 | `src/lib/recall.ts`、`tests/routing-memory.test.cjs` | 不删；默认零关联的约定不变 |
| 本机客户端查记忆 / 提候选（2.20.0） | Claude Desktop 等领了任务却不知道项目约定；让外部客户端直接写记忆又太危险 | `electron/native-ai-bridge.cjs`、`electron/tools/knowledge.cjs` nativeMemory、`tests/native-ai-bridge.test.cjs` | 查询只读，候选要批准，每任务最多 5 条。放宽前先看候选被批准的比例 |

## 没有做、以及为什么

- **不内嵌 agentmemory 服务、不上向量检索**：wickrunAI 的记忆按项目隔离、量级在几十到几百条，
  BM25 加中文双字切分已经够用，而且不需要额外进程和模型。量级或评测结果变了再考虑。
- **自动提炼和外部提交的记忆不直接生效**：模型在对话里用 `project_memory_write` 写的是正式记忆（原有能力，
  每一步用户都看得见）；从对话里自动提炼的、本机客户端提交的，一律先当候选，批准后才用。
- **不做 OTel 追踪**：现有观测（`src/lib/observations.ts`）已经记录任务、路由和结果，先把回归集用起来。
