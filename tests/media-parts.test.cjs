const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const load = loader();
const sse = load(path.resolve(__dirname, '..', 'src/lib/sse.ts'));
const { extractMediaParts, mediaLinksInText } = load(path.resolve(__dirname, '..', 'src/lib/media-parts.ts'));
const { formatBytes } = load(path.resolve(__dirname, '..', 'src/lib/format-bytes.ts'));
const { typeOfPath, filePathsInText } = load(path.resolve(__dirname, '..', 'src/lib/artifacts.ts'));

test('images are found in OpenAI-compatible message.images and content parts', () => {
  const a = extractMediaParts({ images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] });
  assert.deepEqual(a, [{ kind: 'image', mime: 'image/png', base64: 'AAAA' }]);
  const b = extractMediaParts({ content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'https://cdn.example.com/a.png' } }] });
  assert.deepEqual(b, [{ kind: 'image', mime: undefined, url: 'https://cdn.example.com/a.png' }]);
});

test('audio, Gemini inline data, Responses images and Images API bodies are found', () => {
  assert.equal(extractMediaParts({ audio: { data: 'QUJD', format: 'mp3' } })[0].mime, 'audio/mpeg');
  const g = extractMediaParts({ parts: [{ inline_data: { mime_type: 'video/mp4', data: 'QUJD' } }] })[0];
  assert.equal(g.kind, 'video'); assert.equal(g.mime, 'video/mp4');
  assert.equal(extractMediaParts(undefined, { output: [{ type: 'image_generation_call', result: 'QUJD' }] })[0].kind, 'image');
  const images = extractMediaParts(undefined, { data: [{ b64_json: 'QUJD' }, { url: 'x' }] });
  assert.equal(images.length, 1);
});

test('plain text and http (non-https) links produce no media', () => {
  assert.deepEqual(extractMediaParts({ content: 'hello' }), []);
  assert.deepEqual(extractMediaParts({ images: ['http://insecure.example.com/a.png'] }), []);
});

test('links to videos and audio in the answer text are picked up once', () => {
  const parts = mediaLinksInText('视频好了：https://cdn.example.com/v/promo.mp4?sig=1 和 [音频](https://cdn.example.com/a.mp3) 再来一次 https://cdn.example.com/v/promo.mp4?sig=1');
  assert.deepEqual(parts.map(p => p.kind), ['video', 'audio']);
});

test('the shared stream parser reports media from streamed and whole responses', () => {
  const got = [];
  const consumer = sse.createStreamConsumer({ onContent() {}, onReasoning() {}, onToolCallDelta() {}, onUsage() {}, onMedia: p => got.push(...p) });
  consumer.chunk('data: ' + JSON.stringify({ choices: [{ delta: { images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] } }] }) + '\n\n');
  consumer.body(JSON.stringify({ choices: [{ message: { content: 'ok', audio: { data: 'QUJD', format: 'wav' } } }] }));
  assert.deepEqual(got.map(p => p.kind), ['image', 'audio']);
});

test('video and audio are recognised as artifacts, and large sizes read naturally', () => {
  assert.equal(typeOfPath('promo.MP4'), 'video');
  assert.equal(typeOfPath('voice.m4a'), 'audio');
  assert.equal(typeOfPath('a.avif'), 'image');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.00 GB');
  assert.deepEqual(filePathsInText('已生成 C:\\Users\\me\\out\\promo.mp4 和 `/home/u/v.webm`'), ['C:\\Users\\me\\out\\promo.mp4', '/home/u/v.webm']);
});
