import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cooking.zap.app',
  appName: 'Zap Cooking',
  webDir: 'build',
  server: {
    androidScheme: 'https'
  }
};

export default config;
