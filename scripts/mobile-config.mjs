import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xcode from 'xcode';
import plist from 'plist';
import { installAndroidPlugins } from './install-android-plugin.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function mobileVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Mobile releases require a numeric major.minor.patch version.');
  const [major, minor, patch] = version.split('.').map(Number);
  if (major < 1 || major > 2099 || minor > 99 || patch > 99) throw new Error('Version exceeds the supported Apple build-number components.');
  return {version, androidCode: major * 1000000 + minor * 1000 + patch};
}

export function configureAndroid(projectRoot, version) {
  const {androidCode} = mobileVersion(version);
  const gradlePath = path.join(projectRoot, 'android/app/build.gradle');
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${androidCode}`).replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
  if (!gradle.includes("apply from: '../../native/android/release-signing.gradle'")) gradle += "\napply from: '../../native/android/release-signing.gradle'\n";
  fs.writeFileSync(gradlePath, gradle);
  const manifestPath = path.join(projectRoot, 'android/app/src/main/AndroidManifest.xml');
  let manifest = fs.readFileSync(manifestPath, 'utf8').replace(/android:allowBackup="[^"]+"/, 'android:allowBackup="false"');
  if (!manifest.includes('android:usesCleartextTraffic=')) manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"');
  if (!manifest.includes('android:windowSoftInputMode=')) manifest = manifest.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"');
  fs.writeFileSync(manifestPath, manifest);
  installAndroidPlugins(projectRoot);
}

export function configureIOS(projectRoot, version) {
  mobileVersion(version);
  const app = path.join(projectRoot, 'ios/App/App');
  const projectPath = path.join(projectRoot, 'ios/App/App.xcodeproj/project.pbxproj');
  const project = xcode.project(projectPath);
  project.parseSync();
  const group = project.findPBXGroupKey({path: 'App'});
  if (!group) throw new Error('Cannot find App group in the Xcode project.');
  const target = project.getFirstTarget().uuid;
  for (const file of ['SncHttpPlugin.swift', 'SncUTF8Decoder.swift', 'WickrunSecretsPlugin.swift', 'WickrunViewController.swift']) {
    fs.copyFileSync(path.join(projectRoot, 'native/ios', file), path.join(app, file));
    if (!project.hasFile(file)) project.addSourceFile(file, {target}, group);
  }
  fs.copyFileSync(path.join(projectRoot, 'native/ios/PrivacyInfo.xcprivacy'), path.join(app, 'PrivacyInfo.xcprivacy'));
  if (!project.hasFile('PrivacyInfo.xcprivacy')) {
    const file = project.addFile('PrivacyInfo.xcprivacy', group);
    file.uuid = project.generateUuid();
    file.target = target;
    project.addToPbxBuildFileSection(file);
    project.addToPbxResourcesBuildPhase(file);
  }
  project.addBuildProperty('MARKETING_VERSION', version);
  project.addBuildProperty('CURRENT_PROJECT_VERSION', version);
  project.addBuildProperty('IPHONEOS_DEPLOYMENT_TARGET', '15.0');
  // node-xcode's generic file objects include absent fields; omit those in PBX syntax.
  for (const [key, reference] of Object.entries(project.pbxFileReferenceSection())) {
    if (key.endsWith('_comment') || typeof reference !== 'object') continue;
    for (const field of Object.keys(reference)) if (reference[field] === undefined || reference[field] === 'undefined') delete reference[field];
    if (String(reference.path).replaceAll('"', '') === 'PrivacyInfo.xcprivacy') reference.lastKnownFileType = 'text.xml';
  }
  fs.writeFileSync(projectPath, project.writeSync());
  const podfilePath = path.join(projectRoot, 'ios/App/Podfile');
  fs.writeFileSync(podfilePath, fs.readFileSync(podfilePath, 'utf8').replace(/platform :ios, '[^']+'/, "platform :ios, '15.0'"));
  const storyboardPath = path.join(app, 'Base.lproj/Main.storyboard');
  const storyboard = fs.readFileSync(storyboardPath, 'utf8').replace('customClass="CAPBridgeViewController" customModule="Capacitor"', 'customClass="WickrunViewController" customModule="App"');
  if (!storyboard.includes('customClass="WickrunViewController"')) throw new Error('Missing custom native plugin registration in storyboard.');
  fs.writeFileSync(storyboardPath, storyboard);
  const infoPath = path.join(app, 'Info.plist');
  const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
  info.NSCameraUsageDescription = '选择拍摄的照片作为您发送给模型的附件。';
  info.NSMicrophoneUsageDescription = '在您选择录制视频或音频附件时使用麦克风。';
  info.NSPhotoLibraryUsageDescription = '选择您要发送给模型的图片或视频附件。';
  fs.writeFileSync(infoPath, plist.build(info) + '\n');
}

export function configureMobile(platform, projectRoot = root) {
  const {version} = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (platform === 'android') configureAndroid(projectRoot, version);
  else if (platform === 'ios') configureIOS(projectRoot, version);
  else throw new Error('Choose android or ios.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) configureMobile(process.argv[2]);
