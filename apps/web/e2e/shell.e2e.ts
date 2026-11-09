import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { Engine, EngineSettings, Notification, Now } from "@the-office/contracts";
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

      test("the page follows the rail's width, icon-only and expanded", async ({ page }) => {
        await page.goto("/now");
        const rail = page.getByRole("navigation", { name: "Surfaces" });
        const main = page.locator(".shell-main");
        const pageStartsAfterRail = async (): Promise<void> => {
          // Settled once the width transition ends.
          await expect
            .poll(async () => {
              const railBox = await rail.boundingBox();
              const mainBox = await main.boundingBox();
              return railBox && mainBox && mainBox.x - (railBox.x + railBox.width);
            })
            .toBe(0);
        };

        await pageStartsAfterRail();
        expect((await rail.boundingBox())?.width).toBe(56);

        await rail.getByRole("button", { name: "Expand sidebar" }).click();
        await expect.poll(async () => (await rail.boundingBox())?.width).toBe(208);
        await pageStartsAfterRail();
        // No part of the page is pushed past the window's edge.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await page.mouse.move(width / 2, 600);
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${palette}-${width}-now-rail-expanded.png`),
        });
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

test.describe("the rail's toggle", () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("expands the rail to show its labels, kept over a reload, and collapses it again", async ({
    page,
  }) => {
    await page.goto("/now");
    const rail = page.getByRole("navigation", { name: "Surfaces" });
    const labels = ["Now", "Work", "People", "Projects", "Settings", "Theme"];
    const expand = rail.getByRole("button", { name: "Expand sidebar" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    for (const label of labels) await expect(rail.getByText(label, { exact: true })).toHaveCount(0);

    await expand.click();

    const collapse = rail.getByRole("button", { name: "Collapse sidebar" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    for (const label of labels) await expect(rail.getByText(label, { exact: true })).toBeVisible();
    // The label is shown, so no tooltip repeats it.
    await rail.getByRole("link", { name: "Work", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    // The Theme menu still opens beside its button, not over it; like the icon rail's, it meets
    // the rail's edge.
    const theme = rail.getByRole("button", { name: "Theme" });
    await theme.click();
    const menuBox = await page
      .getByRole("menu")
      .evaluate((menu) => menu.getBoundingClientRect().toJSON() as DOMRect);
    const themeBox = await theme.evaluate(
      (button) => button.getBoundingClientRect().toJSON() as DOMRect,
    );
    expect(menuBox.left).toBeGreaterThan(themeBox.right);
    expect(menuBox.top).toBeLessThan(themeBox.bottom);
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(collapse).toBeVisible();
    await expect(rail.getByText("Projects", { exact: true })).toBeVisible();

    await collapse.click();

    await expect(expand).toHaveAttribute("aria-expanded", "false");
    for (const label of labels) await expect(rail.getByText(label, { exact: true })).toHaveCount(0);
    await rail.getByRole("link", { name: "Work", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Work");
    await page.reload();
    await expect(expand).toBeVisible();
  });
});

const claudeCode = (id: string, name: string): Engine => ({
  id,
  name,
  kind: "claude-code",
  defaultModel: "claude-sonnet-5-5",
  claudeCodeP: false,
});

/** The engines as Settings › Engines lists them, and their windows as they were first read. */
async function stubEngines(
  page: Page,
  engines: readonly Engine[],
  usageWindows: Now["usageWindows"],
): Promise<void> {
  await page.route(/\/api\/settings\/engines$/, async (route) => {
    const settings = (await (await route.fetch()).json()) as EngineSettings;
    await route.fulfill({ json: { ...settings, engines } });
  });
  await page.route(/\/api\/now$/, async (route) => {
    const now = (await (await route.fetch()).json()) as Now;
    await route.fulfill({ json: { ...now, usageWindows } });
  });
}

test.describe("the usage figure", () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  // A read still in a route when a test ends would fail it: its response is gone by then.
  test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

  const RESETS_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  /** Listed in Settings › Engines, it has no usage windows, so the service reads none. */
  const API_ENGINE: Engine = {
    id: "local-models",
    name: "Local models",
    kind: "openai-compatible-api",
    defaultModel: "a-model",
    baseUrl: "https://models.example.test/v1",
    keySet: true,
    models: [{ id: "a-model", contextWindow: 100_000 }],
  };
  const windowsOf = (engineId: string, fiveHour: number): Now["usageWindows"][number] => ({
    engineId,
    fiveHour: { percentUsed: fiveHour, resetsAt: RESETS_AT },
    sevenDay: { percentUsed: 17, resetsAt: RESETS_AT },
  });

  test("one engine shows both windows, the meter and the reset, and opens nothing", async ({
    page,
  }) => {
    await stubEngines(
      page,
      [claudeCode("home", "Home account"), API_ENGINE],
      [windowsOf("home", 42)],
    );
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });

    await expect(strip).toContainText("5h 42% · 7d 17%");
    await expect(strip).toContainText(/resets \d\d:\d\d|resets \d+ \w+, \d\d:\d\d/);
    await expect(strip.locator(".shell-strip-meter")).toBeVisible();
    await expect(strip.getByRole("button", { name: /5-hour window/ })).toHaveCount(0);

    await page.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-one-engine.png") });

    await strip.getByText("5h 42%").click();
    await expect(page.getByRole("dialog", { name: "Usage by engine" })).toHaveCount(0);
  });

  test("the Now page and Office limits keep showing each engine's 5-hour window", async ({
    page,
  }) => {
    // Office limits lists the real engine's caps, so the reading is that engine's.
    await stubEngines(
      page,
      [claudeCode("claude-code", "Home account")],
      [windowsOf("claude-code", 42)],
    );

    await page.goto("/now");
    await expect(page.locator(".now-tokens")).toContainText("42% of Home account's 5-hour window");

    await page.goto("/settings/office-limits");
    await expect(page.getByText(/^The 5-hour window: 42% used · resets /)).toBeVisible();
  });

  test("three engines show each 5-hour window in the engines' order, and open a list of each", async ({
    page,
  }) => {
    await stubEngines(
      page,
      [
        claudeCode("home", "Home account"),
        API_ENGINE,
        claudeCode("work", "Work account"),
        claudeCode("spare", "Spare account"),
      ],
      [windowsOf("work", 80), windowsOf("spare", 12), windowsOf("home", 42)],
    );
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    const figure = strip.getByRole("button", {
      name: "5-hour window: Home account 42%, Work account 80%, Spare account 12%",
    });

    await expect(figure).toHaveText("5h 42% · 80% · 12%");
    await expect(figure.getByTitle("Work account")).toHaveText("80%");
    await expect(strip.locator(".shell-strip-meter")).toHaveCount(0);

    const list = page.getByRole("dialog", { name: "Usage by engine" });
    await figure.click();
    const engines = list.getByRole("listitem");
    await expect(engines).toHaveCount(3);
    await expect(engines.nth(0)).toContainText("Home account");
    await expect(engines.nth(0)).toContainText(/5h 42% resets .+ · 7d 17% resets /);
    await expect(engines.nth(1)).toContainText("Work account");
    await expect(engines.nth(2)).toContainText("Spare account");
    await expect(list).not.toContainText("Local models");
    await page.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-list.png") });

    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);
    await figure.click();
    await expect(list).toBeVisible();
    await page.mouse.click(800, 600);
    await expect(list).toHaveCount(0);
    await figure.click();
    await figure.click();
    await expect(list).toHaveCount(0);
  });

  test("five engines show the highest 5-hour window and their number", async ({ page }) => {
    const percents = [10, 80, 30, 20, 40];
    const ids = percents.map((_, index) => `engine-${index}`);
    await stubEngines(
      page,
      ids.map((id) => claudeCode(id, id)),
      ids.map((id, index) => windowsOf(id, percents[index] ?? 0)),
    );
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });

    await expect(strip.getByRole("button", { name: /5-hour window/ })).toHaveText(
      "5h 80% max · 5 engines",
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-five-engines.png") });
  });
});

test.describe("the Workstation figure", () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("shows the CPU use and cores, measured from the next read, and opens the panel", async ({
    page,
  }) => {
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    const figure = strip.getByRole("button", { name: /^Workstation: / });

    // The service measures over the time since its last read, which the next 2 s poll gives.
    await expect(figure).toHaveAccessibleName(/^Workstation: \d+% CPU, \d+ cores?$/);
    await expect(figure).toHaveText(/^\d+%CPU · \d+ cores?$/);

    await figure.click();
    const panel = page.getByRole("dialog", { name: "Workstation" });
    await expect(panel.getByRole("heading", { name: "CPU" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Memory" })).toBeVisible();
    await expect(panel).toContainText(/Used[\d.]+ GB \/ [\d.]+ GB/);
    await expect(panel.getByRole("list", { name: "Use per core" })).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: path.join(SCREENSHOTS, "workstation-panel.png") });

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Narrow, it keeps the icon and the % alone.
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(figure.locator("b")).toHaveText(/^\d+%$/);
    await expect(figure.locator("b")).toBeVisible();
    await expect(figure.locator(".shell-strip-workstation-detail")).toBeHidden();
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
    // The Notifications open as the page loads are counted, not shown: "service down" raised
    // before they are read would be one of them, so the stream is lost only once they are.
    const openRead = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/notifications" && response.ok(),
    );
    await page.goto("/now");
    await openRead;
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
    // Reconnecting reads the Roles again: a read still in flight as the test ends would fail the next.
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
    // Once subscribed the page reads the open Notifications again, which would drop those raised
    // here, unknown to the service; so they're raised only after that read.
    let caughtUp: Promise<unknown> | undefined;
    await page.routeWebSocket(/\/api\/events$/, (stream) => {
      const service = stream.connectToServer();
      service.onMessage((message) => {
        if (typeof message === "string" && message.includes('"type":"subscriptions"')) {
          caughtUp ??= page.waitForResponse((response) =>
            response.url().endsWith("/api/notifications"),
          );
        }
        stream.send(message);
      });
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
    await expect.poll(() => caughtUp).toBeDefined();
    await caughtUp;
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
