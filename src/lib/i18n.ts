import * as React from 'react';
// cn2t 子路径同时给出 ESM 和 UMD，Vite 和 node 测试都能解析，且只打包简转繁这一个方向。
import * as OpenCC from 'opencc-js/cn2t';

export type Locale = 'zh-Hans' | 'zh-Hant' | 'en';

/** label 是顶栏胶囊上的一个字，label2 是设置里的完整名称。两处都不随语言变。 */
export const LOCALES: { value: Locale; label: string; label2: string; lang: string }[] = [
  { value: 'zh-Hans', label: '简', label2: '简体中文', lang: 'zh-Hans' },
  { value: 'zh-Hant', label: '繁', label2: '繁體中文', lang: 'zh-Hant' },
  { value: 'en', label: 'EN', label2: 'English', lang: 'en' },
];

/**
 * 简体是源文案，写在组件里。繁体由 OpenCC 按台湾正体惯用词转换，不另写一份。
 * 英文查词典，查不到就退回简体原文 —— 半翻译的界面也比缺字的界面好用。
 */
const EN: Record<string, string> = {
  '欢迎来到灯芯：你的创造中心': 'wickrunAI: Where ideas spark and grow',
  '进入应用': 'Enter app',
  '灯芯正在思考': 'wickrunAI is thinking',
  '更多': 'More',
  '输入设置': 'Input settings',
  '高级设置': 'Advanced settings',
  '当前无需操作；可以查看已有结果，或暂停后调整下一步。': "No action is needed now. View existing results, or pause to adjust the next step.",
  '助手正在处理任务': "The assistant is working",
  '点击开始运行，使用本次已确认的任务与配置。': "Start the run with the confirmed task and configuration.",
  '已经准备好': "Ready to start",
  '可以恢复运行；若还有待核实的步骤，先处理已有结果。': "Resume the run after checking any results that still require verification.",
  '系统会自动重试，无需重复开始；你可以随时暂停。': "The system retries automatically. No need to start again; you can pause at any time.",
  '正在等待模型恢复': "Waiting for the model to recover",
  '查看停止原因并填写核实依据；已成功的操作和原用量保留。': "Review the reason and record your verification. Successful operations and prior usage are retained.",
  '这一步需要处理后再继续': "This step needs attention",
  '在下方问题卡回答；答案会保存并用于继续当前步骤。': "Answer in the question card below. Your answer is saved and used to continue this step.",
  '助手需要你补充信息': "The assistant needs more information",
  '查看下方操作内容；批准才会执行，拒绝不会代你同意。': "Review the operation below. It runs only after approval; rejection does not grant permission.",
  '先阅读本次结果，再决定批准或拒绝。': "Read the result before approving or rejecting it.",
  '有操作等待你批准': "An operation awaits approval",
  '交付等待你验收': "Delivery awaits your review",
  '先检查文件或外部动作是否已经生效，再决定接受结果或重试，避免重复执行。': "Check whether the file change or external action took effect before accepting or retrying, to avoid duplication.",
  '有操作结果需要核实': "An operation result needs verification",
  '等待当前操作停下；若结果不确定，核实后再继续。': "Wait for the current operation to stop. Verify uncertain results before continuing.",
  '正在保存并暂停': "Saving and pausing",
  '已有记录和产物保留；重新开始请回到所属任务。': "Records and artifacts are retained. Return to the task to start again.",
  '运行已停止': "Run stopped",
  '可以查看结果；文件修改仍需在文件与产物中检查差异并合并。': "View the results. File changes still require reviewing and merging in Files and artifacts.",
  '交付已验收': "Delivery accepted",
  '等待模型重试结果，时间以服务方响应为准。': "Waiting for the retry response; timing depends on the provider.",
  '预计 {n} 秒后重试': "Retry expected in {n} seconds",
  '查看运行事件': "Show run events",
  '查看步骤与证据': "Show steps and evidence",
  '查看流程图': "Show workflow diagram",
  '本次已有结果': "Current results",
  '查看停止原因': "View why it stopped",
  '当前状态与下一步': "Current status and next step",
  '助手与模型': "Assistants and models",
  '文件任务请选择直接完成或完成后独立复核': 'For file tasks, choose direct completion or independent review',
  '选择本地目录需要桌面版': 'Choosing a local folder requires the desktop app',
  '文件任务范围': 'File task scope',
  '选择这次任务使用的目录': 'Choose a folder for this task',
  '正在选择…': 'Choosing…',
  '选择其他目录': 'Choose another folder',
  '助手可以做什么？': 'What can the assistants do?',
  '只读材料': 'Read files only',
  '只读取本次目录的独立副本并交付结论，不修改原文件，也不会产生待合并修改。': 'Read a separate copy of this folder and deliver findings. Original files remain unchanged; no changes will be available to merge.',
  '阅读、搜索文件并给出结论，不修改文件。': 'Read and search files, then provide findings without changing files.',
  '读取并修改': 'Read and edit',
  '在副本中新增或修改文件，检查差异后由你合并。': 'Create or edit files in a copy. Review the differences before merging.',
  '还需要运行命令？': 'Need to run commands too?',
  '命令已启用：每次需确认': 'Commands enabled: each needs approval',
  '文件权限级别无效': 'Invalid file capability',
  '请先选择工作目录': 'Choose a working folder first',
  '流程成员的文件范围与任务不一致': 'The workflow members’ file scope does not match this task',
  '文件团队只适用于相同目录与能力的任务；其他任务请在准备页选择范围。': 'File teams can be reused only for tasks with the same folder and capabilities. Set up the file scope on other tasks first.',
  '任务文件范围无效': 'Invalid task file scope',
  '任务目录不在项目已授权目录中': 'The task folder is not among this project’s authorized folders',
  '文件任务只支持直接完成或独立复核': 'File tasks support direct completion or independent review',
  '文件复核方式与任务权限不一致': 'The review mode does not match the task’s file capability',
  '文件任务不能带入技能、本机客户端或接力授权': 'File tasks cannot inherit skills, local clients, or failover permissions',
  '文件任务成员包含超出所选权限的工具': 'A file task member has tools beyond the selected capability',
  '允许运行命令': 'Allow commands',
  '适合安装依赖、构建或运行测试。每次命令都需批准；副本只是工作目录，不能限制命令访问整个系统。': 'For installing dependencies, building, or testing. Each command needs approval. The copy is a working folder, not a system sandbox.',
  '读取也使用独立副本。修改和命令逐项确认，复核助手只能读取。副本不含 .git、node_modules、dist、build、.next，目录上限 128 MB。': 'Reading also uses a separate copy. Edits and commands need individual approval; reviewers are read-only. Copies exclude .git, node_modules, dist, build, and .next, with a 128 MB folder limit.',
  '本次工作目录': 'Folder for this task',
  '允许能力': 'Allowed capabilities',
  '读取、修改与运行命令': 'Read, edit, and run commands',
  '在独立副本中工作，修改和命令逐项确认。交付后前往「文件与产物」检查差异并合并，原目录才会更新。': 'Work takes place in a separate copy. Edits and commands require individual approval. After delivery, review and merge changes under Files & Artifacts to update the original folder.',
  '命令的工作目录不是系统沙箱；批准前请检查命令的实际影响范围。': 'The command working folder is not a system sandbox. Check the actual scope of each command before approving.',
  '选择文本或文件任务，助手和流程会自动准备好。开始前可以检查实际安排。': 'Choose a text or file task. Assistants and steps are prepared for you to review before starting.',
  '这次任务需要什么？': 'What does this task need?',
  '只处理文本': 'Text only',
  '写作、讨论或整理想法，不访问本地文件。': 'Write, discuss, or organize ideas without accessing local files.',
  '处理文件': 'Work with files',
  '选择目录，再决定只读材料还是允许修改。': 'Choose a folder, then decide whether to read only or allow edits.',
  '第二位助手核对交付，不通过时有限返工；最后由你验收。': 'A second assistant checks the delivery, with limited revisions if needed. You accept the final result.',
  '复核分析结论的文本；不会把文本引用当成已核实文件事实。': 'Review the written findings. Text citations do not prove facts about files.',
  '复核助手读取本次文件产物；未取得实际检查证据时会请你核实。': 'The reviewer reads this run’s file artifacts. Missing inspection evidence is sent to you for verification.',
  '每位助手使用上面列出的模型，不自动换路由。只有你选择的文件能力会启用。': 'Each assistant uses the model listed above without automatic route switching. Only the selected file capabilities are enabled.',
  '这里只复用模型与职责。文件能力由本次任务选择，不继承原成员的工具、技能或自动换路由设置。': 'Only models and duties are reused. File capabilities are selected for this task; tools, skills, and automatic route switching are not inherited.',
  '在任务页选择「处理文件」，选定目录和能力后开始。运行时创建独立副本，交付后在这里检查差异并合并。': 'Choose Work with files on the task page, select a folder and capabilities, then start. A separate copy is created for the run. Review and merge the changes here after delivery.',
  '执行': 'Execution',
  '本步骤启用 {n} 项工具能力': 'This step enables {n} tools',
  '本步骤只复核文本，不调用文件工具。': 'This step reviews text only and does not call file tools.',
  '请使用与当前任务匹配的工作方式': 'Choose a work style that matches the current task',
  '统一模型接入': 'Shared model connection',
  '统一模型': 'Shared model',
  '修改统一模型会应用到所有助手。需要不同模型时，在下方分别设置；实际安排以助手列表为准。': 'Changing the shared model applies it to every assistant. Customize individual models below. The assistant list shows the actual assignments.',
  '已将全部助手改为所选模型；各自职责保持不变。': 'All assistants now use the selected model. Their individual responsibilities are unchanged.',
  '已有同名团队方案，请换一个名称': 'A team setup already has this name. Choose another name.',
  '已配置 {n} 项工具能力': '{n} tool capabilities configured',
  '未配置额外工具': 'No additional tools configured',
  '角色设置格式无效': 'Role settings are invalid',
  '包含未知角色设置': 'An unknown role is configured',
  '当前工作方式不使用此角色': 'This work style does not use this role',
  '「{title}」的设置格式无效': 'Settings for “{title}” are invalid',
  '请填写「{title}」的职责': 'Enter the responsibilities for “{title}”',
  '「{title}」的职责不能超过 12000 个字符': 'Responsibilities for “{title}” must be at most 12,000 characters',
  '「{title}」引用的成员已失效或不可用于 API 协作': 'The member selected for “{title}” is unavailable or cannot use API collaboration',
  '「{title}」引用的成员不在项目允许范围内': 'The member selected for “{title}” is outside the connections allowed by this project',
  '方案名称需为 1–80 个字符': 'The setup name must contain 1–80 characters',
  '团队方案格式无效': 'Team setup data is invalid',
  '最多保存 20 个团队方案': 'You can save up to 20 team setups',
  '团队方案不存在': 'The team setup no longer exists',

  '分别设置助手与职责': "Customize assistants and responsibilities",
  '默认使用上方模型。你可以只调整其中一位，也可以复制已有成员的配置；原成员和以前的运行不会改变。': "The model above is used by default. Customize one assistant or copy an existing member’s configuration. Original members and earlier runs stay unchanged.",
  '从已有成员复制配置': "Copy configuration from a member",
  '为此任务设置': "Configure for this task",
  '原成员已不可用，请重新选择': "Source member is unavailable. Choose again.",
  '接入已不可用，请重新选择': "Connection is unavailable. Choose again.",
  '这位助手负责什么？': "What is this assistant responsible for?",
  '恢复默认分工': "Restore default role",
  '这里只复用模型与职责。本任务的助手不启用文件、命令、技能或自动换路由；复核与想法梳理仍保留必要的检查和输出要求。': "Only the model and responsibilities are reused. These assistants have no file tools, commands, skills, or automatic route switching. Review and planning retain their required checks and output formats.",
  '使用已保存的团队方案': "Use a saved team setup",
  '方案已载入，可继续调整；尚未准备或开始任务。': "Setup loaded. You can adjust it before preparing and starting the task.",
  '选择团队方案': "Select a team setup",
  '已删除保存的方案；当前设置和已有任务保留。': "Saved setup deleted. Current settings and existing tasks are retained.",
  '删除方案': "Delete setup",
  '本次助手安排': "Assistants for this task",
  '尚未选择模型': "No model selected",
  '每位助手使用上面列出的模型；仅处理文本，不自动换路由。文件任务仍在高级设置中准备。': "Each assistant uses the model listed above, handles text only, and does not switch routes automatically. Prepare file tasks in advanced settings.",
  '保存为可复用的团队方案': "Save a reusable team setup",
  '保存工作方式、各位助手的模型与职责。不会保存任务内容、权限或密钥；下次载入后仍需检查并确认开始。': "Save the work style, models, and responsibilities. Task content, permissions, and keys are not included. Review and confirm before starting a future task.",
  '方案名称': "Setup name",
  '例如：写作与复核': "For example: writing and review",
  '团队方案已保存；未创建运行或调用模型。': "Team setup saved. No run was created and no model was called.",
  '保存团队方案': "Save team setup",
  '方案整理': "Plan organizer",
  '方向探索': "Idea explorer",
  '等待前置任务验收': 'Waiting for prerequisites to be accepted',
  '前置任务': 'Prerequisites',
  '继续编辑任务建议': 'Continue editing suggested tasks',
  '先完成并验收：{tasks}': 'Complete and accept first: {tasks}',
  '没有前置任务，可单独准备。': 'No prerequisites. You can prepare this task independently.',
  '选择并编辑下一步任务': 'Choose and edit your next tasks',
  '保存所选任务': 'Save selected tasks',
  '放弃草稿': 'Discard draft',
  '勾选你要做的事，再修改目标和完成标准。保存后不会立即执行，开始时再选择助手和工作方式。': 'Choose what you want to do, then edit the goals and success criteria. Saving does not start work. Choose assistants and a work style when you are ready to begin.',
  '有前置任务时，必须等它完成并经你验收，才能开始后续任务。后续任务会收到已验收的文本产出。': 'Prerequisites must be completed and accepted by you before the next task can begin. The next task receives the accepted text outputs.',
  '未命名任务': 'Untitled task',
  '已建立': 'Already created',
  '备选方向 {group}：同组只选一项。': 'Alternative group {group}: choose one option only.',
  '调整先后关系': 'Adjust prerequisites',
  '关闭后会保留编辑草稿，可从总览继续。': 'Your draft is kept when you close this editor. Continue from the overview.',
  '前置任务与产出': 'Prerequisites and outputs',
  '查看将传入的文本': 'View the input text',
  '任务先后关系': 'Task prerequisites',
  '箭头前的任务全部验收后，才能开始箭头后的任务。各项仍需手动开始，并受项目并发与预算限制。': 'All tasks before an arrow must be accepted before the following task can begin. Start each task manually, within the project concurrency and budget limits.',
  '全部验收后': 'After all are accepted',
  '本次使用以下已验收文本快照。前置任务后来修改或重跑，不会改写这份输入。': 'This run uses these accepted text snapshots. Later edits or reruns of prerequisites do not change this input.',
  '前置任务全部完成并验收后才能开始；准备运行时会固定并传入这些文本产出。': 'Start after all prerequisites are completed and accepted. Preparing the run freezes these text outputs as its input.',
  '一次请选择一至八项任务建议': 'Choose between one and eight suggested tasks.',
  '任务建议编号无效或重复': 'Suggested task IDs are invalid or duplicated.',
  '任务建议的前置关系无效': 'The suggested prerequisites are invalid.',
  '备选方向分组无效': 'The alternative group is invalid.',
  '任务之间不能循环等待，请调整前置关系': 'Tasks cannot wait on each other in a cycle. Adjust their prerequisites.',
  '前置任务缺失，或任务依赖了自己': 'A prerequisite is missing, or a task depends on itself.',
  '原始梳理结果已不可用，请返回任务重新检查': 'The original exploration result is no longer available. Return to the task and check it.',
  '请至少选择一项尚未建立的任务': 'Select at least one task that has not been created yet.',
  '这项建议已经建立为任务：{title}': 'This suggestion has already been created as a task: {title}',
  '请补全任务名称、目标和完成标准，并缩短过长内容': 'Complete the title, goal and success criteria, and shorten content that exceeds the limit.',
  '同一备选方向只能采用一项，请取消多余选择': 'Only one option in each alternative group can be adopted. Deselect the other options.',
  '请同时选择前置任务：{title}': 'Also select the prerequisite task: {title}',
  '请先结束本轮梳理，再保存后续任务': 'Finish this exploration round before saving the next tasks.',
  '查看详情': 'View details',
  '检查梳理暂停原因': 'Review paused exploration',
  '核实已有梳理结果': 'Verify exploration results',
  '查看梳理失败原因': 'Review exploration failure',
  '查看梳理取消记录': 'View cancelled exploration',
  '检查运行暂停原因': 'Review why work paused',
  '核实已有运行结果': 'Verify existing results',
  '查看运行失败原因': 'Review failure details',
  '查看运行取消记录': 'View cancellation record',
  '想法尚未开始梳理': 'Your idea is saved. Exploration has not started.',
  '梳理运行等待开始': 'Exploration is ready to start.',
  '正在梳理想法': 'The assistants are exploring your idea.',
  '梳理运行正在暂停': 'Exploration is pausing.',
  '梳理结果等待你决定下一步': 'Review the suggestions and decide what to do next.',
  '想法梳理已完成，并已建立后续任务': 'Exploration is complete and a follow-up task has been created.',
  '梳理运行等待你的决定': 'Exploration is waiting for your decision.',
  '梳理运行已暂停': 'Exploration is paused.',
  '梳理结果需要核实': 'The exploration results need verification.',
  '梳理运行失败': 'Exploration failed.',
  '梳理运行已取消': 'Exploration was cancelled.',
  '梳理运行已结束，但没有可用结果': 'Exploration ended without a usable result.',
  '任务还没有实际运行': 'This task has not been run yet.',
  '运行等待开始': 'This run has not started yet.',
  '运行正在进行': 'Work is in progress.',
  '运行正在暂停': 'This run is pausing.',
  '运行等待你验收': 'Check the result and decide whether to accept it.',
  '运行等待你的决定': 'This run is waiting for your decision.',
  '运行已暂停': 'This run is paused.',
  '运行结果需要核实': 'The results need verification.',
  '运行失败': 'This run failed.',
  '运行已取消': 'This run was cancelled.',
  '实际交付运行已完成': 'The delivery run is complete.',
  '打开任务，准备梳理想法': 'Prepare to explore',
  '打开梳理运行': 'Open exploration',
  '查看梳理运行': 'View exploration',
  '查看梳理结果': 'Review suggestions',
  '查看梳理记录': 'View exploration record',
  '查看并处理梳理运行': 'Review exploration',
  '打开任务，准备开始': 'Prepare this task',
  '打开待开始运行': 'Open pending run',
  '查看并处理运行': 'Review and decide',
  '查看交付运行': 'View delivery',
  '探索中': 'Exploring',
  '待你决定': 'Your decision',
  '待执行': 'To do',
  '需要处理': 'Needs attention',
  '项目进展': 'Project progress',
  '看看每件事到了哪一步，再选择要继续的事。': 'See where each task stands and choose what to continue.',
  '按阶段查看任务': 'Filter tasks by stage',
  '全部任务': 'All tasks',
  '有 {count} 次运行需要你查看或决定。': '{count} runs need your review or decision.',
  '还没有任务。先说说你的想法，下一步会出现在这里。': 'No tasks yet. Share an idea, and your next step will appear here.',
  '目前没有这个阶段的任务。': 'There are no tasks at this stage.',
  '查看全部任务': 'View all tasks',
  '此任务有 {count} 次运行尚未结束。': 'This task has {count} unfinished runs.',
  '来源任务': 'Source task',
  '来源任务已不存在': 'The source task no longer exists',
  '查看当时的建议': 'View the original suggestion',
  '来源运行已不存在或不匹配': 'The source run is missing or does not match',
  '后续任务': 'Follow-up tasks',
  '其他需要处理的运行': 'Other runs needing attention',
  '查看运行': 'View run',
  '来源关系说明想法如何延续；不会自动安排任务顺序或并行执行。': 'Source links show how ideas developed. They do not schedule tasks or run them in parallel.',
  '任务已不存在': 'The task no longer exists',
  '选择下一步会结束本轮梳理，不表示同意执行方案。': 'Choosing a next step closes this exploration round. It does not authorize the proposed work.',
  '从哪里开始？': 'Where would you like to start?',
  '帮我理清想法': 'Help me explore an idea',
  '只有一个念头也可以，先看看有哪些方向。': 'An initial thought is enough. Explore possible directions first.',
  '我知道要做什么': 'I know what I want to do',
  '直接说明要完成的事，选择合适的协作方式。': 'Describe the outcome and choose how to work together.',
  '以下内容是模型建议，请按你的决定修改。保存后还需选择工作方式，不会立即执行。': 'This brief was suggested by a model. Edit it to reflect your decision. Saving does not start execution; you will choose a work style next.',
  '你在想做什么？': 'What are you thinking about?',
  '你希望完成什么？': 'What would you like to accomplish?',
  '比如：我想办一场社区活动，但还没想好做什么。': 'For example: I would like to organize a community event, but I am not sure what kind.',
  '写下希望得到的结果，可以随时修改。': 'Describe the outcome you want. You can edit it later.',
  '不用先写计划或完成标准。两位助手会探索方向、整理建议；本轮只产出方案，由你决定下一步。': 'No plan or success criteria needed yet. Two assistants explore options and suggest a next step. You decide what to do next.',
  '怎样算做好？': 'What would a good result look like?',
  '例如：给出三个方案，说明时间、费用和各自的取舍。': 'For example: compare three options, including timing, cost and trade-offs.',
  '更多设置：名称与负责人': 'More settings: name and owner',
  '任务名称（可选）': 'Task name (optional)',
  '留空时使用想法的开头': 'Leave blank to use the beginning of your idea',
  '方向与下一步建议': 'Options and a suggested next step',
  '这是供你选择的建议，实际任务尚未开始。可以补充想法再讨论，也可以修改建议后建立下一项任务。': 'These are suggestions for your decision. The proposed work has not started. Add more context, or edit a suggestion to create your next task.',
  '建议目标': 'Suggested goal',
  '建议的完成标准': 'Suggested success criteria',
  '模型未提供可直接带入的任务建议，你仍可阅读上方结果并手动填写下一步。': 'The model did not provide a reusable brief. You can still read the result and write your next task.',
  '修改建议，建立下一项任务': 'Edit the suggestion and create a next task',
  '还有想补充的？': 'Anything to add?',
  '回答上面的问题，或说说你更喜欢哪个方向。': 'Answer the questions above, or say which direction you prefer.',
  '带着补充继续梳理': 'Explore further with this context',
  '你的输入': 'Your input',
  '完成这一步': 'Work on this step',
  '一起讨论': 'Discuss together',
  '根据结果选择': 'Choose based on the result',
  '分头进行': 'Work on separate branches',
  '汇总结果': 'Gather results',
  '独立检查': 'Independent check',
  '请你确认': 'Your confirmation',
  '交给下一位': 'Hand over',
  '由你验收': 'Your acceptance',
  '步骤已不存在': 'Step no longer exists',
  '协作步骤示意图': 'Collaboration flow diagram',
  '连线表示下一步；虚线表示返回或返工。': 'Arrows indicate transitions; dashed lines indicate a return or rework.',
  '下方可查看每一步的负责人、产出和去向。分支按连线执行，不按列表顺序执行。': 'Select a step below to see who works on it, its output and next steps. Branches follow the arrows, not the list order.',
  '成员已不存在': 'Member no longer exists',
  '系统安排': 'System',
  '需要配置成员': 'Assign a member first',
  '要做什么': 'What happens',
  '你会得到': 'What you receive',
  '满足预算与并发限制时，各分支可分头进行。': 'Branches can run separately within the budget and concurrency limits.',
  '所有前置步骤到齐后继续。': 'Continue when all preceding steps arrive.',
  '有前置结果到达即可继续。': 'Continue when a preceding result arrives.',
  '判断依据': 'Decision rule',
  '返回，最多 {n} 次': 'Return, up to {n} times',
  '部分连线指向已不存在的步骤，请先修复流程。': 'Some connections reference missing steps. Fix the workflow before running.',
  '接下来会发生什么': 'What happens next',
  '待准备方案': 'Proposed flow',
  '运行版本 {n}': 'Run version {n}',
  '草稿预览，保存版本后才能运行': 'Draft preview; save a version before running',
  '草稿另有修改；下面显示的是本次将运行的已保存版本。': 'The draft has further changes. This preview shows the saved version selected for the run.',
  '查看步骤与分工': 'View steps and responsibilities',
  '先一起理清方向': 'Explore the idea together',
  '一位助手探索可能的方向，另一位整理问题和下一步建议。你不需要先设计流程。': 'One assistant explores options; another organizes questions and suggests a next step. No workflow design required.',
  '直接完成': 'Complete directly',
  '适合范围清楚的小任务，一位助手完成后交给你。': 'For small, clear tasks. One assistant produces the result for your review.',
  '先讨论再完成': 'Discuss, then complete',
  '适合需要比较思路的任务，两位助手讨论后交付。': 'For comparing approaches. Two assistants discuss before delivering.',
  '完成后独立复核': 'Complete, then review',
  '适合需要检查的文本，第二位助手核对，不通过时有限返工。': 'For text that needs checking. A second assistant reviews it, with bounded rework when needed.',
  '请填写怎样算做好': 'Describe what a good result would look like',
  '先给这个空间起个名字，再聊聊你想做什么。': 'Name this space, then share what you have in mind.',
  '从一句想法开始。一起探索方向、理清下一步，再决定怎么完成。': 'Start with an idea. Explore options and a next step together, then decide how to proceed.',
  '说说你的想法': 'Share your idea',
  '浏览协作方式': 'Browse ways to collaborate',
  '当前阶段：理清想法，实际任务尚未开始': 'Current stage: exploring an idea; proposed work has not started',
  '查看这项任务的想法来源': 'View the idea behind this task',
  '所选流程已不存在，请重新选择': 'This workflow no longer exists. Choose another one.',
  '也可以使用已有协作方式': 'Or use an existing workflow',
  '从一个想法开始': 'Start with an idea',
  '说说你希望完成的事': 'Describe what you want to accomplish',
  '保存并继续': 'Save and continue',
  '探索可选方向': 'Explore options',
  '整理下一步建议': 'Suggest a next step',
  '由你决定下一步': 'You decide the next step',
  '你的想法': 'Your idea',
  '此任务已指定负责人，请通过高级设置准备流程': 'This task has an assigned owner. Prepare its workflow in Advanced settings.',
  '高级：指定负责人': 'Advanced: assign an owner',
  '准备任务': 'Prepare task',
  '选择怎么完成这项任务': 'Choose how to complete this task',
  '先从文本任务开始。成员和流程会自动准备好，之后仍可编辑。': 'Start with a text task. Members and an editable workflow will be prepared for you.',
  '选择或输入模型 ID': 'Choose or enter a model ID',
  '工作方式': 'Work style',
  '直接完成 · 1 位成员': 'Complete directly · 1 member',
  '先讨论再完成 · 2 位成员': 'Discuss, then complete · 2 members',
  '完成后独立复核 · 2 位成员': 'Complete, then review · 2 members',
  '一位成员完成文本，最后由你验收。': 'One member produces the text. You approve the final delivery.',
  '两位成员先讨论，再由执行成员交付；会增加模型调用。': 'Two members discuss before the executor delivers. This uses additional model calls.',
  '执行成员交付后，另一位成员引用原文复核；未通过可有限返工，会增加模型调用。': 'A second member reviews the delivered text with exact quotes. Failed reviews can trigger bounded rework and additional model calls.',
  '使用所选模型，不自动切换路由；不启用文件或命令工具。文件任务和更多定制在下方高级设置。': 'Uses the selected model with no automatic route switching or file/command tools. File tasks and further customization are under Advanced settings.',
  '正在准备…': 'Preparing…',
  '准备并检查': 'Prepare and review',
  '下一步确认后才开始调用模型。': 'Model calls begin only after you confirm the next step.',
  '当前项目没有可用的 API 接入。请先添加接入，或在项目设置中允许已有接入。': 'No API connection is available for this project. Add one, or allow an existing connection in Project settings.',
  '请先填写目标和验收标准': 'Enter the goal and acceptance criteria first',
  '此任务已有流程，请在高级设置中调整': 'This task already has a workflow. Adjust it in Advanced settings.',
  '请选择工作方式': 'Choose a work style',
  '请选择可用的 API 接入和模型': 'Choose an available API connection and model',
  '此接入不在项目允许范围内，请选择其他接入': 'This connection is not allowed in this project. Choose another connection.',
  '已准备流程': 'Prepared workflow',
  '查看或调整流程': 'View or edit workflow',
  '高级设置：成员、文件与流程': 'Advanced settings: members, files and workflows',
  '可分别调整成员模型、职责和工具，生成文件复核流程，或选择已有流程。': 'Customize each member’s model, role and tools, generate a file-review workflow, or use an existing workflow.',
  '先写任务目标与验收标准，再选择模型和工作方式。成员与流程可以随后调整。': 'Write a goal and acceptance criteria, then choose a model and work style. Customize members and workflows later.',
  '先建立项目并写下任务，再选择模型和工作方式。': 'Create a project and describe your task, then choose a model and work style.',
  '还没有运行。从新建任务开始，按提示选择模型和工作方式。': 'No runs yet. Create a task, then choose a model and work style.',
  '无需先配置成员或绘制流程。保存任务后即可准备第一次运行。': 'You do not need to configure members or draw a workflow first. Save a task to prepare your first run.',
  '本次使用的成员与模型': 'Members and models for this run',
  '遇到临时限流会自动等待重试；默认等待 62 秒，服务器指定时间时优先采用。等待期间可暂停。': 'Temporary rate limits trigger automatic retries, waiting 62 seconds by default or the time specified by the server. You can pause while waiting.',
  '自动重试已关闭；遇到限流将保留进度并等待处理。': 'Automatic retries are off. A rate limit will preserve progress and wait for your action.',
  '未知任务':
    'Unknown task',
  '打开这次运行 →':
    'Open this run →',
  '新增':
    'Added',
  '当前步骤':
    'Current step',
  '执行成员':
    'Member',
  '在等什么':
    'Waiting on',
  '用量':
    'Usage',
  '等你确认工具调用':
    'Waiting for you to approve a tool call',
  '等你核实后决定':
    'Waiting for you to check the result and decide',
  '等你验收交付':
    'Waiting for your delivery sign-off',
  '已停下':
    'Stopped',
  '已结束':
    'Finished',
  '这一步的「最多执行几次」用完了。在设计器里把该节点的次数调高，保存新版本后新建运行；已完成的产物保留在「文件与产物」里。':
    'This step has used up its "max runs" allowance. Raise it on that node in the designer, save a new version and start a new run; anything already produced stays under Files & artifacts.',
  '自动续跑：轮次或阶段预算用完，没有待核实的操作':
    'Auto-continue: the round or stage budget ran out and nothing is waiting to be checked',
  '第 {n} 次自动续跑：{reason}。已用 {used}/{cap} tokens。':
    'Auto-continue #{n}: {reason}. Used {used}/{cap} tokens.',
  '本次运行还剩 {left} tokens（上限 {cap}，已用 {used}），不足以再开一段（至少要 {min}）。提高这个流程的总用量上限、或项目设置里的每次运行上限，然后新建运行；也可以就此接受已有结果。':
    'This run has {left} tokens left (cap {cap}, used {used}), not enough to start another stage (needs at least {min}). Raise the flow total token limit or the per-run limit in project settings and start a new run — or accept what you have.',
  '注意：这个任务平时用的是「{other}」，这次要用「{now}」跑。运行一旦创建就改不了。':
    'Heads up: this task normally runs on "{other}", and this run would use "{now}". A run is fixed to its flow once created.',
  '核实并接着跑':
    'Verified — carry on from here',
  '在这里：填一句核实依据后点「核实并接着跑」，用新的一段预算从检查点继续；想一次跑完就先提高流程的总用量上限（以及项目设置里的每次运行上限），再新建运行。':
    'Here: write one line of what you checked, then press "Verified — carry on from here" to continue from the checkpoint on a fresh budget. To finish in one go, raise the flow total token limit (and the per-run limit in project settings) first, then start a new run.',
  '用户中止时这一步正在执行，结果需要核实：{error}':
    'This step was still running when you stopped the run, so its result needs checking: {error}',
  '文件':
    'Files',
  '命令':
    'Commands',
  '联网':
    'Web',
  '项目记忆与文档':
    'Project memory and docs',
  '任务管理':
    'Task management',
  '全选这一组':
    'Select all in this group',
  '全部取消':
    'Clear this group',
  '点任意一条，画布会跳到出问题的那一步并选中它，右侧属性就是修改的地方。':
    'Click any of these and the canvas jumps to the step at fault and selects it; the panel on the right is where you fix it.',
  '连线':
    'Connection line',
  '整个流程':
    'The workflow as a whole',
  '导入配置模板':
    'Import a configuration template',
  '这个文件读不出文本内容':
    'That file has no readable text content',
  '导入的成员和流程一律换新编号、先停用，不会覆盖现有配置；流程版本要在设计器里重新保存一次再运行。':
    'Imported members and workflows get fresh ids and arrive disabled, so nothing you already have is overwritten. Save a workflow version in the designer before running it.',
  '失灵时的接力名单':
    'Handoff list when a route fails',
  '顺序由你排：这位成员的路由失灵时按名单往下走，进度不重来。不设就沿用应用全局名单；本机订阅客户端不参与自动交接。':
    'You set the order. When the route of this member fails, wickrunAI walks down the list and the work continues from its checkpoint. Leave it unset to inherit the app-wide list. Local subscription clients are never handed off automatically.',
  '为这位成员单独设一份名单':
    'Give this member its own list',
  '接入':
    'Connection',
  '加入名单':
    'Add to list',
  '{name}：{reason}，已按接力名单交给 {model} 接手，已有进度保留':
    '{name}: {reason}. Handed to {model} from your list; the work so far is kept.',
  '这位成员带哪些技能': 'Skills this member carries',
  '由你勾选，不按指令自动匹配。正文过长的技能只放开头，成员需要具体规范时自己取回。':
    'You pick them; nothing is matched automatically from the step text. A long skill is injected head-only, and the member fetches the rest when it needs the details.',
  '还没有已启用的技能。': 'No skills are enabled yet.',
  '按来源': 'By source',
  '单一 Agent 对话': 'Single-agent chat',
  '合并（证据强度不同，只作粗看）': 'Merged (different evidence strength; rough view only)',
  '两条路径的完成不是一回事：对话路径背后有工具记录和交付核验，协作空间是流程里的质检节点加人工确认。默认分开看。':
    'Completion does not mean the same thing on both paths: chat runs carry tool records and delivery verification, team runs carry a review node plus your own approval. They are kept apart by default.',
  '无法核对本机成员的隔离区文件变化：{error}': 'Cannot check the isolated copy of this local client member for file changes: {error}',
  '这一步要求改动文件，但本机客户端的隔离区里没有任何文件变化。请核实它实际做了什么，再决定接受或重试。':
    'This step asked for file changes, but nothing changed in the local client\'s isolated copy. Check what it actually did before accepting or retrying.',
  '这一步要求测试或推送。本机客户端在它自己那边执行，wickrunAI 看不到执行记录，无法程序核验；请核实后再决定。':
    'This step asked for tests or a push. The local client runs them on its own side, so wickrunAI has no execution record to verify against. Check it yourself before deciding.',
  '彻底删除这个手动补的 ID': 'Delete this manually added ID for good',
  '再点一次就彻底删除这个手动 ID': 'Click again to delete this manual ID for good',
  '确认删除': 'Confirm',
  '已删除手动模型 {id}': 'Deleted the manual model {id}',
  '手动隐藏：不想在列表里看到它。扫描来的模型只能隐藏，下次扫描还会回来':
    'Hide it from the list. Scanned models can only be hidden; the next scan brings them back.',
  '顺序由你定：免费的排前面还是稳的排前面，程序不替你判断，它也不知道哪条是付费的。':
    'You decide the order: free routes first, or the reliable ones first. wickrunAI does not judge for you and does not know which routes are paid.',
  '优先级：本对话 → 项目 → 应用全局。': 'Priority: this chat → project → app-wide.',
  '某一层没设置就往上找；设置了就算数，哪怕它是空名单或者明确关掉。':
    'A level that is not set falls through to the one above. A level that is set counts, even when its list is empty or it is switched off.',
  '设置哪一层': 'Which level to edit',
  '本对话': 'This chat',
  '项目「{name}」': 'Project “{name}”',
  '应用全局': 'App-wide',
  '没有任何一层设置': 'no level is set',
  '当前实际生效的是：': 'Currently in effect: ',
  '（{state}，{n} 条候选）': ' ({state}, {n} candidates)',
  '已开启': 'on',
  '已关闭': 'off',
  '这一层的名单是空的：会按这一层的设置不做交接，也不再往上继承。':
    'This level has an empty list, so nothing is handed off and it no longer falls through to the level above.',
  '这一层改回继承上层': 'Make this level inherit again',
  '这一层没有设置，继承上层。': 'This level is not set, so it inherits from the level above.',
  '在这一层单独设置': 'Set it separately at this level',
  '现在整理一次的代价': 'Cost of compacting now',
  '约 {tokens} token 重算（≈ {turns} 轮缓存命中）': 'about {tokens} tokens recomputed (≈ {turns} cached turns)',
  /* 回归集 */
  '回归集': 'Regression set',
  '题目来自真实失败：下面标了「未解决」的任务可以一键存成回归题。改了提示词、换了路由、加了技能之后，拿同一批题各跑一遍，比同一把尺子。':
    'Cases come from real failures: any task marked unresolved below can be saved as one. After changing a prompt, a route or a skill, run the same set again and compare with the same yardstick.',
  'dev 用来调，holdout 只在最后跑。但用来调过的题目就已经是开发数据了 —— holdout 跑满 {n} 次就该换一批，否则你量的只是自己的过拟合。':
    'dev is for tuning, holdout only for the final check. A case you tuned against is already development data, so once a holdout case has run {n} times it should be rotated out; otherwise you are only measuring your own overfitting.',
  '有 {n} 道 holdout 题已经跑满次数，建议换一批。': '{n} holdout cases have hit that limit; rotate them out.',
  '{split} · 跑过 {n} 次': '{split} · run {n} times',
  '改到 {to}': 'Move to {to}',
  '跑这道题': 'Run this case',
  '还没有回归题。': 'No regression cases yet.',
  '存为回归题': 'Save as a regression case',
  '已存为回归题（先进 dev）': 'Saved as a regression case (into dev first)',
  '回归题：{title}': 'Regression case: {title}',
  '题数': 'Cases',
  /* 权限台账 */
  '权限台账': 'Permission log',
  '每次放行或拒绝都记一笔，只增不改。上面那个「记住」决定的是下次还问不问，这里记的是你到底同意过什么 —— 那是最该能回头核对的东西。':
    'Every grant and refusal is appended here and never rewritten. The “remember” option above decides whether you are asked again; this records what you actually agreed to, which is the part worth being able to check later.',
  '已放行': 'Granted',
  '已拒绝': 'Refused',
  '管理员权限': 'Administrator rights',
  '· 已记住': ' · remembered',
  '清空台账': 'Clear the log',
  '还没有放行记录。': 'No permission decisions recorded yet.',
  /* 纠错留存 */
  '把这次纠错留下来': 'Keep this correction',
  '先分清错在哪一层：改错地方的纠错不会起作用。知识缺口写进项目记忆，流程问题写进项目规范。':
    'First decide which layer was wrong: a correction filed in the wrong place does nothing. Knowledge gaps go to project memory, process problems go to the project rules.',
  '这次错在哪一层': 'Which layer was wrong',
  '纠错类型': 'Correction type',
  '流程问题：步骤、顺序、该核验没核验': 'Process: the steps, their order, a check that was skipped',
  '知识缺口：它不知道某个事实或约定': 'Knowledge: it did not know some fact or convention',
  '哪里不对': 'What was wrong',
  '用一句话说清哪里不对、正确的应该是什么': 'In one line: what was wrong, and what it should have been',
  '保存这条纠错': 'Save this correction',
  '用同样的要求重做一次': 'Run the same request again',
  '已写入{where}。重做一次同样的任务，才知道这条纠错管不管用 —— 存下来本身不等于改进。':
    'Written to {where}. Only running the same task again shows whether the correction helped; filing it is not improvement by itself.',
  '这个任务不属于任何项目，纠错没有可写入的地方': 'This task is not in a project, so there is nowhere to file the correction',
  '（没有写入）': '(nothing written)',
  '样本不足（{n} 条判得出）': 'not enough samples ({n} judged)',
  '做成率 {rate}%（{n} 条判得出）': '{rate}% success ({n} judged)',
  '按历史做成率重排（{n} 条有足够样本）': 'Reorder by past success rate ({n} have enough samples)',
  '这是建议，不是自动执行：顺序仍然由你定。样本不足的保持原位，不会被历史数据挤到后面去。':
    'This is a suggestion, not an automatic change: the order stays yours. Routes without enough samples keep their place and are never pushed down by history.',
  /* 路由记分 */
  '各路由的表现': 'How each route has done',
  '这三个数只作参考展示，还没有参与任何自动决策。': 'These numbers are shown for reference only and do not drive any automatic decision yet.',
  '统计单元是「路由」而不是模型名：同一个模型挂在两份凭据下算两条，网关的 auto/ 这类逻辑路由算它自己一条 —— 网关背后随时可能换实际执行者。':
    'Rows are routes, not model names: the same model under two credentials counts twice, and a gateway alias like auto/ counts as itself, because the gateway can swap the model behind it at any time.',
  '「做成率」的分母只含判得出来的任务。说不清的单独列，既不算成功也不算失败。少于 {rank} 条判得出来的不给做成率，少于 {cost} 条的不给成本。':
    'The success rate counts only tasks that could be judged. Undecidable ones are listed separately and count as neither. Below {rank} judged tasks no rate is shown, and below {cost} no cost is shown.',
  '按任务类型': 'By task type',
  '改东西': 'Changes something',
  '跑测试': 'Runs tests',
  '推送': 'Pushes',
  '只要解释': 'Explanation only',
  '旧记录（没有分类）': 'Older records (no type)',
  '路由': 'Route',
  '做成率': 'Success rate',
  '判得出 / 说不清': 'Judged / undecidable',
  '耗时中位数': 'Median time',
  '每次做成的 token': 'Tokens per success',
  '错误完成率': 'False-completion rate',
  '样本不足': 'Not enough samples',
  '用量有缺口': 'Usage incomplete',
  '这个范围里还没有可统计的任务。': 'No tasks in this range can be scored yet.',
  '回想过去的任务': 'Recall past tasks',
  '回想「{query}」相关的旧任务': 'Recalled past tasks about “{query}”',
  '取回技能正文': 'Fetch skill instructions',
  '取回技能 /{name} 的正文': 'Fetched the instructions for /{name}',
  /* 事件驱动护栏 */
  '事件驱动护栏': 'Automatic guardrails',
  '模型每次改完东西，自动跑一条你写的检查命令。没通过就把原文摆到它面前，让它这一轮就看见；通过了一声不吭。':
    'Each time the model changes something, a check command of yours runs. If it fails, its output is put in front of the model on the same turn; if it passes, nothing is said.',
  '适合放那些「每次都必须做、但模型总会忘」的规矩，比如改完 package.json 就核对版本号是不是三处都同步了。':
    'Good for the rules that must happen every time but the model keeps forgetting, such as checking that all three version fields stayed in sync after package.json changed.',
  '这些命令只从这里读，绝不从工作目录读。': 'These commands are read only from here, never from a working folder.',
  '否则任何一个克隆下来的仓库都能在你机器上自动执行命令。':
    'Otherwise any repository you clone could run commands on your machine by itself.',
  '护栏名称': 'Guardrail name',
  '检查命令': 'Check command',
  '在工作目录里用本机的 shell 运行（Windows 是 cmd）。退出码非 0 就算没通过。':
    "Runs in the working folder with this machine's own shell (cmd on Windows). A non-zero exit code counts as a failure.",
  '改动路径匹配': 'Changed path matches',
  '正则，留空表示不限。例如 package\\.json$': 'A regular expression; leave empty for any path. For example package\\.json$',
  '只在这个工作目录下触发': 'Only in this working folder',
  '留空表示所有工作目录。': 'Leave empty for every working folder.',
  '删除这条护栏': 'Delete this guardrail',
  '添加一条护栏': 'Add a guardrail',
  /* 失灵交接 */
  '失灵交接名单': 'Failover order',
  '当前路由失灵时，按你排的顺序往下交接，带着已保存的进度继续，不从头再来。':
    'When the current route fails, work is handed to the next route in your order and continues from the saved progress instead of starting over.',
  '顺序由你定：免费的排前面还是稳的排前面，程序不替你判断，它也不知道哪条是付费的。名单为空就维持现在的行为：失败后停下来等你。':
    'You decide the order: free routes first, or the reliable ones first. wickrunAI does not judge for you and does not know which routes are paid. An empty list keeps today\'s behaviour: it stops and waits for you.',
  '失灵时自动交接': 'Hand off automatically on failure',
  '下移': 'Move down',
  '移出名单': 'Remove from the list',
  '名单是空的，现在不会自动交接。': 'The list is empty, so nothing is handed off automatically.',
  '添加一条候选路由': 'Add a candidate route',
  '添加一条候选路由…': 'Add a candidate route…',
  '{reason}，已按你的接力名单交给 {model} 接手，进度不重来。':
    '{reason}. Handed to {model} from your failover order; the saved progress carries over.',
  '这条路由自己坏了': 'This route is broken',
  '这条路由的额度暂时用完了': 'This route is out of quota for now',
  '这条路由当前不可用': 'This route is unavailable right now',
  '这条路由不支持本次任务要用的工具调用': 'This route does not support the tool calls this task needs',
  '这条路由看不了图': 'This route cannot read images',
  '这条路由的上下文窗口装不下': 'This route\'s context window is too small for the task',
  '连接反复不通': 'The connection keeps failing',
  '目标要求实际操作，但只有模型复核通过，没有任何经程序核验的验收条目。请补一条可程序核验的验收（文件存在、内容包含之类），通过后再交付。':
    'The goal asks for real operations, but only a model review passed and no acceptance check was verified by the program. Add a program-verifiable check (file exists, content contains, and so on) and pass it before delivering.',
  '目标要求实际操作，但没有任何经程序核验的验收条目。请用 update_requirements 声明可核验的交付条件，核验通过后再交付。':
    'The goal asks for real operations, but no acceptance check was verified by the program. Declare verifiable delivery conditions with update_requirements and pass them before delivering.',
  /* 侧栏 */
  '＋ 新对话': '+ New chat',
  '搜索对话…': 'Search chats…',
  '已钉选': 'Pinned',
  '未分组': 'Ungrouped',
  '没有匹配的对话': 'No matching chats',
  '还没有对话': 'No chats yet',
  '这个项目下还没有对话': 'No chats in this project yet',
  '在「{name}」里新开一个对话': 'Start a chat in {name}',
  '钉到顶部': 'Pin to top',
  '取消钉选': 'Unpin',
  '从别的对话分叉来的': 'Forked from another chat',
  '复制一份，带上全部上下文，接着聊': 'Copy it with the full context and keep going',
  '删除': 'Delete',
  '删除这个对话？': 'Delete this chat?',
  '「{title}」的全部消息和执行记录会被一起删掉，删了就找不回来了。':
    'Every message and run record in “{title}” goes with it. You cannot undo this.',
  '取消': 'Cancel',
  '📁 项目': 'Projects',
  '⚡ 技能': 'Skills',
  '⏰ 定时': 'Schedule',
  '⚙ 设置': 'Settings',
  '任务记录与分析': 'Run history',
  '界面语言': 'Interface language',

  /* 输入框 */
  '请先完成配置': 'Finish setup first',
  '还在生成，现在输入会排到队尾…': 'Still generating. What you type now joins the queue.',
  '问点什么…（图片可以直接粘贴）': 'Ask something. Paste images straight in.',
  '排队中，这一轮结束后依次发出': 'Queued. They go out in order once this round ends.',
  '队列已暂停': 'Queue paused',
  '继续队列': 'Resume queue',
  '立即送出': 'Send now',
  '保存当前执行现场，立即处理这条新要求': 'Save the run in place, then take this new instruction',
  '取消这条': 'Drop this one',
  '移除引用': 'Remove quote',
  '只发送引用段落和本次问题，保留项目规范':
    'Send only the quoted text and this question. Project rules stay.',
  '添加文件、图片或工作目录': 'Add files, images or a working directory',
  '添加附件与工作目录': 'Attachments and working directory',
  '选择工作目录': 'Choose a working directory',
  '已配 {n} 个，再加一个': '{n} set. Add another.',
  '还没配，文件和命令行工具会拒绝执行': 'None set. File and shell tools refuse to run.',
  '添加文件': 'Add files',
  '文本和代码，内容直接进这轮对话': 'Text and code go straight into this round.',
  '添加图片': 'Add images',
  '也可以直接 Ctrl+V 粘贴。需要模型支持多模态': 'Ctrl+V works too. The model has to accept images.',
  '这台设备读不了本地文件，去设置里配好遥控。':
    'This device cannot read local files. Set up the remote in Settings.',
  '技能 · 输入 / 唤起': 'Skills · type / to call',
  '↑↓ 选择 · Enter 确认 · Esc 关掉': '↑↓ select · Enter confirm · Esc close',
  '这些技能的指令会注入每一轮，直到你点 ✕ 摘掉':
    'These skills inject into every round until you drop them with ✕',
  '操作确认方式': 'Approval mode',
  '逐步确认': 'Confirm each step',
  '每个会改变状态的操作都先问你 —— 写文件、跑命令、点 Chrome、调 Claude Code。':
    'Anything that changes state asks you first: writing files, running commands, driving Chrome, calling Claude Code.',
  '自动批准编辑': 'Auto-approve edits',
  '写文件和 Chrome 操作直接放行；跑命令和调 Claude Code 仍然问你。':
    'File writes and Chrome actions go through. Commands and Claude Code still ask.',
  '全部放行': 'Allow everything',
  '一句不问，包括在你电脑上执行任意命令。只在你盯着屏幕、且工作目录里没有要紧东西时用。':
    'No questions, including arbitrary commands on your computer. Use it while you watch the screen and the working directory holds nothing you care about.',
  '非流式': 'Non-streaming',
  '请求模式': 'Request mode',
  '沿用同一段对话和附件；Chat 讨论，Work 接着执行。切换后对下一条消息生效。':
    'Same conversation and attachments. Chat discusses, Work executes. Takes effect on your next message.',
  'Chat 模式：仅文本对话，不下发工具': 'Chat mode: text only, no tools',
  'Work 模式：可调用工具，按当前审批规则执行': 'Work mode: tools run under the current approval rule',
  '官方默认强度': 'Provider default effort',
  '在模型选择器中调整官方客户端提供的思考强度':
    'Adjust the official client’s reasoning effort in the model picker',
  '停止': 'Stop',
  '排队发送': 'Queue it',
  '排到队尾，这一轮结束后自动发出': 'Goes to the back of the queue and sends when this round ends',
  '发送': 'Send',

  /* 运行方式 */
  '⚙ 运行方式': '⚙ Run mode',
  '对话运行方式': 'How this chat runs',
  '对话运行方式：任务引导{harness} · 临时协作{subagents}。只作用于当前会话。':
    'How this chat runs: task guidance {harness}, ad-hoc helpers {subagents}. Applies to this chat only.',
  '开': 'on',
  '关': 'off',
  '任务引导': 'Task guidance',
  '帮助模型理解目标、按规范编辑、自查并完成测试。关闭后仍保留传输完整性和防重复执行保护。':
    'Helps the model hold the goal, edit to spec, check itself and finish the tests. Turn it off and you keep transport integrity and the replay guard.',
  '临时协作': 'Ad-hoc helpers',
  '主模型可像调用工具一样临时分派独立工作，并在本轮整合结果。默认只读，最多两个同时运行。':
    'The main model hands off independent work like a tool call and folds the results back into this round. Read-only by default, two at a time.',
  '可调用模型': 'Models it can call',
  '最多调用': 'At most',
  '次': 'calls',
  '还没有工作模型。添加后，主模型会按任务需要决定是否调用。':
    'No worker models yet. Add one and the main model decides when to call it.',
  'API 凭据': 'API credential',
  '模型': 'Model',
  '选择模型或填写 ID': 'Pick a model or type an ID',
  '移除': 'Remove',
  '工作模型 {n} 的 API 凭据': 'API credential for worker {n}',
  '工作模型 {n} 的模型 ID': 'Model ID for worker {n}',
  '移除工作模型 {n}': 'Remove worker {n}',
  '没写描述': 'No description',
  '粘贴的图片': 'pasted-image',
  '默认': 'default',

  /* 顶栏与空状态 */
  '新对话':
    'New chat',
  '未配置凭据':
    'No credential',
  '⚙ 配置':
    '⚙ Config',
  '问点什么':
    'Ask something',
  '审阅交接内容':
    'Review the handoff',
  '会自己联网查证、读你本地的文件、翻 Chrome 里的页面，答案里带可点的来源编号。':
    'It searches the web, reads your local files and looks through Chrome, and the answer carries numbered sources you can click.',
  '新对话已准备好，由你决定下一步。':
    'The new chat is ready. What happens next is your call.',
  '交接草稿':
    'Handoff draft',
  '交接草稿 · 尚未发送':
    'Handoff draft · not sent',
  '上下文已填入下方输入框，可以编辑、保留或发送。原任务没有被交接动作停止；请先查看其最新进度，避免同时重复执行。':
    'The context is in the composer below, to edit, keep or send. The handoff did not stop the original task, so check where it got to before you run the same work twice.',
  '查看原任务':
    'Open the original task',

  /* 产物、验收、恢复与官方客户端 */
  '{label}崩了':
    '{label} crashed',
  '这块界面崩了':
    'This part of the interface crashed',
  '技术细节（贴给我就能定位）':
    'Technical detail (paste it to me and I can locate it)',
  '组件栈':
    'Component stack',
  '重试':
    'Retry',
  '复制错误':
    'Copy the error',
  '对话内':
    'In chat',
  '文件内容在对话中，可保存':
    'The content is in the conversation and can be saved',
  '已核实':
    'Verified',
  '已核实文件路径':
    'The file path was verified',
  '待核实':
    'To verify',
  '历史文件记录，打开时核实':
    'A historical record, verified when opened',
  '输入文件':
    'Input file',
  '输出文件':
    'Output file',
  '请在保存该文件的桌面端打开':
    'Open it on the desktop where the file was saved',
  '展开 {name} 的路径及操作':
    'Show the path and actions for {name}',
  '保存文件':
    'Save the file',
  '另存为':
    'Save as',
  '这台设备读不了本地文件':
    'This device cannot read local files',
  '读不出来':
    'Could not read it',
  '读取中…':
    'Reading…',
  '预览':
    'Preview',
  '源码':
    'Source',
  '查看预览':
    'Preview it',
  '不在应用里预览。':
    'does not preview inside the app.',
  '用下面的「用默认程序打开」，系统会拿 Word / Excel / PDF 阅读器开。':
    'Use “Open with the default program” below and the system opens it in Word, Excel or a PDF reader.',
  '已复制':
    'Copied',
  '复制路径':
    'Copy the path',
  '复制内容':
    'Copy the content',
  '复制失败':
    'Copy failed',
  '在文件夹中显示':
    'Show in the folder',
  '用默认程序打开':
    'Open with the default program',
  '这个产物只在答案里，没落盘。想留下来就让模型用 write_file 写出去。':
    'This artifact lives in the answer and never hit disk. To keep it, have the model write it out with write_file.',
  '本轮文件与产物':
    'Files and artifacts this round',
  '可从本条回答的文件卡片打开。':
    'Open it from the file card on this answer.',
  '交付验收 · ':
    'Delivery check · ',
  '尚未完成验收':
    'acceptance not finished',
  '已列条件检查通过':
    'every listed condition passed',
  '有条件未通过':
    'a condition failed',
  '有条件无法核验':
    'a condition cannot be verified',
  '清单由模型根据用户要求整理。下列结果只覆盖已列条件，用户是否可用另行记录。':
    'The model built this list from your request. The results below cover the listed conditions only; whether you found it usable is recorded separately.',
  '本任务尚未建立验收清单；程序结束不代表结果已经核实。':
    'This task has no acceptance list. Finishing is not the same as being verified.',
  '未检查':
    'Unchecked',
  '要求版本 {n}':
    'Requirement revision {n}',
  '语义复核，依据已有记录':
    'semantic review against the existing record',
  '仅核对下列程序条件':
    'checks only the program conditions below',
  '指定条数：':
    'Required count: ',
  '必填字段：':
    'Required fields: ',
  '指定原文：':
    'Required text: ',
  '检查时间：':
    'Checked at: ',
  '证据 {n} 项':
    '{n} pieces of evidence',
  '保留 {n} 次要求修订，旧检查不会自动用于新要求。':
    'It keeps {n} revisions of the requirement. An old check never carries over to a new requirement.',
  '要求来源与检查范围':
    'Where the requirement came from, and what was checked',
  '当前版本的要求尚无核验结果。':
    'The current revision has no verification result yet.',
  '进度已保存 · ':
    'Progress saved · ',
  '需要核实操作结果':
    'the result needs verifying',
  '可以从这里继续':
    'you can continue from here',
  '已完成步骤：':
    'Steps done: ',
  '（交付检查见下方）':
    ' (the delivery check is below)',
  '已保存 {n} 个成果文件':
    '{n} output files saved',
  '当前操作：':
    'Current action: ',
  '待处理：':
    'Still to do: ',
  '接着跑':
    'Continue',
  '压缩后继续':
    'Compact, then continue',
  '任务恢复':
    'Resume',
  '压缩会整理可归档的历史，保留用户要求与可检索原文，然后从已保存的位置继续。也可在新对话中审阅交接草稿后再发送。':
    'Compacting files away the archivable history, keeps your requirements and the searchable original, then resumes from the saved position. You can also review a handoff draft in a new chat before sending it.',
  '补充信息后继续':
    'Add information, then continue',
  '补充并接着跑':
    'Add and continue',
  '补充恢复信息':
    'Information for the resume',
  '补充缺少的资料、修正要求或说明接下来怎么做':
    'Supply what was missing, correct the requirement, or say what to do next',
  '我已核实，跳过此步':
    'Verified; skip this step',
  '允许重试此步':
    'Allow this step to retry',
  '暂停运行、恢复并重启':
    'pause, resume and restart the run',
  '下一步：':
    'Next: ',
  '未安装':
    'Not installed',
  '已安装':
    'Installed',
  '待登录':
    'Sign-in needed',
  '连接异常':
    'Connection problem',
  '等待登录':
    'Waiting for sign-in',
  '检测中':
    'Checking',
  '{n} 天窗口':
    '{n}-day window',
  '{n} 小时窗口':
    '{n}-hour window',
  '{n} 分钟窗口':
    '{n}-minute window',
  '当前窗口':
    'Current window',
  '{window}剩余 {percent}%':
    '{window}: {percent}% left',
  '订阅额度':
    'Subscription quota',
  '额度：官方客户端未提供可读取的剩余额度':
    'Quota: the official client exposes no readable balance',
  '额度：尚未检测。':
    'Quota: not checked yet.',
  '额度：{client} 未提供可读取的剩余额度。':
    'Quota: {client} exposes no readable balance.',
  '额度：Claude Desktop 未提供可读取的剩余额度。':
    'Quota: Claude Desktop exposes no readable balance.',
  '未能完成连接检测，请稍后重试。':
    'The connection check did not finish. Try again shortly.',
  '正在检测连接…':
    'Checking connections…',
  '连接官方客户端后，在这里选择模型与思考强度。':
    'Connect an official client, then pick the model and effort here.',
  '使用官方 ChatGPT 登录与 Codex 订阅模型。':
    'Uses your ChatGPT sign-in and Codex subscription models.',
  '使用 Claude Code 的现有账号或 API 配置。':
    'Uses Claude Code’s existing account or API settings.',
  '通过 Kimi 官方 ACP 接口连接。':
    'Connects over Kimi’s official ACP interface.',
  '{client} 模型':
    '{client} model',
  '{client} 思考强度':
    '{client} reasoning effort',
  '官方客户端默认模型':
    'the client’s default model',
  '官方默认':
    'client default',
  '登录 ChatGPT':
    'Sign in to ChatGPT',
  '正在打开…':
    'Opening…',
  '一键连接':
    'Connect',
  '使用此连接':
    'Use this connection',
  '正在使用':
    'In use',
  '选择程序':
    'Pick the program',
  '检测额度':
    'Check the quota',
  '检测额度中…':
    'Checking the quota…',
  '本机订阅客户端':
    'Local subscription clients',
  '本机订阅客户端仅支持桌面版。':
    'Local subscription clients work on the desktop only.',
  'Codex 原生程序':
    'Codex executable',
  '官方 codex 可执行文件的绝对路径':
    'Absolute path to the official codex executable',
  'Claude Code 原生程序':
    'Claude Code executable',
  '官方 claude 可执行文件；留空自动查找':
    'The official claude executable. Leave it empty to search automatically.',
  '官方 ChatGPT 登录':
    'Official ChatGPT sign-in',
  '选择 Codex 程序':
    'Pick the Codex program',
  '选择 Claude 程序':
    'Pick the Claude program',
  '检查本机程序':
    'Check the local programs',
  '检查连接与额度':
    'Check connections and quota',
  '由官方客户端管理登录和订阅。应用只保存程序路径及任务引用，不收集登录凭据。API Key 与订阅是独立来源。':
    'The official client owns the sign-in and the subscription. This app stores only the program path and task references, never credentials. API keys and subscriptions stay separate sources.',
  'Claude Code 请先在官方客户端登录；当前接入保留其权限限制，未获准的操作会暂停处理。订阅客户端可能不提供精确用量，预算会保守占用预留额度。':
    'Sign in to Claude Code in its own client first. This connection keeps its permission limits, so anything unapproved pauses. Subscription clients may not report exact usage, so budgets reserve conservatively.',
  'Claude Desktop 连接':
    'Claude Desktop connection',
  'Claude Desktop 已连接。':
    'Claude Desktop is connected.',
  '配置已写入，等待 Claude Desktop 连接。':
    'The config is written; waiting for Claude Desktop to connect.',
  '尚未配置 Claude Desktop 连接。':
    'No Claude Desktop connection configured yet.',
  '检测失败':
    'Check failed',
  '等待连接':
    'Waiting to connect',
  '未配置':
    'Not configured',
  '请手动打开 Claude Desktop。':
    'Open Claude Desktop yourself.',
  '已打开 Claude Desktop。':
    'Claude Desktop opened.',
  '未能打开 Claude Desktop，请确认已经安装。':
    'Could not open Claude Desktop. Check that it is installed.',
  '当前客户端：':
    'Current client: ',
  '正在对话中使用':
    'In use in this chat',
  '在对话中使用':
    'Use it in this chat',
  '打开 Claude Desktop':
    'Open Claude Desktop',
  '正在配置…':
    'Configuring…',
  '一键配置并打开':
    'Configure and open',
  '正在修复…':
    'Repairing…',
  '修复连接':
    'Repair the connection',
  '本机 AI 连接需要桌面版。':
    'On-device AI needs the desktop build.',
  '连接官方桌面应用，让灯芯AI在对话中按需调用。账号登录和工具授权仍在 Claude Desktop 完成。':
    'Connect the official desktop app so wickrunAI can call it from a chat. Sign-in and tool permissions still happen inside Claude Desktop.',
  '模型在 Claude Desktop 中选择；从对话发送后，还需要在官方应用中点一次发送。':
    'Pick the model inside Claude Desktop. After you send from a chat, you press send once more in the official app.',
  '首次配置后请完全退出并重新打开 Claude Desktop。':
    'After the first configuration, quit Claude Desktop completely and open it again.',
  '数据位置：':
    'Data location: ',
  '创建本机备份':
    'Create a local backup',
  '导出完整归档':
    'Export a full archive',
  '从文件恢复…':
    'Restore from a file…',
  '预览恢复':
    'Preview the restore',
  '确认恢复范围':
    'Confirm what gets restored',
  '关掉':
    'Close',
  '备份包含本机配置、会话内联附件、协作空间、运行检查点和托管隔离文件。外部目录中的原始文件不包含在内。':
    'A backup carries the local config, inline attachments, the team space, run checkpoints and managed isolated files. Original files in outside directories stay out.',
  '导出归档不包含 API Key 与远程连接令牌。本机备份保留可用的加密凭据；跨设备恢复后可能需要重新登录。备份不会自动过期删除。':
    'An exported archive carries no API keys or remote tokens. A local backup keeps the usable encrypted credentials, so restoring on another machine may need a fresh sign-in. Backups never expire on their own.',
  '此备份会替换应用的本地配置与记录。恢复前会保留当前文件；恢复失败时回滚。外部项目原文件不受此操作影响。':
    'Restoring replaces the app’s local config and records. The current files are kept first and rolled back if it fails. Original project files outside stay untouched.',
  'Codex 订阅额度':
    'Codex subscription quota',

  /* 面板、注释与反馈 */
  '关闭': 'Close',
  '隐藏': 'Hide',
  '编辑': 'Edit',
  '助手': 'assistant',
  '当前项目': 'Current project',
  '工作区切换': 'Workspace switch',
  '收起侧栏（Ctrl+B）': 'Collapse the sidebar (Ctrl+B)',
  '拖动调宽度，双击恢复默认': 'Drag to resize, double-click to reset',
  '灯芯AI': 'wickrunAI',
  '任务动态': 'Activity',
  '隐藏任务动态': 'Hide the activity panel',
  '任务进度': 'Task progress',
  '正在进行': 'In progress',
  '最近进度': 'Latest progress',
  '已记录任务进度': 'Progress recorded',
  '查看记录': 'View',
  '查看哪轮任务动态': 'Which round to show',
  '第 {n} 轮': 'Round {n}',
  '{n} 步': '{n} steps',
  '跟随最新': 'Follow the latest',
  '已保存的进度': 'Saved progress',
  '执行中断': 'Execution interrupted',
  '进行中': 'In progress',
  '待完成': 'To do',
  '待质检': 'To verify',
  '受阻': 'Blocked',
  '待质检 · 尚未完成': 'To verify · not finished',
  '验收：': 'Acceptance: ',
  '完成证据': 'Evidence',
  '程序检查': 'Program check',
  '模型复核': 'Model review',
  '质检记录': 'Verification log',
  '已交付的回答原文': 'the delivered answer',
  '已记录步骤：{id}': 'recorded step: {id}',
  '等待开始': 'Queued',
  '处理中': 'Running',
  '已返回': 'Returned',
  '结果待确认': 'Result unconfirmed',
  '{n} 个处理中': '{n} running',
  '{done}/{total} 已返回': '{done}/{total} returned',
  '已完成，但没有返回文字摘要。': 'Finished without a written summary.',
  '尚未返回摘要。': 'No summary yet.',
  '未选择凭据': 'No credential selected',
  '正在检测': 'Checking',
  '已连接': 'Connected',
  '连接失败': 'Connection failed',
  '尚未确认': 'Unconfirmed',
  '检测中…': 'Checking…',
  '重新检测': 'Check again',
  '检测连接': 'Check the connection',
  '当前列表有 {n} 个模型；列表缓存不代表服务在线。':
    'The list holds {n} models. A cached list does not mean the service is up.',
  '当前模型列表为空。': 'The model list is empty.',
  '正在检查 Claude Code CLI 和当前连接配置…':
    'Checking the Claude Code CLI and the current connection…',
  '检查程序和现有账号或 API 配置；仅恢复已明确配置的本机服务。':
    'Checks the program and your existing account or API settings. It only revives local services you configured yourself.',
  '一键连接 OmniRoute': 'Connect OmniRoute',
  '正在恢复…': 'Reconnecting…',
  '正在检查端口、服务和凭据，请稍候。': 'Checking the port, the service and the credential.',
  '恢复检查失败，请稍后重试。': 'The recovery check failed. Try again shortly.',
  '检测已配置的本机地址；服务未启动时在后台启动 OmniRoute。':
    'Checks the configured local address and starts OmniRoute in the background when it is not running.',
  '等待检查': 'Waiting to check',
  '选中文字的操作': 'Actions for the selection',
  '引用所选文字回复': 'Reply quoting the selection',
  '↩ 回复': '↩ Reply',
  '为所选文字添加个人注释': 'Add a private note on the selection',
  '✎ 注释': '✎ Note',
  '✎ 我的注释': '✎ My notes',
  '添加注释': 'Add a note',
  '编辑注释': 'Edit the note',
  '删除注释': 'Delete the note',
  '保存注释': 'Save the note',
  '你的注释': 'Your note',
  '保存在这条消息旁，不会自动发送给模型。':
    'It stays beside this message and never goes to the model on its own.',
  '任务结果反馈': 'How did it go',
  '这次结果可用吗？': 'Was this usable?',
  '可用': 'Usable',
  '撤回反馈': 'Withdraw the feedback',
  '反馈原因': 'Why',
  '主要原因（可选）': 'Main reason (optional)',
  '暂不选择': 'Skip for now',
  '内容错误': 'Wrong content',
  '有遗漏': 'Incomplete',
  '产物问题': 'Artifact problem',
  '未通过': 'Did not pass',
  '无法核验': 'Cannot verify',
  '变更记录': 'Change log',
  '可选，仅保存到本机': 'Optional, kept on this machine only',
  '此前反馈属于较早阶段；这次续跑后的结果尚未评价。':
    'That feedback belongs to an earlier stage. The result after this continuation has not been rated.',
  '选择项目': 'Pick a project',

  /* 授权、确认、强度与用量 */
  '模型申请权限：':
    'Permission requested: ',
  '访问一个新目录':
    'access a new directory',
  '把这个目录加进可读写范围，文件类工具和命令行的 cwd 都能用它。':
    'Adds this directory to the readable and writable scope, and file tools and the shell’s cwd can both use it.',
  '这个目录里的所有内容都会对模型可见，包括你没想到的子目录。':
    'Everything under it becomes visible to the model, including subdirectories you forgot about.',
  '以管理员身份执行命令':
    'run commands as administrator',
  '允许 run_command 提权。每条提权命令仍然会单独问你，系统还会再弹一次 UAC。':
    'Lets run_command elevate. Each elevated command still asks you, and Windows raises its own UAC prompt on top.',
  '管理员权限能改系统、装驱动、关安全软件。给之前先看清楚它到底要跑什么。':
    'Administrator rights change the system, install drivers and switch off security software. Read what it wants to run before you grant this.',
  '截屏并控制鼠标键盘':
    'capture the screen and drive the mouse and keyboard',
  '允许截取屏幕、移动和点击鼠标、模拟键盘输入。':
    'Lets it capture the screen, move and click the mouse, and type.',
  '截屏会把当时屏幕上的一切发给模型背后的服务商，包括另一个窗口里的密码管理器、私信、银行页面。鼠标键盘则意味着它能点任何按钮。':
    'A screenshot sends whatever is on screen to the provider behind the model, including the password manager, the private messages and the bank page in another window. Mouse and keyboard access means it can click any button.',
  '默认只在这次会话有效。选择记住则 {days} 天内不再问，随时可在顶部授权条上撤销':
    'It lasts this session by default. Choose to remember and it stops asking for {days} days, revocable any time from the permission bar at the top.',
  '提权永远只在这次会话有效，而且不提供记住。这种权限每次都该重新点头':
    'Elevation lasts this session only and is never remembered. This one deserves a fresh yes every time.',
  '它要拿这个做什么':
    'What it wants this for',
  '（模型没有给出理由，这本身就值得拒绝）':
    '(the model gave no reason, which is itself a reason to refuse)',
  '同意之后它能做什么':
    'What a yes allows',
  '风险':
    'Risk',
  '这一步要动真格的':
    'This one is for real',
  '拒绝不会中断对话，模型会换个办法继续':
    'Refusing does not end the conversation; the model finds another way',
  '拒绝（Esc）':
    'Refuse (Esc)',
  '同意，仅本次':
    'Allow, this session',
  '同意并记住 {days} 天':
    'Allow and remember for {days} days',
  '模型要调用':
    'The model wants to call',
  '允许执行':
    'Allow',
  '拒绝不会中断对话。模型会收到「用户拒绝了」并换个办法继续。不想每次都问的话，输入框左下角能把档位调成「自动批准编辑」或「全部放行」。':
    'Refusing does not end the conversation. The model hears that you refused and finds another way. To stop being asked, switch the setting at the bottom left of the composer to auto-approve edits or allow everything.',
  '自动思考档位映射':
    'Automatic effort mapping',
  '不下发思考参数':
    'Send no reasoning field',
  '配置面板里手动接管了思考字段，这里不生效':
    'The config panel took over the reasoning field by hand, so this has no effect',
  '配置面板里把「思考字段下发方式」改成了手动，这里选什么都不生效。想用这个刻度，把那边改回「自动（按模型映射）」。':
    'The config panel set the reasoning wire format to manual, so nothing you pick here matters. To use this scale, set it back to automatic by model mapping.',
  '当前路由不下发思考字段':
    'This route sends no reasoning field',
  '当前路由：{style} → {value}':
    'This route: {style} → {value}',
  '这一档尚未配置，发送前需要补充':
    'This level has no value yet and needs one before sending',
  '使用当前端点与模型的单独设置':
    'Uses this endpoint and model’s own settings',
  '当前模型匹配「{label}」{note}':
    'The current model matches “{label}”{note}',
  '（这条是推的，没实测）':
    ' (a guess, never tested)',
  '没有匹配到映射规则':
    'No mapping rule matches',
  '改映射':
    'Edit the mapping',
  '沿用全局映射表':
    'Follow the global mapping table',
  '查看用量':
    'Usage',
  '查看上下文用量与预算':
    'Context usage and budget',
  '上下文用量':
    'Context usage',
  '上下文用量与预算':
    'Context usage and budget',
  '上下文 · ':
    'Context · ',
  '整理中':
    'compacting',
  '本次请求':
    'this request',
  '发送前估算':
    'estimated before sending',
  '约 {n}':
    'about {n}',
  '窗口未知':
    'window unknown',
  '{n} 次':
    '{n}×',
  '较原始记录减少':
    'Reduced from the original',
  '。用量为发送前估算，实际计费以上游 usage 为准。分钟额度影响发送时间。':
    '. Usage is estimated before sending; the provider’s own usage figure is what bills. Per-minute limits affect when it goes out.',
  '系统与项目指令':
    'System and project instructions',
  '对话与文本材料':
    'Conversation and text',
  '工具定义':
    'Tool definitions',
  '工具结果':
    'Tool results',
  '已整理摘要':
    'Compacted summary',
  '图片预估':
    'Images (estimated)',
  '输出预留（含思考）':
    'Reserved output (with reasoning)',
  '分钟额度（请求 / token）':
    'Per-minute limits (requests / tokens)',
  '输入 / 输出额度':
    'Input / output limits',
  '上游确认缓存读取不计入':
    'The provider confirms cached reads do not count',
  '计入 / 未确认':
    'counted / unconfirmed',
  '缓存输入是否占输入额度':
    'Whether cached input counts against the input limit',
  '当前路由能力':
    'This route’s limits',
  '适用于 {profile} · {model}。留空表示未知，优先读取模型元数据和上游明确限额。网关地址改变后重新记录。':
    'Applies to {profile} · {model}. Empty means unknown, and model metadata and the provider’s stated limits win. Change the gateway address and it starts over.',
  '模型上下文窗口':
    'Model context window',
  '单次输出上限（含思考）':
    'Output ceiling per turn (reasoning included)',
  '每分钟总 token':
    'Tokens per minute',
  '每分钟输入 token':
    'Input tokens per minute',
  '每分钟输出 token':
    'Output tokens per minute',
  '每分钟请求数':
    'Requests per minute',
  '未知 / 自动学习':
    'unknown / learned automatically',
  '共享额度组':
    'Shared quota group',
  '例如：我的工作账户':
    'For example: my work account',
  '同一账户或项目的多份凭据可填写相同组名，共用队列；不确定时留空。':
    'Credentials on one account or project can share a group name and a queue. Leave it empty when unsure.',
  '输出与思考兼容设置':
    'Output and reasoning compatibility',
  '输出上限字段':
    'Output ceiling field',
  '沿用生成参数':
    'Follow the generation parameters',
  '不支持此字段':
    'Field unsupported',
  '选择当前网关实际支持的写法；不会自动降低你选择的档位。':
    'Pick what this gateway actually accepts. It never quietly lowers the level you chose.',
  '{level} 思考映射':
    '{level} reasoning mapping',
  '上游支持的字符串':
    'a string the provider accepts',
  '思考 token 预算':
    'reasoning token budget',
  'thinking 对象':
    'thinking object',
  '历史整理目标（非硬上限）':
    'History cleanup target (not a hard cap)',

  /* 协作空间与问答卡片 */
  '请填写成员名称':
    'Give the member a name',
  '请填写任务名称':
    'Give the task a name',
  '请先配置至少一位成员':
    'Set up at least one member first',
  '配置成员':
    'Set up members',
  '请先在设计器保存流程版本':
    'Save a flow version in the designer first',
  '请填写标题':
    'Write a title',
  '请填写名称、目标、验收并选择流程版本':
    'Fill in the name, goal and acceptance, and pick a flow version',
  '协作空间':
    'Team space',
  '协作空间导航':
    'Team space navigation',
  '单一 Agent':
    'Single agent',
  '返回单一 Agent':
    'Back to the single agent',
  '总览':
    'Overview',
  '任务与讨论':
    'Tasks',
  '工作流':
    'Workflows',
  '文件与产物':
    'Files',
  '项目设置':
    'Project settings',
  '运行详情':
    'Run detail',
  '展开侧栏':
    'Open the sidebar',
  '展开侧栏（Ctrl+B）':
    'Open the sidebar (Ctrl+B)',
  '正在读取协作记录…':
    'Reading the team records…',
  '正在保存…':
    'Saving…',
  '尚未保存':
    'Not saved yet',
  '已保存到本机':
    'Saved on this machine',
  '协作空间需要桌面版的本地存储。':
    'The team space needs the desktop build’s local storage.',
  '创建你的协作空间':
    'Create your team space',
  '创建项目':
    'Create a project',
  '项目名称':
    'Project name',
  '先建立项目，再配置成员、目标和流程。':
    'Create the project first, then set up members, goals and the flow.',
  '一起把事情做完':
    'Get it done together',
  '在当前项目里配置成员、讨论方案、执行任务，并检查交付结果。':
    'Set up members in this project, argue the approach, run the tasks and check what came back.',
  '配置第一位成员':
    'Set up the first member',
  '创建协作任务':
    'Create a team task',
  '先创建任务':
    'Create a task first',
  '成员':
    'Members',
  '任务':
    'Tasks',
  '待处理':
    'Pending',
  '已交付':
    'Delivered',
  '最近运行':
    'Recent runs',
  '还没有运行。配置成员与流程后，从任务开始。':
    'No runs yet. Set up members and a flow, then start from a task.',
  '成员人数与职责没有固定模板。':
    'There is no fixed template for how many members or what they do.',
  '从你的第一位成员开始。':
    'Start with your first member.',
  '添加成员':
    'Add a member',
  '添加 Agent':
    'Add an agent',
  '职责、模型与工具分别配置；修改成员会用于新的运行。':
    'Role, model and tools are configured separately. Changes apply to new runs.',
  '已启用':
    'Enabled',
  '已停用':
    'Disabled',
  '停用':
    'Disable',
  '尚未填写职责':
    'No role written yet',
  '未选模型':
    'No model',
  '未配置接入':
    'No connection',
  '配置 Agent':
    'Configure the agent',
  '成员名称':
    'Member name',
  '职责与工作说明':
    'Role and working notes',
  '模型接入':
    'Model connection',
  '选择模型接入':
    'Pick a model connection',
  '模型 ID':
    'Model ID',
  '可用工具与权限范围':
    'Tools and permission scope',
  'API 成员不选择工具时只进行文本协作。本机订阅客户端采用其原生权限：不选工具为只读，选择工具后开放隔离区工作；不支持这里的逐工具白名单。':
    'An API member with no tools selected collaborates in text only. A local subscription client uses its own permissions: read-only with no tools selected, and isolated-workspace access once tools are on. It does not honour the per-tool allowlist here.',
  'Codex · 本机 ChatGPT 订阅':
    'Codex · local ChatGPT subscription',
  'Claude Code · 本机登录':
    'Claude Code · local sign-in',
  'Codex 本机订阅':
    'Codex local subscription',
  'Claude Code 本机登录':
    'Claude Code local sign-in',
  '保存成员':
    'Save the member',
  '管理模型与接入':
    'Manage models and connections',
  '打开全局接入设置':
    'Open the global connection settings',
  '查找任务…':
    'Find a task…',
  '筛选任务':
    'Filter tasks',
  '新任务':
    'New task',
  '＋ 新任务':
    '+ New task',
  '这里还没有符合条件的任务。':
    'No task matches here yet.',
  '从当前单人对话交接':
    'Hand off from the current solo chat',
  '任务名称':
    'Task name',
  '任务目标与验收':
    'Goal and acceptance',
  '验收标准':
    'Acceptance criteria',
  '目标':
    'Goal',
  '保存任务':
    'Save the task',
  '编辑目标':
    'Edit the goal',
  '目标待补充':
    'goal still to write',
  '待填写':
    'to be written',
  '生成可编辑协作流程':
    'Generate an editable flow',
  '选择任务流程':
    'Pick the task flow',
  '选择已有 Workflow':
    'Pick an existing workflow',
  '运行前检查':
    'Pre-run check',
  '交给单一 Agent':
    'Hand it to a single agent',
  '{title} · 自由协作':
    '{title} · free-form collaboration',
  '协作任务：{title}\n目标：{goal}\n验收：{acceptance}\n待继续事项：{next}':
    'Team task: {title}\nGoal: {goal}\nAcceptance: {acceptance}\nStill open: {next}',
  '讨论与决策':
    'Discussion and decisions',
  '补充指令':
    'Added instruction',
  '决策记录':
    'Decision',
  '交接':
    'Handoff',
  '讨论':
    'Discussion',
  '打开关联运行 →':
    'Open the linked run →',
  '收件对象':
    'Recipient',
  '所有成员':
    'All members',
  '你 → ':
    'You → ',
  '补充要求':
    'Added requirement',
  '补充要求将在下一安全步骤采用，并保留采用记录。':
    'An added requirement is taken up at the next safe step, and the adoption is recorded.',
  '记录补充要求':
    'Record the requirement',
  '此任务的运行':
    'Runs for this task',
  '← 任务列表':
    '← Task list',
  '← 全部运行':
    '← All runs',
  '← Workflow 列表':
    '← Workflow list',
  '待开始':
    'Ready',
  '正在暂停':
    'Pausing',
  '等待用户':
    'Waiting on you',
  '结果待核实':
    'Result unverified',
  '失败':
    'Failed',
  '已取消':
    'Cancelled',
  '已完成':
    'Completed',
  '开始运行':
    'Start the run',
  '恢复运行':
    'Resume the run',
  '暂停':
    'Pause',
  '停止运行':
    'Stop the run',
  '所属任务':
    'Its task',
  '需要你的确认':
    'Needs your approval',
  '批准':
    'Approve',
  '拒绝':
    'Reject',
  '先核实已有结果':
    'Verify what is already there',
  '重试会产生新的尝试记录，保留原次数与用量。':
    'A retry creates a new attempt record and keeps the earlier counts and usage.',
  '核实依据':
    'What you verified',
  '填写已检查的结果、外部动作状态或重试范围':
    'Write what you checked, the state of any outside action, or the retry scope',
  '已核实，接受已有结果':
    'Verified; accept what is there',
  '已核实，允许重试此步骤':
    'Verified; allow this step to retry',
  '步骤与证据':
    'Steps and evidence',
  '尚未收到结果':
    'No result yet',
  '运行事件':
    'Run events',
  '运行记录':
    'Run history',
  '打开运行':
    'Open the run',
  '新建 Workflow':
    'New workflow',
  '设计 Workflow':
    'Design a workflow',
  '打开设计器':
    'Open the designer',
  '历史版本':
    'Version history',
  '从空白流程开始。所有坐标、连线、角色和版本都会保存在本机。':
    'Start from a blank flow. Coordinates, edges, roles and versions all save on this machine.',
  '{n} 个版本':
    '{n} versions',
  '已归档':
    'Archived',
  '恢复':
    'Restore',
  '归档':
    'Archive',
  '尚未保存版本。':
    'No version saved yet.',
  '流程名':
    'Flow name',
  '版本（不可变）':
    'Version (immutable)',
  '固定流程版本':
    'Pinned flow version',
  '运行版本':
    'Run the version',
  '保存为版本':
    'Save as a version',
  '请选择版本':
    'Pick a version',
  '选择版本':
    'Pick a version',
  '画布':
    'Canvas',
  '列表编辑':
    'List editor',
  '拖拽端口可新建连线；回退/重做同步更新。':
    'Drag a port to draw an edge. Undo and redo follow along.',
  '错误: {n}':
    'Errors: {n}',
  '警告: {n}':
    'Warnings: {n}',
  '校验':
    'Validate',
  '校验通过。':
    'Validation passed.',
  '节点列表':
    'Nodes',
  '可编辑节点列表':
    'Editable node list',
  '连线可编辑列表':
    'Editable edge list',
  '新增节点':
    'Add a node',
  '新建连线':
    'New edge',
  '新建连线（列表）':
    'New edge (list)',
  '无端口':
    'No port',
  '端口文案':
    'Port label',
  '节点属性':
    'Node properties',
  '先选中一个节点或连线查看属性。':
    'Select a node or an edge to see its properties.',
  '当前选中连线：':
    'Selected edge: ',
  '标题':
    'Title',
  '类型':
    'Type',
  '执行次数上限':
    'Visit limit',
  '输入引用（逗号分隔）':
    'Input references (comma separated)',
  '输出要求':
    'Output requirement',
  '指令':
    'Instructions',
  '成员当前：':
    'Current member: ',
  '讨论成员':
    'Discussion members',
  '条件来源':
    'Condition source',
  '命中文本':
    'Match text',
  '汇合策略':
    'Join strategy',
  '循环':
    'Loop',
  '最大遍历':
    'Max traversals',
  '最大步骤':
    'Max steps',
  '最大 Token':
    'Max tokens',
  '最大分钟':
    'Max minutes',
  '未设置':
    'not set',
  '未知成员':
    'unknown member',
  '未指定':
    'unspecified',
  '{title}（副本）':
    '{title} (copy)',
  '通过':
    'Pass',
  '不通过':
    'Fail',
  '继续':
    'Next',
  '新建 N':
    'New N',
  '撤销':
    'Undo',
  '重做':
    'Redo',
  '放大画布':
    'Zoom in',
  '缩小画布':
    'Zoom out',
  '适应画布':
    'Fit to view',
  '运行':
    'Run',
  '配置':
    'Configure',
  '刷新':
    'Refresh',
  '重新读取':
    'Reload',
  '复制':
    'Copy',
  '检查差异':
    'Inspect the diff',
  '隔离修改':
    'Isolated edit',
  '待合并':
    'To merge',
  '冲突':
    'Conflict',
  '已合并':
    'Merged',
  '主目录':
    'Main directory',
  '主目录已变化':
    'Main directory changed',
  '修改':
    'Modified',
  '文件不存在':
    'No such file',
  '删除文件':
    'File deleted',
  '文件差异 · {path}':
    'File diff · {path}',
  '打开隔离目录':
    'Open the isolated directory',
  '核实并恢复中断合并':
    'Verify and resume the interrupted merge',
  '每位成员使用独立副本；合并前重新核对主目录的文件哈希。':
    'Each member works on their own copy, and the main directory’s file hashes are re-checked before a merge.',
  '执行时复制到成员隔离区，实际文件合并集中到“文件与产物”。':
    'Files are copied into each member’s isolated area at run time, and merges all happen under Files.',
  '隔离副本不包含 .git、node_modules、dist、build、.next；每个目录上限 128 MB。命令工具的工作目录不构成操作系统沙箱。':
    'An isolated copy leaves out .git, node_modules, dist, build and .next, and caps each directory at 128 MB. A command tool’s working directory is not an OS sandbox.',
  '实际执行文件工具时创建隔离区。先在项目设置中选择目录，并为成员启用需要的文件工具。':
    'The isolated area is created when a file tool actually runs. Pick the directories in project settings first and enable the file tools each member needs.',
  '项目经验与证据':
    'Project lessons and evidence',
  '新建经验候选':
    'New candidate lesson',
  '保存候选':
    'Save the candidate',
  '候选':
    'Candidate',
  '已验证':
    'Verified',
  '已采用':
    'Adopted',
  '已失效':
    'Retired',
  '确认验证证据':
    'Confirm the evidence',
  '采用此版本':
    'Adopt this revision',
  '以此内容创建修订':
    'Create a revision from this',
  '经验内容':
    'The lesson',
  '适用条件与失败边界':
    'When it applies, and where it fails',
  '验证证据与来源':
    'Evidence and source',
  '保存有来源、有适用条件的项目经验；采用新版本后用于后续运行。':
    'Keep lessons that carry a source and a scope. Once adopted, later runs use them.',
  '暂时没有经验记录。验证证据由实际测试或人工检查提供，不把模型自评当作能力提升。':
    'No lessons yet. Evidence comes from a real test or a human check, never from the model grading itself.',
  '新建定时任务':
    'New schedule',
  '配置定时任务':
    'Configure the schedule',
  '每天时间':
    'Time of day',
  'IANA 时区':
    'IANA time zone',
  '关闭期间错过时补跑一次':
    'Catch up once if it was missed while closed',
  '启用后续触发':
    'Enable future firings',
  '暂停后续触发':
    'Pause future firings',
  '应用打开时执行。关闭期间的触发按你选择的规则处理。':
    'It fires while the app is open. Firings missed while it was closed follow the rule you pick.',
  '还没有定时任务。先为流程保存一个可运行版本。':
    'No schedules yet. Save a runnable version of a flow first.',
  '时区或时间无效':
    'Invalid time zone or time',
  '选择任务':
    'Pick a task',
  '确认范围并开始':
    'Confirm the scope and start',
  '本次任务':
    'This task',
  '尚未填写':
    'not written',
  '项目目录':
    'Project directories',
  '选择项目目录':
    'Pick a project directory',
  '未选择；文件工具不可执行':
    'none selected, so file tools cannot run',
  '允许的模型接入':
    'Allowed model connections',
  '不勾选时使用已配置的全部 API 连接；运行仍需成员的有效 Key。':
    'Leave them unchecked and every configured API connection is allowed. A run still needs each member’s working key.',
  '权限与总预算':
    'Permissions and budgets',
  '批准方式':
    'Approval mode',
  '每次危险动作确认':
    'Confirm every risky action',
  '危险动作逐项批准':
    'every risky action approved individually',
  '自动批准编辑，命令需确认':
    'edits auto-approved, commands confirmed',
  '全部批准':
    'everything approved',
  '并发步骤上限':
    'Concurrent step limit',
  '每次运行总 tokens':
    'Tokens per run',
  '每次运行总分钟':
    'Minutes per run',
  '每步 tokens 上限':
    'Tokens per step',
  '每步分钟上限':
    'Minutes per step',
  '实际费用由连接提供方决定，当前无法可靠估算。运行受流程和项目的 tokens、时间及次数上限约束。':
    'The provider decides the real cost, and nothing here estimates it reliably. A run is bounded by the flow’s and the project’s token, time and count limits.',
  '数据与备份':
    'Data and backup',
  '导出成员与流程配置模板':
    'Export a member and flow template',
  '配置模板不含密钥、对话、运行或文件内容。下方完整备份包含本机所有项目及托管附件；导出时移除凭据。':
    'The template carries no keys, conversations, runs or file contents. The full backup below carries every project on this machine plus managed attachments, with credentials stripped on export.',
  '项目、角色、坐标、连线、历史版本与运行记录都保存在稳定的本地用户目录。更新不会重新套用模板。':
    'Projects, roles, coordinates, edges, version history and run records live in a stable local user directory. An update never re-applies a template.',
  '自由连接节点，使用条件和有限回路表达讨论、返工与退出。':
    'Wire nodes freely, and use conditions and bounded loops for discussion, rework and exit.',
  '交接将保留原对话引用，仅带入上方预览的目标。你可以编辑后保存。':
    'A handoff keeps the reference to the original chat and brings only the goal previewed above. Edit it before saving.',
  '以下内容已保存到当前会话。':
    'This is saved to the current session.',
  '从':
    'from',
  '到':
    'to',
  '名称':
    'Name',
  '文案':
    'Label',
  '负责人':
    'Owner',
  '草稿':
    'Draft',
  '请回答以下问题':
    'Answer these questions',
  '待回答问题':
    'Open question',
  '问题回答':
    'Answers',
  '{n} 个问题':
    '{n} questions',
  '选择一项或多项，也可以填写补充回答。':
    'Pick one or more, and add a written answer if you want.',
  '补充回答':
    'Written answer',
  '补充回答：':
    'Written answer: ',
  '（可选）':
    ' (optional)',
  '请填写回答':
    'Write an answer',
  '可以补充说明':
    'Add a note if you want',
  '未提供回答':
    'no answer given',
  '选择：':
    'Chose: ',
  '每个问题都需要选择或填写回答。':
    'Every question needs a choice or a written answer.',
  '回答无效，请检查后重试':
    'That answer is not valid. Check it and try again.',
  '提交回答':
    'Submit',
  '查看 / 修订':
    'View / revise',

  /* 工作区与任务记录 */
  '工作区':
    'Workspace',
  '项目':
    'Projects',
  '技能':
    'Skills',
  '定时任务':
    'Scheduled tasks',
  '项目 = 一组对话 + 一份共享上下文。同一个项目里新开的对话自动继承规范、记忆、文档清单和常用提示词。':
    'A project is a set of chats plus one shared context. New chats inside it inherit the rules, the memory, the document list and the saved prompts.',
  '文档正文不会每轮都塞进去':
    'Document bodies do not ride along every round',
  '。只给模型一份目录，它需要时用 project_doc_read 按名字取。一个项目攒几万字很正常，全量注入等于每轮重付一次钱。':
    '. The model gets an index and fetches what it needs by name with project_doc_read. A project easily holds tens of thousands of characters, and sending all of it every round means paying for it again each time.',
  '还没有项目。建一个，把相关的对话归到一起。':
    'No projects yet. Make one and group related chats under it.',
  '＋ 新建项目':
    '+ New project',
  '删除项目「{name}」？里面的对话会保留，只是不再归属任何项目。':
    'Delete the project “{name}”? Its chats stay; they just stop belonging to a project.',
  '项目规范':
    'Project rules',
  '拼进这个项目里每一轮的 system prompt。写约定、口径、禁忌 —— 别写具体任务。':
    'Goes into the system prompt every round in this project. Write conventions, wording and things to avoid. Not specific tasks.',
  '例如：所有代码用 TypeScript strict；回答先给结论再给推导；金额一律标明币种。':
    'For example: all code in TypeScript strict; give the conclusion before the reasoning; always state the currency.',
  '项目记忆':
    'Project memory',
  '模型用 project_memory_write 往里追加跨对话的结论。这里可以直接改或清空。太长会挤占每轮的上下文，超过两万字会自动截断最早的部分。':
    'The model appends cross-chat conclusions here with project_memory_write. Edit or clear it directly. It competes for context every round, and past twenty thousand characters the oldest part gets trimmed.',
  '文档':
    'Documents',
  '文档 {n}':
    'Document {n}',
  '＋ 加一篇文档':
    '+ Add a document',
  '常用提示词':
    'Saved prompts',
  '在这个项目里、输入框还空着的时候，会以小胶囊的形式出现在输入框上方，点一下填进去。':
    'Inside this project, while the composer is empty, these show as chips above it. Click one to fill it in.',
  '按钮上显示的短名':
    'Short name on the button',
  '点了之后填进输入框的内容':
    'What the click puts in the composer',
  '新提示词':
    'New prompt',
  '＋ 加一条':
    '+ Add one',
  '默认模型':
    'Default model',
  '模型（留空跟随全局）':
    'Model (empty follows the global default)',
  '默认凭据':
    'Default credential',
  '跟随全局凭据':
    'Follow the global credential',
  '在这个项目里新开对话时套上。留空就用全局默认。':
    'Applied to new chats in this project. Empty uses the global default.',
  '跟随全局':
    'Follow the global setting',
  '留空 = 跟随全局':
    'Empty follows the global setting',
  '不属于项目':
    'No project',
  '与本地文件夹双向同步':
    'Two-way sync with a local folder',
  '文件夹同步只在桌面端可用（手机端没有本地文件系统）。':
    'Folder sync works on the desktop only. Phones have no local filesystem.',
  '例如 C:\\Users\\你\\.claude\\skills':
    'For example C:\\Users\\you\\.claude\\skills',
  '用默认':
    'Use the default',
  '同步':
    'Sync',
  '同步中…':
    'Syncing…',
  '打开':
    'Open',
  '启动时自动同步一次':
    'Sync once at startup',
  '已填入 {path}':
    'Filled in {path}',
  '先填一个目录':
    'Give it a directory first',
  '扫描目录…':
    'Scanning the directory…',
  '✗ 读取失败：{reason}':
    '✗ Could not read: {reason}',
  '✗ 写入失败：{reason}':
    '✗ Could not write: {reason}',
  '写出 {n} 个…':
    'Writing {n}…',
  '部分写入失败：{list}':
    'Some writes failed: {list}',
  '未知原因':
    'no reason given',
  'Claude Code 和 Claude Desktop 读的就是 ~/.claude/skills/<名字>/SKILL.md，指到那里就能跟它们共用同一批技能。':
    'Claude Code and Claude Desktop read ~/.claude/skills/<name>/SKILL.md. Point it there and you share the same skills with them.',
  '只新增和更新，永不删除任何一边。':
    'It adds and updates, and deletes on neither side.',
  '两边都改过的会各留一份，进来的那份叫「<名字>-来自文件夹」。这里不猜谁更该保留：按时间戳挑新的那种做法，迟早会悄悄吃掉你半小时的修改。':
    'Edited on both sides, each copy survives, and the incoming one arrives as “<name>-from-folder”. It does not guess which to keep: picking the newer timestamp eventually eats half an hour of your work without telling you.',
  '技能 = 一段写好的指令，在输入框打 /名字 唤起，唤起时作为额外的 system 消息注入这一轮。':
    'A skill is a written instruction. Type /name in the composer to call it, and it goes in as an extra system message for that round.',
  '技能是提示词，不是可执行代码':
    'A skill is a prompt, not executable code',
  '。装一个技能不会在你机器上跑任何东西，所以不需要沙箱。格式跟 Anthropic 的 SKILL.md 一致，GitHub 上现成的技能仓库能直接装。':
    '. Installing one runs nothing on your machine, so it needs no sandbox. The format matches Anthropic’s SKILL.md, so skill repositories on GitHub install as they are.',
  '也可以直接跟模型说「把刚才那套流程存成技能」，它会用 skill_write 自己写一个。':
    'You can also tell the model to save what it just did as a skill, and it writes one with skill_write.',
  '从 GitHub 安装':
    'Install from GitHub',
  'owner/repo 或 https://github.com/owner/repo/tree/main/skills':
    'owner/repo, or https://github.com/owner/repo/tree/main/skills',
  '安装':
    'Install',
  '装…':
    'Installing…',
  '连接':
    'Connect',
  '连接 GitHub…':
    'Connecting to GitHub…',
  '找到 {n} 个：{names}':
    'Found {n}: {names}',
  '会找这几个位置：给定路径本身、路径下的 md 文件、下一层每个目录、仓库根的 skills/ 和 .claude/skills/。文件名不限于 SKILL.md：只要开头的 --- 块里有 name 或 description 就认，README.md 排在最后。也可以把地址直接指到某个具体的 .md 文件。私有仓库需要在 设置 → 工具 → GitHub 里填 token。':
    'It looks at the path itself, md files under it, every directory one level down, and skills/ and .claude/skills/ at the repository root. The filename need not be SKILL.md: any file whose opening --- block carries a name or description counts, with README.md tried last. You can also point the address at one specific .md file. Private repositories need a token under Settings → Tools → GitHub.',
  '还没有技能。从 GitHub 装一个，或者手写一个。':
    'No skills yet. Install one from GitHub, or write one.',
  '＋ 手写一个':
    '+ Write one',
  '共 {n} 个':
    '{n} total',
  '一句话说明什么时候用':
    'One line on when to use it',
  '正文':
    'Body',
  '技能的指令正文，Markdown。写成自包含的操作说明，别依赖某次对话的上下文。':
    'The skill’s instructions, in Markdown. Write them self-contained rather than leaning on one conversation’s context.',
  '来源：{source} · 用过 {uses} 次 · 正文 {kb} KB':
    'From {source} · used {uses} times · {kb} KB',
  ' ⚠ 这个技能很大，每次唤起都会整段进上下文，注意 token 消耗':
    ' ⚠ This skill is large, and every call puts the whole thing in the context. Watch the tokens.',
  '复制成 SKILL.md':
    'Copy as SKILL.md',
  '从剪贴板粘 SKILL.md':
    'Paste SKILL.md from the clipboard',
  '到点自动发一条消息给模型，工具照常能用。':
    'At the set time it sends the model a message, with tools as usual.',
  '说清楚边界：调度器跑在应用里，应用关着就不会触发。':
    'One limit worth stating: the scheduler lives in the app, so a closed app fires nothing.',
  '还没有定时任务。':
    'No scheduled tasks yet.',
  '＋ 新建任务':
    '+ New task',
  '任务 {n}':
    'Task {n}',
  '启用':
    'Enabled',
  '什么时候跑':
    'When it runs',
  '每':
    'Every',
  '每隔':
    'Every',
  '每天':
    'Daily',
  '每周':
    'Weekly',
  '分':
    'min',
  '时':
    'h',
  '分钟':
    'minutes',
  '周日':
    'Sun',
  '周一':
    'Mon',
  '周二':
    'Tue',
  '周三':
    'Wed',
  '周四':
    'Thu',
  '周五':
    'Fri',
  '周六':
    'Sat',
  'cron 表达式':
    'cron expression',
  '标准 5 段：分 时 日 月 周。支持 * , - / 。例如 0 9 * * 1-5 = 工作日早上九点。':
    'Five standard fields: minute hour day month weekday, with * , - / supported. 0 9 * * 1-5 means 9am on weekdays.',
  '解析不了。标准 5 段：分 时 日 月 周':
    'Cannot parse it. Five fields: minute hour day month weekday',
  '不限起点':
    'No start limit',
  '要它做什么':
    'What it should do',
  '每次触发就把这段话当成一条新消息发出去。写清楚，它看不到之前的对话。':
    'Each firing sends this text as a new message. Write it plainly; it cannot see earlier conversation.',
  '例如：搜一下昨天美股收盘后有哪些和半导体相关的重要新闻，按重要性给我三条，带来源。':
    'For example: find the significant semiconductor news after yesterday’s US close and give me three items by importance, with sources.',
  '每次开新对话':
    'A new chat each time',
  '都追加到同一个':
    'Append to the same one',
  '错过了补跑':
    'Catch up on a missed run',
  '下次 {time}':
    'next {time}',
  '上次 {time}':
    'last {time}',
  '未启用':
    'off',
  '权限':
    'Permission',
  '额度':
    'Quota',
  '验收':
    'Acceptance',
  '阶段预算':
    'Stage budget',
  '导出时':
    'On export',
  '其他':
    'Other',
  '（空）':
    '(empty)',
  '先看任务实际结果，再定位问题。统计保留最近 90 天、最多 500 个任务，并受 4MB 索引容量限制；未反馈或未继续均不算失败。数据保存于本机。':
    'Look at what a task delivered before you chase the cause. Records cover the last 90 days and 500 tasks within a 4MB index. No feedback and no continuation both count as neither success nor failure. Everything stays on this machine.',
  '统计暂时无法读取':
    'The records cannot be read right now',
  '任务开始日期':
    'Started on or after',
  '截至日期':
    'Up to',
  '曾使用的模型':
    'Model used',
  '全部模型':
    'All models',
  '曾使用的版本':
    'Version used',
  '全部版本':
    'All versions',
  '当前范围：{n} 个任务':
    'Current range: {n} tasks',
  '新任务运行后会逐步记录；没有记录不代表没有使用过。':
    'Records build up as tasks run. No record does not mean nothing ran.',
  '已列验收条件全部通过 {accepted} 个；未建清单或含未检查条件 {unchecked} 个；含未通过条件 {failed} 个；含无法核验条件 {unverifiable} 个。后三类可重叠。':
    '{accepted} tasks passed every listed acceptance condition. {unchecked} have no list or an unchecked condition, {failed} have a failed one and {unverifiable} have one that cannot be verified. Those last three overlap.',
  '当前阶段的用户反馈 {feedback}/{total} 个任务：可用 {usable}、部分可用 {partial}、未解决 {unresolved}。未反馈结果未知。':
    'You gave current-stage feedback on {feedback} of {total} tasks: {usable} usable, {partial} partly usable, {unresolved} unresolved. The rest are unknown.',
  '另有 {n} 个任务只保留较早阶段的反馈。':
    '{n} more carry feedback from an earlier stage only.',
  '运行改进依据':
    'What the improvements rest on',
  '结束状态不等于任务质量。当前范围中，{noList} 个已结束任务没有验收清单；{withHarness} 个任务有新版执行检查记录。':
    'Finishing is not the same as finishing well. In this range {noList} finished tasks carry no acceptance list, and {withHarness} carry the newer execution-check record.',
  '提前结束检查触发续跑 {continuations} 次；临时子代理返回 {done}/{total} 个。旧记录缺少这些字段，不能当成零失败。':
    'The early-finish check triggered {continuations} continuations, and ad-hoc subagents returned {done} of {total}. Older records lack these fields, so do not read them as zero failures.',
  '改进流程：选取未解决或遗漏的任务，导出脱敏排查包，提出具体修复，再用相同任务核对正确性、耗时和用量。通过回归检查后才更新执行规则；用户反馈与模型自查分别统计，不自动改写项目规范。':
    'How improvement runs: pick the unresolved or missed tasks, export a redacted bundle, propose a specific fix, then re-check correctness, time and usage on the same tasks. Execution rules change only after the regression passes. Your feedback and the model’s self-check are counted apart, and neither rewrites the project rules on its own.',
  '已保存的任务':
    'Saved task',
  '执行结束':
    'Finished',
  '已暂停':
    'Paused',
  '执行中':
    'Running',
  '等待额度':
    'Waiting on quota',
  '等待用户确认':
    'Waiting on you',
  '中断待核实':
    'Interrupted, needs checking',
  '状态未知':
    'Status unknown',
  '未知':
    'unknown',
  '确认可用':
    'confirmed usable',
  '部分可用':
    'partly usable',
  '未解决':
    'unresolved',
  '未反馈':
    'no feedback',
  '较早阶段反馈：':
    'earlier-stage feedback: ',
  '未建立验收清单':
    'no acceptance list',
  '{failed} 项未通过':
    '{failed} failed',
  '{unchecked} 项未检查':
    '{unchecked} unchecked',
  '{unverifiable} 项无法核验':
    '{unverifiable} unverifiable',
  '已列 {total} 项通过（程序 {program}／模型 {model}）':
    'all {total} passed ({program} by program, {model} by model)',
  '续跑 {resumes} 次 · 暂停 {pauses} 次':
    'resumed {resumes}× · paused {pauses}×',
  '有观测缺口或明细裁剪，导出报告中会注明。':
    'There are gaps or trimmed detail, and the report says so.',
  '查看任务':
    'Open the task',
  '选择排查':
    'Select for diagnosis',
  '导出使用分析包':
    'Export a usage-analysis bundle',
  '导出指定任务排查包':
    'Export a diagnostic bundle for this task',
  '默认包含状态、检查方法、用量和事件关联；不包含对话正文、完整路径、接口地址、凭据或思考内容。':
    'It carries status, check method, usage and event links. It carries no conversation text, full paths, endpoints, credentials or reasoning.',
  '隐藏模型名称':
    'Hide model names',
  '改为导出当前范围全部任务':
    'Export every task in range instead',
  '选择需要分享的具体片段（可选）':
    'Pick specific excerpts to share (optional)',
  '仅在需要核对内容时选择。常见凭据会替换，请在导出预览中检查剩余私人信息；每个片段最多 20,000 字符。':
    'Pick these only when someone has to read the content. Common credentials are replaced; check the preview for anything private left behind. Each excerpt caps at 20,000 characters.',
  '用户原始要求':
    'Your original request',
  '已输出的答案':
    'The answer produced',
  '错误说明':
    'Error detail',
  '用户补充 {n}':
    'Your addition {n}',
  '验收说明 {n}':
    'Acceptance note {n}',
  '工具结果 {n} · {name}':
    'Tool result {n} · {name}',
  '只包含明确选择的片段；不包含凭据存储或思考内容。常见凭据已替换，但分享前仍需检查自行选择的正文。':
    'Only the excerpts you picked. No credential store and no reasoning. Common credentials are replaced, and the text you picked is still yours to check before sharing.',
  '生成导出预览':
    'Build the export preview',
  '预览文件':
    'Preview file',
  '预览显示前 100,000 字符，导出包含完整文件。':
    'The preview shows the first 100,000 characters. The export carries the whole file.',
  '保存导出包':
    'Save the bundle',
  '保存当前预览快照；不会自动上传。':
    'Saves the previewed snapshot. Nothing uploads.',
  '已交给浏览器下载，可将导出包交给助手分析。':
    'Handed to the browser to download. You can pass the bundle to an assistant.',
  '记录范围与清理':
    'What is kept, and clearing it',
  '当前索引自 {since} 开始；此前任务不自动推断成功。累计裁剪 {dropped} 个任务、统计读写问题 {failures} 次。每任务最多保留 200 条事件；超过追踪上限后仅更新汇总并标明缺口。删除对话会删除关联统计。':
    'The index starts at {since}; nothing before it is assumed successful. {dropped} tasks have been trimmed and {failures} read or write problems recorded. Each task keeps at most 200 events, and past that only the summary updates, with the gap marked. Deleting a chat deletes its records.',
  '清空会删除统计和反馈，并重置导出标识；原任务和文件仍保留。旧任务不会重新进入统计。':
    'Clearing removes the records and feedback and resets the export marker. The tasks and files stay. Old tasks do not come back into the statistics.',
  '确认清空统计':
    'Yes, clear the records',
  '清空统计与反馈':
    'Clear records and feedback',
  '缺少信息/能力':
    'Missing information or capability',
  '外部结果不确定':
    'Outside result uncertain',
  '没有观察到暂停':
    'No pauses observed',
  '暂无记录':
    'No records yet',
  '当前没有符合以上规则的记录；这不证明所有任务正确。':
    'No record matches the rules above, which does not prove every task was right.',

  /* 错误诊断与回答区 */
  '账号隐私或路由限制排除了可用端点':
    'Account privacy or routing rules ruled out every endpoint',
  '当前模型没有支持图片输入的可用端点':
    'This model has no endpoint that takes image input',
  '当前模型没有支持工具调用的可用端点':
    'This model has no endpoint that takes tool calls',
  '当前请求没有可用的上游端点':
    'No upstream endpoint can serve this request',
  '网关连接已建立，但上游没有返回有效内容':
    'The gateway connected, but the provider returned nothing usable',
  '暂时达到调用额度，等待后继续':
    'Quota reached for now. It continues after a wait.',
  '请求被取消了':
    'The request was cancelled',
  '等了太久没等到响应':
    'Nothing came back in time',
  '连不上这个端点':
    'Cannot reach this endpoint',
  '请求失败':
    'The request failed',
  '这份凭据没通过验证':
    'This credential did not pass authentication',
  '这个账号的额度用完了':
    'This account is out of quota',
  '被上游限流了（不是出错，是发太快）':
    'The provider rate-limited you. Nothing broke; you sent too fast.',
  '上游说没有 {model} 这个模型':
    'The provider says {model} does not exist',
  '上游未找到这次请求对应的资源':
    'The provider found no resource for this request',
  '这条路由要在网关那台机器上跑 {binary}，但它没装':
    'This route runs {binary} on the gateway machine, and it is not installed there',
  '这条路由背后的命令行工具没装':
    'The command-line tool behind this route is not installed',
  '上游开了流，但一个内容都没发过来':
    'The provider opened a stream and sent no content',
  '{model} 这条路由在服务端是坏的':
    '{model} is broken on the provider’s side',
  '上游返回了 {status}，多半是抖了一下':
    'The provider answered {status}, most likely a blip',
  '{model} 不认识图片':
    '{model} does not read images',
  '{model} 不接受我们下发的思考强度字段':
    '{model} rejects the reasoning-effort field we send',
  '上下文超出这个模型的窗口了':
    'The context ran past this model’s window',
  '{model} 不支持工具调用':
    '{model} does not support tool calls',
  '上游说这个请求体它不认':
    'The provider does not recognize this request body',
  '请求失败（HTTP {status}）':
    'The request failed (HTTP {status})',
  '答到一半被 max_tokens 截断了':
    'max_tokens cut the answer off midway',
  '上游的内容过滤把这次回答拦下了':
    'The provider’s content filter stopped this answer',
  '有 {n} 个工具调用只传了一半就断了':
    '{n} tool calls arrived half-sent',
  '上游说这轮要调工具，但工具调用没传过来':
    'The provider announced tool calls this round and never sent them',
  '上游把流开了，但一个字都没发过来':
    'The provider opened a stream and sent not one character',
  '当前模型':
    'the current model',
  '到 OpenRouter 的 https://openrouter.ai/settings/privacy 核对 ZDR（零数据留存）和免费端点设置':
    'Check ZDR (zero data retention) and free-endpoint settings at https://openrouter.ai/settings/privacy',
  '只有接受对应端点的数据政策时才调整设置；也可以保留当前隐私要求，选择符合要求的模型':
    'Change the setting only if you accept that endpoint’s data policy. You can also keep your privacy requirement and pick a model that meets it.',
  '这不是模型 ID 或 Base URL 写错；应用不会自动放宽账号隐私限制':
    'This is not a wrong model ID or Base URL. The app never loosens your account privacy rules on its own.',
  '选择支持图片输入的模型，或在新对话中只发送文字':
    'Pick a model that takes images, or start a new chat with text only',
  '历史消息中的图片也会随上下文发送，仅删除本轮附件可能仍会被拒绝':
    'Images in earlier messages travel with the context, so dropping this turn’s attachments may not be enough',
  '选择支持工具调用的模型；免费路由会按本次请求需要的能力筛选端点':
    'Pick a model that supports tool calls. Free routes filter endpoints by what this request needs.',
  '纯文字聊天也可能带有询问工具，请使用支持工具的模型继续当前任务':
    'Even a text chat can carry the ask-user tool, so continue this task on a model that supports tools',
  '查看下方上游原文，核对模型支持的能力、路由条件和账号设置':
    'Read the provider’s raw text below and check the model’s capabilities, the routing rules and your account settings',
  '刷新模型列表后选择另一个可用模型；免费端点的供应情况可能变化':
    'Reload the model list and pick another one. Free endpoints come and go.',
  '切换具体的可用路由，或在网关中检查当前供应商、账号状态与原始错误':
    'Switch to a route that works, or check the provider, account status and raw error in your gateway',
  '可以关闭流式做一次对照诊断；这类错误不代表本机网关没有启动':
    'Turn streaming off for one comparison run. This error does not mean your local gateway is down.',
  '已有任务现场会保留，避免连续点击重新发送':
    'The run is kept, so resist hammering resend',
  '思考强度高的模型首字很慢，把设置 → 外观旁边的「请求超时」调大（默认 180 秒）':
    'Models at high reasoning effort take a while to say anything. Raise the request timeout under Settings → Appearance (180s by default).',
  '关掉流式响应会更容易超时，长回答建议开着流式':
    'Turning streaming off makes timeouts more likely. Keep it on for long answers.',
  '换一个更快的模型试试，确认是这条路由慢还是全都慢':
    'Try a faster model to see whether this route is slow or everything is',
  '检查设置 → API 凭据里的 Base URL 有没有写错（要带 /v1 这类路径前缀）':
    'Check the Base URL under Settings → API credentials, including the /v1 style path prefix',
  '如果是自建网关，确认它现在是开着的，并且这台机器能访问到':
    'For a self-hosted gateway, confirm it is running and this machine can reach it',
  '公司网络 / 代理可能挡了出网，换个网络试一次':
    'A corporate network or proxy may be blocking outbound traffic. Try another network.',
  '原文在下面，如果反复出现可以带着它开 issue':
    'The raw text is below. Bring it to an issue if this keeps happening.',
  '到设置 → API 凭据里重新粘一次「{profile}」的 Key，注意首尾空格':
    'Paste the key for “{profile}” again under Settings → API credentials, and watch for stray spaces',
  '到设置 → API 凭据里重新粘一次当前凭据的 Key，注意首尾空格':
    'Paste the current credential’s key again under Settings → API credentials, and watch for stray spaces',
  'Base URL 和 Key 要配套：拿 A 家的 key 去打 B 家的地址一定是 401':
    'Base URL and key have to match. One vendor’s key against another’s address always gives 401.',
  '点一下「测试连接」，能拉到模型列表才说明凭据是通的':
    'Hit Test connection. The credential works only if the model list comes back.',
  '去上游控制台看一下余额 / 免费额度是不是到期了':
    'Check the balance and free-tier expiry in the provider’s console',
  '换一份别的凭据：输入框左下角可以切，不影响别的会话':
    'Switch credentials at the bottom left of the composer. Other chats keep theirs.',
  '等几秒重发就行。应用已经会自动退避重试，这条说明重试次数也用完了':
    'Wait a few seconds and resend. The app already backs off and retries, so this means the retries ran out too.',
  '工具轮次开得高时一轮要打好几次接口，把「工具轮次上限」调低能少撞几次':
    'A high tool-round limit means several API calls per round. Lower it and you hit the limit less.',
  '同一个 key 在别处也在跑的话，额度是共享的':
    'A key running elsewhere shares the same quota',
  '换一份凭据或换一条不那么热门的路由':
    'Switch credentials, or take a less crowded route',
  '点模型选择器里的 ↻ 重新拉一次列表，手动加的 ID 可能已经下线了':
    'Hit ↻ in the model picker to reload the list. An ID you added by hand may be retired.',
  '确认 Base URL 对：同一个 ID 在不同网关下的写法可能不一样（有的要带 owner/ 前缀）':
    'Check the Base URL. The same ID is spelled differently across gateways, and some want an owner/ prefix.',
  '在选择器里搜一个相近的名字换上':
    'Search the picker for a close name and switch to it',
  '查看上游原文，确认是模型、请求路径还是路由条件导致的 404':
    'Read the provider’s raw text to see whether the model, the path or a routing rule produced the 404',
  '核对 API 凭据中的 Base URL，并刷新模型列表':
    'Check the Base URL on the credential and reload the model list',
  '换一个模型。这跟你的请求无关，是 {binary} 可执行文件不在网关的 PATH 里':
    'Switch models. Your request is fine; the {binary} executable is missing from the gateway’s PATH.',
  '换一个模型。这跟你的请求无关，是那个可执行文件不在网关的 PATH 里':
    'Switch models. Your request is fine; that executable is missing from the gateway’s PATH.',
  '如果那个网关就跑在你自己电脑上，装好 {binary} 并确保命令行里直接敲 {binary} 能跑通，再重启网关':
    'If that gateway runs on your own computer, install {binary}, check that typing {binary} works in a terminal, then restart the gateway',
  '如果网关是你自己跑的，看它的日志确认缺哪个命令':
    'If you run the gateway, read its log to see which command is missing',
  '重试没有意义，缺的可执行文件不会因为多等一会儿就出现':
    'Retrying changes nothing. A missing executable does not appear because you waited.',
  '把流式关掉再发一次。非流式下上游能返回完整的错误说明，多半会直接告诉你真实原因（余额、配额、路由不可用）。开着流式时它已经没法回一个正经错误码了':
    'Turn streaming off and send again. Without streaming the provider returns a full error body, which usually names the real cause: balance, quota, or an unavailable route. Once a stream is open it can no longer answer with a proper error code.',
  '这条路由如果是按量计费的，先去上游控制台看一眼余额':
    'If this route bills by usage, check your balance in the provider’s console first',
  '换一条能用的路由（比如网关里的 auto）':
    'Take a route that works, such as auto in the gateway',
  '换一个模型。这个错误来自上游服务器内部（环境变量、沙箱路径之类），客户端改什么都没用':
    'Switch models. This error comes from inside the provider’s server (environment variables, sandbox paths), and nothing you change on the client helps.',
  '在模型选择器里点「批量体检」，一次性筛出这个网关上所有能用/不能用的模型':
    'Run the batch health check in the model picker to sort every model on this gateway into working and not',
  '如果整个网关的模型全都这样，那是网关或你的 key 的问题，去上游控制台看看':
    'If every model on the gateway does this, the gateway or your key is the problem. Check the provider’s console.',
  '稍等重试，网关类 5xx 经常是瞬时的':
    'Wait and retry. Gateway 5xx errors are often momentary.',
  '连着几次都这样就换个模型，或者去上游状态页看看':
    'Several in a row means switch models, or check the provider’s status page',
  '换一个多模态模型再发这张图（名字里常带 vl / vision / flash-lite 之类）':
    'Send this image to a multimodal model instead. Their names often carry vl, vision or flash-lite.',
  '或者把图片从输入框里去掉，只发文字':
    'Or drop the image from the composer and send text only',
  '把输入框右下角的思考强度调成「不下发」，这一条最快':
    'Set reasoning effort to “send nothing” at the bottom right of the composer. That is the fastest fix.',
  '如果模型名里本来就带 high / thinking 这类后缀，强度已经烤在路由里了，再叠字段就会 400。去设置 → 思考强度确认「模型名自带强度」那条规则排在第一位':
    'When a model name already carries a high or thinking suffix, the effort is baked into the route and adding the field gives 400. Under Settings → Reasoning effort, put the “effort in the model name” rule first.',
  '这个厂商的映射写错了的话，在同一页改那一行就行，不用改代码':
    'If that vendor’s mapping is wrong, fix the row on the same page. No code change needed.',
  '在右侧配置面板把「携带历史条数」限制一下（注意这会打断上下文缓存）':
    'Cap the carried history in the config panel on the right, which does break the context cache',
  '开一条新对话，或者用 ⑂ 从某一步分叉，把前面的包袱甩掉':
    'Start a new chat, or fork from a step with ⑂ and leave the baggage behind',
  '换一个窗口更大的模型':
    'Move to a model with a larger window',
  '在右侧配置面板关掉「给模型下发工具」，纯聊天就能用':
    'Turn off tool sending in the config panel on the right and plain chat works',
  '要用工具就换一个支持 function calling 的模型':
    'For tools, switch to a model that supports function calling',
  '右侧配置面板里把刚勾上的生成参数取消掉试试。没勾的参数不会下发，逐个排除最快':
    'Uncheck the generation parameters you just enabled. Unchecked ones never go out, so eliminating them one at a time is quickest.',
  '思考强度调成「不下发」再试一次':
    'Set reasoning effort to “send nothing” and try again',
  '配置面板的「预览请求体」能看到实际发出去的内容，对着上游文档比一下':
    'The config panel’s request preview shows what actually goes out. Compare it against the provider’s docs.',
  '原文在下面。反复出现的话，带上模型 ID 和请求体预览开 issue':
    'The raw text is below. If it keeps happening, open an issue with the model ID and the request preview.',
  '右侧配置面板把 max_tokens 调大，或者干脆取消勾选让上游用它自己的上限':
    'Raise max_tokens in the config panel on the right, or uncheck it and let the provider use its own ceiling',
  '上面这段是完整收到的部分，不是全部。直接说「接着写」通常能续上':
    'What you see arrived complete; it is just not everything. Saying “keep going” usually resumes it.',
  '开了工具的话，截断往往发生在它正要发工具调用的那一刻，所以看起来像「说要干活然后没动静」':
    'With tools on, the cut usually lands right as it was about to send a tool call, which reads as announcing work and then going quiet',
  '换个说法重问一次':
    'Reword it and ask again',
  '换一条别的路由，各家的过滤尺度不一样':
    'Take another route. Filters differ by vendor.',
  '直接重发一次，这种多半是流在工具调用中间被掐断了':
    'Just resend. This usually means the stream was cut mid tool call.',
  '右侧配置面板把「流式」关掉再试：非流式是整包返回，不存在传一半':
    'Turn streaming off in the config panel and retry. A non-streamed answer arrives whole, so nothing half-arrives.',
  '换一条路由。有些网关代理工具调用时会把 tool_calls 字段吃掉':
    'Take another route. Some gateways swallow the tool_calls field when they proxy.',
  '重发一次':
    'Send it again',
  '换一条能用的路由试试是不是这个模型自己的问题':
    'Try a route that works to see whether the model itself is the problem',
  '（上游没有给出说明）':
    '(the provider gave no explanation)',
  '（上游没给）':
    '(not given)',
  '来源 · {n}':
    'Sources · {n}',
  '本地':
    'local',
  '请求失败：':
    'Request failed: ',
  '重新发送':
    'Send again',
  '自动排查':
    'Diagnose it',
  '从最小请求体开始，一组一组把字段加回去，第一个失败的那组就是原因。工具会用二分法定位到具体是哪几个':
    'It starts from a minimal body and adds field groups back one at a time. The first group that fails is the cause, and it bisects down to the exact fields.',
  '上游原文':
    'Provider’s raw text',
  '研究过程 · {n} 步':
    'Research · {n} steps',
  '收起':
    'Collapse',
  '展开':
    'Expand',
  '参数':
    'Arguments',
  '错误':
    'Error',
  '返回':
    'Result',
  '（无输出）':
    '(no output)',
  '引用助手的原文 ↗':
    'Quote the assistant ↗',
  '引用用户的原文 ↗':
    'Quote the user ↗',
  '删除这一轮':
    'Delete this round',
  '改问题重问':
    'Edit the question and ask again',
  '重新提问':
    'Ask again',
  '重新生成':
    'Regenerate',
  '复制回答':
    'Copy the answer',
  '从这里分叉出一条新对话，只带到这一步为止的上下文':
    'Fork a new chat here, carrying only the context up to this step',
  '这一轮注入了技能 /{name}':
    'Skill /{name} was injected this round',
  '思考过程':
    'Reasoning',
  '{n} 字':
    '{n} characters',
  '完成自查 · 模型复核':
    'Self-check · model review',
  '已补充的信息 · {n} 条':
    'Added information · {n}',
  'Answer Question · 回答问题':
    'Answer Question',
  '任务仍在继续':
    'the task is still running',
  '上下文整理建议 · 任务仍在继续':
    'Context cleanup suggested · the task is still running',
  '暂停，选择压缩后继续':
    'Pause, compress, then continue',
  '新窗口交接':
    'Hand off to a new window',
  '也可以保持当前任务运行。新窗口只预填交接草稿，由你决定何时发送。':
    'You can also leave the task running. The new window only prefills a handoff draft, and you decide when to send it.',
  '接力上下文 · ':
    'Handoff context · ',
  '已发送':
    'sent',
  '已准备':
    'ready',
  '此前模型':
    'previous model',
  '从原任务继续':
    'continues the original task',
  '承接同窗口历史':
    'picks up the same window’s history',
  '保留 {sources} 条来源记录、{steps} 步执行证据，':
    'Keeps {sources} source records and {steps} steps of evidence, ',
  '包含已有总结或交接记录':
    'including existing summaries and handoff notes',
  '尚无语义总结，保留原始上下文':
    'with no semantic summary yet, so the raw context stays',
  '。完整原文按需检索，未全部重复发送。':
    '. Full text is retrieved on demand rather than resent wholesale.',
  '此处记录上下文交付状态；模型是否理解准确仍需看后续行动和验收结果。':
    'This records what context was delivered. Whether the model understood it shows up in what it does next and in your acceptance check.',
  '上下文建议':
    'Context advice',
  '缓存命中 {n} tok':
    'Cache hit {n} tok',
  '提示词里命中上下文缓存的部分，这部分通常按更低的价格计费':
    'The part of the prompt that hit the context cache, which usually bills at a lower rate',
  '结束原因：':
    'Finish reason: ',
  '上游给出的结束原因':
    'The finish reason the provider returned',
  '输出长度到顶了，这段话是被截断的，不是它说完了。把 max_tokens 调大或者让它接着写':
    'It hit the output ceiling, so this is cut off rather than finished. Raise max_tokens or tell it to keep going.',
  '输出长度到顶了，这段话是被截断的。把 max_tokens 调大或者让它接着写':
    'It hit the output ceiling, so this is cut off. Raise max_tokens or tell it to keep going.',
  '它本来要调用工具。如果下面没有工具步骤，说明工具调用在路上丢了，重发一次':
    'It meant to call a tool. No tool step below means the call was lost on the way, so send again.',
  '被上游的内容过滤拦下了':
    'The provider’s content filter stopped it',

  /* 会话配置面板 */
  '模型连接方式': 'How this chat connects',
  'API 模型': 'API model',
  '本机 AI': 'On-device AI',
  '本机不可用': 'Unavailable on this device',
  '模型和凭据的选择挪到了': 'Model and credential now live at the ',
  '输入框左下角': 'bottom left of the composer',
  '。那里带搜索，几百个模型也翻得动，而且改的是': '. It searches, so hundreds of models stay navigable, and it binds ',
  '当前这个会话': 'this chat only',
  '的绑定，不影响别的对话。': ', leaving your other chats alone.',
  '当前：': 'Now: ',
  '未选择': 'none selected',
  '流式响应': 'Streaming',
  '开启后逐字返回（SSE）；关掉则等整段生成完一次性返回。调试接口时关掉更容易看清完整响应。':
    'On, tokens arrive one by one over SSE. Off, the whole answer lands at once, which makes a response easier to read while you debug an endpoint.',
  '允许模型调用工具': 'Let the model call tools',
  '关掉就是纯聊天，请求体里不会出现 tools 字段。模型不支持 function calling 时必须关掉，否则会报 400。':
    'Off means plain chat and no tools field in the request. Turn it off for models without function calling or they answer 400.',
  '工具调用轮次上限：{n}': 'Tool round limit: {n}',
  '一次提问里模型最多能来回调几轮工具。旧的工具输出会被自动压缩，所以调高不会直接把上下文撑爆。但每一轮都是一次真实的 API 调用：调到几百意味着一个问题可能烧掉几百次请求，跑偏了也不会自己停。建议配合「逐步确认」用，别跟「全部放行」叠在一起。':
    'How many tool rounds one question may take. Older tool output gets compressed, so raising this will not blow up the context on its own. Every round is still a real API call: set it to a few hundred and one question can burn a few hundred requests, and nothing stops it when it wanders. Pair it with confirm-each-step rather than allow-everything.',
  '每阶段最多调用几轮工具。到顶后保存阶段汇总并暂停，可接着跑。较早工具输出会缩短，桌面端保留完整证据。':
    'Tool rounds per stage. At the cap it saves a stage summary and pauses, and you can resume. Earlier tool output shortens; the desktop keeps the full evidence.',
  '这台设备不能直接执行本地工具（文件、命令行、Chrome、Claude Code）。去 设置 → 遥控 配好电脑地址后，这些工具会转发到电脑上执行。':
    'This device runs no local tools (files, shell, Chrome, Claude Code). Set the computer address under Settings → Remote and those calls run on the computer.',
  '全开': 'All on',
  '全关': 'All off',
  '需确认': 'Asks first',
  '强度': 'Effort',
  '不是所有模型都认这四档，报 400 就换一种下发方式。':
    'Not every model takes these four levels. Switch the wire format when one answers 400.',
  '按当前模型匹配映射表，自动翻译成那家该用的字段。档位在输入框右下角选。':
    'Matches the current model against the mapping table and sends whatever that vendor expects. Pick the level at the bottom right of the composer.',
  '手动指定字段，绕过映射表。只有在映射表搞不定某个模型时才需要。':
    'Name the field yourself and skip the mapping table. You need this only when the table cannot handle a model.',
  '当前档位：': 'Current level: ',
  '。映射规则在 设置 → 思考强度 里改。': '. Mapping rules live under Settings → Reasoning effort.',
  '思考预算：{n} tok': 'Reasoning budget: {n} tok',
  '给思考链留的 token 上限。留太少会出现「想到一半就被截断」。':
    'Token ceiling for the reasoning chain. Too low and it gets cut off mid-thought.',
  '自动（按模型映射）— 推荐': 'Automatic, by model mapping (recommended)',
  '完全不下发': 'Send nothing',
  '手动：reasoning_effort 字符串': 'Manual: reasoning_effort string',
  '手动：enable_thinking + 预算': 'Manual: enable_thinking plus budget',
  '手动：thinking 对象 + 预算': 'Manual: thinking object plus budget',
  '手动：自己写在附加请求字段里': 'Manual: write it in the extra request fields',
  '生成参数': 'Generation parameters',
  '勾选才会下发。没勾的字段压根不出现在请求体里，走服务端默认值，这样某个模型不认识某个参数时不会直接 400。':
    'Only checked fields go out. Unchecked ones never appear in the request and take the server default, so a model that does not know a parameter will not answer 400.',
  '启用 {key}': 'Enable {key}',
  '⚠ 开着 max_tokens = 单轮输出被 {n} token 封顶，长回答会在这里被切断。取消勾选就交给上游用它自己的最大值。':
    '⚠ With max_tokens on, one turn stops at {n} tokens and a long answer gets cut there. Uncheck it and the provider uses its own maximum.',
  '附加请求字段': 'Extra request fields',
  'JSON 对象，最后浅合并进请求体': 'A JSON object, shallow-merged into the request last',
  '上面没有覆盖到的参数写这里，例如 knowledge_config 或 plugins。同名字段会覆盖上面的设置。':
    'Parameters the fields above miss go here, such as knowledge_config or plugins. Matching names override the settings above.',
  '必须是一个 JSON 对象': 'It has to be a JSON object',
  'JSON 解析失败': 'JSON did not parse',
  '查看请求体': 'Show the request body',
  '存为新会话默认': 'Save as the default for new chats',
  '最近一次原始往返': 'Last raw round trip',
  '最近一次请求实际发出去的内容，和上游一个字节都没改的回复原文。模型「说要调工具然后没动静」时，答案就在这里面':
    'What the last request actually sent, and the provider’s reply byte for byte. When a model announces a tool call and then goes quiet, the answer sits in here',
  '留空则不下发 system 消息。': 'Leave it empty to send no system message.',
  '例如：你是一个严谨的量化研究助手，回答用中文，代码用 Python。':
    'For example: you are a rigorous quantitative research assistant; answer in English and write code in Python.',
  '上下文': 'Context',
  '任务上下文按当前模型窗口自动整理，保留用户要求、总结和可检索的原始证据。切换模型后继续使用同一份任务记录；旧版“历史条数”限制已停用。':
    'Task context is organized against the current model’s window and keeps your requirements, the summaries and searchable raw evidence. Switch models and the same task record carries over. The old message-count limit no longer applies.',
  '连续工作': 'Continuous work',
  '任务会保存进度，在临时限流或断网后等待恢复。阶段预算用完会暂停，接着跑可开启下一阶段。':
    'A task saves its progress and waits out a rate limit or a dropped connection. It pauses when the stage budget runs out, and resuming opens the next stage.',
  '1M 是上下文建议值，超过仍可继续。实际可发送大小取决于所选模型与上游额度。以下设置在下次启动或续跑时生效。':
    '1M is a suggested context size, not a wall. What you can actually send depends on the model and the provider’s quota. The settings below apply on the next start or resume.',
  '接近建议值时提醒（90%）': 'Warn near the suggested size (90%)',
  '接近建议值时自动打开交接草稿': 'Open a handoff draft near the suggested size',
  '交接会打开新对话并预填上下文，由你决定是否修改、发送。原任务继续运行，不会启动后台 agent。':
    'A handoff opens a new chat prefilled with the context, and you decide whether to edit and send it. The original task keeps running and no background agent starts.',
  '自动压缩历史（使用当前模型，计入用量）': 'Compress history automatically (uses the current model, counts toward usage)',
  '允许模型按需维护里程碑': 'Let the model keep milestones as it goes',
  '检测回复复读与读取循环': 'Detect repeated replies and read loops',
  'Work 回复连续复读或反复读取相同结果时暂停并保存现场，避免继续消耗。刻意生成重复内容时可关闭。':
    'When a Work reply repeats itself or reads the same result over and over, it pauses and saves the run instead of burning more quota. Turn it off when you want repetition on purpose.',
  '上下文建议值（token）': 'Suggested context size (tokens)',
  '默认 1,000,000；用于整理历史和可选提醒，不是停止任务的硬上限。':
    'Defaults to 1,000,000. It drives history cleanup and the optional warning. It never stops a task.',
  '每分钟 token 额度（TPM）': 'Tokens per minute (TPM)',
  '填上游真实额度；0 表示从响应头或报错学习，未知时使用退避。':
    'Put the provider’s real quota here. 0 learns it from response headers or errors and backs off while it does not know.',
  '每分钟请求额度（RPM）': 'Requests per minute (RPM)',
  '同一份凭据的请求统一排队；0 表示从上游学习。':
    'Requests on one credential share a queue. 0 learns the limit from the provider.',
  '每阶段 token 预算': 'Token budget per stage',
  '按实际用量累计，无 usage 时保守估算。0 表示不限制。':
    'Counts real usage, and estimates conservatively when the provider reports none. 0 means no limit.',
  '每阶段最长时间（分钟）': 'Minutes per stage',
  '包括执行和等待。0 表示不限制。': 'Execution and waiting both count. 0 means no limit.',
  '单次中断最多自动等待（分钟）': 'Wait out one interruption for at most (minutes)',
  '达到后保留现场，等待你接着跑。': 'Past that it keeps the run and waits for you to resume.',

  /* 模型选择器 */
  '选择模型与凭据': 'Pick a model and credential',
  '选模型': 'Pick a model',
  '当前模型：{model}\n凭据：{profile}': 'Model: {model}\nCredential: {profile}',
  '凭据': 'Credential',
  '还没登记凭据，去设置里加一份': 'No credentials yet. Add one in Settings.',
  '重新拉取这份凭据下的模型列表': 'Reload the model list for this credential',
  '搜索模型，或直接粘贴一个 ID': 'Search models, or paste an ID',
  '{n} 个模型': '{n} models',
  '匹配 {n} / {total}': '{n} of {total} match',
  '只看聊天模型': 'Chat models only',
  '已隐藏 {n} 个非聊天模型（图像生成、向量、语音），点一下显示出来':
    '{n} non-chat models hidden (image, embedding, speech). Click to show them.',
  '点一下只看聊天模型': 'Click to show chat models only',
  '已隐藏 {n} 个': '{n} hidden',
  '含 {n} 个非聊天模型': 'includes {n} non-chat models',
  '拉取失败：': 'Could not load: ',
  '可以直接在上面输入 ID 然后回车，手动加一个。': 'Type an ID above and press Enter to add one by hand.',
  '没有匹配的模型': 'No model matches',
  '把「{id}」当成模型 ID 加进来': 'Add “{id}” as a model ID',
  '继续往下滚，或点这里再加载 {n} 个（已显示 {shown} / {total}）':
    'Keep scrolling, or load {n} more here ({shown} of {total} shown)',
  '回车选中第一条': 'Enter picks the first one',
  '手动': 'Manual',
  '打不通 /chat/completions': '/chat/completions does not answer',
  '体检通过': 'Health check passed',
  '空响应': 'Empty response',
  '放回正常列表': 'Move it back to the normal list',
  '手动隐藏：不想在列表里看到它': 'Hide it by hand so it stays out of the list',
  '最后一次判定：': 'Last verdict: ',
  '有问题的模型 {n} 个': '{n} models with problems',
  '这里没有匹配的': 'Nothing matches here',
  '这一组还有 {n} 个，用上面的搜索框筛': '{n} more in this group. Narrow it with the search box above.',
  '把这些模型 ID 连同失败原因复制出来': 'Copy these model IDs together with why they failed',
  '服务端报错': 'Server error',
  '5xx：那条路由在上游自己就起不来，客户端改什么都没用':
    '5xx: that route fails at the provider, and nothing you change on the client helps',
  '模型不存在': 'No such model',
  '404：ID 下线了或写法不对': '404: the ID is retired or spelled wrong',
  '其他失败': 'Other failures',
  '返回了非 2xx，但归不进上面两类': 'Answered non-2xx without fitting either group above',
  '手动隐藏': 'Hidden by hand',
  '你自己压下去的，体检不会推翻': 'You hid these, and a health check never overrides that',
  '体检中 {done}/{total}': 'Checking {done}/{total}',
  '停下': 'Stop',
  '批量体检 {n} 个模型': 'Health-check {n} models',
  '给每个模型发一个最小请求，把服务端坏掉的路由挑出来。并发压到 2，不会把额度打爆':
    'Sends each model one minimal request to find routes broken at the provider. It runs two at a time, so it will not eat your quota',
  '只测通不通，不测能力': 'It tests reachability, not capability',
  '清空记录': 'Clear the records',
  '清空这份凭据下的全部体检记录，所有模型回到未判定状态':
    'Clears every health record on this credential and returns all models to unjudged',
  '新规则': 'New rule',

  /* 设置 · 页签与通用 */
  '设置': 'Settings',
  '工具': 'Tools',
  '思考强度': 'Reasoning effort',
  '遥控': 'Remote',
  '外观': 'Appearance',
  '保存': 'Save',
  '清除': 'Clear',
  '当前': 'Active',
  '设为当前使用的凭据': 'Use this credential',
  '上移': 'Move up',

  /* 设置 · 凭据 */
  '已保存（留空不改动）': 'Saved. Leave empty to keep it.',
  '粘贴 API Key': 'Paste an API key',
  '保存后就只留在本机的安全存储里，界面上不再回显。':
    'It goes into this machine’s secure storage. The interface never shows it again.',
  '还没有登记任何凭据。': 'No credentials yet.',
  '去 platform.sensenova.cn 控制台复制一个 API Key 回来。':
    'Copy an API key from the platform.sensenova.cn console.',
  '凭据 {n}': 'Credential {n}',
  '＋ 添加一份凭据': '+ Add a credential',
  '测试连接': 'Test connection',
  '测试中…': 'Testing…',
  '免费额度走 token 端点；企业账号或自建网关填自己的地址。末尾不用加斜杠。':
    'Free quota runs through the token endpoint. Enterprise accounts and self-hosted gateways use their own address. No trailing slash.',
  '找免费额度：社区清单 github.com/raullenchai/free-llm-api-resources 列了各家的免费档位和限流，它 fork 自 cheahjs/free-llm-api-resources。':
    'Looking for free quota: the community list at github.com/raullenchai/free-llm-api-resources tracks each provider’s free tier and rate limits. It forks cheahjs/free-llm-api-resources.',
  'wickrunAI 与该清单的作者、以及清单内任何 API 供应商之间均无关联关系；本应用不对其作出任何认可或推荐，亦未获其认可或赞助。额度与条款由各供应商自行订立并可随时变更。':
    'wickrunAI has no affiliation with the author of that list or with any API provider named in it. wickrunAI neither endorses nor recommends them, and is neither endorsed nor sponsored by them. Each provider sets its own quota and terms and may change them at any time.',
  '这台机器上系统级加密不可用，密钥会以明文存在 {path}。别把这个文件同步到云盘或共享出去。':
    'System encryption is unavailable on this machine, so keys sit in plain text at {path}. Keep that file out of cloud sync and off shared drives.',

  /* 设置 · 工具 */
  '工作目录': 'Working directories',
  '文件和命令行工具只能在这些目录里动手。': 'File and shell tools reach only these directories.',
  '一个都不加的话，这类工具会全部拒绝执行': 'Add none and every one of those tools refuses to run',
  '。这是故意的，默认不给整块磁盘的权限。':
    '. That is deliberate. Nothing gets your whole disk by default.',
  '＋ 选一个目录': '+ Pick a directory',
  '工作目录只能在桌面端添加。': 'You can add working directories on the desktop only.',
  '操作放行': 'Approvals',
  '危险操作问不问，已经挪到输入框左下角那个按钮上了：逐步确认 / 自动批准编辑 / 全部放行。每个会话各自记住自己的档位，随时能在对话中途切。':
    'Whether risky actions ask you now lives on the button at the bottom left of the composer: confirm each step, auto-approve edits, allow everything. Each chat remembers its own setting and you can switch mid-conversation.',
  '放这儿不合适：这是个会话级、需要频繁切换的决定，藏在设置里等于逼你每次都翻两层。':
    'It does not belong here. You change it often and per chat, so burying it in Settings costs you two clicks every time.',
  '搜索': 'Search',
  '搜索源': 'Search provider',
  'app.tavily.com 注册后拿，免费额度每月 1000 次。':
    'Sign up at app.tavily.com. The free tier gives 1,000 calls a month.',
  'brave.com/search/api 申请，免费档每月 2000 次。注意 Brave 只给标题和摘要，需要正文时让模型再 fetch_url。':
    'Apply at brave.com/search/api. The free tier gives 2,000 calls a month. Brave returns titles and snippets only, so have the model call fetch_url when it needs the body.',
  'SearXNG 地址': 'SearXNG address',
  '自建实例的地址。要在它的 settings.yml 里打开 json 格式输出，否则会返回 403。':
    'Your own instance. Turn on JSON output in its settings.yml or it answers 403.',
  '不填也能用，但只能读公开内容，而且限额是按 IP 每小时 60 次。填了变成 5000 次。代码搜索必须要 token。':
    'It works without one, but you read public content only at 60 calls an hour per IP. A token raises that to 5,000. Code search needs a token.',
  'ghp_... 或 github_pat_...': 'ghp_… or github_pat_…',
  '到哪拿：github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access 选「Public Repositories (read-only)」就够装技能了，什么权限都不用勾。':
    'Where to get one: github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Pick “Public Repositories (read-only)” for repository access. Installing skills needs no scopes at all.',
  '已经装了 GitHub CLI 的话更快：命令行跑 gh auth login，然后 gh auth token 会把 token 打印出来，复制粘贴进上面那个框。':
    'Faster with the GitHub CLI: run gh auth login, then gh auth token prints the token. Paste it above.',
  '限额不能重置': 'You cannot reset the quota',
  '查看剩余额度': 'Check remaining quota',
  '查询中…': 'Checking…',
  '查询失败': 'Lookup failed',
  '返回里没有 core 额度': 'The response carried no core quota',
  '还剩 {remaining} / {limit} 次': '{remaining} of {limit} left',
  '，{mins} 分钟后自动恢复': ', back in {mins} minutes',
  '，{mins} 分钟后重置计数': ', count resets in {mins} minutes',
  '（这是未登录的额度，填 token 会变成 5000）': '(unauthenticated quota; a token raises it to 5,000)',
  '（token 生效中）': '(token in effect)',
  'claude 可执行文件': 'claude executable',
  '留空就用 PATH 里的 claude。装了但找不到就填绝对路径。':
    'Leave it empty to use claude from PATH. Give an absolute path if it is installed but not found.',
  '附加命令行参数': 'Extra command-line arguments',
  '默认给了 --permission-mode acceptEdits，否则 headless 模式下它遇到要授权的操作会直接卡住。想让它更放得开可以调，但那意味着它改什么都不问你。':
    'It ships with --permission-mode acceptEdits, because headless mode otherwise stalls on anything needing approval. Loosen it if you want, and it stops asking before it changes things.',
  '超时：{seconds} 秒': 'Timeout: {seconds}s',

  /* 设置 · Chrome */
  'Chrome 136 之后，--remote-debugging-port 在默认用户目录下会被直接忽略。Google 用这条变更堵住「拿调试端口偷 cookie」，所以没法直接控制你日常那个 Chrome，必须用一份独立的配置目录。':
    'From Chrome 136 on, --remote-debugging-port is ignored in the default user directory. Google made that change to stop cookie theft through the debug port, so you cannot drive your everyday Chrome and need a separate profile directory.',
  '下面这个按钮会用一份专属配置拉起 Chrome。第一次需要在那个窗口里登录一遍你要用的网站，之后配置一直留着，不用重复登录，也完全不碰你日常那份。':
    'The button below starts Chrome on a dedicated profile. Sign in to the sites you need once in that window. The profile persists, so you never sign in again, and your everyday Chrome stays untouched.',
  '远程调试端口': 'Remote debugging port',
  '启动可控制的 Chrome': 'Start a controllable Chrome',
  '启动中…': 'Starting…',
  '启动失败': 'Could not start it',
  '端口上已经有一个实例在跑：{browser}': 'An instance already holds that port: {browser}',
  '已启动 {name}{detail}': 'Started {name}{detail}',
  '检测': 'Check',
  '已连通': 'Connected',
  '未连通': 'Not connected',
  '找到的浏览器：': 'Browser found: ',
  '专属配置目录：': 'Dedicated profile directory: ',
  '没在常见位置找到 Chrome 或 Edge。': 'No Chrome or Edge in the usual places.',
  'Chrome 只能从桌面端启动。手机端配好遥控后，操作会转发到电脑执行。':
    'Chrome starts from the desktop only. Set up the remote on your phone and actions run on the computer.',

  /* 设置 · 遥控 */
  '手机上没有文件系统权限、控不了 Chrome、也没有 claude CLI，所以手机端的这些工具调用会转发到这台电脑执行。打开下面的服务，然后把地址和令牌抄到手机端的「遥控」设置里。':
    'Your phone has no filesystem access, cannot drive Chrome and carries no claude CLI, so those tool calls run on this computer. Start the service below, then copy the address and token into the phone’s Remote settings.',
  '只在内网用。': 'Keep it on your local network.',
  '别把这个端口做端口转发暴露到公网。它背后就是你电脑的命令行。':
    'Never port-forward it to the open internet. Behind it sits your computer’s command line.',
  '监听端口': 'Listen port',
  '启动服务': 'Start the service',
  '停止服务': 'Stop the service',
  '运行中': 'Running',
  '已停止': 'Stopped',
  '手机端填这个地址': 'Use this address on the phone',
  '同一个 Wi-Fi 下，挑能通的那条。': 'Same Wi-Fi. Pick whichever one answers.',
  '抄到手机端。换端口重启会保留同一个令牌。':
    'Copy it to the phone. Restarting on a different port keeps the same token.',
  '在电脑上打开 设置 → 遥控 里的服务，把那边显示的地址和令牌填到这里。填好之后，手机上也能让模型读你电脑的文件、控 Chrome、调 Claude Code。':
    'Start the service on your computer under Settings → Remote, then put the address and token it shows here. After that the model reads your computer’s files, drives Chrome and calls Claude Code from the phone.',
  '启用遥控': 'Enable remote',
  '电脑地址': 'Computer address',
  '配对令牌': 'Pairing token',
  '测试连通': 'Test the connection',
  '连接中…': 'Connecting…',
  '连通了：{host}': 'Connected: {host}',
  '对面返回了意外内容': 'The other end answered with something unexpected',
  '连不上：{reason}': 'Cannot reach it: {reason}',

  /* 设置 · 思考强度 */
  '同一件事（「多想一会儿」）各家 API 长得完全不一样：OpenAI 用 reasoning_effort 字符串，Anthropic 用 thinking 对象带 token 预算，通义智谱用 enable_thinking 加预算，DeepSeek 的 reasoner 干脆没有开关。':
    'Every API spells “think longer” differently: OpenAI takes a reasoning_effort string, Anthropic a thinking object with a token budget, Tongyi and Zhipu enable_thinking plus a budget, and DeepSeek’s reasoner has no switch at all.',
  '所以输入框右下角只给一档五级刻度，切模型不用重学。这张表负责翻译：':
    'So the composer gives you one five-step scale and you relearn nothing when you switch models. This table does the translating:',
  '按顺序匹配模型 ID，第一条命中的生效': 'Rules match model IDs in order and the first hit wins',
  '标了「推测」的几条是按厂商惯例填的，没有逐个实测。报 400 就改这里，不用改代码。':
    'Rows marked “guess” follow each vendor’s convention without a live test. Fix them here when you get a 400. No code change needed.',
  '匹配模型 ID 的正则': 'Regex matching model IDs',
  '下发方式': 'Wire format',
  '推测': 'Guess',
  '每一级发什么': 'What each level sends',
  '留空 = 这一级不下发': 'Empty means this level sends nothing',
  '（填字符串，例如 low / medium / high）': '(a string, such as low / medium / high)',
  '（填 JSON 片段）': '(a JSON fragment)',
  '（填 token 预算数字）': '(a token budget number)',
  '＋ 加一条（插到最前面）': '+ Add a rule at the top',
  '恢复默认': 'Restore defaults',

  /* 设置 · 外观 */
  '主题': 'Theme',
  '跟随系统': 'Follow system',
  '浅色': 'Light',
  '深色': 'Dark',
  '控件密度': 'Control density',
  '紧凑': 'Compact',
  '宽松': 'Roomy',
  '后台任务通知（提问、暂停、完成）': 'Background task notifications (questions, pauses, completions)',
  '通知提示音（遵循系统声音与勿扰设置）': 'Notification sound (follows your system sound and do-not-disturb settings)',
  '发送快捷键': 'Send shortcut',
  'Enter 发送': 'Enter sends',
  'Ctrl/⌘+Enter 发送': 'Ctrl/⌘+Enter sends',
  '字号：{percent}%': 'Text size: {percent}%',
  '生成时自动展开思考过程': 'Expand reasoning while it generates',
  '请求超时：{seconds} 秒': 'Request timeout: {seconds}s',
  '数据文件：': 'Data file: ',
  '构建于：': 'Built at: ',
  '改了代码之后要重新跑一次打包，这里的时间才会变。遇到「明明改了却没生效」先看这个。':
    'This timestamp moves only after you rebuild. Check it first when a change seems to have no effect.',
  '添加工作模型': 'Add a worker model',
  '允许继承本会话的编辑权限': 'Inherit this chat’s edit permission',
  '当前会话未开启工具，临时协作保持只读。': 'Tools are off in this chat, so helpers stay read-only.',
  '编辑仍受本会话的目录范围和审批方式约束。':
    'Edits still obey this chat’s directory scope and approval mode.',
  '尚未保存：{error}': 'Not saved yet: {error}',
  '执行记录读取失败：{error}': 'Could not read the run journal: {error}',
  '排队输入恢复失败：{error}': 'Could not restore the queued input: {error}',
  '这份凭据还没填 API Key': 'This profile has no API key yet',
  '没有可交接的执行记录': 'No run journal to hand off',
  '已打开交接草稿。请审阅后决定是否发送；原任务进度保留。':
    'Handoff draft opened. Review it, then decide whether to send. The original task keeps its progress.',
  '已按设置创建交接草稿，可从侧栏打开。尚未发送，原任务仍可继续。':
    'Handoff draft created as configured. Open it from the sidebar. Nothing is sent yet and the original task can still continue.',
  '{title}（分叉）': '{title} (fork)',
  '读取失败': 'Could not read the file',
  '未命名': 'Untitled',
  '工作目录只能在桌面端添加': 'Working directories can only be added on desktop',
  '已加入工作目录：{dir}': 'Added working directory: {dir}',
  '先选一份凭据': 'Pick a credential profile first',
  '先拉一次模型列表': 'Fetch the model list first',
  '体检中断：{title}': 'Health check stopped: {title}',
  '体检已停止，测了 {tested} 个，其中 {bad} 个不可用': 'Health check stopped. Tested {tested}, {bad} are unusable',
  '体检完成：{tested} 个里有 {bad} 个不可用，已从默认列表移出':
    'Health check done. {bad} of {tested} are unusable and left the default list',
  '没有找到对应的失败请求，无法根据普通聊天记录替它下结论。':
    'No matching failed request found. Regular chat history cannot settle this one.',
  '本地检查：原请求超出当前发送预算，已保留原文，不再重复发送大请求。':
    'Local check: the original request exceeds the current send budget. The body is kept and no large request is resent.',
  '{label}正在排队，约 {sec} 秒后发送。': '{label} is queued and sends in about {sec}s.',
  '{label}：{result}': '{label}: {result}',
  '请求成功': 'request succeeded',
  '对照结果': 'Comparison',
  '单次成功不证明故障不存在；以上只说明本次对照结果，原失败证据仍保留。':
    'One success does not prove the fault is gone. This reports the comparison only; the original failure evidence stays.',
  '已撤销全部额外授权，包括记住的那些': 'Revoked every extra grant, including the remembered ones',
  '已清空这份凭据的体检记录': 'Cleared the health records for this profile',
  '先去设置里登记一份 API 凭据': 'Add an API credential in settings first',
  '先选一个模型': 'Pick a model first',
  '无法更新执行记录：{error}': 'Could not update the run journal: {error}',
  '另一个会话': 'another chat',
  '「{title}」正在这个工作目录里执行。这条排着，等它结束再发。':
    '“{title}” is working in this directory. This message waits and sends once that finishes.',
  '操作需要你的确认': 'An action needs your confirmation',
  '新要求已保存，需要核实上一项操作': 'New request saved. Verify the previous action',
  '上一项操作的结果尚未确认，请回来核实后继续，避免重复执行。':
    'The previous action has no confirmed result. Come back, verify it, then continue so nothing runs twice.',
  '子代理所选凭据已不存在，请重新选择。': 'The credential this helper uses no longer exists. Pick another one.',
  '任务需要你的回答': 'The task needs your answer',
  '任务已暂停': 'Task paused',
  '任务已完成': 'Task done',
  '任务遇到问题': 'Task hit a problem',
  '正在保存当前输出和执行现场，然后处理新要求': 'Saving the current output and run state, then handling the new request',
  '请等待当前任务保存后提交回答': 'Wait for the current task to save, then submit your answer',
  '本地数据未能读取': 'Local data could not be read',
  '原记录已保留。修复文件或恢复备份后重试。': 'Your records are untouched. Fix the file or restore a backup, then retry.',
  '打开数据位置': 'Open data folder',
  '加载中…': 'Loading…',
  '已授权': 'Granted',
  '（记到 {date}）': '(kept until {date})',
  '（仅本次会话）': '(this session only)',
  '屏幕控制': 'Screen control',
  '管理员执行': 'Admin execution',
  '全部撤销': 'Revoke all',
  '已停止后续工具调度，正在保存当前检查点': 'Stopped further tool calls and saving the current checkpoint',
  '{n} 个附件': '{n} attachments',
  '正在打开协作空间…': 'Opening the team workspace…',
  '重试保存': 'Retry save',
  '产物预览': 'Artifact preview',
  '这里是你输入的问题': 'your question goes here',
  '已存为新会话的默认配置': 'Saved as the default setup for new chats',
  '正在读取记录…': 'Reading records…',
  '还没填 API Key': 'No API key yet',
  '连上了，拿到 {n} 个模型': 'Connected, got {n} models',
  '失败：{error}': 'Failed: {error}',
  '请求详情': 'Request details',
  '日日新现在有哪些免费模型，各自的上下文长度是多少？': 'Which models are free right now, and what context length does each have?',
  '读一下我工作目录里的 README，说说这个项目是干什么的':
    'Read the README in my working directory and tell me what this project does',
  '搜一下 2026 年 A 股量化私募的监管新规，给我一个时间线':
    'Search the 2026 rules for quant funds in the A-share market and give me a timeline',
  '把当前 Chrome 标签页的内容总结成三点': 'Summarize the current Chrome tab in three points',
  '已分叉，上下文都带过来了': 'Forked with the full context',
  '已从这一步分叉': 'Forked from this step',
  '当前回复会继续完成；下一条消息将带上已有对话，由 Work 接着处理':
    'The current reply finishes as is. Your next message carries the conversation into Work.',
  '已切换为 Work，已有对话和附件会继续作为上下文': 'Switched to Work. The conversation and attachments stay as context.',
  '最小基线': 'Minimal baseline',
  '原始失败请求': 'Original failing request',
  '新输入和执行现场已保存，正在继续': 'New input and run state saved, continuing',
  '用户已补充信息，正在继续': 'You added information, continuing',
  '已收到回答，正在继续': 'Answer received, continuing',
  '已触发': 'triggered',
  '执行记录已保存，可以从中断处继续': 'The run journal is saved and can continue from where it stopped',
  '。具体阻塞：{notes}': '. Blocked on: {notes}',
  '准备好后接着跑，也可以补充要求。': 'Continue when you are ready, or add to the request first.',
  '额度恢复后接着跑；已有结果会继续使用。': 'Continue once quota returns. Existing results stay in use.',
  '接着跑将开启新的执行阶段，仍使用现有结果。': 'Continuing starts a new run phase and keeps the existing results.',
  '补充缺少的信息后接着跑；工具能力可在配置中调整。':
    'Add the missing information, then continue. Tool access is adjustable in the config panel.',
  '先检查所需权限，或补充一种已获准的执行方式。': 'Check the permissions it needs, or offer a route that is already allowed.',
  '先核实下列操作是否生效；重试可能重复修改或提交。':
    'Verify whether the actions below took effect. A retry may repeat an edit or a submission.',
  '查看未通过或未检查的要求，接着跑以修复，也可以补充信息。':
    'Look at the failed or unchecked requirements, then continue to fix them or add information.',
  '连接恢复后接着跑；已确认完成的操作不会重新执行。': 'Continue once the connection is back. Confirmed actions do not run again.',
  '查看具体原因，补充信息或调整配置后接着跑。': 'Read the reason, then add information or adjust the config and continue.',
  '完成自查': 'Delivery self-check',
  '派发临时子代理': 'Dispatch a helper agent',
  '查看临时子代理': 'List helper agents',
  '收取子代理结果': 'Collect helper results',
  '询问用户': 'Ask the user',
  '记录交付要求': 'Record delivery requirements',
  '核验交付要求': 'Verify delivery requirements',
  '更新里程碑': 'Update milestones',
  '查阅历史原文': 'Read past messages',
  '读取已登录 API': 'Read a signed-in API',
  '读取已存结果': 'Read a stored result',
  '核实交付文件': 'Check delivered files',
  '联网搜索': 'Web search',
  '抓取网页': 'Fetch a page',
  '列目录': 'List a directory',
  '读文件': 'Read a file',
  '读文档': 'Read a document',
  '生成文档': 'Write a document',
  '写文件': 'Write a file',
  '改文件': 'Edit a file',
  '搜索代码': 'Search code',
  '执行命令': 'Run a command',
  '申请权限': 'Request permission',
  '截屏': 'Screenshot',
  '点击': 'Click',
  '移动鼠标': 'Move the mouse',
  '滚动': 'Scroll',
  '键盘输入': 'Type',
  '按键': 'Press a key',
  'Chrome 标签页': 'Chrome tabs',
  'Chrome 导航': 'Chrome navigation',
  'Chrome 读页面': 'Read a Chrome page',
  'Chrome 点击': 'Click in Chrome',
  'Chrome 执行脚本': 'Run a script in Chrome',
  'GitHub API': 'GitHub API',
  'GitHub 搜索': 'GitHub search',
  '调用 Claude Code': 'Call Claude Code',
  '读项目记忆': 'Read project memory',
  '写项目记忆': 'Write project memory',
  '读项目文档': 'Read project docs',
  '写项目文档': 'Write project docs',
  '列出技能': 'List skills',
  '创建技能': 'Create a skill',
  '温度 temperature': 'Temperature (temperature)',
  '核采样 top_p': 'Nucleus sampling (top_p)',
  '最大输出 max_tokens': 'Max output (max_tokens)',
  '生成条数 n': 'Candidates (n)',
  '随机种子 seed': 'Seed (seed)',
  '停止词 stop': 'Stop words (stop)',
  '用户标识 user': 'Caller id (user)',
  '越高越发散。日日新官方建议 0.6–1.0；代码/数学类任务取低值。':
    'Higher is more varied. The vendor suggests 0.6 to 1.0; go lower for code and math.',
  '只从累计概率前 p 的词里采样。官方建议 0.8–1.0。与 temperature 通常只调一个。':
    'Samples only from the top p of cumulative probability. The vendor suggests 0.8 to 1.0. Tune this or temperature, not both.',
  '只从概率最高的 k 个词里采样。官方建议 20–40。部分模型不支持，报 400 就关掉。':
    'Samples only from the k most likely tokens. The vendor suggests 20 to 40. Some models reject it; turn it off on a 400.',
  '低于「最高概率 × min_p」的词直接丢弃。官方示例给 0。':
    'Drops any token below top probability times min_p. The vendor example uses 0.',
  '单次回复最多生成多少 token。思考模型要留足，否则思考没结束就被截断。':
    'How many tokens one reply may generate. Leave room for reasoning models or they get cut off mid-thought.',
  'OpenAI 兼容模式 v2 用这个名字。和 max_tokens 二选一，别同时开。':
    'The v2 OpenAI-compatible name for the same thing. Use it or max_tokens, never both.',
  '一次返回几条候选。本客户端只展示第一条，一般保持关闭。':
    'How many candidates come back. This client shows only the first, so keep it off.',
  '出现过的 token 再出现时降权，鼓励换话题。官方建议 0–2。':
    'Penalizes tokens that already appeared, which pushes it onto new ground. The vendor suggests 0 to 2.',
  '按出现频次降权，抑制车轱辘话。': 'Penalizes by frequency, which curbs repetition.',
  '1 = 不惩罚，>1 抑制重复。官方示例给 1.0。':
    '1 applies no penalty, above 1 suppresses repeats. The vendor example uses 1.0.',
  '固定种子可复现结果（服务端不保证）。做实验时有用。':
    'A fixed seed makes results reproducible, though the server does not guarantee it. Useful for experiments.',
  '命中即停止生成。多个用英文逗号分隔，会转成数组下发。':
    'Generation stops on a match. Separate several with commas; they are sent as an array.',
  '透传给服务端的调用方标识，用于风控/审计。不需要就关掉。':
    'A caller id passed through to the server for risk control and auditing. Leave it off if you do not need it.',
  '不下发': 'Off',
  '低': 'Low',
  '中': 'Medium',
  '高': 'High',
  '超高': 'Very high',
  '拉满': 'Max',
  '模型名自带强度': 'Effort baked into the model name',
  'OpenAI GPT / o 系': 'OpenAI GPT / o series',
  'Kimi / Moonshot': 'Kimi / Moonshot',
  '通义千问': 'Qwen',
  '智谱 GLM': 'Zhipu GLM',
  'DeepSeek': 'DeepSeek',
  '商汤日日新': 'SenseNova',
  '兜底（未知模型）': 'Fallback (unknown model)',
  'Claude': 'Claude',
  '没有匹配的映射规则': 'No mapping rule matches',
  '不下发任何思考字段（匹配到「{label}」）': 'Sends no reasoning field (matched “{label}”)',
  '这个模型名里已经带了强度（网关把它烤进路由了），不下发任何字段':
    'The model name already carries the effort, baked in by the gateway, so no field is sent',
  '「{label}」这一档不支持强度调节，不下发': '“{label}” takes no effort setting, so nothing is sent',
  '「{label}」的这一级留空了，不下发': '“{label}” leaves this level empty, so nothing is sent',
  '匹配「{label}」→ {fields}': 'Matched “{label}” → {fields}',
  '核对完成情况与证据': 'Check completion and evidence',
  '子代理：{task}': 'Helper: {task}',
  '查看临时协作状态': 'Check helper status',
  '等待用户回答': 'Waiting for your answer',
  '记录用户要求与验收条件': 'Record requirements and acceptance checks',
  '逐项核验交付结果': 'Verify each delivered item',
  '更新任务里程碑': 'Update milestones',
  '查阅保存的原文': 'Read saved messages',
  '读取 API {path}': 'Read API {path}',
  '读取已保存的证据': 'Read saved evidence',
  '核实并交付文件': 'Check and deliver files',
  '搜索「{query}」': 'Search “{query}”',
  '读取 {target}': 'Read {target}',
  '列出 {path}': 'List {path}',
  '读文档 {path}': 'Read document {path}',
  '生成 {path}': 'Write {path}',
  '写入 {path}': 'Write {path}',
  '修改 {path}': 'Edit {path}',
  '搜索代码 /{pattern}/': 'Search code /{pattern}/',
  '【管理员】执行 {command}': '[Admin] Run {command}',
  '执行 {command}': 'Run {command}',
  '点击 ({x}, {y})': 'Click ({x}, {y})',
  '移动到 ({x}, {y})': 'Move to ({x}, {y})',
  '滚动 {amount} 格': 'Scroll {amount} notches',
  '输入「{text}」': 'Type “{text}”',
  '按键 {key}': 'Press {key}',
  '列出 Chrome 标签页': 'List Chrome tabs',
  'Chrome 打开 {url}': 'Open {url} in Chrome',
  '读取 Chrome 当前页面': 'Read the current Chrome page',
  'Chrome 点击 {selector}': 'Click {selector} in Chrome',
  'Chrome 执行脚本 {expression}': 'Run {expression} in Chrome',
  'GitHub {method} {path}': 'GitHub {method} {path}',
  'GitHub 搜索 {query}': 'GitHub search {query}',
  'Claude Code：{prompt}': 'Claude Code: {prompt}',
  '记到项目记忆：{text}': 'Save to project memory: {text}',
  '读文档《{name}》': 'Read document “{name}”',
  '列出项目文档': 'List project docs',
  '写文档《{name}》': 'Write document “{name}”',
  '创建技能 /{name}': 'Create skill /{name}',
  '收到限流（{kind}），{sec} 秒后再确认一次…': 'Rate limited ({kind}). Confirming again in {sec}s…',
  '每分钟 token 上限': 'tokens per minute',
  '每分钟请求数上限': 'requests per minute',
  '工具 ×{n}：{names}': '{n} tools: {names}',
  '另外：这条线路把限流报成了 HTTP {status} 而不是 429 —— 那是它的协议问题。客户端能自动退避的前提是错误码说实话，报成 400 会让所有客户端把它当成参数错误去查。':
    'One more thing: this route reports rate limiting as HTTP {status} instead of 429, which is a protocol fault on its side. Backing off automatically depends on the status code telling the truth; a 400 sends every client hunting for a bad parameter.',
  '**结论就是限流本身**：配额用尽了，不是任何一个参数的问题。':
    '**Rate limiting is the finding**: the quota is spent, and no parameter is at fault.',
  '排查全程每 {spacing} 秒才发一次、只发一条 hi —— 这个节奏不可能把配额打爆，所以收到限流只能说明额度本来就已经见底。等 {confirm} 秒后又确认了一次，还是限流。':
    'The whole probe sends one "hi" every {spacing}s, a pace that cannot exhaust a quota, so a rate limit means the quota was already gone. A second check {confirm}s later came back rate limited too.',
  '上游原话：{message}': 'Upstream said: {message}',
  '能做的：等额度回来；换一份凭据；或者看看同一把 key 是不是在别处也在跑（配额是共享的）。':
    'What you can do: wait for the quota to return, switch credentials, or check whether the same key is running somewhere else, since quota is shared.',
  '最小请求体（只有 model + messages）': 'Minimal body (model and messages only)',
  '连最小请求体都被拒了 —— 问题不在任何一个参数上，而在模型名、密钥或地址。先确认「{model}」这个 ID 在这条线路上真的存在。':
    'Even the minimal body was refused, so no parameter is at fault. It is the model name, the key, or the address. Confirm that “{model}” really exists on this route.',
  '＋ {layer}': '+ {layer}',
  '流式 + stream_options': 'Streaming + stream_options',
  '勾选的生成参数': 'The generation parameters you enabled',
  '思考强度字段': 'Reasoning effort fields',
  '附加请求字段（customBody）': 'Extra request fields (customBody)',
  '加上「{layer}」就 400 了 —— 凶手是这一组。{fix}':
    'Adding “{layer}” triggers the 400, so this group is the culprit. {fix}',
  '单独拆开每个工具都能过，全部一起下发就 400 —— 这条线路扛不住 {n} 个工具（多半是 tools 字段总长度或数量上限）。少勾一些工具就能用。':
    'Every tool passes on its own but all of them together give a 400, so this route cannot carry {n} tools, most likely a length or count cap on the tools field. Enable fewer and it works.',
  '这几个工具的 schema 这条线路不认：{tools}。在右侧配置面板把它们取消勾选即可。':
    'This route rejects the schema of these tools: {tools}. Clear them in the config panel on the right.',
  '把所有字段都加回去之后反而都通过了 —— 说明刚才那次 400 不是稳定复现的，更可能是当时的历史消息里有上游不接受的内容（比如图片、超长的工具输出、或者空的 assistant 消息）。':
    'Adding every field back made it pass, so that 400 does not reproduce reliably. More likely the history at the time held something upstream refuses, such as an image, an oversized tool result, or an empty assistant message.',
  '把配置面板里的「流式」关掉就能用。': 'Turn off Streaming in the config panel and it works.',
  '把「长度 / 采样 / 惩罚」里刚勾上的那几个逐个取消，就能定位到具体哪一个。':
    'Clear the ones you just enabled under Length, Sampling and Penalty one at a time to find the exact field.',
  '把输入框右下角的思考强度调成「不下发」。': 'Set the reasoning effort at the bottom right of the composer to Off.',
  '清空配置面板最下面的「附加请求字段」。': 'Clear Extra request fields at the bottom of the config panel.',
  '为避开每分钟 token 上限，{sec} 秒后发下一次…': 'Pacing under the per-minute token cap. Next call in {sec}s…',
  '前 {k} 条消息': 'First {k} messages',
  '把整段历史原样发过去反而通过了 —— 说明那次 400 不在消息内容上，更可能是当时的结构问题（孤儿工具结果之类），而这个现在已经会自动修掉了。':
    'Sending the whole history as is passed, so that 400 was not about message content. More likely a structural problem at the time, such as an orphaned tool result, which is now repaired automatically.',
  '第 {index} 条消息（role={role}，正文 {size} 字符）加进去就 400。常见原因：这条带了图片而模型是纯文本的、正文超长、或者它是一条上游不接受的空 assistant。':
    'Message {index} (role={role}, {size} characters) triggers the 400. Common causes: it carries an image while the model is text-only, the body is too long, or it is an empty assistant message upstream refuses.',
  '查到一半撞上了**每分钟 token 上限**，这次不下结论。':
    'The probe hit the **per-minute token cap** partway through, so it draws no conclusion this time.',
  '这一阶段每次都要把大半段历史原样发出去（一次上万 token），所以它比字段阶段吃 token 得多。等一两分钟额度回来再点一次；或者先从这条对话分叉出一条短的再查 —— 历史短了，这一步也就轻了。':
    'This stage resends most of the history each time, tens of thousands of tokens per call, so it costs far more than the field stage. Wait a minute or two for the quota and run it again, or fork a shorter chat first, which makes this step much lighter.',
  '查到一半配额用尽了，这次不下结论。上游原话：{message}':
    'The quota ran out partway through, so no conclusion this time. Upstream said: {message}',
  '{kind} ×{n}': '{kind} ×{n}',
  '孤儿工具结果': 'orphaned tool result',
  '缺失的工具结果': 'missing tool result',
  'null 正文': 'null content',
  '空的工具结果': 'empty tool result',
  '开头的工具结果': 'tool result first',
  '这台设备不能本地执行工具。请在设置里配好「遥控桌面端」，或者在电脑上操作。':
    'This device cannot run tools locally. Set up the remote desktop in settings, or work from the computer.',
  '遥控端返回 HTTP {status}': 'The remote end returned HTTP {status}',
  '请求已停止或响应等待超时': 'The request stopped, or waiting for the response timed out',
  '桌面版': 'Desktop',
  '浏览器（开发态）': 'Browser (dev)',
  'Skill 数据读取失败：{error}': 'Could not read the skill data: {error}',
  'GitHub 请求失败': 'The GitHub request failed',
  'GitHub 返回的不是 JSON': 'GitHub did not return JSON',
  '看不懂这个地址。写成 owner/repo 或者完整的 GitHub 链接。':
    'That address does not parse. Write it as owner/repo, or paste the full GitHub link.',
  '在 {repo} 里找技能…': 'Looking for skills in {repo}…',
  '找到 {name}（{kb} KB）': 'Found {name} ({kb} KB)',
  '列目录 {path}：{error}': 'Listing {path}: {error}',
  '{path} 的目录树太大被截断了，可能漏掉一部分技能 —— 把地址直接指到某个子目录再装一次':
    'The tree for {path} was truncated because it is too large, so some skills may be missing. Point the address at a subdirectory and install again.',
  '读取 {path} 的目录树：{error}': 'Reading the tree for {path}: {error}',
  '扫描完成：{dirs} 个子目录、{trees} 棵目录树、试了 {files} 个文件，找到 {found} 个技能':
    'Scan done: {dirs} subdirectories, {trees} trees, {files} files tried, {found} skills found',
  '⚠ 过程中有 {n} 处出错：{first}': '⚠ {n} errors along the way: {first}',
  '已达单次安装上限 {max} 个，仓库里可能还有更多 —— 指到具体子目录再装一次':
    'Hit the per-install cap of {max}. The repo may hold more, so point the address at a subdirectory and install again.',
  '访问 {repo} 时出错了，不是「没有技能」：': 'Reaching {repo} failed, which is not the same as finding no skills:',
  '看起来是 GitHub API 限额（不带 token 每小时只有 60 次）。设置 → 工具 → GitHub 填一个 token。':
    'This looks like the GitHub API rate limit, which is 60 requests an hour without a token. Add one under Settings → Tools → GitHub.',
  '在 {where} 里没找到技能文件。': 'No skill files found in {where}.',
  '根目录的这些 md 没有 YAML frontmatter（开头的 --- 块里要有 name 或 description），所以不当成技能：{names}。':
    'These md files at the root have no YAML frontmatter, which needs a name or description in the opening --- block, so they do not count as skills: {names}.',
  '扫过的子目录：{names}。如果技能藏得更深，把地址直接指到那一层，例如 owner/repo/tree/main/skills/engineering。':
    'Subdirectories scanned: {names}. If the skills sit deeper, point the address at that level, for example owner/repo/tree/main/skills/engineering.',
  '也可以把地址指到某个具体的 .md 文件 —— 那种情况不检查 frontmatter，直接装。':
    'You can also point the address at one .md file, which installs without a frontmatter check.',
  '新增 {n} 个': '{n} added',
  '更新 {n} 个': '{n} updated',
  '{n} 个同名但来自别的仓库，已改名保留（{names}）':
    '{n} share a name but come from another repo, kept under new names ({names})',
  '{n} 个你改过正文，没有覆盖（{names}）—— 想要上游版本就先删掉本地那个再装':
    '{n} have local edits and were left alone ({names}). Delete the local copy first if you want the upstream version.',
  '没有变化': 'No changes',
  '导出 {n} 个': '{n} exported',
  '导入 {n} 个': '{n} imported',
  '{n} 个两边都改过，各留一份（{names}）—— 自己看完再决定留哪个':
    '{n} changed on both sides, so both copies are kept ({names}). Read them and decide which to keep.',
  '{n} 个已一致': '{n} already match',
  '目录：{dir}': 'Folder: {dir}',
  '准备运行': 'Ready to run',
  '设备关闭期间错过，按规则跳过': 'Missed while the device was off, skipped by rule',
  '前次运行未结束，按规则跳过': 'The previous run had not finished, skipped by rule',
  '需要处理：{error}': 'Needs attention: {error}',
  '协作数据尚未读取': 'Collaboration data has not loaded yet',
  '运行不存在': 'That run does not exist',
  '此触发已创建运行': 'This trigger already created a run',
  '需要任务目标、验收标准和可用流程版本': 'This needs a task goal, acceptance criteria and a usable workflow version',
  '流程预算超过项目上限': 'The workflow budget exceeds the project cap',
  '此运行已在执行': 'That run is already going',
  '想在外面也能用：给两台设备装 Tailscale（或自建 WireGuard），让它们进同一个私有网络。那样地址就变成下面标了「私有网络」的那条，换到哪个 Wi-Fi 都通，而且不用把任何端口暴露出去。': 'To use it away from home: install Tailscale (or your own WireGuard) on both devices so they join the same private network. The address then becomes the one tagged \u0022private network\u0022 below - it works on any Wi-Fi, and nothing is exposed to the internet.',
  '挑第一条「私有网络」的，它不挑 Wi-Fi。': 'Pick the first one tagged private network - it works on any Wi-Fi.',
  '这台机器有直接连公网的网卡（{ifaces}）。服务会掐掉公网来源的连接，但这说明它不在路由器后面 —— 任何一条端口转发或者防火墙放行，都会立刻把这个入口变成公网入口。': 'This machine has an interface on the public internet ({ifaces}). The relay drops connections from public sources, but this means it is not behind a router - one port-forward or firewall rule would turn this into a public entry point.',
  '私有网络': 'Private network',
  '局域网': 'LAN',
  '链路本地': 'Link-local',
  '本机': 'This machine',
  '同步要往一个本地文件夹读写，所以只能在桌面端跑。手机端拿到同一份数据有两条路：把桌面端的同步文件夹放进网盘，或者用「遥控」把工具调用转发到桌面执行。': 'Sync reads and writes a local folder, so it runs on desktop only. Two ways to get the same data on a phone: put the desktop sync folder inside a cloud-synced directory, or use the relay to forward tool calls to the desktop.',
  '同步的是会话、项目、技能、定时任务、任务记录和路由做成率 —— 也就是这个应用积累下来的使用习惯。': 'What syncs: conversations, projects, skills, scheduled tasks, task records and route success rates - the working habits this app has accumulated.',
  'API 密钥不参与同步，一次也不会。': 'API keys never sync. Not once.',
  '密钥用系统的加密能力锁在本机（Windows 是 DPAPI，macOS 是钥匙串），搬到另一台机器上本来也解不开。另一台设备要用同一条路由，自己填一个密钥，或者走遥控转发。': 'Keys are locked to this machine by the OS keystore (DPAPI on Windows, Keychain on macOS) and would not decrypt elsewhere anyway. To use the same route on another device, enter a key there, or route through the relay.',
  '事件钩子也不同步：钩子是一条会自动执行的命令行，同步它等于让任何能写这个文件夹的人往你的桌面投递可执行内容。换设备请手动重配。': 'Hooks do not sync either: a hook is a command line that runs automatically, so syncing one would let anyone who can write to that folder deliver executable content to your desktop. Reconfigure hooks by hand on a new device.',
  '同步文件夹': 'Sync folder',
  '放进网盘、Syncthing 的共享目录、或者局域网/Tailscale 上挂的共享盘都行。落点上躺的永远是密文，所以这个文件夹本身不需要可信。': 'A cloud-synced directory, a Syncthing share, or a drive shared over your LAN or Tailscale all work. What lands there is always ciphertext, so the folder itself does not need to be trusted.',
  '还没选': 'Not chosen yet',
  '选文件夹': 'Choose folder',
  '同步口令': 'Sync passphrase',
  '至少 12 位。每次同步现输，不保存 —— 存下来就等于把锁和钥匙放在一起。两台设备必须用同一串。忘了只能重新配一次同步。': 'At least 12 characters. Typed each time and never stored - storing it would put the lock and the key in the same place. Both devices must use the same one. Forgetting it means setting sync up again.',
  '至少 12 位': 'At least 12 characters',
  '同步完成：{devices} 台设备，{items} 条记录；{bad} 个包没打开（口令不对或写到一半）。': 'Synced: {devices} devices, {items} records; {bad} bundles could not be opened (wrong passphrase, or written half-way).',
  '同步完成：{devices} 台设备，{items} 条记录。': 'Synced: {devices} devices, {items} records.',
  '立即同步': 'Sync now',
  '文件夹里有 {n} 台设备': '{n} devices in this folder',
  '导出对话': 'Export conversation',
  '导出': 'Export',
  '导出中…': 'Exporting...',
  '把这条对话存成文件': 'Save this conversation as a file',
  '存成文件': 'Save as a file',
  '已保存到': 'Saved to',
  '打开所在文件夹': 'Open containing folder',
  '打开文件': 'Open file',
  '已下载': 'Downloaded',
  '文件在这台设备的「下载」目录里，具体位置取决于系统设置。': 'It is in this device\u0027s downloads folder; where exactly depends on your system settings.',
  '格式': 'Format',
  'Markdown · 给人看': 'Markdown - for reading',
  'JSON · 完整记录': 'JSON - complete record',
  '包含执行步骤': 'Include tool steps',
  '包含思考过程': 'Include reasoning',
  '文件名': 'File name',
  '这条对话有 {n} 轮消息。': 'This conversation has {n} messages.',
  '导出的文件里没有 API 密钥。附件只保留名字、类型和大小，正文和图片本体不导出——否则一条带图的对话会有几十兆。': 'The exported file contains no API keys. Attachments keep only their name, type and size - the text and image data are not exported, or a conversation with a few images would run to tens of megabytes.',
  '这台设备上会走浏览器下载，不会弹保存位置。': 'On this device it goes through the browser download, with no save-location prompt.',
  '这条对话还没有内容可以导出。': 'There is nothing in this conversation to export yet.',
  '对话': 'Conversation',
  '完成': 'Done',
};

