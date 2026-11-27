import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  engineSettingsSchema,
  ideaSchema,
  initiativeSchema,
  nowSchema,
  PROJECT_LIMIT_MAX,
  projectSchema,
  taskSchema,
  type AddProject,
  type ApiEngine,
  type Initiative,
  type Project,
  type StartAnswer,
  type StartCheck,
  type Task,
  type TaskUsageEstimateList,
  type UsageEstimate,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

// Runs alone, after every other file (playwright.config.ts): the queue is the Office's one, so the
// Tasks seeded into it here would otherwise start or leave at another file's release.

const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");
const ONLY_DESK = "The Office-wide limit is reached: the only desk is in use.";
const ONLY_DESK_SHORT = "Office-wide limit reached (1)";
const CAP_WAIT =
  "The Claude Code engine's 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 6% of this Task. It resets at 12:00.";
const CAP_WAIT_SHORT = "5-hour window cap (90%) · resets 12:00";

/** An API engine the Usage estimate test lists in the browser only. */
const LOCAL_MODELS: ApiEngine = {
  id: "local-models",
  name: "Local models",
  kind: "openai-compatible-api",
  defaultModel: "coder:q4",
  defaultEffort: null,
  baseUrl: "http://127.0.0.1:8090/v1",
  keySet: false,
  models: [{ id: "coder:q4", contextWindow: 100_000, seesImages: false }],
};

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async ({ request }) => {
  // Off again should the fire alarm's test stop midway, every Task it paused held, none walking.
  const now = nowSchema.parse(await (await request.get("/api/now")).json());
  if (now.fireAlarm) {
    const hold = now.fireAlarm.paused.map(({ taskId }) => taskId);
    await request.post("/api/fire-alarm/all-clear", { data: { hold, drop: [] } });
  }
  await queryOfficeDatabase("delete from queue", []);
  await repository.remove();
});

// A Start that queues releases the whole queue, which would start a Task seeded here whose desk is
// free and open its sessions, so no test leaves one behind.
test.afterEach(async () => {
  await queryOfficeDatabase("delete from queue", []);
});

/**
 * A Project that may start as many Tasks at once as The Office, so only the wait a test is about
 * holds its Tasks: these tests start one beside another in the same Project. Its run environment
 * is Off, so its checks run on this computer.
 */
async function addedProject(page: Page, name: string, label: string): Promise<Project> {
  const newProject: AddProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "teal" },
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
    defaultPipeline: "full",
    runEnvironmentAnswer: "no",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  expect(added.status()).toBe(201);
  const { id } = projectSchema.parse(await added.json());
  const roomy = await page.request.put(`/api/projects/${id}/project-limit`, {
    data: { projectLimit: PROJECT_LIMIT_MAX },
  });
  expect(roomy.status()).toBe(200);
  return projectSchema.parse(await roomy.json());
}

/**
 * A Ready Task, its Plan and Definition of Done confirmed and its Project's default Pipeline
 * chosen, as planning leaves one.
 */
async function readyTask(page: Page, project: Project, title: string): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  const task = taskSchema.parse(await response.json());
  await queryOfficeDatabase(
    `update tasks set state = 'ready', plan = 'Mine.', plan_confirmed = true,
       definition_of_done = '{Mine.}', definition_of_done_confirmed = true,
       pipeline_id = (select default_pipeline from projects where projects.id = tasks.project_id)
     where id = $1`,
    [task.id],
  );
  return task;
}

/** Seeds the Task last in the queue, as a Start that only waits leaves it. */
async function queued(
  task: Task,
  reason = ONLY_DESK,
  shortReason = ONLY_DESK_SHORT,
): Promise<void> {
  await queryOfficeDatabase(
    `insert into queue (task_id, place, queued_at, queued_by, reasons, short_reasons)
       values ($1, (select coalesce(max(place), 0) + 1 from queue), now(), '{"kind":"user"}', $2, $3)`,
    [task.id, [reason], [shortReason]],
  );
}

