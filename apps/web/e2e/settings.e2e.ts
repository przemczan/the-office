import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  pipelineSchema,
  projectPipelineSchema,
  projectSchema,
  stageTemplateListSchema,
  stageTemplateSchema,
  taskSchema,
  taskStagesSchema,
  type EngineSettings,
  type NewProject,
  type NotificationTiming,
  type Pipeline,
  type Project,
  type ProjectPipeline,
  type Stage,
  type StageTemplate,
} from "@the-office/contracts";
import { asOwnUser } from "./own-user.ts";
import { addedBasePipeline, addedProjectPipeline } from "./project-pipelines.ts";
import { createTemporaryRepository } from "./temporary-repository.ts";
import { screenshotScenario, TASK_SCREENSHOTS } from "./task-screenshots.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

/** A Task's screenshots for its review, kept by The Office across runs (git ignores it). */
test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

// The e2e files share one database: each limit is raised and put back, never lowered below its
// default, so no other file's Start is refused and no Thread starts fresh meanwhile.
test("Office limits keeps the desks, the size threshold and the Archive period across reloads", async ({
  page,
}) => {
  await page.goto("/settings/office-limits");
  const desks = page.getByRole("status", { name: "running Tasks at once" });
  const threshold = page.getByRole("status", { name: "the size threshold" });
  const archivePeriod = page.getByRole("status", { name: "the Archive period" });
  await expect(desks).toHaveText("3");
  await expect(threshold).toHaveText("30k");
  await expect(archivePeriod).toHaveText("30 days");
  await expect(
    page.getByText(
      "Done and Dropped Tasks finished longer ago than this are archived at the next daily run, including those already finished.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-settings-office-limits.png") });
  await archivePeriod.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-settings-office-limits-archive.png"),
  });

  await page.getByRole("button", { name: "Raise running Tasks at once" }).click();
  await page.getByRole("button", { name: "Raise the size threshold" }).click();
  await page.getByRole("button", { name: "Raise the Archive period" }).click();
  await expect(desks).toHaveText("4");
  await expect(threshold).toHaveText("35k");
  await expect(archivePeriod).toHaveText("31 days");
  // The status strip's desks follow at once.
  await expect(page.getByText("/ 4", { exact: true })).toBeVisible();

  await page.reload();
  await expect(desks).toHaveText("4");
  await expect(threshold).toHaveText("35k");
  await expect(archivePeriod).toHaveText("31 days");

  await page.getByRole("button", { name: "Lower running Tasks at once" }).click();
  await page.getByRole("button", { name: "Lower the size threshold" }).click();
  await page.getByRole("button", { name: "Lower the Archive period" }).click();
  await expect(desks).toHaveText("3");
  await expect(threshold).toHaveText("30k");
  await expect(archivePeriod).toHaveText("30 days");
});

// The e2e files share one database: each limit is raised and put back, never lowered below its
// default, so no other file's checks wait for a run environment meanwhile.
test(
  "Office limits keeps the run environments' limits across reloads",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/settings/office-limits");
    const card = page.locator("section:not(:has(section))", {
      hasText: "CPUs per run environment",
    });
    const atOnce = card.getByRole("status", { name: "run environments at once" });
    const memory = card.getByRole("status", { name: "the memory per service" });
    const processes = card.getByRole("status", { name: "the processes per service" });
    // Running Tasks at once is 3 by default, above the 2 run environments at once.
    const fewerNote = card.getByText(
      "Running Tasks past 2 wait on their checks: they show “Waiting for a run environment” until one stops.",
    );
    await expect(atOnce).toHaveText("2");
    await expect(memory).toHaveText("4 GB");
    await expect(processes).toHaveText("1024");
    await expect(fewerNote).toBeVisible();

    await card.getByRole("button", { name: "Raise run environments at once" }).click();
    await card.getByRole("button", { name: "Raise the memory per service" }).click();
    await card.getByRole("button", { name: "Raise the processes per service" }).click();
    await expect(atOnce).toHaveText("3");
    await expect(memory).toHaveText("4.5 GB");
    await expect(processes).toHaveText("1280");
    await expect(card.getByText(/^Running Tasks past/)).toBeHidden();

    await page.reload();
    await expect(atOnce).toHaveText("3");
    await expect(memory).toHaveText("4.5 GB");
    await expect(processes).toHaveText("1280");

    await card.getByRole("button", { name: "Lower run environments at once" }).click();
    await card.getByRole("button", { name: "Lower the memory per service" }).click();
    await card.getByRole("button", { name: "Lower the processes per service" }).click();
    await expect(atOnce).toHaveText("2");
    await expect(memory).toHaveText("4 GB");
    await expect(processes).toHaveText("1024");
    await expect(fewerNote).toBeVisible();
  },
);

// The e2e files share one database: the CPU limit goes back to Automatic at the end. The cores are
// the e2e machine's, so the numbers are matched by their shape.
test(
  "Office limits keeps the run environments' CPU limit across reloads",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/settings/office-limits");
    const card = page.locator("section:not(:has(section))", {
      hasText: "CPUs per run environment",
    });
    const automatic = card.getByRole("tab", { name: "Automatic" });
    const fixed = card.getByRole("tab", { name: "Fixed" });
    const fixedCpus = card.getByRole("status", { name: "the CPUs per service" });
    await expect(automatic).toHaveAttribute("aria-selected", "true");
    await expect(
      card.getByText(/^Automatic follows this computer's cores: the checks get \d+ of its \d+,/),
    ).toBeVisible();
    await expect(
      card.getByText("A change applies from each run environment's next start; running ones keep"),
    ).toBeVisible();
    await expect(fixedCpus).toBeHidden();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-settings-office-limits-run-environments.png"),
    });

    await fixed.click();
    await expect(fixed).toHaveAttribute("aria-selected", "true");
    await expect(fixedCpus).toHaveText(/^\d+ CPUs?$/);
    const savedCpus = await fixedCpus.textContent();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-settings-office-limits-run-environments-fixed.png"),
    });

    await page.reload();
    await expect(fixed).toHaveAttribute("aria-selected", "true");
    await expect(fixedCpus).toHaveText(savedCpus ?? "");

    await automatic.click();
    await expect(automatic).toHaveAttribute("aria-selected", "true");
    await expect(fixedCpus).toBeHidden();
    await page.reload();
    await expect(automatic).toHaveAttribute("aria-selected", "true");
  },
);

