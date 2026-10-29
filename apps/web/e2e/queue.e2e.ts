import { expect, test, type Page } from "@playwright/test";
import {
  projectSchema,
  taskSchema,
  type NewProject,
  type Project,
  type StartAnswer,
  type StartCheck,
  type Task,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

// Runs alone, after every other file (playwright.config.ts): the queue is the Office's one, so the
// Tasks seeded into it here would otherwise start or leave at another file's release.

const ONLY_DESK = "The Office-wide limit is reached: the only desk is in use.";

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await queryOfficeDatabase("delete from queue", []);
  await repository.remove();
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
async function queued(task: Task): Promise<void> {
  await queryOfficeDatabase(
    `insert into queue (task_id, place, queued_at, reasons)
       values ($1, (select coalesce(max(place), 0) + 1 from queue), now(), $2)`,
    [task.id, [ONLY_DESK]],
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
  const check: StartCheck = { refusals: [], waits: [ONLY_DESK], overlaps: [] };
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

  await page.goto(`/tasks/${task.id}`);
  const plan = page.getByRole("region", { name: "Plan" });
  await plan.getByRole("button", { name: "Edit" }).click();
  await plan.getByLabel("Files to change").fill("./src/auth/login.ts\nREADME.md");
  await plan.getByRole("button", { name: "Save and confirm" }).click();
  await expect(plan.getByRole("region", { name: "Files to change" })).toHaveText(
    /src\/auth\/login\.ts\s*README\.md/,
  );

  const overlap = page.getByRole("note", { name: "Overlap" });
  await expect(overlap).toHaveText(
    "Overlap: “Rework the sign-in” is in progress and expects to change src/auth/login.ts too.",
  );
  await expect(page.getByRole("button", { name: "Start anyway" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Queue behind it" }).click();

  await expect(page.getByText(`${task.title} is queued, place`)).toBeVisible();
  // Last in the queue, behind those the tests before left there.
  await expect(
    page.getByText(
      /^Place \d+ · Queued behind "Rework the sign-in" until it is Done or Dropped\.$/,
    ),
  ).toBeVisible();

  // Out of the queue before the Task it waits behind ends, so no release starts a walk.
  await page.request.post(`/api/tasks/${task.id}/drop`);
  await queryOfficeDatabase(`update tasks set state = 'dropped' where id = $1`, [inProgress.id]);
});
