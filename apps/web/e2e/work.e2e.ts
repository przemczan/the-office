import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ideaSchema,
  projectSchema,
  recordPath,
  taskSchema,
  type NewProject,
  type Project,
  type Task,
} from "@the-office/contracts";
import { taskWorktreePath } from "./office-data.ts";
import {
  addTaskWorktree,
  commitOnTaskBranch,
  createTemporaryRepository,
  type TemporaryRepository,
} from "./temporary-repository.ts";

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

test("an Idea's link opens Ideas at its card, marked", async ({ page }) => {
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

test('the user tags a Task in "+ Task" and on its page, and the board shows its Tags', async ({
  page,
}) => {
  const project = await addedProject(page, "Tagged work", "TW");
  await page.goto("/work");

  await page.getByRole("button", { name: "Task", exact: true }).click();
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

  const card = page.getByRole("article", { name: "Pair over BLE" });
  await expect(card).toContainText("ble");
  await expect(card).toContainText("needs-review");

  await card.getByRole("link", { name: "Pair over BLE" }).click();
  const tags = page.getByRole("group", { name: "Tags" });
  await tags.getByLabel("Add a Tag").fill("firmware");
  await tags.getByLabel("Add a Tag").press("Enter");
  await tags
    .locator("span", { hasText: "needs-review" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(tags).toContainText("firmware");
  await expect(tags).not.toContainText("needs-review");

  await page.reload();
  await expect(tags).toContainText("ble");
  await expect(tags).toContainText("firmware");
  await expect(tags).not.toContainText("needs-review");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-tags.png") });
});

test("the board's filters narrow it by search, Tags, priority and Blocked, kept in its address until Clear", async ({
  page,
}) => {
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

  await filters
    .getByRole("group", { name: "Tags" })
    .getByRole("button", { name: "fw-radio" })
    .click();
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
});

test("the user saves the board's filters as a view, applies it and removes it", async ({
  page,
}) => {
  const project = await addedProject(page, "Viewed work", "VW");
  for (const [title, priority] of [
    ["Viewed radio driver", "high"],
    ["Viewed radio notes", "low"],
    ["Viewed release checklist", "high"],
  ] as const) {
    const response = await page.request.post("/api/tasks", {
      data: {
        title,
        projectId: project.id,
        priority,
        tags: title.includes("radio") ? ["vw-radio"] : [],
      },
    });
    expect(response.status()).toBe(201);
  }
  const titles = ["Viewed radio driver", "Viewed release checklist", "Viewed radio notes"];
  const shown = (): Promise<string[]> => titlesIn(page, "Backlog", titles);
  await page.goto("/work");
  await expect.poll(shown).toEqual(titles);

  const filters = page.getByRole("search", { name: "Filter the board" });
  const views = filters.getByRole("group", { name: "Views" });
  await filters
    .getByRole("group", { name: "Tags" })
    .getByRole("button", { name: "vw-radio" })
    .click();
  await filters
    .getByRole("group", { name: "Priority" })
    .getByRole("button", { name: "High" })
    .click();
  await expect.poll(shown).toEqual(["Viewed radio driver"]);

  const name = `Radio work ${Date.now()}`;
  await views.getByRole("button", { name: "Save view…" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Save the view" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Save view" }).click();
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
  await expect(record.getByText(/Not written yet\./)).toBeVisible();
  await expect(record.getByText("No Plan yet.")).toBeVisible();
  for (const stage of ["Implement", "Tests", "Review & fix", "Publish"]) {
    await expect(record.getByText(stage, { exact: true })).toBeVisible();
  }
  await expect(record.getByText("Started from the Idea")).toBeVisible();
  await expect(record.getByText("Users land on the home page.")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Conversation" })).toContainText(
    "Planning opens one with",
  );

  const files = [
    { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Plan\n\nKeep the path.") },
    { name: "screen.png", mimeType: "image/png", buffer: Buffer.from("not really a png") },
    { name: "export.zip", mimeType: "application/zip", buffer: Buffer.from("zip bytes") },
  ];
  const addAttachment = record
    .getByRole("region", { name: "Attachments" })
    .getByRole("button", { name: "Add" });
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

  await record.getByRole("button", { name: "plan.md" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "plan.md" })).toContainText(
    "Keep the path.",
  );
  await page.getByRole("dialog").getByLabel("Close").click();
  const image = await page.request.get(
    (await record.getByRole("link", { name: "screen.png" }).getAttribute("href")) ?? "",
  );
  expect(image.headers()["content-type"]).toBe("image/png");
  const download = page.waitForEvent("download");
  await record.getByRole("link", { name: "export.zip" }).click();
  expect((await download).suggestedFilename()).toBe("export.zip");
  await expect(record.getByRole("link", { name: "https://example.com/sign-in" })).toHaveAttribute(
    "target",
    "_blank",
  );

  await page.getByRole("button", { name: "Idea", exact: true }).click();
  await page.keyboard.type("Remember the page per tab");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Idea captured: Remember the page per tab.")).toBeVisible();
  await page.goto("/work/ideas");
  await expect(
    page.getByRole("article", { name: "Remember the page per tab" }).getByText("Task page"),
  ).toBeVisible();
});

test("a Task's Changes tab lists the files its branch changed with their lines and the diff, and opens them in the editor while the Task has its worktree", async ({
  page,
}) => {
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
  await expect(changes.getByLabel("Diff against the base branch")).toContainText(
    "+export const BACKOFF_MS = 30_000;",
  );
  await expect(changes.getByText("Tests:")).toBeVisible();
  await expect(changes.getByText("not run yet")).toBeVisible();
  // The branch has no worktree yet, so there is nothing to open.
  await expect(changes.getByRole("link", { name: "Open in editor" })).toHaveCount(0);
  await expect(changes.getByRole("link", { name: "backoff.ts" })).toHaveCount(0);

  addTaskWorktree(repository, task.id, taskWorktreePath(project.id, task.id));
  await page.reload();

  // Forward slashes only, a Windows drive letter included.
  const worktreeUrl = `^vscode://file/[^\\\\]+/worktrees/${project.id}/${task.id}`;
  await expect(changes.getByRole("link", { name: "Open in editor" })).toHaveAttribute(
    "href",
    new RegExp(`${worktreeUrl}$`),
  );
  await expect(changes.getByRole("link", { name: "backoff.ts" })).toHaveAttribute(
    "href",
    new RegExp(`${worktreeUrl}/backoff\\.ts$`),
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-changes.png") });

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("region", { name: "Record" })).toBeVisible();
});
