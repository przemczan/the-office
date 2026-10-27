import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  OPEN_DECISION_TOOL,
  pipelineListSchema,
  projectSchema,
  recordPath,
  roleCardSchema,
  roleSchema,
  taskSchema,
  taskStagesSchema,
  threadListSchema,
  threadSchema,
  type NewProject,
  type Project,
  type TaskLimit,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

/** Written by this file alone, so the other files' skills never meet it. */
const SKILL = "people-handover";

// One person fills each Role and the database lives for the whole run, so the tests build on each
// other's hires; this is the only file that hires.
test.describe.configure({ mode: "serial" });

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

async function hireFromPreset(page: Page, preset: string, name: string): Promise<void> {
  await page.goto("/people");
  await page.getByRole("button", { name: "Hire a Role" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(preset, { exact: true }).click();
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: `Hire ${name}` }).click();
  await expect(page.getByRole("heading", { name: `${name} · ${preset}` })).toBeVisible();
}

/** Saves the Developer's card with this Task limit, returning the one it had. */
async function setDevelopersTaskLimit(page: Page, taskLimit: TaskLimit): Promise<TaskLimit> {
  const read = await page.request.get("/api/roles/developer");
  const { card } = roleSchema.parse(await read.json());
  const saved = await page.request.put("/api/roles/developer/card", {
    data: { ...card, taskLimit },
  });
  expect(saved.status()).toBe(200);
  return card.taskLimit;
}

function roleCardGroup(page: Page, group: string) {
  return page.getByRole("region", { name: group });
}

