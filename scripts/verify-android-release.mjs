import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readAndroidReleaseSource } from './android-release-source.mjs';

// Usage: verify-android-release.mjs <android-source-checkout> <output-dir> <apksigner> <aapt> <apk-built-and-signed-by-ci>
const source=readAndroidReleaseSource();
const nativeRoot=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]);
const apksigner=process.argv[4],aapt=process.argv[5],signedApk=process.argv[6];
if(!apksigner||!aapt||!signedApk)throw new Error('Android verification requires apksigner, aapt and the APK built by CI');
const git=args=>execFileSync('git',args,{cwd:nativeRoot,encoding:'utf8'}).trim();
if(git(['rev-parse','HEAD'])!==source.commit||git(['rev-parse',`${source.tag}^{commit}`])!==source.commit)
  throw new Error('Android checkout or immutable tag does not match the release source');
const read=file=>fs.readFileSync(path.join(nativeRoot,file),'utf8');
const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
if([pkg.version,lock.version,lock.packages?.['']?.version].some(v=>v!==source.version)||!read('src/lib/version.ts').includes(`'${source.version}'`))
  throw new Error('Android client package versions do not match the desktop release');
const apkName=`wickrunAI-${source.version}-android-preview.apk`;
const apk=path.resolve(signedApk);
const bytes=fs.readFileSync(apk);
const apkSha256=crypto.createHash('sha256').update(bytes).digest('hex');
const signingArgs=['verify','--verbose','--print-certs',apk];
const signature=apksigner.endsWith('.jar')
  ?execFileSync(process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java',['-jar',apksigner,...signingArgs],{encoding:'utf8'})
  :execFileSync(apksigner,signingArgs,{encoding:'utf8'});
const certificateSha256=signature.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9:]+)/i)?.[1].replaceAll(':','').toLowerCase();
if(certificateSha256!==source.certificateSha256)throw new Error('Android signing certificate does not match the pinned release certificate; refusing an incompatible upgrade');
const badging=execFileSync(aapt,['dump','badging',apk],{encoding:'utf8'});
const native=badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m);
if(!native||native[1]!==source.applicationId||native[3]!==source.version)throw new Error('Built Android application ID or version mismatch');
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,apkName),bytes);
fs.writeFileSync(path.join(output,'android-signature.txt'),signature);
fs.writeFileSync(path.join(output,'android-build-info.json'),JSON.stringify({version:source.version,versionCode:Number(native[2]),applicationId:native[1],commit:source.commit,tag:source.tag,certificateSha256,buildOrigin:'ci-build',apk:{name:apkName,bytes:bytes.length,sha256:apkSha256}},null,2)+'\n');
console.log(`Verified Android ${source.version}, source ${source.commit}, certificate ${certificateSha256}`);
