import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { NotificationTiming } from "@the-office/contracts";

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

// The e2e files share one database: the text is emptied at the end, as every other file's sessions
// would get it.
test("Office instructions keeps a saved text across reloads", async ({ page }) => {
  await page.goto("/settings/office-limits");
  await page.getByRole("link", { name: "Office instructions" }).click();
  await expect(page).toHaveURL(/\/settings\/office-instructions$/);
  const text = page.getByRole("textbox", { name: "Office instructions" });
  const save = page.getByRole("button", { name: "Save" });
  await expect(text).toHaveValue("");
  await expect(save).toBeDisabled();

  await text.fill("  Write in plain words.\n\nAnswer briefly.  ");
  await save.click();
  await expect(page.getByText("Office instructions saved.")).toBeVisible();
  // What the service kept: the trimmed text.
  await expect(text).toHaveValue("Write in plain words.\n\nAnswer briefly.");
  await expect(save).toBeDisabled();

  await page.reload();
  await expect(text).toHaveValue("Write in plain words.\n\nAnswer briefly.");

  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1600, 380]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${colorScheme}-${width}-settings-office-instructions.png`),
      });
    }
  }

  await text.fill("");
  await save.click();
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(text).toHaveValue("");
});

// The e2e files share one database: the caps are only raised, so no other file's Start waits, and
// every setting is given back.
test("Office limits' Usage keeps the ticked measures and the caps across reloads", async ({
  page,
}) => {
  await page.goto("/settings/office-limits");
  // The Usage card is the only one on Office limits with Save, Discard and its regions.
  const usage = page;
  const measures = usage.getByRole("group", { name: "Usage estimates in" });
  const measure = (name: string) =>
    measures.locator("label").filter({ hasText: name }).getByRole("checkbox");
  // Each engine's caps under its name; people.e2e.ts checks an API engine's.
  const claudeCode = usage.getByRole("region", { name: "Claude Code", exact: true });
  const fiveHourCap = claudeCode.getByLabel("5-hour window");
  const dailyTokens = claudeCode.getByLabel("Tokens a day");
  const save = usage.getByRole("button", { name: "Save" });

  await expect(measure("Tokens")).toHaveAttribute("aria-checked", "true");
  await expect(measure("5-hour window")).toHaveAttribute("aria-checked", "true");
  await expect(measure("Cost")).toHaveAttribute("aria-checked", "false");
  await expect(fiveHourCap).toHaveValue("90");
  await expect(claudeCode.getByLabel("7-day window")).toHaveValue("90");
  await expect(dailyTokens).toHaveValue("");
  await expect(usage.getByText("Saved", { exact: true })).toBeVisible();

  await measure("Cost").click();
  await fiveHourCap.fill("101");
  await expect(usage.getByText("Give a whole % from 1 to 100")).toBeVisible();
  await expect(save).toBeDisabled();
  await fiveHourCap.fill("100");
  await dailyTokens.fill("900,000,000");
  await save.click();
  await expect(usage.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(measure("Cost")).toHaveAttribute("aria-checked", "true");
  await expect(fiveHourCap).toHaveValue("100");
  await expect(dailyTokens).toHaveValue("900000000");

  await dailyTokens.fill("1");
  await usage.getByRole("button", { name: "Discard" }).click();
  await expect(dailyTokens).toHaveValue("900000000");

  await measure("Cost").click();
  await fiveHourCap.fill("90");
  await dailyTokens.fill("");
  await save.click();
  await expect(usage.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(measure("Cost")).toHaveAttribute("aria-checked", "false");
  await expect(fiveHourCap).toHaveValue("90");
  await expect(dailyTokens).toHaveValue("");
});

// The e2e files share one database: only "Alarm lifted with work waiting", which nothing raises
// yet, is changed, and it is given back to its group.
test("Notifications shows what goes where, a kind set or inherited, and Reset gives it back", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  const grid = page.getByRole("table");
  await expect(grid.getByRole("columnheader", { name: /Phone/ })).toContainText("Not set up yet");
  await expect(page.getByText("Never notified: Stage progress, Tasks starting")).toBeVisible();

  const cell = (channel: string, row: string) =>
    grid.getByRole("button", { name: `${channel} for ${row}`, exact: true });
  // Ticket 20's defaults: a failed Task also goes to the phone, set on its own row.
  await expect(cell("Phone", "Task failed")).toHaveAttribute("aria-pressed", "true");
  await expect(cell("Phone", "Task failed")).toHaveAttribute("title", "Set here");
  await expect(cell("Phone", "Task done")).toHaveAttribute("aria-pressed", "false");
  await expect(cell("Desktop", "Task done")).toHaveAttribute("title", "Inherited from Outcomes");
  await expect(
    grid.getByRole("row", { name: /^Task done/ }).getByRole("button", { name: "Reset" }),
  ).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-settings-notifications.png") });

  const alarmLifted = cell("Phone", "Alarm lifted with work waiting");
  const reset = grid
    .getByRole("row", { name: /^Alarm lifted with work waiting/ })
    .getByRole("button", { name: "Reset" });
  await expect(alarmLifted).toHaveAttribute("title", "Inherited from Office");
  await alarmLifted.click();
  await expect(alarmLifted).toHaveAttribute("aria-pressed", "true");
  await expect(alarmLifted).toHaveAttribute("title", "Set here");

  await page.reload();
  await expect(alarmLifted).toHaveAttribute("aria-pressed", "true");
  await reset.click();
  await expect(alarmLifted).toHaveAttribute("aria-pressed", "false");
  await expect(alarmLifted).toHaveAttribute("title", "Inherited from Office");
  await expect(reset).toHaveCount(0);

  // Setting a kind back to what its group gives drops the setting: the row inherits again.
  await cell("In-app", "Alarm lifted with work waiting").click();
  await expect(reset).toBeVisible();
  await cell("In-app", "Alarm lifted with work waiting").click();
  await expect(cell("In-app", "Alarm lifted with work waiting")).toHaveAttribute(
    "title",
    "Inherited from Office",
  );
  await expect(reset).toHaveCount(0);
});

/** "HH:MM" this many hours from the system's time. */
function hoursFromNow(hours: number): string {
  const at = new Date(Date.now() + hours * 60 * 60_000);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * Waits for the service to keep a timing that matches. The cards show a change before it is kept
 * and send the next one only after it, so a reload made sooner loses what was still waiting.
 */
function timingKept(
  page: Page,
  matches: (timing: NotificationTiming) => boolean,
): Promise<unknown> {
  return page.waitForResponse(
    async (response) =>
      response.url().endsWith("/notifications/timing") &&
      response.request().method() === "PUT" &&
      response.ok() &&
      matches((await response.json()) as NotificationTiming),
  );
}

// The e2e files share one database: quiet hours are moved at once to hours the clock is outside
// of, so no other file's Notifications are held, and every change is given back.
test("At the desk, Quiet hours and batching keep their minutes and quiet hours across reloads", async ({
  page,
}) => {
  await page.goto("/settings/notifications");
  const away = page.getByRole("spinbutton", { name: "Minutes after you leave" });
  const batching = page.getByRole("spinbutton", { name: "Minutes Outcomes collapse within" });
  const quietHours = page.getByRole("checkbox", { name: "Quiet hours" });
  await expect(
    page.getByRole("spinbutton", { name: "Minutes the phone is held after use" }),
  ).toHaveValue("5");
  await expect(away).toHaveValue("5");
  await expect(batching).toHaveValue("2");
  await expect(quietHours).not.toBeChecked();
  await expect(page.getByText("Off until you set them.")).toBeVisible();

  const [quietFrom, quietTo] = [hoursFromNow(3), hoursFromNow(4)];
  const changesKept = timingKept(
    page,
    (timing) =>
      timing.awayMinutes === 7 &&
      timing.quietHours?.from === quietFrom &&
      timing.quietHours.to === quietTo,
  );
  await away.fill("7");
  await away.press("Enter");
  await quietHours.check();
  const from = page.getByLabel("Quiet hours from");
  const to = page.getByLabel("Quiet hours to");
  await expect(from).toHaveValue("22:00");
  await expect(to).toHaveValue("07:00");
  await from.fill(quietFrom);
  await to.fill(quietTo);
  await changesKept;
  await expect(page.getByText(/one summary comes when it ends/)).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-settings-notification-timing.png"),
    fullPage: true,
  });
  // A minute out of range goes back to what is kept.
  await batching.fill("0");
  await batching.blur();
  await expect(batching).toHaveValue("2");

  await page.reload();
  await expect(away).toHaveValue("7");
  await expect(quietHours).toBeChecked();
  await expect(from).toHaveValue(quietFrom);
  await expect(to).toHaveValue(quietTo);

  const defaultsKept = timingKept(
    page,
    (timing) => timing.awayMinutes === 5 && timing.quietHours === null,
  );
  await quietHours.uncheck();
  await away.fill("5");
  await away.press("Enter");
  await expect(from).toHaveCount(0);
  await defaultsKept;
  await page.reload();
  await expect(away).toHaveValue("5");
  await expect(quietHours).not.toBeChecked();
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
  const afterConflict = page.getByLabel("After a conflict");
  await expect(afterConflict).toHaveValue("publish");
  await afterConflict.selectOption({ label: "Wait at a Gate for your review" });
  await page
    .getByLabel("Publishes")
    .selectOption({ label: "Push the branch only (proof of concept)" });
  await expect(afterConflict).toHaveCount(0);
  await page.getByRole("button", { name: "Gate", exact: true }).click();
  await expect(page.getByText("pushes the branch only")).toBeVisible();
  await page.getByRole("button", { name: "Add the Pipeline" }).click();

  await expect(page.getByText(`${name} added to the library.`)).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/pipelines\/[\da-f-]{36}$/);
  const saved = await page.request.get(`/api/pipelines/${page.url().split("/").at(-1)}`);
  expect(await saved.json()).toMatchObject({
    stages: expect.arrayContaining([expect.objectContaining({ afterConflict: "review" })]),
  });
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
