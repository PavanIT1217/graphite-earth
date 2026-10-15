import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.pavanit1217.graphiteearth',
  appName: 'Graphite Earth',
  webDir: 'dist',
  backgroundColor: '#f3eee3',
  plugins: {
    // Route fetch() through native HTTP so requests carry an identifying User-Agent,
    // as the Nominatim and Overpass usage policies ask.
    CapacitorHttp: { enabled: true },
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#f3eee3', showSpinner: false },
  },
  ios: { contentInset: 'never' },
};

export default config;
