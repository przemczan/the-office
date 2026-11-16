// The README's screenshots of a demo Office (`npm run readme-screenshots`, after `npm run build`),
// run by playwright.readme.config.ts alone, on a fresh service replaying ./sessions.jsonl in the
// order the sessions open here. Every name is made up.
import path from "node:path";
import { expect as playwrightExpect, test, type Locator, type Page } from "@playwright/test";
import {
  pipelineListSchema,
  projectSchema,
  taskSchema,
  type AddProject,
  type NamedMarkColour,
  type Priority,
  type Project,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "../office-database.ts";
import { createTemporaryRepository, type TemporaryRepository } from "../temporary-repository.ts";

const IMAGES = path.resolve(import.meta.dirname, "../../../../docs/images");

/** The scripted sessions answer as fast as the service opens them, but a Stage's walk takes a while. */
const expect = playwrightExpect.configure({ timeout: 20_000 });

const USER_NAME = "Jordan Reyes";
const PLANNER = "Mira";
const DEVELOPER = "Theo";
const REVIEWER = "Iris";
const CTO = "Felix";

const SHARED_LINKS = "Share a notebook with a read-only link";
const AUDIT_LOG = "Paginate the audit log endpoint";
const OFFLINE_DRAFTS = "Offline drafts sync when back online";

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.use({
  colorScheme: "light",
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
  // Noon's light whatever the runner's clock says, as live-view.e2e.ts sets it.
  timezoneId: "Etc/UTC",
});

const repositories: TemporaryRepository[] = [];

test.afterAll(async () => {
  for (const repository of repositories) await repository.remove();
});

test("a demo Office: the Live view, the Work board and a Task in progress", async ({ page }) => {
  const renamed = await page.request.patch("/api/account", { data: { name: USER_NAME } });
  expect(renamed.ok()).toBe(true);
  for (const [preset, name] of [
    ["Planner", PLANNER],
    ["Developer", DEVELOPER],
    ["Reviewer", REVIEWER],
    ["CTO", CTO],
  ] as const) {
    await hireFromPreset(page, preset, name);
  }

  const notes = await addedProject(page, "Tidepool Notes", "TN", "teal");
  const api = await addedProject(page, "Lighthouse API", "LA", "violet");

  await createdTask(page, notes, "Export a notebook as Markdown", { tags: ["export"] });
  await createdTask(page, notes, "Dark toolbar in the editor", { priority: "low", tags: ["ui"] });
  await createdTask(page, api, "Rate-limit the public endpoints", {
    priority: "high",
    tags: ["security"],
  });
  await readyTask(page, notes, "Search across shared notebooks", {
    plan: "Index shared notebooks beside the user's own, and show where each result lives.",
    definitionOfDone: ["Search finds notes in notebooks shared with the user."],
  });
  for (const title of ["Keyboard shortcuts cheat sheet", "Check an image's size before upload"]) {
    const done = await createdTask(page, notes, title, {});
    await queryOfficeDatabase(`update tasks set state = 'done' where id = $1`, [done]);
  }

  // Session 1 and 2: Theo implements, the Tests pass, and Iris reviews, at her desk until the end.
  const sharedLinks = await readyTask(page, notes, SHARED_LINKS, {
    description:
      "People ask to show a notebook to someone without an account. A link anyone can open, read-only, that the owner can revoke.",
    plan: [
      "## Goal",
      "Let the owner of a notebook share it with anyone holding a link, read-only.",
      "",
      "## Steps",
      "- A `share_links` table with a random token, the notebook and who made it.",
      "- `POST /notebooks/:id/share-link` makes one, `DELETE` revokes it.",
      "- `/s/:token` renders the notebook without the editor.",
      "- A Share button in the notebook's menu, with Copy link and Revoke.",
    ].join("\n"),
    definitionOfDone: [
      "Anyone with the link reads the notebook and can't change it.",
      "Revoking the link stops it working at once.",
      "The tests for both pass.",
    ],
    tags: ["sharing"],
  });
  await reviewedByTheReviewer(page, sharedLinks);
  await startTask(page, sharedLinks);
  await expect(stageOnRail(page, "Review & fix")).toContainText("Running", { timeout: 60_000 });

  // Session 3: Theo implements the next Task and stays at it.
  const auditLog = await readyTask(page, api, AUDIT_LOG, {
    plan: "Page `GET /audit-log` by a cursor on the entry's time and id, 50 entries a page.",
    definitionOfDone: ["The endpoint answers pages of 50 with a next cursor."],
    pipelineId: "quick-fix",
    tags: ["api"],
  });
  await startTask(page, auditLog);
  await expect(stageOnRail(page, "Implement")).toContainText("Running");

  // Session 4: Mira plans with the user, mid-answer.
  const offlineDrafts = await createdTask(page, notes, OFFLINE_DRAFTS, { tags: ["sync"] });
  await page.goto(`/tasks/${offlineDrafts}`);
  await page.getByRole("button", { name: `Plan with ${PLANNER}` }).click();
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  const message = conversation.getByRole("textbox", { name: "Message" });
  await message.fill("Drafts written offline get lost on reconnect. Can we keep and sync them?");
  await message.press("Enter");
  await expect(conversation.getByText("Drafts already live in IndexedDB")).toBeVisible();

  await page.goto("/work");
  await expect(page.getByRole("article", { name: SHARED_LINKS })).toBeVisible();
  await expect(page.getByRole("article", { name: OFFLINE_DRAFTS })).toBeVisible();
  await page.screenshot({ path: path.join(IMAGES, "work.png") });

  await page.goto(`/tasks/${sharedLinks}`);
  await expect(stageOnRail(page, "Review & fix")).toContainText("Running");
  await page.screenshot({ path: path.join(IMAGES, "task-in-progress.png") });
  await page.getByRole("button", { name: "Review & fix", exact: true }).click();
  const history = page.getByRole("dialog", { name: /^Stage history: Review & fix/ });
  await history.getByRole("tab", { name: "Thread" }).click();
  await expect(history.getByText("Revoking deletes the row")).toBeVisible();
  await page.screenshot({ path: path.join(IMAGES, "task-stage-history.png") });
  await page.keyboard.press("Escape");

  // A day on, at noon, so nobody shows as just joined; under reduced motion nobody walks.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(tomorrowAtNoon());
  await page.goto("/live-view");
  const floor = page.getByRole("img", { name: /\d+ people: / });
  await expect(floor).toBeVisible();
  await expect(floor).toHaveAccessibleName(/3 working/);
  await page.screenshot({ path: path.join(IMAGES, "live-view.png") });
});

async function hireFromPreset(page: Page, preset: string, name: string): Promise<void> {
  await page.goto("/people");
  await page.getByRole("button", { name: "Hire a Role" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(preset, { exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: `Hire ${name}` }).click();
  await expect(page.getByRole("heading", { name: `${name} · ${preset}` })).toBeVisible();
}

/** A Project on a repository of its own, its checks run on this computer. */
async function addedProject(
  page: Page,
  name: string,
  label: string,
  colour: NamedMarkColour,
): Promise<Project> {
  const repository = await createTemporaryRepository();
  repositories.push(repository);
  const passing = "node --version";
  const newProject: AddProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour },
    installCommand: passing,
    commands: [
      { key: "build", name: "Build", kind: "build", commandLine: passing },
      { key: "lint", name: "Lint", kind: "lint", commandLine: passing },
      { key: "test", name: "Test", kind: "test", commandLine: passing },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    runEnvironmentAnswer: "no",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  expect(added.status()).toBe(201);
  return projectSchema.parse(await added.json());
}

async function createdTask(
  page: Page,
  project: Project,
  title: string,
  { priority = "normal", tags = [] }: { priority?: Priority; tags?: readonly string[] },
): Promise<string> {
  const created = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority, tags },
  });
  expect(created.status()).toBe(201);
  return taskSchema.parse(await created.json()).id;
}

