'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const bridge = require(path.resolve(__dirname, '..', process.env.BRIDGE_ARTIFACTS_PATH || 'electron/bridge-artifacts.cjs'));

const make = (name, bytes) => bridge.cleanArtifact({ name, requestKey: 'media-key-1', base64: Buffer.from(bytes).toString('base64') });
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(16)]);

test('video and audio can travel between a task and its requester', () => {
  assert.equal(make('promo.mp4', mp4).mimeType, 'video/mp4');
  assert.equal(make('clip.mov', Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.alloc(8)])).mimeType, 'video/quicktime');
  assert.equal(make('clip.webm', Buffer.concat([Buffer.from('1a45dfa3', 'hex'), Buffer.alloc(8)])).mimeType, 'video/webm');
  assert.equal(make('voice.mp3', Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1')).mimeType, 'audio/mpeg');
  assert.equal(make('voice.wav', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])).mimeType, 'audio/wav');
  assert.equal(make('voice.ogg', Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8)])).mimeType, 'audio/ogg');
  assert.equal(make('voice.flac', Buffer.concat([Buffer.from('fLaC'), Buffer.alloc(8)])).mimeType, 'audio/flac');
});

test('a file renamed to look like media is rejected', () => {
  for (const name of ['fake.mp4', 'fake.mp3', 'fake.webm', 'fake.wav', 'fake.ogg', 'fake.flac']) {
    assert.throws(() => make(name, Buffer.from('this is plain text, not media')), /does not match its extension/, name);
  }
});

test('existing types keep working', () => {
  assert.equal(make('a.png', Buffer.from('89504e470d0a1a0a00000000', 'hex')).mimeType, 'image/png');
  assert.throws(() => make('a.exe', Buffer.from('MZ')), /Unsupported artifact type/);
});
