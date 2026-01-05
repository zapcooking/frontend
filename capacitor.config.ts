import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cooking.zap.app',
  appName: 'Zap Cooking',
  webDir: 'build',
  server: {
    androidScheme: 'https'
  },
  android: {
    backgroundColor: '#111827',
    allowMixedContent: false
  },
  ios: {
    backgroundColor: '#ffffff',
    contentInset: 'automatic'
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000
    }
  }
};

export default config;