// The e2e files share one database: the text is emptied at the end, as every other file's sessions
// would get it.
test(
  "Office instructions keeps a saved text across reloads",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

// The e2e files share one database and every Resolve Stage would get the saved text, so the
// template is reset to its default at the end, through the API too when the test fails.
test(
  "a Prompt template refuses an unknown variable, keeps a fixed text across reloads and resets to default",
  { tag: "@full" },
  async ({ page }) => {
    try {
      await page.goto("/settings/office-limits");
      await page.getByRole("link", { name: "Prompt templates" }).click();
      await expect(page).toHaveURL(/\/settings\/prompt-templates/);
      await page.getByRole("tab", { name: /^Pipelines/ }).click();
      const templates = page.getByRole("navigation", { name: "Pipelines Prompt templates" });
      await templates.getByRole("link", { name: /^Resolve's Brief/ }).click();
      await expect(page).toHaveURL(
        /\/settings\/prompt-templates\?(?=.*domain=pipelines)(?=.*template=pipelines\.resolve-brief)/,
      );
      const card = page.locator(".library-detail");
      const text = card.getByRole("textbox", { name: "Resolve's Brief text" });
      const save = card.getByRole("button", { name: "Save" });
      await expect(card.getByText("Default", { exact: true })).toBeVisible();
      await expect(text).toHaveValue(/^The Task's branch conflicts with \{\{baseBranch\}\}/);
      const defaultText = await text.inputValue();

      await text.fill(`${defaultText}\n{{unknown}}`);
      await save.click();
      // The refusal's Alert is a status, as the danger tone's is.
      const refusal = card
        .getByRole("status")
        .filter({ hasText: "The Prompt template wasn't saved" });
      await expect(refusal).toBeVisible();
      await expect(
        refusal.getByRole("listitem").filter({
          hasText: /^Line \d+, column \d+: \{\{unknown\}\} isn't a variable of this template\./,
        }),
      ).toBeVisible();
      await expect(text).toHaveValue(`${defaultText}\n{{unknown}}`);

      const fixedText = `${defaultText}\nKeep the Task's own changes where both sides touched a line.`;
      await text.fill(fixedText);
      await save.click();
      await expect(card.getByText("Customised", { exact: true })).toBeVisible();
      await expect(refusal).toHaveCount(0);
      await expect(text).toHaveValue(fixedText);
      await page.reload();
      await expect(card.getByText("Customised", { exact: true })).toBeVisible();
      await expect(text).toHaveValue(fixedText);

      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const width of [1600, 380]) {
          await page.setViewportSize({ width, height: 900 });
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${colorScheme}-${width}-settings-prompt-templates.png`),
          });
        }
      }
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1600, height: 900 });

      await card.getByRole("button", { name: "Reset to default" }).click();
      const dialog = page.getByRole("dialog", { name: "Reset Resolve's Brief to default?" });
      await dialog.getByRole("button", { name: "Reset to default" }).click();
      await expect(dialog).toBeHidden();
      await expect(card.getByText("Default", { exact: true })).toBeVisible();
      await expect(text).toHaveValue(defaultText);
    } finally {
      const reset = await page.request.delete(
        "/api/settings/prompt-templates/pipelines.resolve-brief",
      );
      expect(reset.ok()).toBe(true);
    }
  },
);

// The e2e files share one database: the caps are only raised, so no other file's Start waits, and
// every setting is given back.
test(
  "Office limits' Usage keeps the ticked measures and the caps across reloads",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

// The e2e files share one database: only "Alarm lifted with work waiting", which nothing raises
// yet, is changed, and it is given back to its group.
test(
  "Notifications shows what goes where, a kind set or inherited, and Reset gives it back",
  { tag: "@full" },
  async ({ page }) => {
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
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-settings-notifications.png"),
    });

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
  },
);

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
test(
  "At the desk, Quiet hours and batching keep their minutes and quiet hours across reloads",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

// The e2e files share one database, and work.e2e.ts walks Full and Quick fix: this test makes
// Pipelines of its own, with Script Stages and Gates only, as nobody may fill the Developer yet.
test("the user makes a Pipeline, edits it, duplicates it and removes the copy; Onboard stays", async ({
  page,
}) => {
  // It draws a whole Pipeline, screenshots it in each look and reloads three times: under the full
  // run's load that alone reaches the default 30s.
  test.setTimeout(60_000);
  const name = `Nightly ${Date.now()}`;
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/pipelines$/);
  // Project Pipelines are listed on their Project's page, not here.
  const library = page.getByRole("navigation", { name: "Office-wide Pipelines" });
  const full = library.getByRole("link").first();
  await expect(full).toContainText("Full");
  // A row is still a link to its Pipeline's address.
  await expect(full).toHaveAttribute("href", /\/settings\/pipelines\/[^/]+$/);
  await screenshotEachLook(page, library, "settings-pipelines");

  await page.getByRole("button", { name: "New Pipeline" }).click();
  await expect(page.getByText("Give the Pipeline a name.")).toBeVisible();
  await page.getByLabel("Name", { exact: true }).first().fill(name);
  const flow = page.getByRole("region", { name: "Flow" });
  const add = page.getByRole("button", { name: "Add the Pipeline" });
  const held = page.getByText("1 problem holds Save");

  // Added from the keyboard, a Stage is picked and unconnected: its missing route out holds Save.
  await page.getByRole("button", { name: "Add a Stage" }).press("Enter");
  await page.getByRole("menu").getByRole("button", { name: "Script Stage" }).press("Enter");
  const script = page.getByRole("region", { name: "Script", exact: true });
  await script.getByLabel("Project command").selectOption({ label: "Publish" });
  const afterConflict = script.getByLabel("After a conflict");
  await expect(afterConflict).toHaveValue("publish");
  await afterConflict.selectOption({ label: "Wait at a Gate for your review" });
  await script
    .getByLabel("Publishes")
    .selectOption({ label: "Push the branch only (proof of concept)" });
  await expect(afterConflict).toHaveCount(0);
  await expect(held).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(page.getByText("give it a route out").first()).toBeVisible();
  await script.getByRole("button", { name: "Add a route" }).click();
  await expect(page.getByRole("region", { name: "Route" })).toContainText(
    "Route from Script to End",
  );
  await expect(held).toHaveCount(0);

  // A Gate added beside Script, then moved before it by the keyboard on the canvas.
  await flow.getByRole("button", { name: "Script", exact: true }).click();
  await page.getByRole("button", { name: "Add a Stage" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Gate", exact: true }).click();
  const gate = page.getByRole("region", { name: "Gate", exact: true });
  await expect(gate).toContainText("2 of 2 in the Pipeline's order");
  await flow.getByRole("button", { name: "Gate", exact: true }).press("Shift+ArrowLeft");
  await expect(gate).toContainText("1 of 2 in the Pipeline's order");
  await expect(flow.getByRole("button", { name: "Gate", exact: true })).toBeFocused();

  // Gate's routes: one to Script, then one to End drawn before it, with a condition.
  await gate.getByRole("button", { name: "Add a route" }).click();
  await expect(held).toHaveCount(0);
  await flow.getByRole("button", { name: "Gate", exact: true }).click();
  await gate.getByRole("button", { name: "Add a route" }).click();
  const route = page.getByRole("region", { name: "Route" });
  await expect(route).toContainText("Route from Gate to End");
  await expect(route.getByRole("radio", { name: /When these hold/ })).toBeChecked();
  // With no test yet, its condition holds Save until one is added.
  await expect(held).toBeVisible();
  await expect(route).toContainText("has a group with no test yet");
  await route.getByRole("button", { name: "Add a test" }).click();
  await expect(held).toHaveCount(0);
  await route.getByLabel("Test", { exact: true }).selectOption({ label: "was Skipped" });
  await expect(route).toContainText("Followed when Gate was Skipped.");
  await screenshotScenario(page, "settings-pipeline-flow", { inView: flow });
  await screenshotScenario(page, "settings-pipeline-flow-condition", {
    inView: route.getByRole("group", { name: "Condition", exact: true }).last(),
  });

  // Weighed after the route with no condition, it is never followed: that holds Save, until moved back.
  await flow.getByRole("button", { name: "Gate", exact: true }).click();
  await gate.getByRole("button", { name: "Move the route to End down" }).click();
  await expect(held).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(
    page.getByText("comes after one with no condition, so it is never followed").first(),
  ).toBeVisible();
  await gate.getByRole("button", { name: "Move the route to End up" }).click();
  await expect(held).toHaveCount(0);
  await add.click();

  await expect(page.getByText(`${name} added to the library.`)).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/pipelines\/[\da-f-]{36}$/);
  const saved = await page.request.get(`/api/pipelines/${page.url().split("/").at(-1)}`);
  expect(await saved.json()).toMatchObject({
    stages: expect.arrayContaining([
      expect.objectContaining({
        kind: "gate",
        routes: [
          {
            to: null,
            condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "skipped" }] },
          },
          { to: "script", condition: null },
        ],
      }),
      expect.objectContaining({
        kind: "script",
        afterConflict: "review",
        routes: [{ to: null, condition: null }],
      }),
    ]),
  });
  const item = library.getByRole("link", { name: new RegExp(`^${name}`) });
  await expect(item).toContainText("Gate → Script");
  await page.reload();
  await expect(flow.getByRole("button", { name: "Route from Gate to End" })).toBeVisible();
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
  // The toast comes before the list refreshes and the form leaves the copy's address: a click
  // on another Pipeline before then would be undone by that navigation.
  await expect(page).toHaveURL(/\/settings\/pipelines$/);
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

// Script Stages and Gates only, as nobody may fill a Role in this file (see the Pipeline test above).
test(
  "the user makes a Stage template from scratch, edits it and removes it in Settings › Pipelines",
  { tag: "@full" },
  async ({ page }) => {
    const name = `Lint first ${Date.now()}`;
    await page.goto("/settings/pipelines");
    // The Stage templates are their own tab.
    await page.getByRole("tab", { name: /^Stage templates/ }).click();
    await expect(page).toHaveURL(/\/settings\/pipelines\/stage-templates$/);
    const templates = page.getByRole("navigation", { name: "Stage templates" });
    // The built-in Stages are templates from the start.
    await expect(templates.getByRole("link", { name: /^Implement/ })).toBeVisible();

    await page.getByRole("button", { name: "New template" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Script Stage" }).click();
    await expect(page.getByText("Not in the Stage templates yet")).toBeVisible();
    // A template has no loop target to go back to.
    await expect(page.getByLabel("On failure")).toHaveCount(0);
    const nameField = page.getByLabel("Name", { exact: true });
    // Problems from the service's check hold Save.
    await nameField.fill("Implement");
    await expect(page.getByText('Another Stage template is named "Implement".')).toBeVisible();
    await expect(page.getByRole("button", { name: "Add the template" })).toBeDisabled();
    await nameField.fill(name);
    // Each Project runs its own command by the key. This file adds no Project, so none is suggested:
    // a key is typed in, refused until it follows the key rules.
    await page.getByLabel("Project command").selectOption({ label: "Another key…" });
    await page.getByLabel("Command key").fill("Install");
    await expect(page.getByText('"Install" isn\'t a command key')).toBeVisible();
    await page.locator(".settings-split").screenshot({
      path: path.join(SCREENSHOTS, "light-1600-settings-stage-template-another-key.png"),
    });
    await page.getByLabel("Command key").fill("lint");
    await page.getByRole("button", { name: "Add the template" }).click();

    await expect(page.getByText(`${name} added to the Stage templates.`)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/pipelines\/stage-templates\/[\da-f-]{36}$/);
    const item = templates.getByRole("link", { name: new RegExp(`^${name}`) });
    await expect(item).toContainText("lint");
    await expect(item).toHaveAttribute("aria-current", "page");
    await screenshotEachLook(page, templates, "settings-stage-template");

    // The key the Stage names stays listed, though no Project has it.
    await expect(page.getByLabel("Project command")).toHaveValue("lint");
    await page.getByLabel("Project command").selectOption({ label: "Another key…" });
    await page.getByLabel("Command key").fill("build");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save the template" }).click();
    await expect(
      page.getByText("Stage template saved. Pipelines and Tasks that added it keep their copy."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Project command")).toHaveValue("build");
    await expect(item).toContainText("build");

    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(
      page.getByText("Pipelines and Tasks that added it keep their copy."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Remove the template" }).click();
    await expect(page.getByText(`${name} removed from the Stage templates.`)).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/pipelines$/);
    await expect(item).toHaveCount(0);
  },
);

test(
  "Save as template on a library Pipeline's Stage lists it among the Stage templates",
  { tag: "@full" },
  async ({ page }) => {
    const stageName = `Smoke test ${Date.now()}`;
    const pipeline = await addedPipeline(page, `Smoke ${Date.now()}`, [
      {
        kind: "script",
        key: "tests",
        name: "Tests",
        optional: false,
        command: "test",
      },
      {
        kind: "script",
        key: "smoke",
        name: stageName,
        optional: true,
        command: "build",
        onFailure: { goBackTo: "tests", rounds: 2 },
      },
    ]);
    await page.goto(`/settings/pipelines/${pipeline.id}`);
    // The Stage is picked first, as coming back from the Stage templates tab picks none.
    const saveAsTemplate = async (): Promise<void> => {
      await page
        .getByRole("region", { name: "Flow" })
        .getByRole("button", { name: stageName, exact: true })
        .click();
      await page.getByRole("button", { name: `More for ${stageName}` }).click();
      await page
        .getByRole("menu")
        .getByRole("button", { name: `Save ${stageName} as a template` })
        .click();
    };
    await saveAsTemplate();
    await expect(page.getByText(`${stageName} saved as a Stage template.`)).toBeVisible();
    await page.getByRole("tab", { name: /^Stage templates/ }).click();
    const templates = page.getByRole("navigation", { name: "Stage templates" });
    await expect(templates.getByRole("link", { name: new RegExp(stageName) })).toBeVisible();
    await page.goto(`/settings/pipelines/${pipeline.id}`);
    const saved = (await stageTemplates(page)).find(({ stage }) => stage.name === stageName);
    // Kept without its failure rule, which names a Stage of the Pipeline.
    expect(saved?.stage).toEqual({
      kind: "script",
      key: "smoke",
      name: stageName,
      optional: true,
      command: "build",
    });

    // Saved again, the name is taken: the service's reason shows.
    await saveAsTemplate();
    await expect(page.getByText(`${stageName} wasn't saved as a Stage template`)).toBeVisible();
    await expect(page.getByText(`Another Stage template is named "${stageName}".`)).toBeVisible();
    await removeStageTemplate(page, saved);
  },
);

test(
  "a Stage added from a template is a copy: it saves in a library Pipeline and in Edit for this Task, and editing the template leaves it as it was",
  { tag: "@full" },
  async ({ page }) => {
    const stamp = Date.now();
    const templateName = `Publish preview ${stamp}`;
    const added = await page.request.post("/api/stage-templates", {
      data: {
        stage: {
          kind: "script",
          key: "publish-preview",
          name: templateName,
          optional: true,
          command: "publish",
          publishTarget: "branch-only",
        },
      },
    });
    const template = stageTemplateSchema.parse(await added.json());
    const pipeline = await addedPipeline(page, `Preview ${Date.now()}`, [
      { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" },
    ]);
    const copied = {
      kind: "script",
      name: templateName,
      optional: true,
      command: "publish",
      publishTarget: "branch-only",
    };

    // In a library Pipeline.
    await page.goto(`/settings/pipelines/${pipeline.id}`);
    const flow = page.getByRole("region", { name: "Flow" });
    await flow.getByRole("button", { name: "Tests", exact: true }).click();
    await page.getByRole("button", { name: "Add a Stage" }).click();
    await page.getByRole("menu").getByRole("button", { name: templateName }).click();
    const panel = page.getByRole("region", { name: templateName, exact: true });
    await expect(panel.getByLabel("Project command")).toHaveValue("publish");
    await expect(panel.getByLabel("Publishes")).toHaveValue("branch-only");
    // Added unconnected: Tests' route leads to it, and it to End.
    await flow.getByRole("button", { name: "Tests", exact: true }).click();
    await page
      .getByRole("region", { name: "Tests", exact: true })
      .getByRole("button", { name: /→ End/ })
      .click();
    await page
      .getByRole("region", { name: "Route" })
      .getByLabel("Goes to")
      .selectOption({ label: templateName });
    await flow.getByRole("button", { name: templateName, exact: true }).click();
    await panel.getByRole("button", { name: "Add a route" }).click();
    await page.getByRole("button", { name: "Save the Pipeline" }).click();
    await expect(page.getByText("Pipeline saved.", { exact: false })).toBeVisible();
    await page.reload();
    await flow.getByRole("button", { name: templateName, exact: true }).click();
    await expect(panel.getByLabel("Publishes")).toHaveValue("branch-only");
    const savedStages = (await libraryPipeline(page, pipeline.id)).stages;
    // Its own key, from its name, as any added Stage's.
    expect(savedStages[1]).toEqual({
      ...copied,
      key: `publish-preview-${stamp}`,
      place: expect.any(Object),
      routes: [{ to: null, condition: null }],
    });
    await page.locator(".settings-split").screenshot({
      path: path.join(SCREENSHOTS, "light-1600-settings-stage-from-template.png"),
    });

    // In Edit for this Task.
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(
        page,
        repository.path,
        `Templates ${Date.now()}`,
        pipeline.id,
      );
      const created = await page.request.post("/api/tasks", {
        data: { title: "Copy a Stage template in", projectId: project.id, priority: "normal" },
      });
      const { id: taskId } = taskSchema.parse(await created.json());
      // Following the Pipeline above, whose Stages nobody needs to be hired for.
      await page.request.put(`/api/tasks/${taskId}/pipeline`, {
        data: { pipelineId: pipeline.id },
      });
      await page.goto(`/tasks/${taskId}`);
      await page.getByRole("button", { name: "Edit for this Task" }).click();
      const dialog = page.getByRole("dialog");
      const taskFlow = dialog.getByRole("region", { name: "Flow" });
      // The Add a Stage menu lists the templates under From a template, after the kinds.
      await dialog.getByRole("button", { name: "Add a Stage" }).click();
      const addMenu = page.getByRole("menu");
      await expect(addMenu).toContainText("From a template");
      await addMenu.getByRole("button", { name: templateName }).click();
      // The Task's Stages already hold the Pipeline's copy, so this one is named apart.
      const copyName = `${templateName} 2`;
      const copyPanel = dialog.getByRole("region", { name: copyName, exact: true });
      await expect(copyPanel.getByLabel("Publishes")).toHaveValue("branch-only");
      // Added unconnected after the last Stage: the Pipeline's copy leads to it, and it to End.
      await expect(dialog.getByRole("button", { name: "Save for this Task" })).toBeDisabled();
      await taskFlow.getByRole("button", { name: templateName, exact: true }).click();
      await dialog
        .getByRole("region", { name: templateName, exact: true })
        .getByRole("button", { name: /→ End/ })
        .click();
      await dialog
        .getByRole("region", { name: "Route" })
        .getByLabel("Goes to")
        .selectOption({ label: copyName });
      await taskFlow.getByRole("button", { name: copyName, exact: true }).click();
      await copyPanel.getByRole("button", { name: "Add a route" }).click();
      await expect(dialog.getByRole("list", { name: "Problems" })).toHaveCount(0);
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-edit-for-this-task-from-template.png"),
      });
      await dialog.getByRole("button", { name: "Save for this Task" }).click();
      await expect(page.getByText("Stages saved for Copy a Stage template in.")).toBeVisible();
      await page.reload();
      const taskStages = async (): Promise<Stage[]> =>
        (
          taskStagesSchema.parse(
            await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
          ).stages ?? []
        ).map(({ stage }) => stage);
      const copy = (await taskStages()).find(({ name }) => name === copyName);
      expect(copy).toEqual({
        ...copied,
        name: copyName,
        key: `publish-preview-${stamp}-2`,
        place: expect.any(Object),
        routes: expect.any(Array),
      });

      // Editing the template, then removing it, leaves every copy as it was.
      await page.goto(`/settings/pipelines/stage-templates/${template.id}`);
      await page
        .getByLabel("Publishes")
        .selectOption({ label: "By the Project's publishing mode" });
      await page.getByRole("button", { name: "Save the template" }).click();
      await expect(page.getByText("Stage template saved.", { exact: false })).toBeVisible();
      expect((await libraryPipeline(page, pipeline.id)).stages).toEqual(savedStages);
      expect((await taskStages()).find(({ name }) => name === copyName)).toEqual(copy);
      await removeStageTemplate(page, template);
      expect((await libraryPipeline(page, pipeline.id)).stages).toEqual(savedStages);
    } finally {
      await repository.remove();
    }
  },
);

// Script Stages and Gates only, as nobody may fill a Role in this file (see the Pipeline test above).
test(
  "the user adds a Project Pipeline on its Project's page, edits it in the flow editor, sees it Broken by a base Pipeline's save and fixes it",
  { tag: "@full" },
  async ({ page }) => {
    const stamp = Date.now();
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository.path, `Piped ${stamp}`, "full");
      const base = await addedPipeline(page, `Checked ${stamp}`, [
        { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" },
        { kind: "gate", key: "review", name: "Review", optional: false },
        {
          kind: "script",
          key: "lint",
          name: "Lint",
          optional: false,
          command: "lint",
          onFailure: { goBackTo: "tests", rounds: 2 },
        },
      ]);
      const name = `${base.name} for ${project.name}`;

      // The Project's page lists its own Pipelines under its default.
      await page.goto(`/projects/${project.id}/pipelines`);
      const list = page.getByRole("navigation", { name: `${project.name}'s Pipelines` });
      await expect(list).toContainText(
        `None yet: ${project.name}'s Tasks choose from the office-wide Pipelines.`,
      );
      await page.getByRole("button", { name: "Add a Pipeline built from…" }).click();
      const adding = page.getByRole("dialog");
      await adding.getByRole("radio", { name: new RegExp(base.name) }).check();
      await expect(adding.getByLabel("Name", { exact: true })).toHaveValue(name);
      await screenshotScenario(page, "project-pipelines-add");
      await adding.getByRole("button", { name: "Add the Pipeline" }).click();
      await expect(page.getByText(`${name} added to ${project.name}'s Pipelines.`)).toBeVisible();
      await expect(page).toHaveURL(/\/projects\/[^/]+\/pipelines\/[^/]+$/);
      const projectPipelineId = page.url().split("/").at(-1) ?? "";
      const item = list.getByRole("link", { name: new RegExp(`^${name}`) });
      await expect(item).toContainText(`Built from ${base.name} · 0 Stage changes`);
      await screenshotScenario(page, "project-pipelines-list");

      // Insert a Gate after Tests, change Lint's command, remove Review.
      const flow = page.getByRole("region", { name: "Flow" });
      const card = (stageName: string): Locator =>
        flow.locator("[data-flow-stage]").filter({
          has: page.getByRole("button", { name: stageName, exact: true }),
        });
      const pickStage = (stageName: string): Promise<void> =>
        flow.getByRole("button", { name: stageName, exact: true }).click();
      const panel = (stageName: string): Locator =>
        page.getByRole("region", { name: stageName, exact: true });
      await expect(page.getByRole("button", { name: "Insert a Stage" })).toBeDisabled();
      await pickStage("Tests");
      await page.getByRole("button", { name: "Insert after Tests" }).click();
      const inserting = page.getByRole("menu");
      for (const kind of ["Agent Stage", "Script Stage", "Gate before Tests"]) {
        await expect(inserting.getByRole("button", { name: kind, exact: true })).toBeVisible();
      }
      await inserting.getByRole("button", { name: "Gate", exact: true }).click();
      await expect(card("Gate")).toContainText("Inserted after Tests");
      await expect(panel("Gate")).toBeVisible();
      await screenshotScenario(page, "project-pipelines-inserted");
      await pickStage("Lint");
      // The Project's own commands alone.
      await panel("Lint").getByLabel("Project command").selectOption("build");
      await expect(card("Lint")).toContainText("Changed: Project command");
      await expect(panel("Lint").getByRole("table")).toContainText(`${base.name} has`);

      // Change routes: a route Review lacks, shown beside the base Pipeline's, then undone.
      await pickStage("Review");
      await panel("Review").getByRole("button", { name: "Add a route" }).click();
      await expect(card("Review")).toContainText("Routes changed");
      const routes = page.getByRole("group", { name: "Review's routes" });
      await expect(routes).toContainText(`${base.name} has`);
      await expect(routes).toContainText(`${project.name} gets`);
      await expect(page.getByRole("region", { name: "Route" })).toContainText(
        "Route from Review to End",
      );
      await screenshotScenario(page, "project-pipeline-flow", { inView: flow });
      await screenshotScenario(page, "project-pipeline-flow-routes", { inView: routes });
      await page
        .getByRole("button", { name: `Undo: give Review ${base.name}'s routes back` })
        .click();
      await expect(card("Review")).not.toContainText("Routes changed");
      await expect(routes).toHaveCount(0);

      await pickStage("Review");
      await panel("Review").getByRole("button", { name: "More for Review" }).click();
      await page
        .getByRole("menu")
        .getByRole("button", { name: `Remove from ${project.name}'s Stages` })
        .click();
      await expect(card("Review")).toContainText("Removed");
      await screenshotScenario(page, "project-pipelines-kinds");

      await page.getByRole("button", { name: "Save the Pipeline" }).click();
      await expect(page.getByText("Pipeline saved.", { exact: false })).toBeVisible();
      await page.reload();
      await expect(card("Review")).toContainText("Removed");
      expect((await projectPipeline(page, projectPipelineId)).stageChanges).toEqual([
        expect.objectContaining({
          kind: "insert-after",
          stageKey: "tests",
          stage: expect.objectContaining({ kind: "gate" }),
        }),
        { kind: "change", stageKey: "lint", stageName: "Lint", fields: { command: "build" } },
        { kind: "remove", stageKey: "review", stageName: "Review" },
      ]);

      // Undo one Stage change alone.
      await pickStage("Review");
      await panel("Review")
        .getByRole("button", { name: `Undo: put ${base.name}'s Review back` })
        .click();
      await expect(card("Review")).not.toContainText("Removed");
      await page.getByRole("button", { name: "Save the Pipeline" }).click();
      await expect(page.getByText("Pipeline saved.", { exact: false })).toBeVisible();
      expect((await projectPipeline(page, projectPipelineId)).stageChanges).toHaveLength(2);

      // Removing Tests from the base Pipeline breaks the inserted Gate, which names it: it warns first.
      await page.goto(`/settings/pipelines/${base.id}`);
      await expect(
        page
          .getByRole("navigation", { name: "Office-wide Pipelines" })
          .getByRole("link", { name: new RegExp(`^${base.name}`) }),
      ).toContainText("Built on by 1 Project Pipeline");
      await pickStage("Tests");
      await panel("Tests").getByRole("button", { name: "More for Tests" }).click();
      await page.getByRole("menu").getByRole("button", { name: "Remove Tests" }).click();
      await expect(page.getByText("Saving breaks 1 Project Pipeline")).toBeVisible();
      await page.getByRole("button", { name: "Save the Pipeline" }).click();
      const warning = page.getByRole("dialog");
      await expect(warning).toContainText(`Saving ${base.name} breaks 1 Project Pipeline`);
      await expect(warning).toContainText(name);
      await expect(warning).toContainText(project.name);
      await expect(warning).toContainText(`which ${base.name} no longer has`);
      await screenshotScenario(page, "project-pipelines-warning");
      await warning.getByRole("button", { name: "Save anyway" }).click();
      await expect(page.getByText("Pipeline saved.", { exact: false })).toBeVisible();
      await expect(
        page.getByRole("link", { name: new RegExp(`^${base.name}`) }).first(),
      ).toContainText("1 Broken");
      await expect(
        page.getByRole("list", { name: "Built on by 1 Project Pipeline" }),
      ).toContainText("1 Broken");
      await screenshotScenario(page, "settings-pipelines-built-on-by");

      // Broken on its Project's page, with why, and fixed there.
      await page.goto(`/projects/${project.id}/pipelines/${projectPipelineId}`);
      await expect(item).toContainText("1 Stage change doesn't apply");
      await expect(
        page.getByText(`${name} is Broken: 1 Stage change no longer applies to ${base.name}`),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Save the Pipeline" })).toBeDisabled();
      await screenshotScenario(page, "project-pipelines-broken");
      await page.getByLabel("Apply it to").selectOption({ label: "Review" });
      await expect(
        page.getByText(`Fixed: save it, and Tasks can choose ${name} again`),
      ).toBeVisible();
      await page.getByRole("button", { name: "Save the Pipeline" }).click();
      await expect(page.getByText("Pipeline saved.", { exact: false })).toBeVisible();
      expect((await projectPipeline(page, projectPipelineId)).broken).toEqual([]);

      // Removing it asks first.
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await page.getByRole("button", { name: "Remove the Pipeline" }).click();
      await expect(
        page.getByText(`${name} removed from ${project.name}'s Pipelines.`),
      ).toBeVisible();
      await expect(item).toHaveCount(0);
    } finally {
      await repository.remove();
    }
  },
);

test(
  "on a wide canvas the user drags a Stage into a new column and draws a route from a Stage's + to End",
  { tag: "@full" },
  async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const pipeline = await addedPipeline(page, `Dragged ${Date.now()}`, [
      { kind: "script", key: "build", name: "Build", optional: false, command: "build" },
      { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" },
      { kind: "gate", key: "review", name: "Review", optional: false },
    ]);
    await page.goto(`/settings/pipelines/${pipeline.id}`);
    const flow = page.getByRole("region", { name: "Flow" });
    await expect(flow).toHaveAttribute("data-orientation", "across");

    // Review dropped at the left edge of Tests' column goes into a new column before it.
    const review = await boxOf(flow.locator('[data-flow-stage="review"]'));
    const tests = await boxOf(flow.locator('[data-flow-stage="tests"]'));
    await page.mouse.move(review.x + review.width / 2, review.y + review.height / 2);
    await page.mouse.down();
    await page.mouse.move(tests.x + 4, tests.y + tests.height / 2, { steps: 12 });
    await expect(flow.locator(".flow-canvas-drop--column")).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole("region", { name: "Review", exact: true })).toContainText(
      "2 of 3 in the Pipeline's order",
    );
    // Tests' route to Review now leads back, which holds Save.
    await expect(page.getByText("1 problem holds Save")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save the Pipeline" })).toBeDisabled();

    // From Build's + to End: a second route out of Build, drawn before its route with no condition.
    const handle = await boxOf(flow.getByRole("button", { name: "Draw a route from Build" }));
    const end = await boxOf(flow.getByRole("img", { name: "End" }));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
    await expect(flow.locator(".flow-canvas-drawing")).toHaveCount(1);
    await page.mouse.up();
    await expect(page.getByText("Route drawn from Build to End.", { exact: false })).toBeVisible();
    await expect(page.getByRole("region", { name: "Route" })).toContainText(
      "Route from Build to End",
    );
    await expect(flow.getByRole("button", { name: "Route from Build to End" })).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  },
);

test(
  "at 390 wide the flow editor runs top to bottom and nothing scrolls sideways, in Settings › Pipelines and on a Project page",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository.path, `Narrow ${Date.now()}`, "full");
      const base = await addedBasePipeline(page, "Narrow base");
      const own = await addedProjectPipeline(page, project.id, base, "Narrow own");
      await page.setViewportSize({ width: 390, height: 844 });
      for (const address of [
        `/settings/pipelines/${base.id}`,
        `/projects/${project.id}/pipelines/${own.id}`,
      ]) {
        await page.goto(address);
        const flow = page.getByRole("region", { name: "Flow" });
        await expect(flow).toHaveAttribute("data-orientation", "down");
        await flow.getByRole("button", { name: "Tests", exact: true }).click();
        await expect(page.getByRole("region", { name: "Tests", exact: true })).toBeVisible();
        const sideways = await page.evaluate(() => {
          const scrolling = document.scrollingElement;
          return scrolling ? scrolling.scrollWidth - scrolling.clientWidth : 0;
        });
        expect(sideways).toBeLessThanOrEqual(0);
        // Down, each Stage sits under the one before it.
        const build = await boxOf(flow.locator('[data-flow-stage="build"]'));
        const tests = await boxOf(flow.locator('[data-flow-stage="tests"]'));
        expect(tests.y).toBeGreaterThan(build.y + build.height - 1);
      }
    } finally {
      await repository.remove();
    }
  },
);

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Not laid out");
  return box;
}