function column(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** The words as a regular expression that matches them literally. */
function literal(words: string): string {
  return words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A queued Task's row on Now, as its text reads: its place, its title, then its short reasons. */
function queuedRowOnNow(place: number, title: string, shortReasons: string): RegExp {
  return new RegExp(`^${place}Place ${place}${literal(title)}.*${literal(shortReasons)}`);
}

/**
 * The full reasons of a queued Task's row on Now, in the tooltip of its short reasons, hovered
 * afresh each time: the row reflows as its Usage estimate arrives, which can move them from under
 * a pointer that stays.
 */
async function fullReasonsOnNow(page: Page, row: Locator): Promise<string> {
  await page.mouse.move(0, 0);
  await row.locator(".now-queued-reasons").hover();
  return (await page.getByRole("tooltip").textContent()) ?? "";
}

/** Only this Project's cards, whatever an earlier test left on the board. */
async function showOnly(page: Page, project: Project): Promise<void> {
  await page.getByRole("button", { name: /^Project filter:/ }).click();
  await page.getByRole("button", { name: `Show only ${project.name}` }).click();
}

test(
  "queued Tasks show their place and reason on the board, the Task page and Now; the user moves one up, then to the top, and takes one out",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue desk", "QD");
    const first = await readyTask(page, project, "Queued export as CSV");
    const second = await readyTask(page, project, "Queued sync of the inbox");
    const third = await readyTask(page, project, "Queued backup of the photos");
    await queued(first);
    await queued(second);
    await queued(third);

    await page.goto("/work");
    const card = page.getByRole("article", { name: "Queued sync of the inbox" });
    // The card's clock says why it waits, in short on hover, and in full with its place on a press;
    // the card itself shows no place, which is the Queued column's order.
    const clock = card.getByRole("button", { name: "Queued", exact: true });
    await expect(card).not.toContainText("Place");
    await clock.hover();
    await expect(page.getByRole("tooltip")).toHaveText(`Queued: ${ONLY_DESK_SHORT}`);
    await clock.click();
    const popover = page.getByRole("dialog", { name: "Queued", exact: true });
    await expect(popover).toContainText(ONLY_DESK);
    await expect(popover).toContainText(/Queued, place \d+/);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();

    await page.goto("/now");
    const queue = page.getByRole("article", { name: /^Queued: / });
    await expect(queue).toHaveText([
      queuedRowOnNow(1, "Queued export as CSV", ONLY_DESK_SHORT),
      queuedRowOnNow(2, "Queued sync of the inbox", ONLY_DESK_SHORT),
      queuedRowOnNow(3, "Queued backup of the photos", ONLY_DESK_SHORT),
    ]);
    await expect.poll(() => fullReasonsOnNow(page, queue.first())).toBe(ONLY_DESK);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-now-queue.png") });
    // Each row is one line, its long Usage estimate cut rather than wrapped; a narrow window wraps
    // a row, and nothing runs past it.
    const rowLooks = () =>
      queue.evaluateAll((rows) =>
        rows.map((row) => ({
          height: row.getBoundingClientRect().height,
          overflows: [row, ...row.querySelectorAll("*")].some(
            (part) => part.getBoundingClientRect().right > row.getBoundingClientRect().right + 1,
          ),
        })),
      );
    const wide = await rowLooks();
    expect(new Set(wide.map(({ height }) => height)).size).toBe(1);
    expect(wide.some(({ overflows }) => overflows)).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    expect((await rowLooks()).some(({ overflows }) => overflows)).toBe(false);
    await queue.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-390-now-queue.png") });
    await page.setViewportSize({ width: 1600, height: 900 });

    await page.goto(`/tasks/${third.id}`);
    await expect(page.getByText(`Place 3 · ${ONLY_DESK}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
    const moveUp = page.getByRole("button", { name: "Move up", exact: true });
    const moreWays = page.getByRole("button", { name: "More ways to move up" });
    await moveUp.click();
    await expect(page.getByText(`Place 2 · ${ONLY_DESK}`)).toBeVisible();

    await moreWays.click();
    await expect(moreWays).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("button")).toHaveText(["Move to top"]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-head-move-to-top.png") });
    await menu.getByRole("button", { name: "Move to top" }).click();
    await expect(page.getByText("Moved to the top of the queue.")).toBeVisible();
    await expect(page.getByText(`Place 1 · ${ONLY_DESK}`)).toBeVisible();
    await expect(menu).toBeHidden();
    // The first in the queue can't move further up.
    await expect(moveUp).toBeHidden();
    await expect(moreWays).toBeHidden();

    await page.goto("/now");
    await expect(queue).toHaveText([
      queuedRowOnNow(1, "Queued backup of the photos", ONLY_DESK_SHORT),
      queuedRowOnNow(2, "Queued export as CSV", ONLY_DESK_SHORT),
      queuedRowOnNow(3, "Queued sync of the inbox", ONLY_DESK_SHORT),
    ]);

    await page.goto(`/tasks/${third.id}`);
    await page.getByRole("button", { name: "Take out of the queue" }).click();
    await expect(page.getByText("Taken out of the queue; it stays Ready.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

    await page.goto("/now");
    await expect(queue).toHaveText([
      queuedRowOnNow(1, "Queued export as CSV", ONLY_DESK_SHORT),
      queuedRowOnNow(2, "Queued sync of the inbox", ONLY_DESK_SHORT),
    ]);
  },
);

test(
  "the Queued column holds queued Tasks by place, narrows with the filters, and its cards stay put; Ready keeps the rest",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue column", "QC");
    const first = await readyTask(page, project, "Column export as CSV");
    const second = await readyTask(page, project, "Column sync of the inbox");
    const notQueued = await readyTask(page, project, "Column left to the user");
    // High, so only the queue's places can put it second.
    await queryOfficeDatabase(`update tasks set priority = 'high' where id = $1`, [second.id]);
    await queued(first);
    await queued(second);

    await page.goto("/work");
    await showOnly(page, project);
    const ready = column(page, "Ready");
    const queuedColumn = column(page, "Queued");
    await expect(queuedColumn.getByRole("heading")).toHaveText("Queued 2");
    await expect(queuedColumn).toContainText("They start by themselves when their turn comes");
    await expect(ready).toContainText("Starting is your call");
    await expect(queuedColumn.getByRole("article")).toHaveText([
      new RegExp(first.title),
      new RegExp(second.title),
    ]);
    for (const { title } of [first, second]) {
      await expect(
        queuedColumn
          .getByRole("article", { name: title })
          .getByRole("button", { name: "Queued", exact: true }),
      ).toBeVisible();
    }
    await expect(ready.getByRole("article")).toHaveText([new RegExp(notQueued.title)]);
    const left = taskSchema.parse(await (await page.request.get(`/api/tasks/${first.id}`)).json());
    expect(left.state).toBe("ready");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-board-queued.png") });

    // A queued card's order is the queue's, and Start is what queues a Task.
    const firstCard = queuedColumn.getByRole("article", { name: first.title });
    await expect(firstCard).toHaveAttribute("draggable", "false");
    await ready.getByRole("article", { name: notQueued.title }).dragTo(firstCard);
    await expect(
      page.getByText("A Task changes state through its actions: Plan, Mark Ready, Start."),
    ).toBeVisible();
    await expect(ready.getByRole("article", { name: notQueued.title })).toBeVisible();

    const movedUp = await page.request.post(`/api/queue/${second.id}/move-up`);
    expect(movedUp.ok()).toBe(true);
    await expect(queuedColumn.getByRole("article")).toHaveText([
      new RegExp(second.title),
      new RegExp(first.title),
    ]);

    expect((await page.request.delete(`/api/queue/${second.id}`)).ok()).toBe(true);
    await expect(queuedColumn.getByRole("article")).toHaveCount(1);
    await expect(ready.getByRole("article", { name: second.title })).toBeVisible();
    await expect(ready.getByRole("article", { name: second.title })).toHaveAttribute(
      "draggable",
      "true",
    );
    await expect(queuedColumn.getByRole("heading")).toHaveText("Queued 1");

    await queued(second);
    await page.goto("/work?query=inbox");
    await expect(queuedColumn.getByRole("heading")).toHaveText("Queued 1");
    await expect(queuedColumn.getByRole("article")).toHaveText([new RegExp(second.title)]);
    await page.goto("/work?priority=high");
    await expect(queuedColumn.getByRole("article")).toHaveText([new RegExp(second.title)]);
  },
);

test(
  "a Task moves from Ready to Queued as it is queued and to In progress as the queue starts it, with no reload",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue moves", "QM");
    const blocker = await readyTask(page, project, "Moves write the schema");
    const task = await readyTask(page, project, "Moves export the schema");
    await page.request.post(`/api/tasks/${task.id}/dependencies`, {
      data: { blockerId: blocker.id },
    });

    await page.goto("/work");
    await showOnly(page, project);
    const card = (name: string) => column(page, name).getByRole("article", { name: task.title });
    // Blocked and not queued yet, it still waits for the user.
    await expect(card("Ready").getByRole("button", { name: "Blocked by 1 Task" })).toBeVisible();

    const start = await page.request.post(`/api/tasks/${task.id}/start`, { data: {} });
    expect(start.ok()).toBe(true);
    await card("Queued").getByRole("button", { name: "Blocked by 1 Task" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Blocked by 1 Task" })
        .getByRole("link", { name: blocker.title }),
    ).toBeVisible();
    await expect(card("Ready")).toBeHidden();

    expect((await page.request.post(`/api/tasks/${blocker.id}/drop`)).ok()).toBe(true);
    await expect(card("In progress")).toBeVisible();
    await expect(card("Queued")).toBeHidden();

    // Its walk has no more to prove here.
    await page.request.post(`/api/tasks/${task.id}/drop`);
  },
);

test("Start queues a Task its Project limit holds, with the limit as the reason on the board and Now, and raising the limit starts it", async ({
  page,
}) => {
  const project = await addedProject(page, "Queue limit", "QL");
  const atOnce = await page.request.put(`/api/projects/${project.id}/project-limit`, {
    data: { projectLimit: 1 },
  });
  expect(atOnce.ok()).toBe(true);
  const running = await readyTask(page, project, "Limit rework the export");
  // In progress without a walk: Start's only part here is the Project limit.
  await queryOfficeDatabase(`update tasks set state = 'in-progress' where id = $1`, [running.id]);
  const task = await readyTask(page, project, "Limit sync of the inbox");
  const projectLimit = `The Project limit is reached: 1 of ${project.name}'s Tasks is started.`;

  const start = await page.request.post(`/api/tasks/${task.id}/start`, { data: {} });
  expect(start.ok()).toBe(true);

  await page.goto("/work");
  await showOnly(page, project);
  const card = (name: string) => column(page, name).getByRole("article", { name: task.title });
  // The card's clock says it in short on hover, in full on a press, and Now in full.
  const clock = card("Queued").getByRole("button", { name: "Queued", exact: true });
  await clock.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Queued: Project limit reached (1)");
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-board-queued-short-reason.png"),
  });
  await clock.click();
  await expect(page.getByRole("dialog", { name: "Queued", exact: true })).toContainText(
    projectLimit,
  );
  // Its fade-in finished, so the picture shows the popover as it stays.
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-board-queued-full-reasons.png"),
    animations: "disabled",
  });
  await page.goto("/now");
  const queuedOnNow = page.getByRole("article", { name: `Queued: ${task.title}` });
  await expect(queuedOnNow).toContainText("Project limit reached (1)");
  await expect.poll(() => fullReasonsOnNow(page, queuedOnNow)).toBe(projectLimit);

  const raised = await page.request.put(`/api/projects/${project.id}/project-limit`, {
    data: { projectLimit: 2 },
  });
  expect(raised.ok()).toBe(true);
  await page.goto("/work");
  await showOnly(page, project);
  await expect(card("In progress")).toBeVisible();

  // Its walk has no more to prove here.
  await page.request.post(`/api/tasks/${task.id}/drop`);
  await queryOfficeDatabase(`update tasks set state = 'dropped' where id = $1`, [running.id]);
});

