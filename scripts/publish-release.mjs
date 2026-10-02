import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizeLinuxAssets, verifyReleaseAssets, verifyAndroidAssets, androidApkName, ANDROID_EVIDENCE, releaseNotes, markAndroidAttached } from './release-assets.mjs';
import { readAndroidReleaseSource } from './android-release-source.mjs';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,tag=`v${version}`;
if(process.env.GITHUB_REF!==`refs/tags/${tag}`)throw new Error('Release tag must match package.json');
if(!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||''))throw new Error('Missing source commit');
const dir=path.resolve(process.argv[2]||'release-assets');
const gh=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const describe=names=>names.map(name=>{const bytes=fs.readFileSync(path.join(dir,name));return{name,bytes:bytes.length,sha256:sha256(bytes)};});
const apkName=androidApkName(version),androidFiles=[apkName,...ANDROID_EVIDENCE];

// The Android preview never blocks the desktop release: it is attached when it is
// complete and matches the pinned certificate, and reported as missing otherwise.
let androidSource=null,androidOk=false,androidReason='';
try{androidSource=readAndroidReleaseSource();}catch(error){androidReason='本版本尚未固定 Android 源码与签名证书';console.warn(`::warning::${error.message}`);}
if(androidSource){
  try{androidOk=verifyAndroidAssets(dir,version,androidSource);if(!androidOk)androidReason='Android 构建或签名未完成';}
  catch(error){androidReason='Android 安装包未通过校验';console.warn(`::warning::Android APK excluded: ${error.message}`);}
}
let existing;
try{existing=JSON.parse(gh(['release','view',tag,'--json','isDraft']));}catch{}
const upload=files=>{
  gh(['release','upload',tag,...files.map(f=>path.join(dir,f))]);
  const uploaded=JSON.parse(gh(['release','view',tag,'--json','assets'])).assets;
  for(const name of files){const asset=uploaded.find(a=>a.name===name);if(!asset||asset.size!==fs.statSync(path.join(dir,name)).size)throw new Error(`Uploaded asset missing or wrong size: ${name}`);}
};

if(existing&&!existing.isDraft){
  // A published release is immutable, except that a missing Android preview can be appended later.
  if(!androidOk)throw new Error(`${tag} is already public; refusing to replace published assets`);
  const assets=JSON.parse(gh(['release','view',tag,'--json','assets'])).assets.map(a=>a.name);
  if(assets.includes(apkName))throw new Error(`${tag} already has an Android APK; refusing to replace it`);
  fs.writeFileSync(path.join(dir,'SHA256SUMS-android.txt'),describe([apkName]).map(f=>`${f.sha256}  ${f.name}`).join('\n')+'\n');
  upload([...androidFiles,'SHA256SUMS-android.txt']);
  const body=JSON.parse(gh(['release','view',tag,'--json','body'])).body;
  const notes=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'release-notes-')),'notes.md');
  fs.writeFileSync(notes,markAndroidAttached(body));
  gh(['release','edit',tag,'--notes-file',notes]);
  console.log(`Android preview appended to ${tag}`);
  process.exit(0);
}

normalizeLinuxAssets(dir,version);
const required=verifyReleaseAssets(dir,version);
const files=fs.readdirSync(dir).filter(n=>(n.startsWith(`wickrunAI-${version}-`)&&(androidOk||n!==apkName))||(androidOk&&ANDROID_EVIDENCE.includes(n))||/^latest(?:-[a-z0-9-]+)?\.yml$/.test(n)).sort();
const manifest=describe(files);
fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),manifest.map(f=>`${f.sha256}  ${f.name}`).join('\n')+'\n');
fs.writeFileSync(path.join(dir,'release-manifest.json'),JSON.stringify({version,commit:process.env.GITHUB_SHA,androidIncluded:androidOk,android:androidOk?androidSource:null,required,files:manifest},null,2));
files.push('SHA256SUMS.txt','release-manifest.json');
const notesFile=path.join('docs','releases',`${tag}.md`);
const notes=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'release-notes-')),'notes.md');
fs.writeFileSync(notes,releaseNotes(fs.existsSync(notesFile)?fs.readFileSync(notesFile,'utf8'):`wickrunAI ${version}`,androidOk,androidReason));
if(!existing)gh(['release','create',tag,'--verify-tag','--draft','--title',`wickrunAI ${version}`,'--notes-file',notes]);
else gh(['release','edit',tag,'--notes-file',notes]);
gh(['release','upload',tag,...files.map(f=>path.join(dir,f)),'--clobber']);
const uploaded=JSON.parse(gh(['release','view',tag,'--json','assets'])).assets;
for(const name of files){const asset=uploaded.find(a=>a.name===name);if(!asset||asset.size!==fs.statSync(path.join(dir,name)).size)throw new Error(`Uploaded asset missing or wrong size: ${name}`);}
gh(['release','edit',tag,'--draft=false','--latest']);
console.log(gh(['release','view',tag,'--json','url','--jq','.url']));
