#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Use the generated project's package, rather than a second hard-coded app ID.
export function installAndroidPlugins(projectRoot) {
  const gradle = fs.readFileSync(path.join(projectRoot, 'android/app/build.gradle'), 'utf8');
  const packageName = gradle.match(/applicationId\s+["']([\w.]+)["']/)?.[1];
  if (!packageName) throw new Error('Cannot find Android applicationId. Generate the project first.');
  const javaDir = path.join(projectRoot, 'android/app/src/main/java', ...packageName.split('.'));
  const activityPath = path.join(javaDir, 'MainActivity.java');
  let activity = fs.readFileSync(activityPath, 'utf8');
  for (const plugin of ['SncHttpPlugin', 'WickrunSecretsPlugin', 'WickrunAccountPlugin']) {
    const source = fs.readFileSync(path.join(projectRoot, 'native/android', `${plugin}.java`), 'utf8');
    fs.writeFileSync(path.join(javaDir, `${plugin}.java`), source.replace(/^package [\w.]+;/m, `package ${packageName};`));
  }
  if (!activity.includes('import android.os.Bundle;')) activity = activity.replace(/(package [\w.]+;)/, '$1\n\nimport android.os.Bundle;');
  if (!activity.includes('void onCreate(')) {
    activity = activity.replace(/(class MainActivity extends BridgeActivity\s*\{)/, '$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n    }\n');
  }
  if (!activity.includes('super.onCreate(savedInstanceState);')) throw new Error('Unexpected MainActivity: cannot safely register native plugins.');
  for (const plugin of ['SncHttpPlugin', 'WickrunSecretsPlugin', 'WickrunAccountPlugin']) {
    if (!activity.includes(`registerPlugin(${plugin}.class);`)) activity = activity.replace('super.onCreate(savedInstanceState);', `registerPlugin(${plugin}.class);\n        super.onCreate(savedInstanceState);`);
  }
  fs.writeFileSync(activityPath, activity);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installAndroidPlugins(root);
  console.log('Android native streaming and secure storage plugins installed.');
}
