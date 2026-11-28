import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import {
  projectSchema,
  roleCardSchema,
  roleSchema,
  threadSchema,
  type Engine,
  type EngineSettings,
  type NewProject,
  type Notification,
  type Now,
  type Project,
} from "@the-office/contracts";
import { desktopShown, focusTab, recordDesktopNotifications } from "./desktop-notifications.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { asOwnUser } from "./own-user.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

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
  { name: "Stats", path: "/stats" },
  { name: "Live view", path: "/live-view" },
  // Settings opens at its first section.
  { name: "Settings", path: "/settings/pipelines" },
] as const;

for (const palette of PALETTES) {
  for (const { width, panels } of WIDTHS) {
    test.describe(`${palette}, ${width} wide`, () => {
      test.use({ colorScheme: palette, viewport: { width, height: 900 } });

      // The default run opens the surfaces once, in light at full width.
      test(
        "the rail opens each surface with its title",
        { tag: palette === "light" && width === 1600 ? [] : "@full" },
        async ({ page }) => {
          await page.goto("/");

          await expect(page).toHaveURL(/\/now$/);
          await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
          // Connected to the service, the strip shows the Office's figures and no reconnecting note.
          const strip = page.getByRole("status", { name: "Status strip" });
          await expect(strip).toContainText("Tokens today");
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
        },
      );

      test(
        "the page follows the rail's width, icon-only and expanded",
        { tag: "@full" },
        async ({ page }) => {
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
        },
      );

      test(`Now's panels fold to ${panels}`, { tag: "@full" }, async ({ page }) => {
        await page.goto("/now");

        const columns = await page
          .locator(".desk")
          .evaluate((desk) => getComputedStyle(desk).gridTemplateColumns.split(" ").length);
        expect(columns).toBe(panels);
      });

      test(
        "the click-through at the same width, for comparison",
        { tag: "@full" },
        async ({ page }) => {
          test.skip(!existsSync(CLICK_THROUGH), "The click-through is not on this machine.");
          await page.goto(`${pathToFileURL(CLICK_THROUGH).href}#/now`);
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${palette}-${width}-now.click-through.png`),
          });
        },
      );
    });
  }
}

/**
 * The palettes a system's light or dark can't show, so they are chosen, each by a user of the test's
 * own: a palette is the user's, and the shared user's is every other file's.
 */
const CHOSEN_PALETTES = [
  { palette: "graphite", base: "dark" },
  { palette: "paper", base: "light" },
  { palette: "midnight", base: "dark" },
  { palette: "mist", base: "light" },
  { palette: "mocha", base: "dark" },
  { palette: "sage", base: "light" },
  { palette: "aubergine", base: "dark" },
  { palette: "lavender", base: "light" },
  { palette: "lagoon", base: "dark" },
  { palette: "cobalt", base: "light" },
  { palette: "emerald", base: "dark" },
  { palette: "citrine", base: "light" },
  { palette: "contrast-light", base: "light" },
  { palette: "contrast-dark", base: "dark" },
] as const;

for (const { palette, base } of CHOSEN_PALETTES) {
  asOwnUser.describe(`${palette}, 1600 wide`, { tag: "@full" }, () => {
    // The system says the other base, so the page shows the chosen palette, not the system's.
    asOwnUser.use({
      colorScheme: base === "dark" ? "light" : "dark",
      viewport: { width: 1600, height: 900 },
    });

    asOwnUser("the rail opens each surface in it", async ({ page, ownUser }) => {
      await ownUser.chooseAppearance({ palette });
      await page.goto("/now");
      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-palette", palette);
      await expect(html).toHaveAttribute("data-theme", base);
      const rail = page.getByRole("navigation", { name: "Surfaces" });
      for (const surface of SURFACES) {
        await rail.getByRole("link", { name: surface.name, exact: true }).click();

        await expect(page).toHaveURL(new RegExp(`${surface.path}$`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(surface.name);
        await page.mouse.move(800, 600);
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${palette}-1600-${surface.name.toLowerCase()}.png`),
        });
      }
    });
  });
}

