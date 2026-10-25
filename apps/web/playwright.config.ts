import { defineConfig, devices } from "@playwright/test";

// Off OFFICE_PORT, so the tests run beside npm run dev.
const PORT = 4390;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "e2e-results/artifacts",
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // npm run test:e2e at the root builds the web app and the service first.
    command: "node e2e/serve-office.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { OFFICE_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
  },
});
