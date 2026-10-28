import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ideaSchema,
  OPEN_DECISION_TOOL,
  pipelineListSchema,
  pipelineSchema,
  projectSchema,
  recordPath,
  roleCardSchema,
  roleSchema,
  sizeThresholdSchema,
  SIZE_THRESHOLD_TOKENS,
  taskSchema,
  taskStagesSchema,
  threadListSchema,
  threadSchema,
  type NewProject,
  type Project,
  type Stage,
  type TaskLimit,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { createSkillSource } from "./skill-source.ts";
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

test("the user hires the Planner, a Developer, a Reviewer, the CTO and the Office Manager from the presets", async ({
  page,
}) => {
  await hireFromPreset(page, "Planner", "Jan");
  await expect(page).toHaveURL(/\/people\/planner$/);
  await hireFromPreset(page, "Developer", "Ada");
  await hireFromPreset(page, "Reviewer", "Ola");
  await hireFromPreset(page, "CTO", "Bob");
  await hireFromPreset(page, "Office Manager", "Marta");

  await page.goto("/people");
  await expect(page.getByText("5 people")).toBeVisible();
  for (const name of ["Jan", "Ada", "Ola", "Bob", "Marta"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
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

  // The CTO works Stages too, and publishes outside the Pipeline only when the user says so.
  await page.goto("/people/cto/role");
  await expect(roleCardGroup(page, "Work")).toContainText("2 at once");
  await expect(roleCardGroup(page, "Permissions")).toContainText(
    "Publish outside the PipelineAsk me",
  );
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
  await page.goto("/people/devops");
  await expect(page.getByRole("link", { name: "Back to People" })).toBeVisible();
});

test("with nobody in Devops' Role, installing a skill from a source says it needs one", async ({
  page,
}) => {
  await page.goto("/settings/skills");
  await page.getByRole("button", { name: "Add a skill" }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog).toContainText("Installing needs someone with the Devops Role");
  await expect(dialog.getByRole("link", { name: "Hire one on the People page." })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /to install it$/ })).toHaveCount(0);
});

// Hired after the tests above, which read the Developer's switch that consults Devops asking the
// user while nobody fills the Role.
test("the user hires Devops from the preset, who installs alone and consults the CTO before publishing outside the Pipeline", async ({
  page,
}) => {
  await hireFromPreset(page, "Devops", "Nina");
  await expect(page).toHaveURL(/\/people\/devops$/);

  await page.goto("/people/devops/role");
  await expect(roleCardGroup(page, "Work")).toContainText("2 at once");
  const capabilities = roleCardGroup(page, "Capabilities").getByRole("listitem");
  for (const capability of ["Shared memory", "Chat", "Consultant"]) {
    await expect(capabilities.filter({ hasText: capability })).toHaveClass("on");
  }
  const permissions = roleCardGroup(page, "Permissions");
  await expect(permissions).toContainText("Run installsAllowed");
  await expect(permissions).toContainText("Publish outside the PipelineConsult CTO");
  await expect(permissions).toContainText("Change RolesNever");
  // Bob fills the CTO's Role, so the consult goes to him rather than the user.
  await expect(permissions).not.toContainText("Asks you until someone is hired");

  // Every preset is filled, so only hiring from scratch is left.
  await page.goto("/people");
  await expect(page.getByRole("button", { name: "Hire a Role" })).toHaveCount(0);
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

test("a person's Work tab lists the Tasks whose Stages they work, in the Projects the filter shows", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "People work", "PW");
    const elsewhere = await addedProject(page, repository, "People elsewhere", "PE");
    for (const [title, projectId] of [
      ["Fix the login redirect", project.id],
      ["Fix the signup redirect", elsewhere.id],
    ]) {
      const created = await page.request.post("/api/tasks", {
        data: { title, projectId, priority: "normal" },
      });
      expect(created.status()).toBe(201);
    }

    await page.goto("/people/developer");
    await page.getByRole("tab", { name: "Work" }).click();

    await expect(page).toHaveURL(/\/people\/developer\/work$/);
    const row = page.getByRole("row", { name: /Fix the login redirect/ });
    const elsewhereRow = page.getByRole("row", { name: /Fix the signup redirect/ });
    await expect(row).toContainText("Implement · Review & fix");
    await expect(row).toContainText("Backlog");
    await expect(elsewhereRow).toBeVisible();

    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: "Show only People work" }).click();
    await expect(row).toBeVisible();
    await expect(elsewhereRow).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^All 1$/ })).toBeVisible();
    await page.getByRole("button", { name: /in other Projects.*Show all projects/ }).click();
    await expect(elsewhereRow).toBeVisible();

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
  await waitForAnotherTaskAndStopWaiting(page, project);

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