test(
  "the six columns scroll sideways inside the board when they don't fit, none cut off",
  { tag: "@full" },
  async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto("/work");
    const board = page.locator(".board");
    const columns = board.getByRole("region");
    await expect(columns).toHaveCount(6);

    const sizes = await board.evaluate((shown) => ({
      scrollable: shown.scrollWidth - shown.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(sizes.scrollable).toBeGreaterThan(0);
    expect(sizes.page).toBe(0);

    // Sideways only: a column with many cards is taller than the window, which the page scrolls.
    const shownArea = await board.boundingBox();
    expect(shownArea).not.toBeNull();
    const { x: boardLeft, width: boardWidth } = shownArea!;
    expect(boardLeft + boardWidth).toBeLessThanOrEqual(1100);
    for (const shown of await columns.all()) {
      await shown.evaluate((element) =>
        element.scrollIntoView({ inline: "nearest", block: "nearest" }),
      );
      const { x: left, width } = (await shown.boundingBox())!;
      expect(width).toBeGreaterThanOrEqual(220);
      expect(left).toBeGreaterThanOrEqual(boardLeft);
      expect(left + width).toBeLessThanOrEqual(boardLeft + boardWidth);
    }
  },
);

test(
  "Start says when it only queues the Task, and what holds it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue start", "QS");
    const task = await readyTask(page, project, "Queued badge on the cards");
    // The Start check and Start answer as the service gives them while only the limit holds a Task;
    // the queue's own service test covers the queuing itself.
    const check: StartCheck = {
      refusals: [],
      waits: [ONLY_DESK],
      blockers: [],
      overlaps: [],
      usageEstimate: null,
      pastUsageCaps: null,
      pastLimits: null,
    };
    await page.route(`**/api/tasks/${task.id}/start`, async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: check });
      await queued(task);
      const answer: StartAnswer = {
        task: { ...task, state: "ready" },
        queued: {
          taskId: task.id,
          place: 1,
          queuedAt: new Date().toISOString(),
          reasons: [ONLY_DESK],
          shortReasons: [ONLY_DESK_SHORT],
          behind: [],
        },
      };
      return route.fulfill({ json: answer });
    });

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByText(`Start joins the queue: ${ONLY_DESK}`)).toBeVisible();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await expect(
      page.getByText(`Queued badge on the cards is queued, place 1: ${ONLY_DESK}`),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Take out of the queue" })).toBeVisible();
  },
);

