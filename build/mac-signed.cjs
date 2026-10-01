// electron-builder 25 schema. Keep the default package.json config unsigned.
const { signedMacConfig } = require('../scripts/mac-signing.cjs');
module.exports = signedMacConfig(require('../package.json').build);
