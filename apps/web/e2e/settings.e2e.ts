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
