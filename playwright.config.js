// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  fullyParallel: true,
  retries: 1,
  reporter: [['html'], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8788',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
}); 