async function projectPipeline(page: Page, projectPipelineId: string): Promise<ProjectPipeline> {
  return projectPipelineSchema.parse(
    await (await page.request.get(`/api/project-pipelines/${projectPipelineId}`)).json(),
  );
}

async function addedPipeline(
  page: Page,
  name: string,
  stages: readonly Stage[],
): Promise<Pipeline> {
  const response = await page.request.post("/api/pipelines", {
    data: { name, description: "", stages },
  });
  expect(response.status()).toBe(201);
  return pipelineSchema.parse(await response.json());
}

async function libraryPipeline(page: Page, pipelineId: string): Promise<Pipeline> {
  return pipelineSchema.parse(
    await (await page.request.get(`/api/pipelines/${pipelineId}`)).json(),
  );
}

async function stageTemplates(page: Page): Promise<StageTemplate[]> {
  return stageTemplateListSchema.parse(
    await (await page.request.get("/api/stage-templates")).json(),
  );
}

async function removeStageTemplate(page: Page, template: StageTemplate | undefined): Promise<void> {
  if (!template) return;
  const response = await page.request.delete(`/api/stage-templates/${template.id}`);
  expect(response.status()).toBe(204);
}

/** A Project of the test's own, through the API, so its Task can be edited for itself. */
async function addedProject(
  page: Page,
  repositoryPath: string,
  name: string,
  defaultPipeline: string,
): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repositoryPath,
    baseBranch: "main",
    mark: { label: "ST", colour: "violet" },
    installCommand: "npm ci",
    commands: [
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: "npm run build",
        rerunCommandLine: "",
      },
      {
        key: "lint",
        name: "Lint",
        kind: "lint",
        commandLine: "npm run lint",
        rerunCommandLine: "",
      },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline,
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

