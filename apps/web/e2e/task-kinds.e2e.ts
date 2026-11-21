import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  projectSchema,
  taskSchema,
  type NewProject,
  type Project,
  type Task,
  type TaskKind,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";
import { createFromTopBar } from "./top-bar.ts";

// A Task's Kind (docs/design/issues-as-tasks.html): the card's Kind mark and the board's Kind
// filter, New Task's Bug outline, and Drop's Duplicate reason. None opens a session.

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

async function addedProject(page: Page, name: string, label: string): Promise<Project> {
  const newProject: NewProject = {
    name: `${name} ${Date.now()}`,
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
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

async function createdTask(
  page: Page,
  project: Project,
  title: string,
  kind: TaskKind = "feature",
): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal", kind },
  });
  expect(response.status(), await response.text()).toBe(201);
  return taskSchema.parse(await response.json());
}

function backlog(page: Page): Locator {
  return page.getByRole("region", { name: "Backlog", exact: true });
}

/** Which of `titles` the Backlog shows, in its order. */
async function shownOf(page: Page, titles: readonly string[]): Promise<string[]> {
  const shown = await backlog(page)
    .getByRole("article")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("aria-label") ?? ""));
  return shown.filter((title) => titles.includes(title));
}

test(
  "a card shows its Kind, the Kind filter narrows the board and a Saved view keeps it, and a view saved before Kinds still applies",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Kinds on the board", "KB");
    const word = `kindly${Date.now()}`;
    const bug = `Login fails after a reset ${word}`;
    const feature = `Export Stats as CSV ${word}`;
    const chore = `Bump Playwright ${word}`;
    await createdTask(page, project, bug, "bug");
    await createdTask(page, project, feature, "feature");
    await createdTask(page, project, chore, "chore");
    const titles = [bug, feature, chore];
    // Made before Kinds existed: its filters have no kind.
    const oldView = `Before Kinds ${word}`;
    await queryOfficeDatabase(
      `insert into saved_views (id, name, filters, saved_at) values ($1, $2, $3, now())`,
      [randomUUID(), oldView, JSON.stringify({ query: word })],
    );

    await page.goto("/work");
    const filters = page.getByRole("search", { name: "Filter the board" });
    await filters.getByLabel("Search Tasks").fill(word);
    await expect.poll(() => shownOf(page, titles)).toHaveLength(3);
    for (const [title, kind] of [
      [bug, "Bug"],
      [feature, "Feature"],
      [chore, "Chore"],
    ] as const) {
      await expect(
        backlog(page).getByRole("article", { name: title }).getByRole("img", { name: kind }),
      ).toBeAttached();
    }

    const kinds = filters.getByRole("group", { name: "Kind" });
    await kinds.getByRole("button", { name: "Bug" }).click();
    await expect(page).toHaveURL(/kind=bug/);
    await expect.poll(() => shownOf(page, titles)).toEqual([bug]);
    await screenshotScenario(page, "work-board-kind-filter");

    const views = filters.getByRole("group", { name: "Views" });
    const name = `Open bugs ${word}`;
    await views.getByRole("button", { name: "Save view…" }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Save the view" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Name").press("Enter");
    await expect(dialog).toBeHidden();

    await filters.getByRole("button", { name: "Clear" }).click();
    await expect(kinds.getByRole("button", { name: "Bug" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await views.getByRole("button", { name, exact: true }).click();
    await expect(kinds.getByRole("button", { name: "Bug" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect.poll(() => shownOf(page, titles)).toEqual([bug]);

    // The old view parses as it did: its search alone, no Kind pressed.
    await views.getByRole("button", { name: oldView, exact: true }).click();
    await expect.poll(() => shownOf(page, titles)).toHaveLength(3);
    for (const kind of ["Feature", "Bug", "Chore"]) {
      await expect(kinds.getByRole("button", { name: kind })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }

    for (const view of [name, oldView]) {
      await views.getByRole("button", { name: view, exact: true }).click();
      await views.getByRole("button", { name: `Remove the view ${view}` }).click();
      await expect(views.getByRole("button", { name: view, exact: true })).toBeHidden();
    }
  },
);

test(
  "New Task as Bug fills the Description with the outline, and switching back empties it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Bug outline", "BO");
    await page.goto(`/projects/${project.id}`);
    await createFromTopBar(page, "Task");
    const dialog = page.getByRole("dialog", { name: "New Task" });
    const kind = dialog.getByRole("group", { name: "Kind" });
    const description = dialog.getByRole("textbox", { name: "Description" });
    await expect(kind.getByRole("tab", { name: "Feature" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await kind.getByRole("tab", { name: "Bug" }).click();
    await expect(description).toHaveValue(/^\*\*Steps to reproduce\*\*\n1\. \n/);
    await expect(description).toHaveValue(/\*\*Expected\*\*/);
    await expect(description).toHaveValue(/\*\*Actual\*\*/);

    await kind.getByRole("tab", { name: "Feature" }).click();
    await expect(description).toHaveValue("");

    await kind.getByRole("tab", { name: "Bug" }).click();
    const title = `Login fails after a password reset ${Date.now()}`;
    await dialog.getByLabel("Title").fill(title);
    await screenshotScenario(page, "new-task-bug");
    await dialog.getByRole("button", { name: "Add the Task" }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/tasks\//);
    const bugSection = page.getByRole("region", { name: "Bug", exact: true });
    await expect(bugSection).toBeVisible();
    await screenshotScenario(page, "task-page-bug-section", { inView: bugSection });
  },
);

test(
  "Drop with Duplicate names the Task it duplicates on its page and in its Archived row",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Duplicates", "DU");
    const stamp = Date.now();
    const original = await createdTask(page, project, `Typo on the sign-in page ${stamp}`, "bug");
    const duplicate = await createdTask(page, project, `Sign-in page typo again ${stamp}`, "bug");

    await page.goto("/work");
    await backlog(page)
      .getByRole("article", { name: duplicate.title })
      .getByRole("button", { name: `More for ${duplicate.title}` })
      .click();
    await page.getByRole("menu").getByRole("button", { name: "Drop…" }).click();
    const dialog = page.getByRole("dialog", { name: `Drop ${duplicate.title}?` });
    const drop = dialog.getByRole("button", { name: "Drop the Task" });
    await dialog.getByRole("radio", { name: "Duplicate" }).check();
    await expect(drop).toBeDisabled();
    await expect(drop).toHaveAttribute("title", "Pick the Task it duplicates");
    await dialog
      .getByRole("combobox", { name: "The Task it duplicates" })
      .fill(`Typo on the sign-in page ${stamp}`);
    await page.getByRole("option", { name: original.title }).click();
    await expect(drop).toBeEnabled();
    await screenshotScenario(page, "drop-task-duplicate");
    await drop.click();
    await expect(dialog).toBeHidden();

    await page.goto(`/tasks/${duplicate.id}`);
    const note = page.getByRole("note", { name: "Why it was dropped" });
    await expect(note).toContainText("Dropped as a duplicate of");
    await expect(note.getByRole("link", { name: original.title })).toHaveAttribute(
      "href",
      `/tasks/${original.id}`,
    );

    expect((await page.request.post(`/api/tasks/${duplicate.id}/archive`)).ok()).toBe(true);
    await page.goto("/work/archived");
    const row = page.getByRole("row", { name: new RegExp(duplicate.title) });
    await expect(row).toContainText("Dropped");
    await expect(row).toContainText(`Duplicate of ${original.title}`);
    await expect(row.getByRole("img", { name: "Bug" })).toBeAttached();
    await screenshotScenario(page, "archived-drop-reason", { inView: row });
  },
);

test(
  "a Bug Task Decision shows the proposal's fields to edit, with Create the Bug Task, Don't create it and Ask me again",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Bug proposals", "BP");
    const stamp = Date.now();
    const cause = await createdTask(page, project, `Cache the session tokens ${stamp}`);
    const task = await createdTask(page, project, `Export Stats as CSV ${stamp}`);
    const title = `Stats page crashes on an empty month ${stamp}`;
    const question = `Create the Bug Task "${title}"?`;
    const options = ["Create the Bug Task", "Don't create it"];
    const recommendation = { option: 0, reason: "" };
    const why =
      "The Stats page throws on a month with no runs. It is outside this Task's change, so it should be a Task of its own.";
    const threadId = randomUUID();
    const decisionId = randomUUID();
    await queryOfficeDatabase(
      `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at)
       values ($1, 'task', $2, 'developer', 'Implement', 'waiting', $3, now())`,
      [threadId, task.id, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
    );
    await queryOfficeDatabase(
      `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, attachment_ids, asked_at, bug_task)
       values ($1, $2, $3, 'developer', 'question', $4, $5, $6, $7, $8, '[]', now(), $9)`,
      [
        decisionId,
        threadId,
        task.id,
        question,
        why,
        JSON.stringify(options),
        JSON.stringify(recommendation),
        JSON.stringify([{ kind: "choice", question, options, recommendation }]),
        JSON.stringify({
          title,
          description:
            "**Steps to reproduce**\n1. Open Stats\n2. Pick a month with no runs\n\n**Expected**\nAn empty chart.\n\n**Actual**\nThe page shows an error.",
          why,
          projectId: project.id,
          causedBy: cause.id,
        }),
      ],
    );
    try {
      await page.goto(`/tasks/${task.id}`);
      const needsYou = page.getByRole("region", { name: "Needs you" });
      const card = needsYou.locator(".bug-task-form");
      await expect(card).toContainText("proposes a Bug Task");
      await expect(card.getByLabel("Title")).toHaveValue(title);
      await expect(card.getByRole("button", { name: "Create the Bug Task" })).toBeEnabled();
      await expect(card.getByRole("button", { name: "Don't create it" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Ask me again" })).toBeVisible();
      await screenshotScenario(page, "bug-task-decision", { inView: card });
    } finally {
      // Nothing stays behind in Needs you for the tests alongside.
      await queryOfficeDatabase(`delete from decisions where id = $1`, [decisionId]);
    }
  },
);

test(
  "Shape into a Task offers each Kind, and an Office-wide Idea's window asks the Kind beside the Project",
  { tag: "@full" },
  async ({ page }) => {
    await addedProject(page, "Shaping by Kind", "SK");
    const title = `Crash on an empty month ${Date.now()}`;
    const created = await page.request.post("/api/ideas", {
      data: { title, notes: "", projectId: null },
    });
    expect(created.status(), await created.text()).toBe(201);
    const idea = (await created.json()) as { readonly id: string };

    await page.goto("/work/ideas");
    const card = page.getByRole("article", { name: title });
    await card.getByRole("button", { name: "Shape into a Task of another Kind" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Shape into a Bug Task" }).click();
    const dialog = page.getByRole("dialog", { name: "Which Project is the Task in?" });
    await expect(
      dialog.getByRole("group", { name: "Kind" }).getByRole("tab", { name: "Bug" }),
    ).toHaveAttribute("aria-selected", "true");
    await screenshotScenario(page, "ideas-shape-into-task");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await page.request.post(`/api/ideas/${idea.id}/drop`)).ok()).toBe(true);
  },
);
