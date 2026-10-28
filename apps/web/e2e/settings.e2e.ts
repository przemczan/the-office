import path from "node:path";
import { expect, test } from "@playwright/test";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

// The e2e files share one database: each limit is raised and put back, never lowered below its
// default, so no other file's Start is refused and no Thread starts fresh meanwhile.
test("Office limits keeps the desks and the size threshold across reloads", async ({ page }) => {
  await page.goto("/settings/office-limits");
  const desks = page.getByRole("status", { name: "running Tasks at once" });
  const threshold = page.getByRole("status", { name: "the size threshold" });
  await expect(desks).toHaveText("3");
  await expect(threshold).toHaveText("30k");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-settings-office-limits.png") });

  await page.getByRole("button", { name: "Raise running Tasks at once" }).click();
  await page.getByRole("button", { name: "Raise the size threshold" }).click();
  await expect(desks).toHaveText("4");
  await expect(threshold).toHaveText("35k");
  // The status strip's desks follow at once.
  await expect(page.getByText("/ 4", { exact: true })).toBeVisible();

  await page.reload();
  await expect(desks).toHaveText("4");
  await expect(threshold).toHaveText("35k");

  await page.getByRole("button", { name: "Lower running Tasks at once" }).click();
  await page.getByRole("button", { name: "Lower the size threshold" }).click();
  await expect(desks).toHaveText("3");
  await expect(threshold).toHaveText("30k");
});

// The e2e files share one database, and work.e2e.ts walks Full and Quick fix: this test makes
// Pipelines of its own, with Script Stages and Gates only, as nobody may fill the Developer yet.
test("the user makes a Pipeline, edits it, duplicates it and removes the copy; Onboard stays", async ({
  page,
}) => {
  const name = `Nightly ${Date.now()}`;
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/pipelines$/);
  const library = page.getByRole("navigation", { name: "Pipelines" });
  await expect(library.getByRole("link").first()).toContainText("Full");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-settings-pipelines.png") });

  await page.getByRole("button", { name: "New Pipeline" }).click();
  await expect(page.getByText("Give the Pipeline a name.")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).first().fill(name);
  await page.getByRole("button", { name: "Script Stage" }).click();
  await page
    .getByLabel("Project command")
    .selectOption({ label: "Publish (each Project's own command)" });
  await page
    .getByLabel("Publishes")
    .selectOption({ label: "Push the branch only (proof of concept)" });
  await page.getByRole("button", { name: "Gate", exact: true }).click();
  await expect(page.getByText("pushes the branch only")).toBeVisible();
  await page.getByRole("button", { name: "Add the Pipeline" }).click();

  await expect(page.getByText(`${name} added to the library.`)).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/pipelines\/[\da-f-]{36}$/);
  const item = library.getByRole("link", { name: new RegExp(`^${name}`) });
  await expect(item).toContainText("Gate → Script");
  await expect(
    page.getByText(
      "Default for no Project · 0 not started Tasks use it · 0 running Tasks keep the copy they started with",
    ),
  ).toBeVisible();

  await page.getByLabel("Description").fill("Tried out at night.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save the Pipeline" }).click();
  await expect(
    page.getByText(
      "Pipeline saved. Tasks not started yet follow it; running ones keep their copy.",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Description")).toHaveValue("Tried out at night.");

  await page.getByRole("button", { name: `Duplicate ${name}` }).click();
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue(`${name} (copy)`);
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove the Pipeline" }).click();
  await expect(page.getByText(`${name} (copy) removed from the library.`)).toBeVisible();
  await expect(library.getByRole("link", { name: new RegExp(`^${name} \\(copy\\)`) })).toHaveCount(
    0,
  );
  await expect(item).toBeVisible();

  await library.getByRole("link", { name: /^Onboard/ }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove the Pipeline" }).click();
  await expect(
    page.getByText("Onboarding uses the Onboard Pipeline, so it stays in the library."),
  ).toBeVisible();
});

test.describe("Appearance", () => {
  // A system in dark, so each choice shows as a change from what the system gives.
  test.use({ colorScheme: "dark" });

  test("switches Light, Dark and Follow the system, each kept across reloads", async ({ page }) => {
    await page.goto("/settings/appearance");
    const html = page.locator("html");
    const palette = page.getByRole("group", { name: "Palette" });
    await expect(palette.getByRole("button", { name: "Follow the system" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(html).toHaveAttribute("data-palette", "dark");

    for (const [name, shown] of [
      ["Light", "light"],
      ["Dark", "dark"],
    ] as const) {
      await palette.getByRole("button", { name }).click();
      await expect(html).toHaveAttribute("data-palette", shown);
      await page.reload();
      await expect(html).toHaveAttribute("data-palette", shown);
      await expect(palette.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${shown}-1600-settings-appearance.png`),
      });
    }

    await palette.getByRole("button", { name: "Follow the system" }).click();
    await page.reload();
    await expect(palette.getByRole("button", { name: "Follow the system" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(html).toHaveAttribute("data-palette", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-palette", "light");
  });
});
