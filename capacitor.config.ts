import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'cooking.zap.app',
  appName: 'Zap Cooking',
  webDir: 'dist',
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
    },
    // SPIKE ONLY — Phase C.0 passkey PRF validation. Remove with the rest of the spike harness.
    CapacitorPasskey: {
      origin: 'https://zap.cooking',
      autoShim: true,
      domains: ['zap.cooking', 'www.zap.cooking']
    }
  }
};

export default config;
