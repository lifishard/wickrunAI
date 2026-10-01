import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { signingSettings } from './mac-signing.cjs';

// The workflow only calls this on a disposable hosted Mac. No key reaches the checkout.
if (process.platform !== 'darwin') throw new Error('macOS signing preparation requires a Mac runner');
if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required');
const directory = path.join(process.env.RUNNER_TEMP, 'wickrun-notary');
const keyFile = path.join(directory, 'AuthKey.p8');
if (process.argv.includes('--cleanup')) {
  fs.rmSync(keyFile, { force: true });
} else {
  if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required');
  const privateKey = process.env.MACOS_NOTARY_KEY_P8;
  try {
    if (!privateKey || createPrivateKey(privateKey).asymmetricKeyType !== 'ec') throw new Error();
  } catch {
    throw new Error('MACOS_NOTARY_KEY_P8 must contain the downloaded team API private key');
  }
  signingSettings({ ...process.env, APPLE_API_KEY: keyFile }, { checkKeyFile: false });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(keyFile, privateKey, { mode: 0o600, flag: 'wx' });
  fs.appendFileSync(process.env.GITHUB_ENV, `APPLE_API_KEY=${keyFile}\n`);
  console.log('macOS signing prerequisites present; private key staged outside the checkout.');
}