// Nothing is saved: people.e2e.ts saves engines, and a Save sends every engine whole.
test(
  "Settings › Engines' rows hold one line each, a long name cut beside the Office default",
  { tag: "@full" },
  async ({ page }) => {
    const longName =
      "Claude Code on the research team's long-lived account, kept for the night runs";
    await page.goto("/settings/engines");
    const list = page.getByRole("navigation", { name: "Engines" });
    const officeDefault = list.getByRole("button").filter({ hasText: "Office default" });
    await officeDefault.click();
    await page.locator(".engine-detail").getByLabel("Name", { exact: true }).fill(longName);
    // An API endpoint without a model shows its warning mark.
    await page.getByRole("button", { name: "Add an engine" }).click();
    await page.getByRole("menu").getByRole("button", { name: "API endpoint", exact: true }).click();
    await expect(list.getByLabel("It offers no model yet")).toBeVisible();
    await expect(officeDefault).toContainText(longName);
    // The kind shows as an icon, and screen readers still read it in the row's text.
    await expect(officeDefault).toContainText("Claude Code ·");

    await screenshotEachLook(page, list, "settings-engines", async () => {
      const nameCut = await officeDefault
        .locator(".pick-list-name")
        .evaluate((name) => name.scrollWidth > name.clientWidth);
      expect(nameCut).toBe(true);
    });
    await page.getByRole("button", { name: "Discard" }).click();

    // With no engine listed, the list says how to add one.
    await page.route("**/api/settings/engines", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const saved = (await response.json()) as EngineSettings;
      return route.fulfill({ response, json: { ...saved, engines: [], officeDefault: null } });
    });
    await page.reload();
    await expect(list).toHaveText(
      "No engine yet. Add a Claude Code engine, a Codex engine or an API endpoint with Add an engine.",
    );
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-settings-engines-empty.png"),
    });
  },
);

