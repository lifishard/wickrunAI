const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');

test('release requires the eight desktop packages; Android is optional but must be complete and pinned',async t=>{
  const {requiredAssets,verifyReleaseAssets,verifyAndroidAssets,androidApkName,normalizeLinuxAssets,releaseNotes,markAndroidAttached}=await import('../scripts/release-assets.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anyai-release-assets-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const names=requiredAssets('1.3.1');
  assert.equal(names.length,8);
  const apkName=androidApkName('1.3.1');
  assert.equal(apkName,'wickrunAI-1.3.1-android-preview.apk');
  const stub=(name)=>{
    const fd=fs.openSync(path.join(dir,name),'w');
    const header=name.endsWith('.exe')?'MZ':name.endsWith('.zip')||name.endsWith('.apk')?'PK':name.endsWith('.deb')?'!<arch>\n':name.endsWith('.AppImage')?'\x7fELF':'dmg';
    fs.writeSync(fd,header);fs.ftruncateSync(fd,1024*1024);fs.closeSync(fd);
  };
  for(const name of names)stub(name);
  // Desktop only: the release is complete and Android is simply absent, never an error.
  assert.deepEqual(verifyReleaseAssets(dir,'1.3.1'),names);
  assert.equal(verifyAndroidAssets(dir,'1.3.1'),false);
  stub(apkName);
  const certificateSha256='1'.repeat(64);
  const signature=`Verifies\nVerified using v1 scheme: true\nVerified using v2 scheme: true\nSigner #1 certificate SHA-256 digest: ${certificateSha256}\n`;
  const apk=fs.readFileSync(path.join(dir,apkName));
  const apkSha256=crypto.createHash('sha256').update(apk).digest('hex');
  const info={version:'1.3.1',applicationId:'dev.anyai.app',versionCode:1030100,commit:'a'.repeat(40),tag:'android-source-v1.3.1',certificateSha256,buildOrigin:'ci-build',apk:{name:apkName,bytes:apk.length,sha256:apkSha256}};
  const writeInfo=value=>fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify(value));
  // An APK without its evidence is a partial set and must be rejected, not silently skipped.
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1'),/signature verification/);
  fs.writeFileSync(path.join(dir,'android-signature.txt'),signature);
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1'),/Missing Android build info/);
  writeInfo(info);
  const pinned={commit:info.commit,tag:info.tag,applicationId:info.applicationId,certificateSha256};
  assert.equal(verifyAndroidAssets(dir,'1.3.1',pinned),true);
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1',{...pinned,commit:'b'.repeat(40)}),/pinned source/);
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1',{...pinned,certificateSha256:'2'.repeat(64)}),/pinned source or signing certificate/);
  writeInfo({...info,buildOrigin:'local-native-build'});
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1',pinned),/built and signed by CI/);
  writeInfo({...info,version:'1.3.2'});
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1'),/version or identity mismatch/);
  writeInfo({...info,apk:{...info.apk,sha256:'0'.repeat(64)}});
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1'),/checksum mismatch/);
  writeInfo(info);
  fs.writeFileSync(path.join(dir,'android-signature.txt'),signature.replace(certificateSha256,'3'.repeat(64)));
  assert.throws(()=>verifyAndroidAssets(dir,'1.3.1'),/does not match the APK metadata/);
  fs.writeFileSync(path.join(dir,'android-signature.txt'),signature);
  assert.equal(verifyAndroidAssets(dir,'1.3.1',pinned),true);
  // Desktop checks are independent of Android.
  fs.renameSync(path.join(dir,'wickrunAI-1.3.1-linux-x64.AppImage'),path.join(dir,'wickrunAI-1.3.1-linux-x86_64.AppImage'));
  fs.renameSync(path.join(dir,'wickrunAI-1.3.1-linux-x64.deb'),path.join(dir,'wickrunAI-1.3.1-linux-amd64.deb'));
  fs.writeFileSync(path.join(dir,'latest-linux.yml'),'url: wickrunAI-1.3.1-linux-x86_64.AppImage');
  normalizeLinuxAssets(dir,'1.3.1');
  assert.deepEqual(verifyReleaseAssets(dir,'1.3.1'),names);
  assert.equal(fs.readFileSync(path.join(dir,'latest-linux.yml'),'utf8'),'url: wickrunAI-1.3.1-linux-x64.AppImage');
  const mac=path.join(dir,'wickrunAI-1.3.1-mac-arm64.dmg');
  fs.renameSync(mac,mac+'.saved');
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1'),/Missing or incomplete/);
  fs.renameSync(mac+'.saved',mac);
  const exe=fs.openSync(path.join(dir,names[0]),'r+');fs.writeSync(exe,'XX');fs.closeSync(exe);
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1'),/Unexpected asset format/);
  // Release notes say plainly when Android is missing, and the note goes away once it is attached.
  const withoutAndroid=releaseNotes('# 1.3.1\n- fixes',false,'Android 构建或签名未完成');
  assert.match(withoutAndroid,/Android 预览版暂未随本次发布（Android 构建或签名未完成）/);
  assert.equal(releaseNotes('# 1.3.1',true),'# 1.3.1\n');
  assert.doesNotMatch(markAndroidAttached(withoutAndroid),/暂未随本次发布/);
  assert.match(markAndroidAttached(withoutAndroid),/Android 预览版 APK 已追加/);
  assert.equal(markAndroidAttached('no marker here'),'no marker here');
});

