import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试依赖真实的前后端与数据库，请先执行：
 *   pnpm db:deploy && pnpm db:seed
 * 默认使用本机已安装的 Chrome（channel: chrome）；如未安装可执行 npx playwright install chromium 后改为默认浏览器。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    channel: "chrome",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"], channel: "chrome" } },
  ],
  webServer: [
    {
      command: "pnpm --filter @nature/api dev",
      url: "http://localhost:3000/api/v1/healthz",
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: "../..",
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
