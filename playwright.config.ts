import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]],
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
      args: ['--no-sandbox'],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command:
      'npm run build && NODE_ENV=production PORT=3100 TRUST_PROXY=1 COOKIE_SECURE=false DATA_DIR=/tmp/qiyu-ddl-e2e node server/index.mjs',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.QIYU_TEST_DATABASE_URL_FILE
        ? JSON.parse(readFileSync(process.env.QIYU_TEST_DATABASE_URL_FILE, 'utf8')).url
        : '',
    },
    timeout: 90000,
  },
});
