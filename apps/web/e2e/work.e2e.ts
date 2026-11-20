import { execFileSync } from "node:child_process";
import path from "node:path";
import zlib from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  accountSchema,
  attachmentSchema,
  decisionListSchema,
  ideaSchema,
  initiativeSchema,
  pipelineSchema,
  projectSchema,
  presetListSchema,
  recordPath,
  roleListSchema,
  roleSchema,
  taskSchema,
  type Attachment,
  type DecisionFormAnswer,
  type DecisionQuestion,
  type Idea,
  type Initiative,
  type InitiativeState,
  type NewProject,
  type Project,
  type Stage,
  type StageRun,
  type Task,
  type TaskStage,
  type TaskStages,
} from "@the-office/contracts";
import { taskWorktreePath } from "./office-data.ts";
import { E2E_USER } from "./e2e-user.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import {
  addTaskWorktree,
  commitOnTaskBranch,
  createTemporaryRepository,
  createTemporaryRepositoryWithRemote,
  fileOnRemote,
  type TemporaryRepository,
  type TemporaryRepositoryWithRemote,
} from "./temporary-repository.ts";
import { openPipelinePicker, pickPipeline } from "./pipeline-picker.ts";
import {
  addedBasePipeline,
  addedProjectPipeline,
  breakProjectPipelinesOf,
} from "./project-pipelines.ts";
import { createFromTopBar } from "./top-bar.ts";
import { screenshotScenario } from "./task-screenshots.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");
let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

/** Adds a Project through the API; every test has its own, as the board holds them all. */
async function addedProject(
  page: Page,
  name: string,
  label: string,
  repositoryPath = repository.path,
): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repositoryPath,
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
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

async function createdTask(page: Page, project: Project, title: string): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  expect(response.status()).toBe(201);
  return taskSchema.parse(await response.json());
}

/** Gives the Task a Pipeline, which a new Task has none of until it is chosen. */
async function choosePipeline(page: Page, task: Task, pipelineId = "full"): Promise<void> {
  const response = await page.request.put(`/api/tasks/${task.id}/pipeline`, {
    data: { pipelineId },
  });
  expect(response.status()).toBe(200);
}

/** A Thread of the Task, seeded with the messages. */
async function seedThread(
  taskId: string,
  title: string,
  messages: readonly Record<string, unknown>[],
): Promise<string> {
  const threadId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at)
     values ($1, 'task', $2, 'planner', $3, 'waiting', $4, now())`,
    [threadId, taskId, title, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
  for (const message of messages) {
    await queryOfficeDatabase(
      `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
      [crypto.randomUUID(), threadId, { roleKey: "planner", ...message }],
    );
  }
  return threadId;
}

/** Messages enough for a Thread's list to scroll. */
const SCROLLING_MESSAGES = Array.from({ length: 20 }, () => ({
  kind: "person",
  text: "Enough words to take a line or two in the column, as a real log would read.",
}));

