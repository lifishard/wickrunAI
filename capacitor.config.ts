import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.anyai.app',
  appName: '灯芯AI',
  webDir: 'dist',
  // Native bridge debug logs can otherwise include returned API credentials.
  loggingBehavior: 'none',
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'never',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
