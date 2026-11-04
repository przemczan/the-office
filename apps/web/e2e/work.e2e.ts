import path from "node:path";
import zlib from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  attachmentSchema,
  ideaSchema,
  projectSchema,
  presetListSchema,
  recordPath,
  roleSchema,
  taskSchema,
  type Attachment,
  type NewProject,
  type Project,
  type Stage,
  type StageRun,
  type Task,
  type TaskStages,
} from "@the-office/contracts";
import { taskWorktreePath } from "./office-data.ts";
import { queryOfficeDatabase } from "./office-database.ts";
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
  await expect(
    dialog.getByText("You describe the work when you plan it with the Planner."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Add the Task" }).click();
  await expect(dialog).toBeHidden();
  // The new Task's page opens.
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByRole("heading", { name: "Pair over BLE", level: 2 })).toBeVisible();

  await page.goBack();
  const card = page.getByRole("article", { name: "Pair over BLE" });
  await expect(card).toContainText("ble");
  await expect(card).toContainText("needs-review");

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

test("the Project filter narrows the board and Ideas, remembered by the browser, until Show all projects", async ({
  page,
}) => {
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
});

/** An open Decision on the Task, in a Thread of its own, as a Stage's session would ask it. */
async function seedDecision(task: Task, question: string): Promise<void> {
  const threadId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at)
     values ($1, 'task', $2, 'developer', 'Implement', 'waiting', $3, now())`,
    [threadId, task.id, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, question, context, options, recommendation, asked_at)
     values ($1, $2, $3, 'developer', $4, 'Both work.', '["Yes", "No"]', '{"option":0,"reason":"It is simpler."}', now())`,
    [crypto.randomUUID(), threadId, task.id, question],
  );
}

