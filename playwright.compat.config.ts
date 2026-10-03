import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch:
    /(?:ui-compat|audio-lifecycle|audio-music|vfx|weather-surfaces|weather-render|motoneta)\.spec\.ts/,
  outputDir: 'test-results/compat',
  use: { ...base.use, launchOptions: {} },
  projects: [
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
      },
    },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