const hantCache = new Map<string, string>();
let hant: ((text: string) => string) | null = null;

function toHant(text: string): string {
  const cached = hantCache.get(text);
  if (cached !== undefined) return cached;
  if (!hant) hant = OpenCC.Converter({ from: 'cn', to: 'twp' });
  const converted = hant(text);
  if (hantCache.size > 4000) hantCache.clear();
  hantCache.set(text, converted);
  return converted;
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));
}

/** 源文案就是 key。英文查不到就退回简体，繁体永远有。 */
export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  if (locale === 'en') return fill(EN[text] ?? text, vars);
  if (locale === 'zh-Hant') return toHant(fill(text, vars));
  return fill(text, vars);
}

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/**
 * 给不在 React 树里的模块用的当前语言。
 *
 * 工具摘要、诊断结论这类文字是在运行过程中生成并落盘的，生成时用当时的界面语言，
 * 之后不再跟着切 —— 历史记录本来就该保留当时的样子。
 */
let activeLocale: Locale = 'zh-Hans';

export function setActiveLocale(locale: Locale) {
  activeLocale = locale;
}

/** 模块级翻译。React 组件里请用 useT()，它会跟着语言切换重渲染。 */
export const tr: Translate = (text, vars) => translate(activeLocale, text, vars);

const LocaleContext = React.createContext<Locale>('zh-Hans');

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return React.createElement(LocaleContext.Provider, { value: locale }, children);
}

export function useLocale(): Locale {
  return React.useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return React.useCallback((text, vars) => translate(locale, text, vars), [locale]);
}

/** 只给测试和不在 React 树里的地方用。 */
export function englishKeys(): string[] {
  return Object.keys(EN);
}
