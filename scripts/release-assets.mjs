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
    `wickrunAI-${version}-linux-x64.AppImage`,`wickrunAI-${version}-linux-x64.deb`,
    `wickrunAI-${version}-android-preview.apk`];
}
export function verifyReleaseAssets(dir,version,androidSource){
  const names=requiredAssets(version);
  for(const name of names){
    const file=path.join(dir,name);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size<1024*1024)throw new Error(`Missing or incomplete release asset: ${name}`);
    const fd=fs.openSync(file,'r'),head=Buffer.alloc(8);
    try{fs.readSync(fd,head,0,8,0);}finally{fs.closeSync(fd);}
    const prefix=name.endsWith('.exe')?'MZ':name.endsWith('.zip')||name.endsWith('.apk')?'PK':name.endsWith('.deb')?'!<arch>\n':name.endsWith('.AppImage')?'\x7fELF':null;
    if(prefix&&!head.subarray(0,Buffer.byteLength(prefix)).equals(Buffer.from(prefix)))throw new Error(`Unexpected asset format: ${name}`);
  }
  const signature=path.join(dir,'android-signature.txt');
  if(!fs.existsSync(signature)||!fs.statSync(signature).isFile()||fs.statSync(signature).size<100)
    throw new Error('Missing Android APK signature verification');
  const info=JSON.parse(fs.readFileSync(path.join(dir,'android-build-info.json'),'utf8'));
  const apk=`wickrunAI-${version}-android-preview.apk`;
  const bytes=fs.readFileSync(path.join(dir,apk));
  if(info.version!==version||info.applicationId!=='dev.anyai.app'||!Number.isSafeInteger(info.versionCode)||info.versionCode<=0)
    throw new Error('Android application version or identity mismatch');
  if(!/^[a-f0-9]{40}$/.test(info.commit||'')||!/^android-source-v\d+\.\d+\.\d+(?:-r[1-9][0-9]*)?$/.test(info.tag||''))
    throw new Error('Invalid immutable Android source');
  if(!/^[a-f0-9]{64}$/.test(info.certificateSha256||'')||info.apk?.name!==apk||info.apk.bytes!==bytes.length||info.apk.sha256!==crypto.createHash('sha256').update(bytes).digest('hex'))
    throw new Error('Android APK metadata or checksum mismatch');
  const verifiedCertificate=fs.readFileSync(signature,'utf8').match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9:]+)/i)?.[1].replaceAll(':','').toLowerCase();
  if(verifiedCertificate!==info.certificateSha256)throw new Error('Android signature report does not match the APK metadata');
  if(androidSource&&(info.commit!==androidSource.commit||info.tag!==androidSource.tag||info.applicationId!==androidSource.applicationId||info.certificateSha256!==androidSource.certificateSha256||info.apk.sha256!==androidSource.apkSha256))
    throw new Error('Android APK does not match the pinned source or signing certificate');
  return names;
}
