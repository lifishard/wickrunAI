const fs = require('node:fs');

// Keep all validation errors about field names, never credential values.
function signingSettings(env = process.env, { checkKeyFile = true } = {}) {
  if (env.MACOS_SIGNING_ENABLED !== 'true') throw new Error('MACOS_SIGNING_ENABLED must be exactly true for a signed build');
  const required = ['MACOS_SIGNING_IDENTITY', 'APPLE_TEAM_ID', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing macOS signing settings: ${missing.join(', ')}`);
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error('APPLE_TEAM_ID must contain 10 uppercase letters or digits');
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_API_KEY_ID)) throw new Error('APPLE_API_KEY_ID must contain 10 uppercase letters or digits');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.APPLE_API_ISSUER)) throw new Error('APPLE_API_ISSUER must be a team API key issuer UUID');
  if (env.MACOS_SIGNING_IDENTITY.startsWith('Developer ID Application:') || !env.MACOS_SIGNING_IDENTITY.endsWith(`(${env.APPLE_TEAM_ID})`)) {
    throw new Error('MACOS_SIGNING_IDENTITY must be the certificate name without its Developer ID Application: prefix and end in (APPLE_TEAM_ID)');
  }
  if (['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_KEYCHAIN_PROFILE'].some(name => env[name]?.trim())) {
    throw new Error('Remove alternate notarization credentials; this signed build requires a team App Store Connect API key');
  }
  if (checkKeyFile) {
    try {
      if (!fs.statSync(env.APPLE_API_KEY).isFile()) throw new Error();
      fs.accessSync(env.APPLE_API_KEY, fs.constants.R_OK);
    } catch { throw new Error('APPLE_API_KEY must point to a readable private key file outside the repository'); }
  }
  return { identity: env.MACOS_SIGNING_IDENTITY, teamId: env.APPLE_TEAM_ID };
}

function signedMacConfig(base, env = process.env, options) {
  const settings = signingSettings(env, options);
  return {
    ...base,
    forceCodeSigning: true,
    mac: {
      ...base.mac,
      identity: settings.identity,
      type: 'distribution',
      hardenedRuntime: true,
      // Signing precedes notarization, so Gatekeeper is assessed on the final archives.
      gatekeeperAssess: false,
      notarize: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
    },
  };
}

module.exports = { signingSettings, signedMacConfig };
