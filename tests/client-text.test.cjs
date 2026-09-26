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
