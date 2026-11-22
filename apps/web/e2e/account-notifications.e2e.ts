import path from "node:path";
import { expect, type Page } from "@playwright/test";
import {
  notificationRoutingSchema,
  notificationTimingSchema,
  type NotificationTiming,
} from "@the-office/contracts";
import { addOwnUser, asOwnUser } from "./own-user.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

asOwnUser.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

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
      response.url().endsWith("/account/notifications/timing") &&
      response.request().method() === "PUT" &&
      response.ok() &&
      matches((await response.json()) as NotificationTiming),
  );
}

// Account › Notifications, moved from Settings. Notifications settings are each user's, so each
// test changes them as a user of its own and the shared user's stay as every file expects.
asOwnUser.describe("Account › Notifications", { tag: "@full" }, () => {
  asOwnUser(
    "shows what goes where, a kind set or inherited, and Reset gives it back",
    async ({ page }) => {
      await page.goto("/account");
      await page
        .getByRole("navigation", { name: "Account" })
        .getByRole("link", { name: "Notifications" })
        .click();
      await expect(page).toHaveURL(/\/account\/notifications$/);
      const grid = page.getByRole("table");
      await expect(grid.getByRole("columnheader", { name: /Phone/ })).toContainText(
        "Not set up yet",
      );
      await expect(page.getByText("Never notified: Stage progress, Tasks starting")).toBeVisible();

      const cell = (channel: string, row: string) =>
        grid.getByRole("button", { name: `${channel} for ${row}`, exact: true });
      // Ticket 20's defaults: a failed Task also goes to the phone, set on its own row.
      await expect(cell("Phone", "Task failed")).toHaveAttribute("aria-pressed", "true");
      await expect(cell("Phone", "Task failed")).toHaveAttribute("title", "Set here");
      await expect(cell("Phone", "Task done")).toHaveAttribute("aria-pressed", "false");
      await expect(cell("Desktop", "Task done")).toHaveAttribute(
        "title",
        "Inherited from Outcomes",
      );
      await expect(
        grid.getByRole("row", { name: /^Task done/ }).getByRole("button", { name: "Reset" }),
      ).toHaveCount(0);
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-account-notifications.png"),
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

  asOwnUser(
    "At the desk, Quiet hours and batching keep their minutes and quiet hours across reloads",
    async ({ page }) => {
      // Settings › Notifications' old address leads to it.
      await page.goto("/settings/notifications");
      await expect(page).toHaveURL(/\/account\/notifications$/);
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
        path: path.join(SCREENSHOTS, "light-1600-account-notification-timing.png"),
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
    },
  );

  asOwnUser(
    "one user's settings are theirs alone: another user's stay as they were",
    async ({ page, playwright, baseURL }) => {
      const grace = await addOwnUser(playwright, baseURL, "Grace of her own");
      try {
        // Grace keeps her own timing; this test's user still sees the defaults.
        const kept = await grace.api.put("/api/account/notifications/timing", {
          data: { holdPhoneMinutes: 9, awayMinutes: 9, batchOutcomesMinutes: 9, quietHours: null },
        });
        expect(kept.ok(), await kept.text()).toBe(true);
        await page.goto("/account/notifications");
        const away = page.getByRole("spinbutton", { name: "Minutes after you leave" });
        await expect(away).toHaveValue("5");

        // This user's changes reach neither Grace's timing nor her routing.
        const timingChanged = timingKept(page, (timing) => timing.awayMinutes === 7);
        await away.fill("7");
        await away.press("Enter");
        await timingChanged;
        const alarmLifted = page.getByRole("button", {
          name: "Phone for Alarm lifted with work waiting",
          exact: true,
        });
        await alarmLifted.click();
        await expect(alarmLifted).toHaveAttribute("title", "Set here");

        const gracesTiming = notificationTimingSchema.parse(
          await (await grace.api.get("/api/account/notifications/timing")).json(),
        );
        expect(gracesTiming.awayMinutes).toBe(9);
        const gracesRouting = notificationRoutingSchema.parse(
          await (await grace.api.get("/api/account/notifications/routing")).json(),
        );
        expect(gracesRouting["office.alarm-lifted"]?.phone?.on).toBe(false);
        expect(gracesRouting["office.alarm-lifted"]?.phone?.from).not.toBe("office.alarm-lifted");
      } finally {
        await grace.remove();
      }
    },
  );
});