test('Android source pins version, immutable source, application identity and signing certificate',async t=>{
  const {readAndroidReleaseSource}=await import('../scripts/android-release-source.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anyai-android-release-source-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'));
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version:'4.0.0'}));
  const source={version:'4.0.0',tag:'android-source-v4.0.0',commit:'a'.repeat(40),certificateSha256:'1'.repeat(64),applicationId:'dev.anyai.app'};
  const write=value=>fs.writeFileSync(path.join(dir,'config/android-release-source.json'),JSON.stringify(value));
  write(source);
  assert.deepEqual(readAndroidReleaseSource(dir),source);
  const revised={...source,tag:'android-source-v4.0.0-r2'};
  write(revised);assert.deepEqual(readAndroidReleaseSource(dir),revised);
  for(const invalid of [{...source,version:'3.0.0'},{...source,tag:'main'},{...source,tag:'android-source-v3.0.0-r2'},{...source,tag:'android-source-v4.0.0-r0'},{...source,tag:'android-source-v4.0.0-r2-main'},{...source,commit:'main'},{...source,certificateSha256:''},{...source,applicationId:'dev.anyai.app.v4'},{...source,applicationId:'another.app'}]){
    write(invalid);assert.throws(()=>readAndroidReleaseSource(dir),/must pin/);
  }
});

test('the repository pins a CI-signed Android source for the current version',async()=>{
  const {readAndroidReleaseSource}=await import('../scripts/android-release-source.mjs');
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));
  const source=readAndroidReleaseSource(path.join(__dirname,'..'));
  assert.equal(source.version,pkg.version);
  assert.equal(source.applicationId,'dev.anyai.app');
  assert.equal('apkSha256' in source,false);
});

test('release tag push is repeatable and cannot replace a different commit',async t=>{
  const {releaseTag,checkReleaseTag}=await import('../scripts/release-tag.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anyai-release-git-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const remote=path.join(dir,'remote.git'),repo=path.join(dir,'repo');
  const git=(args,cwd=dir)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--bare',remote]);git(['init',repo]);
  git(['config','user.name','Release Test'],repo);git(['config','user.email','test@example.invalid'],repo);
  git(['remote','add','origin',remote],repo);
  git(['commit','--allow-empty','-m','initial'],repo);
  assert.equal(releaseTag(repo,'1.3.1').alreadyPushed,false);
  assert.equal(releaseTag(repo,'1.3.1').alreadyPushed,true);
  assert.throws(()=>checkReleaseTag(repo,'1.3.1',true),/不能覆盖/);
  assert.equal(checkReleaseTag(repo,'2.0.0',true).tag,'v2.0.0');
  assert.equal(git(['tag','--list','v2.0.0'],repo),'');
  const original=git(['rev-parse','refs/tags/v1.3.1^{}'],remote);
  git(['commit','--allow-empty','-m','new'],repo);
  assert.throws(()=>releaseTag(repo,'1.3.1'),/不能覆盖/);
  assert.equal(git(['rev-parse','refs/tags/v1.3.1^{}'],remote),original);
});