/** A Thread of the person's on the Task, waiting. */
async function seedWaitingThread(taskId: string, roleKey: string): Promise<string> {
  const threadId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, state, tokens, started_at)
     values ($1, 'task', $2, $3, 'waiting', $4, now())`,
    [threadId, taskId, roleKey, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
  return threadId;
}

/** Sets the Thread's state, then has it raise a Thread event as starting and stopping do. */
async function moveThreadTo(
  page: Page,
  threadId: string,
  state: "answering" | "waiting",
  title: string,
): Promise<void> {
  await queryOfficeDatabase(`update threads set state = $2 where id = $1`, [threadId, state]);
  const renamed = await page.request.put(`/api/threads/${threadId}/title`, { data: { title } });
  expect(renamed.ok()).toBe(true);
}

/** What the page's CSS animations move, sorted: anything but transform and opacity repaints each frame. */
function animatedProperties(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const notProperties = new Set(["offset", "computedOffset", "easing", "composite"]);
    const properties = document
      .getAnimations()
      .filter((animation) => animation instanceof CSSAnimation)
      .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes())
      .flatMap((keyframe) => Object.keys(keyframe))
      .filter((property) => !notProperties.has(property));
    return [...new Set(properties)].toSorted();
  });
}

/**
 * Waits until every animation that ends has ended, such as the palette's transitions. Endless ones,
 * like the Needs you figure's pulse while something waits, never end, so they are left running.
 */
async function animationsSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.effect?.getComputedTiming().iterations === Infinity),
  );
}

/** An element's words, its height, and how far they run past it. Runs in the browser. */
function sizeOf(shown: Element): {
  words: string | null;
  height: number;
  overflow: { across: number; down: number };
} {
  return {
    words: shown.textContent,
    height: shown.clientHeight,
    overflow: {
      across: shown.scrollWidth - shown.clientWidth,
      down: shown.scrollHeight - shown.clientHeight,
    },
  };
}

function column(page: Page, state: string): Locator {
  return page.getByRole("region", { name: state, exact: true });
}

/** The titles of a column's cards in the Project, top to bottom. */
async function titlesIn(page: Page, state: string, titles: readonly string[]): Promise<string[]> {
  const shown = await column(page, state)
    .getByRole("article")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
  return shown.filter((title) => titles.includes(title));
}

test(
  "the conversation's foot stays in the window beside the record, and a Thread of only tool activity says so",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Conversation fit", "CF");
    const task = await createdTask(page, project, "A long conversation");
    const words = "Enough words to take a line or two in the column, as a real log would read.";
    await seedThread(
      task.id,
      "Long",
      Array.from({ length: 40 }, () => ({ kind: "person", text: words })),
    );
    await page.goto(`/tasks/${task.id}`);

    const conversation = page.getByRole("complementary", { name: "Conversation" });
    const pageScroller = page.locator(".shell-main");
    const footBottom = async (): Promise<number> => {
      const box = await conversation.boundingBox();
      if (box === null) throw new Error("The conversation shows.");
      return box.y + box.height;
    };
    await expect(conversation.getByText(words).first()).toBeVisible();
    await pageScroller.evaluate((view) => view.scrollTo({ top: view.scrollHeight }));
    await expect.poll(footBottom).toBeLessThanOrEqual(900);
    await pageScroller.evaluate((view) => view.scrollTo({ top: 0 }));
    await expect.poll(async () => (await conversation.boundingBox())?.height).toBeGreaterThan(300);

    const hidden = "Tool activity is hidden. Turn on Details to see it.";
    const toolsOnly = await createdTask(page, project, "Only tool activity");
    await seedThread(
      toolsOnly.id,
      "Reading",
      Array.from({ length: 3 }, (_, index) => ({
        kind: "tool-activity",
        tool: "Read",
        summary: `Read file ${index}`,
      })),
    );
    await page.goto(`/tasks/${toolsOnly.id}`);
    await expect(conversation.getByText(hidden)).toHaveCount(1);
    await conversation.getByRole("group", { name: "Details" }).getByRole("switch").click();
    const fold = conversation.getByText("3 tool calls");
    await expect(fold).toBeVisible();
    await expect(conversation.locator(".tool-call-latest")).toHaveText("Read Read file 2");
    await expect(conversation.getByText(hidden)).toHaveCount(0);
    await fold.click();
    await expect(conversation.getByText("Read file 0")).toBeVisible();
  },
);

test(
  "a tool call's command shows whole in a narrow window, and only a very long one scrolls",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Whole commands", "WC");
    const task = await createdTask(page, project, "Commands to read");
    const severalLines = "git status\ngit log --oneline -5";
    const veryLong = Array.from({ length: 80 }, (_, line) => `echo line ${line}`).join("\n");
    const unbroken = `npx vitest run ${"apps/service/src/a.test.ts,".repeat(12)}`;
    await seedThread(task.id, "Commands", [
      ...SCROLLING_MESSAGES,
      ...[severalLines, unbroken, veryLong].map((summary) => ({
        kind: "tool-activity",
        tool: "Bash",
        summary,
      })),
    ]);
    await page.setViewportSize({ width: 380, height: 800 });
    await page.goto(`/tasks/${task.id}`);
    const handle = page.getByRole("button", { name: /^Conversation/ });
    await handle.click();
    const conversation = page.getByRole("complementary", { name: "Conversation" });
    const details = conversation.getByRole("group", { name: "Details" }).getByRole("switch");
    await details.click();

    await conversation.getByText("3 tool calls").click();
    const commands = conversation.locator(".tool-calls .message-summary");
    await expect(commands).toHaveCount(3);
    const [lines, wrapped, scrolling] = await Promise.all(
      (await commands.all()).map((command) => command.evaluate(sizeOf)),
    );
    expect([lines?.words, wrapped?.words, scrolling?.words]).toEqual([
      severalLines,
      unbroken,
      veryLong,
    ]);
    expect(lines?.overflow).toEqual({ across: 0, down: 0 });
    expect(wrapped?.overflow).toEqual({ across: 0, down: 0 });
    expect(wrapped?.height).toBeGreaterThan(lines?.height ?? Infinity);
    expect(scrolling?.overflow.across).toBe(0);
    expect(scrolling?.overflow.down).toBeGreaterThan(0);
    expect(scrolling?.height).toBe(320);
    await commands.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-380-whole-commands.png") });

    // With Details off the latest command folds to one row beside "is working", and opens to it whole.
    await queryOfficeDatabase(`update threads set state = 'answering' where home_id = $1`, [
      task.id,
    ]);
    try {
      await page.reload();
      await handle.click();
      await details.click();
      const working = conversation.locator(".message-answering");
      const fold = working.locator("details");
      const closedLine = await fold.locator(".tool-call-latest").evaluate(sizeOf);
      const closedRow = await working.evaluate(sizeOf);
      expect(closedLine.overflow.across).toBeGreaterThan(0);
      expect(closedLine.overflow.down).toBe(0);
      expect(closedRow.overflow).toEqual({ across: 0, down: 0 });
      expect(closedRow.height).toBeLessThan(2 * closedLine.height);
      await expect(fold.locator(".message-summary")).toBeHidden();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-380-working-closed.png") });

      const pageScroller = page.locator(".shell-main");
      const pageTop = await pageScroller.evaluate((view) => view.scrollTop);
      await fold.locator("summary").click();
      const whole = fold.locator(".message-summary");
      await expect(whole).toBeInViewport({ ratio: 1 });
      const opened = await whole.evaluate(sizeOf);
      expect(opened.words).toBe(veryLong);
      expect(opened.overflow.across).toBe(0);
      expect(opened.height).toBe(320);
      expect(await pageScroller.evaluate((view) => view.scrollTop)).toBe(pageTop);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-380-working-open.png") });
    } finally {
      await queryOfficeDatabase(`update threads set state = 'waiting' where home_id = $1`, [
        task.id,
      ]);
    }
  },
);

test(
  "a tool call opened at the end of a Stage's Thread comes into view, the page around it still",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Working fold", "WF");
    const task = await createdTask(page, project, "A Task on a long command");
    await choosePipeline(page, task);
    const command = Array.from({ length: 12 }, (_, line) => `echo line ${line}`).join("\n");
    const threadId = await seedThread(task.id, "Long command", [
      ...SCROLLING_MESSAGES,
      { kind: "tool-activity", tool: "Bash", summary: command },
    ]);
    const noTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    const stages: TaskStages = {
      stages: [
        {
          stage: {
            kind: "agent",
            key: "implement",
            name: "Implement",
            optional: false,
            role: "planner",
            brief: "Do it.",
            session: "fresh",
            budget: 100_000,
          },
          state: "running",
          tokens: noTokens,
          wentBack: null,
          runs: [{ ...aStageRun(1, at(0), null), threadId, session: "fresh" }],
        },
      ],
      editedForTask: false,
      lockedStages: 1,
      testResults: [],
      definitionOfDoneMet: [],
      definitionOfDoneOutOfReach: [],
      gatesCheckingDefinitionOfDone: [],
    };
    await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
    await queryOfficeDatabase(`update threads set state = 'answering' where id = $1`, [threadId]);
    try {
      await page.goto(`/tasks/${task.id}`);
      await page
        .getByRole("region", { name: /^Pipeline · / })
        .getByRole("button", { name: "Implement", exact: true })
        .click();
      const history = page.getByRole("dialog", { name: /^Stage history: Implement/ });
      await history.getByRole("tab", { name: "Thread" }).click();

      const fold = history.locator(".message-answering details");
      const pageScroller = page.locator(".shell-main");
      const pageTop = await pageScroller.evaluate((view) => view.scrollTop);
      await fold.locator("summary").click();
      const whole = fold.locator(".message-summary");
      await expect(whole).toBeInViewport({ ratio: 1 });
      expect(await whole.textContent()).toBe(command);
      expect(await pageScroller.evaluate((view) => view.scrollTop)).toBe(pageTop);
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-stage-thread-working-open.png"),
      });
    } finally {
      await queryOfficeDatabase(`update threads set state = 'waiting' where id = $1`, [threadId]);
    }
  },
);

test("the user captures an Idea from Now in a few keystrokes", async ({ page }) => {
  await page.goto("/now");

  await page.getByRole("button", { name: "Create", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New Task" });
  await expect(create.getByRole("tab")).toHaveText(["Task", "Idea"]);
  await expect(create.getByRole("tab", { name: "Task" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-create.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await createFromTopBar(page, "Idea");
  await page.keyboard.type("Nightly dependency updates");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Idea captured: Nightly dependency updates.")).toBeVisible();
  await page.goto("/work/ideas");
  const card = page.getByRole("article", { name: "Nightly dependency updates" });
  await expect(card.getByText("Office-wide")).toBeVisible();
  await expect(card.getByText(/You captured it/)).toBeVisible();
});

test(
  "an Idea names the user who captured it: You on the user's own, another user by name",
  { tag: "@full" },
  async ({ page }) => {
    const capture = async (title: string): Promise<Idea> => {
      const captured = await page.request.post("/api/ideas", {
        data: { title, notes: "", projectId: null },
      });
      expect(captured.status()).toBe(201);
      return ideaSchema.parse(await captured.json());
    };
    const own = await capture("Ideas name their user");
    expect(own.capturedBy).toEqual({
      kind: "user",
      user: { userId: expect.any(String), name: E2E_USER.name },
    });
    // A second user can't be added from the UI yet, so their Idea is written as theirs here.
    const theirs = await capture("Ann's Idea about release notes");
    await queryOfficeDatabase(`update ideas set captured_by = $2 where id = $1`, [
      theirs.id,
      JSON.stringify({ kind: "user", user: { userId: crypto.randomUUID(), name: "Ann Lee" } }),
    ]);

    await page.goto("/work/ideas");

    const ownCard = page.getByRole("article", { name: "Ideas name their user" });
    await expect(ownCard.getByText(/You captured it/)).toBeVisible();
    await expect(ownCard.getByText(E2E_USER.name)).toHaveCount(0);
    const theirCard = page.getByRole("article", { name: "Ann's Idea about release notes" });
    await expect(theirCard.getByText(/Ann Lee captured it/)).toBeVisible();
    await theirCard.scrollIntoViewIfNeeded();
    await screenshotScenario(page, "ideas-captured-by-user");
  },
);

test("the user edits an Idea not yet shaped from its card", { tag: "@full" }, async ({ page }) => {
  const captured = await page.request.post("/api/ideas", {
    data: { title: "Weekly usage digest", notes: "", projectId: null },
  });
  expect(captured.status()).toBe(201);
  await page.goto("/work/ideas");

  await page
    .getByRole("article", { name: "Weekly usage digest" })
    .getByRole("button", { name: "More for Weekly usage digest" })
    .click();
  await page.getByRole("menu").getByRole("button", { name: "Edit…" }).click();
  const edit = page.getByRole("dialog").filter({ hasText: "Edit the Idea" });
  await expect(edit.getByLabel("Idea")).toHaveValue("Weekly usage digest");
  await edit.getByLabel("Idea").fill("Monthly usage digest");
  await edit.getByLabel("Notes").fill("Sent on the first of each month.");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-idea-edit.png") });
  await edit.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Idea saved: Monthly usage digest.")).toBeVisible();
  const card = page.getByRole("article", { name: "Monthly usage digest" });
  await expect(card.getByText("Sent on the first of each month.")).toBeVisible();
});

test("an Idea's link opens Ideas at its card, marked", { tag: "@full" }, async ({ page }) => {
  const captured = await page.request.post("/api/ideas", {
    data: { title: "Linked Idea for the night shift", notes: "", projectId: null },
  });
  expect(captured.status()).toBe(201);
  const { id: ideaId } = ideaSchema.parse(await captured.json());

  await page.goto(recordPath({ kind: "idea", ideaId }));

  await expect(
    page.getByRole("article", { name: "Linked Idea for the night shift" }),
  ).toHaveAttribute("aria-current", "true");
});

test(
  "an Idea with Attachments is shaped into a Task in Backlog, and another is dropped",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Usage reports", "UR");
    await page.goto(`/projects/${project.id}`);

    await createFromTopBar(page, "Idea");
    const capture = page.getByRole("dialog").filter({ hasText: "Capture an Idea" });
    await capture.getByLabel("Idea").fill("Export usage as CSV");
    await capture.getByLabel("Notes").fill("Monthly, per Project, for the accountant.");
    await capture.getByRole("button", { name: "Add a file, screenshot or link" }).click();
    await capture.getByLabel("File to attach").setInputFiles({
      name: "format.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# CSV format\n\nOne row per day."),
    });
    await capture.getByText("Link", { exact: true }).click();
    await capture.getByLabel("Address").fill("https://example.com/csv");
    await capture.getByLabel("Name").fill("CSV conventions");
    await capture.getByRole("button", { name: "Add the link" }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-idea-capture.png") });
    await capture.getByLabel("Idea").press("Enter");
    await expect(page.getByText("Idea captured: Export usage as CSV.")).toBeVisible();

    await page.goto("/work/ideas");
    const card = page.getByRole("article", { name: "Export usage as CSV" });
    await expect(card.getByText("Usage reports")).toBeVisible();
    await expect(card.getByRole("link", { name: "CSV conventions" })).toHaveAttribute(
      "href",
      "https://example.com/csv",
    );
    await card.getByRole("button", { name: "format.md" }).click();
    const format = page.getByRole("dialog").filter({ hasText: "format.md" });
    await expect(format.getByRole("heading", { name: "CSV format" })).toBeVisible();
    await expect(format).not.toContainText("# CSV format");
    await expect(format).toContainText("One row per day.");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-document.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-document.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await page
      .getByRole("dialog")
      .filter({ hasText: "format.md" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-ideas.png") });

    await card.getByRole("button", { name: "Shape into a Task" }).click();
    await expect(page.getByText("Export usage as CSV is a Task in Backlog.")).toBeVisible();
    // Other files' Ideas may have become Tasks already, so this one's row is named in full.
    await expect(page.getByText("· became Export usage as CSV")).toBeVisible();

    await createFromTopBar(page, "Idea");
    await page.keyboard.type("Voice notes to the Office Manager");
    await page.keyboard.press("Enter");
    const dropped = page.getByRole("article", { name: "Voice notes to the Office Manager" });
    await dropped
      .getByRole("button", { name: "More for Voice notes to the Office Manager" })
      .click();
    await page.getByRole("menu").getByRole("button", { name: "Drop" }).click();
    await expect(dropped).toHaveCount(0);
    await page.getByText(/^Dropped · /).click();
    await expect(
      page.getByText("Voice notes to the Office Manager", { exact: true }),
    ).toBeVisible();

    await page.goto("/work");
    const task = column(page, "Backlog").getByRole("article", { name: "Export usage as CSV" });
    await expect(task.getByText("UR")).toBeVisible();
  },
);

test(
  "dragging a card reorders its column, and the order survives a reload",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Board order", "BO");
    const titles = ["Order first", "Order second", "Order third"];
    for (const title of titles) await createdTask(page, project, title);
    await page.goto("/work");
    // Only this Project's cards: one added by a test running alongside moves these under the drag.
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Board order" }).click();
    await expect.poll(() => titlesIn(page, "Backlog", titles)).toEqual(titles);

    const backlog = column(page, "Backlog");
    await backlog
      .getByRole("article", { name: "Order third" })
      .dragTo(backlog.getByRole("article", { name: "Order first" }));

    const reordered = ["Order third", "Order first", "Order second"];
    await expect.poll(() => titlesIn(page, "Backlog", titles)).toEqual(reordered);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-board.png") });
    await page.reload();
    await expect.poll(() => titlesIn(page, "Backlog", titles)).toEqual(reordered);
  },
);

/** An Initiative made active in the database, as confirming one needs the CTO's session; gives its id. */
async function seedActiveInitiative(page: Page, name: string, createdAt: string): Promise<string> {
  return seedInitiative(page, name, { state: "active", createdAt });
}

/** An Initiative in any state, made in the database; a Done or Dropped one ended at `endedAt`. */
async function seedInitiative(
  page: Page,
  name: string,
  {
    state,
    createdAt,
    endedAt = null,
    outcome = "",
  }: {
    readonly state: InitiativeState;
    readonly createdAt: string;
    readonly endedAt?: string | null;
    readonly outcome?: string;
  },
): Promise<string> {
  const idea = await page.request.post("/api/ideas", {
    data: { title: name, notes: "", projectId: null },
  });
  expect(idea.status()).toBe(201);
  const { id: ideaId } = ideaSchema.parse(await idea.json());
  const initiativeId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into initiatives
       (id, name, outcome, state, origin_idea_id, created_by, created_at, ended_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [initiativeId, name, outcome, state, ideaId, { kind: "user" }, createdAt, endedAt],
  );
  return initiativeId;
}

/** A Task in Backlog, part of the Initiative. */
async function seedTaskOf(
  page: Page,
  project: Project,
  title: string,
  initiativeId: string | null,
): Promise<void> {
  const task = await createdTask(page, project, title);
  await queryOfficeDatabase(`update tasks set initiative_id = $2 where id = $1`, [
    task.id,
    initiativeId,
  ]);
}

/** The cards' titles in a group's column, top to bottom. */
function titlesInGroup(page: Page, state: string, group: string): Promise<string[]> {
  return page
    .getByRole("region", { name: `${state}, ${group}`, exact: true })
    .getByRole("article")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
}

test(
  "the board groups by Initiative, kept in its address and remembered, its folds remembered, a card reordering only inside its group",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Grouped work", "GW");
    const radio = await seedActiveInitiative(page, "Grouped radio", "2026-11-09T10:00:00.000Z");
    const display = await seedActiveInitiative(page, "Grouped display", "2026-11-08T10:00:00.000Z");
    const radioTitles = ["Grouped radio first", "Grouped radio second", "Grouped radio third"];
    for (const title of radioTitles) await seedTaskOf(page, project, title, radio);
    await seedTaskOf(page, project, "Grouped display first", display);
    await seedTaskOf(page, project, "Grouped loose first", null);
    await page.goto("/work");
    // Only this Project's cards, so the groups other tests leave stay out.
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Grouped work" }).click();

    // Exact, as an Initiative's block in a column is a group too.
    const layout = page.getByRole("group", { name: "Layout", exact: true });
    await layout.getByRole("switch").click();
    await expect(page).toHaveURL(/group=initiative/);
    await page.reload();
    await expect(layout.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    const groups = page.locator(".board-group");
    await expect
      .poll(() =>
        groups.evaluateAll((shown) => shown.map((group) => group.getAttribute("aria-label"))),
      )
      .toEqual(["Grouped radio", "Grouped display", "No Initiative"]);
    const radioGroup = page.getByRole("region", { name: "Grouped radio", exact: true });
    await expect(radioGroup.getByText("3 on the board")).toBeVisible();
    await expect(radioGroup.getByText("0 of 3 Tasks done")).toBeVisible();
    await expect(
      radioGroup.getByRole("link", { name: "Open Initiative Grouped radio" }),
    ).toBeVisible();

    const displayGroup = page.getByRole("region", { name: "Grouped display", exact: true });
    const displayFold = displayGroup.getByRole("button", { name: "Grouped display", exact: true });
    await displayFold.click();
    await expect(displayFold).toHaveAttribute("aria-expanded", "false");
    await expect(displayGroup.getByText("Backlog 1", { exact: true })).toBeVisible();
    await expect(displayGroup.getByRole("article")).toHaveCount(0);
    await page.reload();
    await expect(displayFold).toHaveAttribute("aria-expanded", "false");
    await expect(page).not.toHaveURL(/fold/);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-board-grouped.png") });

    const radioBacklog = page.getByRole("region", { name: "Backlog, Grouped radio", exact: true });
    await radioBacklog
      .getByRole("article", { name: "Grouped radio third" })
      .dragTo(radioBacklog.getByRole("article", { name: "Grouped radio first" }));
    const reordered = ["Grouped radio third", "Grouped radio first", "Grouped radio second"];
    await expect.poll(() => titlesInGroup(page, "Backlog", "Grouped radio")).toEqual(reordered);

    const looseCard = page
      .getByRole("region", { name: "Backlog, No Initiative", exact: true })
      .getByRole("article", { name: "Grouped loose first" });
    // Both cards in view before the drag: a page scrolled mid-drag can lose the drop.
    await looseCard.scrollIntoViewIfNeeded();
    await radioBacklog.getByRole("article", { name: "Grouped radio first" }).dragTo(looseCard);
    await expect(
      page.getByText(
        "A card moves only within its own group: the board doesn't change a Task's Initiative.",
      ),
    ).toBeVisible();
    await page.reload();
    await expect.poll(() => titlesInGroup(page, "Backlog", "Grouped radio")).toEqual(reordered);
    await expect
      .poll(() => titlesInGroup(page, "Backlog", "No Initiative"))
      .toEqual(["Grouped loose first"]);

    await filterByInitiative(page, "Grouped display");
    await expect(groups).toHaveCount(1);
    // Alone, its group is always open, its name plain.
    await expect(
      displayGroup.getByRole("article", { name: "Grouped display first" }),
    ).toBeVisible();
    await expect(displayFold).toHaveCount(0);
    await expect(layout.getByRole("button", { name: /Fold all|Unfold all/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear the Initiative filter" }).click();
    await expect(page).not.toHaveURL(/initiative=/);
    await expect(
      page.getByRole("search", { name: "Filter the board" }).getByRole("combobox", {
        name: "Initiative",
      }),
    ).toHaveValue("");
    await expect(displayFold).toBeVisible();

    // Remembered in this browser: an address without `group` opens the board as last chosen.
    await page.goto("/work");
    await expect(layout.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(groups.first()).toBeVisible();
    await layout.getByRole("switch").click();
    await expect(page).not.toHaveURL(/group=/);
    await page.goto("/work");
    await expect(layout.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await expect(groups).toHaveCount(0);
  },
);

/** A column's items, top to bottom: each block's Initiative, or a loose card's title. */
function itemsIn(page: Page, state: string): Promise<string[]> {
  return column(page, state)
    .locator(".board-cards > *")
    .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label") ?? ""));
}

/** A block's cards' titles, top to bottom. */
function titlesInBlock(block: Locator): Promise<string[]> {
  return block
    .getByRole("article")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
}

test(
  "a column gathers an Initiative's cards into a block, a card reordering only inside its block",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Block work", "BW");
    const radio = await seedActiveInitiative(page, "Block radio", "2026-11-09T10:00:00.000Z");
    const display = await seedActiveInitiative(page, "Block display", "2026-11-08T10:00:00.000Z");
    await seedTaskOf(page, project, "Block radio first", radio);
    await seedTaskOf(page, project, "Block loose first", null);
    await seedTaskOf(page, project, "Block display first", display);
    await seedTaskOf(page, project, "Block radio second", radio);
    await seedTaskOf(page, project, "Block radio third", radio);
    await page.goto("/work");
    // Only this Project's cards, so the blocks other tests leave stay out.
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Block work" }).click();

    // A block sits where its first card falls, gathering its later cards; a loose card keeps its place.
    await expect
      .poll(() => itemsIn(page, "Backlog"))
      .toEqual(["Block radio", "Block loose first", "Block display"]);
    const backlog = column(page, "Backlog");
    await expect(backlog.getByRole("heading")).toHaveText("Backlog 5");
    const radioBlock = backlog.getByRole("group", { name: "Block radio", exact: true });
    await expect
      .poll(() => titlesInBlock(radioBlock))
      .toEqual(["Block radio first", "Block radio second", "Block radio third"]);
    await expect(radioBlock.getByRole("img", { name: "3 of its Tasks in Backlog" })).toHaveText(
      "3",
    );
    await expect(
      radioBlock.getByRole("link", { name: "Block radio", exact: true }),
    ).toHaveAttribute("href", `/work/initiatives/${radio}`);
    await expect(
      backlog.getByRole("group", { name: "Block display", exact: true }).getByRole("article"),
    ).toHaveCount(1);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-board-blocks.png") });

    await radioBlock
      .getByRole("article", { name: "Block radio third" })
      .dragTo(radioBlock.getByRole("article", { name: "Block radio first" }));
    await expect
      .poll(() => titlesInBlock(radioBlock))
      .toEqual(["Block radio third", "Block radio first", "Block radio second"]);
    // Dropped on the head, which holds no card, it lands before the block's first card.
    await radioBlock
      .getByRole("article", { name: "Block radio second" })
      .dragTo(radioBlock.getByRole("link", { name: "Block radio", exact: true }));
    const reordered = ["Block radio second", "Block radio third", "Block radio first"];
    await expect.poll(() => titlesInBlock(radioBlock)).toEqual(reordered);

    await backlog
      .getByRole("article", { name: "Block display first" })
      .dragTo(radioBlock.getByRole("article", { name: "Block radio first" }));
    await expect(
      page.getByText(
        "A card moves only within its own block: the board doesn't change a Task's Initiative.",
      ),
    ).toBeVisible();
    await backlog
      .getByRole("article", { name: "Block loose first" })
      .dragTo(radioBlock.getByRole("article", { name: "Block radio second" }));
    await expect(
      page.getByText(
        "A card with no Initiative moves only among the cards outside the blocks: the board doesn't change a Task's Initiative.",
      ),
    ).toBeVisible();
    await page.reload();
    await expect
      .poll(() => itemsIn(page, "Backlog"))
      .toEqual(["Block radio", "Block loose first", "Block display"]);
    await expect.poll(() => titlesInBlock(radioBlock)).toEqual(reordered);

    // With the Initiative filter set, the columns are flat.
    await filterByInitiative(page, "Block display");
    await expect(backlog.getByRole("article", { name: "Block display first" })).toBeVisible();
    await expect(page.locator(".board").getByRole("group")).toHaveCount(0);
  },
);

/** Types the Initiative's name in the board's Initiative filter and picks it among the matches. */
async function filterByInitiative(page: Page, name: string): Promise<void> {
  const filter = page
    .getByRole("search", { name: "Filter the board" })
    .getByRole("combobox", { name: "Initiative" });
  await filter.fill(name);
  await page
    .getByRole("listbox", { name: "Initiative" })
    .getByRole("option", { name, exact: true })
    .click();
  await expect(filter).toHaveValue(name);
}

/** A word no other test's records hold, so a search shows only this test's Initiatives. */
function aWordOfItsOwn(): string {
  return `w${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("the Initiatives tab is a board by state, Dropped folded at the foot of Done and remembered, narrowed by search and Waiting on you", async ({
  page,
}) => {
  const word = aWordOfItsOwn();
  const project = await addedProject(page, "Initiative board", "IB");
  await seedInitiative(page, `Telemetry ${word}`, { state: "shaping", createdAt: daysAgo(1) });
  const active = await seedInitiative(page, `Offline sync ${word}`, {
    state: "active",
    createdAt: daysAgo(3),
    outcome: "Notes open with no network.",
  });
  await seedTaskOf(page, project, `Sync queue ${word}`, active);
  await seedTaskOf(page, project, `Conflict view ${word}`, active);
  await queryOfficeDatabase(`update tasks set state = 'waiting-on-you' where title = $1`, [
    `Sync queue ${word}`,
  ]);
  await seedInitiative(page, `Usage reports ${word}`, {
    state: "done",
    createdAt: daysAgo(20),
    endedAt: daysAgo(2),
  });
  await seedInitiative(page, `Map tiles ${word}`, {
    state: "dropped",
    createdAt: daysAgo(20),
    endedAt: daysAgo(6),
  });
  await seedInitiative(page, `Slack notifications ${word}`, {
    state: "dropped",
    createdAt: daysAgo(20),
    endedAt: daysAgo(4),
  });

  await page.goto(`/work/initiatives?query=${word}`);
  const shaping = column(page, "Shaping");
  const activeColumn = column(page, "Active");
  const done = column(page, "Done");
  await expect(shaping.getByRole("heading")).toHaveText("Shaping 1");
  await expect(shaping.getByRole("article", { name: `Telemetry ${word}` })).toContainText(
    "No Task yet",
  );
  const activeCard = activeColumn.getByRole("article", { name: `Offline sync ${word}` });
  await expect(activeCard).toContainText("0 of 2 Tasks done");
  await expect(activeCard).toContainText("1 waiting on you");
  await expect(activeCard).toHaveClass(/edge-decision/);
  await expect(done.getByRole("article", { name: `Usage reports ${word}` })).not.toHaveClass(
    /edge-/,
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-initiatives-board.png") });

  // Dropped is never mixed with Done: folded at its foot, the latest named, until unfolded.
  const droppedFold = done.getByRole("button", { name: /^Dropped 2/ });
  await expect(droppedFold).toHaveAttribute("aria-expanded", "false");
  await expect(droppedFold).toContainText(`Latest: Slack notifications ${word}`);
  await expect(done.getByRole("article", { name: `Map tiles ${word}` })).toHaveCount(0);
  await droppedFold.click();
  await expect
    .poll(() =>
      done
        .getByRole("article")
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label"))),
    )
    .toEqual([`Usage reports ${word}`, `Slack notifications ${word}`, `Map tiles ${word}`]);
  await page.goto("/work");
  await page.goto(`/work/initiatives?query=${word}`);
  await expect(droppedFold).toHaveAttribute("aria-expanded", "true");
  await droppedFold.click();

  // Waiting on you, kept in the address, beside the search, until Clear.
  const filters = page.getByRole("search", { name: "Filter the Initiatives" });
  await filters.getByRole("button", { name: /Waiting on you/ }).click();
  await expect(page).toHaveURL(/waiting=1/);
  await page.reload();
  await expect(shaping.getByText("None matches the filters.")).toBeVisible();
  await expect(activeCard).toBeVisible();
  await expect(done.getByRole("article")).toHaveCount(0);
  await filters.getByRole("button", { name: "Clear" }).click();
  await expect(page).not.toHaveURL(/waiting=|query=/);
  await expect(page.getByRole("searchbox", { name: "Search Initiatives" })).toHaveValue("");
  await page.getByRole("searchbox", { name: "Search Initiatives" }).fill(word);
  await expect(page).toHaveURL(new RegExp(`query=${word}`));
  await expect(activeColumn.getByRole("article")).toHaveCount(1);

  // At 390px the columns stack and nothing scrolls sideways, in the Dark palette too.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(activeCard).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: path.join(SCREENSHOTS, "dark-390-initiatives-board.png"),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "light" });

  // Waiting on you holds a desk: free it, or later tests find every desk in use.
  await queryOfficeDatabase(`update tasks set state = 'dropped' where title = $1`, [
    `Sync queue ${word}`,
  ]);
});

test("dropping an active Initiative asks first, naming the Tasks it drops, and its Task shows as Dropped on the board", async ({
  page,
}) => {
  const word = aWordOfItsOwn();
  const name = `Offline maps ${word}`;
  const project = await addedProject(page, "Initiative drop", "ID");
  const initiativeId = await seedInitiative(page, name, { state: "active", createdAt: daysAgo(2) });
  await seedTaskOf(page, project, `Tile cache ${word}`, initiativeId);

  await page.goto(`/work/initiatives/${initiativeId}`);
  await page.getByRole("button", { name: `More for ${name}` }).click();
  await page.getByRole("menu").getByRole("button", { name: "Drop the Initiative" }).click();
  const dialog = page.getByRole("dialog", { name: `Drop ${name}?` });
  await expect(dialog).toContainText(
    "It drops its 1 Task not yet Done or Dropped, not started yet.",
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-drop-initiative.png") });
  await dialog.getByRole("button", { name: "Drop the Initiative" }).click();
  await expect(page.getByText("Initiative dropped, with its 1 open Task.")).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.goto("/work");
  await page.getByLabel("Search Tasks").fill(word);
  const card = column(page, "Done").getByRole("article", { name: `Tile cache ${word}` });
  await expect(card.getByRole("img", { name: "Dropped" })).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-dropped-initiative-board.png"),
  });
});

test(
  "an ended Initiative is archived from its card, found from the board's search in the Archived tab, and restored to Done",
  { tag: "@full" },
  async ({ page }) => {
    const word = aWordOfItsOwn();
    const name = `Usage reports ${word}`;
    const initiativeId = await seedInitiative(page, name, {
      state: "done",
      createdAt: daysAgo(9),
      endedAt: daysAgo(3),
    });
    // Within the Archive period, so the daily run, which starts with the service, leaves it be.
    await seedInitiative(page, `Map tiles ${word}`, {
      state: "dropped",
      createdAt: daysAgo(40),
      endedAt: daysAgo(5),
    });
    const card = column(page, "Done").getByRole("article", { name });
    await page.goto(`/work/initiatives?query=${word}`);
    await column(page, "Done")
      .getByRole("button", { name: /^Dropped 1/ })
      .click();
    await page.getByRole("button", { name: `More for Map tiles ${word}` }).click();
    await page.getByRole("menu").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(`Map tiles ${word} is archived.`)).toBeVisible();

    await card.getByRole("button", { name: `More for ${name}` }).click();
    await page.getByRole("menu").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(`${name} is archived.`)).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(page.getByText(`2 archived Initiatives match “${word}” too.`)).toBeVisible();

    await page.getByRole("button", { name: "Search the archive" }).click();
    await expect(page).toHaveURL(new RegExp(`/work/archived\\?kind=initiatives&query=${word}`));
    const archive = page.getByRole("table");
    await expect(archive.getByRole("row", { name: new RegExp(name) })).toContainText("Done");
    const filters = page.getByRole("search", { name: "Filter the archived Initiatives" });
    await expect(filters.getByRole("button", { name: /^All/ })).toContainText("2");
    await filters.getByRole("button", { name: /^Dropped/ }).click();
    await expect(page).toHaveURL(/state=dropped/);
    await expect(archive.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
    await expect(archive).toContainText(`Map tiles ${word}`);
    await filters.getByRole("button", { name: /^All/ }).click();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-archived-initiatives.png") });

    await page.goto(`/work/initiatives/${initiativeId}`);
    await expect(page.locator(".task-head")).toContainText(/Archived \d+ \w+/);
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-archived-initiative-page.png"),
    });
    await page.getByRole("button", { name: `Restore ${name}` }).click();
    await expect(page.getByText(`${name} is back on the board.`)).toBeVisible();
    await expect(page.locator(".task-head")).not.toContainText("Archived");

    await page.goto(`/work/initiatives?query=${word}`);
    await expect(card).toContainText("Done");
    await page.goto(`/work/archived?kind=initiatives&query=${word}`);
    const oldRow = page.getByRole("row", { name: new RegExp(`Map tiles ${word}`) });
    await oldRow.getByRole("button", { name: `Restore Map tiles ${word}` }).click();
    await expect(page.getByText(`No archived Initiative matches “${word}”.`)).toBeVisible();

    // The table becomes a list of rows at 390px: nothing scrolls sideways.
    await archiveInitiative(page, initiativeId);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/work/archived?kind=initiatives&query=${word}`);
    await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
    await expect(page.getByRole("table").locator("thead")).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-390-archived-initiatives.png") });
  },
);

test("the user adds a Task to an Initiative and takes it out, on the Task's page and on the Initiative's", async ({
  page,
}) => {
  const word = aWordOfItsOwn();
  const name = `Joining sync ${word}`;
  const project = await addedProject(page, `Joining work ${word}`, "JW");
  const initiativeId = await seedActiveInitiative(page, name, "2026-11-14T10:00:00.000Z");
  const banner = await createdTask(page, project, `Joining banner ${word}`);
  const retry = await createdTask(page, project, `Joining retry ${word}`);
  const dialog = page.getByRole("dialog");

  // On the Task's page: added to the Initiative, then taken out again.
  await page.goto(`/tasks/${banner.id}`);
  const section = page
    .getByRole("region", { name: "Description" })
    .getByRole("region", { name: "Initiative" });
  await expect(section).toContainText("In no Initiative.");
  await section.getByRole("button", { name: "Add to an Initiative" }).click();
  const picker = dialog.getByRole("combobox", { name: "Initiative" });
  await picker.fill(word);
  await page
    .getByRole("listbox", { name: "Initiative" })
    .getByRole("option", { name, exact: true })
    .click();
  await expect(dialog).toContainText("It stays in Backlog.");
  await dialog.getByRole("button", { name: "Add to the Initiative" }).click();
  await expect(dialog).toBeHidden();
  await expect(section.getByRole("link", { name })).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-task-in-an-initiative.png") });

  await section.getByRole("button", { name: "Take out" }).click();
  await expect(dialog).toContainText(`Take ${banner.title} out of ${name}?`);
  await expect(dialog).toContainText("It stays in Backlog. What it waits for stays.");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-take-a-task-out.png") });
  await dialog.getByRole("button", { name: "Take out", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(section.getByRole("button", { name: "Add to an Initiative" })).toBeVisible();
  expect(
    taskSchema.parse(await (await page.request.get(`/api/tasks/${banner.id}`)).json()),
  ).toMatchObject({
    initiativeId: null,
    state: "backlog",
  });

  // On the Initiative's page: an existing Task added, then taken out.
  await page.goto(`/work/initiatives/${initiativeId}`);
  await page.getByRole("button", { name: "Add an existing Task" }).click();
  await dialog.getByRole("textbox", { name: "Find a Task" }).fill(retry.title);
  await dialog.getByText(retry.title).click();
  await expect(dialog).toContainText("It stays in Backlog.");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-add-an-existing-task.png") });
  await dialog.getByRole("button", { name: "Add the Task" }).click();
  await expect(dialog).toBeHidden();
  const graph = page.getByRole("group", { name: "Task graph" });
  await expect(graph.getByText(retry.title)).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-initiative-take-out-a-task.png") });

  await page.getByRole("button", { name: "Take out a Task" }).click();
  await expect(dialog).toContainText(`Take ${retry.title} out of ${name}?`);
  await dialog.getByRole("button", { name: "Take out", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("No Tasks yet.")).toBeVisible();
});

test(
  "an Initiative's More menu holds every action of its head, whose buttons stay on one line and hide what doesn't fit",
  { tag: "@full" },
  async ({ page }) => {
    const name = "Head actions that fit";
    const initiativeId = await seedActiveInitiative(page, name, "2026-11-16T10:00:00.000Z");
    const ACTIONS = ["Pause the Initiative", "Add a Task", "Add an existing Task"];
    const head = page.locator(".task-head-actions");

    await page.goto(`/work/initiatives/${initiativeId}`);
    for (const action of ACTIONS) {
      await expect(head.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    const more = head.getByRole("button", { name: `More for ${name}` });
    await more.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("button")).toHaveText([
      ...ACTIONS,
      "Copy link",
      "Drop the Initiative",
    ]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-initiative-head-menu.png") });
    await more.click();
    await expect(menu).toBeHidden();

    await page.setViewportSize({ width: 960, height: 900 });
    const shown = head.getByRole("button", { name: "Pause the Initiative" });
    const hidden = head.getByRole("button", { name: "Add an existing Task" });
    await expect(shown).toBeVisible();
    await expect(hidden).toBeHidden();
    // One line: the row is as high as the buttons it shows.
    const row = await head.locator(".record-actions-row").boundingBox();
    expect(row!.height).toBe((await shown.boundingBox())!.height);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-960-initiative-head.png") });

    await more.click();
    await menu.getByRole("button", { name: "Add an existing Task" }).click();
    await expect(page.getByRole("dialog")).toContainText(`Add an existing Task to ${name}`);
  },
);

test(
  "a Task's and an Idea's More menus hold the actions of their buttons too",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Menus with every action", "ME");
    const task = await createdTask(page, project, "Run with its actions in the menu");
    await choosePipeline(page, task);
    await queryOfficeDatabase(`update tasks set state = 'in-progress' where id = $1`, [task.id]);

    await page.goto(`/tasks/${task.id}`);
    const head = page.locator(".task-head-actions");
    await expect(head.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(head.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await head.getByRole("button", { name: `More for ${task.title}` }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("button")).toHaveText([
      "Pause",
      "Stop",
      "Edit Stages for this Task",
      "Move to another Project…",
      "Drop…",
    ]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-head-menu.png") });

    const idea = await page.request.post("/api/ideas", {
      data: { title: "Shape me from the menu", notes: "", projectId: project.id },
    });
    expect(idea.status()).toBe(201);
    await page.goto("/work/ideas");
    const card = page.getByRole("article", { name: "Shape me from the menu" });
    // Plan as a Task shows only while someone holds Plans.
    const options = card.locator(".idea-card-options").getByRole("button");
    await expect(options.first()).toHaveText("Shape into a Task");
    const optionWords = (await options.allInnerTexts()).map((words) => words.trim());
    await card.getByRole("button", { name: "More for Shape me from the menu" }).click();
    await expect(menu.getByRole("button")).toHaveText([
      ...optionWords,
      "Edit…",
      "Attach…",
      "Copy link",
      "Drop",
    ]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-idea-card-menu.png") });

    await queryOfficeDatabase(`update tasks set state = 'dropped' where id = $1`, [task.id]);
  },
);

async function archiveInitiative(page: Page, initiativeId: string): Promise<void> {
  expect((await page.request.post(`/api/initiatives/${initiativeId}/archive`)).ok()).toBe(true);
}

test(
  "a card shows who is working as they start and stop, and stays one link that drags",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Working now", "WN");
    const done = await createdTask(page, project, "Working card done");
    const titles = ["Working card first", "Working card movable"];
    await createdTask(page, project, titles[0] ?? "");
    const movable = await createdTask(page, project, titles[1] ?? "");
    // Done has no foot of its own, and unlike in progress it takes no desk from a test alongside.
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [done.id]);
    // Only the Caretaker is sure to be hired here, as hiring lives in people.e2e.ts.
    const workingThread = await seedWaitingThread(done.id, "caretaker");
    const movableThread = await seedWaitingThread(movable.id, "caretaker");
    const roles = roleListSchema.parse(await (await page.request.get("/api/roles")).json());
    const caretaker = roles.find(({ key }) => key === "caretaker")?.card.name;
    const words = `Working now: ${caretaker}`;

    await page.goto("/work");
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Working now" }).click();
    const card = page.getByRole("article", { name: done.title });
    const mark = card.getByRole("img", { name: words });

    // Nobody working: no mark, and a card with nothing else to say shows only its Project's mark.
    await expect(card).toBeVisible();
    await expect(mark).toHaveCount(0);
    await expect(card.locator(".board-card-marks > *")).toHaveCount(1);

    // The Thread's events refresh the mark on the open board, with no reload.
    await moveThreadTo(page, workingThread, "answering", "Started");
    await expect(mark).toBeVisible();

    // The live dot pulses without repainting the board on every frame, and not at all on reduced motion.
    expect(await animatedProperties(page)).toEqual(["opacity", "transform"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await animatedProperties(page)).toEqual([]);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await mark.hover();
    await expect(page.getByRole("tooltip")).toHaveText(words);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-working-mark.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-working-mark.png") });
    await page.emulateMedia({ colorScheme: "light" });

    await moveThreadTo(page, workingThread, "waiting", "Stopped");
    await expect(mark).toHaveCount(0);
    await expect(card.locator(".board-card-marks > *")).toHaveCount(1);

    // A Thread waiting on an open Decision shows nobody, however long it stays answering.
    const decisionId = crypto.randomUUID();
    await queryOfficeDatabase(
      `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, attachment_ids, asked_at)
     values ($1, $2, $3, 'caretaker', 'question', $4, 'Both work.', $5, $6, $7, '[]', now())`,
      [decisionId, workingThread, done.id, ...decisionColumns([aChoice("Which way?")])],
    );
    await moveThreadTo(page, workingThread, "answering", "Asking");
    const backlog = column(page, "Backlog");
    await moveThreadTo(page, movableThread, "answering", "Moving");
    const movableMark = backlog
      .getByRole("article", { name: movable.title })
      .getByRole("img", { name: words });
    await expect(movableMark).toBeVisible();
    await expect(mark).toHaveCount(0);

    // A card with the mark drags by it, and a press on it follows the card's one link.
    await movableMark.dragTo(backlog.getByRole("article", { name: "Working card first" }));
    await expect.poll(() => titlesIn(page, "Backlog", titles)).toEqual(titles.toReversed());
    await expect(
      backlog.getByRole("article", { name: movable.title }).getByRole("link"),
    ).toHaveCount(1);
    await movableMark.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${movable.id}`));

    // Nothing stays behind for the tests alongside: no Decision in Needs you, nobody answering.
    await queryOfficeDatabase(`delete from decisions where id = $1`, [decisionId]);
    await queryOfficeDatabase(`update threads set state = 'waiting' where id = any($1)`, [
      [workingThread, movableThread],
    ]);
  },
);