/**
 * Compact and Relaxed, in Light: a palette and a density are separate layers, so the palettes run
 * in Comfortable above and the densities in Light here, plus Graphite in Compact and Paper in
 * Relaxed once.
 */
const CHOSEN_DENSITIES = [
  { density: "compact", palette: "light", widths: [1600, 600] },
  { density: "relaxed", palette: "light", widths: [1600, 600] },
  { density: "compact", palette: "graphite", widths: [1600] },
  { density: "relaxed", palette: "paper", widths: [1600] },
] as const;

for (const { density, palette, widths } of CHOSEN_DENSITIES) {
  for (const width of widths) {
    asOwnUser.describe(`${density} in ${palette}, ${width} wide`, { tag: "@full" }, () => {
      asOwnUser.use({ viewport: { width, height: 900 } });

      asOwnUser(
        "the rail opens each surface at that density, none wider than the window",
        async ({ page, ownUser }) => {
          await ownUser.chooseAppearance({ palette, density });
          await page.goto("/now");
          const html = page.locator("html");
          await expect(html).toHaveAttribute("data-density", density);
          await expect(html).toHaveAttribute("data-palette", palette);
          const rail = page.getByRole("navigation", { name: "Surfaces" });
          for (const surface of SURFACES) {
            await rail.getByRole("link", { name: surface.name, exact: true }).click();

            await expect(page).toHaveURL(new RegExp(`${surface.path}$`));
            await expect(page.getByRole("heading", { level: 1 })).toHaveText(surface.name);
            const sideways = await html.evaluate((root) => root.scrollWidth - root.clientWidth);
            expect(sideways, `${surface.name} scrolls sideways`).toBe(0);
            await page.mouse.move(width / 2, 600);
            await page.screenshot({
              path: path.join(
                SCREENSHOTS,
                `${palette}-${density}-${width}-${surface.name.toLowerCase()}.png`,
              ),
            });
          }
        },
      );
    });
  }
}

