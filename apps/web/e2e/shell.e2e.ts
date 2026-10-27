import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");
/** The UI spec; local to the workstation, so its screenshots are taken only where it is. */
const CLICK_THROUGH = path.resolve(
  import.meta.dirname,
  "../../../.scratch/the-office/prototypes/app/index.html",
);

const PALETTES = ["light", "dark"] as const;
/** Full width, two panels and one (shell.css). */
const WIDTHS = [
  { width: 1600, panels: 3 },
  { width: 1200, panels: 2 },
  { width: 700, panels: 1 },
] as const;
const SURFACES = [
  { name: "Now", path: "/now" },
  { name: "Work", path: "/work" },
  { name: "People", path: "/people" },
  { name: "Projects", path: "/projects" },
  // Settings opens at its first section.
  { name: "Settings", path: "/settings/skills" },
] as const;

for (const palette of PALETTES) {
  for (const { width, panels } of WIDTHS) {
    test.describe(`${palette}, ${width} wide`, () => {
      test.use({ colorScheme: palette, viewport: { width, height: 900 } });

      test("the rail opens each surface with its title", async ({ page }) => {
        await page.goto("/");

        await expect(page).toHaveURL(/\/now$/);
        await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
        // Connected to the service, the strip shows the Office's figures and no reconnecting note.
        const strip = page.getByRole("status", { name: "Status strip" });
        await expect(strip).toContainText("tokens today");
        await expect(strip).not.toContainText("Reconnecting");
        const rail = page.getByRole("navigation", { name: "Surfaces" });
        for (const surface of SURFACES) {
          await rail.getByRole("link", { name: surface.name, exact: true }).click();

          await expect(page).toHaveURL(new RegExp(`${surface.path}$`));
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(surface.name);
          // Off the rail, so no label covers the page.
          await page.mouse.move(width / 2, 600);
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${palette}-${width}-${surface.name.toLowerCase()}.png`),
          });
        }
      });

      test(`Now's panels fold to ${panels}`, async ({ page }) => {
        await page.goto("/now");

        const columns = await page
          .locator(".desk")
          .evaluate((desk) => getComputedStyle(desk).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(panels);
      });

      test("the click-through at the same width, for comparison", async ({ page }) => {
        test.skip(!existsSync(CLICK_THROUGH), "The click-through is not on this machine.");
        await page.goto(`${pathToFileURL(CLICK_THROUGH).href}#/now`);
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${palette}-${width}-now.click-through.png`),
        });
      });
    });
  }
}

test.describe("the palette", () => {
  test.use({ colorScheme: "light" });

  test("chosen in the rail, it is shown at once and kept over the system's", async ({ page }) => {
    await page.goto("/now");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-palette", "light");

    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Dark" }).click();

    await expect(html).toHaveAttribute("data-palette", "dark");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-palette", "dark");
  });
});