// The engines' settings are routed, never saved: people.e2e.ts adds and removes engines meanwhile,
// and a Save sends every engine whole. The PUT is checked and answered as the service answers it.
test(
  "Settings › Engines' Stand-in Engines are added, reordered and saved with the switch's context size",
  { tag: "@full" },
  async ({ page }) => {
    const nightRuns = {
      id: "night-runs",
      name: "Night runs",
      kind: "claude-code",
      defaultModel: "claude-sonnet-5-5",
      claudeCodeP: false,
    } as const;
    let stored: Pick<EngineSettings, "standInEngines" | "askBeforeSwitchAbove"> | undefined;
    const sent: unknown[] = [];
    await page.route("**/api/settings/engines", async (route) => {
      // Read apart from the page, which page.route doesn't reach.
      const saved = (await (
        await page.request.get("/api/settings/engines")
      ).json()) as EngineSettings;
      const shown: EngineSettings = {
        ...saved,
        engines: [...saved.engines, nightRuns],
        standInEngines: [],
        ...stored,
      };
      if (route.request().method() === "PUT") {
        const edit = route.request().postDataJSON() as Pick<
          EngineSettings,
          "standInEngines" | "askBeforeSwitchAbove"
        >;
        sent.push(edit);
        stored = {
          standInEngines: edit.standInEngines,
          askBeforeSwitchAbove: edit.askBeforeSwitchAbove,
        };
        return route.fulfill({ json: { ...shown, ...stored } });
      }
      return route.fulfill({ json: shown });
    });
    await page.goto("/settings/engines");
    const firstSaved = (
      (await (await page.request.get("/api/settings/engines")).json()) as EngineSettings
    ).engines[0];
    expect(firstSaved).toBeDefined();
    const firstName = firstSaved?.name ?? "";

    const card = page
      .locator("section")
      .filter({ has: page.locator(".stand-in-engines") })
      .last();
    await expect(card).toContainText("No Stand-in Engine yet");
    const add = card.getByLabel("Add a stand-in");
    await add.selectOption({ label: nightRuns.name });
    await add.selectOption({ label: firstName });
    const rows = card.getByRole("list", { name: "Stand-in Engines" }).getByRole("listitem");
    await expect(rows).toHaveText([`1${nightRuns.name}`, `2${firstName}`]);
    // Every saved engine is listed: nothing is left to add.
    await expect(add).toBeDisabled();
    await expect(card.getByRole("button", { name: `Move ${nightRuns.name} up` })).toBeDisabled();
    await expect(card.getByRole("button", { name: `Move ${firstName} down` })).toBeDisabled();
    await card.getByRole("button", { name: `Move ${firstName} up` }).click();
    await expect(rows).toHaveText([`1${firstName}`, `2${nightRuns.name}`]);

    const size = card.getByLabel("Ask before switching a Stage whose context is over");
    await expect(size).toHaveValue("100000");
    // A size that isn't a whole number of tokens holds Save.
    await size.fill("150k");
    await expect(card).toContainText("Give a whole number of tokens");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(page.locator(".settings-actions").getByRole("status")).toContainText(
      "The context size under Stand-in Engines needs fixing before Save.",
    );
    await size.fill("150000");
    await size.blur();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: path.join(TASK_SCREENSHOTS, "settings-engines-stand-in-engines.png"),
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    expect(sent).toEqual([
      expect.objectContaining({
        standInEngines: [firstSaved?.id, nightRuns.id],
        askBeforeSwitchAbove: 150_000,
      }),
    ]);

    await page.reload();
    await expect(rows).toHaveText([`1${firstName}`, `2${nightRuns.name}`]);
    await expect(size).toHaveValue("150000");
    await card
      .getByRole("button", { name: `Remove ${nightRuns.name} from the Stand-in Engines` })
      .click();
    await expect(rows).toHaveText([`1${firstName}`]);
    await expect(add).toBeEnabled();
  },
);