/**
 * On the Ready Task's page: it waits for a Backlog Task, so Start says why it can't start and the
 * board and the other Task show the dependency; it stops waiting, and Start is open again.
 */
async function waitForAnotherTaskAndStopWaiting(page: Page, project: Project): Promise<void> {
  const blockerTitle = "Session expiry is detected";
  const created = await page.request.post("/api/tasks", {
    data: { title: blockerTitle, projectId: project.id, priority: "normal" },
  });
  expect(created.status()).toBe(201);
  const blocker = taskSchema.parse(await created.json());
  const taskUrl = page.url();
  const start = page.getByRole("button", { name: "Start", exact: true });
  const dependencies = page
    .getByRole("region", { name: "Record" })
    .getByRole("region", { name: "Dependencies" });

  await dependencies.getByRole("button", { name: "Add", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("What must be Done first?")).toBeVisible();
  await dialog.getByRole("textbox", { name: "Find a Task" }).fill("expiry");
  await dialog.getByText(blockerTitle).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    dependencies
      .getByRole("region", { name: "Must be Done first" })
      .getByRole("link", { name: blockerTitle }),
  ).toBeVisible();
  await expect(
    page.getByText(`Blocked by "${blockerTitle}", which must be Done first.`),
  ).toBeVisible();
  await expect(start).toBeDisabled();

  await page.goto("/work");
  await expect(
    page
      .getByRole("region", { name: "Ready", exact: true })
      .getByRole("article", { name: "Sign-in returns to the page" })
      .getByText(`Blocked by ${blockerTitle}`),
  ).toBeVisible();
  await page.goto(`/tasks/${blocker.id}`);
  await expect(
    dependencies
      .getByRole("region", { name: "Waiting for this Task" })
      .getByRole("link", { name: "Sign-in returns to the page" }),
  ).toBeVisible();

  await page.goto(taskUrl);
  await dependencies.getByRole("button", { name: `Stop waiting for ${blockerTitle}` }).click();
  await expect(dependencies.getByRole("region", { name: "Must be Done first" })).toHaveCount(0);
  await expect(start).toBeEnabled();
  expect((await page.request.post(`/api/tasks/${blocker.id}/drop`)).status()).toBe(200);
}

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

  // Publish fails, as the repository has no remote: The Office asks Bob, the CTO, first, who passes
  // it on to the user. Waiting for that keeps the next test's sessions after Bob's.
  await expect
    .poll(async () => {
      const open = await page.request.get("/api/decisions/open");
      return JSON.stringify(await open.json());
    })
    .toContain('\\"Publish\\" failed, with no round to go back to.');
  await conversation.getByRole("button", { name: /^Consultation · The Office and Bob/ }).click();
  await expect(
    conversation
      .getByRole("note")
      .filter({ hasText: "The Office asks first here; the Task's Pipeline waits on this answer." }),
  ).toBeVisible();
  await expect(
    conversation.getByText("I passed it on to the user: the remote is theirs to set up."),
  ).toBeVisible();
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
 * A Proposal Marta, the Office Manager, drafted in her chat (or the person `draftedBy` names, by
 * Role key, in theirs), as the Conversations service leaves one: only an Agent's session drafts a
 * Proposal, and no screen can make one. `change` is in the service's own shape, where a new Role's
 * skills sit beside its card.
 */
