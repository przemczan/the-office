import { expect, test } from "@playwright/test";
import { screenshotScenario } from "./task-screenshots.ts";

// The e2e Office's own engine, there from the start: a Claude Code engine, so it has Usage
// windows. Other files may add engines meanwhile, so this asserts only on it.
const OWN_ENGINE = "Claude Code";

test.describe("the Stats", () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("opens from the rail with the basic stats, and its message leads to Settings › Telemetry", async ({
    page,
  }) => {
    // Twenty-four screenshots of a page that other files' workers slow down.
    test.setTimeout(90_000);
    await page.goto("/now");
    await page
      .getByRole("navigation", { name: "Surfaces" })
      .getByRole("link", { name: "Stats", exact: true })
      .click();

    await expect(page).toHaveURL(/\/stats$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stats");
    await expect(page.getByRole("heading", { level: 2, name: "Stats" })).toBeVisible();

    // The database is shared with every other file, so no count is asserted.
    const tokensPerDay = page.getByRole("region", { name: "Tokens per day", exact: true });
    const usageWindows = page.getByRole("region", { name: "Usage windows now", exact: true });
    const topTasks = page.getByRole("region", {
      name: "The Tasks with the most tokens this week",
      exact: true,
    });
    const thisWeek = page.getByRole("region", { name: "This week", exact: true });
    for (const block of [tokensPerDay, usageWindows, topTasks, thisWeek]) {
      await expect(block).toBeVisible();
    }
    await expect(tokensPerDay.getByText("Office-wide", { exact: true })).toBeVisible();
    await expect(usageWindows.getByText("Office-wide", { exact: true })).toBeVisible();

    // The chart, and the same days as a table.
    await expect(tokensPerDay.getByRole("img")).toBeVisible();
    await tokensPerDay.getByRole("button", { name: "Show as a table" }).click();
    await expect(tokensPerDay.getByRole("table")).toBeVisible();
    await tokensPerDay.getByRole("button", { name: "Show as a chart" }).click();
    await expect(tokensPerDay.getByRole("img")).toBeVisible();

    // The Office's own engine has Usage windows: its meters, or "Not read yet" until read.
    await expect(usageWindows.getByText(OWN_ENGINE, { exact: true })).toBeVisible();
    await expect(usageWindows).not.toContainText("None of your engines has Usage windows.");
    const ownEngine = usageWindows
      .locator(".stats-engine")
      .filter({ has: page.getByText(OWN_ENGINE, { exact: true }) });
    await expect(
      ownEngine
        .getByRole("meter", { name: "5-hour window" })
        .or(ownEngine.getByText("Not read yet", { exact: true })),
    ).toBeVisible();

    await expect(thisWeek.getByText("Tasks done", { exact: true })).toBeVisible();
    await expect(thisWeek.getByText("Stage retries", { exact: true })).toBeVisible();
    await expect(thisWeek).toContainText(/since Mon \d{1,2} [A-Z][a-z]{2}/);

    // Telemetry is Off in the e2e Office (First-run setup chose it), so the message shows.
    const message = page.getByRole("region", { name: "The full stats", exact: true });
    await expect(message).toBeVisible();
    // The page scrolls inside the shell, so its top and its foot are taken apart.
    await screenshotScenario(page, "stats");
    await screenshotScenario(page, "stats-foot", { inView: message });

    await message.getByRole("link", { name: "Settings › Telemetry" }).click();
    await expect(page).toHaveURL(/\/settings\/telemetry$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
  });
});