test(
  "a queued Task only its caps hold offers Start anyway on its page and its card, asking first with the caps and engines",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue past caps", "QP");
    const task = await readyTask(page, project, "Hosted test instances");
    await queued(task, CAP_WAIT, CAP_WAIT_SHORT);
    // The check as the service gives it while only the caps hold the Task; Work's own tests cover
    // how the engines are chosen and that Start anyway starts it.
    const check: StartCheck = {
      refusals: [],
      waits: [CAP_WAIT],
      blockers: [],
      overlaps: [],
      usageEstimate: null,
      pastUsageCaps: {
        passes: ["Personal: 5-hour window cap (90%) · resets 12:00"],
        engines: [{ name: "Personal", standingInFor: "Claude Code" }],
        refusals: [],
      },
      pastLimits: null,
    };
    await page.route(`**/api/tasks/${task.id}/start`, (route) => route.fulfill({ json: check }));

    await page.goto(`/tasks/${task.id}`);
    const startAnyway = page.getByRole("button", { name: "Start anyway" });
    await expect(startAnyway).toBeVisible();
    await expect(page.getByRole("button", { name: "Take out of the queue" })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1280-task-start-anyway.png") });
    await startAnyway.click();
    const asked = page.getByRole("dialog", { name: "Start Hosted test instances anyway?" });
    await expect(asked).toContainText("Personal: 5-hour window cap (90%) · resets 12:00");
    await expect(asked).toContainText("Its Stages run on Personal, standing in for Claude Code.");
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1280-task-start-anyway-dialog.png"),
    });
    await page.keyboard.press("Escape");
    await expect(asked).toBeHidden();

    await page.goto("/work");
    await showOnly(page, project);
    await page
      .getByRole("article", { name: "Hosted test instances" })
      .getByRole("button", { name: "Queued", exact: true })
      .click();
    const popover = page.getByRole("dialog", { name: "Queued", exact: true });
    await expect(popover.getByRole("button", { name: "Start anyway" })).toBeEnabled();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1280-board-start-anyway.png") });
  },
);

