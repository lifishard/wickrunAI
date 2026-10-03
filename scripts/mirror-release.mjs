/*
 * Copies one published Release of the source repository (where the code lives and
 * CI builds) to the public releases repository that installs and the website read.
 *
 * Append-only: an asset that is already in the mirror is never replaced, so an
 * installer cannot change after people downloaded it. A missing Android preview can
 * still be added later, and the notes follow the source release.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const SOURCE_REPO = 'lifishard/wickrunAI';
export const MIRROR_REPO = 'lifishard/wickrunAI-releases';
const TAG = /^v\d+\.\d+\.\d+$/;

/**
 * run(who, args) runs `gh` as the source ('source') or the mirror ('mirror') account
 * and returns stdout; download(tag, dir) puts the source assets into dir.
 */
export function mirrorRelease({ tag, run, download, tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-')), log = console.log }) {
  if (!TAG.test(tag)) throw new Error(`Not a release tag: ${tag}`);
  const source = JSON.parse(run('source', ['release', 'view', tag, '--json', 'isDraft,isPrerelease,name,body,assets']));
  if (source.isDraft || source.isPrerelease) throw new Error(`${tag} is not a published release in the source repository`);
  const dir = tmp();
  download(tag, dir);
  for (const asset of source.assets) {
    const file = path.join(dir, asset.name);
    if (!fs.existsSync(file) || fs.statSync(file).size !== asset.size) throw new Error(`Downloaded asset missing or wrong size: ${asset.name}`);
  }
  let mirror = null;
  try { mirror = JSON.parse(run('mirror', ['release', 'view', tag, '--json', 'isDraft,assets'])); } catch { /* not mirrored yet */ }
  const notes = path.join(dir, '.mirror-notes.md');
  fs.writeFileSync(notes, source.body || source.name || tag);
  if (!mirror) run('mirror', ['release', 'create', tag, '--draft', '--title', source.name || tag, '--notes-file', notes]);
  const present = new Map((mirror?.assets ?? []).map(a => [a.name, a.size]));
  for (const asset of source.assets) {
    if (present.has(asset.name) && present.get(asset.name) !== asset.size) throw new Error(`${asset.name} differs from the copy already published in the mirror; refusing to replace it`);
  }
  const missing = source.assets.filter(a => !present.has(a.name)).map(a => a.name);
  if (missing.length) run('mirror', ['release', 'upload', tag, ...missing.map(name => path.join(dir, name))]);
  const after = JSON.parse(run('mirror', ['release', 'view', tag, '--json', 'assets'])).assets;
  for (const asset of source.assets) {
    if (after.find(a => a.name === asset.name)?.size !== asset.size) throw new Error(`Mirrored asset missing or wrong size: ${asset.name}`);
  }
  const latest = (() => { try { return run('source', ['api', `repos/${SOURCE_REPO}/releases/latest`, '--jq', '.tag_name']).trim(); } catch { return ''; } })();
  run('mirror', ['release', 'edit', tag, '--notes-file', notes, '--draft=false', ...(latest === tag ? ['--latest'] : [])]);
  log(`${tag}: ${missing.length} asset(s) copied to ${MIRROR_REPO}${latest === tag ? ', marked latest' : ''}`);
  return { copied: missing, latest: latest === tag };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2] || '';
  const tokens = { source: process.env.SOURCE_TOKEN, mirror: process.env.MIRROR_TOKEN };
  if (!tokens.mirror) {
    console.error('::error::RELEASES_REPO_TOKEN is missing. Add it under Settings → Secrets and variables → Actions → Secrets (not Variables).');
    process.exit(1);
  }
  // Each account only ever talks to its own repository; `gh api` calls carry the path themselves.
  const gh = (who, args) => execFileSync('gh', [...args, ...(args[0] === 'api' ? [] : ['-R', who === 'source' ? SOURCE_REPO : MIRROR_REPO])],
    { env: { ...process.env, GH_TOKEN: tokens[who] ?? '', GH_REPO: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    mirrorRelease({ tag, run: gh, download: (t, dir) => gh('source', ['release', 'download', t, '--dir', dir]) });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
