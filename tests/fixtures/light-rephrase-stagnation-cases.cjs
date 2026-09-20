'use strict';

const chinesePlans = [
  '我现在要完成两件事：\n1. 扩展 data/courses_seed.json 的 readings（用 Canvas 真实数据）\n2. 在学期视图增加阅读清单展开面板',
  '现在清楚了，开始实现：\n1. 扩展 data/courses_seed.json 的 readings 字段（用 Canvas 真实数据）\n2. 在学期视图加阅读清单展开面板',
  '先读取代码再实现：\n1. 扩展 data/courses_seed.json 的 readings 字段（使用 Canvas 真实数据）\n2. 在学期视图增加阅读清单展开面板',
];

const englishPlans = [
  'I will do two things.\n1. Update the release manifest with the verified package hashes\n2. Add the release summary to the delivery page',
  'I will now do two things.\n1. Update the release manifest using the verified package hashes\n2. Add the release summary to the delivery page',
  'I am starting the same two steps.\n1. Update the release manifest with verified package hashes\n2. Add the release summary on the delivery page',
];

const chineseReviewPlans = [
  '接下来处理两项检查：\n1. 核对发布说明是否列出真实测试结果\n2. 核对下载页是否展示正确版本号',
  '现在继续两项检查：\n1. 核对发布说明有没有列出真实测试结果\n2. 核对下载页面是否展示正确版本号',
  '我会完成这两项检查：\n1. 核对发布说明是否写出真实测试结果\n2. 核对下载页展示的版本号是否正确',
];

const englishReviewPlans = [
  'I will verify two items.\n1. Check that the audit report includes the real command result\n2. Check that the download page shows the correct version',
  'I will now verify two items.\n1. Check whether the audit report includes the real command result\n2. Check whether the download page shows the correct version',
  'I am going to verify these items.\n1. Check that the audit report has the real command result\n2. Check that the download page has the correct version',
];

module.exports = [
  { id: 'tp-cn-light-paraphrase', label: true, baseIssue: 'no verified action', text: chinesePlans.join('\n\n') },
  { id: 'tp-en-light-paraphrase', label: true, baseIssue: 'no verified action', text: englishPlans.join('\n\n') },
  { id: 'tp-cn-review-light-paraphrase', label: true, baseIssue: 'no verified action', text: chineseReviewPlans.join('\n\n') },
  { id: 'tp-en-review-light-paraphrase', label: true, baseIssue: 'no verified action', text: englishReviewPlans.join('\n\n') },
  { id: 'tn-similar-but-completion-check-passed', label: false, baseIssue: undefined, text: chinesePlans.join('\n\n') },
  { id: 'tn-english-similar-but-new-evidence-passed', label: false, baseIssue: undefined, text: englishReviewPlans.join('\n\n') },
  { id: 'tn-exact-repeat-is-hard-evidence', label: false, baseIssue: 'no verified action', text: chinesePlans[0]+'\n\n'+chinesePlans[0]+'\n\n'+chinesePlans[0] },
  { id: 'tn-changing-values', label: false, baseIssue: 'no verified action', text: chinesePlans.map((plan,index)=>plan+`，课程编号 ${index}`).join('\n\n') },
  { id: 'tn-code-block', label: false, baseIssue: 'no verified action', text: '```text\n'+chinesePlans.join('\n\n')+'\n```' },
  { id: 'tn-only-two-rephrasings', label: false, baseIssue: 'no verified action', text: chinesePlans.slice(0,2).join('\n\n') },
  { id: 'tn-normal-stage-progression', label: false, baseIssue: 'no verified action', text: [
    '先检查现状：\n1. 读取发布清单并记录当前包哈希\n2. 读取下载页并记录当前版本号',
    '然后执行修改：\n1. 更新发布清单中的目标包哈希\n2. 更新下载页中的目标版本号',
    '最后验证结果：\n1. 重新读取发布清单并比较新包哈希\n2. 重新读取下载页并比较新版本号',
  ].join('\n\n') },
  { id: 'tn-same-template-different-goals', label: false, baseIssue: 'no verified action', text: [
    '计划 A：\n1. 核对发布清单的包哈希与签名\n2. 更新下载页的版本摘要',
    '计划 B：\n1. 核对工资账单的币种与日期\n2. 更新财务页的发票摘要',
    '计划 C：\n1. 核对课程名单的学号与班级\n2. 更新教务页的选课摘要',
  ].join('\n\n') },
  { id: 'tn-short-acknowledgements', label: false, baseIssue: 'no verified action', text: '好的，我来处理。\n\n明白，我继续。\n\n收到，现在开始。' },
  { id: 'tn-one-plan-plus-evidence', label: false, baseIssue: 'no verified action', text: chinesePlans[0]+'\n\n已读取 manifest.json，实际版本为 2.17.10，调用证据 read-42。' },
  { id: 'tn-distinct-plans', label: false, baseIssue: 'no verified action', text: [
    '方案一：\n1. 只核对账单日期和币种\n2. 输出缺失发票清单',
    '方案二：\n1. 运行前端单元测试并修复失败\n2. 截取移动端布局截图',
    '方案三：\n1. 阅读数据库迁移记录\n2. 比较索引创建耗时',
  ].join('\n\n') },
];