/**
 * For each palette and at 1600 and 600 wide: the list's rows of as many lines all one height, each
 * mark inside its row, nothing scrolling sideways, then a screenshot of the list beside its detail.
 */
async function screenshotEachLook(
  page: Page,
  list: Locator,
  name: string,
  check?: () => Promise<void>,
): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveAttribute("data-palette", colorScheme);
    for (const width of [1600, 600]) {
      await page.setViewportSize({ width, height: 900 });
      const rows = await list.locator("li > *").evaluateAll((items) =>
        items.map((item) => {
          const row = item.getBoundingClientRect();
          return {
            lines: item.querySelectorAll(".pick-list-line").length,
            height: Math.round(row.height),
            marksInside: [...item.querySelectorAll(".pick-list-aside > *")].every((mark) => {
              const box = mark.getBoundingClientRect();
              return box.top >= row.top && box.bottom <= row.bottom && box.right <= row.right;
            }),
          };
        }),
      );
      for (const lines of new Set(rows.map((row) => row.lines))) {
        const heights = rows.filter((row) => row.lines === lines).map(({ height }) => height);
        expect(new Set(heights).size).toBe(1);
      }
      expect(rows.every(({ marksInside }) => marksInside)).toBe(true);
      const sideways = await page
        .locator("html")
        .evaluate((html) => html.scrollWidth - html.clientWidth);
      expect(sideways).toBe(0);
      await check?.();
      await page.locator(".settings-split").screenshot({
        path: path.join(SCREENSHOTS, `${colorScheme}-${width}-${name}.png`),
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1600, height: 900 });
}

