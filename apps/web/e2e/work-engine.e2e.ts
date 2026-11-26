import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ideaSchema,
  projectSchema,
  taskEngineCascadeSchema,
  taskSchema,
  type NewProject,
  type Project,
  type Task,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

// A Task's and an Initiative's engine override (spec §2.1.3, §2.1.4): one engine, no model. Only the fresh Office's own Claude
// Code engine is named, never one added: a Settings › Engines Save sends every engine, so engines
// are added only in people.e2e.ts. Nothing here removes an engine; the Remove window is cancelled.

const CLAUDE_CODE = "claude-code";

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

/** A word no other test's records hold, so names stay apart across files run in parallel. */
function aWordOfItsOwn(): string {
  return `w${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Adds a Project through the API, with no Project default of its own. */
async function addedProject(page: Page, name: string, label: string): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "teal" },
    installCommand: "npm ci",
    commands: [
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

/** A Task in Backlog on the full Pipeline, so its "Runs on" list names the Roles its Stages do. */
async function createdTask(page: Page, project: Project, title: string): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  expect(response.status()).toBe(201);
  const task = taskSchema.parse(await response.json());
  const piped = await page.request.put(`/api/tasks/${task.id}/pipeline`, {
    data: { pipelineId: "full" },
  });
  expect(piped.status()).toBe(200);
  return task;
}

/** An active Initiative made in the database, as confirming one needs the CTO's session. */
async function seedActiveInitiative(page: Page, name: string): Promise<string> {
  const idea = await page.request.post("/api/ideas", {
    data: { title: name, notes: "", projectId: null },
  });
  expect(idea.status()).toBe(201);
  const { id: ideaId } = ideaSchema.parse(await idea.json());
  const initiativeId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into initiatives
       (id, name, outcome, state, origin_idea_id, created_by, created_at, ended_at)
     values ($1, $2, '', 'active', $3, $4, $5, null)`,
    [initiativeId, name, ideaId, { kind: "user" }, new Date().toISOString()],
  );
  return initiativeId;
}

async function putInInitiative(task: Task, initiativeId: string): Promise<void> {
  await queryOfficeDatabase(`update tasks set initiative_id = $2 where id = $1`, [
    task.id,
    initiativeId,
  ]);
}

async function setTaskEngine(page: Page, task: Task, engineId: string | null): Promise<void> {
  const saved = await page.request.put(`/api/tasks/${task.id}/engine`, { data: { engineId } });
  expect(saved.ok()).toBe(true);
}

async function setInitiativeEngine(
  page: Page,
  initiativeId: string,
  engineId: string | null,
): Promise<void> {
  const saved = await page.request.put(`/api/initiatives/${initiativeId}/engine`, {
    data: { engineId },
  });
  expect(saved.ok()).toBe(true);
}

/**
 * How many people the Task's "Runs on" list names: its Planner and the Roles its Stages name, each
 * left out while nobody fills it (hiring is people.e2e.ts's, which a file run alone goes without).
 */
async function rolesWorking(page: Page, task: Task): Promise<number> {
  const cascade = await page.request.get(`/api/tasks/${task.id}/engine-cascade`);
  expect(cascade.ok()).toBe(true);
  return taskEngineCascadeSchema.parse(await cascade.json()).people.length;
}

async function savedTask(page: Page, task: Task): Promise<Task> {
  return taskSchema.parse(await (await page.request.get(`/api/tasks/${task.id}`)).json());
}

/** The Engine tab's Engine fold, open. */
async function openEngineFold(page: Page): Promise<Locator> {
  await page.getByRole("tab", { name: "Engine" }).click();
  const fold = page.getByRole("region", { name: "Engine", exact: true });
  const head = fold.getByRole("button", { name: /^Engine/ });
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return fold;
}

/** The Initiative page's Engine fold, in its record column with no tab, opened: it starts folded. */
async function openInitiativeEngineFold(page: Page): Promise<Locator> {
  const fold = page.getByRole("region", { name: "Engine", exact: true });
  const head = fold.getByRole("button", { name: /^Engine/ });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return fold;
}

