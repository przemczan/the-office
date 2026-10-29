import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type WebSocketRoute } from "@playwright/test";
import type { Notification } from "@the-office/contracts";
import { desktopShown, focusTab, recordDesktopNotifications } from "./desktop-notifications.ts";

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
  { name: "Settings", path: "/settings/pipelines" },
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

test.describe("losing the service", () => {
  test.use({ colorScheme: "light" });

  test('the web raises "service down" itself, in the strip and as a toast, and clears it once back', async ({
    page,
  }) => {
    // The event stream stands for the service: closed and refused, the web has lost it.
    let reachable = true;
    const streams: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/api\/events$/, (stream) => {
      if (!reachable) return void stream.close();
      stream.connectToServer();
      streams.push(stream);
    });
    // Without an Office Manager, whom other tests may have hired, it speaks in the UI's own voice.
    await page.route(/\/api\/roles$/, async (route) => {
      const roles = (await (await route.fetch()).json()) as { readonly key: string }[];
      await route.fulfill({ json: roles.filter(({ key }) => key !== "office-manager") });
    });
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    await expect(strip).toContainText("tokens today");
    const unread = async (): Promise<number> =>
      Number(/^\((\d+)\)/.exec(await page.title())?.[1] ?? 0);
    const before = await unread();

    reachable = false;
    for (const stream of streams) await stream.close();

    const notice = page
      .locator(".toasts")
      .getByRole("button", { name: "The Office lost its service and is reconnecting." });
    await expect(strip).toContainText("Reconnecting to The Office…");
    await expect(notice).toBeVisible();
    // No event arrives while the service is lost, so only "service down" was added.
    await expect.poll(unread).toBe(before + 1);

    reachable = true;
    await expect(strip).not.toContainText("Reconnecting");
    await expect(notice).toHaveCount(0);
    // Reconnecting refetches the queries, so a read of the roles may still be in the route then.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

/** A Notification in The Office's voice, as the service raises it. */
function notification(fields: Partial<Notification> & Pick<Notification, "line">): Notification {
  return {
    id: randomUUID(),
    kind: "outcomes.task-done",
    roleKey: null,
    pointsTo: { kind: "task", taskId: randomUUID() },
    channels: ["in-app", "desktop"],
    held: [],
    raisedAt: new Date().toISOString(),
    ...fields,
  };
}

test.describe("Notifications as the service sends them", () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("collapsed Outcomes take the first one's place in the toast and on the desktop; quiet hours hold the desktop until their summary", async ({
    page,
  }) => {
    // The event stream stands for the service, which sends these as the delivery rules say.
    const streams: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/api\/events$/, (stream) => {
      stream.connectToServer();
      streams.push(stream);
    });
    const raise = (raised: Notification, replaces: readonly string[] = []): void => {
      const event = {
        type: "notification.raised",
        occurredAt: raised.raisedAt,
        notification: raised,
        replaces,
      };
      for (const stream of streams) stream.send(JSON.stringify({ type: "event", event }));
    };
    await recordDesktopNotifications(page);
    await page.goto("/projects");
    await expect(page.getByRole("status", { name: "Status strip" })).toContainText("tokens today");
    const toasts = page.locator(".toasts");

    const first = notification({ line: "Done." });
    raise(first);
    await expect(toasts.getByRole("button", { name: "Done." })).toBeVisible();
    const collapsed = notification({
      kind: "collapsed-outcomes",
      line: "2 Tasks done",
      pointsTo: { kind: "since-you-left" },
    });
    raise(collapsed, [first.id]);
    await expect(toasts.getByRole("button", { name: "Done." })).toHaveCount(0);
    await expect(toasts.getByRole("button", { name: "2 Tasks done" })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-collapsed-outcomes.png") });
    // It opens Since you left, on Now.
    await toasts.getByRole("button", { name: "2 Tasks done" }).click();
    await expect(page).toHaveURL(/\/now$/);

    // Away from the tab, the desktop shows them, the collapse in the first one's place.
    await focusTab(page, false);
    const another = notification({ line: "Paused.", kind: "outcomes.task-paused" });
    raise(another);
    await expect.poll(async () => (await desktopShown(page)).length).toBe(1);
    raise({ ...collapsed, id: randomUUID(), line: "3 Tasks done, 1 Task paused" }, [
      collapsed.id,
      another.id,
    ]);
    await expect
      .poll(async () => desktopShown(page))
      .toEqual([
        { title: "The Office", body: "Paused.", closed: true },
        { title: "The Office", body: "3 Tasks done, 1 Task paused", closed: false },
      ]);

    // Quiet hours hold the desktop: the toast shows instead, and the summary goes to the desktop.
    const held = notification({
      kind: "needs-you.gate",
      line: "Settings waits for your look.",
      pointsTo: { kind: "gate", taskId: randomUUID(), stageKey: "look" },
      channels: ["in-app", "desktop", "phone"],
      held: ["desktop", "phone"],
    });
    raise(held);
    await expect(
      toasts.getByRole("button", { name: "Settings waits for your look." }),
    ).toBeVisible();
    raise(
      notification({
        kind: "quiet-hours-summary",
        line: "During quiet hours: 1 needs you.",
        pointsTo: { kind: "since-you-left" },
        channels: ["desktop", "phone"],
      }),
    );
    await expect
      .poll(async () => (await desktopShown(page)).map(({ body }) => body))
      .toEqual(["Paused.", "3 Tasks done, 1 Task paused", "During quiet hours: 1 needs you."]);
  });
});
