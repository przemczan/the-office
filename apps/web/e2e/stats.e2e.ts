import { expect, test, type Page } from "@playwright/test";
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

test.describe("the full stats from the bundled Grafana", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

  let repository: TemporaryRepository;
  let task: Task;

  test.beforeAll(async ({ request }) => {
    repository = await createTemporaryRepository();
    const newProject: NewProject = {
      name: "Stats full",
      path: repository.path,
      baseBranch: "main",
      mark: { label: "SF", colour: "teal" },
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
      data: { title: "Price the full stats", projectId: project.id, priority: "normal" },
    });
    expect(created.status()).toBe(201);
    task = taskSchema.parse(await created.json());
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
    await expect
      .poll(async () => {
        const answer = await page.request.get("/api/stats/full");
        return ((await answer.json()) as { state: string }).state;
      })
      .toBe("full");

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