test("the user hires the Planner, a Developer, a Reviewer and the Office Manager from the presets", async ({
  page,
}) => {
  await hireFromPreset(page, "Planner", "Jan");
  await expect(page).toHaveURL(/\/people\/planner$/);
  await hireFromPreset(page, "Developer", "Ada");
  await hireFromPreset(page, "Reviewer", "Ola");
  await hireFromPreset(page, "Office Manager", "Marta");

  await page.goto("/people");
  await expect(page.getByText("4 people")).toBeVisible();
  for (const name of ["Jan", "Ada", "Ola", "Marta"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  // Every preset is filled, so only hiring from scratch is left.
  await expect(page.getByRole("button", { name: "Hire a Role" })).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-people.png") });
});

test("a person's page shows who they are and their Role card from the presets", async ({
  page,
}) => {
  await page.goto("/people");
  await page.getByRole("link", { name: "Jan", exact: true }).click();
  await expect(page).toHaveURL(/\/people\/planner$/);
  await expect(page.getByRole("heading", { name: "Who Jan is" })).toBeVisible();
  await expect(page.getByText("Up to 2 Tasks")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-overview.png") });

  await page.goto("/people/developer");
  await page.getByRole("tab", { name: "Role card" }).click();
  await expect(page).toHaveURL(/\/people\/developer\/role$/);
  const permissions = roleCardGroup(page, "Permissions");
  await expect(permissions).toContainText("Run installsConsult Devops");
  await expect(permissions).toContainText("Publish outside the PipelineConsult CTO");
  await expect(permissions).toContainText("Asks you until someone is hired");
  await expect(permissions).toContainText("Change RolesNever");
  await expect(roleCardGroup(page, "Work")).toContainText("3 at once");
  await expect(roleCardGroup(page, "Engine")).toContainText("Opus 5.5 · effort high");
  await expect(page.getByText("Hired", { exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-person-role-card.png"),
    fullPage: true,
  });

  // The Office Manager only talks, and changes a Role only when the user says so.
  await page.goto("/people/office-manager/role");
  await expect(roleCardGroup(page, "Work")).toContainText("talks only and never works a Stage");
  await expect(roleCardGroup(page, "Permissions")).toContainText("Change RolesAsk me");
});

test("the user edits every field of a Role card, and it holds after a reload", async ({ page }) => {
  const written = await page.request.post("/api/skills", {
    data: { name: SKILL, description: "Writes the Handover note.", instructions: "Three lines." },
  });
  expect(written.status()).toBe(201);
  await page.request.put(`/api/skills/${SKILL}/state`, { data: { state: "on" } });

  await page.goto("/people/developer/role");
  await page.getByRole("button", { name: "Edit Role" }).click();
  await expect(page).toHaveURL(/\/people\/developer\/role\/edit$/);
  const form = page.locator("form.role-card-form");
  await form.getByLabel("Name", { exact: true }).fill("Adam");
  await form.getByLabel("Title", { exact: true }).fill("Senior developer");
  await form.getByLabel("Responsibilities").fill("Implements Plans and keeps the tests green.");
  await form.getByLabel("Instructions").fill("Work from the Plan.\n\nAsk the user: a public API.");
  await form.getByLabel("Task limit").selectOption("4");
  await form.getByText("Prefer to continue", { exact: true }).click();
  await form.getByLabel("Model").selectOption("claude-sonnet-5-5");
  await form.getByRole("tab", { name: "Max" }).click();
  await form.getByText("Chat", { exact: true }).click();
  await form.getByText("Consultant", { exact: true }).click();
  await form.getByLabel("Run installs").selectOption("ask-me");
  await form.getByLabel("Publish outside the Pipeline").selectOption("never");
  await form.getByLabel("Runs").selectOption("project-commands");
  await form.getByText("Searches and fetches the web", { exact: true }).click();
  await form.getByText(SKILL, { exact: true }).click();
  await expect(
    form.locator("label").filter({ hasText: SKILL }).getByRole("checkbox"),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-role-card-form.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByText("Role card saved. Adam works with it from the next session."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/people\/developer\/role$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Adam · Senior developer" })).toBeVisible();
  await expect(roleCardGroup(page, "Identity")).toContainText(
    "Implements Plans and keeps the tests green.",
  );
  await expect(roleCardGroup(page, "Work")).toContainText("Ask the user: a public API.");
  await expect(roleCardGroup(page, "Work")).toContainText("4 at once");
  await expect(roleCardGroup(page, "Work")).toContainText("Prefer to continue");
  await expect(roleCardGroup(page, "Engine")).toContainText("Sonnet 5.5 · effort max");
  const capabilities = roleCardGroup(page, "Capabilities").getByRole("listitem");
  await expect(capabilities.filter({ hasText: "Chat" })).toHaveClass("on");
  await expect(capabilities.filter({ hasText: "Consultant" })).toHaveClass("on");
  const permissions = roleCardGroup(page, "Permissions");
  await expect(permissions).toContainText("Run installsAsk me");
  await expect(permissions).toContainText("Publish outside the PipelineNever");
  await expect(permissions).not.toContainText("Asks you until someone is hired");
  await expect(permissions).toContainText("Edits files in its worktree");
  await expect(permissions).toContainText("Runs the Project's commands and read-only git");
  await expect(permissions).toContainText("No web");
  await expect(roleCardGroup(page, "Skills")).toContainText(SKILL);

  const changes = page.getByRole("listitem").filter({ hasText: "Role card version 2" });
  await expect(changes).toContainText("Model Opus 5.5 → Sonnet 5.5");
  await expect(changes).toContainText("Task limit 3 → 4");
  await expect(page.getByText(`Skills gained ${SKILL}`)).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-role-card-changed.png"),
    fullPage: true,
  });
});

test("a Role card the service refuses names every reason, and keeps what was typed", async ({
  page,
}) => {
  await page.goto("/people/reviewer/role/edit");
  const form = page.locator("form.role-card-form");
  await form.getByLabel("Name", { exact: true }).fill("");
  await form.getByLabel("Responsibilities").fill("First paragraph.\n\nSecond paragraph.");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("The Role card can't be saved yet")).toBeVisible();
  await expect(page.getByText("Give the person a name.")).toBeVisible();
  await expect(page.getByText("The responsibilities are one paragraph.")).toBeVisible();
  await expect(form.getByLabel("Responsibilities")).toHaveValue(
    "First paragraph.\n\nSecond paragraph.",
  );
});

test("the user hires a person from scratch, filling the whole Role card", async ({ page }) => {
  await page.goto("/people");
  await page.getByRole("button", { name: "Start from scratch" }).click();
  await expect(page).toHaveURL(/\/hire$/);
  const form = page.locator("form.role-card-form");
  await form.getByLabel("Name", { exact: true }).fill("Mia");
  await form.getByLabel("Title", { exact: true }).fill("Data Analyst");
  await page.getByRole("button", { name: "Hire Mia" }).click();
  // Responsibilities and instructions are still empty.
  await expect(page.getByText("The person can't be hired yet")).toBeVisible();
  await expect(page.getByText("Give the Role's responsibilities in one paragraph.")).toBeVisible();
  await expect(form.getByLabel("Name", { exact: true })).toHaveValue("Mia");

  await form.getByLabel("Responsibilities").fill("Answers questions with the Project's data.");
  await form.getByLabel("Instructions").fill("Query read-only; report what the numbers show.");
  await form.getByLabel("Runs").selectOption("project-commands");
  await page.getByRole("button", { name: "Hire Mia" }).click();

  await expect(page.getByRole("heading", { name: "Mia · Data Analyst" })).toBeVisible();
  await expect(page).toHaveURL(/\/people\/data-analyst$/);
  await page.goto("/people/data-analyst/role");
  await expect(roleCardGroup(page, "Permissions")).toContainText(
    "Runs the Project's commands and read-only git",
  );
  await expect(roleCardGroup(page, "Work")).toContainText("1 at once");
});

test("the user lets a person go, finds their page kept and read-only, and hires them back", async ({
  page,
}) => {
  await page.goto("/people/data-analyst");
  await page.getByRole("button", { name: "Let go", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Let Mia go?");
  await expect(dialog).toContainText("Role card, Memory and chats are kept");
  await dialog.getByRole("button", { name: "Let Mia go" }).click();

  await expect(page.getByText("Mia was let go", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Role" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Let go", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Memory" }).click();
  await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
  await page.goto("/people");
  await expect(page.locator(".person-card", { hasText: "Mia" })).toContainText("Let go");

  await page.goto("/people/data-analyst");
  await page.getByRole("button", { name: "Hire Mia back" }).click();
  await expect(page.getByText("Mia was let go", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Role" })).toBeVisible();
});

test("Assign… in Settings › Skills gives a skill to the people chosen", async ({ page }) => {
  await page.goto("/settings/skills");
  await page
    .getByRole("row")
    .filter({ hasText: SKILL })
    .getByRole("button", { name: "Assign…" })
    .click();
  const dialog = page.getByRole("dialog");
  for (const person of ["Jan · Planner", "Adam · Senior developer", "Ola · Reviewer"]) {
    await expect(dialog.getByText(person)).toBeVisible();
  }
  await dialog.getByText("Ola · Reviewer").click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/people/reviewer");
  await expect(page.getByText(SKILL, { exact: true })).toBeVisible();
});

test.describe("dark", () => {
  test.use({ colorScheme: "dark" });

  test("the Role card form keeps its unsaved-changes bar readable", async ({ page }) => {
    await page.goto("/people/planner/role/edit");
    await page.locator("form.role-card-form").getByText("Chat", { exact: true }).click();
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-role-card-form.png") });
  });
});

test("a Role nobody fills has no page", async ({ page }) => {
  await page.goto("/people/cto");
  await expect(page.getByRole("link", { name: "Back to People" })).toBeVisible();
});

/** The chat open over the page. */
function chatWith(page: Page, name: string) {
  return page.getByRole("dialog", { name: `Chat with ${name}` });
}

function contextLabel(page: Page) {
  return chatWith(page, "Jan").getByLabel("Context");
}

// The engine replays e2e/sessions.jsonl: the Planner's first session, then a fresh one.
test("the user chats with the Planner, who reads but changes nothing", async ({ page }) => {
  await page.goto("/people");
  await page.getByRole("button", { name: "Open the chat with Jan" }).click();
  const chat = chatWith(page, "Jan");
  await expect(chat.getByText("No threads with Jan yet.")).toBeVisible();
  await chat.getByRole("button", { name: "New thread" }).first().click();
  await expect(contextLabel(page)).toContainText(/Fresh · new Thread · brief ~\d/);

  await chat.getByLabel("Message").fill("Read the deploy workflow.");
  await chat.getByLabel("Message").press("Enter");

  await expect(chat.getByText("It deploys to production on every push to main.")).toBeVisible();
  await expect(chat.getByText(/deploy-production\.yml$/)).toBeVisible();
  await expect(chat.getByText("This session only reads: changes happen on Tasks.")).toBeVisible();
  await expect(chat.getByRole("heading", { name: "Read the deploy workflow" })).toBeVisible();
  await expect(contextLabel(page)).toHaveText("Continuing · cache warm · 32k context");
  await expect(chat.getByText("32k tokens in this Thread")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-chat.png") });

  await chat.getByRole("button", { name: /^Start fresh · ~\d/ }).click();
  await expect(contextLabel(page)).toContainText(/Fresh · you chose it · brief ~\d/);
  await expect(chat.getByRole("button", { name: "Auto" })).toBeVisible();
  await expect(chat.getByRole("button", { name: "Continue anyway · ~32k" })).toBeVisible();
  await chat.getByLabel("Message").fill("And the tests?");
  await chat.getByLabel("Message").press("Enter");

  await expect(chat.getByText("The tests run with npm test.")).toBeVisible();
  await expect(chat.getByText(/^Fresh · you chose it · brief ~\d/)).toBeVisible();
  await expect(contextLabel(page)).toHaveText("Continuing · cache warm · 21k context");
});

test("a Thread is renamed, and an old one stays readable and continues", async ({ page }) => {
  await page.goto("/people?chat=planner");
  const chat = chatWith(page, "Jan");
  await chat.getByRole("button", { name: "Rename the Thread" }).click();
  await chat.getByLabel("Thread title").fill("Deploys");
  await chat.getByRole("button", { name: "Save" }).click();
  await expect(chat.getByRole("heading", { name: "Deploys" })).toBeVisible();

  await chat.getByRole("button", { name: "New thread" }).first().click();
  await expect(chat.getByRole("heading", { name: "New thread" })).toBeVisible();
  await chat.getByRole("button", { name: /^Deploys/ }).click();
  await expect(chat.getByText("It deploys to production on every push to main.")).toBeVisible();
  await chat.getByLabel("Message").fill("Thanks.");
  await chat.getByLabel("Message").press("Enter");

  await expect(chat.getByText("You're welcome.")).toBeVisible();
  await expect(contextLabel(page)).toHaveText("Continuing · cache warm · 21k context");

  await page.reload();
  await expect(chatWith(page, "Jan").getByText("You're welcome.")).toBeVisible();
});

test("the Planner's page lists their Threads under Conversations", async ({ page }) => {
  await page.goto("/people/planner");
  await page.getByRole("tab", { name: "Conversations" }).click();
  await expect(page).toHaveURL(/\/people\/planner\/conversations$/);
  await expect(page.getByRole("tab", { name: "Conversations" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Chat threads · 2")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-conversations.png") });

  await page.getByRole("button", { name: /^Deploys/ }).click();

  await expect(chatWith(page, "Jan").getByText("You're welcome.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chatWith(page, "Jan")).toHaveCount(0);
});

test("the user adds a note to the Planner's Memory, deletes one, then deletes the whole memory", async ({
  page,
}) => {
  await page.goto("/people/planner");
  await page.getByRole("tab", { name: "Memory" }).click();
  await expect(page).toHaveURL(/\/people\/planner\/memory$/);
  await expect(page.getByText("Memory · 0")).toBeVisible();
  await expect(page.getByText("No notes yet.")).toBeVisible();

  for (const note of ["Prefers short answers.", "Release notes go in CHANGELOG.md."]) {
    await page.getByLabel("Note", { exact: true }).fill(note);
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText(note)).toBeVisible();
  }
  await expect(page.getByText("Memory · 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "All Projects" })).toBeVisible();
  await expect(page.getByText("Added by you")).toHaveCount(2);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-memory.png") });

  await page
    .getByRole("listitem")
    .filter({ hasText: "Prefers short answers." })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete the note" }).click();
  await expect(page.getByText("Prefers short answers.")).toHaveCount(0);
  await expect(page.getByText("Memory · 1")).toBeVisible();

  await page.getByRole("button", { name: "Delete memory" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This can't be undone.");
  await dialog.getByRole("button", { name: "Delete memory" }).click();
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await expect(page.getByText("Memory · 0")).toBeVisible();
});

test("a person whose Shared memory is off shows their Memory as not in use", async ({ page }) => {
  await page.goto("/people/developer/memory");

  await expect(page.getByText("Not in use")).toBeVisible();
  await expect(page.getByText("Add a note")).toHaveCount(0);
});

/** Adds a Project on a repository of its own through the API. */
async function addedProject(
  page: Page,
  repository: TemporaryRepository,
  name: string,
  label: string,
  commands: NewProject["commands"] = {
    install: "npm ci",
    build: "npm run build",
    lint: "npm run lint",
    test: "npm test",
  },
): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "violet" },
    commands,
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  return projectSchema.parse(await added.json());
}

test("a person's Work tab lists the Tasks whose Stages they work", async ({ page }) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "People work", "PW");
    const created = await page.request.post("/api/tasks", {
      data: { title: "Fix the login redirect", projectId: project.id, priority: "normal" },
    });
    expect(created.status()).toBe(201);

    await page.goto("/people/developer");
    await page.getByRole("tab", { name: "Work" }).click();

    await expect(page).toHaveURL(/\/people\/developer\/work$/);
    const row = page.getByRole("row", { name: /Fix the login redirect/ });
    await expect(row).toContainText("Implement · Review & fix");
    await expect(row).toContainText("Backlog");
    await page.getByRole("button", { name: /^Done/ }).click();
    await expect(page.getByText("No Tasks here. Try another filter.")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-work.png") });
  } finally {
    await repository.remove();
  }
});

/** A Stage's row in the open Stage editor, which the user opens to change its fields. */
function editorRow(page: Page, name: string) {
  return page.getByRole("dialog").getByRole("list", { name: "Stages" }).getByRole("listitem", {
    name,
    exact: true,
  });
}

test("Edit for this Task swaps the Pipeline and sets every field of its Stages, which hold after a reload", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Stage editor", "SE");
    const created = await page.request.post("/api/tasks", {
      data: { title: "Keep the filters on reload", projectId: project.id, priority: "normal" },
    });
    const { id: taskId } = taskSchema.parse(await created.json());
    const library = pipelineListSchema.parse(
      await (await page.request.get("/api/pipelines")).json(),
    );
    await page.goto(`/tasks/${taskId}`);

    await page.getByRole("button", { name: "Edit for this Task" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Changes apply to Keep the filters on reload only.");
    await dialog.getByLabel("Pipeline").selectOption("quick-fix");
    await expect(editorRow(page, "Publish")).toBeVisible();
    await expect(editorRow(page, "Review & fix")).toHaveCount(0);

    // A Gate goes before Publish, opened to be named.
    await dialog.getByRole("button", { name: "Gate", exact: true }).click();
    await editorRow(page, "Gate").getByLabel("Name", { exact: true }).fill("UI acceptance");

    const implement = editorRow(page, "Implement");
    await implement.getByRole("button", { name: "Edit Implement" }).click();
    await implement.getByLabel("Who works it").selectOption("reviewer");
    await implement.getByLabel("Model").selectOption("claude-haiku-5-5");
    await implement.getByLabel("Effort").selectOption("high");
    await implement.getByLabel("Budget").fill("120");
    await implement.getByLabel("Brief").fill("Keep the filters in the address.");

    // An Agent Stage moved up behind Implement continues its session with the same Role.
    await dialog.getByRole("button", { name: "Agent Stage", exact: true }).click();
    const added = editorRow(page, "New Stage");
    for (let move = 0; move < 3; move += 1) {
      await added.getByRole("button", { name: "Move New Stage up" }).click();
    }
    await added.getByLabel("Who works it").selectOption("reviewer");
    await added.getByLabel("Session").selectOption("continue");
    await added.getByText("Optional: skipped when the Definition of Done is already met").click();
    await added.getByLabel("Name", { exact: true }).fill("Review");

    const tests = editorRow(page, "Tests");
    await tests.getByRole("button", { name: "Edit Tests" }).click();
    await tests.getByLabel("On failure").selectOption("new-stage");
    await tests.getByLabel("Rounds").selectOption("2");
    await tests.getByLabel("Project command").selectOption("lint");

    // Tests can't go back to Review from above it: the editor flags it, and Save waits.
    const save = dialog.getByRole("button", { name: "Save for this Task" });
    await tests.getByRole("button", { name: "Move Tests up" }).click();
    await expect(dialog.getByRole("list", { name: "Problems" })).toContainText(
      "Stage 2 · Tests: on failure it can only go back to an earlier Stage.",
    );
    await expect(save).toBeDisabled();
    await tests.getByRole("button", { name: "Move Tests down" }).click();
    await expect(dialog.getByRole("list", { name: "Problems" })).toHaveCount(0);

    // A Script Stage added and dropped again leaves nothing behind.
    await dialog.getByRole("button", { name: "Script Stage", exact: true }).click();
    await editorRow(page, "Script").getByRole("button", { name: "Remove Script" }).click();
    await expect(editorRow(page, "Script")).toHaveCount(0);

    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-stage-editor.png") });
    await save.click();
    await expect(page.getByText("Stages saved for Keep the filters on reload.")).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("region", { name: "Stages · Quick fix · edited for this Task" }),
    ).toBeVisible();
    const own = taskStagesSchema.parse(
      await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
    );
    const quickFix = library.find(({ id }) => id === "quick-fix")?.stages ?? [];
    const [libraryImplement, libraryTests, libraryPublish] = quickFix;
    expect(own.stages?.map(({ stage }) => stage)).toEqual([
      {
        ...libraryImplement,
        role: "reviewer",
        model: "claude-haiku-5-5",
        effort: "high",
        budget: 120_000,
        brief: "Keep the filters in the address.",
      },
      {
        kind: "agent",
        key: "new-stage",
        name: "Review",
        optional: true,
        role: "reviewer",
        brief: "",
        session: "continue",
        budget: 100_000,
      },
      { ...libraryTests, command: "lint", onFailure: { goBackTo: "new-stage", rounds: 2 } },
      { kind: "gate", key: "gate", name: "UI acceptance", optional: false },
      libraryPublish,
    ]);
    // The library's Quick fix stays as it was.
    expect(
      pipelineListSchema
        .parse(await (await page.request.get("/api/pipelines")).json())
        .find(({ id }) => id === "quick-fix")?.stages,
    ).toEqual(quickFix);

    // The editor opens on what was saved.
    await page.getByRole("button", { name: "Edit for this Task" }).click();
    await editorRow(page, "Implement").getByRole("button", { name: "Edit Implement" }).click();
    await expect(editorRow(page, "Implement").getByLabel("Model")).toHaveValue("claude-haiku-5-5");
    await expect(editorRow(page, "Implement").getByLabel("Budget")).toHaveValue("120");
    await expect(editorRow(page, "Tests")).toContainText("on failure back to Review, at most 2×");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

    // From the board card's menu, selecting and typing in the editor leaves the card where it is.
    await page.goto("/work");
    await page
      .getByRole("article", { name: "Keep the filters on reload" })
      .getByRole("button", { name: "More for Keep the filters on reload" })
      .click();
    await page.getByRole("menu").getByRole("button", { name: "Edit Stages for this Task" }).click();
    const fromBoard = editorRow(page, "Implement");
    await fromBoard.getByRole("button", { name: "Edit Implement" }).click();
    const brief = fromBoard.getByLabel("Brief");
    const box = await brief.boundingBox();
    if (!box) throw new Error("The Brief isn't shown.");
    await page.mouse.move(box.x + 8, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 10, { steps: 5 });
    await page.mouse.up();
    await fromBoard.getByLabel("Name", { exact: true }).press("End");
    await page.keyboard.type(" again");
    await expect(page).toHaveURL(/\/work$/);
    await expect(editorRow(page, "Implement again")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await repository.remove();
  }
});

const QUERY_QUESTION = "Should sign-in keep the query string on the way back?";

/**
 * The Task the user plans and then starts, with its repository, kept from one test to the next. Its
 * Project's commands pass anywhere, so its Stages run without npm.
 */
const signIn: { repository?: TemporaryRepository; taskUrl?: string } = {};
const PASSING_COMMANDS: NewProject["commands"] = {
  install: "node --version",
  build: "node --version",
  lint: "node --version",
  test: "node --version",
};

test.afterAll(async () => {
  await signIn.repository?.remove();
});

// The engine replays the planning session from e2e/sessions.jsonl: Jan writes the Plan and the
// Definition of Done, proposes Quick fix and opens a Decision, then takes its answer.
test("the user plans a Task with the Planner to Ready, answering a Decision", async ({ page }) => {
  const repository = await createTemporaryRepository();
  signIn.repository = repository;
  const project = await addedProject(page, repository, "Sign-in", "SI", PASSING_COMMANDS);
  const created = await page.request.post("/api/tasks", {
    data: { title: "Sign-in returns to the page", projectId: project.id, priority: "normal" },
  });
  expect(created.status()).toBe(201);
  await page.goto("/work");
  await page
    .getByRole("region", { name: "Backlog", exact: true })
    .getByRole("article", { name: "Sign-in returns to the page" })
    .getByRole("button", { name: "Plan", exact: true })
    .click();

  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
  signIn.taskUrl = page.url();
  await expect(
    page.getByText("Sign-in returns to the page is in Planning with Jan."),
  ).toBeVisible();
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  await expect(conversation.getByRole("button", { name: /^Planning · Jan/ })).toBeVisible();
  const decision = conversation.getByRole("region", { name: `Decision: ${QUERY_QUESTION}` });
  await expect(
    decision.getByText("Jan recommends “Keep the query string”: Filters live in the query string."),
  ).toBeVisible();
  await expect(conversation.getByText(OPEN_DECISION_TOOL)).toHaveCount(0);
  // The opening's context line opens to show the Brief the session started with.
  const brief = conversation.locator(".message-brief-text");
  await expect(brief).toBeHidden();
  await conversation.getByText("Brief", { exact: true }).click();
  await expect(brief).toContainText("You are planning a Task with the user");
  await expect(brief).toContainText("Sign-in returns to the page (Task ");
  await expect(page.getByText("Waiting on you", { exact: true })).toBeVisible();

  const record = page.getByRole("region", { name: "Record" });
  const plan = record.getByRole("region", { name: "Plan", exact: true });
  const definitionOfDone = record.getByRole("region", { name: "Definition of Done" });
  const stages = record.getByRole("region", { name: /^Stages · / });
  await expect(plan.getByText("Proposed by Jan")).toBeVisible();
  await expect(definitionOfDone.getByText("The tests pass.")).toBeVisible();
  await expect(stages.getByText(/A small change with tests/)).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-planning.png") });

  // Mark Ready waits for every line of "Before Ready", and each line ticks as it is met.
  const markReady = page.getByRole("button", { name: "Mark Ready" });
  const beforeReady = record.getByRole("region", { name: "Before Ready" });
  const readinessLine = (label: string): Locator =>
    beforeReady.getByRole("listitem").filter({ hasText: label });
  await expect(markReady).toBeDisabled();
  await expect(readinessLine("Plan confirmed")).toContainText(
    "Confirm the Plan before the Task can be Ready.",
  );
  await expect(readinessLine("No Decision waiting")).toContainText(
    "Answer the open Decision before the Task can be Ready.",
  );
  await expect(beforeReady.locator(".task-checklist-met")).toHaveCount(0);

  await plan.getByRole("button", { name: "Confirm" }).click();
  await expect(plan.getByText("Confirmed")).toBeVisible();
  await expect(readinessLine("Plan confirmed")).toHaveClass(/task-checklist-met/);
  await definitionOfDone.getByRole("button", { name: "Edit" }).click();
  await definitionOfDone
    .getByRole("textbox")
    .fill("Signing in returns to the page and its query string.\nThe tests pass.");
  await definitionOfDone.getByRole("button", { name: "Save and confirm" }).click();
  await expect(
    definitionOfDone.getByText("Signing in returns to the page and its query string."),
  ).toBeVisible();
  await expect(definitionOfDone.getByText("Confirmed")).toBeVisible();
  await expect(readinessLine("Definition of Done confirmed")).toHaveClass(/task-checklist-met/);
  await expect(readinessLine("Pipeline taken or declined")).not.toHaveClass(/task-checklist-met/);
  await expect(stages.getByLabel("Another Pipeline")).toContainText("Document");
  await stages.getByRole("button", { name: "Use Quick fix" }).click();
  await expect(record.getByRole("region", { name: "Stages · Quick fix" })).toBeVisible();
  await expect(record.getByText(/A small change with tests/)).toHaveCount(0);
  await expect(readinessLine("Pipeline taken or declined")).toHaveClass(/task-checklist-met/);
  await expect(markReady).toBeDisabled();

  await decision.getByRole("button", { name: "Keep the query string" }).click();
  await expect(conversation.getByText("The query string stays, as the Plan says.")).toBeVisible();
  await expect(decision.getByText("Answered")).toBeVisible();
  await expect(page.getByText("Waiting on you", { exact: true })).toHaveCount(0);
  await expect(readinessLine("No Decision waiting")).toHaveClass(/task-checklist-met/);

  await expect(markReady).toBeEnabled();
  await markReady.click();
  await expect(
    page.getByText("Sign-in returns to the page is Ready. Starting it is your call."),
  ).toBeVisible();
  await expect(
    record
      .getByRole("region", { name: "Ready", exact: true })
      .getByText("Ready: start it when you want; nothing starts by itself."),
  ).toBeVisible();

  // Start says why the Task can't start, here while Implement's person only talks; the next test
  // starts it.
  const start = page.getByRole("button", { name: "Start", exact: true });
  await expect(start).toBeEnabled();
  const taskLimit = await setDevelopersTaskLimit(page, "none");
  try {
    await page.reload();
    await expect(
      page.getByText("Adam only talks (Task limit none), so can't work Implement."),
    ).toBeVisible();
    await expect(start).toBeDisabled();
  } finally {
    await setDevelopersTaskLimit(page, taskLimit);
  }
  await page.reload();
  await expect(start).toBeEnabled();

  const idea = await page.request.post("/api/ideas", {
    data: { title: "Keep the sign-in page per tab", notes: "", projectId: project.id },
  });
  expect(idea.status()).toBe(201);
  await page.goto("/work/ideas");
  await expect(
    page
      .getByRole("article", { name: "Keep the sign-in page per tab" })
      .getByRole("button", { name: "Plan as a Task with Jan" }),
  ).toBeVisible();

  await page.goto("/people/planner/work");
  const row = page.getByRole("row", { name: /Sign-in returns to the page/ });
  await expect(row).toContainText("Planning");
  await expect(row).toContainText("Ready");

  await page.goto("/people/planner/conversations");
  await expect(page.getByText("Threads on Tasks · 1")).toBeVisible();
  await page.getByRole("link", { name: /^Planning\s*Sign-in returns to the page$/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\?taskThread=[0-9a-f-]+$/);
  await expect(
    page
      .getByRole("complementary", { name: "Conversation" })
      .getByRole("button", { name: /^Planning · Jan/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

const PAGE_QUESTION = "Which page should sign-in return to when the session expired?";

// The engine replays Implement's two sessions, the last in e2e/sessions.jsonl: the Developer opens
// a Decision with the Office tool and ends the turn, then goes on in the same session with its
// answer and ends the Stage done.
test("the user starts the planned Task and answers its Developer's Decision, which resumes the Stage", async ({
  page,
}) => {
  if (!signIn.taskUrl) throw new Error("The planning test didn't leave its Task.");
  await page.goto(signIn.taskUrl);
  await page.getByRole("button", { name: "Start", exact: true }).click();

  const stages = page.getByRole("region", { name: "Stages · Quick fix" });
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  const implement = stages
    .getByRole("listitem")
    .filter({ has: page.getByText("Implement", { exact: true }) });
  await expect(page.getByText("Waiting on you", { exact: true })).toBeVisible();
  await expect(implement).toContainText("Waiting on you");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(conversation.getByRole("button", { name: /^Implement/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const decision = conversation.getByRole("region", { name: `Decision: ${PAGE_QUESTION}` });
  await expect(decision).toBeVisible();
  // Between Stages The Office sends the Stage Thread's messages, so no follow-up is offered.
  await expect(decision.getByText(/A question first\?/)).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-waiting-on-you.png") });

  await page.goto("/work");
  const card = page
    .getByRole("region", { name: "In progress", exact: true })
    .getByRole("article", { name: "Sign-in returns to the page" });
  await expect(card.getByText("Waiting on you", { exact: true })).toBeVisible();

  // Now holds the Decision, answered in place, and the Task at its desk.
  await page.goto("/");
  const needsYou = page.getByRole("region", { name: "Needs you" });
  const onNow = needsYou.getByRole("region", { name: `Decision: ${PAGE_QUESTION}` });
  const running = page.getByRole("article", { name: "Running: Sign-in returns to the page" });
  await expect(onNow).toBeVisible();
  await expect(running).toContainText("Waiting on you");
  await expect(running).toContainText("Implement");
  await expect(running).toContainText(/in Stage$/);
  const strip = page.getByRole("status", { name: "Status strip" });
  await expect(strip).toContainText(/\d+ needs? you/);
  await expect(strip).toContainText("desks in use");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-now.png") });
  await onNow.getByRole("button", { name: "The page it started from" }).click();
  await expect(onNow).toHaveCount(0);

  await page.goto(signIn.taskUrl);
  await expect(decision.getByText("Answered")).toBeVisible();
  await expect(
    conversation.getByText("Signing in now returns to the page it started from."),
  ).toBeVisible();
  // The Stage ran again in the asking Thread, continuing its session.
  await expect(implement).toContainText("continued session");
  await expect(implement).toContainText("Done · ");
  // The Handover note is Markdown: its heading and list show as such, not as one long line.
  const handoverNote = stages.locator(".task-stage-note");
  await expect(handoverNote.getByText("Redirect", { exact: true })).toBeVisible();
  await expect(handoverNote.getByRole("listitem")).toHaveText([
    "The redirect keeps the path and the query string.",
    "next is checked against the Office's own pages.",
  ]);
  await expect(handoverNote.locator("code")).toHaveText("next");
});

const GATE_FEEDBACK = "Call the button Save, as the rest of the settings do.";
/** A 1×1 PNG. */
const A_SCREENSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Edits the Task's Stages for it before it starts, as the Stage editor saves them: Quick fix's
 * Implement and Tests, then a Gate before a Build.
 */
async function seedGatedStages(page: Page, taskId: string): Promise<void> {
  const library = pipelineListSchema.parse(await (await page.request.get("/api/pipelines")).json());
  const quickFix = library.find(({ id }) => id === "quick-fix")?.stages ?? [];
  const stages = [
    ...quickFix.filter(({ key }) => key === "implement" || key === "tests"),
    { kind: "gate", key: "ui-acceptance", name: "UI acceptance", optional: false },
    { kind: "script", key: "build", name: "Build", optional: false, command: "build" },
  ];
  const edited = await page.request.put(`/api/tasks/${taskId}/stages`, { data: { stages } });
  expect(edited.status()).toBe(200);
}

/** What the desktop channel showed, as the recording stand-in for the browser's Notification keeps it. */
interface DesktopRecord {
  readonly title: string;
  readonly body: string;
  readonly closed: boolean;
}

interface RecordingWindow {
  desktopShown: DesktopRecord[];
  tabFocused: boolean;
}

/**
 * The browser's Notification as a recording, allowed, and the tab's focus as the test sets it: a
 * headless browser shows no desktop Notifications and keeps the page focused.
 */
async function recordDesktopNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const recording = window as unknown as RecordingWindow;
    recording.desktopShown = [];
    recording.tabFocused = true;
    document.hasFocus = () => recording.tabFocused;
    class RecordedNotification extends EventTarget {
      static readonly permission = "granted";
      static requestPermission(): Promise<string> {
        return Promise.resolve("granted");
      }
      private readonly record: { title: string; body: string; closed: boolean };
      constructor(title: string, options?: { body?: string }) {
        super();
        this.record = { title, body: options?.body ?? "", closed: false };
        recording.desktopShown.push(this.record);
      }
      close(): void {
        this.record.closed = true;
        this.dispatchEvent(new Event("close"));
      }
    }
    Object.defineProperty(window, "Notification", { value: RecordedNotification });
  });
}

function desktopShown(page: Page): Promise<DesktopRecord[]> {
  return page.evaluate(() => (window as unknown as RecordingWindow).desktopShown);
}

function focusTab(page: Page, focused: boolean): Promise<void> {
  return page.evaluate((value) => {
    (window as unknown as RecordingWindow).tabFocused = value;
  }, focused);
}

/** A Task planned through the API, Ready to start; planning replays Jan's session for it. */
async function readyTask(page: Page, projectId: string, title: string): Promise<string> {
  const created = await page.request.post("/api/tasks", {
    data: { title, projectId, priority: "normal" },
  });
  const { id } = taskSchema.parse(await created.json());
  // One after another: each needs the one before it.
  const steps = [
    () => page.request.post(`/api/tasks/${id}/planning`),
    () =>
      page.request.put(`/api/tasks/${id}/plan`, {
        data: { plan: "Add a button that keeps them." },
      }),
    () =>
      page.request.put(`/api/tasks/${id}/definition-of-done`, {
        data: { definitionOfDone: ["The settings page keeps its changes."] },
      }),
    () => page.request.put(`/api/tasks/${id}/pipeline`, { data: { pipelineId: "quick-fix" } }),
    () => page.request.post(`/api/tasks/${id}/ready`),
  ];
  for (const step of steps) expect((await step()).status()).toBe(200);
  return id;
}

// The engine replays the last sessions in e2e/sessions.jsonl: Jan's planning, then Implement's two,
// the second after the Gate sent the work back.
test("a Gate holds the Task for the user, sends the work back with feedback, then continues", async ({
  page,
}) => {
  await recordDesktopNotifications(page);
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Settings", "ST", PASSING_COMMANDS);
    const taskId = await readyTask(page, project.id, "Settings keep their changes");
    await seedGatedStages(page, taskId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // The tab is focused, so the Gate's Notification comes as a toast, in Adam's words.
    const READY = "My work is ready for your look at UI acceptance.";
    await expect(page.locator(".toasts").getByText(READY)).toBeVisible();
    await expect(page).toHaveTitle(/^\(\d+\) The Office$/);
    await expect(page.locator("link[rel='icon']")).toHaveAttribute("href", /^data:image\/png/);
    expect(await desktopShown(page)).toEqual([]);

    const gate = page.getByRole("region", { name: "Gate · UI acceptance" });
    const stages = page.getByRole("region", { name: "Stages · Quick fix" });
    const implement = stages
      .getByRole("listitem")
      .filter({ has: page.getByText("Implement", { exact: true }) });
    await expect(gate).toBeVisible();
    await expect(page.getByText("Waiting on you", { exact: true })).toBeVisible();
    const results = gate.getByRole("region", { name: "Stage results" });
    await expect(results).toContainText("Implement");
    await expect(results).toContainText("Tests");
    const attachments = gate.getByRole("region", { name: "Gate attachments" });
    await expect(attachments).toContainText("None");
    // A screenshot, as Work attaches the ones an Agent lists, shows as a picture.
    const uploaded = await page.request.post(
      `/api/tasks/${taskId}/attachments/files?${new URLSearchParams({ fileName: "settings.png", mediaType: "image/png" })}`,
      { headers: { "content-type": "application/octet-stream" }, data: A_SCREENSHOT },
    );
    expect(uploaded.status()).toBe(201);
    await expect(attachments.getByRole("img", { name: "settings.png" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Files changed" })).toBeVisible();
    await expect(stages.getByText(/^Waiting on you/)).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-gate.png") });

    // The Gate waits on Now too, with its actions.
    await page.goto("/");
    const onNow = page.getByRole("article", { name: "Gate: Settings keep their changes" });
    await expect(onNow.getByRole("button", { name: "Continue to Build" })).toBeVisible();
    await expect(onNow.getByRole("link", { name: "Open Changes" })).toBeVisible();
    await page.goto(`/tasks/${taskId}`);

    await gate.getByRole("button", { name: "Send back with notes…" }).click();
    const sendBack = gate.getByRole("form", { name: "Send back" });
    const feedback = sendBack.getByLabel("Your feedback");
    // Shift+Enter breaks the line, as in every message field; Enter sends.
    await feedback.fill("Call it Save.");
    await feedback.press("Shift+Enter");
    await expect(feedback).toHaveValue("Call it Save.\n");
    await feedback.fill(GATE_FEEDBACK);
    // In the background, the next Gate's Notification goes to the desktop instead.
    await focusTab(page, false);
    await feedback.press("Enter");
    await expect(page.getByText("Sent back to Adam.")).toBeVisible();
    await expect
      .poll(() => desktopShown(page))
      .toContainEqual({
        title: "Adam",
        body: `${READY}\nSettings keep their changes · Settings`,
        closed: false,
      });
    await focusTab(page, true);

    // Implement ran again in a fresh session, briefed with the feedback, using no round.
    const conversation = page.getByRole("complementary", { name: "Conversation" });
    await expect(conversation.getByRole("button", { name: /^Implement/ })).toHaveCount(2);
    await expect(gate).toBeVisible();
    await expect(implement).toContainText("Done · ");
    await expect(implement).not.toContainText("round");
    // The Thread shows the Brief, not the Stage's work, which the run was briefed from.
    const own = taskStagesSchema.parse(
      await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
    );
    const implementRuns = own.stages?.find(({ stage }) => stage.key === "implement")?.runs;
    expect(
      implementRuns?.map(({ sentBack, carriedFailure }) => [sentBack, carriedFailure]),
    ).toEqual([
      [null, null],
      [{ gateKey: "ui-acceptance", feedback: GATE_FEEDBACK }, null],
    ]);

    // Edit for this Task while it runs: the started Stages are locked, Build after them changes,
    // and the library's Quick fix stays as it is.
    const library = await (await page.request.get("/api/pipelines")).json();
    await stages.getByRole("button", { name: "Edit for this Task" }).click();
    for (const name of ["Implement", "Tests", "UI acceptance"]) {
      await expect(editorRow(page, name)).toContainText("started, so it can't be changed");
      await expect(editorRow(page, name).getByRole("button", { name: `Edit ${name}` })).toHaveCount(
        0,
      );
    }
    const build = editorRow(page, "Build");
    await expect(build.getByRole("button", { name: "Move Build up" })).toBeDisabled();
    await build.getByRole("button", { name: "Edit Build" }).click();
    await build.getByLabel("Project command").selectOption("lint");
    await page.getByRole("dialog").getByRole("button", { name: "Save for this Task" }).click();
    await expect(page.getByText("Stages saved for Settings keep their changes.")).toBeVisible();
    expect(await (await page.request.get("/api/pipelines")).json()).toEqual(library);

    // Continue from the Needs you panel, over the Projects page.
    await page.goto("/projects");
    await page
      .getByRole("status", { name: "Status strip" })
      .getByRole("button", { name: /needs? you/ })
      .click();
    const panel = page.getByRole("dialog").filter({ hasText: "Needs you" });
    const waiting = panel.getByRole("article", { name: "Gate: Settings keep their changes" });
    await expect(waiting.getByRole("button", { name: "Continue to Build" })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-needs-you-panel.png"),
      animations: "disabled",
    });
    await waiting.getByRole("button", { name: "Continue to Build" }).click();
    await expect(page.getByText("Continuing to Build.")).toBeVisible();
    await expect(waiting).toHaveCount(0);
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
    // Acting at the Gate cleared its Notification on the desktop too.
    expect((await desktopShown(page)).every(({ closed }) => closed)).toBe(true);

    // Done comes as a toast over the Projects page, and opens the Task, which handles it.
    const done = page.locator(".toasts").getByRole("button", { name: /I finished the Task\./ });
    await expect(done).toContainText("Settings keep their changes · Settings");
    const unreadBefore = Number(/^\((\d+)\)/.exec(await page.title())?.[1] ?? 0);
    await done.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await expect
      .poll(async () => Number(/^\((\d+)\)/.exec(await page.title())?.[1] ?? 0))
      .toBeLessThan(unreadBefore);
    await expect(gate).toHaveCount(0);
    const acceptance = stages
      .getByRole("listitem")
      .filter({ has: page.getByText("UI acceptance", { exact: true }) });
    await expect(acceptance).toContainText("continued");
    await expect(page.locator(".task-head-meta").getByText("Done", { exact: true })).toBeVisible();
    // Publish removed the worktree, so its conversations are read-only, with the reason.
    const finishedConversation = page.getByRole("complementary", { name: "Conversation" });
    await expect(finishedConversation.getByRole("note")).toContainText(
      "This Task is Done and its working copy has been removed",
    );
    await expect(finishedConversation.getByRole("textbox", { name: "Message" })).toHaveCount(0);

    // Now lists it Done since the user left, and the strip counts it.
    await page.goto("/");
    await expect(
      page.getByRole("article", { name: "Done: Settings keep their changes" }),
    ).toBeVisible();
    await expect(page.getByRole("status", { name: "Status strip" })).toContainText(
      "done since you left",
    );
  } finally {
    await repository.remove();
  }
});

const CONSULTATION_QUESTION = "Is the migration safe to run on the live data?";

/**
 * Puts to Adam, the Developer, the Decision Jan asked on the Task, and opens the Consultation he
 * answers it in with a first note, as the Consultations service leaves them: a Consultation starts
 * when an Agent's session consults, and no screen can make one.
 */
async function seedConsultation(taskId: string, plannerThreadId: string): Promise<string> {
  const decisionId = crypto.randomUUID();
  const consultationId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, question, context, options, recommendation, asked_at, put_to)
     values ($1, $2, $3, 'planner', $4, 'The migration rewrites every row.', '["Yes", "No"]', '{"option":0,"reason":"It ran on the copy."}', now(), 'developer')`,
    [decisionId, plannerThreadId, taskId, CONSULTATION_QUESTION],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [crypto.randomUUID(), plannerThreadId, { kind: "decision", roleKey: "planner", decisionId }],
  );
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at, consultation)
     values ($1, 'task', $2, 'developer', 'Consultation · Jan and Adam', 'waiting', $3, now(), $4)`,
    [
      consultationId,
      taskId,
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      { decisionId, askerThreadId: plannerThreadId, askerRoleKey: "planner" },
    ],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [
      crypto.randomUUID(),
      consultationId,
      { kind: "person", roleKey: "developer", text: "I read the migration: it is reversible." },
    ],
  );
  return decisionId;
}

// The engine replays the last two sessions in e2e/sessions.jsonl: Jan's planning, then Adam's reply
// once the user joins the Consultation.
test("the user reads a Consultation on the Task, sees its Decision wait on the Consultant, and joins it", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Consulted", "CO", PASSING_COMMANDS);
    const taskId = await readyTask(page, project.id, "Migration waits on Adam");
    const [planning] = threadListSchema.parse(
      await (await page.request.get(`/api/tasks/${taskId}/threads`)).json(),
    );
    if (!planning) throw new Error("Planning opened no Thread.");
    const decisionId = await seedConsultation(taskId, planning.id);

    await page.goto(`/tasks/${taskId}`);
    const conversation = page.getByRole("complementary", { name: "Conversation" });
    await conversation.getByRole("button", { name: /^Planning/ }).click();
    // The Decision waits on Adam, not on the user: no count on the Thread, and nothing in Needs you.
    const decision = conversation.getByRole("region", {
      name: `Decision: ${CONSULTATION_QUESTION}`,
    });
    await expect(decision).toContainText("Waiting on Adam in a Consultation");
    await expect(conversation.getByText("Decision waiting on you")).toHaveCount(0);
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: `Decision: ${CONSULTATION_QUESTION}` }),
    ).toHaveCount(0);

    await page.goto(`/tasks/${taskId}`);
    await conversation.getByRole("button", { name: /^Consultation · Jan and Adam/ }).click();
    await expect(conversation.getByRole("note")).toContainText("Jan waits on this answer");
    await expect(conversation.getByText("I read the migration: it is reversible.")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-consultation.png") });

    // Joining: the user writes in the Consultation, and Adam answers them there.
    await conversation.getByLabel("Message").fill("Is the rollback tested?");
    await conversation.getByLabel("Message").press("Enter");
    await expect(conversation.getByText("Yes: the rollback runs in the tests.")).toBeVisible();

    // The Decision's link, as Copy link gives it, opens the Task at its card, marked.
    await page.goto(recordPath({ kind: "decision", taskId, threadId: planning.id, decisionId }));
    await expect(
      conversation.getByRole("region", { name: `Decision: ${CONSULTATION_QUESTION}` }),
    ).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-decision-link.png") });
  } finally {
    await repository.remove();
  }
});

// The engine replays the last session in e2e/sessions.jsonl: Jan's answer in a new chat Thread.
test("the user mentions a Task with @ in a chat, and the person is briefed with its record", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Mentioned", "MN");
    const created = await page.request.post("/api/tasks", {
      data: { title: "Export the invoices as CSV", projectId: project.id, priority: "normal" },
    });
    expect(created.status()).toBe(201);
    const task = taskSchema.parse(await created.json());

    await page.goto("/people?chat=planner");
    const chat = chatWith(page, "Jan");
    const starting = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/chats/planner/threads"),
    );
    await chat.getByRole("button", { name: "New thread" }).first().click();
    const { id: threadId } = threadSchema.parse(await (await starting).json());
    // Typed only once the new Thread shows: its composer starts with an empty draft.
    await expect(page).toHaveURL(new RegExp(`thread=${threadId}`));
    const message = chat.getByLabel("Message");
    await message.fill("Is ");
    await message.pressSequentially("@invoices");
    await expect(chat.getByRole("option", { name: /Export the invoices as CSV/ })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-mention-picker.png") });
    await message.press("Enter");
    await expect(message).toHaveValue("Is @Export the invoices as CSV ");
    await message.pressSequentially("done?");
    await message.press("Enter");

    await expect(
      chat.getByText("I read the Task: it has no Plan yet, so nothing is done."),
    ).toBeVisible();
    await expect(
      chat.getByRole("heading", { name: "Is @Export the invoices as CSV…" }),
    ).toBeVisible();
    // The session started with the Task's record in its Brief.
    await chat.locator("summary", { hasText: "Brief" }).click();
    await expect(chat.getByText("Records the user mentioned")).toBeVisible();
    await expect(chat.getByText(`Export the invoices as CSV (Task ${task.id})`)).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-mention.png") });

    await chat.getByRole("link", { name: "Export the invoices as CSV" }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  } finally {
    await repository.remove();
  }
});

/**
 * A Proposal Marta, the Office Manager, drafted in her chat, as the Conversations service leaves
 * one: only an Agent's session drafts a Proposal, and no screen can make one. `change` is in the
 * service's own shape, where a new Role's skills sit beside its card.
 */
async function seedProposal(threadId: string, change: Record<string, unknown>): Promise<void> {
  const proposalId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into proposals (id, thread_id, drafted_by, drafted_at, change, status)
     values ($1, $2, 'office-manager', now(), $3, 'open')`,
    [proposalId, threadId, change],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [crypto.randomUUID(), threadId, { kind: "proposal", roleKey: "office-manager", proposalId }],
  );
}

/** A new Role on the Developer's card under another title: a preset's title can't be proposed. */
async function proposedHire(page: Page, name: string, title: string) {
  const { card } = roleSchema.parse(await (await page.request.get("/api/roles/developer")).json());
  return {
    kind: "hire",
    card: roleCardSchema.omit({ skills: true }).parse({ ...card, name, title }),
    skills: [],
  };
}

/** A capability's value as the Role card's words give it. */
function onOrOff(on: boolean): string {
  return on ? "on" : "off";
}

function proposalCard(page: Page, title: string) {
  return chatWith(page, "Marta").getByRole("region", { name: `Proposal: ${title}` });
}

test("the user hires from Marta's Proposals, as drafted and edited first, applies a change and declines one", async ({
  page,
}) => {
  const started = await page.request.post("/api/chats/office-manager/threads");
  expect(started.status()).toBe(201);
  const { id: threadId } = threadSchema.parse(await started.json());
  const { card: reviewer } = roleSchema.parse(
    await (await page.request.get("/api/roles/reviewer")).json(),
  );
  const consultantNow = { ...reviewer.capabilities, consultant: !reviewer.capabilities.consultant };
  await seedProposal(threadId, await proposedHire(page, "Teo", "Translator"));
  await seedProposal(threadId, await proposedHire(page, "Ida", "Designer"));
  await seedProposal(threadId, {
    kind: "change",
    roleKey: "reviewer",
    from: { capabilities: reviewer.capabilities },
    to: { capabilities: consultantNow },
  });
  await seedProposal(threadId, {
    kind: "change",
    roleKey: "reviewer",
    from: { effort: reviewer.effort },
    to: { effort: reviewer.effort === "low" ? "medium" : "low" },
  });
  const consultantLine = `Consultant ${onOrOff(reviewer.capabilities.consultant)} → ${onOrOff(consultantNow.consultant)}`;

  await page.goto(`/people?chat=office-manager&thread=${threadId}`);
  const chat = chatWith(page, "Marta");
  // The card shows the call, so its tool line doesn't.
  await expect(chat.getByText("propose_role")).toHaveCount(0);

  // As drafted.
  const translator = proposalCard(page, "New Role · Teo · Translator");
  await expect(translator).toContainText("Permission profile");
  await translator.getByRole("button", { name: "Hire Teo" }).click();
  await expect(page.getByText("Teo · Translator hired.")).toBeVisible();
  await expect(translator).toContainText("Hired");
  await expect(translator).toContainText("by you");
  await expect(translator.getByRole("link", { name: "Open Teo's page" })).toBeVisible();

  // A change, applied from the next session.
  const changes = chat.getByRole("region", { name: "Proposal: Change Ola · Reviewer" });
  const change = changes.filter({ hasText: "Consultant" });
  await expect(change.getByRole("listitem")).toHaveText(
    `Consultant${onOrOff(reviewer.capabilities.consultant)}${onOrOff(consultantNow.consultant)}`,
  );
  await expect(change).toContainText("Applies at Ola's next session start");
  await change.getByRole("button", { name: "Apply change" }).click();
  await expect(change).toContainText("Applied");
  await expect(change).toContainText("Ola works with it from the next session");

  // "Not now": nothing changes.
  const effort = changes.filter({ hasText: "Effort" });
  await effort.getByRole("button", { name: "Not now" }).click();
  await expect(effort).toContainText("Not applied");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-proposals.png") });

  // Edited before hiring, on the hire page.
  const designer = proposalCard(page, "New Role · Ida · Designer");
  await designer.getByRole("button", { name: "Edit before hiring" }).click();
  await expect(page).toHaveURL(/\/hire\?proposal=/);
  await expect(page.getByText("Edit the proposed Role")).toBeVisible();
  const form = page.locator("form.role-card-form");
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Designer");
  await form.getByLabel("Name", { exact: true }).fill("Iga");
  await page.getByRole("button", { name: "Hire Iga" }).click();
  await expect(page.getByRole("heading", { name: "Iga · Designer" })).toBeVisible();
  await expect(page).toHaveURL(/\/people\/designer$/);

  await page.getByRole("tab", { name: "Role card" }).click();
  await expect(page.getByText("proposed by Marta, applied by you")).toBeVisible();
  await page.goto("/people/reviewer/role");
  await expect(
    page.getByText(`${consultantLine} · proposed by Marta, applied by you`),
  ).toBeVisible();
  // The declined change saved no version of its own.
  await expect(page.getByText(/Effort .* proposed by Marta/)).toHaveCount(0);

  await page.goto(`/people?chat=office-manager&thread=${threadId}`);
  await expect(proposalCard(page, "New Role · Iga · Designer")).toContainText("Hired");
});
