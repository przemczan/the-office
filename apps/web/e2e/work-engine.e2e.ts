import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ideaSchema,
  projectSchema,
  taskEngineCascadeSchema,
  taskSchema,
  type EngineModel,
  type NewProject,
  type Project,
  type Task,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

// A Task's and an Initiative's engine (spec §2.1.3, §2.1.4). Only the fresh Office's own Claude
// Code engine is named, never one added: a Settings › Engines Save sends every engine, so engines
// are added only in people.e2e.ts. Nothing here removes an engine; the Remove window is cancelled.

const CLAUDE_CODE = "claude-code";
const HAIKU: EngineModel = { engineId: CLAUDE_CODE, model: "claude-haiku-5-5" };

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

async function setTaskEngine(page: Page, task: Task, engine: EngineModel | null): Promise<void> {
  const saved = await page.request.put(`/api/tasks/${task.id}/engine`, { data: { engine } });
  expect(saved.ok()).toBe(true);
}

async function setInitiativeEngine(
  page: Page,
  initiativeId: string,
  engine: EngineModel | null,
): Promise<void> {
  const saved = await page.request.put(`/api/initiatives/${initiativeId}/engine`, {
    data: { engine },
  });
  expect(saved.ok()).toBe(true);
}

/**
 * How many Roles the Task's "Runs on" list names: its Planner and the Roles its Stages name, each
 * left out while nobody fills it (hiring is people.e2e.ts's, which a file run alone goes without).
 */
async function rolesWorking(page: Page, task: Task): Promise<number> {
  const cascade = await page.request.get(`/api/tasks/${task.id}/engine-cascade`);
  expect(cascade.ok()).toBe(true);
  return taskEngineCascadeSchema.parse(await cascade.json()).roles.length;
}