async function seedProposal(
  threadId: string,
  change: Record<string, unknown>,
  draftedBy = "office-manager",
): Promise<string> {
  const proposalId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into proposals (id, thread_id, drafted_by, drafted_at, change, status)
     values ($1, $2, $3, now(), $4, 'open')`,
    [proposalId, threadId, draftedBy, change],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [crypto.randomUUID(), threadId, { kind: "proposal", roleKey: draftedBy, proposalId }],
  );
  return proposalId;
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

test("the user hires into a preset's Role from Marta's Proposal under another name, and applies a new size threshold", async ({
  page,
}) => {
  const started = await page.request.post("/api/chats/office-manager/threads");
  const { id: threadId } = threadSchema.parse(await started.json());
  const readThreshold = async () =>
    sizeThresholdSchema.parse(await (await page.request.get("/api/settings/size-threshold")).json())
      .sizeThreshold;
  const threshold = await readThreshold();
  const proposed =
    threshold < SIZE_THRESHOLD_TOKENS.max
      ? threshold + SIZE_THRESHOLD_TOKENS.step
      : threshold - SIZE_THRESHOLD_TOKENS.step;
  // Every preset's Role is filled by now, so hiring into one is refused, and shown on the card.
  await seedProposal(threadId, { kind: "hire-from-preset", roleKey: "developer", name: "Grace" });
  await seedProposal(threadId, { kind: "size-threshold", from: threshold, to: proposed });

  try {
    await page.goto(`/people?chat=office-manager&thread=${threadId}`);

    const preset = proposalCard(page, "New Role · Grace · Developer");
    await expect(preset).toContainText("Permission profile");
    await preset.getByRole("button", { name: "Edit before hiring" }).click();
    await preset.getByLabel("Name", { exact: true }).fill("Hedy");
    await preset.getByRole("button", { name: "Hire Hedy" }).click();
    // An earlier test renamed the Developer's person and title.
    await expect(preset).toContainText("Hedy can't be hired yet");
    await expect(preset).toContainText("already fills the");
    await preset.getByRole("button", { name: "Not now" }).click();
    await expect(preset).toContainText("Not hired");

    const sizeThreshold = proposalCard(page, "Change the size threshold");
    await expect(sizeThreshold.getByRole("listitem")).toContainText("Size threshold");
    await expect(sizeThreshold).toContainText("Applies from each Thread's next message");
    await sizeThreshold.getByRole("button", { name: "Apply change" }).click();
    await expect(sizeThreshold).toContainText("Applied");
    expect(await readThreshold()).toBe(proposed);
  } finally {
    await page.request.put("/api/settings/size-threshold", { data: { sizeThreshold: threshold } });
  }
});

test("the user asks Nina from a Project's Commands and a library Pipeline, and applies her Proposals; a stale one is refused", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const stamp = Date.now();
    const project = await addedProject(page, repository, `Proposed ${stamp}`, "PR");
    const quickFix = pipelineSchema.parse(
      await (await page.request.get("/api/pipelines/quick-fix")).json(),
    );
    const pipeline = pipelineSchema.parse(
      await (
        await page.request.post("/api/pipelines", {
          data: { name: `Nightly ${stamp}`, description: "", stages: quickFix.stages },
        })
      ).json(),
    );
    const nina = chatWith(page, "Nina");

    // Asked from the Commands or the Pipeline, Nina's chat opens on a new Thread with the question.
    await page.goto(`/projects/${project.id}`);
    await page.getByRole("button", { name: "Ask Nina to propose a change" }).click();
    await expect(nina.getByLabel("Message")).toHaveValue(
      `Can you propose a change to the commands of ${project.name}? `,
    );
    await page.goto(`/settings/pipelines/${pipeline.id}`);
    await page.getByRole("button", { name: "Ask Nina", exact: true }).click();
    await expect(nina.getByLabel("Message")).toHaveValue(
      `Can you propose a change to the ${pipeline.name} Pipeline? `,
    );
    const threadId = new URL(page.url()).searchParams.get("thread") ?? "";

    const lint: Stage = {
      kind: "script",
      key: "lint",
      name: "Lint",
      optional: false,
      command: "lint",
    };
    const proposedStages = [...pipeline.stages.slice(0, -1), lint, ...pipeline.stages.slice(-1)];
    await seedProposal(
      threadId,
      {
        kind: "project-commands",
        projectId: project.id,
        from: { test: "npm test", installInputs: [] },
        to: { test: "npm run test:all", installInputs: ["package-lock.json"] },
      },
      "devops",
    );
    await seedProposal(
      threadId,
      { kind: "pipeline", pipelineId: pipeline.id, from: pipeline.stages, to: proposedStages },
      "devops",
    );
    // Drafted from a build command the user has changed since.
    await seedProposal(
      threadId,
      {
        kind: "project-commands",
        projectId: project.id,
        from: { build: "make" },
        to: { build: "make all" },
      },
      "devops",
    );
    await page.goto(`/projects/${project.id}?chat=devops&thread=${threadId}`);

    const commandCards = nina.getByRole("region", {
      name: `Proposal: Change ${project.name}'s commands`,
    });
    const commands = commandCards.filter({ hasText: "npm run test:all" });
    await expect(commands.getByRole("listitem")).toHaveText([
      "Test commandnpm testnpm run test:all",
      "Install inputsNonepackage-lock.json",
    ]);
    await commands.getByRole("button", { name: "Apply change" }).click();
    await expect(commands).toContainText("Applied");
    await expect(page.getByText(`${project.name}'s commands changed.`)).toBeVisible();
    const applied = projectSchema.parse(
      await (await page.request.get(`/api/projects/${project.id}`)).json(),
    );
    expect(applied.commands.test).toBe("npm run test:all");
    expect(applied.installInputs).toEqual(["package-lock.json"]);

    const stages = nina.getByRole("region", {
      name: `Proposal: Change the ${pipeline.name} Pipeline`,
    });
    await expect(stages.getByRole("listitem")).toHaveText(
      "StagesImplement → Tests → PublishImplement → Tests → Lint → Publish",
    );
    await expect(stages).toContainText("AddedLint");
    await stages.getByRole("button", { name: "Apply change" }).click();
    await expect(stages).toContainText("Applied");
    const saved = pipelineSchema.parse(
      await (await page.request.get(`/api/pipelines/${pipeline.id}`)).json(),
    );
    expect(saved.stages.map(({ key }) => key)).toEqual(proposedStages.map(({ key }) => key));
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-devops-proposals.png") });

    const stale = commandCards.filter({ hasText: "make all" });
    await stale.getByRole("button", { name: "Apply change" }).click();
    await expect(stale).toContainText("The change can't be applied yet");
    await expect(stale).toContainText("The build command changed since this was proposed.");
    await expect(stale.getByRole("button", { name: "Apply change" })).toBeVisible();
  } finally {
    await repository.remove();
  }
});

