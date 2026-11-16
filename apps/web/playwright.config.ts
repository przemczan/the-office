import { availableParallelism } from "node:os";
import { defineConfig, devices } from "@playwright/test";
import { E2E_STORAGE_STATE } from "./e2e/e2e-user.ts";

// Off OFFICE_PORT, so the tests run beside npm run dev.
const PORT = 4390;

// Half the cores, as Playwright's default, but counted by availableParallelism: Playwright counts
// os.cpus(), the host's every core even in a run environment capped at two, where that many
// Chromiums beside the service exhaust its CPU and memory and the tests time out.
const WORKERS = Math.max(1, Math.floor(availableParallelism() / 2));

/** The built web app and service, with the environment `serve-office.ts` reads besides its port. */
export function officeServer(env: Readonly<Record<string, string>> = {}) {
  return {
    // Serves the built web app and service: npm run build first (npm run verify does).
    command: "node e2e/serve-office.ts",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { ...env, OFFICE_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore" as const,
  };
}

// Every test, run by `npm run test:e2e:full` through playwright.full.config.ts.
export const fullRun = defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: "e2e-results/artifacts",
  workers: WORKERS,
  forbidOnly: !!process.env["CI"],
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    // Every request needs a signed-in device (spec §2.10): first, the run's fresh Office gets its
    // first user through the first-user page, whose signed-in device every other project starts
    // with. Playwright runs it whatever the command line picks, as a project others depend on.
    {
      name: "setup",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/sign-in.setup.ts",
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: E2E_STORAGE_STATE },
      testIgnore: ["**/queue.e2e.ts", "**/updates.e2e.ts"],
      dependencies: ["setup"],
    },
    // The queue is one for the Office and any release weighs all of it: its test runs alone, after
    // every other file.
    {
      name: "queue",
      use: { ...devices["Desktop Chrome"], storageState: E2E_STORAGE_STATE },
      testMatch: "**/queue.e2e.ts",
      dependencies: ["chromium"],
    },
    // A scheduled Office update holds every Start and each Task's next Stage: it runs alone, last.
    {
      name: "updates",
      use: { ...devices["Desktop Chrome"], storageState: E2E_STORAGE_STATE },
      testMatch: "**/updates.e2e.ts",
      dependencies: ["queue"],
    },
  ],
  webServer: officeServer(),
});

// The default run leaves out the tests tagged @full. It is set here, not as --grep-invert, which
// Playwright doesn't apply to a project others depend on (setup and chromium, before queue and
// updates).
export default defineConfig({ ...fullRun, grepInvert: /@full/ });
