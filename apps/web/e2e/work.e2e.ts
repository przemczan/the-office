import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  projectSchema,
  taskSchema,
  type NewProject,
  type Project,
  type Task,
} from "@the-office/contracts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

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

async function createdTask(page: Page, project: Project, title: string): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  expect(response.status()).toBe(201);
  return taskSchema.parse(await response.json());
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

test("the user captures an Idea from Now in a few keystrokes", async ({ page }) => {
  await page.goto("/now");

  await page.getByRole("button", { name: "Idea", exact: true }).click();
  await page.keyboard.type("Nightly dependency updates");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Idea captured: Nightly dependency updates.")).toBeVisible();
  await page.goto("/work/ideas");
  const card = page.getByRole("article", { name: "Nightly dependency updates" });
  await expect(card.getByText("Office-wide")).toBeVisible();
  await expect(card.getByText(/You captured it/)).toBeVisible();
});

test("an Idea with Attachments is shaped into a Task in Backlog, and another is dropped", async ({
  page,
}) => {
  const project = await addedProject(page, "Usage reports", "UR");
  await page.goto(`/projects/${project.id}`);

  await page.getByRole("button", { name: "Idea", exact: true }).click();
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
  await capture.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText("Idea captured: Export usage as CSV.")).toBeVisible();

  await page.goto("/work/ideas");
  const card = page.getByRole("article", { name: "Export usage as CSV" });
  await expect(card.getByText("Usage reports")).toBeVisible();
  await expect(card.getByRole("link", { name: "CSV conventions" })).toHaveAttribute(
    "href",
    "https://example.com/csv",
  );
  await card.getByRole("button", { name: "format.md" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "format.md" })).toContainText(
    "One row per day.",
  );
  await page.getByRole("dialog").filter({ hasText: "format.md" }).getByLabel("Close").click();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-ideas.png") });

  await card.getByRole("button", { name: "Shape into a Task" }).click();
  await expect(page.getByText("Export usage as CSV is a Task in Backlog.")).toBeVisible();
  await expect(page.getByText("became")).toBeVisible();

  await page.getByRole("button", { name: "Idea", exact: true }).click();
  await page.keyboard.type("Voice notes to the Office Manager");
  await page.keyboard.press("Enter");
  const dropped = page.getByRole("article", { name: "Voice notes to the Office Manager" });
  await dropped.getByRole("button", { name: "More for Voice notes to the Office Manager" }).click();
  await page.getByRole("menu").getByRole("button", { name: "Drop" }).click();
  await expect(dropped).toHaveCount(0);
  await page.getByText(/^Dropped · /).click();
  await expect(page.getByText("Voice notes to the Office Manager", { exact: true })).toBeVisible();

  await page.goto("/work");
  const task = column(page, "Backlog").getByRole("article", { name: "Export usage as CSV" });
  await expect(task.getByText("UR")).toBeVisible();
});

test("dragging a card reorders its column, and the order survives a reload", async ({ page }) => {
  const project = await addedProject(page, "Board order", "BO");
  const titles = ["Order first", "Order second", "Order third"];
  for (const title of titles) await createdTask(page, project, title);
  await page.goto("/work");
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
});

test("a Task's priority and Drop are in its menu, and the Project page counts its Tasks", async ({
  page,
}) => {
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
  await expect(column(page, "Done").getByRole("article", { name: "Drop me" })).toContainText(
    "Dropped",
  );

  await page.goto(`/projects/${project.id}`);
  const work = page.getByText("Not planned yet").locator("..");
  await expect(work).toContainText("1");
});