test(
  "a Ready Task's Usage estimate shows on its card, in the Task head's notes, under the rail and on Now when queued, with where it came from and a cap's wait in the service's words",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue estimates", "QE");
    const learned = await readyTask(page, project, "Estimate the export's columns");
    await queryOfficeDatabase(`update tasks set estimated_tokens = 90000 where id = $1`, [
      learned.id,
    ]);
    const planned = await readyTask(page, project, "Estimate the inbox filters");
    const unknown = await readyTask(page, project, "Estimate the empty state");
    await queued(planned, CAP_WAIT, CAP_WAIT_SHORT);
    // The estimates as the service gives them; Work's own tests cover how they are reached.
    const fromHistory: UsageEstimate = {
      basis: { source: "history", tasks: 4 },
      engines: [{ engineId: "claude-code", tokens: 120_000, fiveHourWindow: 6, cost: 1.2 }],
    };
    const estimates: TaskUsageEstimateList = [
      { taskId: learned.id, usageEstimate: fromHistory },
      {
        taskId: planned.id,
        usageEstimate: {
          basis: { source: "planner" },
          engines: [
            { engineId: "claude-code", tokens: 60_000, fiveHourWindow: 3, cost: 0.6 },
            { engineId: LOCAL_MODELS.id, tokens: 40_000, cost: null },
          ],
        },
      },
      { taskId: unknown.id, usageEstimate: { basis: { source: "none" }, engines: [] } },
    ];
    await page.route("**/api/usage-estimates", (route) => route.fulfill({ json: estimates }));
    // The estimate names an API engine by its name; listed for this page only, so nothing else sees it.
    await page.route("**/api/settings/engines", async (route) => {
      const listed = engineSettingsSchema.parse(await (await route.fetch()).json());
      await route.fulfill({ json: { ...listed, engines: [...listed.engines, LOCAL_MODELS] } });
    });
    const check: StartCheck = {
      refusals: [],
      waits: [],
      blockers: [],
      overlaps: [],
      usageEstimate: fromHistory,
      pastUsageCaps: null,
      pastLimits: null,
    };
    await page.route(`**/api/tasks/${learned.id}/start`, (route) => route.fulfill({ json: check }));
    const HISTORY_WORDS =
      "Expected: 120k tokens · 6% of the 5-hour window · $1.20, from the history of 4 done Tasks.";
    const PLANNER_WORDS =
      "Expected: Claude Code: 60k tokens · 3% of the 5-hour window · $0.60; Local models: 40k tokens · no cost, from the Planner's estimate.";

    await page.goto("/work");
    // On a card the estimate is the gauge, named by its words, which show on hover.
    const estimateOn = (title: string, words: string) =>
      page.getByRole("article", { name: title }).getByRole("img", { name: words, exact: true });
    await expect(estimateOn(learned.title, HISTORY_WORDS)).toBeVisible();
    await estimateOn(learned.title, HISTORY_WORDS).hover();
    await expect(page.getByRole("tooltip")).toHaveText(HISTORY_WORDS);
    await expect(
      estimateOn(
        unknown.title,
        "No estimate: fewer than 3 done Tasks to learn from, and no Planner's estimate.",
      ),
    ).toBeVisible();
    const queuedCard = page.getByRole("article", { name: planned.title });
    await queuedCard.getByRole("button", { name: "Queued", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText(`Queued: ${CAP_WAIT_SHORT}`);
    await expect(estimateOn(planned.title, PLANNER_WORDS)).toBeVisible();

    await page.goto("/now");
    const queuedOnNow = page.getByRole("article", { name: `Queued: ${planned.title}` });
    await expect(queuedOnNow).toContainText(CAP_WAIT_SHORT);
    await expect.poll(() => fullReasonsOnNow(page, queuedOnNow)).toBe(CAP_WAIT);
    await expect(queuedOnNow.getByRole("note", { name: "Usage estimate" })).toHaveText(
      PLANNER_WORDS,
    );

    await page.goto(`/tasks/${learned.id}`);
    // In the Task head's notes and in the card's place under the rail.
    await expect(page.getByRole("note", { name: "Usage estimate" })).toHaveText([
      HISTORY_WORDS,
      HISTORY_WORDS,
    ]);
    await expect(page.getByText("0 of ~90k tokens")).toBeVisible();
    const plan = page.getByRole("region", { name: "Plan" });
    await plan.getByRole("button", { name: /^Plan/ }).click();
    await expect(
      plan.getByText("The Planner expects the whole Pipeline to use about 90k tokens."),
    ).toBeVisible();
  },
);

test(
  "Start warns of an Overlap with a Task in progress, naming it, and queues behind it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue overlap", "QO");
    const inProgress = await readyTask(page, project, "Rework the sign-in");
    // In progress without a walk: Start's only part here is the warning and the queue.
    await queryOfficeDatabase(
      `update tasks set state = 'in-progress', files_to_change = '{src/auth}' where id = $1`,
      [inProgress.id],
    );
    const task = await readyTask(page, project, "Keep the redirect after sign-in");
    await queryOfficeDatabase(
      `update tasks set files_to_change = '{src/auth/login.ts,README.md}' where id = $1`,
      [task.id],
    );

    await page.goto(`/tasks/${task.id}`);
    const overlap = page.getByRole("note", { name: "Overlap" });
    await expect(overlap).toHaveText(
      "Overlap: “Rework the sign-in” is in progress and expects to change some of the same files.",
    );
    await expect(page.getByRole("button", { name: "Start anyway" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "Queue behind it" }).click();

    await expect(page.getByText(`${task.title} is queued, place`)).toBeVisible();
    // Read again after the release that queuing sets off, so its reasons are the release's.
    await page.reload();
    await expect(
      page.getByText(
        /^Place \d+ · Queued behind "Rework the sign-in" until it is Done or Dropped\.$/,
      ),
    ).toBeVisible();

    // Out of the queue before the Task it waits behind ends, so no release starts a walk.
    await page.request.post(`/api/tasks/${task.id}/drop`);
    await queryOfficeDatabase(`update tasks set state = 'dropped' where id = $1`, [inProgress.id]);
  },
);

test(
  "Start says one sentence for each Task in progress it overlaps",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue overlaps", "QS");
    const signIn = await readyTask(page, project, "Rework the sign-in");
    const signOut = await readyTask(page, project, "Rework the sign-out");
    await queryOfficeDatabase(
      `update tasks set state = 'in-progress', files_to_change = '{src/auth}' where id = any($1)`,
      [[signIn.id, signOut.id]],
    );
    const task = await readyTask(page, project, "Keep the redirect after sign-in");
    await queryOfficeDatabase(`update tasks set files_to_change = '{src/auth}' where id = $1`, [
      task.id,
    ]);

    await page.goto(`/tasks/${task.id}`);

    await expect(page.getByRole("note", { name: "Overlap" })).toHaveText(
      /^(Overlap: “Rework the sign-(in|out)” is in progress and expects to change some of the same files\.\s*){2}$/,
    );
    await expect(page.getByRole("note", { name: "Overlap" })).toContainText("sign-in");
    await expect(page.getByRole("note", { name: "Overlap" })).toContainText("sign-out");
    await expect(page.getByRole("button", { name: "Start anyway" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Queue behind them" })).toBeInViewport({
      ratio: 1,
    });

    await queryOfficeDatabase(`update tasks set state = 'dropped' where id = any($1)`, [
      [signIn.id, signOut.id],
    ]);
  },
);

/** Each line's top and bottom, read after the words have settled. */
async function boxesOf(lines: Locator): Promise<{ top: number; bottom: number }[]> {
  const boxes = await Promise.all((await lines.all()).map((line) => line.boundingBox()));
  return boxes.map((box) => ({ top: box!.y, bottom: box!.y + box!.height }));
}

function overlapWords(title: string): string {
  return `Overlap: “${title}” is in progress and expects to change some of the same files.`;
}

