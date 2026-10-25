import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { projectSchema, type NewProject, type Project } from "@the-office/contracts";
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
): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "violet" },
    commands: {
      install: "npm ci",
      build: "npm run build",
      lint: "npm run lint",
      test: "npm test",
    },
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

// The engine replays the planning session, the last in e2e/sessions.jsonl: Jan writes the Plan and
// the Definition of Done, proposes Quick fix and opens a Decision, then takes its answer.
test("the user plans a Task with the Planner to Ready, answering a Decision", async ({ page }) => {
  const repository = await createTemporaryRepository();
  try {
    const project = await addedProject(page, repository, "Sign-in", "SI");
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
    await expect(
      page.getByText("Sign-in returns to the page is in Planning with Jan."),
    ).toBeVisible();
    const conversation = page.getByRole("complementary", { name: "Conversation" });
    await expect(conversation.getByRole("button", { name: /^Planning · Jan/ })).toBeVisible();
    const decision = conversation.getByRole("region", { name: `Decision: ${QUERY_QUESTION}` });
    await expect(
      decision.getByText(
        "Jan recommends “Keep the query string”: Filters live in the query string.",
      ),
    ).toBeVisible();
    await expect(conversation.getByText("open_decision")).toHaveCount(0);
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
  } finally {
    await repository.remove();
  }
});