test(
  "a card names the current Stage before the avatars of the person working it, cut when narrow",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Stage worked now", "SW");
    const task = await createdTask(page, project, "Stage card");
    const stageName = "Implement every part of the Plan across the service and the web app";
    // Paused, as a Task in progress would take a desk from a test alongside; only the Caretaker is
    // sure to be hired here.
    await queryOfficeDatabase(`update tasks set state = 'paused' where id = $1`, [task.id]);
    await queryOfficeDatabase(
      `insert into task_stages (task_id, pipeline_id, stages, made_at) values ($1, 'full', $2, now())`,
      [
        task.id,
        JSON.stringify([
          {
            kind: "agent",
            key: "implement",
            name: stageName,
            optional: false,
            role: "caretaker",
            brief: "Implement the Plan.",
            session: "fresh",
            budget: 100000,
          },
        ]),
      ],
    );
    const stageThread = await seedWaitingThread(task.id, "caretaker");
    await queryOfficeDatabase(
      `insert into stage_runs (id, task_id, stage_key, number, thread_id, session, started_at)
     values ($1, $2, 'implement', 1, $3, 'fresh', now())`,
      [crypto.randomUUID(), task.id, stageThread],
    );
    const roles = roleListSchema.parse(await (await page.request.get("/api/roles")).json());
    const caretaker = roles.find(({ key }) => key === "caretaker")?.card.name;
    const words = `Working now: ${caretaker} · ${stageName}`;

    await page.goto("/work");
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Stage worked now" }).click();
    const card = page.getByRole("article", { name: task.title });
    await expect(card).toBeVisible();

    await moveThreadTo(page, stageThread, "answering", "Implementing");
    const mark = card.getByRole("img", { name: words });
    await expect(mark).toBeVisible();
    // The Stage's name shows just before the avatars, this long one cut with an ellipsis, and the
    // live dot and avatars stay whole inside the row.
    const label = mark.locator(".working-mark-stage");
    await expect(label).toHaveText(stageName);
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const labelBox = await label.boundingBox();
    const avatarsBox = await mark.locator(".working-mark-avatars").boundingBox();
    expect((labelBox?.x ?? 0) + (labelBox?.width ?? 0)).toBeLessThanOrEqual(avatarsBox?.x ?? 0);
    const rowBox = await card.locator(".board-card-marks").boundingBox();
    expect((avatarsBox?.x ?? 0) + (avatarsBox?.width ?? 0)).toBeLessThanOrEqual(
      (rowBox?.x ?? 0) + (rowBox?.width ?? 0),
    );
    // On the marks' one row, beside the Paused mark, at the right end.
    const pausedBox = await card.getByRole("img", { name: "Paused" }).boundingBox();
    const markBox = await mark.boundingBox();
    expect(
      Math.abs(
        (pausedBox?.y ?? 0) +
          (pausedBox?.height ?? 0) / 2 -
          ((markBox?.y ?? 0) + (markBox?.height ?? 0) / 2),
      ),
    ).toBeLessThan(4);

    await mark.hover();
    await expect(page.getByRole("tooltip")).toHaveText(words);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-working-mark-stage.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-working-mark-stage.png") });
    await page.emulateMedia({ colorScheme: "light" });

    // Nothing stays behind for the tests alongside: nobody answering, no Task at a desk.
    await queryOfficeDatabase(`update threads set state = 'waiting' where id = $1`, [stageThread]);
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [task.id]);
  },
);

test(
  "a narrow card planning in auto mode shows Planning as an icon and keeps the mark inside the card",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Narrow planning card", "NP");
    const task = await createdTask(page, project, "Narrow planning");
    await queryOfficeDatabase(
      `update tasks set state = 'planning', auto_mode = true where id = $1`,
      [task.id],
    );
    // Only the Caretaker is sure to be hired here; whoever answers shows the mark the same way.
    const thread = await seedWaitingThread(task.id, "caretaker");

    await page.goto("/work");
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Narrow planning card" }).click();
    const card = page.getByRole("article", { name: task.title });
    await moveThreadTo(page, thread, "answering", "Planning");
    const mark = card.locator(".working-mark");
    await expect(mark).toBeVisible();
    // Planning is an icon, its words on hover.
    const planning = card.getByRole("img", { name: /^Planning with .+, in auto mode$/ });
    await expect(planning).toBeVisible();

    const row = card.locator(".board-card-marks");
    const markParts = [mark.locator(".live-dot"), mark.locator(".working-mark-avatars")];
    for (let width = 1100; width <= 2500; width += 100) {
      await page.setViewportSize({ width, height: 900 });
      const rowBox = await row.boundingBox();
      const rowRight = (rowBox?.x ?? 0) + (rowBox?.width ?? 0);
      for (const part of markParts) {
        const box = await part.boundingBox();
        expect(box?.width, `at ${width}px`).toBeGreaterThan(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), `at ${width}px`).toBeLessThanOrEqual(rowRight);
      }
      expect(
        await row.evaluate((element) => element.scrollWidth <= element.clientWidth),
        `at ${width}px`,
      ).toBe(true);
      // The mark after Planning, at the right.
      const planningBox = await planning.boundingBox();
      const markBox = await mark.boundingBox();
      expect(markBox?.x, `at ${width}px`).toBeGreaterThan(
        (planningBox?.x ?? 0) + (planningBox?.width ?? 0),
      );
    }

    // Where the mark once spilled past the card's edge.
    await page.setViewportSize({ width: 1950, height: 900 });
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1950-planning-card.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1950-planning-card.png") });
    await page.emulateMedia({ colorScheme: "light" });

    // Nothing stays behind for the tests alongside: nobody answering.
    await queryOfficeDatabase(`update threads set state = 'waiting' where id = $1`, [thread]);
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [task.id]);
  },
);

test(
  "a Task's priority and Drop are in its menu, and the Project page counts its Tasks",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Menu and counts", "MC");
    await createdTask(page, project, "Raise me");
    await createdTask(page, project, "Drop me");
    await page.goto("/work");

    const raised = page.getByRole("article", { name: "Raise me" });
    await raised.getByRole("button", { name: "More for Raise me" }).click();
    await page.getByRole("menu").getByRole("button", { name: "High" }).click();
    await expect(raised.getByText("High priority")).toBeAttached();

    await page
      .getByRole("article", { name: "Drop me" })
      .getByRole("button", { name: "More for Drop me" })
      .click();
    await page.getByRole("menu").getByRole("button", { name: "Drop…" }).click();
    await page.getByRole("button", { name: "Drop the Task" }).click();
    await expect(
      column(page, "Done")
        .getByRole("article", { name: "Drop me" })
        .getByRole("img", { name: "Dropped" }),
    ).toBeVisible();

    await page.goto(`/projects/${project.id}`);
    const work = page.getByText("Not planned yet").locator("..");
    await expect(work).toContainText("1");
  },
);

test(
  "a finished Task is archived from its card, found in Archived and by search, and restored in one click",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Archived work", "AW");
    const task = await createdTask(page, project, "Wombat migration notes");
    expect((await page.request.post(`/api/tasks/${task.id}/drop`)).ok()).toBe(true);
    const card = column(page, "Done").getByRole("article", { name: task.title });
    await page.goto("/work");

    await card.getByRole("button", { name: `More for ${task.title}` }).click();
    await page.getByRole("menu").getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText(`${task.title} is archived.`)).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.getByRole("tab", { name: "Archived", exact: true }).click();
    await expect(page).toHaveURL(/\/work\/archived$/);
    const row = page.getByRole("row", { name: new RegExp(task.title) });
    await expect(row).toContainText("Dropped");
    await expect(row).toContainText(project.name);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-archived-tasks.png") });

    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.type("wombat migration");
    const found = page
      .getByRole("listbox", { name: "Found" })
      .getByRole("option", { name: new RegExp(task.title) });
    await expect(found).toContainText("Archived");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
    await expect(page.locator(".task-head")).toContainText(/Archived \d+ \w+/);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-archived-task-page.png") });

    await page.goto("/work/archived");
    await row.getByRole("button", { name: `Restore ${task.title}` }).click();
    await expect(page.getByText(`${task.title} is back on the board.`)).toBeVisible();
    await expect(row).toHaveCount(0);
    await workTab(page, "Tasks").click();
    await expect(card.getByRole("img", { name: "Dropped" })).toBeVisible();
  },
);

/**
 * One of Work's tabs, apart from the Archived tab's own Tasks and Initiatives, whatever count it
 * shows.
 */
function workTab(page: Page, name: string): Locator {
  return page.locator(".work-tabs").getByRole("tab", { name: new RegExp(`^${name}\\s*\\d*$`) });
}

test(
  "Work's tabs count the open Tasks, the new Ideas and the Initiatives in Shaping in the Projects the filter shows",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Counted tabs", "CT");
    await createdTask(page, project, "Counted kiwi backlog");
    const ready = await createdTask(page, project, "Counted kiwi ready");
    const done = await createdTask(page, project, "Counted kiwi done");
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [done.id]);
    const shaping = await seedInitiative(page, "Counted kiwi shaping", {
      state: "shaping",
      createdAt: new Date().toISOString(),
    });
    await seedTaskOf(page, project, "Counted kiwi shaped", shaping);
    await queryOfficeDatabase(`update tasks set state = 'shaping' where title = $1`, [
      "Counted kiwi shaped",
    ]);
    const idea = await page.request.post("/api/ideas", {
      data: { title: "Counted kiwi idea", notes: "", projectId: project.id },
    });
    expect(idea.status()).toBe(201);

    await page.goto("/work");
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Counted tabs" }).click();
    await expect(workTab(page, "Tasks")).toHaveText("Tasks2");
    await expect(workTab(page, "Initiatives")).toHaveText("Initiatives1");
    // The seeded Initiative's Idea is Office-wide, so it's counted as well as the Project's.
    await expect(workTab(page, "Ideas")).toHaveText(/^Ideas\d+$/);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-work-tab-counts.png") });

    // The board's search narrows the cards, not the count; a Task ending lowers it at once.
    await page.goto("/work?query=nothing%20like%20this");
    await expect(page.getByRole("article", { name: "Counted kiwi ready" })).toHaveCount(0);
    await expect(workTab(page, "Tasks")).toHaveText("Tasks2");
    expect((await page.request.post(`/api/tasks/${ready.id}/drop`)).ok()).toBe(true);
    await expect(workTab(page, "Tasks")).toHaveText("Tasks1");

    // The Task page and the Initiative page keep Work's tabs, their own tab chosen; a press goes
    // to that tab's list.
    await page.goto(`/tasks/${ready.id}`);
    await expect(workTab(page, "Tasks")).toHaveAttribute("aria-selected", "true");
    await expect(workTab(page, "Tasks")).toHaveText("Tasks1");
    await page.goto(`/work/initiatives/${shaping}`);
    await expect(workTab(page, "Initiatives")).toHaveAttribute("aria-selected", "true");
    await workTab(page, "Ideas").click();
    await expect(page).toHaveURL(/\/work\/ideas(\?|$)/);
  },
);