/** A Task planned through the API, Ready to start; the user writes its parts, so no Planner starts. */
async function readyTask(
  page: Page,
  project: Project,
  title: string,
  {
    description = "",
    plan,
    definitionOfDone,
    pipelineId = "full",
    tags = [],
  }: {
    description?: string;
    plan: string;
    definitionOfDone: readonly string[];
    pipelineId?: string;
    tags?: readonly string[];
  },
): Promise<string> {
  const id = await createdTask(page, project, title, { tags });
  // One after another: each needs the one before it.
  const steps = [
    () => page.request.put(`/api/tasks/${id}/description`, { data: { description } }),
    () => page.request.post(`/api/tasks/${id}/planning`),
    () => page.request.put(`/api/tasks/${id}/plan`, { data: { plan } }),
    () => page.request.post(`/api/tasks/${id}/plan/confirm`),
    () => page.request.put(`/api/tasks/${id}/definition-of-done`, { data: { definitionOfDone } }),
    () => page.request.post(`/api/tasks/${id}/definition-of-done/confirm`),
    () => page.request.put(`/api/tasks/${id}/pipeline`, { data: { pipelineId } }),
    () => page.request.post(`/api/tasks/${id}/ready`),
  ];
  for (const step of steps) expect((await step()).status()).toBe(200);
  return id;
}

/** Full's Stages, with Review & fix worked by the Reviewer rather than the Developer. */
async function reviewedByTheReviewer(page: Page, taskId: string): Promise<void> {
  const library = pipelineListSchema.parse(await (await page.request.get("/api/pipelines")).json());
  const full = library.find(({ id }) => id === "full")?.stages ?? [];
  const stages = full.map((stage) =>
    stage.kind === "agent" && stage.key === "review-and-fix"
      ? { ...stage, duty: undefined, role: "reviewer" }
      : stage,
  );
  const edited = await page.request.put(`/api/tasks/${taskId}/stages`, { data: { stages } });
  expect(edited.status()).toBe(200);
}

async function startTask(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
}

/** A Stage on the Task page's Pipeline rail. */
function stageOnRail(page: Page, name: string): Locator {
  return page
    .getByRole("list", { name: "Stages" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

/** Tomorrow at 12:00 UTC: after every hire of today's run. */
function tomorrowAtNoon(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 12));
}
