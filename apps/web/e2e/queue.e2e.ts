import { expect, test, type Page } from "@playwright/test";
import {
  engineSettingsSchema,
  nowSchema,
  projectSchema,
  taskSchema,
  type ApiEngine,
  type NewProject,
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

const ONLY_DESK = "The Office-wide limit is reached: the only desk is in use.";
const CAP_WAIT =
  "The Claude Code engine's 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 6% of this Task. It resets at 12:00.";

/** An API engine the Usage estimate test lists in the browser only. */
const LOCAL_MODELS: ApiEngine = {
  id: "local-models",
  name: "Local models",
  kind: "openai-compatible-api",
  defaultModel: "coder:q4",
  baseUrl: "http://127.0.0.1:8090/v1",
  keySet: false,
  models: [{ id: "coder:q4", contextWindow: 100_000 }],
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

async function addedProject(page: Page, name: string, label: string): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

/** A Ready Task, its Plan and Definition of Done confirmed, as planning leaves one. */
async function readyTask(page: Page, project: Project, title: string): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  const task = taskSchema.parse(await response.json());
  await queryOfficeDatabase(
    `update tasks set state = 'ready', plan = 'Mine.', plan_confirmed = true,
       definition_of_done = '{Mine.}', definition_of_done_confirmed = true where id = $1`,
    [task.id],
  );
  return task;
}

/** Seeds the Task last in the queue, as a Start that only waits leaves it. */
async function queued(task: Task, reason = ONLY_DESK): Promise<void> {
  await queryOfficeDatabase(
    `insert into queue (task_id, place, queued_at, reasons)
       values ($1, (select coalesce(max(place), 0) + 1 from queue), now(), $2)`,
    [task.id, [reason]],
  );
}

test("queued Tasks show their place and reason on the board, the Task page and Now; the user moves one up and takes one out", async ({
  page,
}) => {
  const project = await addedProject(page, "Queue desk", "QD");
  const first = await readyTask(page, project, "Queued export as CSV");
  const second = await readyTask(page, project, "Queued sync of the inbox");
  await queued(first);
  await queued(second);

  await page.goto("/work");
  const card = page.getByRole("article", { name: "Queued sync of the inbox" });
  await expect(card).toContainText("Queued");
  await expect(card).toContainText(`Place 2 · ${ONLY_DESK}`);

  await page.goto("/now");
  const queue = page.getByRole("article", { name: /^Queued: / });
  await expect(queue).toHaveText([
    new RegExp(`Queued export as CSV.*Place 1 · ${ONLY_DESK}`),
    new RegExp(`Queued sync of the inbox.*Place 2 · ${ONLY_DESK}`),
  ]);

  await page.goto(`/tasks/${second.id}`);
  await expect(page.getByText(`Place 2 · ${ONLY_DESK}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Move up" }).click();
  await expect(page.getByText(`Place 1 · ${ONLY_DESK}`)).toBeVisible();
  // The first in the queue can't move further up.
  await expect(page.getByRole("button", { name: "Move up" })).toBeHidden();

  await page.getByRole("button", { name: "Take out of the queue" }).click();
  await expect(page.getByText("Taken out of the queue; it stays Ready.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();

  await page.goto("/now");
  await expect(queue).toHaveCount(1);
  await expect(queue).toContainText(`Queued export as CSV`);
  await expect(queue).toContainText(`Place 1 · ${ONLY_DESK}`);
});

test("Start says when it only queues the Task, and what holds it", async ({ page }) => {
  const project = await addedProject(page, "Queue start", "QS");
  const task = await readyTask(page, project, "Queued badge on the cards");
  // The Start check and Start answer as the service gives them while only the limit holds a Task;
  // the queue's own service test covers the queuing itself.
  const check: StartCheck = { refusals: [], waits: [ONLY_DESK], overlaps: [], usageEstimate: null };
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
});

test("a Ready Task's Usage estimate shows on its card, beside Start, under the rail and on Now when queued, with where it came from and a cap's wait in the service's words", async ({
  page,
}) => {
  const project = await addedProject(page, "Queue estimates", "QE");
  const learned = await readyTask(page, project, "Estimate the export's columns");
  await queryOfficeDatabase(`update tasks set estimated_tokens = 90000 where id = $1`, [
    learned.id,
  ]);
  const planned = await readyTask(page, project, "Estimate the inbox filters");
  const unknown = await readyTask(page, project, "Estimate the empty state");
  await queued(planned, CAP_WAIT);
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
  const check: StartCheck = { refusals: [], waits: [], overlaps: [], usageEstimate: fromHistory };
  await page.route(`**/api/tasks/${learned.id}/start`, (route) => route.fulfill({ json: check }));
  const HISTORY_WORDS =
    "Expected: 120k tokens · 6% of the 5-hour window · $1.20, from the history of 4 done Tasks.";
  const PLANNER_WORDS =
    "Expected: Claude Code: 60k tokens · 3% of the 5-hour window · $0.60; Local models: 40k tokens · no cost, from the Planner's estimate.";

  await page.goto("/work");
  const estimateOn = (title: string) =>
    page.getByRole("article", { name: title }).getByRole("note", { name: "Usage estimate" });
  await expect(estimateOn(learned.title)).toHaveText(HISTORY_WORDS);
  await expect(estimateOn(unknown.title)).toHaveText(
    "No estimate: fewer than 3 done Tasks to learn from, and no Planner's estimate.",
  );
  const queuedCard = page.getByRole("article", { name: planned.title });
  await expect(queuedCard).toContainText(`Place 1 · ${CAP_WAIT}`);
  await expect(estimateOn(planned.title)).toHaveText(PLANNER_WORDS);

  await page.goto("/now");
  const queuedOnNow = page.getByRole("article", { name: `Queued: ${planned.title}` });
  await expect(queuedOnNow).toContainText(CAP_WAIT);
  await expect(queuedOnNow.getByRole("note", { name: "Usage estimate" })).toHaveText(PLANNER_WORDS);

  await page.goto(`/tasks/${learned.id}`);
  // Beside Start and in the card's place under the rail.
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
});

test("Start warns of an Overlap with a Task in progress, naming it and the files, and queues behind it", async ({
  page,
}) => {
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
    "Overlap: “Rework the sign-in” is in progress and expects to change src/auth/login.ts too.",
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
});

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
  await expect(strip).toContainText("Alarm off · all clear");
  await page.getByRole("button", { name: "Sound the alarm" }).click();

  await expect(
    page.getByText("Alarm sounded: every Stage stops at its next safe point."),
  ).toBeVisible();
  await expect(strip).toContainText(/Alarm on/);
  await expect(strip).toContainText(/(?<!\d)0\/ \d+ desks in use/);
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
  await expect(strip).toContainText("Alarm off · all clear");
  await expect(page.getByRole("region", { name: "Fire alarm" })).toBeHidden();
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText("Paused by the alarm")).toBeHidden();

  await page.request.post(`/api/tasks/${task.id}/drop`);
});
