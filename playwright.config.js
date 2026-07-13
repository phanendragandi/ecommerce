// @ts-check
const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Load git-ignored e2e credentials (.env.e2e) without a dotenv dependency.
const envFile = path.join(__dirname, '.env.e2e');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

module.exports = defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results/artifacts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Single worker: tests share one seller account and one cart.
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['list'],
    ['json', { outputFile: 'e2e-results/results.json' }],
    ['html', { outputFolder: 'e2e-results/html', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'guest',
      testMatch: /(storefront|auth)\.spec\.js/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'seller',
      testMatch: /(cart|seller)\.spec\.js/,
      dependencies: ['setup'],
      use: { browserName: 'chromium', storageState: 'e2e/.auth/seller.json' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      cwd: './server',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
