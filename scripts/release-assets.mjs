import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export function normalizeLinuxAssets(dir,version){
  requiredAssets(version);
  const aliases=[['x86_64','AppImage'],['amd64','deb']].map(([arch,ext])=>[`wickrunAI-${version}-linux-${arch}.${ext}`,`wickrunAI-${version}-linux-x64.${ext}`]);
  for(const [from,to] of aliases){
    if(fs.existsSync(path.join(dir,from))){
      if(fs.existsSync(path.join(dir,to)))throw new Error(`Conflicting Linux release assets: ${to}`);
      fs.renameSync(path.join(dir,from),path.join(dir,to));
    }
  }
  for(const name of fs.readdirSync(dir).filter(n=>/^latest-linux.*\.yml$/.test(n))){
    const file=path.join(dir,name);
    let content=fs.readFileSync(file,'utf8');
    for(const [from,to] of aliases)content=content.replaceAll(from,to);
    fs.writeFileSync(file,content);
  }
}
export function requiredAssets(version){
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid release version');
  return [`wickrunAI-${version}-win-x64-setup.exe`,`wickrunAI-${version}-win-x64-portable.exe`,
    ...['x64','arm64'].flatMap(arch=>['dmg','zip'].map(ext=>`wickrunAI-${version}-mac-${arch}.${ext}`)),
    `wickrunAI-${version}-linux-x64.AppImage`,`wickrunAI-${version}-linux-x64.deb`];
}
/** The Android preview is built and signed by CI separately; it never blocks the desktop release. */
export function androidApkName(version){
  requiredAssets(version);
  return `wickrunAI-${version}-android-preview.apk`;
}
export const ANDROID_EVIDENCE=['android-signature.txt','android-build-info.json'];
function checkFile(dir,name){
  const file=path.join(dir,name);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size<1024*1024)throw new Error(`Missing or incomplete release asset: ${name}`);
  const fd=fs.openSync(file,'r'),head=Buffer.alloc(8);
  try{fs.readSync(fd,head,0,8,0);}finally{fs.closeSync(fd);}
  const prefix=name.endsWith('.exe')?'MZ':name.endsWith('.zip')||name.endsWith('.apk')?'PK':name.endsWith('.deb')?'!<arch>\n':name.endsWith('.AppImage')?'\x7fELF':null;
  if(prefix&&!head.subarray(0,Buffer.byteLength(prefix)).equals(Buffer.from(prefix)))throw new Error(`Unexpected asset format: ${name}`);
}
/** The eight desktop packages. Returns their names. */
export function verifyReleaseAssets(dir,version){
  const names=requiredAssets(version);
  for(const name of names)checkFile(dir,name);
  return names;
}
/**
 * Android is optional: returns false when no Android file is present at all,
 * true when the APK and its evidence are complete and match the pinned release
 * certificate. A partial or inconsistent set is an error, never silently dropped.
 */
export function verifyAndroidAssets(dir,version,androidSource){
  const apk=androidApkName(version);
  const present=[apk,...ANDROID_EVIDENCE].filter(n=>fs.existsSync(path.join(dir,n)));
  if(!present.length)return false;
  checkFile(dir,apk);
  const signature=path.join(dir,'android-signature.txt');
  if(!fs.existsSync(signature)||!fs.statSync(signature).isFile()||fs.statSync(signature).size<100)
    throw new Error('Missing Android APK signature verification');
  if(!fs.existsSync(path.join(dir,'android-build-info.json')))throw new Error('Missing Android build info');
  const info=JSON.parse(fs.readFileSync(path.join(dir,'android-build-info.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(dir,apk));
  if(info.version!==version||info.applicationId!=='dev.anyai.app'||!Number.isSafeInteger(info.versionCode)||info.versionCode<=0)
    throw new Error('Android application version or identity mismatch');
  if(info.buildOrigin!=='ci-build')throw new Error('Android APK must be built and signed by CI');
  if(!/^[a-f0-9]{40}$/.test(info.commit||'')||!/^android-source-v\d+\.\d+\.\d+(?:-r[1-9][0-9]*)?$/.test(info.tag||''))
    throw new Error('Invalid immutable Android source');
  if(!/^[a-f0-9]{64}$/.test(info.certificateSha256||'')||info.apk?.name!==apk||info.apk.bytes!==bytes.length||info.apk.sha256!==crypto.createHash('sha256').update(bytes).digest('hex'))
    throw new Error('Android APK metadata or checksum mismatch');
  const verifiedCertificate=fs.readFileSync(signature,'utf8').match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9:]+)/i)?.[1].replaceAll(':','').toLowerCase();
  if(verifiedCertificate!==info.certificateSha256)throw new Error('Android signature report does not match the APK metadata');
  if(androidSource&&(info.commit!==androidSource.commit||info.tag!==androidSource.tag||info.applicationId!==androidSource.applicationId||info.certificateSha256!==androidSource.certificateSha256))
    throw new Error('Android APK does not match the pinned source or signing certificate');
  return true;
}
const ANDROID_MISSING='<!-- android-missing -->';
/** Release body: the version notes, plus a visible note while the Android preview is not attached yet. */
export function releaseNotes(base,androidIncluded,reason=''){
  const text=String(base||'').trimEnd();
  if(androidIncluded)return text+'\n';
  const why=reason?`（${reason}）`:'';
  return `${text}\n\n${ANDROID_MISSING}\n> Android 预览版暂未随本次发布${why}。构建并签名完成后会自动追加到本页的资产里。\n`;
}
/** Once the APK is attached, the "missing" note is replaced. Bodies without the marker are left alone. */
export function markAndroidAttached(body){
  return String(body||'').replace(new RegExp(`${ANDROID_MISSING}\\n>[^\\n]*`),'Android 预览版 APK 已追加到本页资产（签名证书见 android-signature.txt）。');
}