// Chosen by a user of the test's own, as the palette and the density are each user's.
asOwnUser.describe("the palette", { tag: "@full" }, () => {
  asOwnUser.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  asOwnUser(
    "chosen in the rail, it is shown at once and kept over the system's",
    async ({ page }) => {
      await page.goto("/now");
      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-palette", "light");

      await page.getByRole("button", { name: "Theme" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("button")).toHaveText([
        "Light",
        "Dark",
        "Graphite",
        "Paper",
        "Midnight",
        "Mist",
        "Mocha",
        "Sage",
        "Aubergine",
        "Lavender",
        "Lagoon",
        "Cobalt",
        "Emerald",
        "Citrine",
        "Contrast light",
        "Contrast dark",
        "Compact",
        "Comfortable",
        "Relaxed",
      ]);
      // Each palette shows in its own colours, whatever palette is shown.
      const swatchColours = await menu
        .locator(".palette-swatch")
        .evaluateAll((swatches) =>
          swatches.map((swatch) => getComputedStyle(swatch).backgroundColor),
        );
      expect(new Set(swatchColours).size).toBe(16);
      // Sixteen palettes and three densities still fit on a window 900 high.
      const menuBox = await menu.boundingBox();
      expect(menuBox?.y).toBeGreaterThanOrEqual(0);
      expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(900);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-theme-menu.png") });
      await menu.getByRole("button", { name: "Dark" }).click();

      await expect(html).toHaveAttribute("data-palette", "dark");
      await expect(html).toHaveAttribute("data-theme", "dark");
      await page.reload();
      await expect(html).toHaveAttribute("data-palette", "dark");

      await page.getByRole("button", { name: "Theme" }).click();
      await page.getByRole("menu").getByRole("button", { name: "Graphite" }).click();
      await expect(html).toHaveAttribute("data-palette", "graphite");
      await expect(html).toHaveAttribute("data-theme", "dark");

      await page.getByRole("button", { name: "Theme" }).click();
      await page.getByRole("menu").getByRole("button", { name: "Sage" }).click();
      await expect(html).toHaveAttribute("data-palette", "sage");
      await expect(html).toHaveAttribute("data-theme", "light");
      await page.reload();
      await expect(html).toHaveAttribute("data-palette", "sage");

      for (const [name, palette, base] of [
        ["Aubergine", "aubergine", "dark"],
        ["Cobalt", "cobalt", "light"],
        ["Emerald", "emerald", "dark"],
        ["Citrine", "citrine", "light"],
        ["Contrast light", "contrast-light", "light"],
        ["Contrast dark", "contrast-dark", "dark"],
      ] as const) {
        await page.getByRole("button", { name: "Theme" }).click();
        await page.getByRole("menu").getByRole("button", { name }).click();
        await expect(html).toHaveAttribute("data-palette", palette);
        await expect(html).toHaveAttribute("data-theme", base);
        await page.reload();
        await expect(html).toHaveAttribute("data-palette", palette);
      }
    },
  );

  asOwnUser("chosen in one tab, it shows in the others", async ({ page, context }) => {
    await page.goto("/now");
    const other = await context.newPage();
    await other.goto("/now");

    for (const [name, palette, base] of [
      ["Paper", "paper", "light"],
      ["Mocha", "mocha", "dark"],
      ["Lagoon", "lagoon", "dark"],
      ["Lavender", "lavender", "light"],
    ] as const) {
      await page.getByRole("button", { name: "Theme" }).click();
      await page.getByRole("menu").getByRole("button", { name }).click();

      await expect(other.locator("html")).toHaveAttribute("data-palette", palette);
      await expect(other.locator("html")).toHaveAttribute("data-theme", base);
    }
  });
});

asOwnUser.describe("the density", { tag: "@full" }, () => {
  asOwnUser.use({ colorScheme: "light" });

  asOwnUser(
    "chosen in the rail, it is shown at once, kept, and chosen in Account › Appearance",
    async ({ page, context }) => {
      await page.goto("/now");
      const other = await context.newPage();
      await other.goto("/now");
      const html = page.locator("html");
      await expect(html).toHaveAttribute("data-density", "comfortable");

      await page.getByRole("button", { name: "Theme" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.locator(".menu-choice:has(svg)")).toHaveText(["Light", "Comfortable"]);
      await menu.getByRole("button", { name: "Compact" }).click();

      await expect(html).toHaveAttribute("data-density", "compact");
      await expect(html).toHaveAttribute("data-palette", "light");
      await expect(other.locator("html")).toHaveAttribute("data-density", "compact");
      await page.reload();
      await expect(html).toHaveAttribute("data-density", "compact");
      await page.getByRole("button", { name: "Theme" }).click();
      await expect(page.getByRole("menu").locator(".menu-choice:has(svg)")).toHaveText([
        "Light",
        "Compact",
      ]);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-theme-menu-compact.png") });
      await page.keyboard.press("Escape");

      await page.goto("/account/appearance");
      const density = page.getByRole("group", { name: "Density" });
      await expect(density.getByRole("button", { name: "Compact" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(density.getByRole("button", { name: "Comfortable" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    },
  );
});

test.describe("the rail's toggle", { tag: "@full" }, () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("expands the rail to show its labels, kept over a reload, and collapses it again", async ({
    page,
  }) => {
    await page.goto("/now");
    const rail = page.getByRole("navigation", { name: "Surfaces" });
    const labels = ["Now", "Work", "Projects", "People", "Stats", "Live view", "Settings", "Theme"];
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
  defaultEffort: null,
  claudeCodeP: false,
});

/**
 * The engines as Settings › Engines lists them, and their windows as they were first read; `pinned`
 * holds any more of Now the test keeps fixed, such as Needs you, which other tests' work changes.
 */
async function stubEngines(
  page: Page,
  engines: readonly Engine[],
  usageWindows: Now["usageWindows"],
  pinned: Partial<Now> = {},
): Promise<void> {
  const fixed: Partial<Now> = { ...pinned, usageWindows };
  await page.route(/\/api\/settings\/engines$/, async (route) => {
    const settings = (await (await route.fetch()).json()) as EngineSettings;
    await route.fulfill({ json: { ...settings, engines } });
  });
  await page.route(/\/api\/now$/, async (route) => {
    const now = (await (await route.fetch()).json()) as Now;
    await route.fulfill({ json: { ...now, ...fixed } });
  });
  // Now also comes whole in each `now.changed`, which another test's work can send at any time.
  await page.routeWebSocket(/\/api\/events$/, (stream) => {
    const service = stream.connectToServer();
    service.onMessage((message) => {
      stream.send(typeof message === "string" ? withNow(message, fixed) : message);
    });
  });
}

/** An event stream message, with its `now.changed`'s Now given these fixed parts. */
function withNow(message: string, fixed: Partial<Now>): string {
  const sent = JSON.parse(message) as { type?: string; event?: { type?: string; now?: Now } };
  if (sent.type !== "event" || sent.event?.type !== "now.changed" || !sent.event.now) {
    return message;
  }
  const now = { ...sent.event.now, ...fixed };
  return JSON.stringify({ ...sent, event: { ...sent.event, now } });
}

test.describe("the usage figure", { tag: "@full" }, () => {
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
    defaultEffort: null,
    baseUrl: "https://models.example.test/v1",
    keySet: true,
    models: [{ id: "a-model", contextWindow: 100_000, seesImages: false }],
  };
  const windowsOf = (engineId: string, fiveHour: number): Now["usageWindows"][number] => ({
    engineId,
    fiveHour: { percentUsed: fiveHour, resetsAt: RESETS_AT },
    sevenDay: { percentUsed: 17, resetsAt: RESETS_AT },
  });

  test("one engine shows its 5-hour window with the meter, the reset and the 7-day window, and opens the list", async ({
    page,
  }) => {
    await stubEngines(
      page,
      [claudeCode("home", "Home account"), API_ENGINE],
      [windowsOf("home", 42)],
    );
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    const figure = strip.getByRole("button", { name: "5-hour window: Home account 42%" });

    await expect(figure.getByText("5-hour window", { exact: true })).toBeVisible();
    await expect(figure.getByText(/^· resets \d\d:\d\d$/)).toBeVisible();
    await expect(figure.locator("b")).toHaveText("42%");
    await expect(figure.getByText("7d 17%", { exact: true })).toBeVisible();
    await expect(figure.locator(".shell-strip-meter")).toBeVisible();
    await expect(figure.locator("b")).toHaveAttribute("data-tone", "calm");

    await page.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-one-engine.png") });

    await figure.click();
    const list = page.getByRole("dialog", { name: "Usage by engine" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Home account");
  });

  test("the 5-hour window turns amber from 90% and red once used up, saying until when", async ({
    page,
  }) => {
    await stubEngines(page, [claudeCode("home", "Home account")], [windowsOf("home", 91)]);
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    const figure = strip.getByRole("button", { name: /^5-hour window: / });

    await expect(figure.locator("b")).toHaveAttribute("data-tone", "nearly-used");
    await expect(figure.locator(".shell-strip-meter")).toHaveAttribute("data-tone", "nearly-used");
    await strip.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-nearly-used.png") });

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await stubEngines(page, [claudeCode("home", "Home account")], [windowsOf("home", 100)]);
    await page.reload();
    await expect(figure.locator("b")).toHaveAttribute("data-tone", "used-up");
    await expect(figure.getByText(/^· used up until \d\d:\d\d$/)).toBeVisible();
    await strip.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-used-up.png") });
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

    await expect(figure.getByText("· 3 engines", { exact: true })).toBeVisible();
    await expect(figure.locator("b")).toHaveText(["42%", "80%", "12%"]);
    await expect(figure.getByTitle("Work account")).toHaveText("80%");
    await expect(figure.locator(".shell-strip-meter")).toHaveCount(3);

    const list = page.getByRole("dialog", { name: "Usage by engine" });
    await figure.click();
    const engines = list.getByRole("listitem");
    await expect(engines).toHaveCount(3);
    await expect(engines.nth(0)).toContainText("Home account");
    await expect(engines.nth(0)).toContainText(/^Home account5h42%resets .+7d17%resets /);
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

    const figure = strip.getByRole("button", { name: /5-hour window/ });
    await expect(figure.getByText("· 5 engines", { exact: true })).toBeVisible();
    await expect(figure.locator("b")).toHaveText("80%");
    await expect(figure.getByText("highest", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "usage-figure-five-engines.png") });
  });
});

test.describe("the status strip on a phone", () => {
  test.use({ colorScheme: "light", viewport: { width: 390, height: 844 } });

  // A read still in a route when a test ends would fail it: its response is gone by then.
  test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

  const RESETS_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  /** Raised before Notifications had a short line, so the slot shows its whole line, cut. */
  const LONG_NOTIFICATION: Notification = {
    id: randomUUID(),
    kind: "office.down.engine",
    roleKey: null,
    line: "Home account is down: connection refused (ECONNREFUSED 127.0.0.1:8443) while starting its session.",
    pointsTo: { kind: "office", engineId: "home" },
    channels: ["in-app"],
    held: [],
    raisedAt: new Date().toISOString(),
  };

  test("keeps the five figures whole and in view, and a long Office Notification moves none of them", async ({
    page,
  }) => {
    let open: Notification[] = [];
    await page.route(/\/api\/notifications$/, (route) => route.fulfill({ json: open }));
    // Fixed too, as other tests' work comes and goes in Activity.
    await page.route(/\/api\/activity$/, (route) =>
      route.fulfill({ json: { items: [], count: 12 } }),
    );
    await stubEngines(
      page,
      [claudeCode("home", "Home account")],
      [
        {
          engineId: "home",
          fiveHour: { percentUsed: 91, resetsAt: RESETS_AT },
          sevenDay: { percentUsed: 41, resetsAt: RESETS_AT },
        },
      ],
      // Fixed, as other tests' work and Office limits would resize the figures between reads.
      {
        needsYou: [],
        desks: { inUse: 0, limit: 3 },
        tokensToday: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      },
    );
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    // Each figure by its short label, as a strip under 600px wide shows them.
    const figures = new Map([
      ["Needs you", strip.getByRole("button", { name: /^\d+ needs? you/ })],
      ["5h window", strip.getByRole("button", { name: /^5-hour window: / })],
      ["Desks", strip.getByTitle(/ desks in use$/)],
      ["Activity", strip.getByRole("button", { name: /^Activity: / })],
      ["Tokens", strip.locator(".shell-strip-figure").filter({ hasText: "Tokens" })],
    ]);
    const boxes = async () =>
      Promise.all([...figures.values()].map(async (figure) => figure.boundingBox()));

    // Two rows, 94px in all: the five figures alone on the first, with short labels.
    await expect.poll(async () => (await strip.boundingBox())?.height).toBe(94);
    for (const [label, figure] of figures) {
      await expect(figure).toBeInViewport({ ratio: 1 });
      await expect(figure.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(strip.getByRole("button", { name: /^5-hour window: / }).locator("b")).toHaveText(
      "91%",
    );
    const stripBox = await strip.boundingBox();
    const before = await boxes();
    for (const box of before) {
      expect(box && stripBox && box.x + box.width <= stripBox.x + stripBox.width).toBe(true);
    }
    await strip.screenshot({ path: path.join(SCREENSHOTS, "light-390-strip.png") });

    open = [LONG_NOTIFICATION];
    await page.reload();
    const slot = strip.getByRole("button", { name: /^Office Notifications: Home account is down/ });
    await expect(slot).toBeVisible();
    // Polled, as the figures settle while the page loads again.
    await expect.poll(boxes).toEqual(before);
    // Cut on the slot, whole in its list.
    await slot.click();
    await expect(page.getByRole("dialog", { name: /^Office Notifications/ })).toContainText(
      LONG_NOTIFICATION.line,
    );
    await strip.screenshot({
      path: path.join(SCREENSHOTS, "light-390-strip-long-notification.png"),
    });
  });
});

test.describe("the Workstation figure", { tag: "@full" }, () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("shows the CPU use and cores, measured from the next read, and opens the panel", async ({
    page,
  }) => {
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    const figure = strip.getByRole("button", { name: /^Workstation: / });

    // The service measures over the time since its last read, which the next 2 s poll gives.
    await expect(figure).toHaveAccessibleName(/^Workstation: \d+% CPU, \d+ cores?$/);
    await expect(figure.getByText("Workstation", { exact: true })).toBeVisible();
    await expect(figure.locator(".shell-strip-cores")).toHaveText(/^· \d+ cores?$/);
    await expect(figure.locator(".shell-strip-cores")).toBeVisible();

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

    // On a narrower strip it leaves its cores to the panel, and its label becomes "CPU".
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(figure.locator("b")).toHaveText(/^\d+%$/);
    await expect(figure.locator("b")).toBeVisible();
    await expect(figure.locator(".shell-strip-cores")).toBeHidden();
    await expect(figure.getByText("CPU", { exact: true })).toBeVisible();
  });

  test.describe("in Dark on a phone", () => {
    test.use({ colorScheme: "dark", viewport: { width: 390, height: 844 } });

    test("the panel fits the page and nothing in it scrolls sideways", async ({ page }) => {
      await page.goto("/now");
      const figure = page
        .getByRole("status", { name: "Status strip" })
        .getByRole("button", { name: /^Workstation: \d+% CPU/ });

      await figure.click();
      const panel = page.getByRole("dialog", { name: "Workstation" });
      await expect(panel.getByRole("list", { name: "Use per core" })).toBeVisible();
      await expect(panel).toBeInViewport({ ratio: 1 });
      // What could scroll sideways: the page, the panel and any part of it that scrolls.
      const scrollingSideways = await panel.evaluate(
        (element) =>
          [document.documentElement, element, ...element.querySelectorAll("*")].filter(
            (part) =>
              (part === document.documentElement ||
                part === element ||
                ["auto", "scroll"].includes(getComputedStyle(part).overflowX)) &&
              part.scrollWidth > part.clientWidth,
          ).length,
      );
      expect(scrollingSideways).toBe(0);
      await page.screenshot({ path: path.join(SCREENSHOTS, "workstation-panel-dark-phone.png") });
    });
  });
});

test.describe("losing the service", { tag: "@full" }, () => {
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
    await expect(strip).toContainText("Tokens today");
    const titleBefore = await page.title();

    reachable = false;
    for (const stream of streams) await stream.close();

    const notice = page
      .locator(".toasts")
      .getByRole("button", { name: "The Office lost its service and is reconnecting." });
    await expect(strip).toContainText("Reconnecting to The Office…");
    await expect(notice).toBeVisible();
    // An Office kind doesn't count in the tab, which counts Needs you alone.
    await expect(page).toHaveTitle(titleBefore);

    reachable = true;
    await expect(strip).not.toContainText("Reconnecting");
    await expect(notice).toHaveCount(0);
    // Reconnecting reads the Roles again: a read still in flight as the test ends would fail the next.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

test("the pages break none of their Content Security Policy, zod's eval check included", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(`Content Security Policy: ${event.violatedDirective} ${event.blockedURI}`),
    ),
  );

  await page.goto("/work");

  await expect(page.getByRole("status", { name: "Status strip" })).toContainText("Tokens today");
  expect(violations).toEqual([]);
});

test.describe("an Office update while a tab is open", { tag: "@full" }, () => {
  test.use({ colorScheme: "light" });

  test("the tab says so once it reconnects to the new build, and a reload runs the new one", async ({
    page,
  }) => {
    // The event stream stands for the service: after the "update" it names another build.
    let updated = false;
    const streams: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/api\/events$/, (stream) => {
      const server = stream.connectToServer();
      server.onMessage((message) => {
        const reply = typeof message === "string" ? (JSON.parse(message) as unknown) : undefined;
        if (!updated || !isUnscopedSubscriptions(reply)) return void stream.send(message);
        stream.send(JSON.stringify({ ...reply, webAppBuild: `${reply.webAppBuild}-next` }));
      });
      streams.push(stream);
    });
    await page.goto("/now");
    const strip = page.getByRole("status", { name: "Status strip" });
    await expect(strip).toContainText("Tokens today");
    await expect(strip).not.toContainText("The Office was updated");

    updated = true;
    for (const stream of streams.splice(0)) await stream.close();

    await expect(strip).toContainText("The Office was updated");
    await strip
      .getByRole("button", { name: /^Office Notifications: The Office was updated/ })
      .click();
    await page.getByRole("button", { name: "Reload the page" }).click();
    await expect(strip).toContainText("Tokens today");
    await expect(strip).not.toContainText("The Office was updated");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

/** A reply to a subscription without a scope that names the web app's build. */
function isUnscopedSubscriptions(
  message: unknown,
): message is { readonly type: "subscriptions"; readonly webAppBuild: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "subscriptions" &&
    !("threadId" in message) &&
    "webAppBuild" in message &&
    typeof message.webAppBuild === "string"
  );
}

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

test.describe("Notifications as the service sends them", { tag: "@full" }, () => {
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
    await expect(page.getByRole("status", { name: "Status strip" })).toContainText("Tokens today");
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

test.describe("Waiting for you", { tag: "@full" }, () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  test("a chat Proposal waits under Needs you, counted apart in the strip, and opens its Thread at its card", async ({
    page,
  }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await shellProject(page, repository);
      const { card: caretaker } = roleSchema.parse(
        await (await page.request.get("/api/roles/caretaker")).json(),
      );
      const started = await page.request.post("/api/chats/caretaker/threads");
      expect(started.status()).toBe(201);
      const { id: threadId } = threadSchema.parse(await started.json());
      // A title no preset has and no other test proposes, so the drawer's card is this one.
      const title = `Waiting ${Date.now()}`;
      const proposalId = await seedChatProposal(threadId, {
        kind: "hire",
        card: roleCardSchema.omit({ skills: true }).parse({ ...caretaker, name: "Wim", title }),
        skills: [],
      });

      try {
        await page.goto("/now");
        // Only this Project's Decisions and Gates; a chat Proposal is Office-wide, so it still shows.
        await page.getByRole("button", { name: /^Project filter:/ }).click();
        await page.getByRole("button", { name: `Show only ${project.name}`, exact: true }).click();
        await page.keyboard.press("Escape");

        const needsYou = page.getByRole("region", { name: "Needs you" });
        const waiting = needsYou.getByRole("region", { name: "Waiting for you" });
        // Other files' open chat Proposals wait too, each Office-wide; this one is the newest.
        const card = waiting
          .getByRole("article", { name: `Proposal: Drafted by ${caretaker.name}` })
          .last();
        await expect(card).toBeVisible();
        await expect(card.getByText("Proposal", { exact: true })).toBeVisible();

        // The strip counts it apart: the main count stays this Project's Decisions and Gates.
        const strip = page.getByRole("status", { name: "Status strip" });
        const figure = strip.getByRole("button", { name: /needs? you/ });
        await expect(figure).toHaveAccessibleName(
          /^0 need you(, \d+ more in other Projects)?, \d+ waiting for you$/,
        );
        await expect(figure).toContainText(/· \d+ waiting/);
        await expect(figure).not.toHaveClass(/\balert\b/);
        await expect(figure.locator(".live-dot")).toHaveCount(0);
        await screenshotScenario(page, "now-waiting-for-you", { inView: waiting });

        await figure.click();
        const panel = page
          .getByRole("dialog")
          .filter({ has: page.getByRole("heading", { name: "Needs you", exact: true }) });
        await expect(panel.getByRole("region", { name: "Waiting for you" })).toBeVisible();
        await screenshotScenario(page, "needs-you-panel-waiting-for-you", {
          inView: panel.getByRole("region", { name: "Waiting for you" }),
        });
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);

        await card.getByRole("button", { name: `Drafted by ${caretaker.name}` }).click();
        const chat = page.getByRole("complementary", { name: `Chat with ${caretaker.name}` });
        const proposal = chat.getByRole("region", { name: `Proposal: New Role · Wim · ${title}` });
        await expect(proposal).toHaveAttribute("aria-current", "true");
        await expect(proposal).toHaveClass(/\blinked-to\b/);
        await expect(proposal).toBeInViewport();
      } finally {
        // Declined, so other files' Now no longer lists it.
        const declined = await page.request.post(`/api/proposals/${proposalId}/decline`);
        expect(declined.ok()).toBe(true);
      }
    } finally {
      await repository.remove();
    }
  });
});

/** What the service fingerprints for "Drop an Idea": the Idea's state, as the handler decides by it. */
function dropFingerprint(ideaId: string): string {
  const source = {
    decidedBy: { state: "new" },
    subject: { id: ideaId, kind: "idea" },
    writtenNow: {},
  };
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

async function seedDropProposal(
  page: Page,
  fingerprint: (ideaId: string) => string,
): Promise<{ ideaId: string; title: string }> {
  const title = `Idea to drop ${Date.now()}`;
  const created = await page.request.post("/api/ideas", {
    data: { title, notes: "", projectId: null },
  });
  expect(created.status()).toBe(201);
  const { id: ideaId } = (await created.json()) as { id: string };
  const started = await page.request.post("/api/chats/caretaker/threads");
  const { id: threadId } = threadSchema.parse(await started.json());
  await seedChatProposal(threadId, {
    kind: "office-action",
    action: "drop_idea",
    title: "Drop an Idea",
    input: { ideaId },
    subject: { kind: "idea", id: ideaId, title },
    fields: [{ label: "State", before: "New", after: "Dropped", form: "short" }],
    fingerprint: fingerprint(ideaId),
    outOfDate: false,
  });
  await page.goto(`/now?chat=caretaker&thread=${threadId}`);
  return { ideaId, title };
}

test.describe("A Proposal of an Office action", { tag: "@full" }, () => {
  test("is applied with one click, as the user, from its card", async ({ page }) => {
    const { ideaId, title } = await seedDropProposal(page, dropFingerprint);
    const card = page.getByRole("region", { name: "Proposal: Drop an Idea" });
    await expect(card.getByRole("link", { name: title })).toBeVisible();
    await expect(card).toContainText("State");
    await screenshotScenario(page, "office-action-proposal-card");

    await card.getByRole("button", { name: "Apply change" }).click();

    await expect(card).toContainText("Applied");
    const idea = (await (await page.request.get(`/api/ideas/${ideaId}`)).json()) as {
      state: string;
    };
    expect(idea.state).toBe("dropped");
  });

  test("reads Out of date once its subject changed, and only Not now is left", async ({ page }) => {
    const { ideaId } = await seedDropProposal(page, () => "drafted-before-it-changed");
    const card = page.getByRole("region", { name: "Proposal: Drop an Idea" });

    await card.getByRole("button", { name: "Apply change" }).click();

    await expect(card.getByText("Out of date")).toBeVisible();
    await expect(card.getByRole("button", { name: "Apply change" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Not now" })).toBeVisible();
    await screenshotScenario(page, "office-action-proposal-out-of-date");
    const idea = (await (await page.request.get(`/api/ideas/${ideaId}`)).json()) as {
      state: string;
    };
    expect(idea.state).toBe("new");
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toContainText("Not applied");
  });
});

/**
 * A Proposal the Caretaker drafted in their chat, with its card in the Thread, as the Conversations
 * service leaves one: only an Agent's session drafts a Proposal.
 */
async function seedChatProposal(
  threadId: string,
  change: Record<string, unknown>,
): Promise<string> {
  const proposalId = randomUUID();
  await queryOfficeDatabase(
    `insert into proposals (id, thread_id, drafted_by, drafted_at, change, status)
     values ($1, $2, 'caretaker', now(), $3, 'open')`,
    [proposalId, threadId, change],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [randomUUID(), threadId, { kind: "proposal", roleKey: "caretaker", proposalId }],
  );
  return proposalId;
}

async function shellProject(page: Page, repository: TemporaryRepository): Promise<Project> {
  const quick = { commandLine: "node --version", rerunCommandLine: "" };
  const newProject: NewProject = {
    name: `Shell ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "SH", colour: "teal" },
    installCommand: "node --version",
    commands: [
      { key: "build", name: "Build", kind: "build", ...quick },
      { key: "lint", name: "Lint", kind: "lint", ...quick },
      { key: "test", name: "Test", kind: "test", ...quick },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}
