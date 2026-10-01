const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');

test('release requires all nine platform packages and matching Android evidence',async t=>{
  const {requiredAssets,verifyReleaseAssets,normalizeLinuxAssets}=await import('../scripts/release-assets.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anyai-release-assets-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const names=requiredAssets('1.3.1');
  assert.equal(names.length,9);
  for(const name of names){
    const fd=fs.openSync(path.join(dir,name),'w');
    const header=name.endsWith('.exe')?'MZ':name.endsWith('.zip')||name.endsWith('.apk')?'PK':name.endsWith('.deb')?'!<arch>\n':name.endsWith('.AppImage')?'\x7fELF':'dmg';
    fs.writeSync(fd,header);fs.ftruncateSync(fd,1024*1024);fs.closeSync(fd);
  }
  const certificateSha256='1'.repeat(64);
  fs.writeFileSync(path.join(dir,'android-signature.txt'),`Verifies\nVerified using v1 scheme: true\nVerified using v2 scheme: true\nSigner #1 certificate SHA-256 digest: ${certificateSha256}\n`);
  const apkName='wickrunAI-1.3.1-android-preview.apk',apk=fs.readFileSync(path.join(dir,apkName));
  const apkSha256=crypto.createHash('sha256').update(apk).digest('hex');
  const info={version:'1.3.1',applicationId:'dev.anyai.app',versionCode:1030100,commit:'a'.repeat(40),tag:'android-source-v1.3.1',certificateSha256,apkSha256,apk:{name:apkName,bytes:apk.length,sha256:apkSha256}};
  fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify(info));
  assert.deepEqual(verifyReleaseAssets(dir,'1.3.1',info),names);
  const revisedInfo={...info,tag:'android-source-v1.3.1-r2'};
  fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify(revisedInfo));
  assert.deepEqual(verifyReleaseAssets(dir,'1.3.1',revisedInfo),names);
  fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify(info));
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1',{...info,commit:'b'.repeat(40)}),/pinned source/);
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1',{...info,certificateSha256:'2'.repeat(64)}),/signing certificate/);
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1',{...info,apkSha256:'2'.repeat(64)}),/pinned source/);
  fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify({...info,version:'1.3.2'}));
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1'),/version or identity mismatch/);
  fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify({...info,apk:{...info.apk,sha256:'0'.repeat(64)}}));
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1'),/checksum mismatch/);
  fs.writeFileSync(path.join(dir,'android-build-info.json'),JSON.stringify(info));
  fs.renameSync(path.join(dir,apkName),path.join(dir,apkName+'.saved'));
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1'),/Missing or incomplete/);
  fs.renameSync(path.join(dir,apkName+'.saved'),path.join(dir,apkName));
  fs.renameSync(path.join(dir,'android-signature.txt'),path.join(dir,'android-signature.txt.saved'));
  assert.throws(()=>verifyReleaseAssets(dir,'1.3.1'),/signature verification/);
  fs.renameSync(path.join(dir,'android-signature.txt.saved'),path.join(dir,'android-signature.txt'));
  assert.deepEqual(verifyReleaseAssets(dir,'1.3.1'),names);
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
});

test('Android source pins version, immutable source, application identity and signing certificate',async t=>{
  const {readAndroidReleaseSource}=await import('../scripts/android-release-source.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'anyai-android-release-source-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'config'));
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({version:'4.0.0'}));
  const source={version:'4.0.0',tag:'android-source-v4.0.0',commit:'a'.repeat(40),certificateSha256:'1'.repeat(64),apkSha256:'2'.repeat(64),applicationId:'dev.anyai.app'};
  const write=value=>fs.writeFileSync(path.join(dir,'config/android-release-source.json'),JSON.stringify(value));
  write(source);
  assert.deepEqual(readAndroidReleaseSource(dir),source);
  const revised={...source,tag:'android-source-v4.0.0-r2'};
  write(revised);assert.deepEqual(readAndroidReleaseSource(dir),revised);
  for(const invalid of [{...source,version:'3.0.0'},{...source,tag:'main'},{...source,tag:'android-source-v3.0.0-r2'},{...source,tag:'android-source-v4.0.0-r0'},{...source,tag:'android-source-v4.0.0-r2-main'},{...source,commit:'main'},{...source,certificateSha256:''},{...source,apkSha256:''},{...source,applicationId:'dev.anyai.app.v4'},{...source,applicationId:'another.app'}]){
    write(invalid);assert.throws(()=>readAndroidReleaseSource(dir),/must pin/);
  }
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