test(
  "the notes above a Ready Task each take a line of their own, in order, under the buttons, and a queued Task's place and reasons join them there",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue notes", "QN");
    const ahead = await readyTask(page, project, "Notes ahead in the queue");
    const task = await readyTask(page, project, "Notes under the buttons");
    const LONG_TITLE = "Rework how the sign-in remembers the page it came from ".repeat(6).trim();
    // The check as the service gives it; the Tasks it names need no walk to be said.
    let check: StartCheck = {
      refusals: [],
      waits: [ONLY_DESK],
      blockers: [],
      overlaps: [
        { taskId: crypto.randomUUID(), title: "Rework the sign-out" },
        { taskId: crypto.randomUUID(), title: LONG_TITLE },
      ],
      usageEstimate: {
        basis: { source: "history", tasks: 4 },
        engines: [{ engineId: "claude-code", tokens: 120_000, fiveHourWindow: 6, cost: 1.2 }],
      },
      pastUsageCaps: null,
      pastLimits: null,
    };
    await page.route(`**/api/tasks/${task.id}/start`, (route) => route.fulfill({ json: check }));

    await page.goto(`/tasks/${task.id}`);
    const notes = page.locator(".task-head-notes");
    const lines = notes.locator(".task-head-note, .usage-estimate, .queued-mark");
    await expect(lines).toHaveText([
      overlapWords("Rework the sign-out"),
      overlapWords(LONG_TITLE),
      `Start joins the queue: ${ONLY_DESK}`,
      "Expected: 120k tokens · 6% of the 5-hour window · $1.20, from the history of 4 done Tasks.",
    ]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-head-notes.png") });

    const actions = page.locator(".control-bar-actions");
    await expect(actions).not.toContainText("Overlap");
    const startAnyway = await actions.getByRole("button", { name: "Start anyway" }).boundingBox();
    const queueBehind = await actions
      .getByRole("button", { name: "Queue behind them" })
      .boundingBox();
    expect(startAnyway!.y).toBe(queueBehind!.y);

    const boxes = await boxesOf(lines);
    expect(boxes[0]!.top).toBeGreaterThanOrEqual(startAnyway!.y + startAnyway!.height);
    for (const [index, box] of boxes.slice(1).entries()) {
      expect(box.top).toBeGreaterThanOrEqual(boxes[index]!.bottom);
    }

    // The long line wraps in the block's full width, its text after the icon, as a short line's is.
    const block = await notes.boundingBox();
    const [short, long] = await Promise.all(
      [0, 1].map((line) => lines.nth(line).locator("span").boundingBox()),
    );
    expect(long!.height).toBeGreaterThan(short!.height);
    expect(long!.x).toBe(short!.x);
    expect(long!.x + long!.width).toBeGreaterThan(block!.x + block!.width * 0.9);

    const looks = await lines.evaluateAll((shown) =>
      shown.map((line) => {
        const { fontSize, color } = getComputedStyle(line);
        return `${fontSize} ${color}`;
      }),
    );
    expect(new Set(looks).size).toBe(1);

    // A note-less Task's head keeps no block to leave a gap.
    check = { ...check, waits: [], overlaps: [], usageEstimate: null };
    await page.reload();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
    await expect(notes).toHaveCount(0);

    await queued(ahead);
    await queued(task);
    await page.reload();
    await expect(lines).toHaveText([`QueuedPlace 2 · ${ONLY_DESK}`]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-head-queued.png") });
    const moveUp = actions.getByRole("button", { name: "Move up", exact: true });
    const moreWays = actions.getByRole("button", { name: "More ways to move up" });
    const takeOut = actions.getByRole("button", { name: "Take out of the queue" });
    await expect(moveUp).toBeInViewport();
    await expect(takeOut).toBeInViewport();
    const takeOutBox = await takeOut.boundingBox();
    const moveUpBox = await moveUp.boundingBox();
    const moreWaysBox = await moreWays.boundingBox();
    expect(moveUpBox!.y).toBe(takeOutBox!.y);
    // The split button's halves are one control: the arrow joined to Move up's right, as tall.
    expect(moreWaysBox!.y).toBe(moveUpBox!.y);
    expect(moreWaysBox!.height).toBe(moveUpBox!.height);
    expect(moreWaysBox!.x).toBeCloseTo(moveUpBox!.x + moveUpBox!.width - 1, 0);
    const [queuedLine] = await boxesOf(lines);
    expect(queuedLine!.top).toBeGreaterThanOrEqual(takeOutBox!.y + takeOutBox!.height);
  },
);

test(
  "a blocked Task offers only the queue, shows its blocker as the reason, and starts by itself once the blocker ends",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue blocked", "QB");
    const blocker = await readyTask(page, project, "Write the export schema");
    const task = await readyTask(page, project, "Export the schema as CSV");
    const dependency = await page.request.post(`/api/tasks/${task.id}/dependencies`, {
      data: { blockerId: blocker.id },
    });
    expect(dependency.status()).toBe(200);
    const reason = 'Blocked by "Write the export schema", which must be Done first.';

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByText(reason)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Start anyway" })).toBeHidden();
    await page.getByRole("button", { name: "Queue behind it" }).click();

    await expect(page.getByText(`${task.title} is queued, place`)).toBeVisible();
    await expect(page.getByText(new RegExp(`^Place \\d+ · ${reason}$`))).toBeVisible();

    await page.goto("/work");
    // The card names its blocker once, under its lock, and its clock no more.
    const card = page.getByRole("article", { name: task.title });
    await card.getByRole("button", { name: "Blocked by 1 Task" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Blocked by 1 Task" })
        .getByRole("link", { name: blocker.title }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-board-blocked-popover.png"),
      animations: "disabled",
    });
    await card.getByRole("button", { name: "Queued", exact: true }).click();
    const queuedPopover = page.getByRole("dialog", { name: "Queued", exact: true });
    await expect(queuedPopover).not.toContainText(reason);
    await expect(queuedPopover).toContainText("And its 1 blocker, under the lock.");
    // Closed, the clock shows its tooltip again.
    await page.keyboard.press("Escape");
    await expect(queuedPopover).toBeHidden();
    await card.getByRole("button", { name: "Queued", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Queued");
    await page.goto("/now");
    const queuedOnNow = page.getByRole("article", { name: `Queued: ${task.title}` });
    await expect(queuedOnNow).toContainText("Blocked");
    const fullReasons = () => fullReasonsOnNow(page, queuedOnNow);
    await expect.poll(fullReasons).toBe(reason);

    // Now hears of no dependency, only that the reasons of a queued Task changed.
    const lateBlocker = await readyTask(page, project, "Agree the export columns");
    await page.request.post(`/api/tasks/${task.id}/dependencies`, {
      data: { blockerId: lateBlocker.id },
    });
    await expect.poll(fullReasons).toContain(lateBlocker.title);
    await page.request.post(`/api/tasks/${lateBlocker.id}/drop`);
    await expect.poll(fullReasons).toBe(reason);

    await page.goto(`/tasks/${task.id}`);
    expect((await page.request.post(`/api/tasks/${blocker.id}/drop`)).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Take out of the queue" })).toBeHidden();
    await expect(page.getByText(reason)).toBeHidden();
    const started = taskSchema.parse(
      await (await page.request.get(`/api/tasks/${task.id}`)).json(),
    );
    expect(started.state).not.toBe("ready");

    // Its walk has no more to prove here.
    await page.request.post(`/api/tasks/${task.id}/drop`);
  },
);

test(
  "a blocked Task that also overlaps says Queue behind them, and waits for both",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue both", "QT");
    const inProgress = await readyTask(page, project, "Rework the importer");
    await queryOfficeDatabase(
      `update tasks set state = 'in-progress', files_to_change = '{src/import}' where id = $1`,
      [inProgress.id],
    );
    const blocker = await readyTask(page, project, "Name the import formats");
    const task = await readyTask(page, project, "Import from a spreadsheet");
    await queryOfficeDatabase(`update tasks set files_to_change = '{src/import}' where id = $1`, [
      task.id,
    ]);
    await page.request.post(`/api/tasks/${task.id}/dependencies`, {
      data: { blockerId: blocker.id },
    });

    await page.goto(`/tasks/${task.id}`);
    await expect(page.getByRole("note", { name: "Overlap" })).toBeVisible();
    await expect(
      page.getByText('Blocked by "Name the import formats", which must be Done first.'),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start anyway" })).toBeHidden();
    await page.getByRole("button", { name: "Queue behind them" }).click();

    await expect(page.getByText(`${task.title} is queued, place`)).toBeVisible();
    await page.reload();
    await expect(
      page.getByText(
        /^Place \d+ · Blocked by "Name the import formats", which must be Done first\. Queued behind "Rework the importer" until it is Done or Dropped\.$/,
      ),
    ).toBeVisible();

    // Out of the queue before what it waits for ends, so no release starts a walk.
    await page.request.post(`/api/tasks/${task.id}/drop`);
    await page.request.post(`/api/tasks/${blocker.id}/drop`);
    await queryOfficeDatabase(`update tasks set state = 'dropped' where id = $1`, [inProgress.id]);
  },
);

/** An active Initiative of the Project's Tasks, each Ready, `waitsFor` naming earlier ones by index. */
async function initiativeWithReadyTasks(
  page: Page,
  project: Project,
  plans: readonly { readonly title: string; readonly waitsFor?: readonly number[] }[],
): Promise<{ initiative: Initiative; tasks: Task[] }> {
  const idea = ideaSchema.parse(
    await (
      await page.request.post("/api/ideas", {
        data: { title: "Imports from spreadsheets", notes: "", projectId: project.id },
      })
    ).json(),
  );
  const initiative = initiativeSchema.parse(
    await (await page.request.post(`/api/ideas/${idea.id}/initiative`)).json(),
  );
  const tasks: Task[] = [];
  for (const { title, waitsFor = [] } of plans) {
    const added = await page.request.post(`/api/initiatives/${initiative.id}/tasks`, {
      data: {
        title,
        projectId: project.id,
        priority: "normal",
        blockedBy: waitsFor.map((index) => tasks[index]?.id),
      },
    });
    expect(added.status()).toBe(201);
    tasks.push(taskSchema.parse(await added.json()));
  }
  expect((await page.request.post(`/api/initiatives/${initiative.id}/confirm`)).status()).toBe(200);
  await queryOfficeDatabase(
    `update tasks set state = 'ready', plan = 'Mine.', plan_confirmed = true,
       definition_of_done = '{Mine.}', definition_of_done_confirmed = true,
       pipeline_id = (select default_pipeline from projects where projects.id = tasks.project_id)
     where id = any($1)`,
    [tasks.map(({ id }) => id)],
  );
  return { initiative, tasks };
}

test("Start Ready Tasks starts an Initiative's Ready Tasks, queues one for its blocker and one behind an Overlap, and says so", async ({
  page,
}) => {
  const project = await addedProject(page, "Queue initiative", "QI");
  const { initiative, tasks } = await initiativeWithReadyTasks(page, project, [
    { title: "Read the spreadsheet" },
    { title: "Map the spreadsheet columns", waitsFor: [0] },
    { title: "Import the spreadsheet rows" },
  ]);
  const [first, blocked, overlapping] = tasks as [Task, Task, Task];
  await queryOfficeDatabase(
    `update tasks set files_to_change = '{src/import}' where id = any($1)`,
    [[first.id, overlapping.id]],
  );

  await page.goto(`/work/initiatives/${initiative.id}`);
  await page.getByRole("button", { name: "Start Ready Tasks" }).click();

  await expect(page.getByText("1 started, 2 queued").first()).toBeVisible();
  const note = page.getByRole("status").filter({ hasText: "Start Ready Tasks:" });
  await expect(note.getByRole("region", { name: "Started" }).getByRole("listitem")).toHaveText([
    first.title,
  ]);
  await expect(note.getByRole("region", { name: "Queued" }).getByRole("listitem")).toHaveText([
    /^Map the spreadsheet columns · place \d+: Blocked by "Read the spreadsheet", which must be Done first\.$/,
    /^Import the spreadsheet rows · place \d+: Queued behind "Read the spreadsheet" until it is Done or Dropped\.$/,
  ]);
  await expect(note.getByRole("region", { name: "Refused" })).toBeHidden();
  await expect(note.getByRole("link", { name: blocked.title })).toHaveAttribute(
    "href",
    `/tasks/${blocked.id}`,
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await note.screenshot({
      path: path.join(SCREENSHOTS, `${colorScheme}-1600-start-ready-tasks.png`),
    });
  }
  await page.emulateMedia({ colorScheme: "light" });

  await note.getByRole("button", { name: "Dismiss" }).click();
  await expect(note).toBeHidden();

  // Out of the queue before what they wait for ends, so no release starts a walk.
  await page.request.post(`/api/tasks/${blocked.id}/drop`);
  await page.request.post(`/api/tasks/${overlapping.id}/drop`);
  await page.request.post(`/api/tasks/${first.id}/drop`);
});

test(
  "Pause the Initiative pauses its running Task and queues a Start with the reason; Resume the Initiative goes on and starts it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Queue pause", "QP");
    const { initiative, tasks } = await initiativeWithReadyTasks(page, project, [
      { title: "Pause the running export" },
      { title: "Pause the waiting import" },
    ]);
    const [running, waiting] = tasks as [Task, Task];
    // In progress without a walk: the Pause's part here is the hold and the queue.
    await queryOfficeDatabase(`update tasks set state = 'in-progress' where id = $1`, [running.id]);
    const stateOf = async ({ id }: Task) =>
      taskSchema.parse(await (await page.request.get(`/api/tasks/${id}`)).json()).state;
    const head = page.locator("header.task-head");

    await page.goto(`/work/initiatives/${initiative.id}`);
    await head.getByRole("button", { name: "Pause the Initiative" }).click();

    await expect(page.getByText("Initiative paused: 1 Task paused.").first()).toBeVisible();
    await expect(head.getByText("Paused", { exact: true })).toBeVisible();
    await expect(head.getByRole("button", { name: "Resume the Initiative" })).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await head.screenshot({
        path: path.join(SCREENSHOTS, `${colorScheme}-1600-initiative-paused.png`),
      });
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/tasks/${running.id}`);
    await expect(page.getByText("Paused", { exact: true }).first()).toBeVisible();

    const start = await page.request.post(`/api/tasks/${waiting.id}/start`, { data: {} });
    expect(start.ok()).toBe(true);
    await page.goto("/work");
    await showOnly(page, project);
    await expect(
      column(page, "Queued").getByRole("article", { name: waiting.title }),
    ).toContainText("The Initiative is paused.");

    await page.goto(`/work/initiatives/${initiative.id}`);
    await head.getByRole("button", { name: "Resume the Initiative" }).click();

    await expect(page.getByText("Initiative resumed: 1 Task resumed.").first()).toBeVisible();
    await expect(head.getByText("Paused", { exact: true })).toBeHidden();
    await expect.poll(() => stateOf(running)).not.toBe("paused");
    await expect.poll(() => stateOf(waiting)).not.toBe("ready");

    // Their walks have no more to prove here.
    await page.request.post(`/api/tasks/${waiting.id}/drop`);
    await page.request.post(`/api/tasks/${running.id}/drop`);
  },
);

// Here, alone, since the alarm holds every file's Starts and pauses every file's started Tasks;
// each Task is held at the all clear, so no walk starts after the files that left them.
test("the fire alarm: sounded from the top bar, it stops and holds the Tasks, the strip's desks at 0, chats run no tools unless let; the all clear holds, drops or resumes each", async ({
  page,
}) => {
  const project = await addedProject(page, "Alarm desk", "AD");
  const task = await readyTask(page, project, "Alarm holds the export");
  // In progress without a walk, and with a planning Thread to write in.
  await queryOfficeDatabase(`update tasks set state = 'in-progress' where id = $1`, [task.id]);
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at)
     values ($1, 'task', $2, 'planner', null, 'waiting', $3, now())`,
    [crypto.randomUUID(), task.id, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
  const strip = page.getByRole("status", { name: "Status strip" });

  await page.goto("/now");
  await expect(strip).not.toContainText("Fire alarm");
  await page.getByRole("button", { name: "Sound the alarm" }).click();
  await page
    .getByRole("menu")
    .getByRole("button", { name: /^Safe pause ASAP/ })
    .click();

  await expect(
    page.getByText("Alarm sounded: every Stage stops at its next safe point."),
  ).toBeVisible();
  await expect(strip.getByRole("button", { name: /^Fire alarm: / })).toBeVisible();
  await expect(strip.getByTitle(/^0 of \d+ desks in use$/)).toBeVisible();
  const panel = page.getByRole("region", { name: "Fire alarm" });
  await expect(panel.getByRole("heading", { name: /^Alarm on since \d/ })).toBeVisible();
  await expect(panel.getByRole("listitem").filter({ hasText: task.title })).toContainText(
    "Stopped",
  );

  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText("Paused by the alarm").first()).toBeVisible();
  const note = page.getByRole("note").filter({ hasText: "Alarm on:" });
  await expect(note).toContainText("answers but runs no tools.");
  await note.getByRole("button", { name: /^Let .+ act in this thread$/ }).click();
  const lifted = page.getByRole("note").filter({ hasText: "may run tools in this thread" });
  await expect(lifted).toBeVisible();
  await lifted.getByRole("button", { name: "Take it back" }).click();
  await expect(note).toBeVisible();

  await page.getByRole("button", { name: "All clear…" }).click();
  await expect(page).toHaveURL(/\/$|\/now$/);
  const review = page.getByRole("region", { name: "Before the all clear" });
  const choices = review.getByRole("group", { name: `What happens to ${task.title}` });
  await expect(review).toContainText("Goes on · no model call");
  await expect(choices.getByRole("button", { name: "Resume" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const groups = review.getByRole("group", { name: /^What happens to / });
  for (const group of await groups.all()) await group.getByRole("button", { name: "Hold" }).click();
  await expect(review).toContainText(
    /0 to resume · about 0 tokens before work continues · \d+ held or dropped/,
  );
  await review.getByRole("button", { name: "All clear", exact: true }).click();

  await expect(page.getByText("All clear. 0 Tasks resume.")).toBeVisible();
  await expect(strip).not.toContainText("Fire alarm");
  await expect(page.getByRole("region", { name: "Fire alarm" })).toBeHidden();
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText("Paused by the alarm")).toBeHidden();

  await page.request.post(`/api/tasks/${task.id}/drop`);
});