test("the Project filter narrows Needs you, the status strip and the Projects list, until Show all projects", async ({
  page,
}) => {
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
  await expect(strip.getByRole("button", { name: /need/ })).toContainText(
    /^1 needs you\+\d+ in other Projects$/,
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

test("the top bar's search finds records and people, follows the Project filter, and opens the pick", async ({
  page,
}) => {
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
  const rail = page.getByRole("region", { name: /^Pipeline · / });
  await expect(rail.getByText("Not started").first()).toBeVisible();
  for (const stage of ["Implement", "Tests", "Review & fix", "Publish"]) {
    await expect(rail.getByText(stage, { exact: true })).toBeVisible();
  }
  const origin = record.getByRole("region", { name: "Origin" });
  await expect(origin.getByText("Idea: Sign-in keeps the page")).toBeVisible();
  await expect(origin.getByText("Users land on the home page.")).toBeHidden();
  const originFold = origin.getByRole("button", { name: /^Origin/ });
  await originFold.click();
  await expect(origin.getByText("Users land on the home page.")).toBeVisible();
  await expect(originFold).toHaveAttribute("aria-expanded", "true");

  // The fold is this browser's memory of this Task, so it survives a reload.
  await page.reload();
  await expect(origin.getByText("Users land on the home page.")).toBeVisible();
  await originFold.click();
  await expect(origin.getByText("Users land on the home page.")).toBeHidden();
  await page.reload();
  await expect(originFold).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("complementary", { name: "Conversation" })).toContainText(
    "Planning opens one with",
  );

  const files = [
    { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# Plan\n\nKeep the path.") },
    { name: "screen.png", mimeType: "image/png", buffer: Buffer.from("not really a png") },
    { name: "export.zip", mimeType: "application/zip", buffer: Buffer.from("zip bytes") },
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

  await expect(page.getByRole("tab", { name: "Attachments" })).toContainText("4");
  await page.reload();
  await attachments.getByRole("button", { name: "plan.md" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "plan.md" })).toContainText(
    "Keep the path.",
  );
  await page.getByRole("dialog").getByLabel("Close").click();
  await attachments.getByRole("button", { name: "View screen.png" }).click();
  const original = page
    .getByRole("dialog")
    .filter({ hasText: "screen.png" })
    .getByRole("link", { name: "Open the original" });
  const image = await page.request.get((await original.getAttribute("href")) ?? "");
  expect(image.headers()["content-type"]).toBe("image/png");
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await attachments.getByRole("link", { name: "export.zip" }).click();
  expect((await download).suggestedFilename()).toBe("export.zip");
  await expect(
    attachments.getByRole("link", { name: "https://example.com/sign-in" }),
  ).toHaveAttribute("target", "_blank");

  await page.getByRole("button", { name: "Idea", exact: true }).click();
  await page.keyboard.type("Remember the page per tab");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Idea captured: Remember the page per tab.")).toBeVisible();
  await page.goto("/work/ideas");
  await expect(
    page.getByRole("article", { name: "Remember the page per tab" }).getByText("Task page"),
  ).toBeVisible();
});

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
    threadId: null,
    session: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    carriedFailure: null,
    sentBack: null,
    commandRuns: [],
    gateAction,
    outcome: null,
  };
}

test("selecting a Stage opens its history, with the loop-back on the rail and the keys to step and close", async ({
  page,
}) => {
  const project = await addedProject(page, "Stage history", "SH");
  const task = await createdTask(page, project, "A Task that looped");
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
  const stages: TaskStages = {
    stages: [
      {
        stage: implement,
        state: "done",
        tokens,
        wentBack: null,
        runs: [
          { ...aStageRun(1, at(0), at(5)), threadId, session: "fresh", tokens },
          {
            ...aStageRun(3, at(6), at(9)),
            threadId,
            session: "resume",
            carriedFailure: { stageKey: "tests", round: 1, rounds: 3 },
            outcome: {
              ...done,
              summary: "Fixed the test.",
              handoverNote: "The **redirect** moved.",
            },
          },
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
  };
  await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
  await page.goto(`/tasks/${task.id}`);

  const rail = page.getByRole("region", { name: /^Pipeline · / });
  const stageButton = (name: string): Locator => rail.getByRole("button", { name, exact: true });
  const historyOf = (name: string): Locator =>
    rail.getByRole("region", { name: `Stage history: ${name}` });

  // Tests went back once; the Gate's send-back draws nothing.
  const loop = rail.getByRole("button", { name: /failed and went back/ });
  await expect(loop).toHaveCount(1);
  await expect(loop).toHaveAccessibleName(
    "Tests failed and went back to Implement 1 time, of at most 3",
  );
  await expect(loop).toHaveText("1 of 3");
  await expect(stageButton("UI acceptance")).toHaveAttribute("aria-current", "step");

  await loop.click();
  const testsHistory = historyOf("Tests");
  await expect(stageButton("Tests")).toHaveAttribute("aria-expanded", "true");
  await expect(testsHistory.getByRole("listitem").filter({ hasText: "Run 2" })).toContainText(
    "2 tests failed.",
  );
  await expect(testsHistory.getByRole("list", { name: "Commands" })).toContainText(
    "npm test failed · 1 min",
  );
  await expect(testsHistory.getByRole("link", { name: "Open its Thread" })).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-stage-history.png") });

  await page.keyboard.press("ArrowLeft");
  const implementHistory = historyOf("Implement");
  await expect(testsHistory).toHaveCount(0);
  await expect(stageButton("Implement")).toBeFocused();
  await expect(implementHistory).toContainText("Agent Stage");
  const runs = implementHistory.locator(".stage-history-run");
  await expect(runs).toHaveCount(3);
  // Newest first, and the one Thread of all three runs is reached from each.
  await expect(runs.nth(0)).toContainText("Run 6");
  await expect(runs.nth(0)).toContainText("Sent back from UI acceptance");
  await expect(runs.nth(0)).toContainText("Make the buttons bigger.");
  await expect(runs.nth(1)).toContainText("Briefed with what failed in Tests, round 1 of 3");
  await expect(runs.nth(1)).toContainText("Fixed the test.");
  await expect(runs.nth(1)).toContainText("continued session");
  await expect(runs.nth(1).locator("strong", { hasText: "redirect" })).toBeVisible();
  await expect(runs.nth(2)).toContainText("42k tokens");
  await expect(runs.nth(2)).toContainText("fresh session");
  const threadLinks = implementHistory.getByRole("link", { name: "Open its Thread" });
  await expect(threadLinks).toHaveCount(3);
  await expect(threadLinks.first()).toHaveAttribute("href", new RegExp(`taskThread=${threadId}`));

  // The arrows stop at the ends, and the panel's own buttons move focus to the Stage too.
  await page.keyboard.press("ArrowLeft");
  await expect(implementHistory).toBeVisible();
  await implementHistory.getByRole("button", { name: "Next Stage" }).click();
  await expect(stageButton("Tests")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  const gateHistory = historyOf("UI acceptance");
  await expect(gateHistory).toContainText("You sent back to Implement");
  await expect(gateHistory).toContainText("Waits for you to look at the changes");

  // A click on the panel's text leaves the keys working; Esc gives focus back to the Stage.
  await gateHistory.getByText("You sent back to Implement").click();
  await page.keyboard.press("Escape");
  await expect(gateHistory).toHaveCount(0);
  await expect(stageButton("UI acceptance")).toBeFocused();
  await expect(stageButton("UI acceptance")).toHaveAttribute("aria-expanded", "false");

  // The same Stage again opens, and a second click closes.
  await stageButton("Tests").click();
  await expect(testsHistory).toBeVisible();
  await stageButton("Tests").click();
  await expect(testsHistory).toHaveCount(0);
});

test("a Task's images show by round, the Gate shows the current one, and the viewer steps through them", async ({
  page,
}) => {
  const project = await addedProject(page, "Gallery rounds", "GR");
  const task = await createdTask(page, project, "Gallery of two rounds");
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
          aStageRun(2, sentBackAt, sentBackAt, {
            kind: "send-back",
            stageKey: "implement",
            feedback: "Make the buttons bigger.",
          }),
          aStageRun(4, secondLook.addedAt, null),
        ],
      },
    ],
    editedForTask: false,
    lockedStages: 2,
    testResults: [],
    definitionOfDoneMet: [],
  };
  await page.route(`**/api/tasks/${task.id}/stages`, (route) => route.fulfill({ json: stages }));
  await page.goto(`/tasks/${task.id}`);

  const gate = page.getByRole("region", { name: "Gate attachments" });
  await expect(gate.getByRole("button", { name: /^View / })).toHaveCount(1);
  await expect(gate.getByRole("button", { name: "View second-look.png" })).toBeVisible();
  await gate.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-attachments.png") });

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
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-attachment-rounds.png") });

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
  await expect(changes.getByRole("link", { name: "Open backoff.ts in the editor" })).toHaveCount(0);

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

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByRole("region", { name: "Record" })).toBeVisible();
});