test("the user asks Nina to onboard a Project, applies her Proposal and finds its Onboard Task Ready", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const name = `Onboarded ${Date.now()}`;
    const nina = chatWith(page, "Nina");

    await page.goto("/projects");
    await page.getByRole("button", { name: "Ask Nina to onboard one" }).click();
    await expect(nina.getByLabel("Message")).toHaveValue(
      "Can you onboard a new Project? The repository is ",
    );
    const threadId = new URL(page.url()).searchParams.get("thread") ?? "";
    await seedProposal(
      threadId,
      {
        kind: "project",
        project: {
          name,
          path: repository.path,
          baseBranch: "main",
          mark: { label: "ON", colour: "teal" },
          commands: PASSING_COMMANDS,
          installInputs: [],
          publishingMode: "push-and-pull-request",
          defaultPipeline: "quick-fix",
        },
        projectId: null,
        taskId: null,
      },
      "devops",
    );
    await page.goto(`/projects?chat=devops&thread=${threadId}`);

    const card = nina.getByRole("region", { name: `Proposal: Onboard ${name}` });
    await expect(card).toContainText(repository.path);
    await card.getByRole("button", { name: "Apply change" }).click();
    await expect(card).toContainText("Applied");
    await expect(
      page.getByText(`${name} added, with its Onboard Task Ready to start.`),
    ).toBeVisible();
    const projectCard = page.locator(".project-card", { hasText: name });
    await expect(projectCard).toContainText("Onboarding");

    await card.getByRole("link", { name: `Open ${name}` }).click();
    // The Onboarding block, from the Onboard Task.
    const onboarding = page.locator(".project-block-note", { hasText: "From the Task" });
    await expect(onboarding).toHaveText("From the Task Onboard · Ready, waiting for your Start");
    await expect(page.locator(".project-head")).toContainText("Onboarding");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-onboarding.png") });

    await onboarding.getByRole("link", { name: "Onboard" }).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+/);
    await expect(page.locator(".task-page")).toContainText("Ready");
    await expect(page.locator(".task-page")).toContainText("Onboard");
  } finally {
    await repository.remove();
  }
});

test("the user asks Nina to install a skill from a source, applies her Proposal and reviews the skill, off until then", async ({
  page,
}) => {
  const name = `installed-notes-${Date.now()}`;
  const description = "Writes release notes from a source.";
  const source = await createSkillSource(name, description);
  try {
    const nina = chatWith(page, "Nina");
    const sourceText = `${source.url} · ${source.folder}`;

    await page.goto("/settings/skills");
    await page.getByRole("button", { name: "Add a skill" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Source").fill(source.url);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skills-install.png") });
    await dialog.getByRole("button", { name: "Ask Nina to install it" }).click();
    await expect(nina.getByLabel("Message")).toHaveValue(
      `Can you install the skills from ${source.url}?`,
    );
    const threadId = new URL(page.url()).searchParams.get("thread") ?? "";
    await seedProposal(
      threadId,
      {
        kind: "skill-install",
        repository: source.url,
        folder: source.folder,
        pinnedVersion: { tag: source.tag, commit: source.commit },
        name,
        description,
        files: Object.keys(source.files),
        filesHash: source.filesHash,
      },
      "devops",
    );
    await page.goto(`/settings/skills?chat=devops&thread=${threadId}`);

    const card = nina.getByRole("region", { name: `Proposal: Install ${name}` });
    await expect(card).toContainText(sourceText);
    await expect(card).toContainText(source.tag);
    await expect(card).toContainText("template.md");
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-skill-install-proposal.png"),
    });
    await card.getByRole("button", { name: "Apply change" }).click();
    await expect(card).toContainText("Applied");
    await expect(page.getByText(`${name} installed. It is off until you review it.`)).toBeVisible();

    await page.goto("/settings/skills");
    const skillRow = page.getByRole("row").filter({ hasText: name });
    await expect(skillRow).toContainText(`Installed from ${sourceText}`);
    await expect(skillRow).toContainText(`v1 · pinned at ${source.tag}`);
    await expect(skillRow).toContainText("Off · waiting for your review");
    await skillRow.getByRole("button", { name: "Review" }).click();
    const review = page.getByRole("dialog");
    await expect(review).toContainText(
      `Installed from ${sourceText} · v1 · pinned at ${source.tag}`,
    );
    await expect(review).toContainText("template.md");
    // An installed skill changes by an update Proposal, not by hand.
    await expect(review.getByRole("button", { name: "Upload a new version" })).toHaveCount(0);
    await expect(review.getByRole("button", { name: "Edit" })).toHaveCount(0);
  } finally {
    await source.remove();
  }
});

