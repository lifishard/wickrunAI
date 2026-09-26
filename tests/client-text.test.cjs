const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const load=loader();
const {translate}=load(path.join(__dirname,'..','src','lib','i18n.ts'));
const {clientText}=load(path.join(__dirname,'..','src','lib','client-text.ts'));
const en=(text,vars)=>translate('en',text,vars);

test('main-process client status lines and model labels have English, including the ones with addresses and IDs',()=>{
  assert.equal(clientText(en,'已连接官方 Grok 账号，模型列表来自本机 Grok Desktop。'),'Connected to your official Grok account. The model list comes from Grok on this computer.');
  assert.match(clientText(en,'已发现 Kimi 桌面应用，但未找到提供 ACP 接口的 Kimi Code CLI。请安装官方 Kimi Code CLI，或选择其 kimi.exe 后重新检测。'),/^Found the Kimi desktop app/);
  assert.equal(clientText(en,'Claude Code CLI 已就绪。连接来源：自定义 API：http://localhost:20128/v1。已配置的本机网关已响应。尚未发送模型请求；可用模型以你的服务配置为准。'),
    'Claude Code CLI is ready. Connection: Custom API: http://localhost:20128/v1. The configured local gateway responded. No model request has been sent yet; available models depend on your service setup.');
  assert.match(clientText(en,'Claude Code CLI 可用。Claude Code 自己配置的本机网关 http://localhost:20128/v1 需要检查：没有取得本机网关的有效响应。这只影响「沿用 Claude Code 自己的配置」这个大脑；选本机订阅或 wickrunAI 路由不受影响。'),
    /^Claude Code CLI is available\. The local gateway http:\/\/localhost:20128\/v1 .*No valid response from the local gateway\. This only affects/);
  assert.equal(clientText(en,'sonnet · 配置别名 → claude-sonnet-x'),'sonnet · configured alias → claude-sonnet-x');
  assert.equal(clientText(en,'gpt-5.5'),'gpt-5.5');
  assert.equal(clientText((text,vars)=>translate('zh-Hans',text,vars),'sonnet · 配置别名 → x'),'sonnet · 配置别名 → x');
});

test('chat notices and pause reasons written in Chinese at run time show in English',()=>{
  assert.match(clientText(en,'任务已排队，等待 Claude 领取（在 Claude 里说「领取灯芯AI 任务」，或让它的定时任务自动领取）。进度和结果会回到此处。'),/^Task queued, waiting for Claude/);
  assert.equal(clientText(en,'调用额度暂时不足，12 秒后继续'),'Quota is temporarily exhausted, continuing in 12 s');
  assert.equal(clientText(en,'等待调用额度，30 秒后继续；已完成步骤保留'),'Waiting for quota, continuing in 30 s; finished steps are kept');
  assert.equal(clientText(en,'等待 Grok 返回 · 45 秒未收到新动态 · 可随时暂停'),'Waiting for Grok · no update for 45 s · you can pause any time');
  assert.equal(clientText(en,'Claude 报告任务受阻：缺少权限'.replace(' ','')),'Claude reported the task is blocked: 缺少权限');
  assert.match(clientText(en,'已开启「逐项修改前确认」：Codex 在沙箱里可以直接改工作目录里的文件、运行命令，改动不会先交给 wickrunAI 审核，本轮没有进入工作模式。可以改用对话模式、API 模型或 Grok，或在设置 → 工具里关闭「逐项修改前确认」。'),/^“Confirm each change first” is on: Codex can change files/);
});
