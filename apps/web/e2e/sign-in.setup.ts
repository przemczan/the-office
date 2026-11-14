import { expect, test as setup } from "@playwright/test";
import { E2E_STORAGE_STATE, E2E_USER } from "./e2e-user.ts";
import { screenshotScenario } from "./task-screenshots.ts";

// Every other project depends on this one: the run's fresh Office has no user, so the first-user
// page creates the shared e2e user, and their signed-in device is saved for every test to start
// signed in (`storageState` in playwright.config.ts).
setup(
  "creates the first user on the first-user page and keeps their signed-in device",
  async ({ page }) => {
    await page.goto("/now");

    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fnow$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create the first user");
    const form = page.getByRole("form", { name: "Create the first user" });
    await expect(page.getByRole("form", { name: "Sign in with a password" })).toHaveCount(0);
    await screenshotScenario(page, "first-user-page");
    await form.getByLabel("Name").fill(E2E_USER.name);
    await form.getByLabel("Email").fill(E2E_USER.email);
    await form.getByLabel("Password").fill(E2E_USER.password);
    await form.getByRole("button", { name: "Create the first user" }).click();

    await expect(page).toHaveURL(/\/now$/);
    await expect(page.getByRole("button", { name: `User menu: ${E2E_USER.name}` })).toBeVisible();
    await page.context().storageState({ path: E2E_STORAGE_STATE });
  },
);
