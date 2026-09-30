const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/markdown-code.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleForTest = { exports: {} };
new Function('module', 'exports', compiled)(moduleForTest, moduleForTest.exports);
const { codeClipboardTexts } = moduleForTest.exports;
const clipboardSource = fs.readFileSync(path.join(__dirname, '../src/lib/code-clipboard.ts'), 'utf8');
const clipboardCompiled = ts.transpileModule(clipboardSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const clipboardModule = { exports: {} };
new Function('module', 'exports', clipboardCompiled)(clipboardModule, clipboardModule.exports);
const { isAppCodeClipboard } = clipboardModule.exports;

test('fenced code copy keeps source tabs, spaces, and LF newlines', async () => {
  const { marked } = await import('marked');
  const markdown = '```js\n\tconst x = 1;  \n  next();\n\n```\n';
  const token = marked.lexer(markdown).find((item) => item.type === 'code');
  assert.ok(token);
  assert.equal(codeClipboardTexts(markdown, [token])[0], '\tconst x = 1;  \n  next();\n\n');
  assert.equal(codeClipboardTexts(markdown, [token])[0].includes('\u00a0'), false);
});

test('fenced code copy keeps CRLF and terminal spaces without trimming', async () => {
  const { marked } = await import('marked');
  const markdown = '~~~txt\r\n\tline  \r\n\r\n~~~\r\n';
  const token = marked.lexer(markdown).find((item) => item.type === 'code');
  assert.ok(token);
  assert.equal(codeClipboardTexts(markdown, [token])[0], '\tline  \r\n\r\n');
});

test('only app-marked code paste bypasses ordinary Markdown parsing', () => {
  assert.equal(isAppCodeClipboard('<pre data-wickrun-code="1"><code>  const x = 1;</code></pre>'), true);
  assert.equal(isAppCodeClipboard('<pre data-wickrun-code="1"><code>\tdef f():</code></pre>'), true);
  assert.equal(isAppCodeClipboard('<ul><li>parent<ul><li>child</li></ul></li></ul>'), false);
  assert.equal(isAppCodeClipboard('<p>  indented prose</p>'), false);
});
