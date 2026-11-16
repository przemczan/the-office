import { expect, test } from "@playwright/test";
import { screenshotScenario } from "./task-screenshots.ts";

// Other files hire in parallel on the shared Office, so this asserts only on the Caretaker, Sam,
// who is there from the start.
const CARETAKER = "Sam";
const STATE_WORDS = /Idle|Just joined|Asleep at their desk|Working on|Waiting on you|Asking/;

test.describe("the Live view", () => {
  // A zone with no place keeps noon's light, so the Caretaker is on the floor whatever the
  // runner's clock says (on a workstation in Warsaw at night they would have gone home).
  test.use({
    colorScheme: "light",
    viewport: { width: 1600, height: 900 },
    timezoneId: "Etc/UTC",
  });

  test("opens from the rail with everyone on the floor, their states in words and their work a click away", async ({
    page,
  }) => {
    // Twelve screenshots twice over of a canvas that redraws every frame take most of the default
    // 30 s when the other files' workers load the machine.
    test.setTimeout(60_000);
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

const WARSAW = "Europe/Warsaw";

/** How far Warsaw is ahead of UTC at an instant, in minutes. */
function warsawOffsetMinutes(at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: WARSAW,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((each) => each.type === type)?.value);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/** Tomorrow in Warsaw at a minute after its midnight, as an instant: always after today's hires. */
function tomorrowInWarsaw(minutes: number): Date {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: WARSAW })
    .format(new Date())
    .split("-")
    .map(Number);
  const wallClock = Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1, 0, minutes);
  return new Date(wallClock - warsawOffsetMinutes(wallClock) * 60_000);
}

/** "07:02" as minutes after midnight. */
function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

test.describe("the Live view at night", { tag: "@full" }, () => {
  // The browser is in Warsaw, so its hours are worked out there; under reduced motion nobody walks.
  test.use({
    colorScheme: "light",
    viewport: { width: 1600, height: 900 },
    timezoneId: WARSAW,
    reducedMotion: "reduce",
  });

  test("follows Warsaw's day and night: idle people have gone home at night, and dusk and dawn light the floor", async ({
    page,
  }) => {
    // Three reloads and twelve screenshots for each of night, dusk and dawn.
    test.setTimeout(90_000);
    const floor = page.getByRole("img", { name: /\d+ (person|people): / });
    const chipOf = (phase: string) => page.getByRole("img", { name: new RegExp(`^${phase}, `) });

    // At 23:30 it is always night in Warsaw: the Caretaker, idle, has gone home.
    await page.clock.setFixedTime(tomorrowInWarsaw(23 * 60 + 30));
    await page.goto("/live-view");
    await expect(chipOf("Night")).toHaveAccessibleName("Night, 23:30");
    await expect(floor).toHaveAccessibleName(/gone home\. Night, 23:30\.$/);
    await page.getByRole("button", { name: "List" }).click();
    const goneHome = page
      .getByRole("complementary", { name: "People" })
      .getByRole("region", { name: "Gone home" });
    const atHome = page.getByRole("button", {
      name: `${CARETAKER} has gone home, so isn't on the floor`,
    });
    const caretaker = goneHome.getByRole("listitem").filter({ has: atHome });
    await expect(caretaker).toContainText("Gone home for the night: idle");
    await expect(atHome).toBeDisabled();
    await page.getByRole("button", { name: "Close the list" }).click();
    await screenshotScenario(page, "live-view-night");

    // At 13:00 the chip says when the sun rises and sets.
    await page.clock.setFixedTime(tomorrowInWarsaw(13 * 60));
    await page.reload();
    const day = chipOf("Day");
    await expect(day).toHaveAccessibleName("Day, 13:00");
    await expect(day).toHaveAccessibleDescription(
      /^Sunrise \d\d:\d\d, sunset \d\d:\d\d in Europe\/Warsaw, worked out from this browser's time zone\. At night idle people have gone home\.$/,
    );
    const description = await day.evaluate(
      (chip) => document.getElementById(chip.getAttribute("aria-describedby") ?? "")?.textContent,
    );
    const [, sunrise = "", sunset = ""] =
      /Sunrise (\d\d:\d\d), sunset (\d\d:\d\d)/.exec(description ?? "") ?? [];

    await page.clock.setFixedTime(tomorrowInWarsaw(minutesOf(sunset) - 15));
    await page.reload();
    await expect(chipOf("Dusk")).toBeVisible();
    await expect(floor).toHaveAccessibleName(/\. Dusk, \d\d:\d\d\.$/);
    await screenshotScenario(page, "live-view-dusk");

    await page.clock.setFixedTime(tomorrowInWarsaw(minutesOf(sunrise) + 15));
    await page.reload();
    await expect(chipOf("Dawn")).toBeVisible();
    await expect(floor).toHaveAccessibleName(/\. Dawn, \d\d:\d\d\.$/);
    await screenshotScenario(page, "live-view-dawn");
  });
});
