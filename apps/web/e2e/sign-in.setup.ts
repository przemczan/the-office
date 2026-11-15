import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test as setup } from "@playwright/test";
import { E2E_STORAGE_STATE, E2E_USER } from "./e2e-user.ts";
import { E2E_OFFICE_DATA } from "./office-data.ts";
import { E2E_DATABASE_URL, E2E_ENVIRONMENT } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";

// The service's host command that prints a new setup token, replacing the one before.
const SETUP_TOKEN_COMMAND = fileURLToPath(
  new URL("../../service/dist/setup-token.js", import.meta.url),
);

/**
 * A new setup token for the end-to-end Office, as `npm run setup-token` prints it on the host: the
 * built command on the end-to-end service's own database, printing only the token.
 */
function newSetupToken(): string {
  const printed = execFileSync(process.execPath, [SETUP_TOKEN_COMMAND, "--quiet"], {
    env: { ...E2E_ENVIRONMENT, DATABASE_URL: E2E_DATABASE_URL, OFFICE_DATA_DIR: E2E_OFFICE_DATA },
    encoding: "utf8",
  });
  const token = printed.trim();
  expect(token).not.toBe("");
  return token;
}

// Every other project depends on this one: the run's fresh Office has no user, so the first-user
// page creates the shared e2e user with a setup token, First-run setup's basics are walked and
// skipped, and their signed-in device is saved for every test to start signed in (`storageState`
// in playwright.config.ts).
setup(
  "creates the first user with the setup token, walks First-run setup and keeps their signed-in device",
  async ({ page }) => {
    await page.goto("/now");

    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fnow$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create the first user");
    const form = page.getByRole("form", { name: "Create the first user" });
    await expect(page.getByRole("form", { name: "Sign in with a password" })).toHaveCount(0);
    await expect(form.locator("code")).toHaveText("npm run setup-token");
    await screenshotScenario(page, "first-user-page");
    await form.getByLabel("Name").fill(E2E_USER.name);
    await form.getByLabel("Email").fill(E2E_USER.email);
    await form.getByLabel("Password").fill(E2E_USER.password);

    // A wrong token is refused before anything else, saying how to print a new one.
    await form.getByLabel("Setup token").fill("not the setup token");
    await form.getByRole("button", { name: "Create the first user" }).click();
    const refusal = form.getByRole("status").filter({ hasText: "The setup token was refused" });
    await expect(refusal).toBeVisible();
    await expect(refusal).toContainText("npm run setup-token");
    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fnow$/);
    await screenshotScenario(page, "first-user-setup-token-refused");

    await form.getByLabel("Setup token").fill(newSetupToken());
    await form.getByRole("button", { name: "Create the first user" }).click();

    // First-run setup's basics, each skipped, outside the shell.
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("First-run setup");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Engine");
    await expect(page.getByText("Step 1 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: `User menu: ${E2E_USER.name}` })).toHaveCount(0);
    await screenshotScenario(page, "first-run-setup-engine");
    await page.getByRole("button", { name: "Skip", exact: true }).click();

    await expect(page).toHaveURL(/\/setup\?step=github$/);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Sign in with GitHub");
    await expect(page.getByText("Step 2 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Register the GitHub App" })).toBeVisible();
    await screenshotScenario(page, "first-run-setup-github");
    await page.getByRole("button", { name: "Skip", exact: true }).click();

    await expect(page).toHaveURL(/\/setup\?step=telemetry$/);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Telemetry");
    await expect(page.getByText("Step 3 of 3")).toBeVisible();
    await page.getByRole("radio", { name: /^Off/ }).check();
    await screenshotScenario(page, "first-run-setup-telemetry");
    await page.getByRole("button", { name: "Finish" }).click();

    await expect(page).toHaveURL(/\/now$/);
    await expect(page.getByRole("button", { name: `User menu: ${E2E_USER.name}` })).toBeVisible();
    // Closed for good: a reload stays on Now, and /setup goes home.
    await page.reload();
    await expect(page).toHaveURL(/\/now$/);
    await expect(page.getByRole("button", { name: `User menu: ${E2E_USER.name}` })).toBeVisible();
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/now$/);
    await page.context().storageState({ path: E2E_STORAGE_STATE });
  },
);