test("the user sees a skill's update, asks Nina, reads her Proposal's diff and applies it; the skill stays on", async ({
  page,
}) => {
  const name = `updated-notes-${Date.now()}`;
  const description = "Writes release notes from a source.";
  const source = await createSkillSource(name, description);
  try {
    const nina = chatWith(page, "Nina");
    const installed = await page.request.post("/api/chats/devops/threads", { data: {} });
    const installThread = threadSchema.parse(await installed.json()).id;
    const install = await seedProposal(
      installThread,
      {
        kind: "skill-install",
        repository: source.url,
        folder: source.folder,
        pinnedVersion: { tag: source.tag, commit: source.commit },
        name,
        description,
        files: Object.keys(source.files),
        filesHash: source.filesHash,
      },
      "devops",
    );
    expect((await page.request.post(`/api/proposals/${install}/apply`, { data: {} })).ok()).toBe(
      true,
    );
    const turnedOn = await page.request.put(`/api/skills/${name}/state`, { data: { state: "on" } });
    expect(turnedOn.ok()).toBe(true);
    const release = await source.release("v1.1.0", {
      "SKILL.md": `---\ndescription: ${description}\n---\nGroup them as Added, Changed, Fixed and Removed.\n`,
    });

    await page.goto("/settings/skills");
    const skillRow = page.getByRole("row").filter({ hasText: name });
    // The end-to-end service's daily check runs every two seconds.
    await expect(skillRow).toContainText("→ v1.1.0", { timeout: 15_000 });
    await expect(page.getByText(/pinned skills? ha(s|ve) an update available/)).toBeVisible();
    await skillRow.getByRole("button", { name: "Review the update" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Version v1.0.0");
    await dialog.getByRole("button", { name: "Ask Nina to propose it" }).click();
    await expect(nina.getByLabel("Message")).toHaveValue(
      `Can you propose the update of ${name} to v1.1.0?`,
    );
    const threadId = new URL(page.url()).searchParams.get("thread") ?? "";
    await seedProposal(
      threadId,
      {
        kind: "skill-update",
        name,
        repository: source.url,
        folder: source.folder,
        from: { tag: source.tag, commit: source.commit },
        to: { tag: release.tag, commit: release.commit },
        notes: "Adds a Removed section.",
        files: Object.keys(release.files),
        filesHash: release.filesHash,
      },
      "devops",
    );
    await page.goto(`/settings/skills?chat=devops&thread=${threadId}`);

    const card = nina.getByRole("region", { name: `Proposal: Update ${name}` });
    await expect(card).toContainText("Adds a Removed section.");
    await expect(card.getByLabel("Changes from v1.0.0 to v1.1.0")).toContainText(
      "+Group them as Added, Changed, Fixed and Removed.",
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skill-update-proposal.png") });

    await page.goto("/settings/skills");
    await skillRow.getByRole("button", { name: "Review the update" }).click();
    await expect(dialog).toContainText("Adds a Removed section.");
    await expect(dialog.getByLabel("Changes from v1.0.0 to v1.1.0")).toContainText(
      "-Group them as Added, Changed and Fixed.",
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skill-update-review.png") });
    await dialog.getByRole("button", { name: "Apply the update" }).click();
    await expect(page.getByText(`${name} pinned at v1.1.0.`)).toBeVisible();
    await expect(skillRow).toContainText("v2 · pinned at v1.1.0");
    await expect(skillRow).not.toContainText("→");
    await expect(skillRow).toContainText("On");
  } finally {
    await source.remove();
  }
});

/**
 * A Link card Marta posted in her chat, as the Conversations service leaves one: only an Agent's
 * session posts one. `to` is the person's Role key.
 */
test("the user applies a skill Jan drafted in his chat, and reviews it, off until then", async ({
  page,
}) => {
  const name = `drafted-notes-${Date.now()}`;
  const started = await page.request.post("/api/chats/planner/threads");
  expect(started.status()).toBe(201);
  const { id: threadId } = threadSchema.parse(await started.json());
  await seedProposal(
    threadId,
    {
      kind: "skill",
      name,
      description: "Writes a Plan's risks.",
      instructions: "List each risk with what would show it early.",
    },
    "planner",
  );

  await page.goto(`/settings/skills?chat=planner&thread=${threadId}`);
  const chat = chatWith(page, "Jan");
  // The card shows the call, so its tool line doesn't.
  await expect(chat.getByText("propose_skill")).toHaveCount(0);
  const card = chat.getByRole("region", { name: `Proposal: New skill · ${name}` });
  await expect(card).toContainText("Writes a Plan's risks.");
  await expect(card).toContainText("List each risk with what would show it early.");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skill-proposal.png") });
  await card.getByRole("button", { name: "Apply change" }).click();
  await expect(card).toContainText("Applied");
  await expect(page.getByText(`${name} added. It is off until you review it.`)).toBeVisible();

  await page.goto("/settings/skills");
  const skillRow = page.getByRole("row").filter({ hasText: name });
  await expect(skillRow).toContainText("Off · waiting for your review");
  await skillRow.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "List each risk with what would show it early.",
  );
});

async function seedLinkCard(threadId: string, to: string, note: string): Promise<void> {
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [crypto.randomUUID(), threadId, { kind: "link-card", roleKey: "office-manager", to, note }],
  );
}

test("the user opens a Thread from Marta's Link card, edits the Handover note and sends it; a person let go shows as such", async ({
  page,
}) => {
  const started = await page.request.post("/api/chats/office-manager/threads");
  const { id: threadId } = threadSchema.parse(await started.json());
  const { card: planner } = roleSchema.parse(
    await (await page.request.get("/api/roles/planner")).json(),
  );
  // Someone hired and let go since, whom an earlier card still points to.
  const { card: developer } = roleSchema.parse(
    await (await page.request.get("/api/roles/developer")).json(),
  );
  const hired = await page.request.post("/api/roles", {
    data: { card: { ...developer, name: "Rhea", title: "Archivist", skills: [] } },
  });
  const { key: archivist } = roleSchema.parse(await hired.json());
  await seedLinkCard(threadId, archivist, "Where are last year's release notes kept?");
  expect((await page.request.post(`/api/roles/${archivist}/let-go`)).status()).toBe(201);
  const note = "Can you split the invoice export into two Tasks?";
  await seedLinkCard(threadId, "planner", note);

  await page.goto(`/people?chat=office-manager&thread=${threadId}`);
  const marta = chatWith(page, "Marta");
  const gone = marta.getByRole("region", { name: "Link card: Rhea · Archivist" });
  await expect(gone).toContainText("Rhea · Archivist was let go");
  await expect(gone.getByRole("button")).toHaveCount(0);
  const link = marta.getByRole("region", { name: `Link card: ${planner.name} · Planner` });
  await expect(link).toContainText(note);
  await expect(link).toContainText("Available");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-link-card.png") });

  await link.getByRole("button", { name: `Open a thread with ${planner.name}` }).click();

  const chat = chatWith(page, planner.name);
  await expect(chat.getByRole("heading", { name: "New thread" })).toBeVisible();
  const prefilled = chat.getByRole("note").filter({ hasText: "Handover note from" });
  await expect(prefilled).toContainText("Handover note from Marta · Office Manager, prefilled");
  const message = chat.getByLabel("Message");
  await expect(message).toHaveValue(note);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-handover-note-prefilled.png") });
  await message.fill(`${note} Marta thinks the CSV part can ship first.`);
  await message.press("Enter");

  await expect(chat.getByText("Marta thinks the CSV part can ship first.")).toBeVisible();
  await expect(chat.getByText("You · Handover note from Marta · Office Manager")).toBeVisible();
  await expect(chat.getByText("Two Tasks, then: the CSV export first.")).toBeVisible();
  await expect(prefilled).toHaveCount(0);
});

/**
 * A card Marta posted in her chat, as the Conversations service leaves it: only her session's
 * Office tools, capturing an Idea or showing the Office status, post one.
 */
async function seedChatCard(threadId: string, card: Record<string, unknown>): Promise<void> {
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [crypto.randomUUID(), threadId, { roleKey: "office-manager", ...card }],
  );
}

test("Marta's chat shows the Ideas she captured, planned from their cards, and the Office status", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Usage reports", "UR");
    const started = await page.request.post("/api/chats/office-manager/threads");
    const { id: threadId } = threadSchema.parse(await started.json());
    const officeWide = ideaSchema.parse(
      await (
        await page.request.post("/api/ideas", {
          data: { title: "A weekly usage summary on Monday mornings", notes: "", projectId: null },
        })
      ).json(),
    );
    const shaped = ideaSchema.parse(
      await (
        await page.request.post("/api/ideas", {
          data: { title: "Archive old Threads", notes: "", projectId: project.id },
        })
      ).json(),
    );
    const task = taskSchema.parse(
      await (
        await page.request.post(`/api/ideas/${shaped.id}/shape`, {
          data: { projectId: project.id },
        })
      ).json(),
    );
    await seedChatCard(threadId, { kind: "idea", ideaId: officeWide.id });
    await seedChatCard(threadId, { kind: "idea", ideaId: shaped.id });
    await seedChatCard(threadId, { kind: "office-status" });
    const { card: planner } = roleSchema.parse(
      await (await page.request.get("/api/roles/planner")).json(),
    );

    await page.goto(`/people?chat=office-manager&thread=${threadId}`);

    const marta = chatWith(page, "Marta");
    const newIdea = marta.getByRole("region", { name: `Idea: ${officeWide.title}` });
    await expect(newIdea).toContainText("Office-wide");
    const shapedIdea = marta.getByRole("region", { name: `Idea: ${shaped.title}` });
    await expect(shapedIdea).toContainText("Shaped");
    await expect(shapedIdea.getByRole("link", { name: task.title })).toBeVisible();
    const status = marta.getByRole("region", { name: "Office status" });
    await expect(status).toContainText(/Waiting on you|Nothing waits on you/);
    await expect(status).toContainText(`${planner.name} · Planner`);
    await expect(status).not.toContainText("Office Manager");
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-idea-and-office-status.png"),
    });

    await newIdea.getByRole("button", { name: `Plan as a Task with ${planner.name}` }).click();

    // The Project picker opens over the chat, which is a dialog itself.
    const choosing = marta.getByRole("dialog");
    await expect(choosing).toContainText("Which Project is the Task in?");
    await expect(choosing).toContainText("Usage reports");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-idea-card-project.png") });
    await choosing.getByRole("button", { name: "Cancel" }).click();
    await expect(choosing).toHaveCount(0);
    await newIdea.getByRole("link", { name: "Open in Ideas" }).click();
    await expect(page).toHaveURL(new RegExp(`/work/ideas\\?idea=${officeWide.id}`));
  } finally {
    await repository.remove();
  }
});