test(
  "a Task moves to another Project from its menu, and one whose history wasn't kept is refused with why",
  { tag: "@full" },
  async ({ page }) => {
    const from = await addedProject(page, "Move from here", "MF");
    const to = await addedProject(page, "Move to there", "MT");
    const task = await createdTask(page, from, "Pair the barcode scanner");
    const old = await createdTask(page, from, "Older than the history");
    await queryOfficeDatabase(`delete from task_state_changes where task_id = $1`, [old.id]);

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "More for Pair the barcode scanner" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Move to another Project…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radiogroup").locator("label").filter({ hasText: to.name }).click();
    await expect(dialog).toContainText(`It has no Pipeline in ${to.name} until one is chosen`);
    await expect(dialog).toContainText("It stays in Backlog.");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-move-task.png") });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();

    await expect(dialog).toBeHidden();
    const origin = page
      .getByRole("region", { name: "Description" })
      .getByRole("region", { name: "Origin" });
    await expect(origin).toContainText(`Moved from ${from.name} to ${to.name}`);
    await expect(page.getByRole("region", { name: "Pipeline · Not chosen yet" })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-moved-task-origin.png") });
    await page.goto("/work");
    await expect(
      page
        .getByRole("article", { name: "Pair the barcode scanner" })
        .getByRole("img", { name: to.name }),
    ).toBeAttached();

    await page.goto(`/tasks/${old.id}`);
    await page.getByRole("button", { name: "More for Older than the history" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Move to another Project…" }).click();
    await expect(dialog).toContainText("The Task is older than the state changes The Office keeps");
    await expect(dialog.getByRole("button", { name: "Move", exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-move-task-refused.png") });
  },
);

test(
  "the user tags a Task in Create › Task and on its page, and the board finds it by them without showing them",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Tagged work", "TW");
    await page.goto("/work");

    await createFromTopBar(page, "Task");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Pair over BLE");
    await dialog.getByRole("radiogroup").locator("label").filter({ hasText: project.name }).click();
    const newTags = dialog.getByRole("group", { name: "Tags" });
    await newTags.getByLabel("Add a Tag").fill("BLE");
    await newTags.getByLabel("Add a Tag").press("Enter");
    await newTags.getByLabel("Add a Tag").fill("Needs Review");
    await newTags.getByLabel("Add a Tag").press("Enter");
    await expect(newTags).toContainText("ble");
    await dialog.getByRole("button", { name: "Add the Task" }).click();
    await expect(dialog).toBeHidden();
    // The new Task's page opens.
    await expect(page).toHaveURL(/\/tasks\//);
    await expect(page.getByRole("heading", { name: "Pair over BLE", level: 2 })).toBeVisible();

    await page.goBack();
    const card = page.getByRole("article", { name: "Pair over BLE" });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("ble");
    await expect(card).not.toContainText("needs-review");
    // The board's search still finds the Task by its Tags.
    await page.getByLabel("Search Tasks").fill("needs-review");
    await expect(page).toHaveURL(/query=needs-review/);
    await expect(card).toBeVisible();

    // The whole card opens the Task, not only its title.
    // Its bottom corner, away from the title, sits under the title's link.
    const box = await card.boundingBox();
    await card.click({ position: { x: 6, y: (box?.height ?? 12) - 6 } });
    await expect(page).toHaveURL(/\/tasks\//);
    const tags = page.getByRole("group", { name: "Tags" });
    await tags.getByLabel("Add a Tag").fill("firmware");
    await tags.getByLabel("Add a Tag").press("Enter");
    await tags
      .locator("span", { hasText: "needs-review" })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(tags).toContainText("firmware");
    await expect(tags).not.toContainText("needs-review");
    // The page shows a change as it is sent, so wait for the save itself before reloading.
    const taskUrl = `/api/tasks/${page.url().split("/").at(-1)}`;
    await expect
      .poll(
        async () => ((await (await page.request.get(taskUrl)).json()) as { tags: string[] }).tags,
      )
      .toEqual(["ble", "firmware"]);

    await page.reload();
    await expect(tags).toContainText("ble");
    await expect(tags).toContainText("firmware");
    await expect(tags).not.toContainText("needs-review");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-tags.png") });
  },
);

test("the user adds a Task with a Description, writes its Plan and Definition of Done, and marks it Ready from Backlog", async ({
  page,
}) => {
  const project = await addedProject(page, "Described work", "DW");
  await page.goto(`/projects/${project.id}`);
  await createFromTopBar(page, "Task");
  const dialog = page.getByRole("dialog", { name: "New Task" });
  await dialog.getByLabel("Title").fill("Export keeps the filters");
  await dialog.getByLabel("Description").fill("The CSV export uses **the filters on screen**.");
  // It starts in the Project whose page it was created on.
  await expect(
    dialog
      .getByRole("radiogroup")
      .locator("label")
      .filter({ hasText: project.name })
      .getByRole("radio"),
  ).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-new-task.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
  await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-new-task.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await dialog.getByRole("button", { name: "Add the Task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/tasks\//);

  // A new Task has no Pipeline yet: a placeholder stands where its Stages will be.
  const rail = page.getByRole("region", { name: "Pipeline · Not chosen yet" });
  await expect(page.locator(".task-head-meta")).toContainText("Pipeline Not chosen yet");
  await expect(rail).toContainText(
    "Pipeline not chosen yet. The Planner proposes one while planning.",
  );
  await expect(rail.getByRole("list", { name: "Stages" })).toHaveCount(0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-task-pipeline-not-chosen.png"),
  });

  // The Description sits above the Plan, editable until the Task starts.
  const record = page.getByRole("region", { name: "Record" });
  const description = record.getByRole("region", { name: "Description" });
  const plan = record.getByRole("region", { name: "Plan", exact: true });
  const definitionOfDone = record.getByRole("region", { name: "Definition of Done" });
  await expect(description).toContainText("The CSV export uses the filters on screen.");
  const descriptionBox = await description.boundingBox();
  const planBox = await plan.boundingBox();
  expect(descriptionBox?.y).toBeLessThan(planBox?.y ?? 0);
  await description.getByRole("button", { name: "Edit" }).click();
  await description.getByRole("textbox", { name: "Description" }).fill("");
  await description.getByRole("button", { name: "Save" }).click();
  await expect(description).toContainText("None: the title is all there is.");
  await description.getByRole("button", { name: "Edit" }).click();
  await description
    .getByRole("textbox", { name: "Description" })
    .fill("The CSV export uses the filters and the sort on screen.");
  await description.getByRole("button", { name: "Save" }).click();
  await expect(description).toContainText(
    "The CSV export uses the filters and the sort on screen.",
  );

  // Before Ready shows in Backlog once a part is written, and Mark Ready once a Pipeline is chosen
  // and no Decision is open; with every line met, it marks the Task Ready without asking.
  const beforeReady = page.getByRole("region", { name: "Before Ready" });
  const readinessLine = (label: string): Locator =>
    beforeReady.getByRole("listitem").filter({ hasText: label });
  const markReady = page.getByRole("button", { name: "Mark Ready" });
  await expect(beforeReady).toHaveCount(0);
  await expect(markReady).toHaveCount(0);
  await plan.getByRole("button", { name: "Edit" }).click();
  await plan.getByRole("textbox", { name: "Plan" }).fill("Pass the board's filters to the export.");
  await plan.getByRole("button", { name: "Save", exact: true }).click();
  await expect(plan.getByText("Not confirmed", { exact: true })).toBeVisible();
  await plan.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(plan.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(readinessLine("Plan confirmed")).toHaveClass(/task-checklist-met/);
  await expect(readinessLine("Definition of Done confirmed")).toContainText(
    "Write it on the Definition of Done",
  );
  await expect(markReady).toHaveCount(0);
  await expectNeedsYouInTheRecordColumn(page, beforeReady);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-backlog-parts.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
  await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-task-backlog-parts.png") });
  await page.emulateMedia({ colorScheme: "light" });

  // Its link leads to the block, from another tab too.
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await readinessLine("Definition of Done confirmed")
    .getByRole("button", { name: "on the Definition of Done" })
    .click();
  await expect(definitionOfDone).toBeInViewport();
  await definitionOfDone.getByRole("button", { name: "Edit" }).click();
  await definitionOfDone
    .getByRole("textbox")
    .fill("The export holds only the filtered Tasks.\nThe tests pass.");
  await definitionOfDone.getByRole("button", { name: "Save", exact: true }).click();
  await definitionOfDone.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(definitionOfDone.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(readinessLine("Definition of Done confirmed")).toHaveClass(/task-checklist-met/);

  // Ready waits for a Pipeline, chosen on the rail, the Project's default listed first.
  await expect(markReady).toHaveCount(0);
  await expect(readinessLine("Pipeline chosen")).toContainText("Choose a Pipeline on the rail");
  await screenshotScenario(page, "pipeline-not-chosen", { inView: rail });
  await rail.getByRole("button", { name: "Choose a Pipeline" }).click();
  const choosing = page.getByRole("dialog");
  const choosingBody = choosing.locator(".dialog-body");
  const bodyHeight = (): Promise<number> => choosingBody.evaluate((body) => body.scrollHeight);
  const closedBodyHeight = await bodyHeight();
  const pipelines = await openPipelinePicker(choosing, "Pipeline");
  await expect(pipelines.getByRole("option").first()).toContainText("Project default");
  // Its list opens over the window: whole, at least as wide as the field, the body not grown for it.
  await expect(pipelines).toBeInViewport({ ratio: 1 });
  expect(await bodyHeight()).toBe(closedBodyHeight);
  const fieldBox = await choosing.getByRole("combobox", { name: "Pipeline" }).boundingBox();
  const listBox = await pipelines.boundingBox();
  expect(listBox?.width).toBeGreaterThanOrEqual(fieldBox?.width ?? Infinity);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-choose-a-pipeline-open.png") });
  await pipelines.getByRole("option", { name: "Quick fix", exact: true }).click();
  // Its Stages show at once, to edit for this Task in the same window before Save.
  const draftFlow = choosing.getByRole("region", { name: "Flow" });
  const draftStages = draftFlow.locator("[data-flow-stage]");
  await expect(draftStages).toHaveCount(3);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-choose-a-pipeline.png") });
  // The edit is checked against the chosen Pipeline as it goes, before the Task follows it.
  const checked = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      request.url().endsWith("/stages/check") &&
      request.postDataJSON()?.stages?.length === 2,
  );
  const removeStage = async (name: string): Promise<void> => {
    await draftFlow.getByRole("button", { name, exact: true }).click();
    await choosing
      .getByRole("region", { name, exact: true })
      .getByRole("button", { name: `More for ${name}` })
      .click();
    await page
      .getByRole("menu")
      .getByRole("button", { name: `Remove ${name}` })
      .click();
  };
  await removeStage("Tests");
  await expect(draftStages).toHaveCount(2);
  expect((await checked).postDataJSON()).toMatchObject({ pipelineId: "quick-fix" });
  await removeStage("Implement");
  await expect(draftStages).toHaveCount(1);
  await choosing.getByRole("button", { name: "Save for this Task" }).click();
  await expect(page.getByText("Export keeps the filters follows Quick fix.")).toBeVisible();
  const quickFixRail = page.getByRole("region", { name: /^Pipeline · Quick fix/ });
  const railStages = quickFixRail.getByRole("list", { name: "Stages" });
  await expect(railStages.getByRole("listitem")).toHaveCount(1);
  await expect(railStages).toContainText("Publish");
  await expect(page.locator(".task-head-meta")).toContainText("Pipeline Quick fix");
  await expect(readinessLine("Pipeline chosen")).toHaveClass(/task-checklist-met/);

  await markReady.click();
  await expect(
    page.getByText("Export keeps the filters is Ready. Starting it is your call."),
  ).toBeVisible();
  await expect(beforeReady).toHaveCount(0);
  await expect(markReady).toHaveCount(0);
});

test(
  "the user mentions a Task with @ in a new Task's Description, and its page shows the chip that opens it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Mentioning work", "MW");
    const mentioned = await createdTask(page, project, "Ledger totals round to cents");
    await page.goto(`/projects/${project.id}`);
    await createFromTopBar(page, "Task");
    const dialog = page.getByRole("dialog", { name: "New Task" });
    // No "invoice" in the title: the chat's mention test searches for it in the same database.
    await dialog.getByLabel("Title").fill("Statements show the ledger totals");
    const description = dialog.getByRole("textbox", { name: "Description" });
    await description.fill("Use the totals from ");
    await description.pressSequentially("@ledger tot");
    const option = dialog.getByRole("option", { name: /Ledger totals round to cents/ });
    await expect(option).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-new-task-mention.png") });

    // Esc closes the picker alone; the window stays with what was written.
    await description.press("Escape");
    await expect(option).toBeHidden();
    await expect(dialog).toBeVisible();
    await description.pressSequentially("a");
    await expect(option).toBeVisible();
    await description.press("Enter");
    await expect(description).toHaveValue("Use the totals from @Ledger totals round to cents ");
    await description.pressSequentially("as they are.");
    await dialog.getByRole("button", { name: "Add the Task" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/tasks\//);

    const descriptionBlock = page
      .getByRole("region", { name: "Record" })
      .getByRole("region", { name: "Description" });
    const chip = descriptionBlock.getByRole("link", { name: "Ledger totals round to cents" });
    await expect(chip).toHaveClass(/record-mention/);
    await expect(descriptionBlock).toContainText(
      "Use the totals from Ledger totals round to cents as they are.",
    );

    // Edited again, the mention reads as the link it was saved as, and @ offers records there too.
    await descriptionBlock.getByRole("button", { name: "Edit" }).click();
    const editor = descriptionBlock.getByRole("textbox", { name: "Description" });
    await expect(editor).toHaveValue(
      `Use the totals from [@Ledger totals round to cents](/tasks/${mentioned.id}) as they are.`,
    );
    await editor.press("End");
    await editor.pressSequentially(" Like @ledger");
    const offered = descriptionBlock.getByRole("option", { name: /Ledger totals round to cents/ });
    await expect(offered).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-description-mention.png") });
    await editor.press("Escape");
    await expect(offered).toBeHidden();
    await expect(editor).toBeVisible();
    await descriptionBlock.getByRole("button", { name: "Cancel" }).click();

    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${mentioned.id}`));
  },
);

test("the user pastes a screenshot into New Task, and the Task's page shows the picture", async ({
  page,
}) => {
  const project = await addedProject(page, "Pasted work", "PW");
  await page.goto(`/projects/${project.id}`);
  await createFromTopBar(page, "Task");
  const dialog = page.getByRole("dialog", { name: "New Task" });
  const title = dialog.getByLabel("Title");
  await title.fill("The login button is cut off");
  await expect(dialog).toContainText("An image on the clipboard can be pasted here too.");

  // A screenshot tool's clipboard: one PNG, named as the browser names it, and no text.
  await title.evaluate(
    (field, base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([bytes], "image.png", { type: "image/png" }));
      field.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
      );
    },
    aPng([200, 60, 60]).toString("base64"),
  );
  const pasted = dialog.locator(".pending-attachments .attachment-open");
  await expect(pasted).toHaveText(/^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
  await expect(title).toHaveValue("The login button is cut off");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-new-task-pasted-image.png") });

  await dialog.getByRole("button", { name: "Add the Task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/tasks\//);
  await page.getByRole("tab", { name: "Attachments" }).click();
  await expect(
    page
      .getByRole("region", { name: "Attachments", exact: true })
      .getByRole("button", { name: /^View Pasted image / }),
  ).toBeVisible();
});

test(
  "the board's filters narrow it by search, priority and Blocked, kept in its address until Clear",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Filtered work", "FW");
    const addTask = async (title: string, fields: Partial<Task>): Promise<Task> => {
      const response = await page.request.post("/api/tasks", {
        data: { title, projectId: project.id, priority: "normal", ...fields },
      });
      expect(response.status()).toBe(201);
      return taskSchema.parse(await response.json());
    };
    const pairing = await addTask("Filtered pairing handshake", {
      priority: "high",
      tags: ["fw-radio"],
    });
    const flash = await addTask("Filtered flash layout", { tags: ["fw-radio"] });
    await addTask("Filtered manual pages", { priority: "low" });
    const dependency = await page.request.post(`/api/tasks/${flash.id}/dependencies`, {
      data: { blockerId: pairing.id },
    });
    expect(dependency.ok()).toBe(true);
    const titles = ["Filtered pairing handshake", "Filtered flash layout", "Filtered manual pages"];
    const shown = (): Promise<string[]> => titlesIn(page, "Backlog", titles);
    await page.goto("/work");
    await expect.poll(shown).toEqual(titles);

    const filters = page.getByRole("search", { name: "Filter the board" });
    await filters.getByLabel("Search Tasks").fill("handsh");
    await expect.poll(shown).toEqual(["Filtered pairing handshake"]);
    await filters.getByRole("button", { name: "Clear" }).click();
    await expect(filters.getByLabel("Search Tasks")).toHaveValue("");
    await expect.poll(shown).toEqual(titles);

    await expect(filters.getByRole("group", { name: "Tags" })).toHaveCount(0);
    await page.goto(`/work?tags=${encodeURIComponent('["fw-radio"]')}`);
    await expect.poll(shown).toEqual(titles);
    await expect(page).not.toHaveURL(/tags=/);

    await filters.getByLabel("Search Tasks").fill("fw-radio");
    await expect.poll(shown).toEqual(["Filtered pairing handshake", "Filtered flash layout"]);
    await filters.getByRole("button", { name: "Blocked" }).click();
    await expect.poll(shown).toEqual(["Filtered flash layout"]);

    await page.reload();
    await expect(filters.getByRole("button", { name: "Blocked" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(shown).toEqual(["Filtered flash layout"]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-board-filters.png") });

    await filters.getByRole("button", { name: "Clear" }).click();
    await filters
      .getByRole("group", { name: "Priority" })
      .getByRole("button", { name: "Low" })
      .click();
    await expect.poll(shown).toEqual(["Filtered manual pages"]);
  },
);

test(
  "the Project filter narrows the board and Ideas, remembered by the browser, until Show all projects",
  { tag: "@full" },
  async ({ page }) => {
    const alpha = await addedProject(page, "Narrowed alpha", "NA");
    const beta = await addedProject(page, "Narrowed beta", "NB");
    // So that alpha and beta are never every Project, whichever other files have run.
    await addedProject(page, "Narrowed gamma", "NG");
    await createdTask(page, alpha, "Narrowed alpha telemetry");
    await createdTask(page, beta, "Narrowed beta telemetry");
    for (const [title, projectId] of [
      ["Narrowed beta idea", beta.id],
      ["Narrowed office-wide idea", null],
    ] as const) {
      const response = await page.request.post("/api/ideas", {
        data: { title, notes: "", projectId },
      });
      expect(response.status()).toBe(201);
    }
    const alphaCard = page.getByRole("article", { name: "Narrowed alpha telemetry" });
    const betaCard = page.getByRole("article", { name: "Narrowed beta telemetry" });
    const trigger = page.getByRole("button", { name: /^Project filter:/ });
    const showAll = page.getByRole("button", { name: /in other Projects.*Show all projects/ });
    await page.goto("/work");
    await expect(trigger).toHaveText(/All projects/);
    await expect(betaCard).toBeVisible();
    await expect(showAll).toHaveCount(0);

    await trigger.click();
    await page.getByRole("button", { name: "Show only Narrowed alpha" }).click();
    await expect(trigger).toHaveText(/Narrowed alpha/);
    await expect(alphaCard).toBeVisible();
    await expect(betaCard).toHaveCount(0);
    await expect(showAll).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-filter.png") });

    await page.reload();
    await expect(trigger).toHaveText(/Narrowed alpha/);
    await expect(betaCard).toHaveCount(0);
    await page.goto("/work/ideas");
    await expect(page.getByRole("article", { name: "Narrowed office-wide idea" })).toBeVisible();
    await expect(page.getByRole("article", { name: "Narrowed beta idea" })).toHaveCount(0);

    await trigger.click();
    const projectsShown = page.getByRole("group", { name: "Projects shown" });
    await projectsShown.getByRole("button", { name: "Narrowed beta", exact: true }).click();
    await expect(trigger).toHaveText(/2 projects/);
    await expect(page.getByRole("article", { name: "Narrowed beta idea" })).toBeVisible();
    await projectsShown.getByRole("button", { name: "Narrowed alpha", exact: true }).click();
    await expect(trigger).toHaveText(/Narrowed beta/);
    await page.keyboard.press("Escape");
    await expect(projectsShown).toHaveCount(0);

    await page.goto("/work");
    await expect(alphaCard).toHaveCount(0);
    await expect(betaCard).toBeVisible();
    await showAll.click();
    await expect(trigger).toHaveText(/All projects/);
    await expect(alphaCard).toBeVisible();
    await expect(showAll).toHaveCount(0);
  },
);

/** A choice of a seeded Decision: "Yes" or "No", the first recommended, unless given. */
function aChoice(
  question: string,
  options: readonly string[] = ["Yes", "No"],
  recommended = 0,
  reason = "It is simpler.",
): DecisionQuestion {
  return {
    kind: "choice",
    question,
    options: [...options],
    recommendation: { option: recommended, reason },
  };
}

/**
 * The columns a Decision is kept in, as the service writes them: the form in `questions`, and its
 * first question in `question`, `options` and `recommendation`, which the release before reads.
 */
function decisionColumns(questions: readonly DecisionQuestion[]): readonly string[] {
  const [first] = questions;
  if (first === undefined) throw new Error("A Decision asks a question.");
  const recommendation =
    first.kind === "choice" ? first.recommendation : { option: 0, reason: first.why ?? "" };
  return [
    first.question,
    JSON.stringify(first.kind === "choice" ? first.options : []),
    JSON.stringify(recommendation),
    JSON.stringify(questions),
  ];
}

/**
 * An open Decision on the Task, in a Thread of its own, as a Stage's session would ask it: one
 * question of "Yes" or "No", or the form's questions.
 */
async function seedDecision(
  task: Task,
  asked: string | readonly DecisionQuestion[],
  attachmentIds: readonly string[] = [],
): Promise<SeededDecision> {
  const threadId = crypto.randomUUID();
  const decisionId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at)
     values ($1, 'task', $2, 'developer', 'Implement', 'waiting', $3, now())`,
    [threadId, task.id, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, attachment_ids, asked_at)
     values ($1, $2, $3, 'developer', 'question', $4, 'Both work.', $5, $6, $7, $8, now())`,
    [
      decisionId,
      threadId,
      task.id,
      ...decisionColumns(typeof asked === "string" ? [aChoice(asked)] : asked),
      JSON.stringify(attachmentIds),
    ],
  );
  return { threadId, decisionId };
}

/**
 * A Decision the shared user answered, in the Planner's Thread on the Task, as the service keeps
 * one: the form's answer in `form_answer`, and in `answer` as one, with who gave it.
 */
async function seedAnsweredDecision(
  page: Page,
  task: Task,
  questions: readonly DecisionQuestion[],
  formAnswer: DecisionFormAnswer,
): Promise<string> {
  const decisionId = crypto.randomUUID();
  const account = accountSchema.parse(await (await page.request.get("/api/account")).json());
  const user = { userId: account.id, name: account.name };
  const one =
    formAnswer.kind === "asked-again"
      ? { kind: "free-answer", text: formAnswer.generalComment ?? "" }
      : { kind: "free-answer", text: "Answered in the form." };
  const threadId = await seedThread(task.id, "Planning", [{ kind: "decision", decisionId }]);
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, asked_at, answer, form_answer, answered_at)
     values ($1, $2, $3, 'planner', 'question', $4, 'Accounting imports CSV; the API clients read JSON.', $5, $6, $7, now(), $8, $9, now())`,
    [
      decisionId,
      threadId,
      task.id,
      ...decisionColumns(questions),
      JSON.stringify({ ...one, user }),
      JSON.stringify(formAnswer),
    ],
  );
  return threadId;
}

/**
 * Needs you, or Before Ready in its place, sits above the record's tabs, as wide as the record; the
 * conversation has its own column beside them on a wide page, and comes after them below 1281px.
 */
async function expectNeedsYouInTheRecordColumn(page: Page, block: Locator): Promise<void> {
  const blockBox = await block.boundingBox();
  const tabBox = await page.getByRole("tab", { name: "Overview" }).boundingBox();
  const recordBox = await page.getByRole("region", { name: "Record" }).boundingBox();
  const conversationBox = await page
    .getByRole("complementary", { name: "Conversation" })
    .boundingBox();
  if (!blockBox || !tabBox || !recordBox || !conversationBox) throw new Error("Not on the page");
  expect(blockBox.y + blockBox.height).toBeLessThanOrEqual(tabBox.y);
  expect(blockBox.x).toBeCloseTo(recordBox.x, 0);
  expect(blockBox.width).toBeCloseTo(recordBox.width, 0);
  if ((page.viewportSize()?.width ?? 0) > 1280) {
    expect(conversationBox.x).toBeGreaterThan(blockBox.x + blockBox.width);
    expect(conversationBox.y).toBeCloseTo(blockBox.y, 0);
  } else {
    expect(conversationBox.y).toBeGreaterThan(recordBox.y);
  }
}

interface SeededDecision {
  readonly threadId: string;
  readonly decisionId: string;
}

/**
 * Catches the answers to a seeded Decision before they reach the service, where the asking
 * person's session would take them (and the scripted engine's sessions belong to people.e2e.ts),
 * and answers as the service does, with the Thread. The answers sent are returned as they come.
 */
async function catchAnswers(
  page: Page,
  { threadId, decisionId }: SeededDecision,
): Promise<readonly unknown[]> {
  const thread: unknown = await (await page.request.get(`/api/threads/${threadId}`)).json();
  const answers: unknown[] = [];
  await page.route(`**/api/decisions/${decisionId}/answer`, async (route) => {
    answers.push(route.request().postDataJSON());
    await route.fulfill({ json: thread });
  });
  return answers;
}

test(
  "the Project filter narrows Needs you, the status strip and the Projects list, until Show all projects",
  { tag: "@full" },
  async ({ page }) => {
    const alpha = await addedProject(page, "Waiting alpha", "WA");
    const beta = await addedProject(page, "Waiting beta", "WB");
    await seedDecision(await createdTask(page, alpha, "Waiting alpha export"), "Export as CSV?");
    await seedDecision(await createdTask(page, beta, "Waiting beta export"), "Export as JSON?");
    const trigger = page.getByRole("button", { name: /^Project filter:/ });
    const needsYou = page.getByRole("region", { name: "Needs you" });
    const alphaDecision = needsYou.getByRole("region", { name: "Decision: Export as CSV?" });
    const betaDecision = needsYou.getByRole("region", { name: "Decision: Export as JSON?" });
    const strip = page.getByRole("status", { name: "Status strip" });
    await page.goto("/now");
    await expect(alphaDecision).toBeVisible();
    await expect(betaDecision).toBeVisible();

    await trigger.click();
    await page.getByRole("button", { name: "Show only Waiting alpha" }).click();
    await expect(alphaDecision).toBeVisible();
    await expect(betaDecision).toHaveCount(0);
    await expect(strip.getByRole("button", { name: /need/ })).toHaveAccessibleName(
      /^1 needs you, \d+ more in other Projects$/,
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-filter-now.png") });

    await page.goto("/projects");
    await expect(page.getByRole("link", { name: /Waiting alpha/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Waiting beta/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /hidden by the Project filter/ })).toBeVisible();

    await page.goto("/now");
    await needsYou.getByRole("button", { name: /in other Projects.*Show all projects/ }).click();
    await expect(trigger).toHaveText(/All projects/);
    await expect(betaDecision).toBeVisible();
    await expect(strip).not.toContainText("in other Projects");
  },
);

test(
  "the user saves the board's filters as a view, applies it and removes it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Viewed work", "VW");
    for (const [title, priority] of [
      ["Viewed radio driver", "high"],
      ["Viewed radio notes", "low"],
      ["Viewed release checklist", "high"],
    ] as const) {
      const response = await page.request.post("/api/tasks", {
        data: { title, projectId: project.id, priority },
      });
      expect(response.status()).toBe(201);
    }
    const titles = ["Viewed radio driver", "Viewed release checklist", "Viewed radio notes"];
    const shown = (): Promise<string[]> => titlesIn(page, "Backlog", titles);
    await page.goto("/work");
    await expect.poll(shown).toEqual(titles);

    const filters = page.getByRole("search", { name: "Filter the board" });
    const views = filters.getByRole("group", { name: "Views" });
    await filters.getByLabel("Search Tasks").fill("radio");
    await filters
      .getByRole("group", { name: "Priority" })
      .getByRole("button", { name: "High" })
      .click();
    await expect.poll(shown).toEqual(["Viewed radio driver"]);

    const name = `Radio work ${Date.now()}`;
    await views.getByRole("button", { name: "Save view…" }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Save the view" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Name").press("Enter");
    await expect(dialog).toBeHidden();
    const view = views.getByRole("button", { name, exact: true });
    await expect(view).toHaveAttribute("aria-pressed", "true");
    await expect(views.getByRole("button", { name: "Save view…" })).toBeHidden();

    await filters.getByRole("button", { name: "Clear" }).click();
    await expect.poll(shown).toEqual(titles);
    await expect(view).toHaveAttribute("aria-pressed", "false");
    await view.click();
    await expect.poll(shown).toEqual(["Viewed radio driver"]);
    await expect(view).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-saved-view.png") });

    await view.click();
    await expect.poll(shown).toEqual(titles);

    await view.click();
    await views.getByRole("button", { name: `Remove the view ${name}` }).click();
    await expect(view).toBeHidden();
    await expect.poll(shown).toEqual(["Viewed radio driver"]);
  },
);

test(
  "the top bar's search finds records and people, follows the Project filter, and opens the pick",
  { tag: "@full" },
  async ({ page }) => {
    const alpha = await addedProject(page, "Searched alpha", "SA");
    const beta = await addedProject(page, "Searched beta", "SB");
    // So that alpha is never every Project, whichever other files have run.
    await addedProject(page, "Searched gamma", "SG");
    await createdTask(page, alpha, "Quokka redirect");
    const telemetry = await createdTask(page, beta, "Quokka telemetry");
    const idea = await page.request.post("/api/ideas", {
      data: { title: "Quokka office-wide idea", notes: "", projectId: null },
    });
    expect(idea.status()).toBe(201);
    const document = await page.request.post(
      `/api/tasks/${telemetry.id}/attachments/files?${new URLSearchParams({ fileName: "quokka-notes.md", mediaType: "text/markdown" })}`,
      {
        headers: { "content-type": "application/octet-stream" },
        data: Buffer.from("# Quokka notes\n\nCount the hops."),
      },
    );
    expect(document.status()).toBe(201);
    const [preset] = presetListSchema.parse(await (await page.request.get("/api/presets")).json());
    if (!preset) throw new Error("The Office offers its presets.");
    const hired = await page.request.post("/api/roles", {
      data: { card: { ...preset.card, name: "Quinta", title: "Quokka Keeper", skills: [] } },
    });
    expect(hired.status()).toBe(201);
    const { key: keeper } = roleSchema.parse(await hired.json());

    const search = page.getByRole("combobox", { name: "Search The Office" });
    const found = page.getByRole("listbox", { name: "Found" });
    const showAll = page.getByRole("button", {
      name: /matches in other Projects.*Show all projects/,
    });
    await page.goto("/work");
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only Searched alpha" }).click();

    await page.keyboard.press("ControlOrMeta+K");
    await expect(search).toBeFocused();
    await page.keyboard.type("quok");
    await expect(found.getByRole("option", { name: "Quokka redirect" })).toBeVisible();
    await expect(found.getByRole("option", { name: "Quokka office-wide idea" })).toBeVisible();
    await expect(found.getByRole("option", { name: "Quokka telemetry" })).toHaveCount(0);
    await expect(showAll).toHaveText(/2 more matches in other Projects/);
    await page.keyboard.press("ArrowDown");
    await expect(found.getByRole("option", { name: "Quokka office-wide idea" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-top-bar-search.png") });

    await showAll.click();
    await expect(showAll).toHaveCount(0);
    await expect(found.getByRole("option", { name: "quokka-notes.md" })).toBeVisible();
    await search.fill("quokka tele");
    await expect(found.getByRole("option")).toHaveCount(1);
    await expect(found.getByRole("option", { name: "Quokka telemetry" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tasks/${telemetry.id}$`));
    await expect(search).toHaveValue("");

    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.type("quokka notes");
    await found.getByRole("option", { name: "quokka-notes.md" }).click();
    await expect(page.getByRole("dialog")).toContainText("Count the hops.");
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+K");
    await page.keyboard.type("quinta keep");
    await found.getByRole("option", { name: "Quinta · Quokka Keeper" }).click();
    await expect(page).toHaveURL(new RegExp(`/people/${keeper}$`));
  },
);

test("the top bar's search finds a Task by the first 8 characters of its ID and opens it", async ({
  page,
}) => {
  const project = await addedProject(page, "Searched by ID", "SI");
  const task = await createdTask(page, project, "Wombat found by its ID");
  const search = page.getByRole("combobox", { name: "Search The Office" });
  const found = page.getByRole("listbox", { name: "Found" });

  await page.goto("/work");
  await search.click();
  await page.keyboard.type(task.id.slice(0, 8));
  await expect(found.getByRole("option").first()).toHaveAccessibleName("Wombat found by its ID");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
});

test("a Task's page shows its record, takes Attachments of every kind and opens them", async ({
  page,
}) => {
  const project = await addedProject(page, "Task page", "TP");
  const idea = await page.request.post("/api/ideas", {
    data: {
      title: "Sign-in keeps the page",
      notes: "Users land on the home page.",
      projectId: project.id,
    },
  });
  const ideaId = ((await idea.json()) as { id: string }).id;
  await page.request.post(`/api/ideas/${ideaId}/shape`, { data: { projectId: project.id } });
  await page.goto("/work");
  await page.getByRole("link", { name: "Sign-in keeps the page" }).click();

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "Sign-in keeps the page", level: 2 }),
  ).toBeVisible();
  const record = page.getByRole("region", { name: "Record" });
  // Out of Planning the blocks are folded to one line.
  await expect(record.getByText("Not written yet", { exact: true })).toBeVisible();
  await expect(record.getByText("No Plan yet", { exact: true })).toBeVisible();
  // Shaped from an Idea, it has no Pipeline yet, nor any Stages to show.
  const rail = page.getByRole("region", { name: "Pipeline · Not chosen yet" });
  await expect(rail).toContainText("Pipeline not chosen yet.");
  await expect(rail.getByRole("list", { name: "Stages" })).toHaveCount(0);
  // The Idea's notes are its Description; the Planner may not be hired yet. The Description
  // starts open, with the Task's Origin inside it.
  const description = record.getByRole("region", { name: "Description" });
  const descriptionFold = description.getByRole("button", { name: /^Description/ });
  const origin = description.getByRole("region", { name: "Origin" });
  await expect(descriptionFold).toHaveAttribute("aria-expanded", "true");
  await expect(description.locator(".task-plan-text")).toContainText(
    "Users land on the home page.",
  );
  await expect(origin.getByRole("link", { name: "Sign-in keeps the page" })).toBeVisible();
  await expect(origin.getByText("Users land on the home page.")).toBeVisible();

  // The fold is this browser's memory of this Task, so it survives a reload.
  await descriptionFold.click();
  await expect(descriptionFold).toHaveAttribute("aria-expanded", "false");
  await expect(origin).toBeHidden();
  await page.reload();
  await expect(descriptionFold).toHaveAttribute("aria-expanded", "false");
  await expect(origin).toBeHidden();
  await descriptionFold.click();
  await expect(origin).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Conversation" })).toContainText(
    /plans from the title and the Description|Planning opens one with/,
  );

  const files = [
    { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Plan\n\nKeep the path.") },
    { name: "screen.png", mimeType: "image/png", buffer: Buffer.from("not really a png") },
    { name: "themes.css", mimeType: "text/css", buffer: Buffer.from(THEMES_CSS) },
    { name: "export.zip", mimeType: "application/zip", buffer: Buffer.from([80, 75, 3, 4, 0]) },
  ];
  await page.getByRole("tab", { name: "Attachments" }).click();
  await expect(page).toHaveURL(/recordTab=attachments/);
  const attachments = page.getByRole("region", { name: "Attachments", exact: true });
  const addAttachment = attachments.getByRole("button", { name: "Add" });
  for (const file of files) {
    await addAttachment.click();
    await page.getByRole("dialog").getByLabel("File to attach").setInputFiles(file);
    await expect(page.getByText(`${file.name} attached.`)).toBeVisible();
  }
  await addAttachment.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Link", { exact: true }).click();
  await dialog.getByLabel("Address").fill("https://example.com/sign-in");
  await dialog.getByRole("button", { name: "Add the link" }).click();
  await expect(page.getByText("https://example.com/sign-in attached.")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task.png") });

  await expect(page.getByRole("tab", { name: "Attachments" })).toContainText("5");
  await page.reload();
  await attachments.getByRole("button", { name: "plan.md" }).click();
  const plan = page.getByRole("dialog").filter({ hasText: "plan.md" });
  await expect(plan.getByRole("heading", { name: "Plan", exact: true })).toBeVisible();
  await expect(plan).toContainText("Keep the path.");
  const [planDownload] = await Promise.all([
    page.waitForEvent("download"),
    plan.getByRole("link", { name: "Download" }).click(),
  ]);
  expect(planDownload.suggestedFilename()).toBe("plan.md");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  // Any other text file opens in the same window, as plain text with its line numbers.
  await attachments.getByRole("button", { name: "themes.css" }).click();
  const themes = page.getByRole("dialog").filter({ hasText: "themes.css" });
  await expect(themes.locator(".plain-text-file-lines")).toHaveText(THEMES_CSS.trimEnd());
  await expect(themes.locator(".plain-text-file-numbers")).toHaveText("1\n2\n3\n4\n5\n6\n7");
  await expect(themes.getByRole("link", { name: "Download" })).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-text-file.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-text-file.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await attachments.getByRole("button", { name: "View screen.png" }).click();
  const viewer = page.getByRole("dialog").filter({ hasText: "screen.png" });
  const original = viewer.getByRole("link", { name: "Open the original" });
  const image = await page.request.get((await original.getAttribute("href")) ?? "");
  expect(image.headers()["content-type"]).toBe("image/png");
  const [imageDownload] = await Promise.all([
    page.waitForEvent("download"),
    viewer.getByRole("link", { name: "Download" }).click(),
  ]);
  expect(imageDownload.suggestedFilename()).toBe("screen.png");
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await attachments.getByRole("link", { name: "export.zip" }).click();
  expect((await download).suggestedFilename()).toBe("export.zip");
  await expect(
    attachments.getByRole("link", { name: "https://example.com/sign-in" }),
  ).toHaveAttribute("target", "_blank");

  await createFromTopBar(page, "Idea");
  await page.keyboard.type("Remember the page per tab");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Idea captured: Remember the page per tab.")).toBeVisible();
  await page.goto("/work/ideas");
  await expect(
    page.getByRole("article", { name: "Remember the page per tab" }).getByText("Task page"),
  ).toBeVisible();
});

/** A text file that isn't Markdown, which the document window shows as plain text. */
const THEMES_CSS = `:root {
  --accent: #0a84ff;
  --surface: #ffffff;
}
.dark {
  --accent: #409cff;
}
`;

/** A PNG chunk: its length, type, data and checksum. */
function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A solid PNG of `rgb`, so a screenshot shows the images apart. */
function aPng(rgb: readonly [number, number, number], width = 320, height = 200): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(Array(height).fill(row)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function attachedImage(
  page: Page,
  task: Task,
  name: string,
  png: Buffer,
): Promise<Attachment> {
  const response = await page.request.post(
    `/api/tasks/${task.id}/attachments/files?${new URLSearchParams({ fileName: name, mediaType: "image/png" })}`,
    { headers: { "content-type": "application/octet-stream" }, data: png },
  );
  expect(response.status()).toBe(201);
  return attachmentSchema.parse(await response.json());
}

test("a Decision form with nothing to look at is answered in place: each choice at its recommendation, the open question in words, each with its comment", async ({
  page,
}) => {
  const project = await addedProject(page, "Decisions in place", "DI");
  const task = await createdTask(page, project, "Pick an export format");
  const form = await seedDecision(task, [
    aChoice("Export as CSV or as JSON?", ["CSV", "JSON"], 0, "Accounting imports CSV."),
    aChoice("Keep the old export too?", ["Keep it", "Remove it"], 1, "Nobody reads it."),
    {
      kind: "open",
      question: "What should the file be called?",
      why: "The download needs a name.",
    },
  ]);
  const toAskAgain = await seedDecision(task, "Zip the export?");
  const answers = await catchAnswers(page, form);
  const askedAgain = await catchAnswers(page, toAskAgain);

  await page.goto(`/tasks/${task.id}`);
  const needsYou = page.getByRole("region", { name: "Needs you" });
  const card = needsYou.getByRole("region", {
    name: "Decision: Export as CSV or as JSON? (and 2 more questions)",
  });
  const format = card.getByRole("group", { name: "Question 1" });
  const oldExport = card.getByRole("group", { name: "Question 2" });
  const fileName = card.getByRole("group", { name: "Question 3" });
  await expect(card).toBeVisible();
  await expectNeedsYouInTheRecordColumn(page, needsYou);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expectNeedsYouInTheRecordColumn(page, needsYou);
  await page.setViewportSize({ width: 1600, height: 900 });
  // Each choice starts at its recommended option, the one marked so, with "None of these" last.
  const formatChoice = format.getByRole("radiogroup", { name: "Export as CSV or as JSON?" });
  await expect(formatChoice.getByRole("radio")).toHaveCount(3);
  await expect(formatChoice.getByRole("radio", { name: /^CSV/ })).toBeChecked();
  await expect(formatChoice.getByRole("radio").last()).toHaveAccessibleName(
    "None of these: answer in words",
  );
  await expect(formatChoice.locator("label").filter({ hasText: "Recommended" })).toHaveText(/^CSV/);
  await expect(format.getByText(/recommends “CSV”: Accounting imports CSV\./)).toBeVisible();
  const oldExportChoice = oldExport.getByRole("radiogroup", { name: "Keep the old export too?" });
  await expect(oldExportChoice.getByRole("radio", { name: /^Remove it/ })).toBeChecked();
  await expect(oldExportChoice.locator("label").filter({ hasText: "Recommended" })).toHaveText(
    /^Remove it/,
  );
  await expect(fileName.getByRole("radio")).toHaveCount(0);
  await expect(fileName).toContainText("The download needs a name.");

  // Submit waits for the open question, naming it, and the progress line leads there.
  const submit = card.getByRole("button", { name: "Submit", exact: true });
  const progress = card.locator(".decision-progress");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("title", "Answer question 3 first.");
  await expect(progress).toContainText("2 of 3 answered");
  await card.getByRole("button", { name: "Question 3 needs an answer" }).click();
  const fileNameWords = fileName.getByRole("textbox", { name: /^Your answer\W*$/ });
  await expect(fileNameWords).toBeFocused();
  await card.scrollIntoViewIfNeeded();
  await screenshotScenario(page, "decision-form-in-place");

  // Another option with a comment; "None of these", whose words are then the answer; the words.
  await formatChoice.getByRole("radio", { name: "JSON", exact: true }).check();
  await format.getByRole("button", { name: "Add a comment" }).click();
  await format
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("The API clients read JSON.");
  await oldExportChoice.getByRole("radio", { name: "None of these: answer in words" }).check();
  await expect(oldExport.getByRole("button", { name: "Add a comment" })).toHaveCount(0);
  await fileNameWords.fill("invoices.json");
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("title", "Answer question 2 in its words first.");
  await expect(progress).toContainText("2 of 3 answered");
  await oldExport
    .getByRole("textbox", { name: /^Your answer in words/ })
    .fill("Keep it for a release, then remove it.");
  await expect(progress).toContainText("3 of 3 answered");
  await expect(progress).toContainText("Ready to submit");
  await card.getByRole("textbox", { name: "General comment" }).fill("Ship it with the release.");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect
    .poll(() => answers)
    .toEqual([
      {
        kind: "submitted",
        answers: [
          { kind: "option", option: 1, comment: "The API clients read JSON." },
          { kind: "words", text: "Keep it for a release, then remove it." },
          { kind: "words", text: "invoices.json" },
        ],
        generalComment: "Ship it with the release.",
      },
    ]);

  // Ask me again asks what to explain or change first, and Cancel leaves the form as it was.
  const zip = needsYou.getByRole("region", { name: "Decision: Zip the export?" });
  const askAgainStep = zip.getByRole("region", { name: "Ask me again" });
  await zip.getByRole("button", { name: "Ask me again" }).click();
  await expect(zip.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
  await askAgainStep.getByRole("button", { name: "Cancel" }).click();
  await expect(askAgainStep).toHaveCount(0);
  await expect(zip.getByRole("button", { name: "Submit", exact: true })).toBeEnabled();
  await zip.getByRole("button", { name: "Ask me again" }).click();
  await askAgainStep
    .getByRole("textbox", { name: /^What should .+ explain or change\?/ })
    .fill("One zip, or one per month?");
  await askAgainStep.getByRole("button", { name: "Ask me again" }).click();
  await expect
    .poll(() => askedAgain)
    .toEqual([{ kind: "asked-again", generalComment: "One zip, or one per month?" }]);
});

test(
  "a Decision with Attachments is accepted on its compact card, or answered in its window, its draft kept between",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Decision pictures", "DP");
    const task = await createdTask(page, project, "Choose a look");
    const pictures = [];
    for (const [index, name] of ["today.png", "wider.png", "taller.png", "plain.png"].entries()) {
      pictures.push(await attachedImage(page, task, name, aPng([60 * index, 120, 200])));
    }
    const removed = await attachedImage(page, task, "removed.png", aPng([200, 60, 60]));
    const link = await page.request.post(`/api/tasks/${task.id}/attachments/links`, {
      data: { name: "The brand guide", url: "https://example.com/brand-guide" },
    });
    expect(link.status()).toBe(201);
    const { id: linkId } = attachmentSchema.parse(await link.json());
    const brief = await page.request.post(
      `/api/tasks/${task.id}/attachments/files?${new URLSearchParams({ fileName: "brief.md", mediaType: "text/markdown" })}`,
      {
        headers: { "content-type": "application/octet-stream" },
        data: Buffer.from("# Brief\n\nKeep it plain."),
      },
    );
    expect(brief.status()).toBe(201);
    const { id: briefId } = attachmentSchema.parse(await brief.json());
    const notNamed = await attachedImage(page, task, "not-named.png", aPng([10, 10, 10]));
    const question = "Which look should the export take?";
    const seeded = await seedDecision(task, question, [
      ...pictures.map(({ id }) => id),
      removed.id,
      linkId,
      briefId,
    ]);
    expect((await page.request.delete(`/api/attachments/${removed.id}`)).status()).toBe(204);
    const answers = await catchAnswers(page, seeded);

    // The compact card: the context's first line, question 1 with its recommendation, Accept, and
    // the way to the window, where the Attachments are.
    await page.goto(`/tasks/${task.id}`);
    const card = page
      .getByRole("region", { name: "Needs you" })
      .getByRole("region", { name: `Decision: ${question}` });
    const first = card.getByRole("region", { name: "Question 1" });
    await expect(card.locator(".decision-context")).toHaveText("Both work.");
    await expect(first).toContainText(question);
    await expect(first.locator(".decision-compact-recommended")).toHaveText(/^Yes/);
    await expect(first).toContainText("recommends it: It is simpler.");
    await expect(card.locator(".decision-compact-more")).toHaveText(
      "6 Attachments to look at in Open details",
    );
    await expect(card.getByRole("radio")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /^View / })).toHaveCount(0);
    await screenshotScenario(page, "decision-form-compact");
    await card.getByRole("button", { name: "Accept" }).click();
    await expect
      .poll(() => answers)
      .toEqual([{ kind: "submitted", answers: [{ kind: "option", option: 0 }] }]);

    // The window: the context, the Attachments it names, the question with the recommended option
    // picked.
    await card.getByRole("button", { name: "Open details" }).click();
    const details = page.getByRole("dialog", { name: /^Decision/ });
    await expect(details).toContainText(question);
    await expect(details).toContainText("Both work.");
    const choice = details.getByRole("radiogroup", { name: question });
    await expect(choice.getByRole("radio", { name: /^Yes/ })).toBeChecked();
    await expect(
      choice.getByRole("radio", { name: "None of these: answer in words" }),
    ).not.toBeChecked();
    await expect(details.getByRole("button", { name: /^View / })).toHaveCount(4);
    await expect(details.getByRole("link", { name: "The brand guide" })).toBeVisible();
    await expect(details.getByRole("button", { name: `View ${notNamed.name}` })).toHaveCount(0);
    await expect(details.getByRole("button", { name: "View removed.png" })).toHaveCount(0);
    const size = await details.getByRole("button", { name: "View today.png" }).boundingBox();
    expect(size).toMatchObject({ width: 160, height: 100 });
    await screenshotScenario(page, "decision-form-window-attachments");

    // The Attachment viewer opens over the window, and Esc closes the viewer alone.
    await details.getByRole("button", { name: "View wider.png" }).click();
    await expect(page.getByRole("heading", { name: "wider.png" })).toBeVisible();
    await expect(page.getByText("2 of 4")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("heading", { name: "taller.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "taller.png" })).toHaveCount(0);
    await expect(details).toBeVisible();

    // A document opens over the window just the same.
    await details.getByRole("button", { name: "brief.md" }).click();
    await expect(page.getByRole("heading", { name: "brief.md" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "brief.md" })).toHaveCount(0);
    await expect(details).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);

    // The Needs you panel shows the same card: over it, each Esc closes what is on top.
    await page
      .getByRole("status", { name: "Status strip" })
      .getByRole("button", { name: /needs? you/ })
      .click();
    const panel = page.getByRole("dialog").filter({ hasText: "oldest first" });
    await panel
      .getByRole("region", { name: `Decision: ${question}` })
      .getByRole("button", { name: "Open details" })
      .click();
    await details.getByRole("button", { name: "View wider.png" }).click();
    await expect(page.getByRole("heading", { name: "wider.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "wider.png" })).toHaveCount(0);
    await expect(details).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    // Closing the window keeps the draft, and Accept waits while the draft differs from it.
    await card.getByRole("button", { name: "Open details" }).click();
    await choice.getByRole("radio", { name: "No", exact: true }).check();
    await details.getByRole("button", { name: "Add a comment" }).click();
    await details
      .getByRole("textbox", { name: "Comment", exact: true })
      .fill("Today's look is too busy.");
    await details.getByRole("button", { name: "Close", exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(card.getByText("Draft kept · 1 change")).toBeVisible();
    await expect(card.getByRole("button", { name: "Accept" })).toHaveCount(0);
    await card.getByRole("button", { name: "Open details" }).click();
    await expect(choice.getByRole("radio", { name: "No", exact: true })).toBeChecked();
    await expect(details.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue(
      "Today's look is too busy.",
    );
    await details.getByRole("button", { name: "Submit", exact: true }).click();
    await expect
      .poll(() => answers.at(-1))
      .toEqual({
        kind: "submitted",
        answers: [{ kind: "option", option: 1, comment: "Today's look is too busy." }],
      });
    await expect(details).toHaveCount(0);
    // A sent draft is gone, so Accept is back.
    await expect(card.getByRole("button", { name: "Accept" })).toBeVisible();

    // None of these: Submit waits for the answer in words.
    await card.getByRole("button", { name: "Open details" }).click();
    await choice.getByRole("radio", { name: "None of these: answer in words" }).check();
    const submit = details.getByRole("button", { name: "Submit", exact: true });
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("title", "Pick an option or write your answer first.");
    await details
      .getByRole("textbox", { name: /^Your answer in words/ })
      .fill("Take today's look, a little wider.");
    await submit.click();
    await expect
      .poll(() => answers.at(-1))
      .toEqual({
        kind: "submitted",
        answers: [{ kind: "words", text: "Take today's look, a little wider." }],
      });
    await expect(details).toHaveCount(0);
  },
);

test(
  "a Decision of eight questions shows compact, is answered question by question in its window, and keeps its draft in the Needs you panel",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Long Decision forms", "LF");
    const task = await createdTask(page, project, "Plan the invoice export");
    const questions: readonly DecisionQuestion[] = [
      aChoice("Which invoices go in the export?", ["Paid ones", "Every one"], 0, "Books close."),
      aChoice("Keep the old invoice export?", ["Keep it", "Remove it"], 1, "Nobody reads it."),
      { kind: "open", question: "What should the invoice file be called?" },
      aChoice("Where does the export button go?", ["The toolbar", "The menu"], 0, "Daily use."),
      aChoice("Zip large invoice exports?", ["Zip them", "Leave them plain"], 0, "They are big."),
      aChoice("Which dates are exported?", ["This month", "Any range"], 1, "Quarters close."),
      { kind: "open", question: "Who hears when an export fails?", why: "Someone must retry." },
      aChoice("Log each invoice export?", ["Log it", "Don't log it"], 0, "Audits ask."),
    ];
    const seeded = await seedDecision(task, questions);
    const answers = await catchAnswers(page, seeded);
    const name = "Decision: Which invoices go in the export? (and 7 more questions)";

    // Compact: question 1, how many more, the progress line, and no Accept with open questions.
    await page.goto(`/tasks/${task.id}`);
    const card = page.getByRole("region", { name: "Needs you" }).getByRole("region", { name });
    await expect(card.getByRole("region", { name: "Question 1" })).toContainText("Question 1 of 8");
    await expect(card.locator(".decision-compact-more")).toHaveText(
      "7 more questions, 2 of them open questions",
    );
    await expect(card.locator(".decision-progress")).toContainText("6 of 8 answered");
    await expect(card.getByRole("button", { name: "Accept" })).toHaveCount(0);
    await expect(card.getByRole("radio")).toHaveCount(0);
    await screenshotScenario(page, "decision-form-compact-long");

    // The progress line opens the window at the question that needs an answer.
    await card.getByRole("button", { name: "Question 3 needs an answer" }).click();
    const window = page.getByRole("dialog", { name: /^Decision/ });
    const overline = window.locator(".decision-window-overline");
    const list = window.getByRole("navigation", { name: "Questions" });
    await expect(overline).toHaveText("Question 3 of 8");
    await expect(list.getByRole("button")).toHaveCount(8);
    await expect(list.getByRole("button").nth(2)).toHaveAttribute("aria-current", "true");
    await window.getByRole("textbox", { name: /^Your answer\W*$/ }).fill("invoices-<month>.csv");
    await expect(list.getByRole("button").nth(2)).toContainText("invoices-<month>.csv");

    // Every question is reached by Next, from the first to the last.
    await list.getByRole("button").first().click();
    for (const [index, { question }] of questions.entries()) {
      await expect(overline).toHaveText(`Question ${index + 1} of 8`);
      await expect(window.getByRole("group", { name: `Question ${index + 1}` })).toContainText(
        question,
      );
      if (index < questions.length - 1) await window.getByRole("button", { name: "Next" }).click();
    }
    await expect(window.getByRole("button", { name: "Next" })).toHaveCount(0);
    await expect(
      window.locator(".decision-window-nav").getByRole("button", { name: "Submit", exact: true }),
    ).toBeVisible();
    await screenshotScenario(page, "decision-form-window-last-question");
    await window.getByRole("button", { name: "Previous" }).click();
    await expect(overline).toHaveText("Question 7 of 8");
    await window
      .getByRole("textbox", { name: /^Your answer\W*$/ })
      .fill("The person who started it.");
    await list.getByRole("button").nth(5).click();
    await window
      .getByRole("radiogroup", { name: "Which dates are exported?" })
      .getByRole("radio", { name: "This month", exact: true })
      .check();
    const progress = window.locator(".decision-progress");
    await expect(progress).toContainText("8 of 8 answered");
    await expect(progress).toContainText("Ready to submit");

    // In a narrow window the questions are a row of numbers.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(list).toBeHidden();
    await window
      .getByRole("group", { name: "Questions by number" })
      .getByRole("button", { name: "Question 5" })
      .click();
    await expect(overline).toHaveText("Question 5 of 8");
    await page.setViewportSize({ width: 1600, height: 900 });
    await screenshotScenario(page, "decision-form-window");

    // Closing keeps the draft, which the same card in the Needs you panel shows and sends.
    await window.getByRole("button", { name: "Close", exact: true }).click();
    await expect(window).toHaveCount(0);
    await expect(card.getByText("Draft kept · 3 changes")).toBeVisible();
    await expect(card.locator(".decision-progress")).toContainText("8 of 8 answered");
    await page
      .getByRole("status", { name: "Status strip" })
      .getByRole("button", { name: /needs? you/ })
      .click();
    const panel = page.getByRole("dialog").filter({ hasText: "oldest first" });
    const inPanel = panel.getByRole("region", { name });
    await expect(inPanel.getByText("Draft kept · 3 changes")).toBeVisible();
    await expect(inPanel.locator(".decision-progress")).toContainText("Ready to submit");
    await inPanel.getByRole("button", { name: "Open details" }).click();
    await list.getByRole("button").nth(2).click();
    await expect(window.getByRole("textbox", { name: /^Your answer\W*$/ })).toHaveValue(
      "invoices-<month>.csv",
    );
    await window.getByRole("button", { name: "Submit", exact: true }).click();
    await expect
      .poll(() => answers)
      .toEqual([
        {
          kind: "submitted",
          answers: [
            { kind: "option", option: 0 },
            { kind: "option", option: 1 },
            { kind: "words", text: "invoices-<month>.csv" },
            { kind: "option", option: 0 },
            { kind: "option", option: 0 },
            { kind: "option", option: 0 },
            { kind: "words", text: "The person who started it." },
            { kind: "option", option: 0 },
          ],
        },
      ]);
    await expect(window).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  },
);

test(
  "a Decision of two questions folds in Now, stays in place on its Task, and is dismissed with a comment",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Folded Decision forms", "FD");
    const task = await createdTask(page, project, "Plan the refund export");
    const seeded = await seedDecision(task, [
      aChoice("Which refunds go in the export?", ["Paid ones", "Every one"], 0, "Books close."),
      aChoice("Zip large refund exports?", ["Zip them", "Leave them plain"], 0, "They are big."),
    ]);
    const answers = await catchAnswers(page, seeded);
    const name = "Decision: Which refunds go in the export? (and 1 more question)";

    // On the Task page, two questions are answered in place.
    await page.goto(`/tasks/${task.id}`);
    const onTask = page.getByRole("region", { name: "Needs you" }).getByRole("region", { name });
    await expect(onTask.getByRole("radiogroup")).toHaveCount(2);
    await expect(onTask.getByRole("button", { name: "Open details" })).toHaveCount(0);

    // In Now, the same form folds, its window behind Open details.
    await page.goto("/now");
    const card = page.getByRole("region", { name: "Needs you" }).getByRole("region", { name });
    await expect(card.getByRole("radio")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Open details" })).toBeVisible();
    await screenshotScenario(page, "decision-feed-compact", { inView: card });
    await card.getByRole("button", { name: "Open details" }).click();
    const window = page.getByRole("dialog", { name: /^Decision/ });
    await expect(window.getByRole("navigation", { name: "Questions" })).toBeVisible();
    await window.getByRole("button", { name: "Close", exact: true }).click();

    // Dismiss is a step with an optional comment, which Cancel leaves.
    await card.getByRole("button", { name: "Dismiss" }).click();
    const step = card.getByRole("region", { name: "Dismiss" });
    await expect(step).toContainText("Closes the Decision unanswered.");
    await screenshotScenario(page, "decision-dismiss-step", { inView: step });
    await step.getByRole("button", { name: "Cancel" }).click();
    await expect(step).toHaveCount(0);
    await card.getByRole("button", { name: "Dismiss" }).click();
    await step.getByRole("textbox").fill("We export by month now.");
    await step.getByRole("button", { name: "Dismiss" }).click();
    await expect
      .poll(() => answers)
      .toEqual([{ kind: "dismissed", generalComment: "We export by month now." }]);
  },
);

test(
  "the user edits a Task's title in place on its page, Esc cancelling",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Titles in place", "TP");
    const task = await createdTask(page, project, "Export the refunds");
    await page.goto(`/tasks/${task.id}`);
    const heading = page.getByRole("heading", { level: 2, name: "Export the refunds" });
    await expect(heading).toBeVisible();

    await page.getByRole("button", { name: "Edit the title" }).click();
    const field = page.getByRole("textbox", { name: "Task title" });
    await field.fill("Export the refunds by month");
    await screenshotScenario(page, "task-title-edit");
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(heading).toBeVisible();

    await page.getByRole("button", { name: "Edit the title" }).click();
    await field.fill("Export the refunds by month");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { level: 2, name: "Export the refunds by month" }),
    ).toBeVisible();
    await expect(field).toHaveCount(0);
  },
);

// Reads a Thread, which shows once the Planner is hired: run alone, after people.e2e.ts's hiring.
test(
  "a sent Decision form reads in its Thread: each answer with its comment, the general comment, and who answered",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Sent Decision forms", "SD");
    const task = await createdTask(page, project, "Export the invoices once");
    await seedAnsweredDecision(
      page,
      task,
      [
        aChoice("Which format should the export use?", ["CSV", "JSON"], 0, "Accounting asked."),
        aChoice("Keep the old export beside it?", ["Keep it", "Remove it"], 1, "Nobody reads it."),
        { kind: "open", question: "What should the downloaded file be called?" },
        aChoice("Zip the large exports?", ["Zip them", "Leave them plain"], 0, "They are big."),
      ],
      {
        kind: "submitted",
        answers: [
          { kind: "option", option: 0 },
          { kind: "option", option: 0, comment: "Two reports still read it." },
          { kind: "words", text: "invoices-<month>.csv" },
          { kind: "words", text: "Only past 10 MB." },
        ],
        generalComment: "Ship it with the next release.",
      },
    );

    await page.goto(`/tasks/${task.id}`);
    const card = page.getByRole("complementary", { name: "Conversation" }).getByRole("region", {
      name: "Decision: Which format should the export use? (and 3 more questions)",
    });
    await expect(card).toHaveClass(/\bsettled\b/);
    const answerWords = card.locator(".decision-answer-words");
    await expect(answerWords).toHaveText(["CSV (recommended)", "Keep it", "invoices-<month>.csv"]);
    await expect(card.locator(".decision-answer").nth(1)).toContainText(
      "Comment: Two reports still read it.",
    );
    await card.getByRole("button", { name: "Show all 4" }).click();
    await expect(answerWords).toHaveText([
      "CSV (recommended)",
      "Keep it",
      "invoices-<month>.csv",
      "Only past 10 MB.",
    ]);
    await expect(card).toContainText("General comment: Ship it with the next release.");
    await expect(card.locator(".decision-answered")).toHaveText("Answered by you");
    await expect(card.getByRole("button", { name: "Submit" })).toHaveCount(0);
    await card.scrollIntoViewIfNeeded();
    await screenshotScenario(page, "decision-form-answered-in-thread");
  },
);

/** A moment of the morning a test's fixed Stage runs happened in. */
function at(minute: number): string {
  return new Date(Date.UTC(2026, 10, 3, 9, minute)).toISOString();
}

/** A run of a Stage, as GET /tasks/:id/stages answers it. */
function aStageRun(
  number: number,
  startedAt: string,
  endedAt: string | null,
  gateAction: StageRun["gateAction"] = null,
): StageRun {
  return {
    id: crypto.randomUUID(),
    number,
    startedAt,
    endedAt,
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    engineSwitches: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: null,
    carriedFailure: null,
    sentBack: null,
    commandRuns: [],
    gateAction,
    outcome: null,
  };
}

function anAgentStage(key: string, name: string): Stage {
  return {
    kind: "agent",
    key,
    name,
    optional: false,
    role: "developer",
    brief: "Do it.",
    session: "fresh",
    budget: 100_000,
  };
}

function stageInSmall(history: Locator, name: string): Locator {
  return history.getByRole("list", { name: "Stages" }).getByRole("button", { name, exact: true });
}

function runOf(history: Locator, number: number): Locator {
  return history.getByRole("list", { name: "Runs" }).getByRole("button", {
    name: new RegExp(`^Run ${number} `),
  });
}

function detailsOf(history: Locator, number: number): Locator {
  return history.getByRole("region", { name: `Run ${number}`, exact: true });
}

test("selecting a Stage opens its history window, to move between Stages and runs and read a command's output", async ({
  page,
}) => {
  const project = await addedProject(page, "Stage history", "SH");
  const task = await createdTask(page, project, "A Task that looped");
  await choosePipeline(page, task);
  const threadId = crypto.randomUUID();
  const implement: Stage = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    optional: false,
    role: "developer",
    brief: "Do it.",
    session: "fresh",
    budget: 100_000,
  };
  const tests: Stage = {
    kind: "script",
    key: "tests",
    name: "Tests",
    optional: false,
    command: "test",
    onFailure: { goBackTo: "implement", rounds: 3 },
  };
  const look: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };
  const tokens = { input: 40_000, output: 2_000, cacheRead: 900_000, cacheCreation: 0 };
  const noTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const done = {
    status: "done",
    skipped: false,
    definitionOfDoneMet: null,
    pullRequestUrl: null,
    handoverNote: null,
  } as const;
  const briefedWithTheFailure: StageRun = {
    ...aStageRun(3, at(6), at(9)),
    threadId,
    session: "resume",
    carriedFailure: { stageKey: "tests", round: 1, rounds: 3 },
    outcome: {
      ...done,
      summary: "Fixed the test.",
      handoverNote: "The **redirect** moved.",
    },
  };
  const stages: TaskStages = {
    stages: [
      {
        stage: implement,
        state: "done",
        tokens,
        wentBack: null,
        runs: [
          {
            ...aStageRun(1, at(0), at(5)),
            threadId,
            session: "fresh",
            tokens,
            outcome: { ...done, summary: "Moved the redirect." },
          },
          briefedWithTheFailure,
          {
            ...aStageRun(6, at(14), at(15)),
            threadId,
            session: "resume",
            sentBack: { gateKey: "look", feedback: "Make the buttons bigger." },
            outcome: { ...done, summary: "Made them bigger." },
          },
        ],
      },
      {
        stage: tests,
        state: "done",
        tokens: noTokens,
        wentBack: null,
        runs: [
          {
            ...aStageRun(2, at(5), at(6)),
            commandRuns: [
              {
                purpose: "command",
                commandLine: "npm test",
                outcome: "failed",
                durationMs: 60_000,
              },
            ],
            outcome: {
              status: "failed",
              error: "2 tests failed.",
              budgetReached: null,
              interrupted: null,
              refusedTurn: null,
              afterPublishingFailed: null,
              handoverNote: null,
            },
          },
          { ...aStageRun(4, at(9), at(10)), outcome: { ...done, summary: "Tests passed." } },
          { ...aStageRun(7, at(15), at(16)), outcome: { ...done, summary: "Tests passed." } },
        ],
      },
      {
        stage: look,
        state: "waiting-on-you",
        tokens: noTokens,
        wentBack: null,
        runs: [
          aStageRun(5, at(10), at(14), {
            kind: "send-back",
            stageKey: "implement",
            feedback: "Make the buttons bigger.",
          }),
          aStageRun(8, at(16), null),
        ],
      },
    ],
    editedForTask: false,
    lockedStages: 3,
    testResults: [],
    definitionOfDoneMet: [],
    definitionOfDoneOutOfReach: [],
    gatesCheckingDefinitionOfDone: [],
  };
  await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
  await page.route(`**/api/tasks/${task.id}/stage-runs/*/command-outputs`, (route) =>
    route.fulfill({
      json: { outputs: ["… 6 KB cut from the start\n ✗ sign-in.test.ts\n Tests  2 failed"] },
    }),
  );
  await page.goto(`/tasks/${task.id}`);

  const rail = page.getByRole("region", { name: /^Pipeline · / });
  const stageButton = (name: string): Locator => rail.getByRole("button", { name, exact: true });
  const historyOf = (name: string): Locator =>
    page.getByRole("dialog", { name: new RegExp(`^Stage history: ${name}`) });
  // Tests went back once; the Gate's send-back draws nothing.
  const loop = rail.getByRole("button", { name: /failed and went back/ });
  await expect(loop).toHaveCount(1);
  await expect(loop).toHaveAccessibleName(
    "Tests failed and went back to Implement 1 time, of at most 3",
  );
  await expect(loop).toHaveText("↺ 1 of 3");
  await expect(stageButton("UI acceptance")).toHaveAttribute("aria-current", "step");

  // The window opens on the newest run, the Stage shown marked in the Pipeline in small.
  await loop.click();
  const testsHistory = historyOf("Tests");
  await expect(stageInSmall(testsHistory, "Tests")).toHaveAttribute("aria-pressed", "true");
  await expect(stageInSmall(testsHistory, "Tests")).toBeFocused();
  await expect(testsHistory.getByRole("list", { name: "Runs" }).getByRole("listitem")).toHaveCount(
    3,
  );
  await expect(runOf(testsHistory, 7)).toHaveAttribute("aria-pressed", "true");
  await expect(detailsOf(testsHistory, 7)).toContainText("No commands ran.");

  // A Project command's run: its outcome, then each command with its whole output.
  await expect(runOf(testsHistory, 2)).toContainText("2 tests failed.");
  await runOf(testsHistory, 2).click();
  const failedRun = detailsOf(testsHistory, 2);
  await expect(failedRun).toContainText("2 tests failed.");
  const npmTest = failedRun.getByRole("region", { name: "npm test" });
  await expect(npmTest).toContainText("failed");
  await expect(npmTest).toContainText("1m");
  await expect(npmTest.locator("pre")).toContainText("… 6 KB cut from the start");
  await expect(npmTest.locator("pre")).toContainText("Tests  2 failed");
  await expect(testsHistory.getByRole("tab")).toHaveCount(0);
  const windowHeight = (await testsHistory.boundingBox())?.height;
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-stage-history.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
  await animationsSettled(page);
  await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-stage-history.png") });
  await page.emulateMedia({ colorScheme: "light" });

  // ← moves to the Stage before; the window keeps its height, and opens on Summary for an ended run.
  await page.keyboard.press("ArrowLeft");
  const implementHistory = historyOf("Implement");
  await expect(testsHistory).toHaveCount(0);
  await expect(stageInSmall(implementHistory, "Implement")).toBeFocused();
  await expect(implementHistory).toContainText("Agent Stage");
  expect((await implementHistory.boundingBox())?.height).toBe(windowHeight);
  await expect(implementHistory.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Newest first: each run's list item is a line or two, and the rest shows once it is picked.
  const newest = detailsOf(implementHistory, 6);
  await expect(newest).toContainText("Sent back from UI acceptance");
  await expect(newest).toContainText("Make the buttons bigger.");
  await expect(newest).toContainText("No Handover note.");
  await expect(runOf(implementHistory, 6)).toContainText("Made them bigger.");
  await expect(runOf(implementHistory, 6)).not.toContainText("Make the buttons bigger.");
  await expect(runOf(implementHistory, 3)).toContainText("Briefed with what failed");
  await runOf(implementHistory, 3).click();
  const carried = detailsOf(implementHistory, 3);
  await expect(carried).toContainText("Briefed with what failed in Tests, round 1 of 3");
  await expect(carried).toContainText("Fixed the test.");
  await expect(carried).toContainText("continued session");
  await expect(carried.getByRole("region", { name: "Handover note" }).locator("strong")).toHaveText(
    "redirect",
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-stage-history-summary.png") });
  await expect(runOf(implementHistory, 1)).toContainText("42k tokens");
  await runOf(implementHistory, 1).click();
  await expect(detailsOf(implementHistory, 1)).toContainText("fresh session");

  // A run's tab is kept while the window is open.
  await runOf(implementHistory, 3).click();
  await implementHistory.getByRole("tab", { name: "Thread" }).click();
  await runOf(implementHistory, 1).click();
  await expect(implementHistory.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await runOf(implementHistory, 3).click();
  await expect(implementHistory.getByRole("tab", { name: "Thread" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // The keys stop at the ends and work after a press on the window's text; a Stage in small moves
  // too, and each Stage keeps the run picked.
  await page.keyboard.press("ArrowLeft");
  await expect(implementHistory).toBeVisible();
  await stageInSmall(implementHistory, "Tests").click();
  await expect(runOf(testsHistory, 2)).toHaveAttribute("aria-pressed", "true");
  await failedRun.getByText("2 tests failed.").click();
  await page.keyboard.press("ArrowRight");

  // A Gate's run: what it waits for and the way to Needs you, or what the user did.
  const gateHistory = historyOf("UI acceptance");
  const waiting = detailsOf(gateHistory, 8);
  await expect(waiting).toContainText("Waits for you to look at the changes");
  await runOf(gateHistory, 5).click();
  await expect(detailsOf(gateHistory, 5)).toContainText("You sent back to Implement");
  await runOf(gateHistory, 8).click();

  // Esc gives focus back to the Stage on the rail; so does the way to Needs you, and the window
  // doesn't stay over it.
  await page.keyboard.press("Escape");
  await expect(gateHistory).toHaveCount(0);
  await expect(stageButton("UI acceptance")).toBeFocused();

  // A press on a Stage's mark opens it too, as the mark is no control of its own.
  const implementMark = rail
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Implement", exact: true }) })
    .locator(".stage-mark");
  const markBox = await implementMark.boundingBox();
  if (!markBox) throw new Error("Implement's mark is not on the page");
  const markCentre = { x: markBox.x + markBox.width / 2, y: markBox.y + markBox.height / 2 };
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? null,
      markCentre,
    ),
  ).toBe("Implement");
  await page.mouse.click(markCentre.x, markCentre.y);
  await expect(implementHistory).toBeVisible();

  // The Stages in small leave room above each mark for the running ring at its largest: 3px out
  // from the mark, scaled 1.9 times.
  const stagesInSmall = implementHistory.getByRole("list", { name: "Stages" });
  const stripTop = (await stagesInSmall.boundingBox())?.y ?? Number.NaN;
  const markInSmall = (await stagesInSmall.locator(".stage-mark").first().boundingBox()) ?? {
    y: Number.NaN,
    width: Number.NaN,
  };
  const ringReach = ((markInSmall.width + 6) * 1.9 - markInSmall.width) / 2;
  expect(markInSmall.y - stripTop).toBeGreaterThanOrEqual(ringReach);
  await page.keyboard.press("Escape");
  await expect(implementHistory).toHaveCount(0);
  await stageButton("UI acceptance").click();
  await waiting.getByRole("button", { name: "Answer it in Needs you" }).click();
  await expect(gateHistory).toHaveCount(0);

  // An address naming a run opens the window there; closing takes it off the address.
  await page.goto(`/tasks/${task.id}?taskThread=${briefedWithTheFailure.id}`);
  await expect(runOf(implementHistory, 3)).toHaveAttribute("aria-pressed", "true");
  await implementHistory.getByRole("button", { name: "Close", exact: true }).click();
  await expect(implementHistory).toHaveCount(0);
  await expect(page).not.toHaveURL(/taskThread/);

  // In a phone's width the panes stack, and nothing but the rows made to scrolls sideways.
  await page.setViewportSize({ width: 420, height: 800 });
  await stageButton("Tests").evaluate((button: HTMLElement) => button.click());
  await expect(testsHistory).toBeVisible();
  await expect
    .poll(() =>
      testsHistory.locator(".dialog-body").evaluate((body) => body.scrollWidth - body.clientWidth),
    )
    .toBe(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-420-stage-history.png") });
  await page.keyboard.press("Escape");
  await expect(testsHistory).toHaveCount(0);

  // In a window too narrow for the Stages the loop-back's arc scrolls with them.
  const stagesScroller = rail.locator(".pipeline-rail-scroll");
  await expect
    .poll(() => stagesScroller.evaluate((view) => view.scrollWidth - view.clientWidth))
    .toBeGreaterThan(0);
  await stagesScroller.evaluate((view) => {
    view.scrollLeft = (view.scrollWidth - view.clientWidth) / 2;
  });
  await rail.screenshot({ path: path.join(SCREENSHOTS, "light-420-rail-arcs-scrolled.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
  await animationsSettled(page);
  await rail.screenshot({ path: path.join(SCREENSHOTS, "dark-420-rail-arcs-scrolled.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1600, height: 900 });
});

test("Continue with notes at a Gate sends them on, and the Gate's run shows them in its Stage history", async ({
  page,
}) => {
  const project = await addedProject(page, "Gate notes", "GN");
  const task = await createdTask(page, project, "A design to pick from");
  await choosePipeline(page, task);
  const design = anAgentStage("design", "Design");
  const look: Stage = { kind: "gate", key: "look", name: "Design review", optional: false };
  const implement = anAgentStage("implement", "Implement");
  const noTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const gateReached: StageRun["outcome"] = {
    status: "done",
    summary: "The Task reached the Gate and waited for the user.",
    skipped: false,
    definitionOfDoneMet: null,
    pullRequestUrl: null,
    handoverNote: null,
  };
  const designed: TaskStage = {
    stage: design,
    state: "done",
    tokens: noTokens,
    wentBack: null,
    runs: [
      { ...aStageRun(1, at(0), at(5)), outcome: { ...gateReached, summary: "Two versions." } },
    ],
  };
  const gateRun = { ...aStageRun(2, at(5), at(5)), outcome: gateReached };
  const notes = "The design is accepted: implement version B.";
  const stagesWith = (
    gateAction: StageRun["gateAction"],
    implementState: TaskStage["state"],
  ): TaskStages => ({
    stages: [
      designed,
      {
        stage: look,
        state: gateAction ? "done" : "waiting-on-you",
        tokens: noTokens,
        wentBack: null,
        runs: [{ ...gateRun, gateAction }],
      },
      { stage: implement, state: implementState, tokens: noTokens, wentBack: null, runs: [] },
    ],
    editedForTask: false,
    lockedStages: 2,
    testResults: [],
    definitionOfDoneMet: [],
    definitionOfDoneOutOfReach: [],
    gatesCheckingDefinitionOfDone: [],
  });
  let stages = stagesWith(null, "pending");
  await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
  const continued: unknown[] = [];
  await page.route(`**/api/tasks/${task.id}/gate/continue`, (route) => {
    continued.push(route.request().postDataJSON());
    stages = stagesWith({ kind: "continue", feedback: notes }, "running");
    return route.fulfill({ json: stages });
  });
  await page.goto(`/tasks/${task.id}`);

  // The card's Continue stays one click; the window offers notes, as an Agent Stage comes next.
  const gate = page.getByRole("region", { name: "Gate · Design review" });
  await expect(gate.getByRole("button", { name: "Continue to Implement" })).toBeVisible();
  await expect(gate.getByRole("button", { name: "Continue with notes…" })).toHaveCount(0);
  await gate.getByRole("button", { name: "Show details" }).click();
  const details = page.getByRole("dialog", { name: /Before Implement/ });
  await details.getByRole("button", { name: "Continue with notes…" }).click();
  const notesField = details.getByLabel("Your notes");
  await expect(notesField).toBeFocused();
  const continueWithNotes = details.getByRole("button", { name: "Continue to Implement" });
  await expect(continueWithNotes).toBeDisabled();
  await notesField.fill(notes);
  await expect(continueWithNotes).toBeEnabled();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-continue-notes.png") });
  await continueWithNotes.click();
  await expect(page.getByText("Continuing to Implement.")).toBeVisible();
  await expect(details).toHaveCount(0);
  expect(continued).toEqual([{ feedback: notes }]);

  // The Gate's run shows what the user did, with the notes, as Send back's shows its feedback.
  await page
    .getByRole("region", { name: /^Pipeline · / })
    .getByRole("button", { name: "Design review", exact: true })
    .click();
  const gateHistory = page.getByRole("dialog", { name: /^Stage history: Design review/ });
  await expect(detailsOf(gateHistory, 2)).toContainText("You continued, with notes");
  await expect(detailsOf(gateHistory, 2)).toContainText(notes);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-notes-history.png") });
});

test("a Gate just before Publish is the Definition of Done check: it lists what isn't reported met, and Continue publishes anyway", async ({
  page,
}) => {
  const project = await addedProject(page, "Gate check", "GC");
  const task = await createdTask(page, project, "Export the usage");
  await choosePipeline(page, task);
  await page.request.put(`/api/tasks/${task.id}/definition-of-done`, {
    data: {
      definitionOfDone: [
        "The usage exports as a file.",
        "The file keeps the dates.",
        "The export runs on Windows.",
      ],
    },
  });
  const implement = anAgentStage("implement", "Implement");
  const look: Stage = { kind: "gate", key: "look", name: "Review", optional: false };
  const publish: Stage = {
    kind: "script",
    key: "publish",
    name: "Publish",
    optional: false,
    command: "publish",
  };
  const noTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const gateReached: StageRun["outcome"] = {
    status: "done",
    summary: "The Task reached the Gate and waited for the user.",
    skipped: false,
    definitionOfDoneMet: null,
    pullRequestUrl: null,
    handoverNote: null,
  };
  const stages: TaskStages = {
    stages: [
      {
        stage: implement,
        state: "done",
        tokens: noTokens,
        wentBack: null,
        runs: [
          {
            ...aStageRun(1, at(0), at(5)),
            outcome: { ...gateReached, summary: "Exported.", definitionOfDoneMet: [1] },
          },
        ],
      },
      {
        stage: look,
        state: "waiting-on-you",
        tokens: noTokens,
        wentBack: null,
        runs: [{ ...aStageRun(2, at(5), at(5)), outcome: gateReached }],
      },
      { stage: publish, state: "pending", tokens: noTokens, wentBack: null, runs: [] },
    ],
    editedForTask: false,
    lockedStages: 2,
    testResults: [],
    definitionOfDoneMet: [1],
    definitionOfDoneOutOfReach: [{ statement: 3, why: "It needs a Windows machine." }],
    gatesCheckingDefinitionOfDone: ["look"],
  };
  await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
  await page.goto(`/tasks/${task.id}`);

  const gate = page.getByRole("region", { name: "Gate · Review" });
  const unmet = gate.getByRole("region", { name: "Definition of Done not reported met" });
  await expect(unmet.getByRole("listitem")).toHaveText([
    "The file keeps the dates.",
    "The export runs on Windows.Out of reach: It needs a Windows machine.",
  ]);
  await expect(gate.getByRole("button", { name: "Continue and publish anyway" })).toBeVisible();
  await gate.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-gate-checks-definition-of-done.png"),
  });

  await gate.getByRole("button", { name: "Show details" }).click();
  const details = page.getByRole("dialog", { name: /Before Publish/ });
  await expect(
    details
      .getByRole("region", { name: "Definition of Done not reported met" })
      .getByRole("listitem"),
  ).toHaveCount(2);
  await expect(details.getByRole("button", { name: "Continue and publish anyway" })).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-gate-window-checks-definition-of-done.png"),
  });
});

test(
  "a Task's images show by round, the Gate shows the current one, and the viewer steps through them",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Gallery rounds", "GR");
    const task = await createdTask(page, project, "Gallery of two rounds");
    await choosePipeline(page, task);
    const workStarted = new Date(Date.now() - 60_000).toISOString();
    const firstLook = await attachedImage(page, task, "first-look.png", aPng([230, 120, 60]));
    const firstDetail = await attachedImage(page, task, "first-detail.png", aPng([60, 140, 200]));
    const sentBackAt = new Date(Date.parse(firstDetail.addedAt) + 1).toISOString();
    const secondLook = await attachedImage(page, task, "second-look.png", aPng([80, 170, 90]));
    expect(Date.parse(secondLook.addedAt)).toBeGreaterThan(Date.parse(sentBackAt));
    expect(Date.parse(firstLook.addedAt)).toBeGreaterThan(Date.parse(workStarted));
    // A send-back is a Gate run's, which only a walk of Agent sessions makes: the Stages are answered
    // as a walk would leave them, waiting at the Gate again after one send-back.
    const implement: Stage = {
      kind: "agent",
      key: "implement",
      name: "Implement",
      optional: false,
      role: "developer",
      brief: "Do it.",
      session: "fresh",
      budget: 100_000,
    };
    const look: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };
    const noTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    const gateReached: StageRun["outcome"] = {
      status: "done",
      summary: "The Task reached the Gate and waited for the user.",
      skipped: false,
      definitionOfDoneMet: null,
      pullRequestUrl: null,
      handoverNote: null,
    };
    const stages: TaskStages = {
      stages: [
        {
          stage: implement,
          state: "done",
          tokens: noTokens,
          wentBack: null,
          runs: [aStageRun(1, workStarted, sentBackAt), aStageRun(3, sentBackAt, sentBackAt)],
        },
        {
          stage: look,
          state: "waiting-on-you",
          tokens: noTokens,
          wentBack: null,
          runs: [
            {
              ...aStageRun(2, sentBackAt, sentBackAt, {
                kind: "send-back",
                stageKey: "implement",
                feedback: "Make the buttons bigger.",
              }),
              outcome: gateReached,
            },
            { ...aStageRun(4, secondLook.addedAt, null), outcome: gateReached },
          ],
        },
      ],
      editedForTask: false,
      lockedStages: 2,
      testResults: [],
      definitionOfDoneMet: [],
      definitionOfDoneOutOfReach: [],
      gatesCheckingDefinitionOfDone: [],
    };
    await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
    await page.goto(`/tasks/${task.id}`);

    await page
      .getByRole("region", { name: "Gate · UI acceptance" })
      .getByRole("button", { name: "Show details" })
      .click();
    const gateWindow = page.getByRole("dialog", { name: /UI acceptance/ });
    const gate = gateWindow.getByRole("region", { name: "Attachments" });
    await expect(gate.getByRole("button", { name: /^View / })).toHaveCount(1);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-attachments.png") });
    // The Attachment viewer is the one window that opens on another, and Esc closes it first.
    await gate.getByRole("button", { name: "View second-look.png" }).click();
    await expect(page.getByRole("heading", { name: "second-look.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "second-look.png" })).toHaveCount(0);
    await gateWindow.getByRole("button", { name: "Close", exact: true }).click();
    await expect(gateWindow).toHaveCount(0);

    await page.getByRole("tab", { name: "Attachments" }).click();
    const attachments = page.getByRole("region", { name: "Attachments", exact: true });
    const roundTwo = attachments.getByRole("group", { name: "Round 2" });
    const roundOne = attachments.getByRole("group", { name: "Round 1" });
    await expect(roundTwo).toContainText("Sent back: Make the buttons bigger.");
    await expect(roundTwo.getByRole("button", { name: "View second-look.png" })).toBeVisible();
    await expect(roundOne.getByRole("button", { name: "View first-look.png" })).toBeHidden();
    await roundOne.getByText("Round 1").click();
    await expect(roundOne.getByRole("button", { name: "View first-look.png" })).toBeVisible();
    await expect(roundOne.getByRole("button", { name: "View first-detail.png" })).toBeVisible();
    await attachments.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-task-attachment-rounds.png"),
    });

    await roundOne.getByRole("button", { name: "View first-look.png" }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.getByRole("heading", { name: "first-look.png" })).toBeVisible();
    await expect(viewer).toContainText("1 of 3 · Round 1 · Added by You");
    await expect(viewer.getByRole("link", { name: "Open the original" })).toHaveAttribute(
      "href",
      `/api/attachments/${firstLook.id}/content`,
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-attachment-viewer.png") });
    await viewer.getByRole("button", { name: "Next" }).click();
    await expect(viewer.getByRole("heading", { name: "first-detail.png" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(viewer.getByRole("heading", { name: "second-look.png" })).toBeVisible();
    await expect(viewer).toContainText("3 of 3 · Round 2");
    await expect(viewer.getByRole("button", { name: "Next" })).toBeDisabled();
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByRole("heading", { name: "first-detail.png" })).toBeVisible();
    await viewer.getByRole("button", { name: "Previous" }).click();
    await expect(viewer.getByRole("heading", { name: "first-look.png" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
  },
);

test(
  "a Task's Changes tab lists the files its branch changed with their lines and the diff, and opens them in the editor while the Task has its worktree",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Changes", "CH");
    const task = await createdTask(page, project, "Back off on reconnect");
    await commitOnTaskBranch(
      repository,
      task.id,
      "backoff.ts",
      "export const BACKOFF_MS = 30_000;\nexport const RETRIES = 5;\n",
    );
    await page.goto(`/tasks/${task.id}`);

    await page.getByRole("tab", { name: /Changes/ }).click();

    await expect(page).toHaveURL(/recordTab=changes/);
    const changes = page.getByRole("region", { name: "Changes" });
    await expect(changes.getByText("Files changed · 1")).toBeVisible();
    await expect(changes.getByRole("listitem")).toContainText(["backoff.ts+2−0"]);
    // Each file starts folded to its header; a click unfolds it, and "Fold all" folds it again.
    const diff = changes.getByLabel("Diff of backoff.ts against the base branch");
    await expect(diff).toHaveCount(0);
    await changes.getByRole("button", { name: /backoff\.ts/ }).click();
    await expect(diff).toContainText("+export const BACKOFF_MS = 30_000;");
    await changes.getByRole("button", { name: "Fold all", exact: true }).click();
    await expect(diff).toHaveCount(0);
    await changes.getByRole("button", { name: "Unfold all" }).click();
    await expect(diff).toBeVisible();
    await expect(changes.getByText("Tests:")).toBeVisible();
    await expect(changes.getByText("not run yet")).toBeVisible();
    // The branch has no worktree yet, so there is nothing to open.
    await expect(changes.getByRole("link", { name: "Open in editor" })).toHaveCount(0);
    await expect(changes.getByRole("link", { name: "Open backoff.ts in the editor" })).toHaveCount(
      0,
    );

    addTaskWorktree(repository, task.id, taskWorktreePath(project.id, task.id));
    await page.reload();

    // Forward slashes only, a Windows drive letter included.
    const worktreeUrl = `^vscode://file/[^\\\\]+/worktrees/${project.id}/${task.id}`;
    await expect(changes.getByRole("link", { name: "Open in editor" })).toHaveAttribute(
      "href",
      new RegExp(`${worktreeUrl}$`),
    );
    await expect(
      changes.getByRole("link", { name: "Open backoff.ts in the editor" }),
    ).toHaveAttribute("href", new RegExp(`${worktreeUrl}/backoff\\.ts$`));
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-changes.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-task-changes.png") });
    await page.emulateMedia({ colorScheme: "light" });

    await page.getByRole("tab", { name: "Overview" }).click();
    await expect(page.getByRole("region", { name: "Record" })).toBeVisible();
  },
);

/** What git prints, trimmed, run in the repository's remote. */
function gitOnRemote(
  repositoryWithRemote: TemporaryRepositoryWithRemote,
  ...gitArguments: string[]
): string {
  return execFileSync("git", gitArguments, {
    cwd: repositoryWithRemote.remote,
    encoding: "utf8",
  }).trim();
}

/** What `git rev-parse` names in the repository. */
function revisionIn(repositoryPath: string, revision: string): string {
  return execFileSync("git", ["rev-parse", revision], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

test(
  "a shaping Initiative's Pipelines block, edited as a whole, takes a branch, its name and a Pipeline, and Confirm makes the branch at the base",
  { tag: "@full" },
  async ({ page }) => {
    // A repository of its own, as the branch is made in it and Short names are Office-wide.
    const own = await createTemporaryRepository();
    try {
      const word = aWordOfItsOwn();
      const project = await addedProject(page, `Branched ${word}`, "BR", own.path);
      const initiativeId = await seedInitiative(page, `Branched release ${word}`, {
        state: "shaping",
        createdAt: new Date().toISOString(),
      });
      const title = `Branched step ${word}`;
      await seedTaskOf(page, project, title, initiativeId);
      await queryOfficeDatabase(`update tasks set state = 'shaping' where title = $1`, [title]);
      const base = revisionIn(own.path, "main");

      await page.goto(`/work/initiatives/${initiativeId}`);
      const block = page.getByRole("region", { name: "Pipelines", exact: true });
      // Edit opens the block as one form: the branch per Project, its name, then its Pipeline.
      await block.getByRole("button", { name: "Edit", exact: true }).click();
      await block
        .getByRole("list", { name: "Initiative's branch, per Project" })
        .getByRole("listitem")
        .filter({ hasText: project.name })
        .getByRole("switch")
        .click();
      const projectBlock = block.getByRole("listitem", { name: project.name, exact: true });
      const picker = `${project.name}'s Pipeline`;
      await pickPipeline(projectBlock, picker, "Full");
      await expect(projectBlock.getByRole("combobox", { name: picker, exact: true })).toHaveText(
        "Full",
      );
      const shortName = `branched-${word}`;
      await block.getByLabel("Short name").fill(shortName);
      await screenshotScenario(page, "initiative-pipelines-editing", { fullPage: true });
      await block.getByRole("button", { name: "Save", exact: true }).click();
      await expect(block.getByText(`initiative/${shortName}`, { exact: true })).toBeVisible();
      await expect(projectBlock.getByText(/^Full · \d+ Stages/)).toBeVisible();
      await screenshotScenario(page, "initiative-pipelines-shaping", { fullPage: true });

      await page.getByRole("button", { name: "Confirm the Initiative" }).click();
      await expect(block.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(projectBlock.getByText(/^Full · \d+ Stages/)).toBeVisible();
      await expect(block.getByText(`initiative/${shortName}`, { exact: true })).toBeVisible();
      await expect(block.getByRole("combobox")).toHaveCount(0);
      expect(revisionIn(own.path, `initiative/${shortName}`)).toBe(base);
    } finally {
      await own.remove();
    }
  },
);

/** A library Pipeline of the test's own, by its Stages. */
async function addedPipeline(
  page: Page,
  name: string,
  stages: readonly Stage[],
): Promise<{ readonly id: string }> {
  const response = await page.request.post("/api/pipelines", {
    data: { name, description: "", stages },
  });
  expect(response.status()).toBe(201);
  return pipelineSchema.parse(await response.json());
}

async function initiativeOf(page: Page, id: string): Promise<Initiative> {
  return initiativeSchema.parse(await (await page.request.get(`/api/initiatives/${id}`)).json());
}

/**
 * A Stage Thread on the Task, as an Agent Stage leaves one: a Pipeline without one has no Thread
 * for the walk's Decisions, which are only kept there, waking nobody.
 */
async function seedStageThread(taskId: string): Promise<void> {
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, state, stage_thread, tokens, started_at)
     values ($1, 'task', $2, 'developer', 'waiting', true, $3, now())`,
    [crypto.randomUUID(), taskId, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
}

/**
 * Lets the Task finish by the Definition of Done Decision its walk opens, as the user does, no Agent
 * Stage having reported the statements met: "Mark the Task Done" past the last Stage of a Pipeline
 * whose first Stage is Publish, "Call it met and publish" before any other Publish.
 */
async function markDoneByItsDecision(page: Page, taskId: string): Promise<void> {
  const openOn = async () =>
    decisionListSchema
      .parse(await (await page.request.get("/api/decisions/open")).json())
      .filter((decision) => decision.taskId === taskId);
  await expect.poll(async () => (await openOn()).length).toBe(1);
  const [decision] = await openOn();
  // Kept before the reply reads the Thread's Brief, which needs its Role filled: run alone, this
  // file hires nobody, so the walk going on is what tells.
  await page.request.post(`/api/decisions/${decision?.id}/answer`, {
    data: { kind: "submitted", answers: [{ kind: "option", option: 1 }] },
  });
  await expect
    .poll(
      async () =>
        taskSchema.parse(await (await page.request.get(`/api/tasks/${taskId}`)).json()).state,
    )
    .toBe("done");
}

async function publishingTasksOf(page: Page, initiativeId: string): Promise<Task[]> {
  const tasks = ((await (await page.request.get("/api/tasks")).json()) as unknown[]).map((task) =>
    taskSchema.parse(task),
  );
  return tasks.filter(
    (task) => task.initiativeId === initiativeId && task.madeFor === "publishing",
  );
}

test(
  "an Initiative's Task lands on its branch as one commit with its message, and its last Task Done adds its Publishing Task, whose Gate shows the whole change and whose Publish carries it into main",
  { tag: "@full" },
  async ({ page }) => {
    const own = await createTemporaryRepositoryWithRemote();
    try {
      const stamp = Date.now();
      const publishStage: Stage = {
        kind: "script",
        key: "publish",
        name: "Publish",
        optional: false,
        command: "publish",
      };
      const reviewStage: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
      const publishOnly = await addedPipeline(page, `Publish only ${stamp}`, [publishStage]);
      const reviewed = await addedPipeline(page, `Review and publish ${stamp}`, [
        reviewStage,
        publishStage,
      ]);
      const project = projectSchema.parse(
        await (
          await page.request.post("/api/projects", {
            data: {
              name: `Exports ${stamp}`,
              path: own.path,
              baseBranch: "main",
              mark: { label: "EX", colour: "teal" },
              installCommand: "",
              commands: [],
              installInputs: [],
              publishingMode: "merge",
              defaultPipeline: reviewed.id,
            } satisfies NewProject,
          })
        ).json(),
      );

      // An Initiative with one Task in the Project, on the reviewed Pipeline there.
      const idea = ideaSchema.parse(
        await (
          await page.request.post("/api/ideas", {
            data: { title: `Usage exports ${stamp}`, notes: "", projectId: null },
          })
        ).json(),
      );
      const shaped = initiativeSchema.parse(
        await (await page.request.post(`/api/ideas/${idea.id}/initiative`)).json(),
      );
      await page.request.put(`/api/initiatives/${shaped.id}/outcome`, {
        data: { outcome: "Every account exports its usage." },
      });
      const task = taskSchema.parse(
        await (
          await page.request.post(`/api/initiatives/${shaped.id}/tasks`, {
            data: {
              title: "Export the usage",
              projectId: project.id,
              priority: "normal",
              blockedBy: [],
            },
          })
        ).json(),
      );
      // Each Project the Initiative spans chooses its own Pipeline.
      const chosen = await page.request.put(`/api/initiatives/${shaped.id}/pipeline`, {
        data: { projectId: project.id, pipelineId: reviewed.id },
      });
      expect(chosen.status()).toBe(200);
      expect((await page.request.post(`/api/initiatives/${shaped.id}/confirm`)).status()).toBe(200);
      const initiative = await initiativeOf(page, shaped.id);
      const branch = `initiative/${initiative.shortName}`;

      // The Task, on the Publish only Pipeline, publishes its work into the Initiative's branch.
      await page.request.put(`/api/tasks/${task.id}/plan`, { data: { plan: "Export it." } });
      await page.request.put(`/api/tasks/${task.id}/definition-of-done`, {
        data: { definitionOfDone: ["The usage exports as a file."] },
      });
      await page.request.post(`/api/tasks/${task.id}/plan/confirm`);
      await page.request.post(`/api/tasks/${task.id}/definition-of-done/confirm`);
      await choosePipeline(page, task, publishOnly.id);
      expect((await page.request.post(`/api/tasks/${task.id}/ready`)).status()).toBe(200);
      const commitMessage = "feat(usage): export the usage\n\nAdds the usage export file.";
      const written = await page.request.put(`/api/tasks/${task.id}/commit-message`, {
        data: { message: commitMessage },
      });
      expect(taskSchema.parse(await written.json()).state).toBe("ready");
      await commitOnTaskBranch(own, task.id, "usage-export.txt", "exported\n");
      // No Agent Stage opens a Thread, so the user's Decision past Publish needs one seeded.
      await seedStageThread(task.id);
      expect((await page.request.post(`/api/tasks/${task.id}/start`, { data: {} })).status()).toBe(
        200,
      );
      await expect
        .poll(async () => fileOnRemote(own, branch, "usage-export.txt"))
        .toBe("exported\n");
      // Its Stage commit stays on its branch: the Initiative's branch gains one commit of its own.
      expect(gitOnRemote(own, "rev-list", "--count", `main..${branch}`)).toBe("1");
      expect(gitOnRemote(own, "log", "--format=%B", "--max-count=1", branch)).toBe(commitMessage);
      const landed = gitOnRemote(own, "rev-parse", branch);
      await markDoneByItsDecision(page, task.id);
      const published = taskSchema.parse(
        await (await page.request.get(`/api/tasks/${task.id}`)).json(),
      );
      expect(published.commitMessagePublishedAt).not.toBeNull();
      await page.goto(`/tasks/${task.id}`);
      const commitMessageBlock = page.getByRole("region", { name: "Commit message" });
      await commitMessageBlock.getByRole("button", { name: /Commit message/ }).click();
      await expect(commitMessageBlock).toContainText("Published as one commit.");
      await expect(commitMessageBlock.getByRole("button", { name: "Edit" })).toHaveCount(0);
      await commitMessageBlock.scrollIntoViewIfNeeded();
      await screenshotScenario(page, "task-commit-message-published");

      // Its Done adds the Publishing Task, which the Initiative page lists as Ready.
      await expect.poll(async () => (await publishingTasksOf(page, initiative.id)).length).toBe(1);
      const [publishing] = await publishingTasksOf(page, initiative.id);
      if (!publishing) throw new Error("No Publishing Task was added.");
      expect(publishing.title).toBe(`${initiative.name} → ${project.name}`);
      await page.goto(`/work/initiatives/${initiative.id}`);
      // Each Project's Publishing Task is in its block of the Pipelines card.
      const listed = page
        .getByRole("region", { name: "Pipelines", exact: true })
        .getByRole("listitem", { name: project.name, exact: true });
      await expect(
        listed.getByRole("link", { name: `${initiative.name} → ${project.name}` }),
      ).toBeVisible();
      await expect(listed).toContainText("Ready");
      await expect(
        listed.getByRole("group", { name: `Review and publish ${stamp} in ${project.name}` }),
      ).toBeVisible();
      await screenshotScenario(page, "initiative-pipelines-publishing", { fullPage: true });

      // Started, its Gate shows the whole change, and Continue publishes it into main.
      await seedStageThread(publishing.id);
      expect(
        (await page.request.post(`/api/tasks/${publishing.id}/start`, { data: {} })).status(),
      ).toBe(200);
      await page.goto(`/tasks/${publishing.id}`);
      const gate = page.getByRole("region", { name: "Gate · Review" });
      await expect(gate.getByRole("button", { name: "Continue to Publish" })).toBeVisible();
      // On the Initiative page, its Project's track waits on you at the Gate.
      await page.goto(`/work/initiatives/${initiative.id}`);
      await expect(
        listed
          .getByRole("button", { name: /Waiting on you/ })
          .and(listed.locator("[aria-current]")),
      ).toBeVisible();
      await screenshotScenario(page, "initiative-pipelines-at-gate", { fullPage: true });
      await page.goto(`/tasks/${publishing.id}`);
      await page.getByRole("tab", { name: /Changes/ }).click();
      const changes = page.getByRole("region", { name: "Changes" });
      await expect(changes.getByText("Files changed · 1")).toBeVisible();
      await expect(changes.getByRole("listitem")).toContainText(["usage-export.txt+1−0"]);
      await gate.getByRole("button", { name: "Continue to Publish" }).click();
      // The Definition of Done is checked before Publish: nothing reaches main until it is met.
      await markDoneByItsDecision(page, publishing.id);

      expect(fileOnRemote(own, "main", "usage-export.txt")).toBe("exported\n");
      // The Publishing Task carries the Task's one commit into main unchanged.
      expect(gitOnRemote(own, "merge-base", "--is-ancestor", landed, "main")).toBe("");
      await expect.poll(async () => (await initiativeOf(page, initiative.id)).state).toBe("done");
    } finally {
      await own.remove();
    }
  },
);

test(
  "a Project Pipeline is chosen for a Backlog Task, and a Broken one is listed but can't be, nor started on",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Linux checked", "LC");
    const base = await addedBasePipeline(page, "Checked");
    const own = await addedProjectPipeline(page, project.id, base, "Checked on Linux");
    const otherBase = await addedBasePipeline(page, "Spec");
    const broken = await addedProjectPipeline(page, project.id, otherBase, "Spec change");
    await breakProjectPipelinesOf(page, otherBase);
    const task = await createdTask(page, project, "Run the checks on Linux too");
    await page.goto(`/tasks/${task.id}`);

    // The Project's own Pipelines come first, the Broken one with why, then the office-wide ones.
    await page
      .getByRole("region", { name: "Pipeline · Not chosen yet" })
      .getByRole("button", { name: "Choose a Pipeline" })
      .click();
    const choosing = page.getByRole("dialog");
    const pipelines = await openPipelinePicker(choosing, "Pipeline");
    const ownGroup = pipelines.getByRole("group", { name: `${project.name}'s Pipelines` });
    await expect(
      ownGroup.getByRole("option", { name: own.name, exact: true }),
    ).toHaveAccessibleDescription("Build → Tests → Verify on Linux · built from " + base.name);
    const brokenOption = ownGroup.getByRole("option", { name: broken.name, exact: true });
    await expect(brokenOption).toHaveAttribute("aria-disabled", "true");
    await expect(brokenOption).toContainText(
      `Broken: Inserts Verify on Linux after Tests, which ${otherBase.name} no longer has. Fix it in ${project.name}'s Pipelines.`,
    );
    await expect(pipelines.getByRole("group", { name: "Office-wide Pipelines" })).toBeVisible();
    // Forced, as Playwright waits for a disabled option to be enabled: clicking it chooses nothing.
    await brokenOption.click({ force: true });
    await expect(choosing.getByRole("button", { name: "Save for this Task" })).toBeDisabled();
    await ownGroup.getByRole("option", { name: own.name, exact: true }).click();
    await choosing.getByRole("button", { name: "Save for this Task" }).click();
    await expect(page.getByRole("region", { name: `Pipeline · ${own.name}` })).toBeVisible();

    // Ready on it, then its base Pipeline's save breaks it: the rail flags it and Start refuses it.
    for (const [method, part, data] of [
      ["PUT", "plan", { plan: "Run the checks on Linux too." }],
      ["PUT", "definition-of-done", { definitionOfDone: ["The Linux run passes."] }],
      ["POST", "plan/confirm", {}],
      ["POST", "definition-of-done/confirm", {}],
      ["POST", "ready", {}],
    ] as const) {
      const response = await page.request.fetch(`/api/tasks/${task.id}/${part}`, { method, data });
      expect(response.ok()).toBe(true);
    }
    await breakProjectPipelinesOf(page, base);
    await page.reload();

    const why = `Inserts Verify on Linux after Tests, which ${base.name} no longer has.`;
    await expect(page.getByText(`${own.name} is Broken`, { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        `${why} The Task can't start until it is fixed in ${project.name}'s Pipelines, or another Pipeline is chosen for it.`,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        `${own.name} is Broken: ${why} Fix it in ${project.name}'s Pipelines, or choose another Pipeline for the Task.`,
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  },
);
