import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { E2E_STORAGE_STATE } from "./e2e/e2e-user.ts";
import { fullRun, officeServer } from "./playwright.config.ts";

// The README's screenshots (`npm run readme-screenshots`, after `npm run build`): a demo Office on a
// fresh e2e service of their own, replaying their own scripted sessions. They match
// `*.screenshots.ts`, which the default and full runs never pick up.
const SESSIONS = fileURLToPath(new URL("./e2e/readme/sessions.jsonl", import.meta.url));

export default defineConfig({
  ...fullRun,
  workers: 1,
  projects: [
    {
      name: "setup",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/sign-in.setup.ts",
    },
    {
      name: "readme",
      use: { ...devices["Desktop Chrome"], storageState: E2E_STORAGE_STATE },
      testMatch: "**/*.screenshots.ts",
      dependencies: ["setup"],
    },
  ],
  webServer: officeServer({ OFFICE_E2E_ENGINE_SCRIPTS: SESSIONS }),
});
