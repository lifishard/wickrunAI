const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const modulePromise = import(pathToFileURL(path.join(root, 'scripts/mobile-config.mjs')).href);
function copy(from, base) {
  const dest = path.join(base, from);
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  fs.cpSync(path.join(root, from), dest, {recursive:true});
}
test('mobile version numbers increase without collision and reject unsupported formats', async () => {
  const { mobileVersion } = await modulePromise;
  assert.equal(mobileVersion('2.20.9').androidCode, 2020009);
  assert.ok(mobileVersion('2.21.0').androidCode > mobileVersion('2.20.99').androidCode);
  for (const value of ['2.20.9-beta.1','2.20','2.100.0','2.20.100','2100.0.0']) assert.throws(() => mobileVersion(value));
});
test('Android preparation preserves custom Activity code and is idempotent', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-android-config-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  for (const file of ['android/app/build.gradle','android/app/src/main/AndroidManifest.xml','android/app/src/main/java/dev/anyai/app/MainActivity.java','native/android']) copy(file, dir);
  const activity = path.join(dir,'android/app/src/main/java/dev/anyai/app/MainActivity.java');
  fs.writeFileSync(activity, fs.readFileSync(activity,'utf8').replace('public class MainActivity extends BridgeActivity {','public class MainActivity extends BridgeActivity {\n    public String customValue() { return "preserve-me"; }'));
  const { configureAndroid } = await modulePromise;
  configureAndroid(dir,'2.20.9');
  const first = fs.readFileSync(activity,'utf8');
  configureAndroid(dir,'2.20.9');
  assert.equal(fs.readFileSync(activity,'utf8'),first);
  assert.ok(first.includes('preserve-me'));
  assert.equal(first.match(/registerPlugin\(SncHttpPlugin.class\)/g).length,1);
  assert.ok(first.indexOf('registerPlugin(') < first.indexOf('super.onCreate'));
  assert.match(fs.readFileSync(path.join(dir,'android/app/build.gradle'),'utf8'),/versionCode 2020009/);
  assert.match(fs.readFileSync(path.join(dir,'android/app/src/main/AndroidManifest.xml'),'utf8'),/android:allowBackup="false"/);
});
test('iOS preparation keeps native source membership, privacy resource and versions stable', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-ios-config-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  for(const file of ['ios/App/App.xcodeproj/project.pbxproj','ios/App/Podfile','ios/App/App/Info.plist','ios/App/App/Base.lproj/Main.storyboard','native/ios']) copy(file,dir);
  const {configureIOS}=await modulePromise;
  const project=path.join(dir,'ios/App/App.xcodeproj/project.pbxproj');
  configureIOS(dir,'2.20.9');
  const first=fs.readFileSync(project,'utf8');
  configureIOS(dir,'2.20.9');
  assert.equal(fs.readFileSync(project,'utf8'),first);
  assert.match(first,/MARKETING_VERSION = 2.20.9/);
  assert.match(first,/CURRENT_PROJECT_VERSION = 2.20.9/);
  assert.match(first,/IPHONEOS_DEPLOYMENT_TARGET = 15.0/);
  assert.match(first,/PrivacyInfo.xcprivacy in Resources/);
  assert.match(first,/SncHttpPlugin.swift in Sources/);
  assert.match(fs.readFileSync(path.join(dir,'ios/App/App/Base.lproj/Main.storyboard'),'utf8'),/customClass="WickrunViewController"/);
});