test.describe("a Task's and an Initiative's engine override", { tag: "@full" }, () => {
  test("the user overrides a Task's engine in its Engine fold, with no model and no stand-ins", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine fold shop ${word}`, "EF");
    const task = await createdTask(page, project, `Engine fold export ${word}`);

    await page.goto(`/tasks/${task.id}`);
    const fold = await openEngineFold(page);
    const head = fold.getByRole("button", { name: /^Engine/ });
    const override = fold.getByRole("switch").first();
    const engine = fold.getByRole("combobox", { name: "Engine" });
    // Off: it follows the Office default, as its Project sets none, and no Engine field shows.
    await expect(head).toContainText("Claude Code · from the Office default");
    await expect(override).toHaveAttribute("aria-checked", "false");
    await expect(engine).toHaveCount(0);
    await expect(fold).toContainText(
      "Runs on Claude Code, from the Office default, with the Office's Stand-in Engines.",
    );
    const runsOn = fold.getByRole("list", { name: "Runs on" });
    const working = await rolesWorking(page, task);
    if (working > 0) {
      await expect(runsOn.getByRole("listitem")).toHaveCount(working);
      // Each person works with their own model and effort, from their Role card.
      await expect(runsOn).toContainText("Role card");
    } else {
      await expect(runsOn).toHaveCount(0);
    }

    // On: it saves at once, starting on the engine it followed.
    await override.click();
    await expect(
      page.getByText(`${task.title} runs on Claude Code, with no stand-ins.`),
    ).toBeVisible();
    await expect(override).toHaveAttribute("aria-checked", "true");
    await expect(engine).toHaveText("Claude Code");
    await expect(fold).toContainText(
      "No stand-ins: when Claude Code's usage window is used up, the Task waits for the reset.",
    );
    await expect(fold.getByRole("combobox", { name: "Model" })).toHaveCount(0);
    await expect(head).toContainText("Claude Code · set for this Task · no stand-ins");
    expect((await savedTask(page, task)).engineOverride).toBe(CLAUDE_CODE);
    // The Engine select groups the listed engines by engine type.
    await engine.click();
    const list = page.getByRole("listbox", { name: "Engine" });
    await expect(list.getByRole("group", { name: "Claude Code" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Kept on a reload.
    await page.reload();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(override).toHaveAttribute("aria-checked", "true");
    await screenshotScenario(page, "task-engine-fold", { inView: fold });

    // Off again: the Task follows its Project's engine.
    await override.click();
    await expect(page.getByText(`${task.title} follows its Project's engine again.`)).toBeVisible();
    await expect(engine).toHaveCount(0);
    expect((await savedTask(page, task)).engineOverride).toBeNull();
    if (working > 0) await expect(runsOn.getByRole("listitem")).toHaveCount(working);
  });

  test("the user overrides models and efforts on a Task, apart from its engine", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine models shop ${word}`, "EM");
    const task = await createdTask(page, project, `Engine models export ${word}`);

    await page.goto(`/tasks/${task.id}`);
    const fold = await openEngineFold(page);
    const models = fold.getByRole("switch").nth(1);
    await expect(models).toHaveAttribute("aria-checked", "false");
    await expect(fold.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");

    await models.click();
    await expect(models).toHaveAttribute("aria-checked", "true");
    // The engine override stays off: the two switches work apart.
    await expect(fold.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");
    expect((await savedTask(page, task)).engineOverride).toBeNull();

    // With nobody hired (a file run alone) the list has no rows to set.
    if ((await rolesWorking(page, task)) > 0) {
      const effort = fold
        .getByRole("list", { name: "Runs on" })
        .getByRole("group")
        .first()
        .getByRole("combobox", { name: "Effort" });
      // The first choice is Unchanged.
      await effort.selectOption({ index: 1 });
      await expect(fold.getByRole("list", { name: "Runs on" })).toContainText("set for this Task");
      expect((await savedTask(page, task)).peopleEngineSettings).toHaveLength(1);
    }

    await models.click();
    await expect(models).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => (await savedTask(page, task)).peopleEngineSettings).toEqual([]);
  });

  test("a Task in an Initiative with an override follows it, and its own override wins", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine inherit shop ${word}`, "EI");
    const initiativeId = await seedActiveInitiative(page, `Engine inherit release ${word}`);
    const task = await createdTask(page, project, `Engine inherit banner ${word}`);
    await putInInitiative(task, initiativeId);
    await setInitiativeEngine(page, initiativeId, CLAUDE_CODE);

    await page.goto(`/tasks/${task.id}`);
    const fold = await openEngineFold(page);
    const head = fold.getByRole("button", { name: /^Engine/ });
    await expect(head).toContainText("Claude Code · from its Initiative · no stand-ins");
    await expect(fold.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");
    await expect(fold).toContainText(
      "Turn it on to run this Task on another engine than its Initiative's.",
    );
    await expect(fold).toContainText(
      "Runs on Claude Code, from its Initiative, with no stand-ins.",
    );
    await screenshotScenario(page, "task-engine-inherited", { inView: fold });

    // Its own override wins over its Initiative's.
    await fold.getByRole("switch").first().click();
    await expect(head).toContainText("Claude Code · set for this Task · no stand-ins");
    const saved = await savedTask(page, task);
    expect(saved.engineOverride).toBe(CLAUDE_CODE);
    expect(saved.initiativeEngineOverride).toBe(CLAUDE_CODE);
    await expect(
      page.getByText(`${task.title} runs on Claude Code, with no stand-ins.`),
    ).toBeVisible();
    await expect(fold.getByRole("switch").first()).toBeEnabled();
    await fold.getByRole("switch").first().click();
    await expect(
      page.getByText(`${task.title} follows its Initiative's engine again.`),
    ).toBeVisible();
  });

  test("the user overrides an Initiative's engine, and Its Tasks says which follow it", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const name = `Engine initiative sync ${word}`;
    const project = await addedProject(page, `Engine initiative shop ${word}`, "EN");
    const initiativeId = await seedActiveInitiative(page, name);
    const following = await createdTask(page, project, `Engine initiative queue ${word}`);
    const own = await createdTask(page, project, `Engine initiative cache ${word}`);
    await putInInitiative(following, initiativeId);
    await putInInitiative(own, initiativeId);
    await setTaskEngine(page, own, CLAUDE_CODE);

    await page.goto(`/work/initiatives/${initiativeId}`);
    const fold = await openInitiativeEngineFold(page);
    const override = fold.getByRole("switch");
    await expect(override).toHaveAttribute("aria-checked", "false");
    await expect(fold).toContainText(
      "Its Threads and Tasks run on their Project's engine, or the Office default where the Project sets none, with that Project's Stand-in Engines.",
    );
    const itsTasks = fold.getByRole("list", { name: "Its Tasks" });
    const followingRow = itsTasks.getByRole("listitem").filter({ hasText: following.title });
    const ownRow = itsTasks.getByRole("listitem").filter({ hasText: own.title });
    await expect(followingRow).toContainText("its Project's engine");
    await expect(ownRow).toContainText("its own override");

    await override.click();
    const saved = page.getByText(`${name} runs on Claude Code, with no stand-ins.`);
    await expect(saved).toBeVisible();
    await expect(fold.getByRole("combobox", { name: "Engine" })).toHaveText("Claude Code");
    await expect(fold.getByRole("combobox", { name: "Model" })).toHaveCount(0);
    await expect(fold).toContainText(
      "No stand-ins: when Claude Code's usage window is used up, its Tasks wait for the reset.",
    );
    await expect(followingRow).toContainText("follows the Initiative's override");
    await expect(ownRow).toContainText("its own override");
    await expect(fold.getByRole("button", { name: /^Engine/ })).toContainText(
      "Claude Code · set for this Initiative · no stand-ins",
    );
    // Its Task's page shows the change.
    expect((await savedTask(page, following)).initiativeEngineOverride).toBe(CLAUDE_CODE);
    // The toasts go by themselves, out of the screenshots' way.
    await expect(saved).toBeHidden();
    await screenshotScenario(page, "initiative-engine-fold", { inView: fold });
  });

  test("a Done Task's Engine fold keeps its override read-only", async ({ page }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine kept shop ${word}`, "EK");
    const task = await createdTask(page, project, `Engine kept report ${word}`);
    await setTaskEngine(page, task, CLAUDE_CODE);
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [task.id]);

    await page.goto(`/tasks/${task.id}`);
    const fold = await openEngineFold(page);
    await expect(fold.getByRole("switch")).toHaveCount(0);
    await expect(fold.getByRole("combobox")).toHaveCount(0);
    await expect(fold.getByRole("definition")).toHaveText(["Claude Code", "Off"]);
    await expect(fold).toContainText(
      "Kept as it was: the engine, models and efforts of a Done or Dropped Task don't change.",
    );
    await expect(fold.getByRole("list", { name: "Runs on" })).toHaveCount(0);
    await screenshotScenario(page, "task-engine-read-only", { inView: fold });
  });

  test("the Remove engine window lists the Tasks and Initiatives whose override names the engine, a Done one with its state", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine removal shop ${word}`, "ER");
    const open = await createdTask(page, project, `Engine removal open ${word}`);
    const done = await createdTask(page, project, `Engine removal done ${word}`);
    const initiativeName = `Engine removal release ${word}`;
    const initiativeId = await seedActiveInitiative(page, initiativeName);
    await setTaskEngine(page, open, CLAUDE_CODE);
    await setTaskEngine(page, done, CLAUDE_CODE);
    await setInitiativeEngine(page, initiativeId, CLAUDE_CODE);
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [done.id]);

    try {
      await page.goto("/settings/engines");
      await page
        .getByRole("navigation", { name: "Engines" })
        .getByRole("button", { name: /^Claude Code/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Remove Claude Code", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Remove Claude Code?" });
      const moves = dialog.getByRole("list", { name: "What moves" });
      const openRow = moves
        .getByRole("listitem")
        .filter({ hasText: `The engine override of the Task “${open.title}”` });
      const doneRow = moves
        .getByRole("listitem")
        .filter({ hasText: `The engine override of the Task “${done.title}”` });
      const initiativeRow = moves
        .getByRole("listitem")
        .filter({ hasText: `The engine override of the Initiative “${initiativeName}”` });
      // An override names an engine alone, no model.
      await expect(openRow).toContainText("Claude Code →");
      await expect(openRow).not.toContainText("Done");
      await expect(openRow).not.toContainText(" on Claude Code");
      await expect(doneRow).toContainText("Done");
      await expect(doneRow).toContainText("Claude Code →");
      await expect(initiativeRow).toContainText("Claude Code →");
      await doneRow.scrollIntoViewIfNeeded();
      await screenshotScenario(page, "remove-engine-work-rows", { inView: doneRow });

      // Cancelled: nothing moves, and the engine stays.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect((await savedTask(page, open)).engineOverride).toBe(CLAUDE_CODE);
    } finally {
      await setTaskEngine(page, open, null);
      await setInitiativeEngine(page, initiativeId, null);
    }
  });
});
