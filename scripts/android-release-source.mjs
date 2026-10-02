import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readAndroidReleaseSource(rootDir = '.') {
  const version = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version;
  const source = JSON.parse(fs.readFileSync(path.join(rootDir, 'config/android-release-source.json'), 'utf8'));
  const tagPrefix = `android-source-v${version}`;
  const matchingTag = source.tag === tagPrefix || typeof source.tag === 'string' && source.tag.startsWith(tagPrefix + '-r') && /^[1-9][0-9]*$/.test(source.tag.slice(tagPrefix.length + 2));
  if (source.version !== version || !matchingTag || !/^[a-f0-9]{40}$/.test(source.commit || '') || !/^[a-f0-9]{64}$/.test(source.certificateSha256 || '') || source.applicationId !== 'dev.anyai.app')
    throw new Error('Android source must pin the matching version, immutable commit, tag, application and signing certificate');
  return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readAndroidReleaseSource();
  const lines = Object.entries(source).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else console.log(JSON.stringify(source, null, 2));
}
