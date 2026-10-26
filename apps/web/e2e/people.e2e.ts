import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  OPEN_DECISION_TOOL,
  pipelineListSchema,
  projectSchema,
  roleSchema,
  taskSchema,
  taskStagesSchema,
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
  const { permissionProfile: _permissionProfile, ...edit } = card;
  const saved = await page.request.put("/api/roles/developer/card", {
    data: { ...edit, taskLimit },
  });
  expect(saved.status()).toBe(200);
  return card.taskLimit;
}

function roleCardGroup(page: Page, group: string) {
  return page.getByRole("region", { name: group });
}

test("the user hires the Planner, a Developer and a Reviewer from the presets", async ({
  page,
}) => {
  await hireFromPreset(page, "Planner", "Jan");
  await expect(page).toHaveURL(/\/people\/planner$/);
  await hireFromPreset(page, "Developer", "Ada");
  await hireFromPreset(page, "Reviewer", "Ola");

  await page.goto("/people");
  await expect(page.getByText("3 people")).toBeVisible();
  for (const name of ["Jan", "Ada", "Ola"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  // Every preset is filled, and hiring from scratch comes later.
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
  const brief = conversation.getByText(/^You are planning a Task with the user/);
  await expect(brief).toBeHidden();
  await conversation.getByText("Brief", { exact: true }).click();
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

  await page.getByRole("button", { name: "Mark Ready" }).click();
  await expect(page.getByText(/Confirm the Plan before the Task can be Ready\./)).toBeVisible();
  await expect(
    page.getByText(/Answer the open Decision before the Task can be Ready\./),
  ).toBeVisible();

  await plan.getByRole("button", { name: "Confirm" }).click();
  await expect(plan.getByText("Confirmed")).toBeVisible();
  await definitionOfDone.getByRole("button", { name: "Edit" }).click();
  await definitionOfDone
    .getByRole("textbox")
    .fill("Signing in returns to the page and its query string.\nThe tests pass.");
  await definitionOfDone.getByRole("button", { name: "Save and confirm" }).click();
  await expect(
    definitionOfDone.getByText("Signing in returns to the page and its query string."),
  ).toBeVisible();
  await expect(definitionOfDone.getByText("Confirmed")).toBeVisible();
  await expect(stages.getByLabel("Another Pipeline")).toContainText("Document");
  await stages.getByRole("button", { name: "Use Quick fix" }).click();
  await expect(record.getByRole("region", { name: "Stages · Quick fix" })).toBeVisible();
  await expect(record.getByText(/A small change with tests/)).toHaveCount(0);

  await decision.getByRole("button", { name: "Keep the query string" }).click();
  await expect(conversation.getByText("The query string stays, as the Plan says.")).toBeVisible();
  await expect(decision.getByText("Answered")).toBeVisible();
  await expect(page.getByText("Waiting on you", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Mark Ready" }).click();
  await expect(
    page.getByText("Sign-in returns to the page is Ready. Starting it is your call."),
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
  await card.getByRole("link", { name: "Sign-in returns to the page" }).click();

  await decision.getByRole("button", { name: "The page it started from" }).click();
  await expect(decision.getByText("Answered")).toBeVisible();
  await expect(
    conversation.getByText("Signing in now returns to the page it started from."),
  ).toBeVisible();
  // The Stage ran again in the asking Thread, continuing its session.
  await expect(implement).toContainText("continued session");
  await expect(implement).toContainText("Done · ");
  await expect(
    stages.getByText("Handover note: The redirect keeps the path and the query string."),
  ).toBeVisible();
});

const GATE_FEEDBACK = "Call the button Save, as the rest of the settings do.";
/** A 1×1 PNG. */
const A_SCREENSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Gives the Task its own Stages before it starts, as the Stage editor will (task 15): Quick fix's
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
  await queryOfficeDatabase(
    "insert into task_stages (task_id, pipeline_id, stages, made_at) values ($1, 'quick-fix', $2, now())",
    [taskId, JSON.stringify(stages)],
  );
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
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Settings", "ST", PASSING_COMMANDS);
    const taskId = await readyTask(page, project.id, "Settings keep their changes");
    await seedGatedStages(page, taskId);
    await page.goto(`/tasks/${taskId}`);
    await page.getByRole("button", { name: "Start", exact: true }).click();

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

    await gate.getByRole("button", { name: "Send back with notes…" }).click();
    const sendBack = gate.getByRole("form", { name: "Send back" });
    await sendBack.getByPlaceholder("What should Adam change?").fill(GATE_FEEDBACK);
    await sendBack.getByRole("button", { name: "Send back", exact: true }).click();
    await expect(page.getByText("Sent back to Adam.")).toBeVisible();

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

    await gate.getByRole("button", { name: "Continue to Build" }).click();
    await expect(gate).toHaveCount(0);
    const acceptance = stages
      .getByRole("listitem")
      .filter({ has: page.getByText("UI acceptance", { exact: true }) });
    await expect(acceptance).toContainText("continued");
    await expect(page.locator(".task-head-meta").getByText("Done", { exact: true })).toBeVisible();
  } finally {
    await repository.remove();
  }
});
