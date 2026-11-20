import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { projectSchema, taskSchema, type NewProject, type Task } from "@the-office/contracts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

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

  test("goes between Tokens and cost and System health, whose last hour needs no Grafana", async ({
    page,
  }) => {
    await page.goto("/stats");
    // Stats' own tabs, not a range's segmented control on their row.
    const tabs = page.locator(".stats-tabs > [role='tablist']");
    await expect(tabs.getByRole("tab", { name: "Tokens and cost" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".shell-top-crumb")).toHaveText("Tokens and cost");

    await tabs.getByRole("tab", { name: "System health" }).click();
    await expect(page).toHaveURL(/\/stats\/system-health$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Stats");
    await expect(page.locator(".shell-top-crumb")).toHaveText("System health");
    // The rail keeps one Stats item, current on either tab.
    await expect(
      page
        .getByRole("navigation", { name: "Surfaces" })
        .getByRole("link", { name: "Stats", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    // Telemetry is Off in the e2e Office, yet the last hour comes from The Office's own readings.
    for (const name of ["Load now", "Responsiveness", "CPU and memory", "Requests", "Database"]) {
      const block = page.getByRole("region", { name, exact: true });
      await expect(block).toBeVisible();
      await expect(block.getByText("Office-wide", { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/^From The Office's own Health readings/)).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Load now", exact: true }).getByText("Sessions running"),
    ).toBeVisible();
    // The Office answered this page's own requests, so its routes are listed.
    const requests = page.getByRole("region", { name: "Requests", exact: true });
    await expect(requests.getByText("Slowest routes")).toBeVisible();
    await expect(requests.getByRole("table")).toBeVisible();

    // The longer ranges read Grafana, which is off: they say so and lead back to the last hour.
    await page.getByRole("group", { name: "Range" }).getByRole("tab", { name: "24 h" }).click();
    await expect(page).toHaveURL(/\/stats\/system-health\?range=24h$/);
    const longer = page.getByRole("region", { name: "The longer ranges", exact: true });
    await expect(longer).toContainText("Turn on Grafana in Settings › Telemetry to see more.");
    await longer.getByRole("button", { name: "Show the last hour" }).click();
    await expect(page).toHaveURL(/\/stats\/system-health$/);
    await expect(page.getByRole("region", { name: "Responsiveness", exact: true })).toBeVisible();

    await tabs.getByRole("tab", { name: "Tokens and cost" }).click();
    await expect(page).toHaveURL(/\/stats$/);
    await expect(page.getByRole("region", { name: "Tokens per day", exact: true })).toBeVisible();
  });
});

// The e2e Office's own engine's id, which has Usage windows.
const OWN_ENGINE_ID = "claude-code";

const HOUR_MS = 60 * 60 * 1000;

/** An instant `hours` before now, as the scripted Grafana takes it. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

/** Sets what the scripted Grafana holds for the full stats, replacing all it held. */
async function scriptGrafana(page: Page, stats: Record<string, unknown>): Promise<void> {
  const response = await page.request.post("/api/e2e/stats-source", { data: stats });
  expect(response.status()).toBe(204);
}

async function chooseTelemetry(page: Page, kind: "off" | "bundled-grafana"): Promise<void> {
  const response = await page.request.put("/api/settings/telemetry", { data: { kind } });
  expect(response.ok()).toBe(true);
}

/** The scripted Grafana's data: tokens and cost over two models, a Task's two runs, the windows. */
function grafanaHolding(task: Task): Record<string, unknown> {
  const spend = (hours: readonly number[], value: number) =>
    hours.map((hour) => ({ at: hoursAgo(hour), value }));
  return {
    usage: {
      tokens: [
        { name: "claude-sonnet-5-5", points: spend([2, 30, 80], 1_200_000) },
        { name: "claude-haiku-5-5", points: spend([3, 50], 400_000) },
      ],
      estimatedCostUsd: [
        { name: "claude-sonnet-5-5", points: spend([2, 30, 80], 9.5) },
        { name: "claude-haiku-5-5", points: spend([3, 50], 0.8) },
      ],
    },
    costliest: {
      tasks: [
        {
          taskId: task.id,
          tokens: 2_000_000,
          estimatedCostUsd: 12.4,
          runs: [
            {
              stageName: "Implement",
              stageRun: "e2e-stats-run-1",
              firstAt: hoursAgo(30),
              tokens: 1_200_000,
              estimatedCostUsd: 7.1,
            },
            {
              stageName: "Implement",
              stageRun: "e2e-stats-run-2",
              firstAt: hoursAgo(5),
              tokens: 800_000,
              estimatedCostUsd: 5.3,
            },
          ],
        },
      ],
      initiatives: [],
    },
    windows: [
      {
        engineId: OWN_ENGINE_ID,
        window: "five_hour",
        points: Array.from({ length: 48 }, (_, index) => ({
          at: hoursAgo(48 - index),
          value: (index % 10) * 9,
        })),
      },
      {
        engineId: OWN_ENGINE_ID,
        window: "seven_day",
        points: Array.from({ length: 48 }, (_, index) => ({
          at: hoursAgo(48 - index),
          value: 20 + index,
        })),
      },
    ],
  };
}

/** A Project on a new repository with one Task, for the scripted Grafana to name. */
async function projectWithTask(
  request: APIRequestContext,
  name: string,
  label: string,
  title: string,
): Promise<{ readonly repository: TemporaryRepository; readonly task: Task }> {
  const repository = await createTemporaryRepository();
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "teal" },
    installCommand: "npm ci",
    commands: [
      { key: "build", name: "Build", kind: "build", commandLine: "npm run build" },
      { key: "lint", name: "Lint", kind: "lint", commandLine: "npm run lint" },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await request.post("/api/projects", { data: newProject });
  expect(added.status(), await added.text()).toBe(201);
  const project = projectSchema.parse(await added.json());
  const created = await request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  expect(created.status()).toBe(201);
  return { repository, task: taskSchema.parse(await created.json()) };
}

/** Waits until Stats' full stats answer in `state`. */
async function fullStatsAre(page: Page, state: string): Promise<void> {
  await expect
    .poll(async () => {
      const answer = await page.request.get("/api/stats/full");
      return ((await answer.json()) as { state: string }).state;
    })
    .toBe(state);
}

test.describe("the full stats from the bundled Grafana", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  let repository: TemporaryRepository;
  let task: Task;

  test.beforeAll(async ({ request }) => {
    ({ repository, task } = await projectWithTask(
      request,
      "Stats full",
      "SF",
      "Price the full stats",
    ));
  });

  test.afterAll(async ({ request }) => {
    await request.put("/api/settings/telemetry", { data: { kind: "off" } });
    await request.post("/api/e2e/stats-source", { data: {} });
    await repository.remove();
  });

  test("shows the full stats once Grafana answers, by the range and split picked", async ({
    page,
  }) => {
    // Eighteen screenshots of a page that other files' workers slow down.
    test.setTimeout(120_000);
    await scriptGrafana(page, grafanaHolding(task));
    await chooseTelemetry(page, "bundled-grafana");
    await fullStatsAre(page, "full");

    await page.goto("/stats");
    const usage = page.getByRole("region", {
      name: "Tokens and estimated cost over time",
      exact: true,
    });
    const costliest = page.getByRole("region", { name: "The most expensive", exact: true });
    const windows = page.getByRole("region", { name: "Usage windows over time", exact: true });
    for (const block of [usage, costliest, windows]) await expect(block).toBeVisible();
    await expect(
      page.getByText(
        "The full stats cover what The Office has sent Grafana since it started sending it.",
      ),
    ).toBeVisible();
    // Tokens per day and the top Tasks give way to their full versions.
    await expect(page.getByRole("region", { name: "Tokens per day", exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Usage windows now", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "This week", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "The full stats", exact: true })).toHaveCount(0);

    await expect(usage).toContainText(/estimated\s*·\s*7 days/);
    await expect(usage).toContainText("claude-sonnet-5-5");
    await expect(usage.getByRole("img")).toBeVisible();

    // The split asks Grafana again, and the range is kept in the address.
    const byRole = page.waitForRequest((request) => request.url().includes("split=role"));
    await usage
      .getByRole("group", { name: "Split by" })
      .getByRole("tab", { name: "Role", exact: true })
      .click();
    await byRole;
    const over30Days = page.waitForRequest((request) => request.url().includes("range=30d"));
    await page
      .getByRole("group", { name: "Range" })
      .getByRole("tab", { name: "30 d", exact: true })
      .click();
    await over30Days;
    await expect(page).toHaveURL(/\/stats\?range=30d$/);
    await expect(usage).toContainText(/estimated\s*·\s*30 days/);
    await usage.getByRole("button", { name: "Show as a table" }).click();
    await expect(usage.getByRole("table")).toBeVisible();
    await usage.getByRole("button", { name: "Show as a chart" }).click();

    // The Task's cost per Stage, its retry worded as one.
    const fold = costliest.getByRole("button", { name: "Cost per Stage: Price the full stats" });
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(costliest.getByText("Run 1 · $7.10", { exact: true })).toBeVisible();
    await expect(costliest.getByText("Run 2 · retry · $5.30", { exact: true })).toBeVisible();
    await expect(costliest).toContainText("Retries: $5.30, 43%");

    // The own engine's windows, and the lane of what ran on it: Office-wide, so other files'
    // Stage runs may be in it.
    await expect(windows.getByText("Office-wide", { exact: true })).toBeVisible();
    await expect(windows.getByText("What was running on Claude Code")).toBeVisible();
    await expect(windows.getByRole("img")).toBeVisible();
    await expect(
      windows
        .locator(".stats-lane-bar")
        .first()
        .or(windows.getByText("Nothing ran on Claude Code in the last 30 days.")),
    ).toBeVisible();

    await screenshotScenario(page, "stats-full");
    await screenshotScenario(page, "stats-full-costliest", { inView: costliest });
    await screenshotScenario(page, "stats-full-windows", { inView: windows });

    await costliest.getByRole("link", { name: "Price the full stats", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  });

  test("a line chart's tooltip shows the values of the point hovered and follows the pointer", async ({
    page,
  }) => {
    await scriptGrafana(page, grafanaHolding(task));
    await chooseTelemetry(page, "bundled-grafana");
    await fullStatsAre(page, "full");
    await page.goto("/stats");
    const windows = page.getByRole("region", { name: "Usage windows over time", exact: true });
    const plot = windows.locator(".stats-lines-plot").first();
    await plot.scrollIntoViewIfNeeded();
    const box = await plot.boundingBox();
    if (box === null) throw new Error("The Usage windows chart has no box.");
    const tooltip = page.getByRole("tooltip");

    /** Hovers the plot at `share` of its width, answering the tooltip's words and its centre. */
    const hoverAt = async (share: number): Promise<{ words: string; centre: number }> => {
      const pointerX = box.x + box.width * share;
      await page.mouse.move(pointerX, box.y + box.height / 2);
      await expect(tooltip).toBeVisible();
      // The scripted points are an hour apart, so the nearest one is within a few pixels.
      await expect
        .poll(async () => {
          const shown = await tooltip.boundingBox();
          return shown === null ? Infinity : Math.abs(shown.x + shown.width / 2 - pointerX);
        })
        .toBeLessThan(12);
      const shown = await tooltip.boundingBox();
      return {
        words: await tooltip.innerText(),
        centre: (shown?.x ?? 0) + (shown?.width ?? 0) / 2,
      };
    };

    // The scripted windows cover the last 48 hours of the 7 days, at the plot's right.
    const earlier = await hoverAt(0.75);
    const later = await hoverAt(0.9);

    expect(earlier.words).toMatch(/%/);
    expect(later.words).not.toBe(earlier.words);
    expect(later.centre - earlier.centre).toBeGreaterThan(box.width * 0.1);
  });

  test("says when Grafana can't be reached, with Try again, the basic stats staying", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await scriptGrafana(page, {
      failure: { kind: "unreachable", problem: "No answer within 10 seconds." },
    });
    await page.goto("/stats");

    await expect(page.getByText(/^Couldn't reach Grafana at /)).toBeVisible();
    await expect(page.getByText("No answer within 10 seconds.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Tokens per day", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "This week", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "The full stats", exact: true })).toHaveCount(0);
    await screenshotScenario(page, "stats-unreachable");

    const again = page.waitForRequest((request) => request.url().includes("/api/stats/full"));
    await page.getByRole("button", { name: "Try again" }).click();
    await again;
    await expect(page.getByRole("link", { name: "Settings › Telemetry" })).toBeVisible();
  });
});

const READ_ADDRESS = "https://grafana.example.com";

test.describe("the full stats from your own Grafana", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  let repository: TemporaryRepository;
  let task: Task;

  test.beforeAll(async ({ request }) => {
    ({ repository, task } = await projectWithTask(
      request,
      "Stats own",
      "SO",
      "Price your own Grafana",
    ));
  });

  test.afterAll(async ({ request }) => {
    await request.put("/api/settings/telemetry", { data: { kind: "off" } });
    await request.post("/api/e2e/stats-source", { data: {} });
    await repository.remove();
  });

  test("gives Settings › Telemetry a read address and token, tests and saves them, and Stats shows the full stats", async ({
    page,
  }) => {
    // Six screenshots of a page that other files' workers slow down.
    test.setTimeout(120_000);
    await chooseTelemetry(page, "off");
    await scriptGrafana(page, grafanaHolding(task));
    await page.goto("/settings/telemetry");
    const card = page.getByRole("form", { name: "Telemetry" });
    await card.getByRole("radio", { name: "Your own endpoint, over OTLP/HTTP" }).check();
    await card.getByLabel("Endpoint URL").fill("https://otlp.example.com");

    const stats = card.getByRole("group", { name: "Stats", exact: true });
    await expect(stats).toBeVisible();
    const testButton = stats.getByRole("button", { name: "Test", exact: true });
    await expect(testButton).toBeDisabled();
    await expect(testButton).toHaveAttribute("title", "Give the Grafana read address to test it.");
    await stats.getByLabel("Grafana read address").fill(READ_ADDRESS);
    await stats.getByLabel("Read token", { exact: true }).fill("glsa_e2e-read-token");
    await expect(card).toContainText(
      "Stats' read address and token apply as soon as they're saved.",
    );

    await testButton.click();
    await expect(stats.getByText(`Grafana answered at ${READ_ADDRESS}.`)).toBeVisible();
    await expect(stats.getByText("Found Prometheus “Prometheus” and Loki “Loki”.")).toBeVisible();
    await screenshotScenario(page, "telemetry-own-grafana", { inView: stats });

    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/settings/telemetry") && response.request().method() === "PUT",
    );
    await card.getByRole("button", { name: "Save", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    // The token never comes back: its field shows it saved.
    await expect(stats.getByLabel("Read token", { exact: true })).toHaveAttribute(
      "placeholder",
      "Saved",
    );
    await expect(stats.getByLabel("Read token", { exact: true })).toHaveValue("");
    await expect(stats.getByLabel("Grafana read address")).toHaveValue(READ_ADDRESS);
    await expect(stats.getByRole("button", { name: "Remove", exact: true })).toBeVisible();

    // The read address applies at once, with no restart.
    await fullStatsAre(page, "full");
    await page.goto("/stats");
    const usage = page.getByRole("region", {
      name: "Tokens and estimated cost over time",
      exact: true,
    });
    await expect(usage).toBeVisible();
    await expect(usage).toContainText("claude-sonnet-5-5");
    await expect(
      page.getByRole("region", { name: "The most expensive", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "The full stats", exact: true })).toHaveCount(0);
  });

  test("says when your Grafana refuses the read token, leading to Settings › Telemetry", async ({
    page,
  }) => {
    await scriptGrafana(page, { failure: { kind: "rejected" } });
    await fullStatsAre(page, "rejected");
    await page.goto("/stats");

    await expect(page.getByText("Grafana refused the read token")).toBeVisible();
    await expect(
      page.getByText(`Grafana at ${READ_ADDRESS} answered 401.`, { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Tokens per day", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Settings › Telemetry" }).click();
    await expect(page).toHaveURL(/\/settings\/telemetry$/);
    await expect(
      page.getByRole("group", { name: "Stats", exact: true }).getByLabel("Grafana read address"),
    ).toHaveValue(READ_ADDRESS);
  });
});