/** The record's Engine fold, unfolded. */
async function openEngineFold(page: Page): Promise<Locator> {
  const fold = page.getByRole("region", { name: "Engine", exact: true });
  const head = fold.getByRole("button", { name: /^Engine/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return fold;
}

test.describe("a Task's and an Initiative's engine", { tag: "@full" }, () => {
  test("the user sets a Task's engine and model in its Engine fold, and Runs on follows", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine fold shop ${word}`, "EF");
    const task = await createdTask(page, project, `Engine fold export ${word}`);

    await page.goto(`/tasks/${task.id}`);
    const fold = await openEngineFold(page);
    const pair = fold.getByRole("group", { name: "Task's engine" });
    const engine = pair.getByRole("combobox", { name: "Engine" });
    const model = pair.getByRole("combobox", { name: "Model" });
    // Nothing set: the empty choice is the Project's engine, and no Model field shows.
    await expect(engine.locator("option:checked")).toHaveText("Project's engine");
    await expect(model).toHaveCount(0);
    await expect(fold).toContainText(
      `The Office default, as ${project.name} has no Project default. Pick an engine to run this Task on its own.`,
    );
    const runsOn = fold.getByRole("list", { name: "Runs on" });
    const working = await rolesWorking(page, task);
    if (working > 0) {
      await expect(runsOn.getByRole("listitem")).toHaveCount(working);
      await expect(runsOn).not.toContainText("from the Task's engine");
    } else {
      await expect(runsOn).toHaveCount(0);
    }

    // Picking the engine fills in its default model and saves at once.
    await engine.selectOption({ label: "Claude Code" });
    await expect(
      page.getByText(new RegExp(`^(Engine|Model) saved for ${task.title}: its next sessions`)),
    ).toBeVisible();
    await expect(model).toBeVisible();

    // A new model alone resumes the next session.
    await model.selectOption({ label: "Haiku 5.5" });
    await expect(
      page.getByText(`Model saved for ${task.title}: its next sessions resume, on Haiku 5.5.`),
    ).toBeVisible();
    await expect(model).toHaveValue("claude-haiku-5-5");
    if (working > 0) {
      await expect(runsOn).toContainText("Haiku 5.5 on Claude Code");
      await expect(runsOn).toContainText("from the Task's engine");
    }
    await expect(fold.getByRole("button", { name: /^Engine/ })).toContainText(
      "Haiku 5.5 on Claude Code · set for this Task",
    );
    expect(
      taskSchema.parse(await (await page.request.get(`/api/tasks/${task.id}`)).json()).engine,
    ).toEqual(HAIKU);
    // Kept on a reload.
    await page.reload();
    await expect(fold.getByRole("button", { name: /^Engine/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(model).toHaveValue("claude-haiku-5-5");
    await screenshotScenario(page, "task-engine-fold", { inView: fold });

    // Back to the empty choice: the Task takes its Project's engine again.
    await engine.selectOption({ label: "Project's engine" });
    await expect(
      page.getByText(
        `${task.title} has no engine of its own now: it runs on its Project's engine from its next session.`,
      ),
    ).toBeVisible();
    await expect(model).toHaveCount(0);
    if (working > 0) await expect(runsOn).not.toContainText("from the Task's engine");
  });

  test("a Task in an Initiative that sets an engine offers the Initiative's engine as its empty choice", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine inherit shop ${word}`, "EI");
    const initiativeId = await seedActiveInitiative(page, `Engine inherit release ${word}`);
    const task = await createdTask(page, project, `Engine inherit banner ${word}`);
    await putInInitiative(task, initiativeId);
    await setInitiativeEngine(page, initiativeId, HAIKU);

    await page.goto(`/tasks/${task.id}`);
    await expect(
      page
        .getByRole("region", { name: "Engine", exact: true })
        .getByRole("button", { name: /^Engine/ }),
    ).toContainText("Initiative's engine · Haiku 5.5 on Claude Code");
    const fold = await openEngineFold(page);
    const pair = fold.getByRole("group", { name: "Task's engine" });
    await expect(
      pair.getByRole("combobox", { name: "Engine" }).locator("option:checked"),
    ).toHaveText("Initiative's engine (Haiku 5.5 on Claude Code)");
    await expect(pair.getByRole("combobox", { name: "Model" })).toHaveCount(0);
    await expect(fold).toContainText(
      "Set on its Initiative. Pick an engine to run this Task on its own.",
    );
    if ((await rolesWorking(page, task)) > 0) {
      await expect(fold.getByRole("list", { name: "Runs on" })).toContainText(
        "from the Initiative's engine",
      );
    }
    await screenshotScenario(page, "task-engine-inherited", { inView: fold });
  });

  test("the user sets an Initiative's engine, and Its Tasks says which follow it", async ({
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
    await setTaskEngine(page, own, { engineId: CLAUDE_CODE, model: "claude-opus-5-5" });

    await page.goto(`/work/initiatives/${initiativeId}`);
    const fold = await openEngineFold(page);
    const pair = fold.getByRole("group", { name: "Initiative's engine" });
    const engine = pair.getByRole("combobox", { name: "Engine" });
    const model = pair.getByRole("combobox", { name: "Model" });
    await expect(engine.locator("option:checked")).toHaveText("Project's engine");
    await expect(fold).toContainText(
      "A Task in it that sets no engine runs on its Project default, or the Office default where its Project has none.",
    );
    const itsTasks = fold.getByRole("list", { name: "Its Tasks" });
    const followingRow = itsTasks.getByRole("listitem").filter({ hasText: following.title });
    const ownRow = itsTasks.getByRole("listitem").filter({ hasText: own.title });
    await expect(followingRow).toContainText("its Project's engine");
    await expect(ownRow).toContainText("Opus 5.5 on Claude Code");
    await expect(ownRow).toContainText("its own engine");

    await engine.selectOption({ label: "Claude Code" });
    await expect(
      page.getByText(
        new RegExp(
          `^Engine saved for ${name}: its Threads and its 1 open Task that sets none runs on .+ on Claude Code from their next session\\.$`,
        ),
      ),
    ).toBeVisible();
    await model.selectOption({ label: "Haiku 5.5" });
    const modelSaved = page.getByText(
      `Model saved for ${name}: its next sessions resume, on Haiku 5.5.`,
    );
    await expect(modelSaved).toBeVisible();
    await expect(followingRow).toContainText("Haiku 5.5 on Claude Code");
    await expect(followingRow).toContainText("the Initiative's engine");
    await expect(ownRow).toContainText("its own engine");
    await expect(fold.getByRole("button", { name: /^Engine/ })).toContainText(
      "Haiku 5.5 on Claude Code",
    );
    // Its Task's page shows the change.
    expect(
      taskSchema.parse(await (await page.request.get(`/api/tasks/${following.id}`)).json())
        .initiativeEngine,
    ).toEqual(HAIKU);
    // The toasts go by themselves, out of the screenshots' way.
    await expect(modelSaved).toBeHidden();
    await screenshotScenario(page, "initiative-engine-fold", { inView: fold });
  });

  test("a Done Task's Engine fold keeps its engine read-only", async ({ page }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine kept shop ${word}`, "EK");
    const task = await createdTask(page, project, `Engine kept report ${word}`);
    await setTaskEngine(page, task, HAIKU);
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [task.id]);

    await page.goto(`/tasks/${task.id}`);
    const fold = await openEngineFold(page);
    await expect(fold.getByRole("combobox")).toHaveCount(0);
    await expect(fold.getByRole("definition")).toHaveText(["Claude Code", "Haiku 5.5"]);
    await expect(fold).toContainText(
      "Kept as it was: the engine of a Done or Dropped Task doesn't change.",
    );
    await expect(fold.getByRole("list", { name: "Runs on" })).toHaveCount(0);
    await screenshotScenario(page, "task-engine-read-only", { inView: fold });
  });

  test("the Remove engine window lists the Tasks and Initiatives naming the engine, a Done one with its state", async ({
    page,
  }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine removal shop ${word}`, "ER");
    const open = await createdTask(page, project, `Engine removal open ${word}`);
    const done = await createdTask(page, project, `Engine removal done ${word}`);
    const initiativeName = `Engine removal release ${word}`;
    const initiativeId = await seedActiveInitiative(page, initiativeName);
    await setTaskEngine(page, open, HAIKU);
    await setTaskEngine(page, done, HAIKU);
    await setInitiativeEngine(page, initiativeId, HAIKU);
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
        .filter({ hasText: `The engine of the Task “${open.title}”` });
      const doneRow = moves
        .getByRole("listitem")
        .filter({ hasText: `The engine of the Task “${done.title}”` });
      const initiativeRow = moves
        .getByRole("listitem")
        .filter({ hasText: `The engine of the Initiative “${initiativeName}”` });
      await expect(openRow).toContainText("Haiku 5.5 on Claude Code →");
      await expect(openRow).not.toContainText("Done");
      await expect(doneRow).toContainText("Done");
      await expect(doneRow).toContainText("Haiku 5.5 on Claude Code →");
      await expect(initiativeRow).toContainText("Haiku 5.5 on Claude Code →");
      await doneRow.scrollIntoViewIfNeeded();
      await screenshotScenario(page, "remove-engine-work-rows", { inView: doneRow });

      // Cancelled: nothing moves, and the engine stays.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      expect(
        taskSchema.parse(await (await page.request.get(`/api/tasks/${open.id}`)).json()).engine,
      ).toEqual(HAIKU);
    } finally {
      await setTaskEngine(page, open, null);
      await setInitiativeEngine(page, initiativeId, null);
    }
  });
});
