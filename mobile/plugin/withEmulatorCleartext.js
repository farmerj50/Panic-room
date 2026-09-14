const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Permits cleartext HTTP only to 10.0.2.2 — the Android emulator's alias for
// the host machine's loopback, used by EXPO_PUBLIC_API_URL when testing
// against a local dev backend (see src/config/emergencyConfig.ts). This
// address has no meaning outside an emulator (real devices never resolve
// it to anything), and the production build always talks to the hardcoded
// HTTPS Railway domain, so this carries no production risk. Without it,
// every release-variant e2e/regression run against a local backend fails
// with "CLEARTEXT communication to 10.0.2.2 not permitted by network
// security policy" — this was diagnosed the hard way once already.
const CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`;

function withEmulatorCleartextManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application[0];
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return config;
  });
}

function withEmulatorCleartextResource(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const xmlDir = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), CONFIG_XML);
      return config;
    },
  ]);
}

module.exports = function withEmulatorCleartext(config) {
  config = withEmulatorCleartextManifest(config);
  config = withEmulatorCleartextResource(config);
  return config;
};
