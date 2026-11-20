import { expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";

/** The worktree's screenshots folder, which a Task's review reads; git ignores it. */
export const TASK_SCREENSHOTS = path.resolve(import.meta.dirname, "../../../.office/screenshots");

/**
 * The page as it is now, for a Task's review: Light and Dark at 1600, 900 and 390 wide, each
 * checked for nothing scrolling sideways, with `inView` scrolled into view at each width when
 * given; left in Light at 1600.
 */
export async function screenshotScenario(
  page: Page,
  name: string,
  { fullPage = false, inView }: { readonly fullPage?: boolean; readonly inView?: Locator } = {},
): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-palette", colorScheme);
    for (const width of [1600, 900, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (inView) await inView.scrollIntoViewIfNeeded();
      const sideways = await page
        .locator("html")
        .evaluate((html) => html.scrollWidth - html.clientWidth);
      expect(sideways).toBe(0);
      await page.screenshot({
        path: path.join(TASK_SCREENSHOTS, `${name}-${colorScheme}-${width}.png`),
        fullPage,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1600, height: 900 });
}
