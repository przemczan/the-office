import { expect, test } from "@playwright/test";
import { screenshotScenario } from "./task-screenshots.ts";

// Other files hire in parallel on the shared Office, so this asserts only on the Caretaker, Sam,
// who is there from the start.
const CARETAKER = "Sam";
const STATE_WORDS = /Idle|Just joined|Asleep at their desk|Working on|Waiting on you|Asking/;

test.describe("the Live view", () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("opens from the rail with everyone on the floor, their states in words and their work a click away", async ({
    page,
  }) => {
    await page.goto("/now");
    await page
      .getByRole("navigation", { name: "Surfaces" })
      .getByRole("link", { name: "Live view", exact: true })
      .click();

    await expect(page).toHaveURL(/\/live-view$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Live view");
    // The floor is drawn (the zoom shows once the stage has started) and its label sums up everyone.
    const floor = page.getByRole("img", { name: /\d+ (person|people): / });
    await expect(floor).toBeVisible();
    await expect(page.getByRole("group", { name: "Zoom" })).toBeVisible();
    await expect(page.getByText("The floor can't be drawn in this browser.")).toHaveCount(0);

    // Hovering the Caretaker's nameplate says what they're doing and what a click does.
    const nameplate = page.getByRole("button", { name: CARETAKER, exact: true });
    await nameplate.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText(CARETAKER);
    await expect(tooltip).toContainText(STATE_WORDS);
    await expect(tooltip).toContainText(/Click to/);
    await screenshotScenario(page, "live-view");

    // A click opens their work, or a popover of it when there is more than one piece.
    const choosing = (await tooltip.textContent())?.includes("Click to choose which work");
    await nameplate.click();
    if (choosing) {
      const popover = page.getByRole("dialog", { name: CARETAKER });
      await expect(popover).toContainText(STATE_WORDS);
      await expect(popover.getByRole("link").first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0);
    } else {
      await expect(page).not.toHaveURL(/\/live-view$/);
      await page.goBack();
    }

    // The List holds every person with their state in words.
    await page.getByRole("button", { name: "List" }).click();
    const list = page.getByRole("complementary", { name: "People" });
    const showOnFloor = page.getByRole("button", { name: `Show ${CARETAKER} on the floor` });
    const row = list.getByRole("listitem").filter({ has: showOnFloor });
    await expect(row).toContainText(STATE_WORDS);
    await row.getByRole("button", { name: `Show ${CARETAKER} on the floor` }).click();
    await screenshotScenario(page, "live-view-list");
  });
});