const SHAPED_OUTCOME = "Customers download their monthly usage as a CSV file from the web app.";
const PROPOSED_OUTCOME =
  "Customers download their monthly usage as a CSV file from the web app and the API.";

/** "Add a Task" on the Initiative page, in `projectName`, waiting for the Tasks named. */
async function addTaskToInitiative(
  page: Page,
  title: string,
  projectName: string,
  mustWaitFor: readonly string[],
): Promise<void> {
  await page.getByRole("button", { name: "Add a Task" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Add a Task to Usage exports for customers")).toBeVisible();
  await dialog.getByLabel("Title").fill(title);
  // The design system's radios are named by their label, not by role.
  await dialog.getByRole("radiogroup").locator("label").filter({ hasText: projectName }).click();
  for (const blocker of mustWaitFor) {
    await dialog
      .getByRole("group", { name: "Must wait for" })
      .locator("label")
      .filter({ hasText: blocker })
      .click();
  }
  await dialog.getByRole("button", { name: "Add the Task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${title} is in Backlog.`)).toBeVisible();
}

// The engine replays the last session in e2e/sessions.jsonl: Bob writes the outcome while the
// Initiative is shaped, then proposes a new one once it is active.
test("the user shapes an Idea into an Initiative with Bob, adds its Tasks, confirms it, applies Bob's Proposal and drops it", async ({
  page,
}) => {
  const repository = await createTemporaryRepository();
  const dashboardRepository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Metering", "MT");
    await addedProject(page, dashboardRepository, "Dashboard", "DB");
    const outside = await page.request.post("/api/tasks", {
      data: { title: "Usage table schema", projectId: project.id, priority: "normal" },
    });
    expect(outside.status()).toBe(201);
    const idea = await page.request.post("/api/ideas", {
      data: { title: "Usage exports for customers", notes: "", projectId: null },
    });
    expect(idea.status()).toBe(201);
    const { id: ideaId } = ideaSchema.parse(await idea.json());
    const link = await page.request.post(`/api/ideas/${ideaId}/attachments/links`, {
      data: { name: "Usage export sketch", url: "https://example.com/usage-export-sketch" },
    });
    expect(link.status()).toBe(201);

    await page.goto("/work/ideas");
    await page
      .getByRole("article", { name: "Usage exports for customers" })
      .getByRole("button", { name: "Shape into an Initiative with Bob" })
      .click();
    await expect(page).toHaveURL(/\/work\/initiatives\/[0-9a-f-]+$/);
    const initiativeUrl = page.url();
    await expect(page.getByText("Shaping with Bob")).toBeVisible();
    // The Idea stays its origin, and its Attachments moved with it.
    const record = page.getByRole("region", { name: "Record" });
    await expect(
      record.getByRole("region", { name: "Attachments" }).getByText("Usage export sketch"),
    ).toBeVisible();
    await expect(
      record
        .getByRole("region", { name: "Started from the Idea" })
        .getByRole("link", { name: "Usage exports for customers" }),
    ).toBeVisible();

    // Bob writes the outcome straight onto the page while it is being shaped; the user edits it.
    const conversation = page.getByRole("complementary", { name: "Conversation" });
    await expect(
      conversation.getByText(
        "I wrote the outcome. Add the Tasks, and confirm the Initiative when it is right.",
      ),
    ).toBeVisible();
    const outcome = record.getByRole("region", { name: "Outcome" });
    await expect(outcome).toContainText(SHAPED_OUTCOME);
    await outcome.getByRole("button", { name: "Edit" }).click();
    await outcome.getByRole("textbox", { name: "Outcome" }).fill(`${SHAPED_OUTCOME} Monthly.`);
    await outcome.getByRole("button", { name: "Save" }).click();
    await expect(outcome).toContainText(`${SHAPED_OUTCOME} Monthly.`);

    await addTaskToInitiative(page, "Usage export endpoint", "Metering", []);
    await addTaskToInitiative(page, "Usage export button", "Dashboard", ["Usage export endpoint"]);

    // A blocker outside the Initiative, added on its Task's page, shows in the graph too.
    const graph = page.getByRole("group", { name: "Task graph" });
    await graph.getByRole("link", { name: /Usage export endpoint/ }).click();
    const dependencies = page
      .getByRole("region", { name: "Record" })
      .getByRole("region", { name: "Dependencies" });
    await dependencies.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Find a Task" }).fill("Usage table");
    await dialog.getByText("Usage table schema").click();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.goto(initiativeUrl);
    await expect(graph.getByRole("link")).toHaveCount(3);
    await expect(graph.getByRole("link", { name: /Usage table schema/ })).toContainText(
      "outside this Initiative",
    );
    await expect(page.getByText("2 across 2 Projects")).toBeVisible();

    await page.getByRole("button", { name: "Confirm the Initiative" }).click();
    await expect(
      page.getByText("Initiative confirmed. Its Tasks wait in Backlog until Jan plans them."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm the Initiative" })).toHaveCount(0);
    await expect(outcome.getByRole("button", { name: "Edit" })).toHaveCount(0);

    // Once it is active, Bob's change is a Proposal the user applies.
    const message = conversation.getByLabel("Message");
    await message.fill("The API should export it too");
    await message.press("Enter");
    const proposal = conversation.getByRole("region", {
      name: "Proposal: New outcome for the Initiative",
    });
    await expect(proposal).toContainText(PROPOSED_OUTCOME);
    await proposal.getByRole("button", { name: "Apply change" }).click();
    await expect(proposal).toContainText("Applied");
    await expect(outcome).toContainText(PROPOSED_OUTCOME);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-initiative.png") });

    await page.goto("/work/initiatives");
    await expect(page.getByRole("link", { name: "Usage exports for customers" })).toContainText(
      "0 of 2 Tasks done",
    );

    await page.goto(initiativeUrl);
    await page.getByRole("button", { name: "More for Usage exports for customers" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Drop the Initiative" }).click();
    await expect(
      page.getByText("Initiative dropped. Its Tasks stay where they are."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a Task" })).toHaveCount(0);
    await expect(
      page.getByText(
        "This Initiative was dropped, so you can read this conversation but not continue it.",
      ),
    ).toBeVisible();
  } finally {
    await Promise.all([repository.remove(), dashboardRepository.remove()]);
  }
});