// Account › Appearance, here since it moved from Settings. A palette and a density are each user's,
// so each test chooses as a user of its own and the shared user's stay as every file expects.
asOwnUser.describe("Account › Appearance", { tag: "@full" }, () => {
  // A system in dark, so each choice shows as a change from what the system gives.
  asOwnUser.use({ colorScheme: "dark" });

  asOwnUser(
    "switches every palette and Follow the system, each kept across reloads",
    async ({ page }) => {
      // Settings › Appearance's old address leads to it.
      await page.goto("/settings/appearance");
      await expect(page).toHaveURL(/\/account\/appearance$/);
      const html = page.locator("html");
      const palette = page.getByRole("group", { name: "Palette" });
      await expect(palette.getByRole("button", { name: "Follow the system" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(html).toHaveAttribute("data-palette", "dark");

      // Each card previews its own palette, whatever palette is shown.
      const previewColours = await palette
        .locator(".palette-preview")
        .evaluateAll((previews) => previews.map((preview) => getComputedStyle(preview).background));
      expect(new Set(previewColours).size).toBe(previewColours.length);

      for (const [name, shown, base] of [
        ["Light", "light", "light"],
        ["Dark", "dark", "dark"],
        ["Graphite", "graphite", "dark"],
        ["Paper", "paper", "light"],
        ["Midnight", "midnight", "dark"],
        ["Mist", "mist", "light"],
        ["Mocha", "mocha", "dark"],
        ["Sage", "sage", "light"],
        ["Aubergine", "aubergine", "dark"],
        ["Lavender", "lavender", "light"],
        ["Lagoon", "lagoon", "dark"],
        ["Cobalt", "cobalt", "light"],
        ["Emerald", "emerald", "dark"],
        ["Citrine", "citrine", "light"],
      ] as const) {
        await palette.getByRole("button", { name }).click();
        await expect(html).toHaveAttribute("data-palette", shown);
        await expect(html).toHaveAttribute("data-theme", base);
        await page.reload();
        await expect(html).toHaveAttribute("data-palette", shown);
        await expect(html).toHaveAttribute("data-theme", base);
        await expect(palette.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
        for (const width of [1600, 600]) {
          await page.setViewportSize({ width, height: 900 });
          const sideways = await html.evaluate((root) => root.scrollWidth - root.clientWidth);
          expect(sideways).toBe(0);
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${shown}-${width}-account-appearance.png`),
          });
        }
        await page.setViewportSize({ width: 1600, height: 900 });
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
    },
  );

  asOwnUser("switches to Compact and to Relaxed, each kept across reloads", async ({ page }) => {
    await page.goto("/account/appearance");
    const html = page.locator("html");
    const density = page.getByRole("group", { name: "Density" });
    const accountPage = page.locator(".account-page");
    await expect(density.getByRole("button", { name: "Comfortable" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(html).toHaveAttribute("data-density", "comfortable");

    // Each card previews its own density, whatever density is shown.
    const previewHeights = await density
      .locator(".density-preview")
      .evaluateAll((previews) => previews.map((preview) => preview.getBoundingClientRect().height));
    expect(previewHeights).toEqual(previewHeights.toSorted((a, b) => a - b));
    expect(new Set(previewHeights).size).toBe(3);

    for (const [name, shown, pagePadding] of [
      ["Compact", "compact", 16],
      ["Relaxed", "relaxed", 32],
      ["Comfortable", "comfortable", 24],
    ] as const) {
      await density.getByRole("button", { name }).click();
      await expect(html).toHaveAttribute("data-density", shown);
      await page.reload();
      await expect(html).toHaveAttribute("data-density", shown);
      await expect(density.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
      // The page pads --pad-page at that density.
      const padding = await accountPage.evaluate((element) => getComputedStyle(element).paddingTop);
      expect(Number.parseFloat(padding)).toBe(pagePadding);
      // A density changes no colour.
      await expect(html).toHaveAttribute("data-palette", "dark");
      for (const width of [1600, 600]) {
        await page.setViewportSize({ width, height: 900 });
        const sideways = await html.evaluate((root) => root.scrollWidth - root.clientWidth);
        expect(sideways).toBe(0);
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${shown}-${width}-account-appearance.png`),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1600, height: 900 });
    }
  });
});

test("the flow canvas moves with the right mouse button, zooms, fits the whole Pipeline and goes full screen; a Project Pipeline's Stage says why it stays", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository.path, `Canvas ${Date.now()}`, "full");
    const base = await addedBasePipeline(page, "Canvas base");
    const own = await addedProjectPipeline(page, project.id, base, "Canvas own");

    // Full has more Stages than fit beside the list at 100%. By its address, so a narrow window
    // shows it rather than the list.
    await page.goto("/settings/pipelines");
    const full = page.getByRole("navigation", { name: "Office-wide Pipelines" }).getByRole("link");
    await page.goto((await full.first().getAttribute("href")) ?? "");
    const flow = page.getByRole("region", { name: "Flow" });
    const view = page.getByRole("group", { name: /^Flow view/ });
    const tools = page.getByRole("toolbar", { name: "Canvas" });
    await expect(flow.locator("[data-flow-stage]").first()).toBeVisible();
    await expect(tools.getByRole("button", { name: "Zoom: 100%" })).toBeVisible();
    await expect(page.getByRole("group", { name: /^Overview/ })).toBeVisible();
    await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "settings-pipelines-tab.png") });
    await screenshotScenario(page, "settings-pipelines-canvas", { inView: view });

    // The right button moves the view, and opens no menu.
    const transform = (): Promise<string> =>
      page.locator(".flow-viewport-content").evaluate((content) => content.style.transform);
    const before = await transform();
    const frame = await boxOf(view);
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(frame.x + frame.width / 2 - 240, frame.y + frame.height / 2, {
      steps: 6,
    });
    await page.mouse.up({ button: "right" });
    expect(await transform()).not.toBe(before);
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Ctrl + scroll zooms out, and under 60% a card shows only its name.
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 400);
    await page.keyboard.up("Control");
    await expect(tools.getByRole("button", { name: "Zoom: 100%" })).toHaveCount(0);

    // Fit shows every Stage inside the view.
    await tools.getByRole("button", { name: "Fit the Pipeline" }).click();
    await expect(page.getByRole("group", { name: /^Overview/ })).toHaveCount(0);
    const fitted = await boxOf(view);
    for (const card of await flow.locator("[data-flow-stage]").all()) {
      const box = await card.boundingBox();
      if (!box) throw new Error("A Stage isn't laid out");
      expect(box.x).toBeGreaterThanOrEqual(fitted.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(fitted.x + fitted.width + 1);
    }
    await screenshotScenario(page, "settings-pipelines-canvas-fitted", { inView: view });

    // Full screen covers the window, with Save at hand; Escape brings the editor back.
    await tools.getByRole("button", { name: "Full screen" }).click();
    const fullScreen = page.getByRole("dialog", { name: "Stages and routes, full screen" });
    await expect(fullScreen).toBeVisible();
    await expect(fullScreen.getByRole("button", { name: "Save the Pipeline" })).toBeVisible();
    await page.screenshot({
      path: path.join(TASK_SCREENSHOTS, "settings-pipelines-full-screen.png"),
    });
    await page.keyboard.press("Escape");
    await expect(fullScreen).toHaveCount(0);
    await expect(flow).toBeVisible();

    // The Stage templates are the second tab.
    await page.getByRole("tab", { name: /^Stage templates/ }).click();
    await expect(page.getByRole("navigation", { name: "Stage templates" })).toBeVisible();
    await page.screenshot({
      path: path.join(TASK_SCREENSHOTS, "settings-stage-templates-tab.png"),
    });

    // A Project Pipeline keeps its base Pipeline's places, and says so when a Stage is dragged.
    await page.goto(`/projects/${project.id}/pipelines/${own.id}`);
    const build = await boxOf(flow.locator('[data-flow-stage="build"]'));
    await page.mouse.move(build.x + build.width / 2, build.y + 12);
    await page.mouse.down();
    await page.mouse.move(build.x + build.width / 2 + 80, build.y + 40, { steps: 4 });
    await expect(page.getByRole("status").filter({ hasText: "Its place comes from" })).toHaveText(
      `Its place comes from ${base.name}, the base Pipeline: move it there.`,
    );
    await page.mouse.up();
    await screenshotScenario(page, "project-pipelines-canvas", { inView: view });
  } finally {
    await repository.remove();
  }
});
