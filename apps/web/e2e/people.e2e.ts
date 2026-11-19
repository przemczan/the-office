import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  expect as playwrightExpect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import {
  autoModeSettingSchema,
  engineSettingsSchema,
  ideaSchema,
  initiativeSchema,
  IMAGE_UPLOAD_BYTES,
  notificationListSchema,
  nowSchema,
  OPEN_DECISION_TOOL,
  pipelineListSchema,
  pipelineSchema,
  processOutputSchema,
  projectPipelineListSchema,
  projectPipelineSchema,
  projectSchema,
  recordPath,
  roleCardSchema,
  roleSchema,
  sizeThresholdSchema,
  SIZE_THRESHOLD_TOKENS,
  stageTemplateSchema,
  standInChoicesResponseSchema,
  standInSwitchResponseSchema,
  taskListSchema,
  taskSchema,
  taskStagesSchema,
  chatThreadPageSchema,
  threadListSchema,
  decisionListSchema,
  dutyListSchema,
  threadSchema,
  type Duty,
  type Thread,
  type ClaudeCodeEngineEdit,
  type EngineSettings,
  type NewProject,
  type Project,
  type Stage,
  type TaskLimit,
} from "@the-office/contracts";
import { desktopShown, focusTab, recordDesktopNotifications } from "./desktop-notifications.ts";
import { E2E_STORAGE_STATE } from "./e2e-user.ts";
import { addFakeMcpServerTurnedOn } from "./fake-mcp-server.ts";
import { E2E_OFFICE_DATA } from "./office-data.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { createSkillSource } from "./skill-source.ts";
import {
  commitFiles,
  createTemporaryRepository,
  type TemporaryRepository,
} from "./temporary-repository.ts";
import { openPipelinePicker, pickPipeline } from "./pipeline-picker.ts";
import { asStageList } from "./stage-list.ts";
import { screenshotScenario, TASK_SCREENSHOTS } from "./task-screenshots.ts";
import { createFromTopBar } from "./top-bar.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

const AVATAR_FILE = {
  name: "portrait.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" fill="teal"/><circle cx="32" cy="26" r="12" fill="white"/><rect x="12" y="42" width="40" height="22" rx="11" fill="white"/></svg>',
  ),
};

const AVATAR_WITH_A_SCRIPT = {
  name: "scripted.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/><script>document.documentElement.setAttribute("data-script-ran", "yes"); alert("ran");</script></svg>`,
  ),
};

/** Written by this file alone, so the other files' skills never meet it. */
const SKILL = "people-handover";

/**
 * A session opened while the other files run answers late: it first refreshes every Project's base
 * checkout, and their git processes took over 4s when measured, with most of the machine in use.
 * This file's Stages and chats all wait on such sessions, so its waits and its tests get longer.
 */
const expect = playwrightExpect.configure({ timeout: 15_000 });

// One person fills each Role and the database lives for the whole run, so the tests build on each
// other's hires; this is the only file that hires.
test.describe.configure({ mode: "serial", timeout: 90_000 });

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

/** Saves Settings › Engines through the API with the engines `change` gives from those saved. */
async function saveEngines(
  page: Page,
  change: (
    saved: EngineSettings["engines"],
  ) => readonly (EngineSettings["engines"][number] | ClaudeCodeEngineEdit)[],
): Promise<void> {
  const saved = engineSettingsSchema.parse(
    await (await page.request.get("/api/settings/engines")).json(),
  );
  const kept = await page.request.put("/api/settings/engines", {
    data: {
      ...saved,
      engines: change(saved.engines).map((engine) =>
        // An endpoint without its key keeps the one kept.
        engine.kind === "claude-code" ? engine : { ...engine, keySet: undefined },
      ),
    },
  });
  expect(kept.ok()).toBe(true);
}

/** The id of the engine called `name`, empty when none is listed. */
async function engineIdOf(page: Page, name: string): Promise<string> {
  const saved = engineSettingsSchema.parse(
    await (await page.request.get("/api/settings/engines")).json(),
  );
  return saved.engines.find((engine) => engine.name === name)?.id ?? "";
}

/** Selects the engine called `name` in Settings › Engines' list, then its tab. */
async function openEngine(
  page: Page,
  name: string,
  tab: "Settings" | "Account" | "Models and prices" = "Settings",
): Promise<void> {
  await page
    .getByRole("navigation", { name: "Engines" })
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
  await page.getByRole("tab", { name: tab, exact: true }).click();
}

/** Adds an engine of the kind through "Add an engine", which selects it. */
async function addEngine(
  page: Page,
  kind: "Claude Code" | "Codex" | "API endpoint",
): Promise<void> {
  await page.getByRole("button", { name: "Add an engine" }).click();
  await page.getByRole("menu").getByRole("button", { name: kind, exact: true }).click();
}

/** The selected engine's tabs: only one engine's fields show at a time. */
function shownEngine(page: Page): Locator {
  return page.locator(".engine-detail");
}

/** Removes the engine called `name` through the API, as a test cleans up after adding one. */
async function removeEngine(page: Page, name: string): Promise<void> {
  const engineId = await engineIdOf(page, name);
  const removed = await page.request.delete(
    `/api/settings/engines/${encodeURIComponent(engineId)}?replacement=claude-code`,
  );
  expect(removed.ok()).toBe(true);
}

async function expectLoadedImage(image: Locator): Promise<void> {
  await expect
    .poll(() => image.first().evaluate((shown: HTMLImageElement) => shown.naturalWidth))
    .toBeGreaterThan(0);
}

function avatarFiles(): Promise<string[]> {
  return readdir(path.join(E2E_OFFICE_DATA, "avatars"));
}

/** The image's id, the part of its address before `/content`. */
function imageIdOf(address: string): string {
  return address.split("/").at(-2) ?? "";
}

test("on a fresh Office, People shows what to hire and the Caretaker's set-up hires the Planner and a Developer", async ({
  page,
}) => {
  // Only the Caretaker is there: People says which preset brings which duties and how to fill them.
  await page.goto("/people");
  await expect(page.getByText("1 person")).toBeVisible();
  const hint = page.getByRole("region", { name: "Nobody is hired yet" });
  const lines = hint.getByRole("listitem");
  await expect(lines).toHaveCount(6);
  await expect(lines.nth(0)).toContainText("Planner");
  await expect(lines.nth(0)).toContainText("Plans");
  await expect(lines.nth(0)).toContainText("Up to 2 Tasks");
  await expect(lines.nth(3)).toContainText(
    "Shapes Initiatives, Asked first when a Stage runs out of tries",
  );
  await expect(lines.nth(5)).toContainText("Default person to talk to");
  await expect(lines.nth(5)).toContainText("Talks only");
  await expect(hint).toContainText(
    "While nobody holds a duty, you do it yourself, except Default person to talk to, which goes to Sam",
  );
  await screenshotScenario(page, "people-office-setup", { fullPage: true });

  // The Hire dialog says the duties each preset suits.
  await hint.getByRole("button", { name: "Hire a Role" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Suits: Plans.");
  await expect(dialog).toContainText(
    "Suits: Onboards and repairs Projects, Default Consultant for MCP tool hard switches.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Setting up with Sam opens a new Thread in their chat with a draft; nothing is sent, so no session opens.
  await hint.getByRole("button", { name: "Set up The Office with Sam" }).click();
  const sam = chatWith(page, "Sam");
  await expect(sam.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Help me set up The Office. I work on ",
  );
  const threadId = await chatThreadShown(page);
  expect(threadId).not.toBe("");

  // Sam's set-up, as their session would draft it, hires Jan and Ada, who hold their presets' duties.
  await seedProposal(
    threadId,
    {
      kind: "office-setup",
      hires: [
        { kind: "hire-from-preset", roleKey: "planner", name: "Jan" },
        { kind: "hire-from-preset", roleKey: "developer", name: "Ada" },
      ],
      duties: [],
    },
    "caretaker",
  );
  await page.goto(`/people?chat=caretaker&thread=${threadId}`);
  const setUp = sam.getByRole("region", { name: "Proposal: Set up The Office" });
  await expect(setUp).toContainText("Jan · Planner");
  await expect(setUp).toContainText("Ada · Developer");
  await expect(setUp).toContainText("from the preset");
  await expect(setUp.getByRole("row", { name: /^Plans/ })).toContainText("Jan · Planner");
  await expect(setUp.getByRole("row", { name: /^Implements/ })).toContainText("Ada · Developer");
  await screenshotScenario(page, "office-setup-proposal-card");
  await setUp.getByRole("button", { name: "Hire 2 and assign duties" }).click();
  await expect(setUp).toContainText("Applied");
  await expect(setUp.getByRole("link", { name: "Jan · Planner" })).toBeVisible();

  await page.goto("/people");
  await expect(page.getByText("3 people")).toBeVisible();
  await expect(page.getByRole("region", { name: "Nobody is hired yet" })).toHaveCount(0);
  for (const [name, duty] of [
    ["Jan", "Plans"],
    ["Ada", "Implements"],
  ] as const) {
    const tile = page.locator(".person-card").filter({ has: page.getByRole("heading", { name }) });
    await expect(tile.getByLabel(`1 duty: ${duty}`)).toBeVisible();
  }
});

test("the user hires a Reviewer, the CTO and the Office Manager from the presets", async ({
  page,
}) => {
  await hireFromPreset(page, "Reviewer", "Ola");
  await expect(page).toHaveURL(/\/people\/reviewer$/);
  await hireFromPreset(page, "CTO", "Bob");
  await hireFromPreset(page, "Office Manager", "Marta");

  await page.goto("/people");
  // The Caretaker is there before any hire.
  await expect(page.getByText("6 people")).toBeVisible();
  for (const name of ["Jan", "Ada", "Ola", "Bob", "Marta"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-people.png") });
});

test(
  "the Caretaker is built in: pinned first, never let go, its card's fixed parts read-only",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/people");
    const first = page.locator(".people-grid .person-card").first();
    await expect(first.getByRole("heading", { name: "Sam", exact: true })).toBeVisible();
    await expect(first).toContainText("Caretaker");
    await expect(first).toContainText("Built in");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-caretaker-people.png") });

    await first.getByRole("link", { name: "Sam", exact: true }).click();
    await expect(page).toHaveURL(/\/people\/caretaker$/);
    await expect(page.getByRole("button", { name: "Open the chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Let go" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Role card" }).click();
    for (const group of ["Work", "Capabilities", "Permissions"]) {
      await expect(roleCardGroup(page, group)).toContainText("Built in: fixed for the Caretaker.");
    }
    await expect(roleCardGroup(page, "Permissions")).toContainText("Change RolesNever");
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-caretaker-role-card.png"),
      fullPage: true,
    });

    // The form shows the fixed parts but doesn't change them; the rest stays editable.
    await page.getByRole("button", { name: "Edit Role" }).click();
    await expect(page.getByLabel("Task limit")).toBeDisabled();
    await expect(page.getByLabel("Runs")).toBeDisabled();
    await roleCardGroup(page, "Capabilities").getByText("Chat", { exact: true }).click();
    await expect(page.getByText("You have unsaved changes.")).toHaveCount(0);
    await expect(page.getByLabel("Title")).toBeEditable();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/people\/caretaker\/role$/);
  },
);

// Allowing changes ends the Thread's session, if any: a Thread with no message opens none.
test(
  "the user allows changes in a Caretaker Thread, confirmed, then switches them off",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Open the chat with Sam" }).click();
    const chat = chatWith(page, "Sam");
    await startNewThread(chat);
    await expect(chat.getByText("The Caretaker only reads in this Thread.")).toBeVisible();

    await chat.getByRole("button", { name: "Allow changes", exact: true }).click();
    // Opened over the chat, on the body, the confirmation is named by its heading.
    const confirm = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Allow changes in this Thread?" }) });
    await expect(confirm).toContainText("git push included");
    await expect(confirm).toContainText("Your secrets stay refused");
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-caretaker-allow-changes-confirm.png"),
    });
    await confirm.getByRole("button", { name: "Allow changes", exact: true }).click();
    await expect(confirm).toHaveCount(0);

    const banner = chat.getByText(
      "Changes allowed in this Thread: the Caretaker can do anything on the workstation except read your secrets",
    );
    await expect(banner).toBeVisible();
    await expect(chat.getByText("Changes allowed by you", { exact: true })).toBeVisible();
    await expect(chat.getByRole("button", { name: "Allow changes", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-caretaker-changes-allowed-banner.png"),
    });

    await chat.getByRole("button", { name: "Switch off" }).click();
    await expect(banner).toHaveCount(0);
    await expect(chat.getByText("Changes switched off by you", { exact: true })).toBeVisible();
    await expect(chat.getByRole("button", { name: "Allow changes", exact: true })).toBeVisible();
  },
);

test(
  "a person's page shows who they are and their Role card from the presets",
  { tag: "@full" },
  async ({ page }) => {
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
    await expect(roleCardGroup(page, "Engine")).toContainText("Office default · effort high");
    await expect(roleCardGroup(page, "Engine")).toContainText("from the Office default");
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
  },
);

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
  await form.getByRole("combobox", { name: "Engine" }).selectOption({ label: "Claude Code" });
  // Picking an engine fills in its default model.
  await expect(form.getByLabel("Model")).toHaveValue("claude-sonnet-5-5");
  await form.getByRole("tab", { name: "Max" }).click();
  await form.getByText("Chat", { exact: true }).click();
  await form.getByText("Consultant", { exact: true }).click();
  await form.getByText("Run environment", { exact: true }).click();
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
  await expect(roleCardGroup(page, "Engine")).toContainText(
    "Sonnet 5.5 · effort max · Claude Code",
  );
  await expect(roleCardGroup(page, "Engine")).toContainText(
    "Sonnet 5.5 on Claude Code, from the Role override",
  );
  const capabilities = roleCardGroup(page, "Capabilities").getByRole("listitem");
  await expect(capabilities.filter({ hasText: "Chat" })).toHaveClass("on");
  await expect(capabilities.filter({ hasText: "Consultant" })).toHaveClass("on");
  // The Developer preset has Run environment on.
  await expect(capabilities.filter({ hasText: "Run environment" })).not.toHaveClass("on");
  const permissions = roleCardGroup(page, "Permissions");
  await expect(permissions).toContainText("Run installsAsk me");
  await expect(permissions).toContainText("Publish outside the PipelineNever");
  await expect(permissions).not.toContainText("Asks you until someone is hired");
  await expect(permissions).toContainText("Edits files in its worktree");
  await expect(permissions).toContainText("Runs the Project's commands and read-only git");
  await expect(permissions).toContainText("No web");
  await expect(roleCardGroup(page, "Skills")).toContainText(SKILL);

  const changes = page.getByRole("listitem").filter({ hasText: "Role card version 2" });
  await expect(changes).toContainText("Engine and model Office default → Claude Code · Sonnet 5.5");
  await expect(changes).toContainText("Task limit 3 → 4");
  await expect(page.getByText(`Skills gained ${SKILL}`)).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-role-card-changed.png"),
    fullPage: true,
  });
});

test(
  "the Role card lists the Projects where another engine or model applies, and where it comes from",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    const haiku = { engineId: "claude-code", model: "claude-haiku-5-5" };
    let project: Project | undefined;
    try {
      project = await addedProject(page, repository, "Cascade shop", "CS");
      await page.goto("/people/developer/role");
      const engine = roleCardGroup(page, "Engine");
      await expect(engine).toContainText("Sonnet 5.5 on Claude Code, from the Role override");
      const elsewhere = engine.getByRole("list", { name: "Projects where something else applies" });
      await expect(elsewhere).toHaveCount(0);

      // The card follows a Project's change as it lands.
      const overridden = await page.request.put(
        `/api/projects/${project.id}/role-overrides/developer`,
        { data: { roleOverride: haiku } },
      );
      expect(overridden.ok()).toBe(true);
      await expect(elsewhere).toHaveText(
        "In Cascade shop: Haiku 5.5 on Claude Code, from the Project's Role override",
      );
    } finally {
      if (project) {
        await page.request.put(`/api/projects/${project.id}/role-overrides/developer`, {
          data: { roleOverride: null },
        });
      }
      await repository.remove();
    }
  },
);

test(
  "the Project page's Engine block sets the Project default, uses it for every Role, and gives a Role an override there",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    let project: Project | undefined;
    try {
      project = await addedProject(page, repository, "Engine shop", "ES");
      await page.goto(`/projects/${project.id}/engine`);
      const block = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "Engine", exact: true }) });
      const projectDefault = block.getByRole("group", { name: "Project default" });
      const useForEveryRole = block.getByRole("switch");
      await expect(projectDefault.getByLabel("Engine")).toHaveValue("");
      await expect(block).toContainText("Pick a Project default first.");

      // Picking an engine fills in its default model.
      await projectDefault.getByLabel("Engine").selectOption({ label: "Claude Code" });
      await expect(projectDefault.getByLabel("Model")).toHaveValue("claude-sonnet-5-5");
      await projectDefault.getByLabel("Model").selectOption({ label: "Haiku 5.5" });
      // The field shows the saved Project, so this waits for the save, which the switch ignores clicks during.
      await expect(projectDefault.getByLabel("Model")).toHaveValue("claude-haiku-5-5");
      await useForEveryRole.click();
      await expect(useForEveryRole).toHaveAttribute("aria-checked", "true");
      // While it is on, the Project default can't be cleared.
      await expect(
        projectDefault.getByLabel("Engine").getByRole("option", { name: "Office default" }),
      ).toHaveCount(0);

      // The force wins over the Developer's Role override on his card.
      const elsewhere = roleCardGroup(page, "Engine").getByRole("list", {
        name: "Projects where something else applies",
      });
      await page.goto("/people/developer/role");
      await expect(elsewhere).toContainText(
        "In Engine shop: Haiku 5.5 on Claude Code, from the Project default",
      );

      await page.goto(`/projects/${project.id}/engine`);
      const adding = block.getByRole("group", { name: "Add a Role override" });
      await adding.getByLabel("Role").selectOption("developer");
      await adding.getByLabel("Model").selectOption({ label: "Haiku 5.5" });
      await adding.getByRole("button", { name: "Add" }).click();
      const overrides = block.getByRole("list", { name: "Role overrides in this Project" });
      await expect(overrides.getByRole("listitem")).toHaveCount(1);
      await expect(overrides.getByRole("listitem")).toContainText("Adam · Senior developer");

      await page.reload();
      await expect(projectDefault.getByLabel("Model")).toHaveValue("claude-haiku-5-5");
      await expect(useForEveryRole).toHaveAttribute("aria-checked", "true");
      await expect(overrides.getByLabel("Model")).toHaveValue("claude-haiku-5-5");

      // The Project's Role override wins over the force.
      await page.goto("/people/developer/role");
      await expect(elsewhere).toContainText(
        "In Engine shop: Haiku 5.5 on Claude Code, from the Project's Role override",
      );

      await page.goto(`/projects/${project.id}/engine`);
      await overrides.getByRole("button", { name: "Remove" }).click();
      await expect(overrides).toHaveCount(0);
      await expect(
        adding.getByLabel("Role").getByRole("option", { name: "Adam · Senior developer" }),
      ).toHaveCount(1);
    } finally {
      if (project) {
        const projectPath = `/api/projects/${project.id}`;
        await page.request.put(`${projectPath}/role-overrides/developer`, {
          data: { roleOverride: null },
        });
        await page.request.put(`${projectPath}/use-for-every-role`, {
          data: { useForEveryRole: false },
        });
        await page.request.put(`${projectPath}/project-default`, {
          data: { projectDefault: null },
        });
      }
      await repository.remove();
    }
  },
);

test(
  "a Role card the service refuses names every reason, and keeps what was typed",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

test(
  "the user hires a person from scratch, filling the whole Role card",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await expect(page).toHaveURL(/\/hire$/);
    const form = page.locator("form.role-card-form");
    await form.getByLabel("Name", { exact: true }).fill("Mia");
    await form.getByLabel("Title", { exact: true }).fill("Data Analyst");
    await page.getByRole("button", { name: "Hire Mia" }).click();
    // Responsibilities and instructions are still empty.
    await expect(page.getByText("The person can't be hired yet")).toBeVisible();
    await expect(
      page.getByText("Give the Role's responsibilities in one paragraph."),
    ).toBeVisible();
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
  },
);

test(
  "the user lets a person go, finds their page kept and read-only, and hires them back",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

// Mia opens no session, so her card may name an API endpoint no server answers at.
test(
  "the user lists an API endpoint in Settings › Engines and puts Mia on one of its models",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/settings/engines");
    // An engine added and removed before Save leaves another one shown.
    await addEngine(page, "Claude Code");
    await page.getByRole("button", { name: "Remove the new Claude Code engine" }).click();
    await expect(shownEngine(page)).toHaveCount(1);
    await expect(page.getByRole("group", { name: "Claude Code", exact: true })).toBeVisible();

    await addEngine(page, "API endpoint");
    const endpoint = shownEngine(page);
    await expect(endpoint).toHaveCount(1);
    await expect(page.getByRole("group", { name: "the new API endpoint" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Engines" }).getByLabel("It offers no model yet"),
    ).toBeVisible();
    await endpoint.getByLabel("Name", { exact: true }).fill("People Strata");
    await endpoint.getByLabel("Base URL").fill("http://127.0.0.1:8080/v1");
    await endpoint.getByLabel("Key").fill("sk-people");
    await page.getByRole("tab", { name: "Models and prices" }).click();
    await endpoint.getByLabel("Model", { exact: true }).fill("org/coder:q4");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // The model has no context window yet.
    await expect(page.getByText("The engines weren't saved")).toBeVisible();
    await expect(
      page.getByText('Give each model of "People Strata" its context window, in tokens.'),
    ).toBeVisible();

    await endpoint.getByLabel("Context window").fill("100000");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Engines saved. Sessions started from now on use them."),
    ).toBeVisible();
    await page.reload();
    await openEngine(page, "People Strata");
    await expect(endpoint.getByLabel("Name", { exact: true })).toHaveValue("People Strata");
    await expect(endpoint.getByLabel("Key")).toHaveValue("");
    await expect(endpoint.getByText("A key is set. It is never shown")).toBeVisible();

    await page.goto("/people/data-analyst/role/edit");
    const form = page.locator("form.role-card-form");
    await form.getByRole("combobox", { name: "Engine" }).selectOption({ label: "People Strata" });
    await expect(
      form.getByText("It has no usage windows, so the 5-hour window doesn't count it."),
    ).toBeVisible();
    await form.getByLabel("Model").selectOption({ label: "org/coder:q4" });
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(/\/people\/data-analyst\/role$/);
    await page.reload();
    await expect(roleCardGroup(page, "Engine")).toContainText(
      "org/coder:q4 · effort medium · People Strata",
    );
    await expect(roleCardGroup(page, "Engine")).toContainText("It has no usage windows");
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "Engine and model Office default → People Strata · org/coder:q4" }),
    ).toBeVisible();

    // An API engine has Daily caps only: it has no usage windows.
    await page.goto("/settings/office-limits");
    const strataCaps = page.getByRole("region", { name: "People Strata", exact: true });
    await expect(
      strataCaps.getByRole("group", { name: "People Strata's daily caps" }),
    ).toBeVisible();
    await expect(strataCaps.getByLabel("Tokens a day")).toHaveValue("");
    await expect(strataCaps.getByLabel("5-hour window")).toHaveCount(0);
  },
);

// Here, not in settings.e2e.ts: a Save sends every API endpoint, so one from a page read before the
// test above saved would drop People Strata.
test(
  "the user sets Model prices in Settings › Engines, a new API endpoint's before its Save",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/settings/engines");
    await addEngine(page, "API endpoint");
    const endpoint = shownEngine(page);
    await endpoint.getByLabel("Name", { exact: true }).fill("Priced Strata");
    await endpoint.getByLabel("Base URL").fill("http://127.0.0.1:8081/v1");
    await page.getByRole("tab", { name: "Models and prices" }).click();
    await endpoint.getByLabel("Model", { exact: true }).fill("local:q8");
    await endpoint.getByLabel("Context window").fill("8000");

    const local = page.getByRole("group", { name: "Model price of Priced Strata · local:q8" });
    const haiku = page.getByRole("group", { name: "Model price of Haiku 5.5" });
    const fillPrice = async (
      group: typeof local,
      [input, output, cacheWrites, cacheReads]: readonly string[],
    ): Promise<void> => {
      await group.getByLabel("Input").fill(input ?? "");
      await group.getByLabel("Output").fill(output ?? "");
      await group.getByLabel("Cache writes").fill(cacheWrites ?? "");
      await group.getByLabel("Cache reads").fill(cacheReads ?? "");
    };
    await fillPrice(local, ["0", "0", "0", "0"]);
    await openEngine(page, "Claude Code", "Models and prices");
    await expect(
      endpoint.getByText("The Claude models' prices are shared by every Claude Code engine"),
    ).toBeVisible();
    await haiku.getByLabel("Input").fill("1");
    await expect(haiku.getByText("Give all four, or none for no price.")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    // Out of sight, the price still holds Save, and the Save bar says where.
    await openEngine(page, "Priced Strata");
    await expect(haiku).toHaveCount(0);
    await expect(
      page.getByText("A price under Models and prices of Claude Code needs fixing before Save."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Engines" })
        .getByLabel("A Claude model's price needs fixing")
        .first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show it" }).click();
    await expect(haiku.getByLabel("Input")).toHaveValue("1");

    await fillPrice(haiku, ["1", "5", "1.25", "0.1"]);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Engines saved. Sessions started from now on use them."),
    ).toBeVisible();
    await page.reload();
    await openEngine(page, "Claude Code", "Models and prices");
    await expect(haiku.getByLabel("Cache writes")).toHaveValue("1.25");
    await openEngine(page, "Priced Strata", "Models and prices");
    await expect(local.getByLabel("Output")).toHaveValue("0");
    await openEngine(page, "People Strata", "Models and prices");
    await expect(
      page
        .getByRole("group", { name: "Model price of People Strata · org/coder:q4" })
        .getByLabel("Input"),
    ).toHaveValue("");

    await openEngine(page, "Claude Code", "Models and prices");
    await haiku.getByLabel("Output").fill("6");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(haiku.getByLabel("Output")).toHaveValue("5");

    // Later tests price nothing, so the prices go again.
    await fillPrice(haiku, ["", "", "", ""]);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Engines saved. Sessions started from now on use them."),
    ).toBeVisible();
    await removeEngine(page, "Priced Strata");
    await page.reload();
    await openEngine(page, "Claude Code", "Models and prices");
    await expect(haiku.getByLabel("Input")).toHaveValue("");
    await expect(
      page
        .getByRole("navigation", { name: "Engines" })
        .getByRole("button", { name: /^Priced Strata/ }),
    ).toHaveCount(0);
  },
);

// Here for the same reason as the test above. The engine it adds is removed through the API at the
// end, since each engine has its caps: Office limits' Save, in settings.e2e.ts, names every engine.
test(
  "the user adds a Claude Code engine with its default model and -p switch, and picks the Office default",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/settings/engines");
    await addEngine(page, "Claude Code");
    const added = page.getByRole("group", { name: "the new Claude Code engine" });
    await expect(added.getByLabel("Default model")).toHaveValue("claude-sonnet-5-5");
    await added.getByLabel("Name", { exact: true }).fill("Second account");
    const second = page.getByRole("group", { name: "Second account" });
    await second.getByLabel("Default model").selectOption({ label: "Haiku 5.5" });
    await second.getByRole("switch").click();
    await page.getByRole("tab", { name: "Account" }).click();
    await expect(second.getByText("It has no folder to sign in yet")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Engines saved. Sessions started from now on use them."),
    ).toBeVisible();

    await page.reload();
    const list = page.getByRole("navigation", { name: "Engines" });
    await expect(list.getByRole("button", { name: /^Claude Code/ })).toContainText(
      "Office default",
    );
    await expect(list.getByRole("button", { name: /^Second account/ })).toContainText(
      "Claude Code · Signed out · Haiku 5.5",
    );
    await expect(list.getByRole("button", { name: /^People Strata/ })).toContainText(
      "API endpoint · 1 model",
    );
    await openEngine(page, "Second account");
    await expect(second.getByLabel("Name", { exact: true })).toHaveValue("Second account");
    await expect(second.getByLabel("Default model")).toHaveValue("claude-haiku-5-5");
    await expect(second.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Remove Second account" })).toBeVisible();
    await openEngine(page, "People Strata");
    await expect(
      page.getByRole("group", { name: "People Strata", exact: true }).getByLabel("Default model"),
    ).toHaveValue("org/coder:q4");

    const officeDefault = page.getByRole("group", { name: "Office default" });
    const engine = officeDefault.getByRole("combobox", { name: "Engine" });
    const model = officeDefault.getByRole("combobox", { name: "Model" });
    await expect(engine).toHaveValue("claude-code");
    await expect(model).toHaveValue("claude-sonnet-5-5");
    await engine.selectOption({ label: "Second account" });
    // Picking an engine fills in its default model.
    await expect(model).toHaveValue("claude-haiku-5-5");
    await engine.selectOption({ label: "People Strata" });
    await expect(model).toHaveValue("org/coder:q4");
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(engine).toHaveValue("claude-code");

    await removeEngine(page, "Second account");
  },
);

test(
  "the user removes an engine through its dialog, and what named it moves to the replacement",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    const miasCard = roleSchema.parse(
      await (await page.request.get("/api/roles/data-analyst")).json(),
    ).card;
    let project: Project | undefined;
    try {
      // An engine of the test's own: removing one moves every reference to it, whoever made it.
      await saveEngines(page, (saved) => [
        ...saved,
        {
          kind: "claude-code",
          name: "Leaving account",
          defaultModel: "claude-sonnet-5-5",
          claudeCodeP: false,
        },
      ]);
      const leaving = await engineIdOf(page, "Leaving account");
      project = await addedProject(page, repository, "Removal shop", "RS");
      const overridden = await page.request.put("/api/roles/data-analyst/card", {
        data: { ...miasCard, roleOverride: { engineId: leaving, model: "claude-haiku-5-5" } },
      });
      expect(overridden.ok()).toBe(true);
      const defaulted = await page.request.put(`/api/projects/${project.id}/project-default`, {
        data: { projectDefault: { engineId: leaving, model: "claude-sonnet-5-5" } },
      });
      expect(defaulted.ok()).toBe(true);

      await page.goto("/settings/engines");
      await openEngine(page, "Leaving account");
      await page.getByRole("button", { name: "Remove Leaving account" }).click();
      const dialog = page.getByRole("dialog");
      const replacement = dialog.getByLabel("Replacement");
      const moves = dialog.getByRole("list", { name: "What moves" });
      const confirm = dialog.getByRole("button", { name: "Remove Leaving account" });
      // The Office default's engine is suggested.
      await expect(replacement).toHaveValue("claude-code");
      await expect(moves.getByRole("listitem")).toHaveCount(2);
      await expect(
        moves.getByRole("listitem").filter({ hasText: "The Role override of Mia · Data Analyst" }),
      ).toContainText("Haiku 5.5 on Leaving account → Haiku 5.5 on Claude Code");
      await expect(
        moves.getByRole("listitem").filter({ hasText: "The Project default of Removal shop" }),
      ).toContainText("Sonnet 5.5 on Leaving account → Sonnet 5.5 on Claude Code");
      await expect(confirm).toBeEnabled();

      // A replacement without a model a reference named gives its default model.
      await replacement.selectOption({ label: "People Strata" });
      await expect(
        moves.getByRole("listitem").filter({ hasText: "The Role override of Mia · Data Analyst" }),
      ).toContainText("Haiku 5.5 on Leaving account → org/coder:q4 on People Strata");

      await replacement.selectOption({ label: "Claude Code" });
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(
        page.getByText("Engine removed. What named it moved to the replacement."),
      ).toBeVisible();
      await expect(page.getByRole("group", { name: "Leaving account" })).toHaveCount(0);
      // Another engine shows in its place.
      await expect(shownEngine(page)).toHaveCount(1);

      const mia = roleSchema.parse(
        await (await page.request.get("/api/roles/data-analyst")).json(),
      );
      expect(mia.card.roleOverride).toEqual({ engineId: "claude-code", model: "claude-haiku-5-5" });
      const shop = projectSchema.parse(
        await (await page.request.get(`/api/projects/${project.id}`)).json(),
      );
      expect(shop.projectDefault).toEqual({ engineId: "claude-code", model: "claude-sonnet-5-5" });
    } finally {
      await page.request.put("/api/roles/data-analyst/card", { data: miasCard });
      if (project) {
        await page.request.put(`/api/projects/${project.id}/project-default`, {
          data: { projectDefault: null },
        });
      }
      if (await engineIdOf(page, "Leaving account")) await removeEngine(page, "Leaving account");
      await repository.remove();
    }
  },
);

test(
  "the user signs a Claude Code engine in by its sign-in page's code, pastes a token instead, and signs it out",
  { tag: "@full" },
  async ({ page }) => {
    const name = "Account check";
    await saveEngines(page, (saved) => [
      ...saved,
      { kind: "claude-code", name, defaultModel: "claude-haiku-5-5", claudeCodeP: false },
    ]);
    await page.goto("/settings/engines");
    await openEngine(page, name, "Account");
    const account = page
      .getByRole("group", { name, exact: true })
      .getByRole("group", { name: "Account" });
    await expect(account.getByText("Signed out", { exact: true })).toBeVisible();
    await expect(account.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    await account.getByRole("button", { name: "Sign in" }).click();
    // The stand-in's page; the user signs in there, in any browser, and brings its code back.
    await expect(account.getByRole("link", { name: "the sign-in page" })).toHaveAttribute(
      "href",
      "https://claude.com/cai/oauth/authorize?stand-in=true",
    );
    await account.getByLabel("Code").fill("stand-in-code");
    await account.getByRole("button", { name: "Finish" }).click();
    await expect(account.getByText("Signed in as stand-in@example.com · Claude Max")).toBeVisible();
    await expect(account.getByLabel("Code")).toHaveCount(0);

    // A Sign out from elsewhere reaches the open page by `engine.account-changed`.
    const engineId = engineSettingsSchema
      .parse(await (await page.request.get("/api/settings/engines")).json())
      .engines.find((engine) => engine.name === name)?.id;
    expect(engineId).toBeDefined();
    const signedOut = await page.request.delete(`/api/settings/engines/${engineId}/sign-in`);
    expect(signedOut.status()).toBe(204);
    await expect(account.getByText("Signed out", { exact: true })).toBeVisible();

    await account.getByRole("button", { name: "Paste a token instead" }).click();
    const token = account.getByLabel("Token");
    await expect(token).toHaveAttribute("type", "password");
    await token.fill("not-a-token");
    await account.getByRole("button", { name: "Save the token" }).click();
    await expect(
      account.getByText(
        "That is no token from `claude setup-token`: one starts with sk-ant-oat01-.",
      ),
    ).toBeVisible();
    await token.fill("sk-ant-oat01-stand-in");
    await account.getByRole("button", { name: "Save the token" }).click();
    await expect(account.getByText("A pasted token signs it in")).toBeVisible();
    // The token is never shown again: the box is gone, and reopened it is empty.
    await expect(account.getByLabel("Token")).toHaveCount(0);
    await account.getByRole("button", { name: "Paste a token instead" }).click();
    await expect(account.getByLabel("Token")).toHaveValue("");
    await account.getByRole("button", { name: "Cancel" }).click();

    await account.getByRole("button", { name: "Sign out" }).click();
    await expect(account.getByText("Signed out", { exact: true })).toBeVisible();
    await expect(account.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    // An Anthropic API key instead: refused unless shaped as one, kept, and never answered back.
    await account.getByRole("button", { name: "Use an API key" }).click();
    const keyBox = account.getByLabel("API key");
    await expect(keyBox).toHaveAttribute("type", "password");
    await keyBox.fill("sk-not-anthropic");
    await account.getByRole("button", { name: "Save the API key" }).click();
    await expect(
      account.getByText("That is no Anthropic API key: one starts with sk-ant-api."),
    ).toBeVisible();
    const key = "sk-ant-api03-e2e-stand-in-key";
    await keyBox.fill(key);
    await account.getByRole("button", { name: "Save the API key" }).click();
    await expect(account.getByText("An API key signs it in")).toBeVisible();
    await expect(account.getByLabel("API key")).toHaveCount(0);
    expect(await (await page.request.get("/api/settings/engines")).text()).not.toContain(key);

    await account.getByRole("button", { name: "Sign out" }).click();
    await expect(account.getByText("Signed out", { exact: true })).toBeVisible();
    await expect(account.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    await removeEngine(page, name);
  },
);

// Here for the same reason as the Claude Code engine's: a Save sends every engine, and Office
// limits' Save names every engine, so the engine it adds is gone again at its end.
test(
  "the user adds a Codex engine, signs it in with ChatGPT and with an API key, prices a model, renames and removes it",
  { tag: "@full" },
  async ({ page }) => {
    const name = "Codex check";
    const renamed = "Codex check renamed";
    const savedEngines = async () =>
      engineSettingsSchema.parse(await (await page.request.get("/api/settings/engines")).json())
        .engines;
    const saveSettings = async (): Promise<void> => {
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByText("Engines saved. Sessions started from now on use them."),
      ).toBeVisible();
    };
    const price = page.getByRole("group", { name: "Model price of gpt-6-luna" });
    try {
      await page.goto("/settings/engines");
      await addEngine(page, "Codex");
      const added = page.getByRole("group", { name: "the new Codex engine" });
      await added.getByLabel("Name", { exact: true }).fill(name);
      const engine = page.getByRole("group", { name, exact: true });
      await engine.getByLabel("Default model").selectOption({ label: "gpt-5.6-terra" });
      await page.getByRole("tab", { name: "Account" }).click();
      await expect(engine.getByText("It has no folder to sign in yet")).toBeVisible();
      await saveSettings();
      const engineId = (await savedEngines()).find((saved) => saved.name === name)?.id ?? "";
      expect(engineId).not.toBe("");

      await page.reload();
      await expect(
        page.getByRole("navigation", { name: "Engines" }).getByRole("button", {
          name: new RegExp(`^${name}`),
        }),
      ).toContainText("Codex");
      await openEngine(page, name);
      await expect(engine.getByLabel("Default model")).toHaveValue("gpt-5.6-terra");

      // Sign in with ChatGPT: the device page and its code, then the user approves there.
      await page.getByRole("tab", { name: "Account", exact: true }).click();
      const account = engine.getByRole("group", { name: "Account" });
      await expect(account.getByText("Signed out", { exact: true })).toBeVisible();
      await account.getByRole("button", { name: "Sign in with ChatGPT" }).click();
      const signingIn = account.getByRole("group", { name: "Sign in with ChatGPT" });
      await expect(signingIn.getByRole("link", { name: "the sign-in page" })).toHaveAttribute(
        "href",
        "https://auth.openai.com/codex/device",
      );
      await expect(signingIn.getByLabel("The code to enter")).toHaveText("STND-1NCODE");
      await expect(signingIn.getByText("Waiting for the sign-in to finish…")).toBeVisible();
      const approved = await page.request.post(
        `/api/e2e/codex-sign-ins/${encodeURIComponent(engineId)}/approval`,
      );
      expect(approved.status()).toBe(204);
      // Its end reaches the open page by `engine.account-changed`, without a reload.
      await expect(
        account.getByText("Signed in with ChatGPT as stand-in@example.com · ChatGPT Plus"),
      ).toBeVisible();
      await expect(signingIn).toHaveCount(0);

      // An API key instead: kept, and never answered back.
      const key = "sk-codex-e2e-stand-in-key";
      await account.getByRole("button", { name: "Use an API key instead" }).click();
      const keyBox = account.getByLabel("API key");
      await expect(keyBox).toHaveAttribute("type", "password");
      await keyBox.fill(key);
      await account.getByRole("button", { name: "Save the key" }).click();
      await expect(account.getByText("Signed in with an API key")).toBeVisible();
      await expect(account.getByLabel("API key")).toHaveCount(0);
      expect(await (await page.request.get("/api/settings/engines")).text()).not.toContain(key);

      await account.getByRole("button", { name: "Sign out" }).click();
      await expect(account.getByText("Signed out", { exact: true })).toBeVisible();
      await expect(account.getByRole("button", { name: "Sign out" })).toHaveCount(0);

      // A Codex model's price, kept across a reload.
      await page.getByRole("tab", { name: "Models and prices", exact: true }).click();
      await expect(
        engine.getByText("The Codex models' prices are shared by every Codex engine"),
      ).toBeVisible();
      await price.getByLabel("Input").fill("1.25");
      await price.getByLabel("Output").fill("10");
      await price.getByLabel("Cache writes").fill("0");
      await price.getByLabel("Cache reads").fill("0.125");
      await saveSettings();
      await page.reload();
      await openEngine(page, name, "Models and prices");
      await expect(price.getByLabel("Input")).toHaveValue("1.25");
      await expect(price.getByLabel("Cache reads")).toHaveValue("0.125");

      // Later tests price nothing, so the price goes again with the rename's Save.
      for (const kind of ["Input", "Output", "Cache writes", "Cache reads"]) {
        await price.getByLabel(kind).fill("");
      }

      // Renamed, it keeps its id.
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await engine.getByLabel("Name", { exact: true }).fill(renamed);
      await saveSettings();
      const kept = (await savedEngines()).find((saved) => saved.name === renamed);
      expect(kept?.id).toBe(engineId);
      expect((await savedEngines()).some((saved) => saved.name === name)).toBe(false);
      await page.reload();
      await openEngine(page, renamed, "Models and prices");
      await expect(price.getByLabel("Input")).toHaveValue("");

      // Removed through its dialog, onto the Office default's engine.
      await page.getByRole("button", { name: `Remove ${renamed}` }).click();
      const dialog = page.getByRole("dialog", { name: `Remove ${renamed}?` });
      await dialog.getByLabel("Replacement").selectOption({ label: "Claude Code" });
      await dialog.getByRole("button", { name: `Remove ${renamed}` }).click();
      await expect(
        page.getByText("Engine removed. What named it moved to the replacement."),
      ).toBeVisible();
      await expect(
        page
          .getByRole("navigation", { name: "Engines" })
          .getByRole("button", { name: new RegExp(`^${renamed}`) }),
      ).toHaveCount(0);
      expect((await savedEngines()).some((saved) => saved.id === engineId)).toBe(false);
    } finally {
      for (const each of await savedEngines()) {
        if (each.name === name || each.name === renamed) await removeEngine(page, each.name);
      }
    }
  },
);

test(
  "Assign… in Settings › Skills gives a skill to the people chosen",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

test.describe("dark", { tag: "@full" }, () => {
  test.use({ colorScheme: "dark" });

  test("the Role card form keeps its unsaved-changes bar readable", async ({ page }) => {
    await page.goto("/people/planner/role/edit");
    await page.locator("form.role-card-form").getByText("Chat", { exact: true }).click();
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-role-card-form.png") });
  });
});

test("a Role nobody fills has no page", { tag: "@full" }, async ({ page }) => {
  await page.goto("/people/devops");
  await expect(page.getByRole("link", { name: "Back to People" })).toBeVisible();
});

test(
  "with nobody in Devops' Role, installing a skill from a source says it needs one",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/settings/skills");
    await page.getByRole("button", { name: "Add a skill" }).click();
    const dialog = page.getByRole("dialog");

    await expect(dialog).toContainText(
      "Installing needs whoever holds Onboards and repairs Projects",
    );
    await expect(
      dialog.getByRole("link", { name: "hire someone on the People page." }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: /to install it$/ })).toHaveCount(0);
  },
);

// Hired after the tests above, which read the Developer's switch that consults Devops asking the
// user while nobody fills the Role.
test(
  "the user hires Devops from the preset, who installs alone and consults the CTO before publishing outside the Pipeline",
  { tag: "@full" },
  async ({ page }) => {
    await hireFromPreset(page, "Devops", "Nina");
    await expect(page).toHaveURL(/\/people\/devops$/);

    await page.goto("/people/devops/role");
    await expect(roleCardGroup(page, "Work")).toContainText("2 at once");
    const capabilities = roleCardGroup(page, "Capabilities").getByRole("listitem");
    for (const capability of ["Shared memory", "Chat", "Consultant", "Run environment"]) {
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
  },
);

/** The chat drawer, open beside the page. */
function chatWith(page: Page, name: string) {
  return page.getByRole("complementary", { name: `Chat with ${name}` });
}

/** The Thread the drawer shows, which the shell keeps for this browser tab. */
async function chatThreadShown(page: Page): Promise<string> {
  const chat = await page.evaluate(() => sessionStorage.getItem("the-office.chat"));
  const { roleKey, tabs = [] } = JSON.parse(chat ?? "{}") as {
    roleKey?: string;
    tabs?: { roleKey: string; threadId?: string }[];
  };
  return tabs.find((tab) => tab.roleKey === roleKey)?.threadId ?? "";
}

/** New thread sits in the Thread list and in the open Thread's bar, beside ‹ Threads. */
async function startNewThread(chat: Locator) {
  const page = chat.page();
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/chats\/[^/]+\/threads$/.test(response.url()),
  );
  await chat.getByRole("button", { name: "New thread", exact: true }).click();
  const { id } = (await (await started).json()) as { id: string };
  // The Thread shown until then can look the same, and is replaced under the pointer.
  await expect.poll(() => chatThreadShown(page)).toBe(id);
}

function contextLabel(page: Page) {
  return chatWith(page, "Jan").getByLabel("Context", { exact: true });
}

/** The Details switch of a chat or the Task page's conversation. */
function detailsSwitch(place: Locator) {
  return place.getByRole("group", { name: "Details" }).getByRole("switch");
}

/** The Auto mode switch beside Make a plan, in the Planner's tab of a Task in Backlog. */
function autoModeSwitch(place: Locator) {
  return place.locator("label", { hasText: "Auto mode" }).getByRole("switch");
}

// The engine replays e2e/sessions.jsonl: the Planner's first session, then a fresh one.
test("the user chats with the Planner, who reads but changes nothing", async ({ page }) => {
  await page.goto("/people");
  await page.getByRole("button", { name: "Open the chat with Jan" }).click();
  const chat = chatWith(page, "Jan");
  await expect(chat.getByText("No threads with Jan yet.")).toBeVisible();
  await startNewThread(chat);
  await expect(contextLabel(page)).toHaveText(/^Starts a session with a Brief ~[\d.]+k? tokens$/);
  // The context reading above the message input: no session to measure yet.
  await expect(chat.getByRole("img", { name: "Context: no session yet" })).toBeVisible();

  await chat.getByRole("textbox", { name: "Message" }).fill("Read the deploy workflow.");
  await chat.getByRole("textbox", { name: "Message" }).press("Enter");

  await expect(chat.getByText("It deploys to production on every push to main.")).toBeVisible();
  // Details starts off: the tool call and the context line hide, the refusal never does.
  await expect(chat.getByText("This session only reads: changes happen on Tasks.")).toBeVisible();
  await expect(detailsSwitch(chat)).toHaveAttribute("aria-checked", "false");
  await expect(chat.getByText(/deploy-production\.yml$/)).toHaveCount(0);
  await expect(chat.locator(".message-office")).toHaveCount(0);
  await detailsSwitch(chat).click();
  await expect(chat.getByText(/deploy-production\.yml$/)).toBeVisible();
  await expect(chat.locator(".message-office").first()).toBeVisible();
  await expect(chat.getByRole("heading", { name: "Read the deploy workflow" })).toBeVisible();
  // The size is the reading's, read as the turn ended; the Context bar's words leave it out.
  await expect(contextLabel(page)).toHaveText(/^Continues · cache warm, \d+ min left$/);
  await expect(chat.getByRole("img", { name: /^Context: 32k of \d+(\.\d)?[kM]$/ })).toBeVisible();
  await expect(chat.getByText("32k tokens in this Thread")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-chat.png") });

  // Each choice says what it would do and its cost, and the one taken says so beside it.
  const startFresh = chat.getByRole("tab", { name: "Start fresh" });
  await expect(startFresh).toHaveAttribute("title", /^Starts fresh · Brief ~[\d.]+k? tokens$/);
  await startFresh.click();
  await expect(startFresh).toHaveAttribute("aria-selected", "true");
  await expect(contextLabel(page)).toHaveText(/^Starts fresh · Brief ~[\d.]+k? tokens$/);
  await expect(chat.getByRole("tab", { name: "Continue" })).toHaveAttribute(
    "title",
    /^Continues · cache warm, \d+ min left$/,
  );
  await chat.getByRole("textbox", { name: "Message" }).fill("And the tests?");
  await chat.getByRole("textbox", { name: "Message" }).press("Enter");

  await expect(chat.getByText("The tests run with npm test.")).toBeVisible();
  await expect(chat.getByText(/^New session · you chose it · brief ~\d/)).toBeVisible();
  // The earlier session's messages fold into one closed block.
  await expect(chat.getByText(/^Earlier session · \d+ messages?/)).toBeVisible();
  // A fresh session's reading starts over.
  await expect(contextLabel(page)).toHaveText(/^Continues · cache warm, \d+ min left$/);
  await expect(chat.getByRole("img", { name: /^Context: 21k of / })).toBeVisible();

  // The browser remembers the switch.
  await page.reload();
  await expect(detailsSwitch(chatWith(page, "Jan"))).toHaveAttribute("aria-checked", "true");
  await expect(
    chatWith(page, "Jan").getByText(/^New session · you chose it · brief ~\d/),
  ).toBeVisible();
});

test("a Thread is renamed, and an old one stays readable and continues", async ({ page }) => {
  await page.goto("/people?chat=planner");
  const chat = chatWith(page, "Jan");
  await chat.getByRole("button", { name: "Rename the Thread" }).click();
  await chat.getByLabel("Thread title").fill("Deploys");
  await chat.getByRole("button", { name: "Save" }).click();
  await expect(chat.getByRole("heading", { name: "Deploys" })).toBeVisible();

  // New thread in the open Thread's bar starts and opens one in a click, without the list.
  const threadBar = chat.locator(".thread-view-head");
  await threadBar.getByRole("button", { name: "New thread", exact: true }).click();
  await expect(chat.getByRole("heading", { name: "New thread" })).toBeVisible();
  await expect(chat.getByText(/^Threads · /)).toHaveCount(0);
  await chat.getByRole("button", { name: "Threads", exact: true }).click();
  await expect(chat.getByText("Threads · 2")).toBeVisible();
  await chat.getByRole("button", { name: /^Deploys/ }).click();
  // Its first answer came in the session before the fresh one, folded until opened.
  await chat.getByText(/^Earlier session · \d+ messages?/).click();
  await expect(chat.getByText("It deploys to production on every push to main.")).toBeVisible();
  await chat.getByRole("textbox", { name: "Message" }).fill("Thanks.");
  await chat.getByRole("textbox", { name: "Message" }).press("Enter");

  await expect(chat.getByText("You're welcome.")).toBeVisible();
  await expect(contextLabel(page)).toHaveText(/^Continues · cache warm, \d+ min left$/);
  await expect(chat.getByRole("img", { name: /^Context: 21k of / })).toBeVisible();

  await page.reload();
  await expect(chatWith(page, "Jan").getByText("You're welcome.")).toBeVisible();
});

test(
  "the Planner's page lists their Threads under Conversations",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

test(
  "the user gives the Planner an Avatar, shown everywhere at once, then replaces and removes it",
  { tag: "@full" },
  async ({ page, context }) => {
    const dialogs: string[] = [];
    const peopleTab = await context.newPage();
    await peopleTab.goto("/people");
    const threadTab = await context.newPage();
    await threadTab.goto("/people/planner/conversations");
    await threadTab.getByRole("button", { name: /^Deploys/ }).click();
    const thread = chatWith(threadTab, "Jan");
    await expect(thread.getByText("You're welcome.")).toBeVisible();
    const cardAvatar = peopleTab.locator(".person-card", { hasText: "Jan" }).locator("img");
    const threadAvatars = thread.locator("img");
    await expect(cardAvatar).toHaveCount(0);

    await page.goto("/people/planner");
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const block = page.getByRole("group", { name: "Avatar" });
    const headAvatar = page.locator(".person-head img");
    await expect(block).toContainText("PNG, JPEG, WebP or SVG, at most 2 MB");
    await expect(block.getByRole("button", { name: "Remove" })).toHaveCount(0);

    await page.getByLabel("Avatar file").setInputFiles({
      name: "renamed.png",
      mimeType: "image/png",
      buffer: Buffer.from("<html>not a picture</html>"),
    });
    await expect(block.getByRole("alert")).toHaveText(
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    );
    await page.getByLabel("Avatar file").setInputFiles({
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(IMAGE_UPLOAD_BYTES + 1),
    });
    await expect(block.getByRole("alert")).toHaveText("An image may be at most 2 MB.");
    await expect(headAvatar).toHaveCount(0);

    await page.getByLabel("Avatar file").setInputFiles(AVATAR_FILE);

    await expectLoadedImage(headAvatar);
    await expect(block.getByRole("alert")).toHaveCount(0);
    await expect(block.getByRole("button", { name: "Replace" })).toBeVisible();
    await expectLoadedImage(cardAvatar);
    await expectLoadedImage(threadAvatars.first());
    const firstAddress = (await headAvatar.getAttribute("src")) ?? "";
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-avatar.png") });
    await peopleTab.screenshot({ path: path.join(SCREENSHOTS, "light-1600-people-avatar.png") });
    await threadTab.screenshot({ path: path.join(SCREENSHOTS, "light-1600-chat-avatar.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-person-avatar.png") });
    await page.emulateMedia({ colorScheme: "light" });

    await page.getByLabel("Avatar file").setInputFiles(AVATAR_WITH_A_SCRIPT);

    await expect(headAvatar).not.toHaveAttribute("src", firstAddress);
    await expectLoadedImage(headAvatar);
    await expect(cardAvatar).not.toHaveAttribute("src", firstAddress);
    const address = (await headAvatar.getAttribute("src")) ?? "";
    expect((await page.request.get(firstAddress)).status()).toBe(404);
    expect(await avatarFiles()).not.toContain(imageIdOf(firstAddress));
    expect(await avatarFiles()).toContain(imageIdOf(address));
    const opened = await context.newPage();
    opened.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await opened.goto(address);
    await expect(opened.locator("svg")).toBeAttached();
    await expect(opened.locator("svg")).not.toHaveAttribute("data-script-ran", "yes");
    await opened.close();
    expect(dialogs).toEqual([]);

    await block.getByRole("button", { name: "Remove" }).click();

    await expect(headAvatar).toHaveCount(0);
    await expect(page.locator(".person-head")).toContainText("J");
    await expect(cardAvatar).toHaveCount(0);
    await expect(threadAvatars).toHaveCount(0);
    expect(await avatarFiles()).not.toContain(imageIdOf(address));
    await expect(block).toContainText("No Avatar");
    await peopleTab.close();
    await threadTab.close();
  },
);

test(
  "someone let go keeps showing their Avatar, which changes only once they are hired back",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/people/data-analyst");
    const block = page.getByRole("group", { name: "Avatar" });
    const avatar = page.locator(".person-head img");
    await page.getByLabel("Avatar file").setInputFiles(AVATAR_FILE);
    await expectLoadedImage(avatar);

    await page.getByRole("button", { name: "Let go", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Let Mia go" }).click();

    await expect(page.getByText("Mia was let go", { exact: true })).toBeVisible();
    await expectLoadedImage(avatar);
    await expect(block).toContainText("Hire Mia back to change it.");
    await expect(block.getByRole("button")).toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-avatar-let-go.png") });
    const refused = await page.request.delete("/api/roles/data-analyst/avatar");
    expect(refused.status()).toBe(422);

    await page.getByRole("button", { name: "Hire Mia back" }).click();
    await block.getByRole("button", { name: "Remove" }).click();

    await expect(avatar).toHaveCount(0);
  },
);

test(
  "the user adds a note to the Planner's Memory, deletes one, then deletes the whole memory",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

test(
  "a person whose Shared memory is off shows their Memory as not in use",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/people/developer/memory");

    await expect(page.getByText("Not in use")).toBeVisible();
    await expect(page.getByText("Add a note")).toHaveCount(0);
  },
);

/** A new Project's install command and the commands every Project starts with. */
type ProjectCommandLines = Pick<NewProject, "installCommand" | "commands">;

function commandLinesOf(
  installCommand: string,
  lines: Readonly<Record<"build" | "lint" | "test", string>>,
): ProjectCommandLines {
  return {
    installCommand,
    commands: [
      { key: "build", name: "Build", kind: "build", commandLine: lines.build },
      { key: "lint", name: "Lint", kind: "lint", commandLine: lines.lint },
      { key: "test", name: "Test", kind: "test", commandLine: lines.test },
    ],
  };
}

/** Adds a Project on a repository of its own through the API. */
async function addedProject(
  page: Page,
  repository: TemporaryRepository,
  name: string,
  label: string,
  commands: ProjectCommandLines = commandLinesOf("npm ci", {
    build: "npm run build",
    lint: "npm run lint",
    test: "npm test",
  }),
): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label, colour: "violet" },
    ...commands,
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  return projectSchema.parse(await added.json());
}

test(
  "a person's Work tab lists the Tasks whose Stages they work, in the Projects the filter shows",
  { tag: "@full" },
  async ({ page }) => {
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
        // A new Task has no Pipeline until one is chosen: Full's Stages are the Developer's part.
        const { id } = taskSchema.parse(await created.json());
        await page.request.put(`/api/tasks/${id}/pipeline`, { data: { pipelineId: "full" } });
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

      // Only while narrowed to this Project: other files' Tasks reach Done in the shared database.
      await page.getByRole("button", { name: /^Done/ }).click();
      await expect(page.getByText("No Tasks here. Try another filter.")).toBeVisible();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-person-work.png") });

      await page.getByRole("button", { name: /^All 1$/ }).click();
      await page.getByRole("button", { name: /in other Projects.*Show all projects/ }).click();
      await expect(elsewhereRow).toBeVisible();
    } finally {
      await repository.remove();
    }
  },
);

/** A Stage among the rail's, not a run of its history. */
/** A window narrow enough that the Stages of `seedGatedStages` don't fit across the rail. */
const NARROW_WIDTH_PX = 640;
const DRAWER_WIDTH_PX = 900;

/** Changes the palette the system asks for and waits for the buttons' colours to finish changing. */
async function showPalette(page: Page, palette: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: palette });
  await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
  await motionSettled(page);
}

/** Waits out what is changing; a running Task's "is working" line never stops. */
async function motionSettled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.effect?.getComputedTiming().iterations === Infinity),
  );
}

async function scrollLeftOf(scroller: Locator): Promise<number> {
  return scroller.evaluate((view) => view.scrollLeft);
}

/** Whether a Stage's whole column shows inside the rail's scroller. */
async function stageIsInRailView(rail: Locator, stage: Locator): Promise<boolean> {
  const view = await rail.locator(".pipeline-rail-scroll").boundingBox();
  const shown = await stage.boundingBox();
  if (view === null || shown === null) return false;
  return shown.x >= view.x && shown.x + shown.width <= view.x + view.width;
}

function conversationHandle(page: Page): Locator {
  return page.getByRole("button", { name: /^Conversation/ });
}

/** How far the window itself scrolls sideways, which nothing on a page should make it do. */
function windowOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

function stageOnRail(rail: Locator, name: string): Locator {
  return rail
    .getByRole("list", { name: "Stages" })
    .getByRole("listitem")
    .filter({ has: rail.page().getByRole("button", { name, exact: true }) });
}

/** The flow editor's panel for the picked Stage (named after it) or route ("Route"). */
function flowPanel(window: Locator, name: string): Locator {
  return window.getByRole("region", { name, exact: true });
}

/**
 * Edit for this Task, open on `window`, in Light and Dark at 1600, 900 and 390 wide: nothing in the
 * window or the page scrolls sideways. Left in Light at 1600.
 */
async function editForThisTaskScreenshots(page: Page, window: Locator): Promise<void> {
  for (const palette of ["light", "dark"] as const) {
    await showPalette(page, palette);
    for (const width of [1600, 900, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => windowOverflow(page)).toBe(0);
      expect(
        await window
          .locator(".dialog-body")
          .evaluate((body) => body.scrollWidth - body.clientWidth),
      ).toBe(0);
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${palette}-${width}-edit-for-this-task.png`),
        style: ".toasts { visibility: hidden; }",
      });
    }
  }
  await showPalette(page, "light");
  await page.setViewportSize({ width: 1600, height: 900 });
}

/** Chooses the person whose Role title is `title` among the people in the Stage's "Who works it". */
async function chooseWhoWorks(row: Locator, title: string): Promise<void> {
  const list = await openPipelinePicker(row, "Who works it");
  await list
    .getByRole("group", { name: "People", exact: true })
    .getByRole("option", { name: new RegExp(` · ${title}$`) })
    .click();
}

test(
  "Edit for this Task swaps the Pipeline and sets every field of its Stages, which hold after a reload",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Stage editor", "SE");
      const created = await page.request.post("/api/tasks", {
        data: { title: "Keep the filters on reload", projectId: project.id, priority: "normal" },
      });
      const { id: taskId } = taskSchema.parse(await created.json());
      // A new Task has no Pipeline yet: it follows Full from here, to be swapped below.
      const pipelineId = "full";
      await page.request.put(`/api/tasks/${taskId}/pipeline`, { data: { pipelineId } });
      const library = pipelineListSchema.parse(
        await (await page.request.get("/api/pipelines")).json(),
      );
      await page.goto(`/tasks/${taskId}`);

      await page.getByRole("button", { name: "Edit for this Task" }).click();
      const dialog = page.getByRole("dialog");
      const flow = dialog.getByRole("region", { name: "Flow" });
      const onFlow = (name: string): Locator => flow.getByRole("button", { name, exact: true });
      const panel = (name: string): Locator => flowPanel(dialog, name);
      const addAStage = async (kind: string): Promise<void> => {
        await dialog.getByRole("button", { name: "Add a Stage" }).click();
        await page.getByRole("menu").getByRole("button", { name: kind, exact: true }).click();
      };
      await expect(dialog).toContainText("Changes apply to Keep the filters on reload only.");
      await pickPipeline(dialog, "Pipeline", "Quick fix");
      await expect(onFlow("Publish")).toBeVisible();
      await expect(onFlow("Review & fix")).toHaveCount(0);

      // Another Pipeline is a draft: closing the window leaves the Task as it was.
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const untouched = taskSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}`)).json(),
      );
      expect(untouched.pipelineId).toBe(pipelineId);

      // Saved alone, the swap keeps the Task following the library.
      await page.getByRole("button", { name: "Edit for this Task" }).click();
      await pickPipeline(dialog, "Pipeline", "Quick fix");
      await dialog.getByRole("button", { name: "Save for this Task" }).click();
      await expect(page.getByText("Stages saved for Keep the filters on reload.")).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Pipeline · Quick fix", exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "Edit for this Task" }).click();
      await expect(dialog.getByRole("combobox", { name: "Pipeline", exact: true })).toHaveText(
        "Quick fix",
      );

      // A Gate goes on the route from Tests to Publish, picked to be named.
      await onFlow("Tests").click();
      await panel("Tests")
        .getByRole("region", { name: "Routes out" })
        .getByRole("button", { name: /→ Publish/ })
        .click();
      await expect(panel("Route")).toContainText("Route from Tests to Publish");
      await panel("Route").getByRole("button", { name: "Insert a Stage on this route" }).click();
      await page.getByRole("menu").getByRole("button", { name: "Gate", exact: true }).click();
      await panel("Gate").getByLabel("Name", { exact: true }).fill("UI acceptance");
      await expect(onFlow("UI acceptance")).toBeVisible();

      await onFlow("Implement").click();
      const implement = panel("Implement");
      await chooseWhoWorks(implement, "Reviewer");
      // A Stage has no model of its own: the engine cascade gives it.
      await expect(implement.getByLabel("Model")).toHaveCount(0);
      await implement.getByLabel("Effort").selectOption("high");
      await implement.getByLabel("Budget").fill("120");
      await implement.getByLabel("Brief").fill("Keep the filters in the address.");
      // The Stage narrows the Reviewer's permission profile, offered nothing wider than the card.
      const runs = implement.getByLabel("Runs", { exact: true });
      await expect(runs.locator("option")).toHaveText([
        "Role default: Runs the Project's commands and read-only git",
        "Runs read-only git only",
      ]);
      await expect(implement.getByLabel("Files", { exact: true }).locator("option")).toHaveText([
        "Role default: Reads files only",
      ]);
      await runs.selectOption({ label: "Runs read-only git only" });
      await implement.getByLabel("Web", { exact: true }).selectOption({ label: "No web" });
      // It keeps only the Project commands listed, picked from the Project's keys.
      const commandBox = implement.getByLabel("Add a Project command");
      await expect(commandBox).toHaveAttribute(
        "placeholder",
        "Role default: every Project command",
      );
      await commandBox.fill("test");
      await commandBox.press("Enter");
      await expect(implement.getByRole("group", { name: "Project commands" })).toContainText(
        "test",
      );
      await implement
        .getByText("Only these of the Project's commands; never install")
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-edit-for-this-task-project-commands.png"),
      });

      // An Agent Stage added beside Implement comes unconnected: the check's problems hold Save.
      const save = dialog.getByRole("button", { name: "Save for this Task" });
      const problems = dialog.getByRole("list", { name: "Problems" });
      await addAStage("Agent Stage");
      const added = panel("New Stage");
      await expect(added).toContainText("2 of 5 in the Pipeline's order");
      await expect(problems).toContainText("New Stage: give it a route out");
      await expect(save).toBeDisabled();
      // Moved later it goes after Tests, earlier back before it, and up into Implement's row.
      await added.getByRole("button", { name: "Move New Stage later" }).click();
      await expect(added).toContainText("3 of 5 in the Pipeline's order");
      await added.getByRole("button", { name: "Move New Stage earlier" }).click();
      await expect(added).toContainText("2 of 5 in the Pipeline's order");
      await added.getByRole("button", { name: "Move New Stage up" }).click();
      await expect(added.getByRole("button", { name: "Move New Stage up" })).toBeDisabled();
      // Implement's route leads to it, and it on to Tests.
      await onFlow("Implement").click();
      await implement
        .getByRole("region", { name: "Routes out" })
        .getByRole("button", { name: /→ Tests/ })
        .click();
      await panel("Route").getByLabel("Goes to").selectOption({ label: "New Stage" });
      await onFlow("New Stage").click();
      await added.getByRole("button", { name: "Add a route" }).click();
      await expect(panel("Route")).toContainText("Route from New Stage to Tests");
      await expect(problems).not.toContainText("give it a route out");
      // It continues Implement's session with the same Role, and with someone to work it the
      // problems go.
      await onFlow("New Stage").click();
      await chooseWhoWorks(added, "Reviewer");
      await expect(problems).toHaveCount(0);
      await added.getByLabel("Session").selectOption("continue");
      // A Stage is no longer optional: the walk follows its routes, and the form offers no Optional.
      await expect(added.getByText(/^Optional/)).toHaveCount(0);
      await added.getByLabel("Name", { exact: true }).fill("Review");

      // On failure, Tests goes back to Review, offered only the Stages before it.
      await onFlow("Tests").click();
      const tests = panel("Tests");
      const onFailure = tests
        .getByRole("region", { name: "On failure" })
        .getByRole("combobox", { name: "On failure" });
      await expect(onFailure.locator("option")).toHaveText([
        "No loop",
        "Go back to Implement",
        "Go back to Review",
      ]);
      await onFailure.selectOption({ label: "Go back to Review" });
      await tests.getByLabel("Project command").selectOption("lint");
      await expect(tests.getByRole("list", { name: "When Tests fails" })).toContainText(
        "Back to Review while it has rounds left: at most 2 times.",
      );

      // A Script Stage added and removed again leaves nothing behind.
      await addAStage("Script Stage");
      await panel("Script").getByRole("button", { name: "More for Script" }).click();
      await page.getByRole("menu").getByRole("button", { name: "Remove Script" }).click();
      await expect(onFlow("Script")).toHaveCount(0);
      await expect(problems).toHaveCount(0);

      await onFlow("Tests").click();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-edit-for-this-task.png") });
      await save.click();
      // The window closes on saving: the swap's toast, in the same words, may still be up.
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByText("Stages saved for Keep the filters on reload.").last(),
      ).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole("region", { name: "Pipeline · Quick fix · edited for this Task" }),
      ).toBeVisible();
      const own = taskStagesSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
      );
      const ownStages = own.stages?.map(({ stage }) => stage) ?? [];
      const quickFix = library.find(({ id }) => id === "quick-fix")?.stages ?? [];
      const [libraryImplement, libraryTests, libraryPublish] = asStageList(quickFix);
      expect(asStageList(ownStages)).toEqual([
        {
          ...libraryImplement,
          // Choosing the Reviewer clears the Implements duty the library's Stage names.
          duty: undefined,
          role: "reviewer",
          effort: "high",
          budget: 120_000,
          brief: "Keep the filters in the address.",
          permissions: { run: "read-only-git", web: false, commands: ["test"] },
        },
        {
          kind: "agent",
          key: "new-stage",
          name: "Review",
          optional: false,
          role: "reviewer",
          brief: "",
          session: "continue",
          budget: 100_000,
        },
        { ...libraryTests, command: "lint", onFailure: { goBackTo: "new-stage", rounds: 2 } },
        { kind: "gate", key: "gate", name: "UI acceptance", optional: false },
        libraryPublish,
      ]);
      // The routes are the line drawn: Implement, Review, Tests, UI acceptance, Publish, End.
      expect(ownStages.map(({ key, routes }) => [key, routes?.map(({ to }) => to)])).toEqual([
        ["implement", ["new-stage"]],
        ["new-stage", ["tests"]],
        ["tests", ["gate"]],
        ["gate", ["publish"]],
        ["publish", [null]],
      ]);
      // The library's Quick fix stays as it was.
      expect(
        pipelineListSchema
          .parse(await (await page.request.get("/api/pipelines")).json())
          .find(({ id }) => id === "quick-fix")?.stages,
      ).toEqual(quickFix);

      // The editor opens on what was saved.
      await page.getByRole("button", { name: "Edit for this Task" }).click();
      await onFlow("Implement").click();
      await expect(implement.getByLabel("Effort")).toHaveValue("high");
      await expect(implement.getByLabel("Budget")).toHaveValue("120");
      await expect(implement.getByLabel("Runs", { exact: true })).toHaveValue("read-only-git");
      await onFlow("Tests").click();
      await expect(onFailure).toHaveValue("new-stage");
      await expect(onFlow("Review")).toBeVisible();
      await expect(onFlow("UI acceptance")).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();

      // From the board card's menu, selecting and typing in the editor leaves the card where it is.
      await page.goto("/work");
      await page
        .getByRole("article", { name: "Keep the filters on reload" })
        .getByRole("button", { name: "More for Keep the filters on reload" })
        .click();
      await page
        .getByRole("menu")
        .getByRole("button", { name: "Edit Stages for this Task" })
        .click();
      await onFlow("Implement").click();
      const brief = implement.getByLabel("Brief");
      await brief.scrollIntoViewIfNeeded();
      const box = await brief.boundingBox();
      if (!box) throw new Error("The Brief isn't shown.");
      await page.mouse.move(box.x + 8, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 10, { steps: 5 });
      await page.mouse.up();
      await implement.getByLabel("Name", { exact: true }).press("End");
      await page.keyboard.type(" again");
      await expect(page).toHaveURL(/\/work$/);
      await expect(onFlow("Implement again")).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await repository.remove();
    }
  },
);

test(
  "the user gives Ola an MCP server on the Role card, sets a tool, and a Stage only narrows it",
  { tag: "@full" },
  async ({ page }) => {
    const server = "e2e-role-card-server";
    await addFakeMcpServerTurnedOn(page, server);
    const repository = await createTemporaryRepository();
    try {
      await page.goto("/people/reviewer/role/edit");
      const form = page.locator("form.role-card-form");
      const part = form.getByRole("group", { name: `MCP server ${server}` });
      await expect(part).toContainText("On, with 3 tools");
      await part.getByText(server, { exact: true }).click();
      const echo = part.getByLabel(`MCP tool ${server}/echo`);
      // Every tool starts at Consult Devops.
      await expect(echo).toHaveValue("consult:devops");
      await echo.selectOption({ label: "Allowed" });
      await expect(page.getByText("You have unsaved changes.")).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-role-card-form-mcp-servers.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Save changes" }).click();

      await expect(
        page.getByText("Role card saved. Ola works with it from the next session."),
      ).toBeVisible();
      const onCard = roleCardGroup(page, "MCP servers").getByRole("listitem", {
        name: `MCP server ${server}`,
      });
      await expect(onCard).toContainText("On");
      await expect(onCard).toContainText("echoAllowed");
      await expect(onCard).toContainText("environment-variableConsult Devops");
      const role = roleSchema.parse(await (await page.request.get("/api/roles/reviewer")).json());
      // The card keeps only what the user set.
      expect(role.card.permissionProfile.mcpTools).toEqual({
        [`${server}/echo`]: { kind: "allowed" },
      });

      // A Stage worked by Ola offers only what is narrower than the card for each tool.
      const project = await addedProject(page, repository, "MCP tools", "MT");
      const created = await page.request.post("/api/tasks", {
        data: { title: "Echo through the MCP server", projectId: project.id, priority: "normal" },
      });
      const { id: taskId } = taskSchema.parse(await created.json());
      // A new Task has no Pipeline until one is chosen; its Stages are edited from then on.
      await page.request.put(`/api/tasks/${taskId}/pipeline`, { data: { pipelineId: "full" } });
      await page.goto(`/tasks/${taskId}`);
      await page.getByRole("button", { name: "Edit for this Task" }).click();
      await pickPipeline(page.getByRole("dialog"), "Pipeline", "Quick fix");
      await page
        .getByRole("dialog")
        .getByRole("region", { name: "Flow" })
        .getByRole("button", { name: "Implement", exact: true })
        .click();
      const implement = flowPanel(page.getByRole("dialog"), "Implement");
      await chooseWhoWorks(implement, "Reviewer");
      await expect(
        implement.getByLabel(`MCP tool ${server}/environment-variable`).locator("option"),
      ).toHaveText(["Role default: Consult Devops", "Ask me", "Never"]);
      const stageEcho = implement.getByLabel(`MCP tool ${server}/echo`);
      await expect(stageEcho.locator("option").first()).toHaveText("Role default: Allowed");
      await expect(stageEcho.locator("option", { hasText: /^Allowed$/ })).toHaveCount(0);
      await stageEcho.selectOption({ label: "Ask me" });
      await page.getByRole("dialog").getByRole("button", { name: "Save for this Task" }).click();
      await expect(page.getByText("Stages saved for Echo through the MCP server.")).toBeVisible();

      const own = taskStagesSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
      );
      const narrowed = own.stages?.map(({ stage }) => stage).find(({ key }) => key === "implement");
      expect(narrowed?.kind === "agent" && narrowed.permissions).toEqual({
        mcpTools: { [`${server}/echo`]: { kind: "ask-me" } },
      });
    } finally {
      // Ola's later sessions start without it.
      await page.request.put(`/api/mcp-servers/${server}/roles`, { data: { roles: [] } });
      await repository.remove();
    }
  },
);

const QUERY_QUESTION = "Should sign-in keep the query string on the way back?";

/**
 * The Task the user plans and then starts, with its repository, kept from one test to the next. Its
 * Project's commands pass anywhere, so its Stages run without npm.
 */
const signIn: { repository?: TemporaryRepository; taskUrl?: string } = {};
const PASSING_COMMANDS = commandLinesOf("node --version", {
  build: "node --version",
  lint: "node --version",
  test: "node --version",
});

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
  const task = taskSchema.parse(await created.json());
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("button", { name: "Plan with Jan" }).click();

  signIn.taskUrl = page.url();
  await expect(
    page.getByText(
      "Sign-in returns to the page is in Planning: message Jan to start, or write the Plan yourself.",
    ),
  ).toBeVisible();
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  await expect(conversation.getByRole("tab", { name: /Jan/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Jan starts on the user's first message, not as the Task moves to Planning.
  const message = conversation.getByRole("textbox", { name: "Message" });
  await message.fill("Signing in should bring me back to the page I was on.");
  await message.press("Enter");
  const needsYou = page.getByRole("region", { name: "Needs you" });
  const decision = needsYou.getByRole("region", { name: `Decision: ${QUERY_QUESTION}` });
  await expect(
    decision.getByText("Jan recommends “Keep the query string”: Filters live in the query string."),
  ).toBeVisible();
  await expect(needsYou).toContainText("1 Decision");
  const inThread = conversation.getByRole("region", { name: `Decision: ${QUERY_QUESTION}` });
  await expect(inThread).toContainText("Waits on you.");
  await expect(inThread.getByRole("button", { name: "Keep the query string" })).toHaveCount(0);
  // The first context line opens to show the Brief the session started with.
  const briefToggle = conversation.getByText("Brief", { exact: true });
  await expect(briefToggle).toHaveCount(0);
  await detailsSwitch(conversation).click();
  // A card shows its tool's call, so even Details leaves the line out.
  await expect(conversation.getByText(OPEN_DECISION_TOOL)).toHaveCount(0);
  const brief = conversation.locator(".message-brief-text");
  await expect(brief).toBeHidden();
  await briefToggle.first().click();
  await expect(brief).toContainText("You are planning a Task with the user");
  await expect(brief).toContainText("Sign-in returns to the page (Task ");
  await expect(page.getByText("Waiting on you", { exact: true })).toBeVisible();

  const record = page.getByRole("region", { name: "Record" });
  const plan = record.getByRole("region", { name: "Plan", exact: true });
  const definitionOfDone = record.getByRole("region", { name: "Definition of Done" });
  // In Planning Before Ready holds the card's place, under the open Decision.
  const beforeReady = page.getByRole("region", { name: "Before Ready" });
  const readinessLine = (label: string): Locator =>
    beforeReady.getByRole("listitem").filter({ hasText: label });
  // The Planner's Pipeline proposal sits at the rail's foot.
  const proposedPipeline = page
    .getByRole("region", { name: /^Pipeline · / })
    .getByRole("region", { name: "Pipeline proposal" });
  await expect(plan.getByText("Not confirmed")).toBeVisible();
  await expect(definitionOfDone.getByText("The tests pass.")).toBeVisible();
  await expect(proposedPipeline.getByText(/A small change with tests/)).toBeVisible();

  // Mark Ready waits for a Pipeline and no open Decision; "Before Ready", read-only, says where each
  // unmet line is settled, and each ticks as it is met. Its lines are checked before the layout is
  // measured: until the Planner and the Pipelines load, a line's wording, and so its height, changes.
  const markReady = page.getByRole("button", { name: "Mark Ready" });
  await expect(markReady).toBeDisabled();
  await expect(readinessLine("Plan confirmed")).toContainText("Confirm it on the Plan");
  await expect(readinessLine("Definition of Done confirmed")).toContainText(
    "Confirm it on the Definition of Done",
  );
  await expect(readinessLine("Pipeline chosen")).toContainText(
    "Jan proposes Quick fix · confirm it on the rail",
  );
  await expect(readinessLine("No Decision open")).toContainText("1 open, in Needs you");
  await expect(beforeReady.locator(".task-checklist-met")).toHaveCount(0);
  await expect(beforeReady.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);

  const beforeReadyBox = await beforeReady.boundingBox();
  const needsYouBox = await needsYou.boundingBox();
  // Both in the record's column, above its tabs: what waits first, Before Ready under it.
  const overviewTabBox = await page.getByRole("tab", { name: "Overview" }).boundingBox();
  expect(beforeReadyBox?.x).toBe(needsYouBox?.x);
  expect(beforeReadyBox?.width).toBe(needsYouBox?.width);
  expect(beforeReadyBox?.y).toBeGreaterThan((needsYouBox?.y ?? 0) + (needsYouBox?.height ?? 0));
  expect(overviewTabBox?.y).toBeGreaterThan(
    (beforeReadyBox?.y ?? 0) + (beforeReadyBox?.height ?? 0),
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-planning.png") });
  await showPalette(page, "dark");
  await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-task-planning.png") });
  await showPalette(page, "light");

  // Confirm sits on the part's own block; Before Ready's link leads there.
  await readinessLine("Plan confirmed").getByRole("button", { name: "on the Plan" }).click();
  await expect(plan).toBeInViewport();
  await plan.getByRole("button", { name: "Confirm" }).click();
  await expect(plan.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(plan.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await expect(readinessLine("Plan confirmed")).toHaveClass(/task-checklist-met/);
  await expect(readinessLine("Plan confirmed").getByRole("button")).toHaveCount(0);
  await definitionOfDone.getByRole("button", { name: "Confirm" }).click();
  await expect(definitionOfDone.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(readinessLine("Definition of Done confirmed")).toHaveClass(/task-checklist-met/);
  // A part stays editable; a changing Save leaves it unconfirmed, and the Task in Planning.
  await definitionOfDone.getByRole("button", { name: "Edit" }).click();
  await definitionOfDone
    .getByRole("textbox")
    .fill("Signing in returns to the page and its query string.\nThe tests pass.");
  await definitionOfDone.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    definitionOfDone.getByText("Signing in returns to the page and its query string."),
  ).toBeVisible();
  await expect(definitionOfDone.getByText("Not confirmed", { exact: true })).toBeVisible();
  await expect(readinessLine("Definition of Done confirmed")).not.toHaveClass(/task-checklist-met/);
  await definitionOfDone.getByRole("button", { name: "Confirm" }).click();
  await expect(definitionOfDone.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(readinessLine("Definition of Done confirmed")).toHaveClass(/task-checklist-met/);
  await expect(readinessLine("Pipeline chosen")).not.toHaveClass(/task-checklist-met/);
  const otherPipelines = await openPipelinePicker(proposedPipeline, "Another Pipeline");
  await expect(otherPipelines.getByRole("option", { name: "Document", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await proposedPipeline.getByRole("button", { name: "Use Quick fix" }).click();
  await expect(page.getByRole("region", { name: "Pipeline · Quick fix" })).toBeVisible();
  await expect(page.getByText(/A small change with tests/)).toHaveCount(0);
  await expect(readinessLine("Pipeline chosen")).toHaveClass(/task-checklist-met/);
  await expect(markReady).toBeDisabled();

  await pickAndSubmit(decision, "Keep the query string");
  await expect(conversation.getByText("The query string stays, as the Plan says.")).toBeVisible();
  await expect(decision).toHaveCount(0);
  await expectAnsweredByYou(inThread, "Keep the query string (recommended)");
  await expect(page.getByText("Waiting on you", { exact: true })).toHaveCount(0);
  await expect(readinessLine("No Decision open")).toHaveClass(/task-checklist-met/);

  await expect(markReady).toBeEnabled();
  await markReady.click();
  await expect(
    page.getByText("Sign-in returns to the page is Ready. Starting it is your call."),
  ).toBeVisible();
  await expect(needsYou).toContainText("Ready: start it when you want; nothing starts by itself.");
  await expect(beforeReady).toHaveCount(0);

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
  await page.getByRole("link", { name: /^Planning\s*Sign-in returns to the page$/ }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\?taskThread=[0-9a-f-]+$/);
  await expect(
    page.getByRole("complementary", { name: "Conversation" }).getByRole("tab", { name: /Jan/ }),
  ).toHaveAttribute("aria-selected", "true");
});

// The engine replays the next session in e2e/sessions.jsonl: Jan writes the Plan and the
// Definition of Done from the record, with no message from the user.
test("the user has Jan make a plan from the title and the Description, then confirms it and marks it Ready", async ({
  page,
}) => {
  const signInTask = taskSchema.parse(
    await (await page.request.get(`/api/tasks/${signIn.taskUrl?.split("/").at(-1)}`)).json(),
  );
  const title = "Lists keep their sort order";
  const description = "Each list opens **sorted as I left it**, column and direction.";
  const created = await page.request.post("/api/tasks", {
    data: { title, description, projectId: signInTask.projectId, priority: "normal" },
  });
  expect(created.status()).toBe(201);
  const task = taskSchema.parse(await created.json());
  await page.goto(`/tasks/${task.id}`);

  const record = page.getByRole("region", { name: "Record" });
  await expect(record.getByRole("region", { name: "Description" })).toContainText(
    "Each list opens sorted as I left it, column and direction.",
  );
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  await expect(conversation).toContainText(
    "Jan plans from the title and the Description, so there is nothing more to write.",
  );
  await expect(page.getByRole("region", { name: "Before Ready" })).toHaveCount(0);
  // Auto mode is off until first chosen.
  await expect(autoModeSwitch(conversation)).toHaveAttribute("aria-checked", "false");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-make-a-plan.png") });

  // The card's Plan is Make a plan too, in the remembered auto mode: the board stays open while
  // Jan plans.
  await page.goto("/work");
  await page
    .getByRole("region", { name: "Backlog", exact: true })
    .getByRole("article", { name: title })
    .getByRole("button", { name: "Plan", exact: true })
    .click();
  await expect(page.getByText(`${title} is in Planning: Jan is making a plan.`)).toBeVisible();
  await expect(page).toHaveURL(/\/work(\?.*)?$/);
  await expect(
    page
      .getByRole("region", { name: "Planning", exact: true })
      .getByRole("article", { name: title })
      .getByRole("img", { name: "Planning with Jan" }),
  ).toBeVisible();
  await page.goto(`/tasks/${task.id}`);

  // Jan starts at once, from the record, the Description in the Brief.
  await expect(
    conversation.getByText(
      "I read the title and the Description, and wrote the Plan and the Definition of Done.",
    ),
  ).toBeVisible();
  await detailsSwitch(conversation).click();
  await conversation.getByText("Brief", { exact: true }).first().click();
  await expect(conversation.locator(".message-brief-text")).toContainText(
    "Each list opens sorted as I left it, column and direction.",
  );

  // Jan marked it planned, which with auto mode off leaves it for the user's Confirm.
  const plan = record.getByRole("region", { name: "Plan", exact: true });
  const definitionOfDone = record.getByRole("region", { name: "Definition of Done" });
  await expect(plan).toContainText("Remember the sort column and its direction per list");
  expect(
    taskSchema.parse(await (await page.request.get(`/api/tasks/${task.id}`)).json()).state,
  ).toBe("planning");
  await plan.getByRole("button", { name: "Confirm" }).click();
  await expect(plan.getByText("Confirmed", { exact: true })).toBeVisible();
  await definitionOfDone.getByRole("button", { name: "Confirm" }).click();
  await expect(definitionOfDone.getByText("Confirmed", { exact: true })).toBeVisible();
  // The Task has no Pipeline until the one Jan proposed is taken.
  await page
    .getByRole("region", { name: "Pipeline proposal" })
    .getByRole("button", { name: "Use Quick fix" })
    .click();
  await expect(page.getByRole("region", { name: "Pipeline · Quick fix" })).toBeVisible();
  const markReady = page.getByRole("button", { name: "Mark Ready" });
  await expect(markReady).toBeEnabled();
  await markReady.click();
  await expect(page.getByText(`${title} is Ready. Starting it is your call.`)).toBeVisible();

  // Nothing of it is left to weigh on the next tests' Start.
  expect((await page.request.post(`/api/tasks/${task.id}/drop`)).status()).toBe(200);
});

// The engine replays the next session in e2e/sessions.jsonl: Jan writes the three parts and marks
// the Task planned, and auto mode marks it Ready with nothing clicked.
test("the user has Jan make a plan in auto mode, and the Task is Ready without a Confirm", async ({
  page,
}) => {
  const signInTask = taskSchema.parse(
    await (await page.request.get(`/api/tasks/${signIn.taskUrl?.split("/").at(-1)}`)).json(),
  );
  const title = "Lists keep their filters in the address";
  const created = await page.request.post("/api/tasks", {
    data: { title, projectId: signInTask.projectId, priority: "normal" },
  });
  const task = taskSchema.parse(await created.json());
  await page.goto(`/tasks/${task.id}`);

  const conversation = page.getByRole("complementary", { name: "Conversation" });
  const autoMode = autoModeSwitch(conversation);
  await expect(autoMode).toHaveAttribute("aria-checked", "false");
  await conversation.getByText("Auto mode", { exact: true }).click();
  await expect(autoMode).toHaveAttribute("aria-checked", "true");
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-task-make-a-plan-auto-mode.png"),
  });
  await conversation.getByRole("button", { name: "Make a plan" }).click();
  await expect(
    page.getByText(`${title} is in Planning: Jan is making a plan, in auto mode.`),
  ).toBeVisible();

  const record = page.getByRole("region", { name: "Record" });
  const plan = record.getByRole("region", { name: "Plan", exact: true });
  const definitionOfDone = record.getByRole("region", { name: "Definition of Done" });
  await expect(plan).toContainText("Keep each list's filters in the address");
  await expect(plan.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(definitionOfDone.getByText("Confirmed", { exact: true })).toBeVisible();
  const read = async () =>
    taskSchema.parse(await (await page.request.get(`/api/tasks/${task.id}`)).json());
  await expect.poll(async () => (await read()).state).toBe("ready");
  expect(await read()).toMatchObject({ pipelineId: "full", proposedPipeline: null });
  await expect(page.getByRole("button", { name: "Mark Ready" })).toHaveCount(0);

  // The choice is The Office's default now, for the next Make a plan and the board's Plan.
  const remembered = await page.request.get("/api/settings/auto-mode");
  expect(autoModeSettingSchema.parse(await remembered.json()).autoMode).toBe(true);

  // Nothing of it is left to weigh on the next tests' Start.
  expect((await page.request.post(`/api/tasks/${task.id}/drop`)).status()).toBe(200);
});

// The engine replays the next session in e2e/sessions.jsonl: Jan starts on the message with the
// pasted screenshot and answers.
test("the user pastes a screenshot into a Task's Thread, sends it, and opens it full size from the message", async ({
  page,
}) => {
  const signInTask = taskSchema.parse(
    await (await page.request.get(`/api/tasks/${signIn.taskUrl?.split("/").at(-1)}`)).json(),
  );
  const created = await page.request.post("/api/tasks", {
    data: {
      title: "The settings page is cut off on the right",
      projectId: signInTask.projectId,
      priority: "normal",
    },
  });
  expect(created.status()).toBe(201);
  const task = taskSchema.parse(await created.json());
  await page.goto(`/tasks/${task.id}`);
  await page.getByRole("button", { name: "Plan with Jan" }).click();
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  // Planning opens Jan's Thread, whose composer takes over the draft but not images pasted before
  // it shows: its cache mark says it has.
  await expect(conversation.getByRole("img", { name: "Context: no session yet" })).toBeVisible();
  const message = conversation.getByRole("textbox", { name: "Message" });
  await message.fill("The page is cut off on the right, as in the screenshot.");

  // A screenshot as the clipboard holds one: a PNG named only "image.png", pasted on the box.
  const screenshot = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 200 } });
  await message.evaluate(
    (box, bytes) => {
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
      box.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
      );
    },
    [...screenshot],
  );
  const pasted = /^Pasted image \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/;
  const pending = conversation.getByRole("list", { name: "Images to send" });
  await expect(pending.getByRole("img", { name: pasted })).toBeVisible();
  // A paste of files alone leaves the text as it was.
  await expect(message).toHaveValue("The page is cut off on the right, as in the screenshot.");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-message-images-pending.png") });
  await message.press("Enter");

  // The message shows its image as a thumbnail, and the image is the Task's Attachment.
  await expect(
    conversation.getByText("The screenshot shows the page cut off on the right."),
  ).toBeVisible();
  await expect(pending).toHaveCount(0);
  const thumbnail = conversation.getByRole("button", { name: /^View Pasted image / });
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail.locator("img")).toHaveJSProperty("complete", true);
  const attachments = (await (
    await page.request.get(`/api/tasks/${task.id}/attachments`)
  ).json()) as { kind: string; name: string; mediaType?: string; size?: number }[];
  expect(attachments).toEqual([
    expect.objectContaining({
      kind: "image",
      name: expect.stringMatching(pasted),
      mediaType: "image/png",
      size: screenshot.byteLength,
    }),
  ]);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-message-images-thumbnail.png"),
  });

  // Clicking it opens the viewer on the image at its full size.
  await thumbnail.click();
  const viewer = page.getByRole("dialog", { name: pasted });
  const full = viewer.getByRole("img", { name: pasted });
  await expect(full).toBeVisible();
  await expect(full).toHaveJSProperty("naturalWidth", 320);
  await expect(viewer).toContainText("1 of 1 · Sent by");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-message-images-viewer.png") });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Nothing of it is left to weigh on the next tests' Start.
  expect((await page.request.post(`/api/tasks/${task.id}/drop`)).status()).toBe(200);
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
  await expect(start).toBeHidden();
  await expect(page.getByRole("button", { name: "Queue behind it" })).toBeVisible();

  await page.goto("/work");
  await page
    .getByRole("region", { name: "Ready", exact: true })
    .getByRole("article", { name: "Sign-in returns to the page" })
    .getByRole("button", { name: "Blocked by 1 Task" })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Blocked by 1 Task" })
      .getByRole("link", { name: blockerTitle }),
  ).toBeVisible();
  await page.goto(`/tasks/${blocker.id}`);
  await expect(
    dependencies
      .getByRole("region", { name: "Waiting for this Task" })
      .getByRole("link", { name: "Sign-in returns to the page" }),
  ).toBeVisible();

  await page.goto(taskUrl);
  // The start check read on load is answered first: one still on its way when the blocker goes
  // would land after it, saying Blocked.
  await expect(
    page.getByText(`Blocked by "${blockerTitle}", which must be Done first.`),
  ).toBeVisible();
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

  const rail = page.getByRole("region", { name: "Pipeline · Quick fix" });
  const conversation = page.getByRole("complementary", { name: "Conversation" });
  const implement = stageOnRail(rail, "Implement");
  await expect(page.locator(".task-head").getByText("Waiting on you")).toBeVisible();
  await expect(implement).toContainText("Waiting on you");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  // Implement's Thread reads in the Stage history, not here: its Decision isn't in a person's Thread,
  // and no Stage runs, so the first tab is the Planner's, showing only Planning's answered Decision.
  const janTab = conversation.getByRole("tab", { name: /Jan/ });
  const adamTab = conversation.getByRole("tab", { name: /Adam/ });
  await expect(janTab).toHaveAttribute("aria-selected", "true");
  await expect(adamTab).toBeVisible();
  await expect(conversation.getByLabel("Context", { exact: true })).toBeVisible();
  await expect(
    conversation.getByRole("region", { name: `Decision: ${PAGE_QUESTION}` }),
  ).toHaveCount(0);
  const onTheCard = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("region", { name: `Decision: ${PAGE_QUESTION}` });
  await expect(onTheCard).toBeVisible();
  // Between Stages The Office sends the Stage Thread's messages, so no follow-up is offered.
  await expect(onTheCard.getByText(/A question first\?/)).toHaveCount(0);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-waiting-on-you.png") });

  // Out of view the slim bar keeps it in sight, and its Show brings it back. By the keyboard: in so
  // short a window a toast covers it.
  const slimBar = page.getByRole("group", { name: "Needs you, out of view" });
  const scrollToTheEnd = (): Promise<void> =>
    page.locator(".shell-main").evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
  await expect(slimBar).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 300 });
  await scrollToTheEnd();
  await expect(slimBar).toBeInViewport();
  await expect(slimBar).toContainText(PAGE_QUESTION);
  await slimBar.getByRole("button", { name: "Show" }).press("Enter");
  await expect(onTheCard).toBeInViewport();
  await expect(slimBar).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 1000 });

  // The card names the run it was asked in, and its link opens the Stage history there, every time.
  const stageHistory = page.getByRole("dialog", { name: /^Stage history: Implement/ });
  for (const followed of ["first", "again"]) {
    await onTheCard.getByRole("link", { name: /^in Implement, run 1/ }).click();
    await expect(
      stageHistory.getByRole("region", { name: "Run 1", exact: true }),
      followed,
    ).toBeVisible();
    await stageHistory.getByRole("button", { name: "Close", exact: true }).click();
    await expect(stageHistory, followed).toHaveCount(0);
  }

  // From the run's Thread, the way to the card closes the window over it, every time.
  const inRunThread = stageHistory.getByRole("region", { name: `Decision: ${PAGE_QUESTION}` });
  for (const followed of ["first", "again"]) {
    await rail.getByRole("button", { name: "Implement", exact: true }).click();
    await stageHistory.getByRole("tab", { name: "Thread" }).click();
    await inRunThread.getByRole("link", { name: "Answer it in Needs you" }).click();
    await expect(stageHistory, followed).toHaveCount(0);
    await expect(onTheCard, followed).toHaveAttribute("aria-current", "true");
    await expect(onTheCard, followed).toBeInViewport();
  }

  await page.goto("/work");
  const card = page
    .getByRole("region", { name: "In progress", exact: true })
    .getByRole("article", { name: "Sign-in returns to the page" });
  await expect(card.getByRole("img", { name: "Waiting on you" })).toBeVisible();

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
  await expect(strip.getByRole("button", { name: /^\d+ needs? you/ })).toBeVisible();
  await expect(strip).toContainText("Desks in use");
  // While the Decision waits the figure is the alert, and once it is answered it is calm again.
  // Narrowed to this Project: other files' Decisions wait in the shared database, which leaves
  // the figure its softer tint for other Projects at most.
  const projectFilter = page.getByRole("button", { name: /^Project filter:/ });
  await projectFilter.click();
  await page.getByRole("button", { name: "Show only Sign-in", exact: true }).click();
  const needsYouFigure = strip.getByRole("button", { name: /needs? you/ });
  await expect(needsYouFigure).toHaveAccessibleName(/^1 needs you/);
  await expect(needsYouFigure).toHaveClass(/\balert\b/);
  await expect(needsYouFigure.locator(".live-dot")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-now.png") });
  await strip.screenshot({ path: path.join(SCREENSHOTS, "light-strip-needs-you-alert.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
  await strip.screenshot({ path: path.join(SCREENSHOTS, "dark-strip-needs-you-alert.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-palette", "light");
  await pickAndSubmit(onNow, "The page it started from");
  await expect(onNow).toHaveCount(0);
  await expect(needsYouFigure).toHaveAccessibleName(/^0 need you/);
  await expect(needsYouFigure).not.toHaveClass(/\balert\b/);
  await expect(needsYouFigure.locator(".live-dot")).toHaveCount(0);
  await projectFilter.click();
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await expect(projectFilter).toContainText("All projects");

  await page.goto(signIn.taskUrl);
  await expect(page.getByRole("region", { name: "Needs you" })).toContainText("Nothing needs you");
  // The Stage ran again in the asking Thread, continuing its session.
  await expect(implement.getByText("Done", { exact: true })).toBeVisible();
  await expect(implement).toContainText("2 runs · ");
  await rail.getByRole("button", { name: "Implement", exact: true }).click();
  const history = page.getByRole("dialog", { name: /^Stage history: Implement/ });
  const newestRun = history.getByRole("region", { name: "Run 2", exact: true });
  await expect(newestRun).toContainText("continued session");
  // The Handover note is Markdown: its heading and list show as such, not as one long line.
  const handoverNote = newestRun.getByRole("region", { name: "Handover note" });
  await expect(handoverNote.getByText("Redirect", { exact: true })).toBeVisible();
  await expect(handoverNote.getByRole("listitem")).toHaveText([
    "The redirect keeps the path and the query string.",
    "next is checked against the Office's own pages.",
  ]);
  await expect(handoverNote.locator("code")).toHaveText("next");
  await expect(history.getByRole("group", { name: "Details" })).toHaveCount(0);
  // The run's Thread is its other tab, read here, with the Details switch on the tab's row.
  const threadTab = history.getByRole("tab", { name: "Thread" });
  await threadTab.click();
  await expect(
    history.getByText("Signing in now returns to the page it started from."),
  ).toBeVisible();
  await expectAnsweredByYou(
    history.getByRole("region", { name: `Decision: ${PAGE_QUESTION}` }),
    "The page it started from (recommended)",
  );
  await expect(conversation.getByText("Signing in now returns")).toHaveCount(0);
  await expect(history.getByRole("group", { name: "Details" })).toBeVisible();
  await expect(newestRun.getByRole("note")).toHaveText(
    "This run has ended, so its Thread is read-only.",
  );
  await expect(newestRun.getByRole("textbox", { name: "Message" })).toHaveCount(0);
  // Its Handover note shows its first lines, and reads whole in the run's Summary.
  const noteInThread = newestRun.locator(".message.handover-note").last();
  await expect(noteInThread).toContainText("Handover note");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-run-thread-ended.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await motionSettled(page);
  await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-run-thread-ended.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await noteInThread.getByRole("button", { name: "Read it in full" }).click();
  await expect(history.getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(handoverNote.getByRole("listitem")).toHaveCount(2);
  const closeHistory = history.getByRole("button", { name: "Close", exact: true });
  await closeHistory.click();

  // An ended run's foot leads to its person's tab, ready for a message. Followed from the address,
  // a Stage's Thread still lands: at its run.
  await rail.getByRole("button", { name: "Implement", exact: true }).click();
  await threadTab.click();
  await history.getByRole("link", { name: "Ask Adam about it" }).click();
  await expect(history).toHaveCount(0);
  await expect(adamTab).toHaveAttribute("aria-selected", "true");
  await expect(conversation).toContainText("Worked on Implement");
  await expect(conversation.getByRole("textbox", { name: "Message" })).toHaveAttribute(
    "placeholder",
    /Ask Adam anything/,
  );

  await page.goto("/people/developer/conversations");
  await page.getByRole("link", { name: /^Implement\s*Sign-in returns to the page$/ }).click();
  await expect(history).toBeVisible();
  await expect(history.getByRole("region", { name: "Run 2", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  await expect(page).not.toHaveURL(/taskThread/);

  // The rail opens the history, however often, and focus lands on the Stage as the window closes.
  const implementOnRail = rail.getByRole("button", { name: "Implement", exact: true });
  await implementOnRail.click();
  await expect(history).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  await expect(implementOnRail).toBeFocused();
  await implementOnRail.click();
  await expect(history).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(history).toHaveCount(0);
  await page.keyboard.press("ArrowLeft");
  await expect(history).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  await expect(implementOnRail).toBeFocused();

  // Publish fails, as the repository has no remote: The Office asks Bob, the CTO, first, who passes
  // it on to the user. Waiting for that keeps the next test's sessions after Bob's.
  await expect
    .poll(async () => {
      const open = await page.request.get("/api/decisions/open");
      return JSON.stringify(await open.json());
    })
    .toContain('\\"Publish\\" failed, with no round to go back to.');
  const consultationLog = async (): Promise<string> => {
    const taskId = new URL(page.url()).pathname.split("/").at(-1);
    const threads = threadListSchema.parse(
      await (await page.request.get(`/api/tasks/${taskId}/threads`)).json(),
    );
    const consultation = threads.find((thread) => thread.consultation !== null);
    return consultation
      ? (await page.request.get(`/api/threads/${consultation.id}/messages`)).text()
      : "";
  };
  await expect
    .poll(consultationLog)
    .toContain("I passed it on to the user: the remote is theirs to set up.");
});

const GATE_FEEDBACK = "Call the button Save, as the rest of the settings do.";
/** In every address a design tries to reach, so a request that left it can be told. */
const FROM_THE_DESIGN = "from-the-design";

/** A design whose script says what it could reach. */
const A_DESIGN = `<!doctype html>
<title>Design</title>
<h1>Settings design</h1>
<p id="script">Script: not run</p>
<p id="origin"></p>
<p id="parent"></p>
<p id="api"></p>
<p id="network"></p>
<p id="picture"></p>
<script>
  const say = (id, words) => { document.getElementById(id).textContent = words; };
  say("script", "Script: ran");
  say("origin", "Origin: " + window.origin);
  try {
    say("parent", "Parent page: " + window.parent.document.title);
  } catch {
    say("parent", "Parent page: blocked");
  }
  const reached = (id, name, address) =>
    fetch(address).then(
      () => say(id, name + ": reached"),
      () => say(id, name + ": blocked"),
    );
  reached("api", "API", new URL("/api/tasks?${FROM_THE_DESIGN}", document.baseURI));
  reached("network", "Network", "https://example.com/${FROM_THE_DESIGN}");
  const picture = new Image();
  picture.onload = () => say("picture", "Picture: reached");
  picture.onerror = () => say("picture", "Picture: blocked");
  picture.src = "https://example.com/${FROM_THE_DESIGN}.png";
</script>`;

/** What the script of `A_DESIGN` says when it ran, sandboxed. */
async function expectDesignSandboxed(body: Locator): Promise<void> {
  await expect(body.locator("#script")).toHaveText("Script: ran");
  await expect(body.locator("#origin")).toHaveText("Origin: null");
  await expect(body.locator("#api")).toHaveText("API: blocked");
  await expect(body.locator("#network")).toHaveText("Network: blocked");
  await expect(body.locator("#picture")).toHaveText("Picture: blocked");
}

/** Light and dark, at 1600 wide and at 600, back to 1600 and light after; no toast in the way. */
async function screenshotInEveryPalette(page: Page, name: string): Promise<void> {
  for (const width of [600, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const palette of ["dark", "light"] as const) {
      await showPalette(page, palette);
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${palette}-${width}-${name}.png`),
        style: ".toasts { visibility: hidden; }",
      });
    }
  }
}

/** A 1×1 PNG. */
const A_SCREENSHOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** The Task's Stages: a Gate first, so it waits there with no session, then Build. */
async function seedGateFirst(page: Page, taskId: string): Promise<void> {
  const edited = await page.request.put(`/api/tasks/${taskId}/stages`, {
    data: {
      stages: [
        { kind: "gate", key: "first-look", name: "First look", optional: false },
        { kind: "script", key: "build", name: "Build", optional: false, command: "build" },
      ],
    },
  });
  expect(edited.status()).toBe(200);
}

/**
 * Edits the Task's Stages for it before it starts, as Edit for this Task saves them: Quick fix's
 * Implement and Tests, then a Gate before a Build.
 */
async function seedGatedStages(page: Page, taskId: string): Promise<void> {
  const library = pipelineListSchema.parse(await (await page.request.get("/api/pipelines")).json());
  const quickFix = library.find(({ id }) => id === "quick-fix")?.stages ?? [];
  const stages = [
    ...asStageList(quickFix.filter(({ key }) => key === "implement" || key === "tests")),
    { kind: "gate", key: "ui-acceptance", name: "UI acceptance", optional: false },
    { kind: "script", key: "build", name: "Build", optional: false, command: "build" },
  ];
  const edited = await page.request.put(`/api/tasks/${taskId}/stages`, { data: { stages } });
  expect(edited.status()).toBe(200);
}

/** A Task planned through the API, Ready to start; the user writes its parts, so Jan never starts. */
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
    () => page.request.post(`/api/tasks/${id}/plan/confirm`),
    () =>
      page.request.put(`/api/tasks/${id}/definition-of-done`, {
        data: { definitionOfDone: ["The settings page keeps its changes."] },
      }),
    () => page.request.post(`/api/tasks/${id}/definition-of-done/confirm`),
    () => page.request.put(`/api/tasks/${id}/pipeline`, { data: { pipelineId: "quick-fix" } }),
    () => page.request.post(`/api/tasks/${id}/ready`),
  ];
  for (const step of steps) expect((await step()).status()).toBe(200);
  return id;
}

// The engine replays the next sessions in e2e/sessions.jsonl: Implement's two, the second after the
// Gate sent the work back.
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
    // The tab counts Needs you across every Project, the Gate among them.
    const now = nowSchema.parse(await (await page.request.get("/api/now")).json());
    expect(now.needsYou).toContainEqual(expect.objectContaining({ kind: "gate", taskId }));
    await expect(page).toHaveTitle(`(${now.needsYou.length}) The Office`);
    await expect(page.locator("link[rel='icon']")).toHaveAttribute("href", /^data:image\/png/);
    expect(await desktopShown(page)).toEqual([]);

    const gate = page.getByRole("region", { name: "Gate · UI acceptance" });
    const rail = page.getByRole("region", { name: "Pipeline · Quick fix" });
    const implement = stageOnRail(rail, "Implement");
    const acceptance = stageOnRail(rail, "UI acceptance");
    await expect(gate).toBeVisible();
    await expect(page.locator(".task-head").getByText("Waiting on you")).toBeVisible();
    await expect(rail.getByText("At UI acceptance: waiting on you")).toBeVisible();
    await expect(page.getByRole("region", { name: "Needs you" })).toContainText("a Gate");
    // The card says what it waits for and a line of its facts. Only the checks before the Gate
    // count: the Build after it hasn't had its turn.
    await expect(gate).toContainText("Before Build");
    await expect(gate).toContainText(
      /\d+ files? changed · tests passed · Definition of Done \d of 1/,
    );
    await expect(gate.getByRole("button", { name: "Continue to Build" })).toBeVisible();
    await expect(gate.getByRole("button", { name: "Drop", exact: true })).toHaveCount(0);

    // Out of view the slim bar counts the Gate and asks what its card asks.
    const slimBar = page.getByRole("group", { name: "Needs you, out of view" });
    await page.setViewportSize({ width: 1600, height: 300 });
    await page.locator(".shell-main").evaluate((scroller) => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    await expect(slimBar).toContainText("Look at the changes and let the work");

    // In a narrow window the Stages don't fit, and the rail goes to the current one by itself.
    await page.setViewportSize({ width: NARROW_WIDTH_PX, height: 900 });
    await expect.poll(() => stageIsInRailView(rail, acceptance)).toBe(true);
    expect(await scrollLeftOf(rail.locator(".pipeline-rail-scroll"))).toBeGreaterThan(0);
    await page.locator(".shell-main").evaluate((scroller) => {
      scroller.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-640-task-rail.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-640-task-rail.png") });
    await showPalette(page, "light");

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-gate.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-task-gate.png") });
    await showPalette(page, "light");

    // Show details has the four facts, this round's Attachments and every action in its bar.
    const details = page.getByRole("dialog", { name: /Before Build/ });
    await gate.getByRole("button", { name: "Show details" }).click();
    await expect(details.locator(".gate-fact", { hasText: "Tests" })).toContainText("Passed");
    await expect(details.locator(".gate-fact", { hasText: "Definition of Done" })).toContainText(
      "of 1",
    );
    await expect(details.locator(".gate-fact", { hasText: "Files changed" })).toBeVisible();
    await expect(details.locator(".gate-fact", { hasText: "Lines" })).toContainText("+");
    const attachments = details.getByRole("region", { name: "Attachments" });
    await expect(attachments).toHaveCount(0);
    // A screenshot, as Work attaches the ones an Agent lists, shows as a picture.
    const uploaded = await page.request.post(
      `/api/tasks/${taskId}/attachments/files?${new URLSearchParams({ fileName: "settings.png", mediaType: "image/png" })}`,
      { headers: { "content-type": "application/octet-stream" }, data: A_SCREENSHOT },
    );
    expect(uploaded.status()).toBe(201);
    await expect(attachments.getByRole("button", { name: "View settings.png" })).toBeVisible();
    await expect(acceptance.getByText("Waiting on you", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-window.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-gate-window.png") });
    await showPalette(page, "light");

    // A design shows as a chip that opens its live preview. Its scripts run, and it can't read
    // The Office's page, call its API or load anything into itself from the network.
    // Every address it tries answers, for any origin, so "blocked" can only be the sandbox's doing.
    const reachedOut: string[] = [];
    const answerTheDesign = async (route: Route): Promise<void> => {
      reachedOut.push(route.request().url());
      await route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        contentType: "image/png",
        body: A_SCREENSHOT,
      });
    };
    const addressesOfTheDesign = new RegExp(FROM_THE_DESIGN);
    await page.context().route(addressesOfTheDesign, answerTheDesign);
    const designAdded = await page.request.post(
      `/api/tasks/${taskId}/attachments/files?${new URLSearchParams({ fileName: "design.html", mediaType: "text/html" })}`,
      { headers: { "content-type": "application/octet-stream" }, data: A_DESIGN },
    );
    expect(designAdded.status()).toBe(201);
    const designChip = attachments.getByRole("button", { name: "design.html" });
    await expect(designChip).toBeVisible();
    await screenshotInEveryPalette(page, "gate-window-html-chip");
    await designChip.click();
    const preview = page.getByRole("dialog", { name: "design.html" });
    const design = page.frameLocator('iframe[title="design.html"]');
    await expectDesignSandboxed(design.locator("body"));
    await expect(design.locator("#parent")).toHaveText("Parent page: blocked");
    await screenshotInEveryPalette(page, "gate-html-preview");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      preview.getByRole("link", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("design.html");
    const [original] = await Promise.all([
      page.context().waitForEvent("page"),
      preview.getByRole("link", { name: "Open the original" }).click(),
    ]);
    await expectDesignSandboxed(original.locator("body"));
    await original.close();
    expect(reachedOut).toEqual([]);
    await page.context().unroute(addressesOfTheDesign, answerTheDesign);
    // The preview is extra large, wider than a large window, and maximizes to the browser window
    // but for its margin, then restores.
    const ownSize = await preview.boundingBox();
    expect(ownSize?.width).toBeGreaterThan(1180);
    await preview.getByRole("button", { name: "Maximize" }).click();
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("The page has no viewport");
    const maximizedMargin = 16;
    await expect
      .poll(() => preview.boundingBox())
      .toEqual({
        x: maximizedMargin,
        y: maximizedMargin,
        width: viewport.width - 2 * maximizedMargin,
        height: viewport.height - 2 * maximizedMargin,
      });
    await screenshotInEveryPalette(page, "gate-html-preview-maximized");
    await preview.getByRole("button", { name: "Restore" }).click();
    await expect.poll(() => preview.boundingBox()).toEqual(ownSize);
    // Esc still closes it maximized, and it opens again at its own size.
    await preview.getByRole("button", { name: "Maximize" }).click();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await designChip.click();
    await expect(preview.getByRole("button", { name: "Maximize" })).toBeVisible();
    await expect.poll(() => preview.boundingBox()).toEqual(ownSize);
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);

    // The diff is a click away, in the Changes tab, brought into view.
    await details.getByRole("link", { name: "Open Changes" }).click();
    await expect(details).toHaveCount(0);
    await expect(page).toHaveURL(/recordTab=changes/);
    await expect(page.getByRole("region", { name: "Files changed" })).toBeInViewport();

    // The Gate waits on Now too: the Task page's card, under the Task's title and Project.
    await page.goto("/");
    const onNow = page.getByRole("article", { name: "Gate: Settings keep their changes" });
    await expect(onNow.locator(".needs-you-heading")).toHaveText(
      "Settings keep their changesSTSettings",
    );
    await expect(gate.getByRole("button", { name: "Continue to Build" })).toBeVisible();
    await expect(gate).toContainText("Definition of Done");
    await expect(gate.getByRole("button", { name: "Drop" })).toHaveCount(0);
    await expect(gate.getByRole("button", { name: "Send back with notes…" })).toHaveCount(0);

    // Its window goes from here to the Task's Changes.
    await gate.getByRole("button", { name: "Show details" }).click();
    await details.getByRole("link", { name: "Open Changes" }).click();
    await expect(details).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?recordTab=changes$`));
    await expect(page.getByRole("region", { name: "Files changed" })).toBeVisible();

    // Send back's notes open over the bar, whose actions become Send back and Cancel. On Now as on
    // the Task's page.
    await page.goto("/");
    await gate.getByRole("button", { name: "Show details" }).click();
    const continueInWindow = details.getByRole("button", { name: "Continue to Build" });
    const sendBackWithNotes = details.getByRole("button", { name: "Send back with notes…" });
    // Only a Script Stage comes after this Gate, which can't read notes, so Continue offers none.
    await expect(details.getByRole("button", { name: "Continue with notes…" })).toHaveCount(0);
    await sendBackWithNotes.click();
    await expect(continueInWindow).toHaveCount(0);
    await details.getByRole("button", { name: "Cancel" }).click();
    await expect(continueInWindow).toBeVisible();
    await sendBackWithNotes.click();
    const sendBack = details.getByRole("button", { name: "Send back", exact: true });
    const feedback = details.getByLabel("Your feedback");
    await expect(feedback).toBeFocused();
    await expect(sendBack).toBeDisabled();
    // Shift+Enter breaks the line, as in every message field.
    await feedback.fill("Call it Save.");
    await feedback.press("Shift+Enter");
    await expect(feedback).toHaveValue("Call it Save.\n");
    await feedback.fill(GATE_FEEDBACK);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-send-back.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-gate-send-back.png") });
    await showPalette(page, "light");
    // In the background, the next Gate's Notification goes to the desktop instead.
    await focusTab(page, false);
    await sendBack.click();
    await expect(page.getByText("Sent back to Adam.")).toBeVisible();
    await expect(details).toHaveCount(0);
    await expect
      .poll(() => desktopShown(page))
      .toContainEqual({
        title: "Adam",
        body: `${READY}\nSettings keep their changes · Settings`,
        closed: false,
      });
    await focusTab(page, true);

    // Implement ran again in a fresh session, briefed with the feedback, using no round.
    await page.goto(`/tasks/${taskId}`);
    await expect(gate).toBeVisible();
    await expect(implement.getByText("Done", { exact: true })).toBeVisible();
    await expect(implement).toContainText("2 runs · ");
    await rail.getByRole("button", { name: "Implement", exact: true }).click();
    const implementHistory = page.getByRole("dialog", { name: /^Stage history: Implement/ });
    await expect(
      implementHistory.getByRole("list", { name: "Runs" }).getByRole("listitem"),
    ).toHaveCount(2);
    await expect(implementHistory).toContainText("Sent back from UI acceptance");
    await expect(implementHistory).not.toContainText("Briefed with what failed");
    await page.keyboard.press("Escape");
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

    // Edit for this Task while it runs, on the flow: the started Stages are locked with their state,
    // Build after them changes, and the library's Quick fix stays as it is.
    const library = await (await page.request.get("/api/pipelines")).json();
    await rail.getByRole("button", { name: "Edit for this Task" }).click();
    const stagesWindow = page.getByRole("dialog", {
      name: "Stages of Settings keep their changes",
    });
    await expect(stagesWindow).toContainText(
      "Started Stages, and the routes out of them, are locked.",
    );
    const flow = stagesWindow.getByRole("region", { name: "Flow" });
    const panelOf = (name: string): Locator => flowPanel(stagesWindow, name);
    for (const [key, name, state] of [
      ["implement", "Implement", "Done"],
      ["tests", "Tests", "Done"],
      ["ui-acceptance", "UI acceptance", "Waiting on you"],
    ] as const) {
      const card = flow.locator(`[data-flow-stage="${key}"]`);
      await expect(
        card.getByRole("img", { name: `${state}: started, so it can't be changed`, exact: true }),
      ).toBeVisible();
      await expect(card).toContainText(state);
      await expect(card.getByRole("button", { name: `Draw a route from ${name}` })).toHaveCount(0);
      await flow.getByRole("button", { name, exact: true }).click();
      await expect(
        panelOf(name).getByRole("button", { name: `Move ${name} later` }),
      ).toBeDisabled();
      await expect(panelOf(name).getByRole("button", { name: `More for ${name}` })).toHaveCount(0);
    }
    await expect(
      flow
        .locator('[data-flow-stage="build"]')
        .getByRole("button", { name: "Draw a route from Build" }),
    ).toHaveCount(1);
    await editForThisTaskScreenshots(page, stagesWindow);
    // Build comes after the locked columns, so it can't move before them.
    await flow.getByRole("button", { name: "Build", exact: true }).click();
    await expect(
      panelOf("Build").getByRole("button", { name: "Move Build earlier" }),
    ).toBeDisabled();
    await panelOf("Build").getByLabel("Project command").selectOption("lint");
    await stagesWindow.getByRole("button", { name: "Save for this Task" }).click();
    await expect(page.getByText("Stages saved for Settings keep their changes.")).toBeVisible();
    await expect(stagesWindow).toHaveCount(0);
    expect(await (await page.request.get("/api/pipelines")).json()).toEqual(library);
    const savedStages = taskStagesSchema.parse(
      await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
    ).stages;
    expect(
      savedStages?.map(({ stage }) => [stage.key, stage.kind === "script" ? stage.command : null]),
    ).toEqual([
      ["implement", null],
      ["tests", "test"],
      ["ui-acceptance", null],
      ["build", "lint"],
    ]);

    // Nothing goes straight after UI acceptance: the route out of it can't take a Stage, and
    // removing Build, which would carry UI acceptance's route to End, is refused by the check.
    await rail.getByRole("button", { name: "Edit for this Task" }).click();
    await flow.getByRole("button", { name: "UI acceptance", exact: true }).click();
    await panelOf("UI acceptance")
      .getByRole("region", { name: "Routes out" })
      .getByRole("button", { name: /→ Build/ })
      .click();
    const routePanel = panelOf("Route");
    await expect(routePanel).toContainText("Route from UI acceptance to Build");
    const insertOnRoute = routePanel.getByRole("button", { name: "Insert a Stage on this route" });
    await expect(insertOnRoute).toBeDisabled();
    await expect(insertOnRoute).toHaveAttribute(
      "title",
      "Waiting on you: started, so it can't be changed",
    );
    await flow.getByRole("button", { name: "Build", exact: true }).click();
    await panelOf("Build").getByRole("button", { name: "More for Build" }).click();
    await page.getByRole("menu").getByRole("button", { name: "Remove Build" }).click();
    await expect(flow.getByRole("button", { name: "Build", exact: true })).toHaveCount(0);
    const routesOutLocked =
      "Stage 3 · UI acceptance: it has started, so its routes out stay as they are. To change where the walk goes, change the routes of a Stage that hasn't started.";
    const problems = stagesWindow.getByRole("list", { name: "Problems" });
    await expect(problems).toContainText(routesOutLocked);
    await expect(stagesWindow.getByRole("button", { name: "Save for this Task" })).toBeDisabled();
    // The problem opens the route it is on, read only.
    await problems.getByRole("button", { name: routesOutLocked }).click();
    await expect(routePanel).toContainText("Route from UI acceptance to End");
    // Close drops the draft: Build is still there.
    await stagesWindow.getByRole("button", { name: "Close", exact: true }).click();
    await expect(stagesWindow).toHaveCount(0);
    expect(
      taskStagesSchema
        .parse(await (await page.request.get(`/api/tasks/${taskId}/stages`)).json())
        .stages?.map(({ stage }) => stage.key),
    ).toEqual(["implement", "tests", "ui-acceptance", "build"]);

    // Continue from the Needs you panel, over the Projects page.
    await page.goto("/projects");
    await page
      .getByRole("status", { name: "Status strip" })
      .getByRole("button", { name: /needs? you/ })
      .click();
    const panel = page.getByRole("dialog").filter({ hasText: "Needs you" });
    const waiting = panel.getByRole("article", { name: "Gate: Settings keep their changes" });
    await expect(waiting.getByRole("button", { name: "Continue to Build" })).toBeVisible();
    // Its left edge resizes it, as the chat drawer's does.
    const panelEdge = panel.getByRole("separator", { name: "Resize the Needs you panel" });
    await expect(panelEdge).toHaveAttribute("aria-valuenow", "640");
    await panelEdge.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(panelEdge).toHaveAttribute("aria-valuenow", "656");
    // The panel's width is a fraction of a pixel off 656 when the layout rounds it.
    expect((await panel.boundingBox())?.width).toBeCloseTo(656, 0);
    await panelEdge.dblclick();
    await expect(panelEdge).toHaveAttribute("aria-valuenow", "640");
    await page.screenshot({
      path: path.join(TASK_SCREENSHOTS, "needs-you-panel-edge-light-1600.png"),
      animations: "disabled",
    });
    await panelEdge.blur();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-needs-you-panel.png"),
      animations: "disabled",
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
    await page.screenshot({
      path: path.join(SCREENSHOTS, "dark-1600-needs-you-panel.png"),
      animations: "disabled",
    });
    await waiting.screenshot({ path: path.join(SCREENSHOTS, "dark-gate-actions.png") });
    await page.emulateMedia({ colorScheme: "light" });
    await waiting.screenshot({ path: path.join(SCREENSHOTS, "light-gate-actions.png") });

    // The Gate's window opens over the panel. Writing in it leaves the panel be, and Esc closes the
    // window alone.
    await waiting.getByRole("button", { name: "Show details" }).click();
    await details.getByRole("button", { name: "Send back with notes…" }).click();
    await details.getByLabel("Your feedback").fill("Not yet.");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(panel).toBeVisible();

    // Open Changes goes to the Task and closes the panel.
    await waiting.getByRole("button", { name: "Show details" }).click();
    await details.getByRole("link", { name: "Open Changes" }).click();
    await expect(details).toHaveCount(0);
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}\\?recordTab=changes$`));

    await page.goto("/projects");
    await page
      .getByRole("status", { name: "Status strip" })
      .getByRole("button", { name: /needs? you/ })
      .click();
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
    // An Outcome doesn't count in the tab, which counts Needs you alone.
    const waitingNow = nowSchema.parse(await (await page.request.get("/api/now")).json()).needsYou;
    await expect(page).toHaveTitle(
      waitingNow.length === 0 ? "The Office" : `(${waitingNow.length}) The Office`,
    );
    await done.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}$`));
    await expect
      .poll(async () => {
        const open = notificationListSchema.parse(
          await (await page.request.get("/api/notifications")).json(),
        );
        return open.some(
          ({ kind, pointsTo }) =>
            kind === "outcomes.task-done" && "taskId" in pointsTo && pointsTo.taskId === taskId,
        );
      })
      .toBe(false);
    await expect(gate).toHaveCount(0);
    await rail.getByRole("button", { name: "UI acceptance", exact: true }).click();
    const gateHistory = page.getByRole("dialog", { name: /^Stage history: UI acceptance/ });
    await expect(gateHistory).toContainText("You continued");
    await page.keyboard.press("Escape");
    await expect(page.locator(".task-head-title").getByText("Done", { exact: true })).toBeVisible();
    // Publish removed the worktree, so its conversations are read-only, with the reason.
    const finishedConversation = page.getByRole("complementary", { name: "Conversation" });
    await expect(finishedConversation.getByRole("note")).toContainText(
      "This Task is Done and its working copy has been removed",
    );
    await expect(finishedConversation.getByRole("textbox", { name: "Message" })).toHaveCount(0);

    // Now lists it Done since the user left.
    await page.goto("/");
    await expect(
      page.getByRole("article", { name: "Done: Settings keep their changes" }),
    ).toBeVisible();
  } finally {
    await repository.remove();
  }
});

// The engine replays the Office Manager's chat after the Gate's sessions: Marta asks a two-question
// Decision and waits for its answer, which reaches her session as the user's next message.
test("a person asks a Decision in their chat, answered there as a form, never in Needs you", async ({
  page,
}) => {
  const DAY = "Which day should the weekly digest go out?";
  const WHO = "Who else should get the digest?";
  const openNeedsYouDecisions = async (): Promise<number> => {
    const open = notificationListSchema.parse(
      await (await page.request.get("/api/notifications")).json(),
    );
    return open.filter(({ kind }) => kind === "needs-you.decision").length;
  };
  const needsYouBefore = nowSchema.parse(await (await page.request.get("/api/now")).json()).needsYou
    .length;
  const notificationsBefore = await openNeedsYouDecisions();

  await page.goto("/people");
  await page.getByRole("button", { name: "Open the chat with Marta" }).click();
  const marta = chatWith(page, "Marta");
  await startNewThread(marta);
  const threadId = await chatThreadShown(page);
  await marta.getByRole("textbox", { name: "Message" }).fill("Set up the weekly digest.");
  await marta.getByRole("textbox", { name: "Message" }).press("Enter");

  await expect(marta.getByText("I asked how the digest should go out.")).toBeVisible();
  const form = marta.getByRole("region", { name: `Decision: ${DAY} (and 1 more question)` });
  await expect(form).toBeVisible();
  await expect(form.getByRole("radiogroup", { name: DAY })).toBeVisible();
  await expect(form).toContainText(WHO);
  const openAnswer = form
    .getByRole("group", { name: "Question 2" })
    .getByRole("textbox", { name: /^Your answer/ });
  await expect(openAnswer).toBeVisible();
  await expect(form.getByRole("button", { name: "Submit" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Ask me again" })).toBeVisible();
  await expect(form).not.toContainText("Needs you");

  // Never in Needs you: not on Now, not counted in the tab, no Notification.
  await page.goto(`/now?chat=office-manager&thread=${threadId}`);
  await expect(form).toBeVisible();
  await expect(page.locator(".shell-main").getByText(DAY)).toHaveCount(0);
  const now = nowSchema.parse(await (await page.request.get("/api/now")).json());
  expect(now.needsYou).toHaveLength(needsYouBefore);
  await expect(page).toHaveTitle(
    now.needsYou.length === 0 ? "The Office" : `(${now.needsYou.length}) The Office`,
  );
  expect(await openNeedsYouDecisions()).toBe(notificationsBefore);

  const screenshots = async (name: string, card: Locator): Promise<void> => {
    for (const colorScheme of ["light", "dark"] as const) {
      await showPalette(page, colorScheme);
      for (const width of [1600, 900, 390]) {
        await page.setViewportSize({ width, height: 900 });
        // The card's top in view, its first question on screen.
        await card.evaluate((box) => box.scrollIntoView({ block: "start" }));
        await motionSettled(page);
        expect(await windowOverflow(page)).toBe(0);
        // Neither the drawer nor its Thread scrolls sideways.
        const sideways = await marta.evaluate((drawer) =>
          [drawer, ...drawer.querySelectorAll(".message-list")].map(
            (box) => box.scrollWidth - box.clientWidth,
          ),
        );
        expect(sideways.every((overflow) => overflow <= 0)).toBe(true);
        await page.screenshot({
          path: path.join(TASK_SCREENSHOTS, `${name}-${colorScheme}-${width}.png`),
        });
      }
    }
    await showPalette(page, "light");
    await page.setViewportSize({ width: 1600, height: 900 });
  };
  await screenshots("chat-decision-inline", form);

  await form
    .getByRole("radiogroup", { name: DAY })
    .getByRole("radio", { name: /^Friday/ })
    .check();
  const firstQuestion = form.getByRole("group", { name: "Question 1" });
  await firstQuestion.getByRole("button", { name: "Add a comment" }).click();
  await firstQuestion.getByRole("textbox", { name: /^Comment/ }).fill("Fridays are quieter.");
  await openAnswer.fill("The team leads.");
  await form.getByRole("textbox", { name: "General comment" }).fill("Thanks, Marta.");
  await form.getByRole("button", { name: "Submit" }).click();

  await expect(
    marta.getByText("The digest goes out on Fridays, to the team leads too."),
  ).toBeVisible();
  // The answered form stays in the chat, with each answer, its comment and the general comment.
  const answered = marta.locator(".decision-card.settled");
  await expect(answered.locator(".decision-answered")).toHaveText("Answered by you");
  await expect(answered.locator(".decision-answer").first()).toContainText("Friday");
  await expect(answered.locator(".decision-answer").first()).toContainText(
    "Comment: Fridays are quieter.",
  );
  await expect(answered.locator(".decision-answer").nth(1)).toContainText("The team leads.");
  await expect(answered.locator(".decision-general-comment")).toHaveText(
    "General comment: Thanks, Marta.",
  );
  await expect(answered.getByRole("button", { name: "Submit" })).toHaveCount(0);
  await screenshots("chat-decision-answered", answered);

  await page.reload();
  await expect(chatWith(page, "Marta").locator(".decision-card.settled")).toBeVisible();
});

// After the Gate's test above: a Task's Done here would collapse with that one's, which it reads as
// a toast.
test(
  "a Gate's card and window continue past it, and the window drops the Task",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Looked at", "LA", PASSING_COMMANDS);
      const needsYou = page.getByRole("region", { name: "Needs you" });
      const gate = page.getByRole("region", { name: "Gate · First look" });
      const details = page.getByRole("dialog", { name: /Before Build/ });
      // No Agent reported the Definition of Done met, so the walk asks before the Task can end. It
      // must end here: a run outliving the repository would fail on the next test's page.
      const markDone = async (): Promise<void> => {
        await needsYou.getByRole("button", { name: "Mark the Task Done" }).click();
        await expect(needsYou).toContainText("Nothing needs you: this Task is Done.");
      };

      const continued = await readyTask(page, project.id, "Goes on past the look");
      await seedGateFirst(page, continued);
      await page.goto(`/tasks/${continued}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      // Build comes after the Gate, so nothing has checked the code yet.
      await expect(gate).toContainText("tests not run · Definition of Done 0 of 1");
      await gate.getByRole("button", { name: "Show details" }).click();
      await expect(details.locator(".gate-fact", { hasText: "Tests" })).toContainText("Not run");
      await expect(details.locator(".gate-fact", { hasText: "Definition of Done" })).toContainText(
        "0 of 1",
      );
      await expect(details.getByRole("button", { name: "Send back with notes…" })).toHaveCount(0);
      await details.getByRole("button", { name: "Continue to Build" }).click();
      await expect(page.getByText("Continuing to Build.")).toBeVisible();
      await expect(details).toHaveCount(0);
      await expect(gate).toHaveCount(0);
      await markDone();

      const continuedFromCard = await readyTask(page, project.id, "Goes on from the card");
      await seedGateFirst(page, continuedFromCard);
      await page.goto(`/tasks/${continuedFromCard}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await gate.getByRole("button", { name: "Continue to Build" }).click();
      await expect(gate).toHaveCount(0);
      await markDone();

      // From Now, continuing in the window closes it, and the card goes.
      const continuedFromNow = await readyTask(page, project.id, "Goes on from Now");
      await seedGateFirst(page, continuedFromNow);
      await page.goto(`/tasks/${continuedFromNow}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(gate).toBeVisible();
      await page.goto("/");
      await gate.getByRole("button", { name: "Show details" }).click();
      await details.getByRole("button", { name: "Continue to Build" }).click();
      await expect(details).toHaveCount(0);
      await expect(gate).toHaveCount(0);
      await page.goto(`/tasks/${continuedFromNow}`);
      await markDone();

      // Dropping in the window on Now does the same.
      const droppedFromNow = await readyTask(page, project.id, "Ends from Now");
      await seedGateFirst(page, droppedFromNow);
      await page.goto(`/tasks/${droppedFromNow}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(gate).toBeVisible();
      await page.goto("/");
      await gate.getByRole("button", { name: "Show details" }).click();
      await details.getByRole("button", { name: "Drop", exact: true }).click();
      await expect(details).toContainText("Drop Ends from Now?");
      await details.getByRole("button", { name: "Drop", exact: true }).click();
      await expect(details).toHaveCount(0);
      await expect(gate).toHaveCount(0);

      const dropped = await readyTask(page, project.id, "Ends at the look");
      await seedGateFirst(page, dropped);
      await page.goto(`/tasks/${dropped}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      // Drop asks first over the bar, as no window opens on another.
      await gate.getByRole("button", { name: "Show details" }).click();
      const drop = details.getByRole("button", { name: "Drop", exact: true });
      await drop.click();
      await expect(details).toContainText("Drop Ends at the look?");
      await expect(details.getByRole("button", { name: "Continue to Build" })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-gate-drop.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-gate-drop.png") });
      await showPalette(page, "light");
      await drop.click();
      await expect(details).toHaveCount(0);
      await expect(gate).toHaveCount(0);
      await expect(page.locator(".task-head").getByText("Dropped")).toBeVisible();
      await expect(needsYou).toHaveText("This Task was dropped.");
      await expect(page.getByText("This Task was dropped, so you can read")).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Message" })).toHaveCount(0);
    } finally {
      await repository.remove();
    }
  },
);

/** Build alone, a check run where the Project's Run environment says, so Start opens no session. */
async function seedBuildOnly(page: Page, taskId: string): Promise<void> {
  const edited = await page.request.put(`/api/tasks/${taskId}/stages`, {
    data: {
      stages: [{ kind: "script", key: "build", name: "Build", optional: false, command: "build" }],
    },
  });
  expect(edited.status()).toBe(200);
}

async function runEnvironmentOf(page: Page, projectId: string): Promise<Project["runEnvironment"]> {
  const read = await page.request.get(`/api/projects/${projectId}`);
  return projectSchema.parse(await read.json()).runEnvironment;
}

/** The run environment question in the Task head, beside Start. */
function startQuestion(page: Page): Locator {
  return page.locator(".task-head").getByRole("group", { name: "Run environment" });
}

test(
  "Start asks about a Not decided yet run environment, starts on this computer without an answer, and No ends the asking",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(
        page,
        repository,
        "Asked at Start",
        "AA",
        PASSING_COMMANDS,
      );
      const start = page.getByRole("button", { name: "Start", exact: true });
      const question = startQuestion(page);

      const unanswered = await readyTask(page, project.id, "Starts with no answer");
      await seedBuildOnly(page, unanswered);
      await page.goto(`/tasks/${unanswered}`);
      await expect(question).toContainText("Run this Project's checks in a run environment?");
      await expect(start).toBeEnabled();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-start-run-environment.png"),
      });
      await start.click();
      await expect(question).toHaveCount(0);
      // Build ran on this computer and passed, and the walk asks before the Task can end.
      const needsYou = page.getByRole("region", { name: "Needs you" });
      await needsYou.getByRole("button", { name: "Mark the Task Done" }).click();
      await expect(needsYou).toContainText("Nothing needs you: this Task is Done.");
      expect(await runEnvironmentOf(page, project.id)).toBe("not-decided");

      const answered = await readyTask(page, project.id, "Asked again at Start");
      await page.goto(`/tasks/${answered}`);
      await expect(question).toBeVisible();
      await question.getByRole("button", { name: "No", exact: true }).click();
      await expect(page.getByText(`Checks in ${project.name} run on this computer.`)).toBeVisible();
      await expect(question).toHaveCount(0);
      expect(await runEnvironmentOf(page, project.id)).toBe("off");

      const never = await readyTask(page, project.id, "Never asked again");
      await page.goto(`/tasks/${never}`);
      await expect(page.locator(".task-head").getByText("Never asked again")).toBeVisible();
      await expect(start).toBeVisible();
      await expect(question).toHaveCount(0);
    } finally {
      await repository.remove();
    }
  },
);

test(
  "Yes at Start sets up the run environment: in a Task without .devcontainer/, at once with one",
  { tag: "@full" },
  async ({ page }) => {
    const bare = await createTemporaryRepository();
    const defined = await createTemporaryRepository();
    try {
      await commitFiles(defined, {
        ".devcontainer/devcontainer.json":
          '{ "dockerComposeFile": "compose.yaml", "service": "app" }',
        ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
      });
      const question = startQuestion(page);

      const toSetUp = await addedProject(page, bare, "Set up at Start", "SS", PASSING_COMMANDS);
      await page.goto(`/tasks/${await readyTask(page, toSetUp.id, "Asks to set one up")}`);
      await question.getByRole("button", { name: "Yes", exact: true }).click();
      await expect(
        page.getByText("Set up the run environment is Ready, waiting for your Start."),
      ).toBeVisible();
      // The set-up Task is the answer until it is Done, so neither Task asks again meanwhile.
      await expect(question).toHaveCount(0);
      expect(await runEnvironmentOf(page, toSetUp.id)).toBe("not-decided");
      await page.reload();
      await expect(page.locator(".task-head").getByText("Asks to set one up")).toBeVisible();
      await expect(question).toHaveCount(0);

      const atOnce = await addedProject(page, defined, "On at Start", "OS", PASSING_COMMANDS);
      await page.goto(`/tasks/${await readyTask(page, atOnce.id, "Turns it On")}`);
      await question.getByRole("button", { name: "Yes", exact: true }).click();
      await expect(page.getByText(/Run environment is On/)).toBeVisible();
      await expect(question).toHaveCount(0);
      expect(await runEnvironmentOf(page, atOnce.id)).toBe("on");
    } finally {
      await bare.remove();
      await defined.remove();
    }
  },
);

/** Answers a Decision form of one choice in place, as the user does: the option, then Submit. */
async function pickAndSubmit(card: Locator, option: string): Promise<void> {
  await card.locator("label").filter({ hasText: option }).getByRole("radio").check();
  await card.getByRole("button", { name: "Submit", exact: true }).click();
}

/** A sent form of one question in its Thread: its answer, then that the user gave it. */
async function expectAnsweredByYou(card: Locator, answer: string): Promise<void> {
  await expect(card.locator(".decision-answer-words")).toHaveText(answer);
  await expect(card.locator(".decision-answered")).toHaveText("Answered by you");
}

/**
 * A Decision of one choice in the columns the service keeps it in: `questions`, its form, and the
 * one question in `question`, `options` and `recommendation`, which the release before reads.
 */
function oneChoiceColumns(
  question: string,
  options: readonly string[],
  reason: string,
): readonly string[] {
  const recommendation = { option: 0, reason };
  return [
    question,
    JSON.stringify(options),
    JSON.stringify(recommendation),
    JSON.stringify([{ kind: "choice", question, options, recommendation }]),
  ];
}

const CONSULTATION_QUESTION = "Is the migration safe to run on the live data?";
const CONSULTATION_OPTION = "Yes";

/**
 * Puts to Adam, the Developer, the Decision Jan asked on the Task, and opens the Consultation he
 * answers it in with a first note, as the Consultations service leaves them: a Consultation starts
 * when an Agent's session consults, and no screen can make one.
 */
async function seedConsultation(taskId: string, plannerThreadId: string): Promise<string> {
  const decisionId = crypto.randomUUID();
  const consultationId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, asked_at, put_to)
     values ($1, $2, $3, 'planner', 'question', $4, 'The migration rewrites every row.', $5, $6, $7, now(), 'developer')`,
    [
      decisionId,
      plannerThreadId,
      taskId,
      ...oneChoiceColumns(
        CONSULTATION_QUESTION,
        [CONSULTATION_OPTION, "No"],
        "It ran on the copy.",
      ),
    ],
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

const ANSWERED_CONSULTATION_QUESTION = "Does the rollback run in the tests?";

/** A Consultation Adam answered himself, as only his session can. */
async function seedAnsweredConsultation(taskId: string, plannerThreadId: string): Promise<void> {
  const decisionId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, asked_at, answer, form_answer, answered_at)
     values ($1, $2, $3, 'planner', 'question', $4, 'The rollback is new.', $5, $6, $7, now(), $8, $9, now())`,
    [
      decisionId,
      plannerThreadId,
      taskId,
      ...oneChoiceColumns(ANSWERED_CONSULTATION_QUESTION, [CONSULTATION_OPTION, "No"], "It ran."),
      { kind: "option", option: 0, answeredBy: "developer" },
      { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
    ],
  );
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at, consultation)
     values ($1, 'task', $2, 'developer', 'Consultation · Jan and Adam', 'waiting', $3, now(), $4)`,
    [
      crypto.randomUUID(),
      taskId,
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      { decisionId, askerThreadId: plannerThreadId, askerRoleKey: "planner" },
    ],
  );
}

/** The Decision's header says it was put to Adam: "Jan to Adam", leading to Adam's page. */
async function expectPutToAdam(decision: Locator): Promise<void> {
  const header = decision.locator(".message-by");
  await expect(header.locator(".person-tag-name, .decision-put-to")).toHaveText([
    "Jan",
    "to",
    "Adam",
  ]);
  await expect(header.getByRole("link", { name: "Adam" })).toHaveAttribute(
    "href",
    "/people/developer",
  );
}

// The engine replays the next session in e2e/sessions.jsonl: Jan's, once the user takes the Decision
// over.
test(
  "the user reads a Consultation on the Task, sees its Decision wait on the Consultant, and takes it over",
  { tag: "@full" },
  async ({ page }) => {
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
      // Jan's Thread holds the open Decision, so his is the first tab.
      await expect(conversation.getByRole("tab", { name: /Jan/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The Decision waits on Adam, not on the user: no count on the card, nothing on Now, and the
      // card offers the take-over.
      const needsYou = page.getByRole("region", { name: "Needs you" });
      const decision = needsYou.getByRole("region", {
        name: `Decision: ${CONSULTATION_QUESTION}`,
      });
      await expectPutToAdam(decision);
      await expect(decision).toContainText("Waiting on Adam in a Consultation");
      await expect(needsYou).toContainText("1 waiting on a Consultant");
      await expect(needsYou.getByText(/^\d+$/)).toHaveCount(0);
      const inThread = conversation.getByRole("region", {
        name: `Decision: ${CONSULTATION_QUESTION}`,
      });
      await expectPutToAdam(inThread);
      await expect(inThread).toContainText("Waiting on Adam in a Consultation.");
      await expect(inThread.getByRole("link", { name: "Take it over in Needs you" })).toBeVisible();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-consultation.png") });

      // The Consultant has a tab from the start: the Consultation reads live there, with no way to
      // write in it, and the composer is for their own Thread on the Task.
      const adamTab = conversation.getByRole("tab", { name: /Adam/ });
      await adamTab.click();
      const live = conversation.getByRole("region", {
        name: `Consultation: ${CONSULTATION_QUESTION}`,
      });
      await expect(live).toContainText("I read the migration: it is reversible.");
      await expect(live.getByRole("textbox")).toHaveCount(0);
      await expect(conversation.getByRole("textbox", { name: "Message" })).toHaveAttribute(
        "placeholder",
        /Ask Adam anything/,
      );
      await expect(conversation).toContainText("In a Consultation on this Task");
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-consultation-live.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-consultation-live.png") });
      await showPalette(page, "light");

      await page.goto("/");
      await expect(
        page.getByRole("region", { name: `Decision: ${CONSULTATION_QUESTION}` }),
      ).toHaveCount(0);

      // The Decision's link, as Copy link gives it, opens the Task at its card, marked.
      await page.goto(recordPath({ kind: "decision", taskId, threadId: planning.id, decisionId }));
      await expect(decision).toHaveAttribute("aria-current", "true");
      await expect(decision).toBeInViewport();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-decision-link.png") });

      // In a drawer's window the link lands on the card, so the drawer stays closed, and the way
      // from the Thread to the card closes it, followed again too. The card's way to its Thread
      // opens it, though the Decision is still in the address.
      await page.setViewportSize({ width: DRAWER_WIDTH_PX, height: 800 });
      await page.reload();
      await expect(decision).toBeInViewport();
      await expect(conversation).toBeHidden();
      const takeOverLink = inThread.getByRole("link", { name: "Take it over in Needs you" });
      for (const followed of ["first", "again"]) {
        await conversationHandle(page).click();
        await expect(takeOverLink, followed).toBeVisible();
        await takeOverLink.click();
        await expect(conversation, followed).toBeHidden();
        await expect(decision, followed).toBeInViewport();
      }
      await decision.getByRole("link", { name: /^in Jan's Thread/ }).click();
      await expect(conversation).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(conversation).toBeHidden();
      await page.setViewportSize({ width: 1600, height: 900 });

      // Taking it over: the user answers in the card, and Jan takes the answer in the asking Thread.
      await pickAndSubmit(decision, CONSULTATION_OPTION);
      await expect(decision).toHaveCount(0);
      await expect(needsYou).toContainText("Ready: start it when you want");
      await expectAnsweredByYou(inThread, `${CONSULTATION_OPTION} (recommended)`);
      await expect(conversation.getByText("Then the migration goes first.")).toBeVisible();
      await expect(adamTab).toHaveCount(0);

      // A Consultant who answered has a tab, with the Consultation above their Thread.
      await seedAnsweredConsultation(taskId, planning.id);
      await page.reload();
      await adamTab.click();
      await expect(adamTab).toHaveAttribute("aria-selected", "true");
      const answered = conversation.getByRole("region", {
        name: `Consultation: ${ANSWERED_CONSULTATION_QUESTION}`,
      });
      await expect(answered).toContainText(CONSULTATION_OPTION);
      await expect(conversation.getByRole("textbox", { name: "Message" })).toHaveAttribute(
        "placeholder",
        /Ask Adam anything/,
      );
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-consultant-tab.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-consultant-tab.png") });
      await showPalette(page, "light");
    } finally {
      await repository.remove();
    }
  },
);

function scrollTopOf(scroller: Locator): Promise<number> {
  return scroller.evaluate((view) => view.scrollTop);
}

// The engine replays the next sessions in e2e/sessions.jsonl. Implement's waits at each message the
// script has the user send, which is what keeps the Stage running; then Jan's, then Adam's own.
test(
  "a running Task takes a barge-in and a Planner message, and new messages leave a reader who scrolled up where they are",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Running", "RU", PASSING_COMMANDS);
      const taskId = await readyTask(page, project.id, "Export keeps its columns");
      await seedGatedStages(page, taskId);
      await page.goto(`/tasks/${taskId}`);

      const conversation = page.getByRole("complementary", { name: "Conversation" });
      const composer = conversation.getByRole("textbox", { name: "Message" });
      const timeline = conversation.locator(".timeline");
      const janTab = conversation.getByRole("tab", { name: /Jan/ });
      const adamTab = conversation.getByRole("tab", { name: /Adam/ });
      const peopleTabs = conversation.locator(".conversation-tabs").getByRole("tab");
      const cacheMark = conversation.locator(".timeline-to").getByRole("img");
      const contextWords = conversation.getByLabel("Context", { exact: true });
      const fromTheEnd = (): Promise<number> =>
        timeline.evaluate((view) => view.scrollHeight - view.scrollTop - view.clientHeight);
      const threadsOnTask = async (): Promise<readonly Thread[]> =>
        threadListSchema.parse(
          await (await page.request.get(`/api/tasks/${taskId}/threads`)).json(),
        );

      // The person gets a tab as their Stage starts, with a live dot, and the tab shown stays.
      await expect(janTab).toHaveAttribute("aria-selected", "true");
      await expect(peopleTabs).toHaveCount(1);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(adamTab).toContainText("working now");
      await expect(janTab).toHaveAttribute("aria-selected", "true");

      // The board's card names who works in the Stage's Thread.
      await page.goto("/work");
      await expect(
        page
          .getByRole("article", { name: "Export keeps its columns" })
          .getByRole("img", { name: "Working now: Adam" }),
      ).toBeVisible();
      await page.goto(`/tasks/${taskId}`);

      // Landing on the page, the first tab is the person whose Stage runs. Their Thread opens only
      // on the first message, and the Stage's Thread shows only in its history.
      await page.reload();
      await expect(adamTab).toHaveAttribute("aria-selected", "true");
      await expect(conversation).toContainText(
        "No messages yet. Ask Adam anything about this Task",
      );
      await expect(composer).toBeVisible();
      expect((await threadsOnTask()).filter(({ roleKey }) => roleKey === "developer")).toHaveLength(
        1,
      );
      // With no session yet there is no cache to mark, and the words say what the first message does.
      await expect(contextWords).toHaveText(/^Starts a session with a Brief ~[\d.]+k? tokens$/);
      await expect(cacheMark).toHaveCount(0);
      await expect(conversation).toContainText(
        "Adam is working on Implement now. To write into that work, open its Stage history.",
      );

      // A barge-in from the Stage history lands at the next safe point, and waits to be taken until
      // the turn ends. The window opens on the running Thread, which follows live, and a draft stays
      // as the user reads the Summary.
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-working-now.png"),
        animations: "disabled",
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
      await page.screenshot({
        path: path.join(SCREENSHOTS, "dark-1600-working-now.png"),
        animations: "disabled",
      });
      await page.emulateMedia({ colorScheme: "light" });
      await conversation.getByRole("button", { name: "Open the Stage history" }).click();
      const history = page.getByRole("dialog", { name: /^Stage history: Implement/ });
      const runningRun = history.getByRole("region", { name: "Run 1", exact: true });
      await expect(runningRun.getByText("I am reading the export's columns.")).toBeVisible();
      await expect(runningRun).toContainText(": lands at the next safe point");
      const bargeIn = runningRun.getByRole("textbox", { name: "Message" });
      await expect(bargeIn).toHaveAttribute("placeholder", /while the Stage runs/);
      await bargeIn.fill("Keep the header row");
      await history.getByRole("tab", { name: "Summary" }).click();
      await history.getByRole("tab", { name: "Thread" }).click();
      await expect(bargeIn).toHaveValue("Keep the header row");
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-run-thread-live.png") });
      await page.emulateMedia({ colorScheme: "dark" });
      await motionSettled(page);
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-run-thread-live.png") });
      await page.emulateMedia({ colorScheme: "light" });
      await bargeIn.press("Enter");
      await expect(bargeIn).toHaveValue("");
      await expect(runningRun.getByText("Keep the header row")).toBeVisible();
      await expect(
        runningRun.getByText("Lands at the next safe point", { exact: true }),
      ).toBeVisible();
      await expect(runningRun.getByText("I will keep the CSV's header row.")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(conversation.getByText("I will keep the CSV's header row.")).toHaveCount(0);
      await expect(page.locator(".task-head").getByText("Running")).toBeVisible();

      // The Planner answers beside the running Stage.
      await janTab.click();
      await composer.fill("Does the Plan cover the header row?");
      await composer.press("Enter");
      const plannerAnswer = conversation.getByText("The Plan already covers the header row.");
      await expect(plannerAnswer).toBeVisible();
      const inTheTimeline = await timeline.boundingBox();
      const answerBox = await plannerAnswer.boundingBox();
      if (inTheTimeline === null || answerBox === null) throw new Error("Nothing was drawn.");
      expect(answerBox.y + answerBox.height).toBeLessThanOrEqual(
        inTheTimeline.y + inTheTimeline.height,
      );
      await expect(page.locator(".task-head").getByText("Running")).toBeVisible();

      // So does a second person: the first message opens their Thread, and each tab keeps its draft.
      await janTab.click();
      await composer.fill("For Jan");
      await adamTab.click();
      await expect(composer).toHaveAttribute("placeholder", /Ask Adam anything/);
      await expect(composer).toHaveValue("");
      await expect(conversation.getByText("The Plan already covers")).toHaveCount(0);
      await composer.fill("Which columns does the export write?");
      await janTab.click();
      await expect(composer).toHaveValue("For Jan");
      await composer.fill("");
      await adamTab.click();
      await expect(composer).toHaveValue("Which columns does the export write?");
      await composer.press("Enter");
      await expect(conversation.getByText("Column 40 keeps its place.")).toBeVisible();
      await expect.poll(fromTheEnd).toBeLessThan(40);
      // The session is warm now: the To line counts its cache down, before the person's name.
      await expect(cacheMark).toHaveAccessibleName(/^Cache warm: \d+ min left/);
      await expect(cacheMark).toHaveText(/^\d+m$/);
      await expect(contextWords).toHaveText(/^Continues · cache warm, \d+ min left$/);
      await expect(
        conversation.getByRole("img", { name: /^Context: \d+(\.\d)?k of \d+(\.\d)?[kM]$/ }),
      ).toBeVisible();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-conversation-warm.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-conversation-warm.png") });
      await showPalette(page, "light");
      const adamsThread = (await threadsOnTask()).find(
        ({ roleKey, stageThread }) => roleKey === "developer" && !stageThread,
      );
      if (!adamsThread) throw new Error("Asking Adam opened no Thread.");
      const sendToAdam = async (text: string): Promise<void> => {
        await expect
          .poll(async () => {
            const thread = await (await page.request.get(`/api/threads/${adamsThread.id}`)).json();
            return threadSchema.parse(thread).state;
          })
          .toBe("waiting");
        const sent = await page.request.post(`/api/threads/${adamsThread.id}/messages`, {
          data: { text },
        });
        expect(sent.ok()).toBe(true);
      };

      // A reader who scrolled up stays there, the page too; the button brings them to the end.
      await timeline.hover();
      await page.mouse.wheel(0, -400);
      await expect.poll(fromTheEnd).toBeGreaterThan(40);
      const pageScroller = page.locator(".shell-main");
      const readingAt = await scrollTopOf(timeline);
      const pageAt = await scrollTopOf(pageScroller);
      await sendToAdam("Does the order change?");
      // The user's message and the two answers.
      const newMessages = conversation.getByRole("button", { name: /new messages?$/ });
      await expect(newMessages).toHaveText("3 new messages");
      expect(await scrollTopOf(timeline)).toBe(readingAt);
      expect(await scrollTopOf(pageScroller)).toBe(pageAt);
      await newMessages.click();
      await expect.poll(fromTheEnd).toBeLessThan(40);
      await expect(newMessages).toHaveCount(0);
      await expect(conversation.getByText("Nothing else moves.")).toBeVisible();
      expect(await scrollTopOf(pageScroller)).toBe(pageAt);

      // A tab counts what landed in its Thread while another was shown, until it is looked at.
      await janTab.click();
      await sendToAdam("Does the tab count this?");
      await expect(adamTab).toHaveText(/2$/);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-tab-count.png") });
      await adamTab.click();
      await expect(adamTab).not.toHaveText(/\d$/);

      // The control takes the next message's choice, and Auto gives it back.
      const startFresh = conversation.getByRole("tab", { name: "Start fresh" });
      await startFresh.click();
      await expect(contextWords).toHaveText(/^Starts fresh · Brief ~[\d.]+k? tokens$/);
      await conversation.getByRole("tab", { name: "Auto" }).click();
      await expect(contextWords).toHaveText(/^Continues · cache warm/);

      // Once the cache has cooled the mark is cold, and the words say what the next message costs.
      const adamsThreadRead = `**/api/threads/${adamsThread.id}`;
      await page.route(adamsThreadRead, async (route) => {
        const response = await route.fetch();
        const thread = threadSchema.parse(await response.json());
        await route.fulfill({
          response,
          json: {
            ...thread,
            context: {
              ...thread.context,
              move: "fresh",
              reason: "cache-expired",
              cacheWarm: false,
              cacheWarmUntil: null,
              contextTokens: 48_000,
              briefTokens: 3_000,
              alternatives: [{ override: "continue-anyway", tokens: 48_000 }],
            },
          },
        });
      });
      await page.reload();
      await expect(cacheMark).toHaveAccessibleName(/^Cache cold/);
      await expect(contextWords).toHaveText(
        "Starts fresh · cache cold, context large · Brief ~3k tokens",
      );
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-conversation-cold.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-conversation-cold.png") });
      await showPalette(page, "light");
      await expect(conversation.getByRole("tab", { name: "Continue" })).toHaveAttribute(
        "title",
        "Continues anyway · cache cold, so the whole context is read again",
      );
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-cache-cold.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-cache-cold.png") });
      await showPalette(page, "light");
      await page.unroute(adamsThreadRead);
      await page.reload();
      await expect(cacheMark).toHaveAccessibleName(/^Cache warm/);

      // Full width the conversation is a column, with no way to close it.
      const closeDrawer = page.getByRole("button", { name: "Close the conversation" });
      await expect(conversation).toBeVisible();
      await expect(conversationHandle(page)).toHaveCount(0);
      await expect(closeDrawer).toHaveCount(0);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-conversation.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-conversation.png") });
      await showPalette(page, "light");

      // In a narrow window it is a drawer, closed at first, and the page keeps to the window.
      await page.setViewportSize({ width: DRAWER_WIDTH_PX, height: 800 });
      const handle = conversationHandle(page);
      await expect(handle).toBeVisible();
      await expect(conversation).toBeHidden();
      for (const width of [1100, 730]) {
        await page.setViewportSize({ width, height: 800 });
        await expect.poll(() => windowOverflow(page), `at ${width}`).toBe(0);
      }
      await page.setViewportSize({ width: DRAWER_WIDTH_PX, height: 800 });
      expect(await windowOverflow(page)).toBe(0);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-900-drawer-closed.png") });

      // It opens with focus inside, and each way of closing keeps a draft and gives focus back.
      await handle.click();
      await expect(conversation).toBeFocused();
      await composer.fill("Keep this draft");
      await page.keyboard.press("Escape");
      await expect(conversation).toBeHidden();
      await expect(handle).toBeFocused();

      await handle.click();
      await expect(composer).toHaveValue("Keep this draft");
      await closeDrawer.click();
      await expect(conversation).toBeHidden();
      await expect(handle).toBeFocused();

      await handle.click();
      await expect(composer).toHaveValue("Keep this draft");
      await motionSettled(page);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-900-drawer-open.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-900-drawer-open.png") });
      await showPalette(page, "light");

      // Tab stays in the drawer, and the page behind the dimming doesn't scroll.
      for (let press = 0; press < 40; press += 1) await page.keyboard.press("Tab");
      expect(await conversation.evaluate((panel) => panel.contains(document.activeElement))).toBe(
        true,
      );
      const pageBehind = await scrollTopOf(pageScroller);
      await page.mouse.move(100, 400);
      await page.mouse.wheel(0, 400);
      await timeline.hover();
      await page.mouse.wheel(0, 4000);
      await expect.poll(fromTheEnd).toBeLessThan(40);
      expect(await scrollTopOf(pageScroller)).toBe(pageBehind);

      await page.mouse.click(100, 400);
      await expect(conversation).toBeHidden();
      await expect(handle).toBeFocused();

      // What lands in a closed drawer counts on the handle and is read on opening. The user's
      // message and the answer.
      await sendToAdam("One more thing");
      await expect(handle).toContainText("2");
      await expect(handle).toHaveAccessibleName("Conversation 2 new messages");
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-900-drawer-count.png") });
      await showPalette(page, "dark");
      await page.screenshot({ path: path.join(SCREENSHOTS, "dark-900-drawer-count.png") });
      await showPalette(page, "light");
      await handle.click();
      await expect(conversation.getByText("Heard from the drawer too.")).toBeVisible();
      await expect(newMessages).toHaveCount(0);
      await expect(handle).toHaveAccessibleName("Conversation");
      await page.keyboard.press("Escape");

      // A window that widens shows the column again, with no dimming left when it narrows.
      await handle.click();
      await page.setViewportSize({ width: 1600, height: 900 });
      await expect(conversation).toBeVisible();
      await page.setViewportSize({ width: DRAWER_WIDTH_PX, height: 300 });
      await expect(conversation).toBeHidden();

      // A window too low for the foot still reaches it.
      await handle.click();
      await motionSettled(page);
      await conversation.evaluate((panel) => {
        panel.scrollTop = panel.scrollHeight;
      });
      await expect(composer).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-900x300-drawer.png") });
      await composer.fill("");
      await page.setViewportSize({ width: 1600, height: 900 });

      // The Stage takes the rest of its messages, and goes on to its Gate.
      const implementThread = (await threadsOnTask()).find(({ stageThread }) => stageThread);
      if (!implementThread) throw new Error("The Stage opened no Thread.");
      for (const [text, answer] of [
        ["Check the order too", "The columns are in order."],
        ["That is all", "The export is done."],
        ["One more thing", "The drawer heard you."],
      ] as const) {
        const sent = await page.request.post(`/api/threads/${implementThread.id}/messages`, {
          data: { text },
        });
        expect(sent.ok()).toBe(true);
        await expect
          .poll(async () =>
            (await page.request.get(`/api/threads/${implementThread.id}/messages`)).text(),
          )
          .toContain(answer);
      }
      const gate = page.getByRole("region", { name: "Gate · UI acceptance" });
      await gate.getByRole("button", { name: "Show details" }).click();
      const drop = page.getByRole("dialog").getByRole("button", { name: "Drop", exact: true });
      await drop.click();
      await expect(page.getByRole("dialog")).toContainText("a dropped Task can't be picked up");
      await drop.click();
      await expect(page.getByRole("region", { name: "Needs you" })).toContainText(
        "This Task was dropped",
      );
    } finally {
      await repository.remove();
    }
  },
);

// The engine replays the last session in e2e/sessions.jsonl: Jan's answer in a new chat Thread.
test(
  "the user mentions a Task with @ in a chat, and the person is briefed with its record",
  { tag: "@full" },
  async ({ page }) => {
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
      await startNewThread(chat);
      const { id: threadId } = threadSchema.parse(await (await starting).json());
      // Typed only once the new Thread shows: its composer starts with an empty draft.
      await expect.poll(() => chatThreadShown(page)).toBe(threadId);
      const message = chat.getByRole("textbox", { name: "Message" });
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
      await detailsSwitch(chat).click();
      await chat.locator("summary", { hasText: "Brief" }).click();
      await expect(chat.getByText("Records the user mentioned")).toBeVisible();
      await expect(chat.getByText(`Export the invoices as CSV (Task ${task.id})`)).toBeVisible();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-mention.png") });

      await chat.getByRole("link", { name: "Export the invoices as CSV" }).click();
      await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
    } finally {
      await repository.remove();
    }
  },
);

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

test(
  "the user hires from Marta's Proposals, as drafted and edited first, applies a change and declines one",
  { tag: "@full" },
  async ({ page }) => {
    const started = await page.request.post("/api/chats/office-manager/threads");
    expect(started.status()).toBe(201);
    const { id: threadId } = threadSchema.parse(await started.json());
    const { card: reviewer } = roleSchema.parse(
      await (await page.request.get("/api/roles/reviewer")).json(),
    );
    const consultantNow = {
      ...reviewer.capabilities,
      consultant: !reviewer.capabilities.consultant,
    };
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
  },
);

test(
  "the user hires into a preset's Role from Marta's Proposal under another name, and applies a new size threshold",
  { tag: "@full" },
  async ({ page }) => {
    const started = await page.request.post("/api/chats/office-manager/threads");
    const { id: threadId } = threadSchema.parse(await started.json());
    const readThreshold = async () =>
      sizeThresholdSchema.parse(
        await (await page.request.get("/api/settings/size-threshold")).json(),
      ).sizeThreshold;
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
      await page.request.put("/api/settings/size-threshold", {
        data: { sizeThreshold: threshold },
      });
    }
  },
);

/**
 * Puts each duty back as `before` had it, in the records: a duty never set is unset again, which no
 * screen or API can do, and a holder since let go can't be set again through the API.
 */
async function restoreDuties(page: Page, before: readonly Duty[]): Promise<void> {
  const now = new Map((await dutiesNow(page)).map((duty) => [duty.key, duty]));
  for (const { key, set, roleKey } of before) {
    const changed = now.get(key);
    if (changed?.set === set && changed.roleKey === roleKey) continue;
    await queryOfficeDatabase("delete from duty_assignments where duty = $1", [key]);
    if (set) {
      await queryOfficeDatabase(
        "insert into duty_assignments (duty, role_key, changed_at) values ($1, $2, now())",
        [key, roleKey],
      );
    }
  }
}

async function dutiesNow(page: Page): Promise<Duty[]> {
  return dutyListSchema.parse(await (await page.request.get("/api/settings/duties")).json());
}

function isPlans({ key }: Duty): boolean {
  return key === "plans";
}

test(
  "the user sets a duty's holder in Settings › Duties, sees it on the Role card and in People, and applies Marta's Proposal of duties",
  { tag: "@full" },
  async ({ page }) => {
    const MCP_DUTY = "Default Consultant for MCP tool hard switches";
    const before = await dutiesNow(page);
    const { card } = roleSchema.parse(await (await page.request.get("/api/roles/planner")).json());
    const planner = `${card.name} · ${card.title}`;
    try {
      await page.goto("/settings/duties");
      await expect(page.getByRole("link", { name: "Duties" })).toBeVisible();
      const picker = page.getByLabel(MCP_DUTY, { exact: true });
      await picker.selectOption({ label: planner });
      await expect(page.getByText(`${MCP_DUTY}: ${planner} holds it now.`)).toBeVisible();
      await page.reload();
      await expect(page.getByLabel(MCP_DUTY, { exact: true })).toHaveValue("planner");
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-settings-duties.png") });

      await page.goto("/people/planner/role");
      await expect(roleCardGroup(page, "Identity")).toContainText(MCP_DUTY);
      await page.goto("/people");
      const tile = page.locator(".person-card").filter({ hasText: card.name });
      const mark = tile.getByRole("img", { name: new RegExp(`duties?: .*${MCP_DUTY}`) });
      await expect(mark).toBeVisible();
      await mark.hover();
      await expect(page.getByRole("tooltip")).toContainText(MCP_DUTY);
      await page.mouse.move(0, 0);
      // The mark's Tooltip trigger is the focus stop around it.
      await mark.locator("xpath=..").focus();
      await expect(page.getByRole("tooltip")).toContainText(MCP_DUTY);

      await page.goto("/settings/duties");
      await page.getByLabel(MCP_DUTY, { exact: true }).selectOption({ label: "Nobody" });
      await expect(page.getByText(`${MCP_DUTY}: nobody holds it now.`)).toBeVisible();
      const row = page.locator(".duty-row").filter({ hasText: MCP_DUTY });
      await expect(row).toContainText("You do it yourself.");

      const started = await page.request.post("/api/chats/office-manager/threads");
      const { id: threadId } = threadSchema.parse(await started.json());
      const askedFirst = before.find(({ key }) => key === "asked-first-when-out-of-tries");
      await seedProposal(threadId, {
        kind: "duties",
        from: { "mcp-tool-consultant": null, "asked-first-when-out-of-tries": askedFirst?.roleKey },
        to: { "mcp-tool-consultant": "planner", "asked-first-when-out-of-tries": "planner" },
      });
      // Drafted from a holder Plans no longer has, as if it changed after the draft.
      await seedProposal(threadId, {
        kind: "duties",
        from: { plans: "a-role-gone-since" },
        to: { plans: null },
      });

      await page.goto(`/people?chat=office-manager&thread=${threadId}`);
      const proposals = chatWith(page, "Marta").getByRole("region", {
        name: "Proposal: Change duties",
      });
      const applied = proposals.filter({ hasText: MCP_DUTY });
      await expect(applied.getByRole("listitem").first()).toContainText(`${planner}`);
      await applied.getByRole("button", { name: "Apply change" }).click();
      await expect(applied).toContainText("Applied");
      const holders = new Map((await dutiesNow(page)).map(({ key, roleKey }) => [key, roleKey]));
      expect(holders.get("mcp-tool-consultant")).toBe("planner");
      expect(holders.get("asked-first-when-out-of-tries")).toBe("planner");

      const stale = proposals.filter({ hasText: "Plans" }).filter({ hasNotText: MCP_DUTY });
      await stale.getByRole("button", { name: "Apply change" }).click();
      await expect(stale).toContainText("Plans was changed meanwhile");
      expect((await dutiesNow(page)).find(isPlans)?.roleKey).toBe(before.find(isPlans)?.roleKey);
    } finally {
      await restoreDuties(page, before);
    }
  },
);

test(
  "a chat opens over each section of a Project, whose address and menu stay on it",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Chat over sections", "CS");
      const started = await page.request.post("/api/chats/office-manager/threads");
      const { id: threadId } = threadSchema.parse(await started.json());
      const openSection = page
        .getByRole("navigation", { name: "Project", exact: true })
        .locator("a[aria-current='page']");
      const sections = [
        { name: "Overview", address: `/projects/${project.id}` },
        { name: "Commands", address: `/projects/${project.id}/commands` },
        { name: "Pipelines", address: `/projects/${project.id}/pipelines` },
        { name: "Engine", address: `/projects/${project.id}/engine` },
        { name: "Skills", address: `/projects/${project.id}/skills` },
        { name: "Server values", address: `/projects/${project.id}/server-values` },
      ];

      for (const { name, address } of sections) {
        const withChat = `${address}?chat=office-manager&thread=${threadId}`;
        await page.goto(withChat);

        await expect(chatWith(page, "Marta")).toBeVisible();
        await expect(page).toHaveURL(address);
        await expect(openSection).toHaveText(name);

        await page.keyboard.press("Escape");
        await expect(chatWith(page, "Marta")).toHaveCount(0);
        await expect(page).toHaveURL(address);
        await expect(openSection).toHaveText(name);
      }
    } finally {
      await repository.remove();
    }
  },
);

test(
  "the user asks Nina from a Project's Commands and a library Pipeline, and applies her Proposals; a stale one is refused",
  { tag: "@full" },
  async ({ page }) => {
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
      await page.goto(`/projects/${project.id}/commands`);
      await page.getByRole("button", { name: "Ask Nina to propose a change" }).click();
      await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
        `Can you propose a change to the commands of ${project.name}? `,
      );
      await page.goto(`/settings/pipelines/${pipeline.id}`);
      await page.getByRole("button", { name: "Ask Nina", exact: true }).click();
      await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
        `Can you propose a change to the ${pipeline.name} Pipeline? `,
      );
      const threadId = await chatThreadShown(page);

      const lint: Stage = {
        kind: "script",
        key: "lint",
        name: "Lint",
        optional: false,
        command: "lint",
      };
      const proposedStages = asStageList([
        ...pipeline.stages.slice(0, -1),
        lint,
        ...pipeline.stages.slice(-1),
      ]);
      await seedProposal(
        threadId,
        {
          kind: "project-commands",
          projectId: project.id,
          changes: {
            installInputs: { from: [], to: ["package-lock.json"] },
            commands: [
              {
                key: "test",
                from: { name: "Test", kind: "test", commandLine: "npm test" },
                to: { name: "Test", kind: "test", commandLine: "npm run test:all" },
              },
              {
                key: "test-e2e",
                from: null,
                to: { name: "End to end", kind: "test", commandLine: "npm run e2e" },
              },
            ],
          },
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
          changes: {
            commands: [
              {
                key: "build",
                from: { name: "Build", kind: "build", commandLine: "make" },
                to: { name: "Build", kind: "build", commandLine: "make all" },
              },
            ],
          },
        },
        "devops",
      );
      await page.goto(`/projects/${project.id}?chat=devops&thread=${threadId}`);

      const commandCards = nina.getByRole("region", {
        name: `Proposal: Change ${project.name}'s commands`,
      });
      const commands = commandCards.filter({ hasText: "npm run test:all" });
      await expect(commands.getByRole("listitem")).toHaveText([
        "Install inputsNonepackage-lock.json",
        "Test (test)Test · npm testTest · npm run test:all",
        "End to end (test-e2e)None: addedTest · npm run e2e",
      ]);
      await commands.getByRole("button", { name: "Apply change" }).click();
      await expect(commands).toContainText("Applied");
      await expect(page.getByText(`${project.name}'s commands changed.`)).toBeVisible();
      const applied = projectSchema.parse(
        await (await page.request.get(`/api/projects/${project.id}`)).json(),
      );
      expect(applied.commands.map(({ key, commandLine }) => [key, commandLine])).toEqual([
        ["build", "npm run build"],
        ["lint", "npm run lint"],
        ["test", "npm run test:all"],
        ["test-e2e", "npm run e2e"],
      ]);
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
  },
);

test(
  "the user asks Nina from a Stage template and applies her Proposal; a stale one is refused",
  { tag: "@full" },
  async ({ page }) => {
    const template = stageTemplateSchema.parse(
      await (
        await page.request.post("/api/stage-templates", {
          data: {
            stage: {
              kind: "agent",
              key: "review",
              name: `Review ${Date.now()}`,
              role: "developer",
              brief: "Review the change.",
              session: "fresh",
              budget: 100_000,
              optional: false,
            },
          },
        })
      ).json(),
    );
    const nina = chatWith(page, "Nina");

    // Asked from the open template, Nina's chat opens on a new Thread with the question.
    await page.goto(`/settings/pipelines/stage-templates/${template.id}`);
    await page.getByRole("button", { name: "Ask Nina", exact: true }).click();
    await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
      `Can you propose a change to the ${template.stage.name} Stage template? `,
    );
    const threadId = await chatThreadShown(page);

    await seedProposal(
      threadId,
      {
        kind: "stage-template",
        templateId: template.id,
        from: template.stage,
        to: { ...template.stage, budget: 150_000 },
      },
      "devops",
    );
    // Drafted from a Stage the user has changed since.
    await seedProposal(
      threadId,
      {
        kind: "stage-template",
        templateId: template.id,
        from: { ...template.stage, brief: "Review it." },
        to: { ...template.stage, brief: "Review it twice." },
      },
      "devops",
    );
    await page.goto(
      `/settings/pipelines/stage-templates/${template.id}?chat=devops&thread=${threadId}`,
    );

    const cards = nina.getByRole("region", {
      name: `Proposal: Change the ${template.stage.name} Stage template`,
    });
    const budget = cards.filter({ hasText: "150k tokens" });
    await expect(budget.getByRole("listitem")).toHaveText("Budget100k tokens150k tokens");
    await budget.getByRole("button", { name: "Apply change" }).click();
    await expect(budget).toContainText("Applied");
    // The open template follows, saved, with no draft of its own to keep.
    await expect(page.getByLabel("Budget")).toHaveValue("150");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const saved = stageTemplateSchema.parse(
      await (await page.request.get(`/api/stage-templates/${template.id}`)).json(),
    );
    expect(saved.stage).toEqual({ ...template.stage, budget: 150_000 });
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-devops-stage-template-proposal.png"),
    });

    const stale = cards.filter({ hasText: "Review it twice." });
    await stale.getByRole("button", { name: "Apply change" }).click();
    await expect(stale).toContainText("The change can't be applied yet");
    await expect(stale).toContainText(
      `The ${template.stage.name} Stage template changed since this was proposed.`,
    );
    await expect(stale.getByRole("button", { name: "Apply change" })).toBeVisible();
  },
);

test(
  "the user reads Nina's Proposal of a Pipeline's routes as a flow, shows it on the flow and applies it from there",
  { tag: "@full" },
  async ({ page }) => {
    const quickFix = pipelineSchema.parse(
      await (await page.request.get("/api/pipelines/quick-fix")).json(),
    );
    const pipeline = pipelineSchema.parse(
      await (
        await page.request.post("/api/pipelines", {
          data: { name: `Routed ${Date.now()}`, description: "", stages: quickFix.stages },
        })
      ).json(),
    );
    const [implement, tests, publish] = pipeline.stages;
    if (!implement || !tests || !publish) throw new Error("Quick fix has three Stages.");
    const nina = chatWith(page, "Nina");
    await page.goto(`/settings/pipelines/${pipeline.id}`);
    await page.getByRole("button", { name: "Ask Nina", exact: true }).click();
    await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
      `Can you propose a change to the ${pipeline.name} Pipeline? `,
    );
    const threadId = await chatThreadShown(page);

    // Tests runs only when Implement changed files; otherwise the Task goes straight to Publish.
    const proposedRoutes = [
      {
        to: tests.key,
        condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
      },
      { to: publish.key, condition: null },
    ];
    await seedProposal(
      threadId,
      {
        kind: "pipeline",
        pipelineId: pipeline.id,
        from: pipeline.stages,
        to: [{ ...implement, routes: proposedRoutes }, tests, publish],
        routes: {
          stages: [
            {
              stageKey: implement.key,
              stageName: implement.name,
              from: implement.routes,
              to: proposedRoutes,
            },
          ],
          check: [],
        },
      },
      "devops",
    );
    await page.goto(`/settings/pipelines/${pipeline.id}?chat=devops&thread=${threadId}`);

    const card = nina.getByRole("region", {
      name: `Proposal: Change the ${pipeline.name} Pipeline`,
    });
    await expect(
      card.getByRole("list", { name: "Was: routes out of Implement" }).getByRole("listitem"),
    ).toHaveText(["→ Tests, always"]);
    await expect(
      card.getByRole("list", { name: "Proposed: routes out of Implement" }).getByRole("listitem"),
    ).toHaveText(["→ Tests when Implement changed files", "→ Publish otherwise"]);
    const flow = card.getByRole("region", { name: `${pipeline.name}, as proposed` });
    await expect(flow).toContainText("Checked: every Stage is reached");
    await expect(flow.locator(".flow-canvas-route-line--proposed")).toHaveCount(2);
    await expect(flow.locator(".flow-canvas-route-line--taken-away")).toHaveCount(1);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-routes-proposal.png") });

    await flow.getByRole("button", { name: "Show it on the flow" }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/pipelines/${pipeline.id}\\?proposal=`));
    const banner = page.getByRole("status", {
      name: `Nina's Proposal, shown on ${pipeline.name}`,
    });
    await expect(banner).toContainText(
      "Routes out of Implement: to Tests when Implement changed files, otherwise to Publish.",
    );
    await expect(banner.getByRole("button", { name: "Back to the Thread" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "What the lines mean" })).toHaveText(
      /As it is\s*Proposed by Nina\s*Taken away/,
    );
    // At wide width the chat stays open beside the flow.
    await expect(card).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-routes-proposal-on-flow.png"),
    });

    await banner.getByRole("button", { name: "Apply change" }).click();
    await expect(
      page.getByText(`${pipeline.name} changed. Tasks that haven't started follow it.`),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/settings/pipelines/${pipeline.id}$`));
    await expect(banner).toHaveCount(0);
    await expect(card).toContainText("Applied");
    const saved = pipelineSchema.parse(
      await (await page.request.get(`/api/pipelines/${pipeline.id}`)).json(),
    );
    expect(saved.stages[0]?.routes?.map(({ to }) => to)).toEqual([tests.key, publish.key]);
  },
);

test(
  "the user applies Nina's new Project Pipeline and her change to one; a stale one is refused, and a library Pipeline's Proposal warns what it breaks",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const stamp = Date.now();
      const project = await addedProject(page, repository, `Own Pipelines ${stamp}`, "OP");
      const quickFix = pipelineSchema.parse(
        await (await page.request.get("/api/pipelines/quick-fix")).json(),
      );
      const base = pipelineSchema.parse(
        await (
          await page.request.post("/api/pipelines", {
            data: { name: `Base ${stamp}`, description: "", stages: quickFix.stages },
          })
        ).json(),
      );
      const lint: Stage = {
        kind: "script",
        key: "lint",
        name: "Lint",
        optional: false,
        command: "lint",
      };
      const withLint = projectPipelineSchema.parse(
        await (
          await page.request.post("/api/project-pipelines", {
            data: {
              projectId: project.id,
              name: `${base.name} with lint`,
              description: "Then lint.",
              basePipelineId: base.id,
              stageChanges: [{ kind: "insert-after", stageKey: "tests", stage: lint }],
            },
          })
        ).json(),
      );
      const fields = {
        name: withLint.name,
        description: withLint.description,
        basePipelineId: base.id,
        stageChanges: withLint.stageChanges,
      };
      const nina = chatWith(page, "Nina");

      await page.goto(`/settings/pipelines/${base.id}`);
      await page.getByRole("button", { name: "Ask Nina", exact: true }).click();
      await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
        `Can you propose a change to the ${base.name} Pipeline? `,
      );
      const threadId = await chatThreadShown(page);
      const review: Stage = {
        kind: "gate",
        key: "your-review",
        name: "Your review",
        optional: false,
      };
      const newName = `${base.name} with your review`;
      await seedProposal(
        threadId,
        {
          kind: "project-pipeline",
          projectId: project.id,
          pipelineId: null,
          from: null,
          to: {
            name: newName,
            description: "Then your review.",
            basePipelineId: base.id,
            stageChanges: [{ kind: "insert-before", stageKey: "publish", stage: review }],
          },
        },
        "devops",
      );
      await seedProposal(
        threadId,
        {
          kind: "project-pipeline",
          projectId: project.id,
          pipelineId: withLint.id,
          from: fields,
          to: { ...fields, description: "Lint before publishing." },
        },
        "devops",
      );
      // Drafted from a description the user has changed since.
      await seedProposal(
        threadId,
        {
          kind: "project-pipeline",
          projectId: project.id,
          pipelineId: withLint.id,
          from: { ...fields, description: "Lint, as it was." },
          to: { ...fields, description: "Stale words." },
        },
        "devops",
      );
      // Base's new Stages leave out Tests, which the Project Pipeline inserts Lint after.
      await seedProposal(
        threadId,
        {
          kind: "pipeline",
          pipelineId: base.id,
          from: base.stages,
          to: asStageList(base.stages.filter(({ key }) => key !== "tests")),
        },
        "devops",
      );
      await page.goto(`/settings/pipelines/${base.id}?chat=devops&thread=${threadId}`);

      const breaking = nina.getByRole("region", {
        name: `Proposal: Change the ${base.name} Pipeline`,
      });
      await expect(breaking).toContainText("Applying this breaks 1 Project Pipeline");
      await expect(breaking).toContainText(
        `${project.name} › ${withLint.name}: Inserts Lint after Tests, which ${base.name} no longer has.`,
      );
      await breaking.getByRole("button", { name: "Apply anyway" }).scrollIntoViewIfNeeded();
      await expect(breaking.getByRole("button", { name: "Apply anyway" })).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-devops-project-pipeline-proposals.png"),
      });

      const added = nina.getByRole("region", {
        name: `Proposal: Add ${newName} to ${project.name}'s Pipelines`,
      });
      await expect(added).toContainText("Inserts Your review before Publish");
      await expect(added).toContainText(
        `${project.name} getsImplement → Tests → Your review → Publish`,
      );
      await added.getByRole("button", { name: "Apply change" }).click();
      await expect(added).toContainText("Applied");
      const projectPipelines = projectPipelineListSchema.parse(
        await (await page.request.get(`/api/project-pipelines?projectId=${project.id}`)).json(),
      );
      expect(projectPipelines.map(({ name }) => name).toSorted()).toEqual(
        [withLint.name, newName].toSorted(),
      );
      expect(
        projectSchema.parse(await (await page.request.get(`/api/projects/${project.id}`)).json())
          .defaultPipeline,
      ).toBe("full");

      const changes = nina.getByRole("region", {
        name: `Proposal: Change ${project.name}'s ${withLint.name}`,
      });
      const change = changes.filter({ hasText: "Lint before publishing." });
      await expect(change.getByRole("listitem").first()).toHaveText(
        "DescriptionThen lint.Lint before publishing.",
      );
      await change.getByRole("button", { name: "Apply change" }).click();
      await expect(change).toContainText("Applied");
      const saved = projectPipelineSchema.parse(
        await (await page.request.get(`/api/project-pipelines/${withLint.id}`)).json(),
      );
      expect(saved).toEqual({ ...withLint, description: "Lint before publishing." });

      const stale = changes.filter({ hasText: "Stale words." });
      await stale.getByRole("button", { name: "Apply change" }).click();
      await expect(stale).toContainText("The change can't be applied yet");
      await expect(stale).toContainText(`${withLint.name} changed since this was proposed.`);
      await expect(stale.getByRole("button", { name: "Apply change" })).toBeVisible();
    } finally {
      await repository.remove();
    }
  },
);

test(
  "the user asks Nina to onboard a Project, applies her Proposal and finds its Onboard Task Ready",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const name = `Onboarded ${Date.now()}`;
      const nina = chatWith(page, "Nina");

      await page.goto("/projects");
      await page.getByRole("button", { name: "Ask Nina to onboard one" }).click();
      await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
        "Can you onboard a new Project? The repository is ",
      );
      const threadId = await chatThreadShown(page);
      await seedProposal(
        threadId,
        {
          kind: "project",
          project: {
            name,
            path: repository.path,
            baseBranch: "main",
            mark: { label: "ON", colour: "teal" },
            ...PASSING_COMMANDS,
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
  },
);

test(
  "Nina's Proposal to onboard a repository by its Repository URL shows the URL and where it is cloned into",
  { tag: "@full" },
  async ({ page }) => {
    const name = `Onboarded by URL ${Date.now()}`;
    const repositoryUrl = "https://git.example.test/acme/onboarded-by-url.git";
    const cloneFolder = path.join("repositories", "git.example.test", "acme", "onboarded-by-url");
    const nina = chatWith(page, "Nina");

    await page.goto("/projects");
    await page.getByRole("button", { name: "Ask Nina to onboard one" }).click();
    await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
      "Can you onboard a new Project? The repository is ",
    );
    const threadId = await chatThreadShown(page);
    await seedProposal(
      threadId,
      {
        kind: "project",
        project: {
          name,
          path: cloneFolder,
          repositoryUrl,
          baseBranch: "main",
          mark: { label: "OU", colour: "teal" },
          ...PASSING_COMMANDS,
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
    const field = (label: string) => card.locator(".proposal-field", { hasText: label });
    await expect(field("Repository URL")).toContainText(repositoryUrl);
    await expect(field("Cloned into")).toContainText(cloneFolder);
    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toContainText("Not applied");
  },
);

test(
  "the user asks Nina to install a skill from a source, applies her Proposal and reviews the skill, off until then",
  { tag: "@full" },
  async ({ page }) => {
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
      await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
        `Can you install the skills from ${source.url}?`,
      );
      const threadId = await chatThreadShown(page);
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
      await expect(
        page.getByText(`${name} installed. It is off until you review it.`),
      ).toBeVisible();

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
  },
);

test(
  "the user sees a skill's update, asks Nina, reads her Proposal's diff and applies it; the skill stays on",
  { tag: "@full" },
  async ({ page }) => {
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
      const turnedOn = await page.request.put(`/api/skills/${name}/state`, {
        data: { state: "on" },
      });
      expect(turnedOn.ok()).toBe(true);
      const release = await source.release("v1.1.0", {
        "SKILL.md": `---\ndescription: ${description}\n---\nGroup them as Added, Changed, Fixed and Removed.\n`,
      });

      await page.goto("/settings/skills");
      const skillRow = page.getByRole("row").filter({ hasText: name });
      // The end-to-end service's daily check runs every two seconds.
      await expect(skillRow).toContainText("→ v1.1.0");
      await expect(page.getByText(/pinned skills? ha(s|ve) an update available/)).toBeVisible();
      await skillRow.getByRole("button", { name: "Review the update" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Version v1.0.0");
      await dialog.getByRole("button", { name: "Ask Nina to propose it" }).click();
      await expect(nina.getByRole("textbox", { name: "Message" })).toHaveValue(
        `Can you propose the update of ${name} to v1.1.0?`,
      );
      const threadId = await chatThreadShown(page);
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
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-skill-update-proposal.png"),
      });

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

      // The applied card keeps its diff once the Source is gone.
      await source.remove();
      await page.goto(`/settings/skills?chat=devops&thread=${threadId}`);
      await expect(card).toContainText("Applied");
      await expect(card.getByLabel("Changes from v1.0.0 to v1.1.0")).toContainText(
        "+Group them as Added, Changed, Fixed and Removed.",
      );
    } finally {
      await source.remove();
    }
  },
);

/**
 * A Link card Marta posted in her chat, as the Conversations service leaves one: only an Agent's
 * session posts one. `to` is the person's Role key.
 */
test(
  "the user applies a skill Jan drafted in his chat, and reviews it, off until then",
  { tag: "@full" },
  async ({ page }) => {
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
  },
);

async function seedLinkCard(threadId: string, to: string, note: string): Promise<void> {
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [crypto.randomUUID(), threadId, { kind: "link-card", roleKey: "office-manager", to, note }],
  );
}

test(
  "the user opens a Thread from Marta's Link card, edits the Handover note and sends it; a person let go shows as such",
  { tag: "@full" },
  async ({ page }) => {
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
    const message = chat.getByRole("textbox", { name: "Message" });
    await expect(message).toHaveValue(note);
    await page.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-handover-note-prefilled.png"),
    });
    await message.fill(`${note} Marta thinks the CSV part can ship first.`);

    // Edited, the note is a draft like any other: leaving the Thread keeps the edit, and its origin.
    await chat.getByRole("button", { name: "Threads" }).click();
    await chat.locator('[aria-current="true"]').click();
    await expect(message).toHaveValue(`${note} Marta thinks the CSV part can ship first.`);
    await expect(prefilled).toBeVisible();
    await message.press("Enter");

    await expect(chat.getByText("Marta thinks the CSV part can ship first.")).toBeVisible();
    await expect(chat.getByText("You · Handover note from Marta · Office Manager")).toBeVisible();
    await expect(chat.getByText("Two Tasks, then: the CSV export first.")).toBeVisible();
    await expect(prefilled).toHaveCount(0);
  },
);

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

test(
  "Marta's chat shows the Ideas she captured, planned from their cards, and the Office status",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Usage reports", "UR");
      const started = await page.request.post("/api/chats/office-manager/threads");
      const { id: threadId } = threadSchema.parse(await started.json());
      const officeWide = ideaSchema.parse(
        await (
          await page.request.post("/api/ideas", {
            data: {
              title: "A weekly usage summary on Monday mornings",
              notes: "",
              projectId: null,
            },
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
      const choosing = page
        .getByRole("dialog")
        .filter({ hasText: "Which Project is the Task in?" });
      await expect(choosing).toContainText("Usage reports");
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-idea-card-project.png") });
      await choosing.getByRole("button", { name: "Close", exact: true }).click();
      await expect(choosing).toHaveCount(0);
      await newIdea.getByRole("link", { name: "Open in Ideas" }).click();
      await expect(page).toHaveURL(new RegExp(`/work/ideas\\?idea=${officeWide.id}`));
    } finally {
      await repository.remove();
    }
  },
);

const SHAPED_OUTCOME = "Customers download their monthly usage as a CSV file from the web app.";
const PROPOSED_OUTCOME =
  "Customers download their monthly usage as a CSV file from the web app and the API.";

/**
 * A Proposal of `edit` the CTO drafted in the Initiative's shaping Thread, as the Conversations
 * service leaves one (see `seedProposal`).
 */
async function seedInitiativeProposal(
  initiativeId: string,
  edit: Record<string, unknown>,
): Promise<void> {
  const shapingThread = `from threads where home_kind = 'initiative' and home_id = $1`;
  const proposalId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into proposals (id, thread_id, drafted_by, drafted_at, change, status)
     select $2::uuid, id, 'cto', now(), $3::jsonb, 'open' ${shapingThread}`,
    [initiativeId, proposalId, { kind: "initiative", initiativeId, edit }],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at)
     select $2::uuid, id, $3::jsonb, now() ${shapingThread}`,
    [initiativeId, crypto.randomUUID(), { kind: "proposal", roleKey: "cto", proposalId }],
  );
}

/** An older Thread on the Initiative, so that the To line doesn't start on it; gives its id. */
async function seedOlderInitiativeThread(initiativeId: string, title: string): Promise<string> {
  const threadId = crypto.randomUUID();
  await queryOfficeDatabase(
    `insert into threads (id, home_kind, home_id, role_key, title, state, tokens, started_at)
     values ($1, 'initiative', $2, 'cto', $3, 'waiting', $4, now() - interval '1 day')`,
    [threadId, initiativeId, title, { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
  );
  return threadId;
}

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
  await expect(page.getByText(`${title} is in Shaping.`)).toBeVisible();
}

// The engine replays the last sessions in e2e/sessions.jsonl: Bob writes the outcome while the
// Initiative is shaped, then proposes a new one once it is active, and answers in a chosen Thread
// of Bob's tab.
test(
  "the user shapes an Idea into an Initiative with Bob, adds its Tasks, confirms it, applies Bob's Proposal, folds a block, writes in a chosen Thread and drops it",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    const dashboardRepository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Metering", "MT");
      await addedProject(page, dashboardRepository, "Dashboard", "DB");
      const outside = await page.request.post("/api/tasks", {
        data: { title: "Usage table schema", projectId: project.id, priority: "normal" },
      });
      expect(outside.status()).toBe(201);
      const outsideTask = taskSchema.parse(await outside.json());
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
      const origin = record.getByRole("region", { name: "Origin" });
      await origin.getByRole("button", { name: /^Origin/ }).click();
      await expect(origin.getByRole("link", { name: "Usage exports for customers" })).toBeVisible();

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
      await addTaskToInitiative(page, "Usage export button", "Dashboard", [
        "Usage export endpoint",
      ]);

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
      // A Task in Shaping waits for the Initiative, with nothing of planning to offer.
      const needsYou = page.getByRole("region", { name: "Needs you" });
      await expect(needsYou).toContainText("Waiting for its Initiative to be confirmed");
      await expect(
        needsYou.getByRole("link", { name: "Usage exports for customers" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Plan with Jan" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Make a plan" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Edit for this Task" })).toHaveCount(0);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-task-in-shaping.png") });

      await page.goto(initiativeUrl);
      await expect(graph.getByRole("link")).toHaveCount(3);
      await expect(graph.getByRole("link", { name: /Usage table schema/ })).toContainText(
        "outside this Initiative",
      );
      await expect(page.getByText("2 across 2 Projects")).toBeVisible();

      // Its Tasks have no card on the board until Confirm, which brings them there live.
      const board = await page.context().newPage();
      await board.goto("/work");
      const backlog = board.getByRole("region", { name: "Backlog" });
      await expect(backlog.getByText("Usage table schema")).toBeVisible();
      await expect(board.getByText("Usage export endpoint")).toHaveCount(0);
      await board.screenshot({ path: path.join(SCREENSHOTS, "light-board-before-confirm.png") });

      // Nor does the note of other Projects count them, even when a search finds only one.
      const otherProjects = board.getByRole("button", {
        name: /in other Projects.*Show all projects/,
      });
      const boardSearch = board.getByLabel("Search Tasks");
      await board.getByRole("button", { name: /^Project filter:/ }).click();
      await board.getByRole("button", { name: "Show only Metering" }).click();
      await expect(otherProjects).toBeVisible();
      await boardSearch.fill("Usage export button");
      await expect(otherProjects).toHaveCount(0);
      await boardSearch.fill("");
      await otherProjects.click();

      await page.screenshot({ path: path.join(SCREENSHOTS, "light-initiative-shaping.png") });
      await page.getByRole("button", { name: "Confirm the Initiative" }).click();
      await expect(
        page.getByText(
          "Initiative confirmed. Its Tasks moved to Backlog, to wait until Jan plans them.",
        ),
      ).toBeVisible();
      await expect(backlog.getByRole("article", { name: "Usage export endpoint" })).toBeVisible();
      await expect(backlog.getByRole("article", { name: "Usage export button" })).toBeVisible();
      await board.screenshot({ path: path.join(SCREENSHOTS, "light-board-after-confirm.png") });
      await board.close();
      await expect(page.getByRole("button", { name: "Confirm the Initiative" })).toHaveCount(0);
      await expect(outcome.getByRole("button", { name: "Edit" })).toHaveCount(0);

      // Once it is active, Bob's change is a Proposal the user applies.
      const message = conversation.getByRole("textbox", { name: "Message" });
      await message.fill("The API should export it too");
      await message.press("Enter");
      const proposal = conversation.getByRole("region", {
        name: "Proposal: New outcome for the Initiative",
      });
      await expect(proposal).toContainText(PROPOSED_OUTCOME);
      await proposal.getByRole("button", { name: "Apply change" }).click();
      await expect(proposal).toContainText("Applied");
      await expect(outcome).toContainText(PROPOSED_OUTCOME);

      // Bob's new Task names the Task it waits for in the same Proposal.
      const initiativeId = new URL(initiativeUrl).pathname.split("/").at(-1) ?? "";
      await seedInitiativeProposal(initiativeId, {
        kind: "add-task",
        title: "Usage export in the API",
        projectId: project.id,
        priority: "normal",
        blockedBy: [outsideTask.id],
      });
      await page.reload();
      const newTask = conversation.getByRole("region", {
        name: "Proposal: New Task in the Initiative",
      });
      await expect(newTask).toContainText("Usage export in the API");
      await expect(newTask.getByText("Must be Done first")).toBeVisible();
      await expect(newTask.getByText("Usage table schema")).toBeVisible();
      await newTask.getByRole("button", { name: "Apply change" }).click();
      await expect(newTask).toContainText("Applied");
      await expect(graph.getByRole("link")).toHaveCount(4);

      // Bob retitles the Task and writes its Description, each by a Proposal of its own.
      const added = taskSchema
        .array()
        .parse(await (await page.request.get("/api/tasks")).json())
        .find(({ title }) => title === "Usage export in the API");
      if (!added) throw new Error("The Proposal's Task isn't on the board.");
      await seedInitiativeProposal(initiativeId, {
        kind: "task-title",
        taskId: added.id,
        title: "Usage export for the API",
      });
      await seedInitiativeProposal(initiativeId, {
        kind: "task-description",
        taskId: added.id,
        description: "One row per Project and day.",
      });
      await page.reload();
      const newTitle = conversation.getByRole("region", { name: "Proposal: New title for a Task" });
      await expect(newTitle).toContainText("Usage export in the API");
      await expect(newTitle).toContainText("Usage export for the API");
      await newTitle.screenshot({ path: path.join(SCREENSHOTS, "proposal-task-title.png") });
      await newTitle.getByRole("button", { name: "Apply change" }).click();
      await expect(newTitle).toContainText("Applied");
      const newDescription = conversation.getByRole("region", {
        name: "Proposal: New Description for a Task",
      });
      await expect(newDescription).toContainText("One row per Project and day.");
      await newDescription.screenshot({
        path: path.join(SCREENSHOTS, "proposal-task-description.png"),
      });
      await newDescription.getByRole("button", { name: "Apply change" }).click();
      await expect(newDescription).toContainText("Applied");
      await graph.getByRole("link", { name: /Usage export for the API/ }).click();
      await expect(dependencies).toContainText("Usage table schema");
      await expect(page.getByRole("region", { name: "Description" })).toContainText(
        "One row per Project and day.",
      );
      await page.goto(initiativeUrl);
      await expect(
        conversation.getByText(
          "The Initiative is active, so I proposed the new outcome for you to apply.",
        ),
      ).toBeVisible();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-initiative.png") });

      await page.goto("/work/initiatives");
      await expect(
        page.getByRole("article", { name: "Usage exports for customers" }),
      ).toContainText("0 of 3 Tasks done");

      // A block stays folded across a reload, down to its one line.
      await page.goto(initiativeUrl);
      const attachments = record.getByRole("region", { name: "Attachments" });
      await attachments.getByRole("button", { name: /^Attachments/ }).click();
      await page.reload();
      await expect(attachments.getByRole("button", { name: /^Attachments/ })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await expect(attachments.getByText("1 Attachment")).toBeVisible();
      await expect(attachments.getByText("Usage export sketch")).toBeHidden();

      // The page has no rail, no record tabs and no Needs you card. Its conversation is a tab per
      // person, Bob's first and open on his Shaping Thread, under one Details switch.
      await expect(page.getByRole("region", { name: /^Pipeline · / })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Overview" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Needs you" })).toHaveCount(0);
      await expect(detailsSwitch(conversation)).toHaveCount(1);
      const tabs = conversation.locator(".conversation-tabs").getByRole("tab");
      await expect(tabs).toHaveText([/Bob/, /Jan/]);
      await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
      await expect(conversation.getByRole("heading", { name: "Bob · CTO" })).toBeVisible();
      await expect(
        conversation.getByText("Shapes the outcome and the Tasks with you"),
      ).toBeVisible();

      // Jan has no Thread here yet: planning starts from the head, and the address names Jan's tab.
      await tabs.filter({ hasText: "Jan" }).click();
      await expect(page).toHaveURL(/initiativeThread=planner$/);
      await expect(conversation.getByRole("heading", { name: "Jan · Planner" })).toBeVisible();
      await expect(
        conversation.getByText(
          "No planning on Usage exports for customers yet. Once it is active with a Task in Backlog, Plan the Initiative has Jan start at once, or Plan with Jan lets you say first how to plan it.",
        ),
      ).toBeVisible();
      await expect(message).toHaveCount(0);
      await tabs.filter({ hasText: "Bob" }).click();
      await expect(page).toHaveURL(/initiativeThread=cto$/);

      // With a second Thread of Bob's, Bob's tab folds the older one; the To line starts on the
      // newest, and the user chooses the older one, which unfolds and goes in the address. Bob
      // answers there.
      const pricingThreadId = await seedOlderInitiativeThread(initiativeId, "Pricing");
      await page.reload();
      const toLine = conversation.getByLabel("To", { exact: true });
      await expect(toLine.locator("option:checked")).toHaveText(/^Shaping/);
      const pricing = conversation.getByRole("region", { name: "Pricing · Bob" });
      const pricingFold = pricing.getByRole("button", { name: /^Pricing · Bob/ });
      await expect(pricingFold).toHaveAttribute("aria-expanded", "false");
      await toLine.selectOption({ label: "Pricing · Bob" });
      await expect(pricingFold).toHaveAttribute("aria-expanded", "true");
      await expect(page).toHaveURL(new RegExp(`initiativeThread=${pricingThreadId}$`));
      await message.fill("Should exports cost extra?");
      await message.press("Enter");
      await expect(pricing.getByText("Should exports cost extra?")).toBeVisible();
      await expect(pricing.getByText("No: exports come with every plan.")).toBeVisible();

      // A link naming a Thread opens the page on it.
      await page.goto(`${initiativeUrl}?initiativeThread=${pricingThreadId}`);
      await expect(pricingFold).toHaveAttribute("aria-expanded", "true");
      await expect(toLine.locator("option:checked")).toHaveText(/^Pricing/);

      // In a narrow window the conversation is a drawer here too: a link naming a Thread opens it,
      // and it keeps a draft.
      await page.setViewportSize({ width: DRAWER_WIDTH_PX, height: 800 });
      await page.reload();
      await expect(conversation).toBeVisible();
      await expect(toLine.locator("option:checked")).toHaveText(/^Pricing/);
      await message.fill("A thought for later");
      await motionSettled(page);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-900-initiative-drawer.png") });
      await page.mouse.click(100, 400);
      await expect(conversation).toBeHidden();
      expect(await windowOverflow(page)).toBe(0);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-900-initiative.png") });
      await conversationHandle(page).click();
      await expect(message).toHaveValue("A thought for later");
      await page.getByRole("button", { name: "Close the conversation" }).click();
      await expect(conversation).toBeHidden();
      await page.setViewportSize({ width: 1600, height: 900 });
      await expect(conversation).toBeVisible();
      await message.fill("");

      await page.getByRole("button", { name: "More for Usage exports for customers" }).click();
      await page.getByRole("menu").getByRole("button", { name: "Drop the Initiative" }).click();
      const dropDialog = page.getByRole("dialog", { name: "Drop Usage exports for customers?" });
      await expect(dropDialog).toContainText(
        "It drops its 3 Tasks not yet Done or Dropped, none of them started.",
      );
      await dropDialog.getByRole("button", { name: "Drop the Initiative" }).click();
      await expect(page.getByText("Initiative dropped, with its 3 open Tasks.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add a Task" })).toHaveCount(0);
      await expect(
        page.getByText(
          "This Initiative was dropped, so you can read this conversation but not continue it.",
        ),
      ).toBeVisible();
      await expect(message).toHaveCount(0);
      await tabs.filter({ hasText: "Jan" }).click();
      await expect(
        conversation.getByText("No conversation with Jan on Usage exports for customers."),
      ).toBeVisible();
    } finally {
      await Promise.all([repository.remove(), dashboardRepository.remove()]);
    }
  },
);

function chatButton(page: Page): Locator {
  return page.getByRole("button", { name: /^Chat: / });
}

/** The chat drawer as it opens, on nobody yet. */
function personPicker(page: Page): Locator {
  return page.getByRole("complementary", { name: "Chat", exact: true });
}

/** Everything said so far has been read, so what a test looks at is all that shows. */
async function seeEveryChat(): Promise<void> {
  await queryOfficeDatabase(
    `insert into thread_seen (thread_id, message_id, seen_at)
     select distinct on (m.thread_id) m.thread_id, m.id, now()
     from thread_messages m join threads t on t.id = m.thread_id
     where t.home_kind = 'chat'
     order by m.thread_id, m.position desc
     on conflict (thread_id) do update set message_id = excluded.message_id`,
    [],
  );
}

async function plannersNewestThread(page: Page): Promise<{ id: string; title: string }> {
  const response = await page.request.get("/api/chats/planner/threads");
  const [thread] = chatThreadPageSchema.parse(await response.json()).rows;
  if (!thread?.title) throw new Error("Jan has no Thread with a title.");
  return { id: thread.id, title: thread.title };
}

/** The Role card's Chat switch, as Save on the person's page sets it. */
async function setChatOf(page: Page, roleKey: string, chat: boolean): Promise<void> {
  const { card } = roleSchema.parse(await (await page.request.get(`/api/roles/${roleKey}`)).json());
  const changed = { ...card, capabilities: { ...card.capabilities, chat } };
  expect((await page.request.put(`/api/roles/${roleKey}/card`, { data: changed })).ok()).toBe(true);
}

/** What the browser reports as the user moves to another tab and back. */
async function setTabVisible(page: Page, visible: boolean): Promise<void> {
  await page.evaluate((isVisible) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (isVisible ? "visible" : "hidden"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
}

test.describe("the chat drawer", { tag: "@full" }, () => {
  test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });
  // The Chat button leads to an answer waiting, and earlier tests leave some.
  test.beforeEach(seeEveryChat);

  test("opens from the top bar on the people with chat on, and switches person in place", async ({
    page,
  }) => {
    await setChatOf(page, "developer", false);
    await page.goto("/work");
    await chatButton(page).click();

    const picker = personPicker(page);
    for (const name of ["Jan", "Marta", "Bob"]) {
      await expect(picker.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await expect(picker.getByRole("button", { name: /^Ada/ })).toHaveCount(0);
    await expect(picker.getByText("People with chat off aren't listed.")).toBeVisible();

    await picker.getByRole("button", { name: /^Jan/ }).click();
    const jan = chatWith(page, "Jan");
    await expect(jan.getByRole("textbox", { name: "Message" })).toBeVisible();

    await jan.getByRole("button", { name: /^Jan/ }).click();
    const menu = page.getByRole("menu", { name: "Chat with" });
    await expect(menu.getByRole("menuitemradio", { name: /^Ada/ })).toHaveCount(0);
    await expect(menu.getByRole("menuitemradio", { name: /^Jan/ })).toBeChecked();
    await menu.getByRole("menuitemradio", { name: /^Marta/ }).click();

    await expect(chatWith(page, "Marta")).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(/\/work$/);
    await setChatOf(page, "developer", true);
  });

  test("keeps a tab for each person opened, to switch back to, close and open again", async ({
    page,
  }) => {
    await page.goto("/work");
    await chatButton(page).click();
    await personPicker(page).getByRole("button", { name: /^Jan/ }).click();
    const jan = chatWith(page, "Jan");
    const tabs = page.getByRole("tablist", { name: "People open in the chat" });
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect(tabs.getByRole("tab", { name: /^Jan/ })).toHaveAttribute("aria-selected", "true");
    // Earlier tests left Jan Threads: the user steps back to their list.
    await jan.getByRole("button", { name: "Threads", exact: true }).click();
    await expect(jan.getByRole("button", { name: "New thread", exact: true })).toBeVisible();

    const menu = page.getByRole("menu", { name: "Chat with" });
    await jan.getByRole("button", { name: /^Jan/ }).click();
    await menu.getByRole("menuitemradio", { name: /^Marta/ }).click();
    const marta = chatWith(page, "Marta");
    await expect(marta).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await expect(tabs.getByRole("tab", { name: /^Marta/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await tabs.getByRole("tab", { name: /^Jan/ }).click();
    await expect(jan.getByRole("button", { name: "New thread", exact: true })).toBeVisible();
    await expect(menu).toHaveCount(0);
    await jan.getByRole("button", { name: /^Jan/ }).click();
    await menu.getByRole("menuitemradio", { name: /^Jan/ }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(2);

    await tabs.getByRole("button", { name: /^Close the chat with Marta/ }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect(jan.getByRole("button", { name: "New thread", exact: true })).toBeVisible();

    await jan.getByRole("button", { name: /^Jan/ }).click();
    await menu.getByRole("menuitemradio", { name: /^Marta/ }).click();
    await expect(marta).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await page.reload();
    await expect(marta).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await motionSettled(page);
    await page.screenshot({ path: path.join(SCREENSHOTS, "chat-tabs.png") });

    await tabs.getByRole("button", { name: /^Close the chat with Marta/ }).click();
    await expect(jan).toBeVisible();
    await expect(tabs.getByRole("tab", { name: /^Jan/ })).toBeFocused();
    await tabs.getByRole("button", { name: /^Close the chat with Jan/ }).click();
    await expect(personPicker(page)).toBeVisible();
    await expect(tabs).toHaveCount(0);
  });

  test("stays on its Thread through links, the rail, Back, Forward and a reload", async ({
    page,
  }) => {
    const { id, title } = await plannersNewestThread(page);
    await page.goto(`/now?chat=planner&thread=${id}`);
    const jan = chatWith(page, "Jan");
    const heading = jan.getByRole("heading", { name: title });
    await expect(heading).toBeVisible();
    await expect(page).toHaveURL(/\/now$/);

    await page.getByRole("link", { name: "Work" }).first().click();
    await expect(page).toHaveURL(/\/work$/);
    await expect(heading).toBeVisible();
    await page.getByRole("link", { name: "People" }).first().click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(heading).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/work$/);
    await expect(heading).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/people$/);
    await expect(heading).toBeVisible();

    await page.reload();
    await expect(heading).toBeVisible();

    await jan.getByRole("button", { name: "Close (Esc)" }).click();
    await expect(jan).toHaveCount(0);
    await expect(page).toHaveURL(/\/people$/);
    await expect(chatButton(page)).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(/\/work$/);
    await expect(jan).toHaveCount(0);
  });

  test("keeps a draft across pages, Threads and closing, per Thread", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Open the chat with Jan" }).click();
    const jan = chatWith(page, "Jan");
    const message = jan.getByRole("textbox", { name: "Message" });
    await message.fill("A thought I haven't finished");

    await page.getByRole("link", { name: "Work" }).first().click();
    await expect(message).toHaveValue("A thought I haven't finished");

    await jan.getByRole("button", { name: "Threads", exact: true }).click();
    await jan.getByRole("button", { name: /^Deploys/ }).click();
    await expect(message).toHaveValue("");
    await jan.getByRole("button", { name: "Threads", exact: true }).click();
    await jan.locator(".chat-thread").first().click();
    await expect(message).toHaveValue("A thought I haven't finished");

    await page.keyboard.press("Escape");
    await expect(jan).toHaveCount(0);
    await chatButton(page).click();
    await expect(message).toHaveValue("A thought I haven't finished");
    await message.fill("");
  });

  test("Esc closes one thing a press: a menu, then a window, then the side panels", async ({
    page,
  }) => {
    await page.goto("/work");
    await chatButton(page).click();
    await personPicker(page).getByRole("button", { name: /^Jan/ }).click();
    const jan = chatWith(page, "Jan");
    const message = jan.getByRole("textbox", { name: "Message" });
    await message.fill("Kept through every press");

    await jan.getByRole("button", { name: /^Jan/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Chat with" })).toHaveCount(0);
    await expect(jan).toBeVisible();

    await createFromTopBar(page, "Idea");
    const idea = page.getByRole("dialog", { name: "Capture an Idea" });
    await expect(idea).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(idea).toHaveCount(0);
    await expect(jan).toBeVisible();

    await page.getByRole("button", { name: /needs? you/ }).click();
    const needsYou = page.getByRole("heading", { name: "Needs you" });
    await expect(needsYou).toBeVisible();
    await expect(jan).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(needsYou).toHaveCount(0);
    await expect(jan).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(jan).toHaveCount(0);

    await chatButton(page).click();
    await expect(message).toHaveValue("Kept through every press");
    await message.fill("");
  });

  test("a Mention of a waiting Decision opens its window over the drawer, closing alone", async ({
    page,
  }) => {
    const { id: threadId } = await plannersNewestThread(page);
    const decisions = await page.request.get("/api/decisions/open");
    const [decision] = decisionListSchema.parse(await decisions.json());
    if (!decision) throw new Error("No Decision is waiting.");
    const { home } = threadSchema.parse(
      await (await page.request.get(`/api/threads/${decision.threadId}`)).json(),
    );
    if (home.kind !== "task") throw new Error("A Decision waits on a Task.");
    const link = `/tasks/${home.taskId}?taskThread=${decision.threadId}&decision=${decision.id}`;
    await queryOfficeDatabase(
      `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
      [
        crypto.randomUUID(),
        threadId,
        { kind: "person", roleKey: "planner", text: `Have a look at [it](${link}).` },
      ],
    );
    await page.goto(`/work?chat=planner&thread=${threadId}`);
    const jan = chatWith(page, "Jan");
    const message = jan.getByRole("textbox", { name: "Message" });
    await message.fill("Kept behind the window");

    await jan.getByRole("link", { name: /^Decision on/ }).click();

    const decisionWindow = page.getByRole("dialog");
    await expect(decisionWindow.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/work$/);
    await page.keyboard.press("Escape");
    await expect(decisionWindow).toHaveCount(0);
    await expect(message).toHaveValue("Kept behind the window");
    await message.fill("");
  });

  test("shows someone answering, then answered, and clears once the Thread is on screen", async ({
    page,
  }) => {
    const { id } = await plannersNewestThread(page);
    await page.goto("/now");
    await expect(chatButton(page)).toHaveAccessibleName("Chat: nothing new");
    await page.screenshot({ path: path.join(SCREENSHOTS, "chat-button-nothing-new.png") });

    await queryOfficeDatabase(`update threads set state = 'answering' where id = $1`, [id]);
    await page.reload();
    await expect(chatButton(page)).toHaveAccessibleName("Chat: Jan is answering");
    await page.screenshot({ path: path.join(SCREENSHOTS, "chat-button-answering.png") });

    await queryOfficeDatabase(
      `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
      [crypto.randomUUID(), id, { kind: "person", roleKey: "planner", text: "It is done." }],
    );
    await queryOfficeDatabase(`update threads set state = 'waiting' where id = $1`, [id]);
    await page.reload();
    await expect(chatButton(page)).toHaveAccessibleName("Chat: Jan answered");
    await page.screenshot({ path: path.join(SCREENSHOTS, "chat-button-answered.png") });

    await chatButton(page).click();
    await expect(chatWith(page, "Jan").getByText("It is done.")).toBeVisible();
    await expect(chatButton(page)).toHaveAccessibleName("Chat: nothing new");
    await page.reload();
    await expect(chatButton(page)).toHaveAccessibleName("Chat: nothing new");
  });

  test("an answer landing in a hidden tab waits there, in other tabs and in another browser", async ({
    page,
    browser,
  }) => {
    await page.goto("/now");
    await chatButton(page).click();
    await personPicker(page).getByRole("button", { name: /^Jan/ }).click();
    const jan = chatWith(page, "Jan");
    await startNewThread(jan);
    await expect(jan.getByRole("heading", { name: "New thread" })).toBeVisible();

    const otherTab = await page.context().newPage();
    await otherTab.goto("/work");
    await expect(chatButton(otherTab)).toHaveAccessibleName("Chat: nothing new");
    const elsewhere = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: E2E_STORAGE_STATE,
    });
    const otherBrowser = await elsewhere.newPage();
    await otherBrowser.goto("/now");
    await chatButton(otherBrowser).click();
    const janInPicker = personPicker(otherBrowser).getByRole("button", { name: /^Jan/ });
    await expect(janInPicker).toBeVisible();

    await setTabVisible(page, false);
    const message = jan.getByRole("textbox", { name: "Message" });
    await message.fill("Tell me when it is done");
    await message.press("Enter");
    await expect(jan.getByText("This answer waits until you come back.")).toBeVisible();
    await expect(message).toHaveValue("");

    await expect(chatButton(page)).toHaveAccessibleName("Chat: Jan answered");
    await expect(chatButton(otherTab)).toHaveAccessibleName("Chat: Jan answered");
    await expect(janInPicker).toContainText("Answered");
    await otherTab.reload();
    await expect(chatButton(otherTab)).toHaveAccessibleName("Chat: Jan answered");
    await otherBrowser.reload();
    await expect(janInPicker).toContainText("Answered");

    await setTabVisible(page, true);
    await expect(chatButton(page)).toHaveAccessibleName("Chat: nothing new");
    await expect(chatButton(otherTab)).toHaveAccessibleName("Chat: nothing new");
    await expect(janInPicker).not.toContainText("Answered");
    await elsewhere.close();
    await otherTab.close();
  });

  test("pushes the page aside and resizes, remembering its width", async ({ page }) => {
    await page.goto("/now");
    const pageWidth = (): Promise<number> =>
      page.locator(".shell-main").evaluate((main) => main.clientWidth);
    const before = await pageWidth();
    await chatButton(page).click();
    const drawer = personPicker(page);
    await expect(drawer).toBeVisible();
    await expect.poll(pageWidth).toBe(before - 420);
    await expect(page.locator(".conversation-scrim, .chat-overlay")).toHaveCount(0);

    const edge = page.getByRole("separator", { name: "Resize the chat" });
    const box = await edge.boundingBox();
    if (!box) throw new Error("The edge isn't on the page.");
    await page.mouse.move(box.x + 5, 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 5 - 100, 300);
    await page.mouse.up();
    await expect(edge).toHaveAttribute("aria-valuenow", "520");

    await edge.focus();
    await page.keyboard.press("ArrowRight");
    await expect(edge).toHaveAttribute("aria-valuenow", "504");
    await page.keyboard.press("End");
    await expect(edge).toHaveAttribute("aria-valuenow", "720");
    await page.keyboard.press("Home");
    await expect(edge).toHaveAttribute("aria-valuenow", "360");
    await edge.dblclick();
    await expect(edge).toHaveAttribute("aria-valuenow", "420");
    await page.keyboard.press("ArrowLeft");
    await expect(edge).toHaveAttribute("aria-valuenow", "436");

    await page.reload();
    await expect(edge).toHaveAttribute("aria-valuenow", "436");
    expect(await windowOverflow(page)).toBe(0);
  });

  test("lies over the page in a narrow window and fills a phone's, with nothing sideways", async ({
    page,
  }) => {
    await page.goto("/now");
    await chatButton(page).click();
    await personPicker(page).getByRole("button", { name: /^Jan/ }).click();
    const jan = chatWith(page, "Jan");
    await expect(jan.getByRole("textbox", { name: "Message" })).toBeVisible();

    await page.setViewportSize({ width: 900, height: 800 });
    await expect
      .poll(() => jan.evaluate((chat) => getComputedStyle(chat).position))
      .toBe("absolute");
    expect(await page.locator(".shell-main").evaluate((main) => main.clientWidth)).toBe(844);
    // Right under the status strip, which takes a second row on a strip under 600px wide.
    const strip = page.getByRole("status", { name: "Status strip" });
    const underTheStrip = async (): Promise<boolean> => {
      const [chatBox, stripBox] = [await jan.boundingBox(), await strip.boundingBox()];
      return chatBox !== null && stripBox !== null && chatBox.y === stripBox.y + stripBox.height;
    };
    expect(await underTheStrip()).toBe(true);
    await page.setViewportSize({ width: 640, height: 800 });
    await expect.poll(async () => (await strip.boundingBox())?.height).toBe(94);
    await expect.poll(underTheStrip).toBe(true);
    expect(await windowOverflow(page)).toBe(0);

    await page.setViewportSize({ width: 390, height: 800 });
    await expect.poll(() => jan.evaluate((chat) => chat.clientWidth)).toBe(390);
    await expect(page.getByRole("separator", { name: "Resize the chat" })).toHaveCount(0);
    expect(await windowOverflow(page)).toBe(0);
  });

  test("looks as the design says at each width, in both palettes", async ({ page }) => {
    const { id } = await plannersNewestThread(page);
    await page.goto("/now");
    await chatButton(page).click();
    const shot = async (view: string, palette: string, width: number): Promise<void> => {
      await motionSettled(page);
      expect(await windowOverflow(page)).toBe(0);
      await page.screenshot({
        path: path.join(SCREENSHOTS, `chat-${view}-${palette}-${width}.png`),
      });
    };
    for (const palette of ["light", "dark"] as const) {
      await showPalette(page, palette);
      for (const width of [1600, 900, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => sessionStorage.removeItem("the-office.chat"));
        await page.goto("/now");
        await chatButton(page).click();
        await expect(personPicker(page)).toBeVisible();
        await shot("picker", palette, width);

        await page.goto(`/now?chat=planner&thread=${id}`);
        const jan = chatWith(page, "Jan");
        await expect(jan.getByRole("textbox", { name: "Message" })).toBeVisible();
        await shot("thread", palette, width);

        await jan.getByRole("button", { name: "Threads", exact: true }).click();
        await expect(jan.getByRole("button", { name: "New thread", exact: true })).toBeVisible();
        await shot("list", palette, width);
      }
    }
    await showPalette(page, "light");
  });

  test("a Task page folds its conversation beside the drawer, its handle on the page's side", async ({
    page,
  }) => {
    const tasks = (await (await page.request.get("/api/tasks")).json()) as { id: string }[];
    const [task] = tasks;
    if (!task) throw new Error("No Task to look at.");
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(`/tasks/${task.id}`);
    await expect(conversationHandle(page)).toHaveCount(0);

    await chatButton(page).click();
    await personPicker(page).getByRole("button", { name: /^Jan/ }).click();
    await expect(conversationHandle(page)).toBeVisible();
    const handle = await conversationHandle(page).boundingBox();
    const chat = await chatWith(page, "Jan").boundingBox();
    expect((handle?.x ?? 0) + (handle?.width ?? 0)).toBeLessThanOrEqual(chat?.x ?? 0);
    expect(await windowOverflow(page)).toBe(0);

    await conversationHandle(page).click();
    await expect(page.locator(".conversation-drawer.open")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".conversation-drawer.open")).toHaveCount(0);
    await expect(chatWith(page, "Jan")).toBeVisible();
  });

  // The engine replays the last session in e2e/sessions.jsonl: Jan answers beside a Task's page.
  test("sends the Open page with a message, shows it on the message, and leaves it out while that page stays open", async ({
    page,
  }) => {
    const tasks = taskListSchema.parse(await (await page.request.get("/api/tasks")).json());
    const [task] = tasks;
    if (!task) throw new Error("No Task to look at.");
    await page.goto(`/tasks/${task.id}`);
    await chatButton(page).click();
    await personPicker(page).getByRole("button", { name: /^Jan/ }).click();
    const jan = chatWith(page, "Jan");
    const starting = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/chats/planner/threads"),
    );
    await startNewThread(jan);
    const { id: threadId } = threadSchema.parse(await (await starting).json());
    await expect.poll(() => chatThreadShown(page)).toBe(threadId);

    const openPage = jan.getByRole("note").filter({ hasText: "Open page:" });
    await expect(openPage.getByRole("link", { name: task.title })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-open-page.png") });
    const message = jan.getByRole("textbox", { name: "Message" });
    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith(`/threads/${threadId}/messages`),
    );
    await message.fill("What is left on it?");
    await message.press("Enter");
    expect((await sent).postDataJSON()).toEqual({
      text: "What is left on it?",
      openPage: { kind: "task", taskId: task.id },
    });
    await expect(jan.getByText("I read the Task open beside the chat.")).toBeVisible();
    const withTask = jan.locator(".message-open-page");
    await expect(withTask).toHaveText(`With ${task.title} open`);
    // The session started with the Task's record in its Brief.
    await detailsSwitch(jan).click();
    await jan.locator("summary", { hasText: "Brief" }).click();
    await expect(jan.getByText("The page the user has open")).toBeVisible();
    await expect(jan.getByText(`${task.title} (Task ${task.id})`).first()).toBeVisible();
    await detailsSwitch(jan).click();

    await openPage.getByRole("button", { name: "Leave out" }).click();
    await expect(openPage).toHaveCount(0);
    const leftOut = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith(`/threads/${threadId}/messages`),
    );
    await message.fill("And without it?");
    await message.press("Enter");
    expect((await leftOut).postDataJSON()).toEqual({ text: "And without it?" });
    await expect(jan.getByText("Nothing open came with that one.")).toBeVisible();
    await expect(withTask).toHaveCount(1);
    // Left out while the page stays open, though the drawer closes and opens again.
    await expect(openPage).toHaveCount(0);
    await chatButton(page).click();
    await chatButton(page).click();
    await expect(jan.getByText("Nothing open came with that one.")).toBeVisible();
    await expect(openPage).toHaveCount(0);
    await sendAndExpect(
      "Still without it?",
      { text: "Still without it?" },
      "Still nothing open with it.",
    );
    await expect(openPage).toHaveCount(0);

    // Another page brings the line back, and so does coming back to the Task.
    await page.getByRole("link", { name: "People" }).first().click();
    await expect(page).toHaveURL(/\/people$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
    await expect(openPage.getByRole("link", { name: task.title })).toBeVisible();
    await sendAndExpect(
      "And with it again?",
      { text: "And with it again?", openPage: { kind: "task", taskId: task.id } },
      "The Task is open beside the chat again.",
    );
    await expect(withTask).toHaveCount(2);

    await page.reload();
    await expect(chatWith(page, "Jan").locator(".message-open-page")).toHaveText([
      `With ${task.title} open`,
      `With ${task.title} open`,
    ]);
    await page.getByRole("link", { name: "People" }).first().click();
    await expect(page).toHaveURL(/\/people$/);
    await expect(openPage).toHaveCount(0);
    await page.goto("/people/developer");
    await expect(openPage.getByRole("link", { name: /Ada/ })).toBeVisible();

    async function sendAndExpect(text: string, body: object, answer: string): Promise<void> {
      const sending = page.waitForRequest(
        (request) =>
          request.method() === "POST" && request.url().endsWith(`/threads/${threadId}/messages`),
      );
      await message.fill(text);
      // A drawer opened again refetches its Thread; until then Enter only says Jan is answering.
      await expect(jan.getByRole("button", { name: "Send (Enter)" })).toBeEnabled();
      await message.press("Enter");
      expect((await sending).postDataJSON()).toEqual(body);
      await expect(jan.getByText(answer)).toBeVisible();
    }
  });
});

test(
  "Jan creates a Task with its Plan and Definition of Done, and the user confirms both and marks it Ready without Planning",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Known work", "KW");
      expect(project.id).toBe("known-work");
      const title = "Show the build number in the footer";
      const { id: threadId } = threadSchema.parse(
        await (await page.request.post("/api/chats/planner/threads")).json(),
      );
      const sent = await page.request.post(`/api/threads/${threadId}/messages`, {
        data: { text: "Make a Task for the build number in the footer; we know how." },
      });
      expect(sent.ok()).toBe(true);
      const createdTask = async () =>
        taskListSchema
          .parse(await (await page.request.get("/api/tasks")).json())
          .find((task) => task.projectId === project.id && task.title === title);
      await expect.poll(async () => (await createdTask())?.state).toBe("backlog");
      const task = await createdTask();
      if (!task) throw new Error("Jan created no Task.");

      // Both parts landed as Jan wrote them, Not confirmed, and no Pipeline is chosen yet: Mark
      // Ready waits for one.
      await page.goto(`/tasks/${task.id}`);
      const record = page.getByRole("region", { name: "Record" });
      const plan = record.getByRole("region", { name: "Plan", exact: true });
      const definitionOfDone = record.getByRole("region", { name: "Definition of Done" });
      const markReady = page.getByRole("button", { name: "Mark Ready" });
      await expect(plan).toContainText("Read the build number from the environment");
      await expect(plan).toContainText("src/footer.tsx");
      await expect(plan.getByText("Not confirmed", { exact: true })).toBeVisible();
      await expect(definitionOfDone).toContainText("The footer shows the build number.");
      await expect(definitionOfDone.getByText("Not confirmed", { exact: true })).toBeVisible();
      await expect(markReady).toHaveCount(0);
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-task-given-parts.png") });

      await plan.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(plan.getByText("Confirmed", { exact: true })).toBeVisible();
      await expect(markReady).toHaveCount(0);
      await definitionOfDone.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(definitionOfDone.getByText("Confirmed", { exact: true })).toBeVisible();
      // It still has no Pipeline: the user chooses one on the rail.
      await expect(markReady).toHaveCount(0);
      await page
        .getByRole("region", { name: "Pipeline · Not chosen yet" })
        .getByRole("button", { name: "Choose a Pipeline" })
        .click();
      const choosing = page.getByRole("dialog");
      await pickPipeline(choosing, "Pipeline", "Quick fix");
      await choosing.getByRole("button", { name: "Save for this Task" }).click();
      await expect(page.getByRole("region", { name: "Pipeline · Quick fix" })).toBeVisible();
      await expect(markReady).toBeEnabled();
      await markReady.click();
      await expect(page.getByText(`${title} is Ready. Starting it is your call.`)).toBeVisible();

      // Straight from Backlog to Ready, created by Jan's Role: no Planning, no planning Thread.
      const stateChanges = await queryOfficeDatabase(
        "SELECT from_state, to_state, changed_by FROM task_state_changes WHERE task_id = $1 ORDER BY id",
        [task.id],
      );
      expect(stateChanges).toEqual([
        {
          from_state: null,
          to_state: "backlog",
          changed_by: { kind: "person", roleKey: "planner" },
        },
        { from_state: "backlog", to_state: "ready", changed_by: { kind: "user" } },
      ]);
      const threads = threadListSchema.parse(
        await (await page.request.get(`/api/tasks/${task.id}/threads`)).json(),
      );
      expect(threads).toEqual([]);

      // Nothing of it is left to weigh on the next tests' Start.
      expect((await page.request.post(`/api/tasks/${task.id}/drop`)).status()).toBe(200);
    } finally {
      await repository.remove();
    }
  },
);

/** A library skill for the Planner, written by this test alone. */
const USED_SKILL = "people-skill-uses";

// The engine replays the last session in e2e/sessions.jsonl: Jan calls Skill for a library skill
// and for the Project's own, once each.
test(
  "a session's Skill uses show in Settings › Skills and on the Project's Skills, without a reload",
  { tag: "@full" },
  async ({ page, context }) => {
    const repository = await createTemporaryRepository();
    await commitFiles(repository, {
      ".claude/skills/release-notes/SKILL.md":
        "---\nname: release-notes\ndescription: Writes the release notes.\n---\nList what changed.\n",
    });
    try {
      const project = await addedProject(page, repository, "Skill uses", "SU", PASSING_COMMANDS);
      const projectSkillsOn = await page.request.put(
        `/api/projects/${project.id}/use-project-skills`,
        { data: { useProjectSkills: true } },
      );
      expect(projectSkillsOn.status()).toBe(200);
      const written = await page.request.post("/api/skills", {
        data: { name: USED_SKILL, description: "Checks the change.", instructions: "Check it." },
      });
      expect(written.status()).toBe(201);
      for (const change of [
        () => page.request.put(`/api/skills/${USED_SKILL}/state`, { data: { state: "on" } }),
        () => page.request.put(`/api/skills/${USED_SKILL}/roles`, { data: { roles: ["planner"] } }),
      ]) {
        expect((await change()).status()).toBe(200);
      }
      const taskId = await readyTask(page, project.id, "Write the release notes");

      // Both lists are open before the use, so the events alone change them.
      await page.goto("/settings/skills");
      const libraryRow = page.getByRole("row", { name: new RegExp(USED_SKILL) });
      await expect(libraryRow.getByText("Not used in the last 7 days")).toBeAttached();
      const projectPage = await context.newPage();
      await projectPage.goto(`/projects/${project.id}/skills`);
      const projectRow = projectPage.getByRole("group", { name: "release-notes" });
      await expect(projectRow).toContainText("Not used in the last 7 days");

      const { id: threadId } = threadSchema.parse(
        await (await page.request.post(`/api/tasks/${taskId}/conversation/planner/thread`)).json(),
      );
      const sent = await page.request.post(`/api/threads/${threadId}/messages`, {
        data: { text: "Write the release notes." },
      });
      expect(sent.ok()).toBe(true);

      await expect(libraryRow.locator(".skill-uses [aria-hidden='true']")).toHaveText("1");
      await expect(libraryRow.getByText("Used once in the last 7 days")).toBeAttached();
      await expect(projectRow).toContainText("Used once in the last 7 days");
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skill-uses-library.png") });
      await projectPage.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-skill-uses-project.png"),
      });
      await projectPage.close();

      // Nothing of it is left to weigh on the next tests' Start or sessions.
      expect((await page.request.post(`/api/tasks/${taskId}/drop`)).status()).toBe(200);
      expect((await page.request.delete(`/api/skills/${USED_SKILL}`)).ok()).toBe(true);
    } finally {
      await repository.remove();
    }
  },
);

/** The Tasks the scripted Planner plans by id in its Initiative's planning Thread. */
const EXPORT_API_TASK = "6f0c2a8e-1d3b-4c7a-9e21-5a0b7c3d9e01";
const EXPORT_BUTTON_TASK = "6f0c2a8e-1d3b-4c7a-9e21-5a0b7c3d9e02";

/**
 * Gives Tasks the fixed ids the scripted session names, each pair its id now and its fixed one, in
 * one statement, so every row that names them moves at once.
 */
async function giveTasksFixedIds(...pairs: readonly (readonly [string, string])[]): Promise<void> {
  await queryOfficeDatabase(
    `with renamed(old_id, new_id) as (select * from unnest($1::uuid[], $2::uuid[])),
     moved as (
       update tasks
          set id = renamed.new_id,
              blocked_by = array(
                select coalesce(other.new_id, blocked.blocker)
                  from unnest(tasks.blocked_by) with ordinality as blocked(blocker, position)
                  left join renamed other on other.old_id = blocked.blocker
                 order by blocked.position
              )
         from renamed
        where tasks.id = renamed.old_id
       returning tasks.id
     )
     update task_state_changes
        set task_id = renamed.new_id
       from renamed
      where task_state_changes.task_id = renamed.old_id`,
    [pairs.map(([now]) => now), pairs.map(([, fixed]) => fixed)],
  );
}

// The engine replays the last two sessions in e2e/sessions.jsonl: Bob's on the Initiative's shaping
// Thread, which opens as the Idea is shaped, then Jan's, who tries Export button first and is
// refused, as it waits for Export API, then plans Export API and Export button by their ids.
test(
  "the user has Jan plan the whole Initiative in auto mode, and its Tasks are Ready in dependency order with nothing clicked",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Initiative planning", "IP");
      const idea = ideaSchema.parse(
        await (
          await page.request.post("/api/ideas", {
            data: { title: "Usage exports", notes: "", projectId: null },
          })
        ).json(),
      );
      const initiative = initiativeSchema.parse(
        await (await page.request.post(`/api/ideas/${idea.id}/initiative`)).json(),
      );
      const add = async (title: string, blockedBy: readonly string[]) =>
        taskSchema.parse(
          await (
            await page.request.post(`/api/initiatives/${initiative.id}/tasks`, {
              data: { title, projectId: project.id, priority: "normal", blockedBy },
            })
          ).json(),
        );
      const exportApi = await add("Export API", []);
      const exportButton = await add("Export button", [exportApi.id]);
      expect((await page.request.post(`/api/initiatives/${initiative.id}/confirm`)).ok()).toBe(
        true,
      );
      await giveTasksFixedIds(
        [exportApi.id, EXPORT_API_TASK],
        [exportButton.id, EXPORT_BUTTON_TASK],
      );

      await page.goto(`/work/initiatives/${initiative.id}`);
      const head = page.locator(".task-head");
      const autoMode = autoModeSwitch(head);
      // The switch starts at the remembered default.
      const remembered = autoModeSettingSchema.parse(
        await (await page.request.get("/api/settings/auto-mode")).json(),
      ).autoMode;
      await expect(autoMode).toHaveAttribute("aria-checked", String(remembered));
      if (!remembered) await head.getByText("Auto mode", { exact: true }).click();
      await expect(autoMode).toHaveAttribute("aria-checked", "true");
      await page.getByRole("button", { name: "Plan the Initiative" }).click();
      await expect(page.getByRole("link", { name: "Planning Thread" })).toBeVisible();

      const read = async (id: string) =>
        taskSchema.parse(await (await page.request.get(`/api/tasks/${id}`)).json());
      for (const id of [EXPORT_API_TASK, EXPORT_BUTTON_TASK]) {
        await expect.poll(async () => (await read(id)).state, { timeout: 30_000 }).toBe("ready");
      }
      expect(await read(EXPORT_BUTTON_TASK)).toMatchObject({
        markedPlanned: true,
        planConfirmed: true,
        definitionOfDoneConfirmed: true,
        filesToChange: ["apps/web/src/usage/export-button.tsx"],
        pipelineId: "full",
        tags: ["usage-exports", "web"],
      });
      await expect(page.getByText("2 of 2 Tasks planned")).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-initiative-planned.png"),
      });

      // Export button moved to Planning only once Export API was Ready.
      const moves = await queryOfficeDatabase(
        `select task_id, from_state, to_state, changed_by from task_state_changes
          where task_id in ($1, $2) and from_state in ('backlog', 'planning') order by id`,
        [EXPORT_API_TASK, EXPORT_BUTTON_TASK],
      );
      const planner = { kind: "person", roleKey: "planner" };
      expect(moves).toEqual([
        {
          task_id: EXPORT_API_TASK,
          from_state: "backlog",
          to_state: "planning",
          changed_by: planner,
        },
        {
          task_id: EXPORT_API_TASK,
          from_state: "planning",
          to_state: "ready",
          changed_by: expect.objectContaining({ kind: "auto-mode" }),
        },
        {
          task_id: EXPORT_BUTTON_TASK,
          from_state: "backlog",
          to_state: "planning",
          changed_by: planner,
        },
        {
          task_id: EXPORT_BUTTON_TASK,
          from_state: "planning",
          to_state: "ready",
          changed_by: expect.objectContaining({ kind: "auto-mode" }),
        },
      ]);
      const { planningThreadId } = initiativeSchema.parse(
        await (await page.request.get(`/api/initiatives/${initiative.id}`)).json(),
      );
      // Jan called start_planning three times, and each Task moved to Planning once: the first try,
      // on Export button before Export API was planned, was refused.
      const log = await (
        await page.request.get(`/api/threads/${planningThreadId}/messages`)
      ).text();
      expect(log.match(/"tool":"start_planning"/g)).toHaveLength(3);

      // Nothing of it is left to weigh on the next tests' Start.
      for (const id of [EXPORT_API_TASK, EXPORT_BUTTON_TASK]) {
        expect((await page.request.post(`/api/tasks/${id}/drop`)).status()).toBe(200);
      }
    } finally {
      await repository.remove();
    }
  },
);

/** The Tasks the scripted Planner asks about and plans by id, in a second planning Thread. */
const INVOICE_API_TASK = "7d1e3b9f-2c4a-4e8b-a5d6-0f1b2c3d4e01";
const INVOICE_BUTTON_TASK = "7d1e3b9f-2c4a-4e8b-a5d6-0f1b2c3d4e02";
const INVOICE_CHART_TASK = "7d1e3b9f-2c4a-4e8b-a5d6-0f1b2c3d4e03";
const FORMAT_QUESTION = "Which format should the invoice export use?";
const ROW_COUNT_QUESTION = "Should the invoice chart show a row count?";

// The engine replays the last two sessions in e2e/sessions.jsonl: Bob's on the Initiative's shaping
// Thread, then Jan's, who opens a Decision on Invoice export API and one on Invoice chart, is
// refused start_planning on the chart, as it waits for the API, and plans the download button to
// Ready. The user's answer on the API's page resumes the session: Jan plans the API, then the
// chart, which waits for its own answer, and rewrites the button; the second answer frees the chart.
test(
  "the user answers Jan's Decisions on the Initiative's Tasks while the rest is planned, and a planned Task is rewritten to match",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Invoice planning", "IV");
      const idea = ideaSchema.parse(
        await (
          await page.request.post("/api/ideas", {
            data: { title: "Invoice exports", notes: "", projectId: null },
          })
        ).json(),
      );
      const initiative = initiativeSchema.parse(
        await (await page.request.post(`/api/ideas/${idea.id}/initiative`)).json(),
      );
      const add = async (title: string, blockedBy: readonly string[]) =>
        taskSchema.parse(
          await (
            await page.request.post(`/api/initiatives/${initiative.id}/tasks`, {
              data: { title, projectId: project.id, priority: "normal", blockedBy },
            })
          ).json(),
        );
      const invoiceApi = await add("Invoice export API", []);
      const invoiceButton = await add("Invoice download button", []);
      const invoiceChart = await add("Invoice chart", [invoiceApi.id]);
      expect((await page.request.post(`/api/initiatives/${initiative.id}/confirm`)).ok()).toBe(
        true,
      );
      await giveTasksFixedIds(
        [invoiceApi.id, INVOICE_API_TASK],
        [invoiceButton.id, INVOICE_BUTTON_TASK],
        [invoiceChart.id, INVOICE_CHART_TASK],
      );

      const initiativeUrl = `/work/initiatives/${initiative.id}`;
      await page.goto(initiativeUrl);
      const head = page.locator(".task-head");
      const autoMode = autoModeSwitch(head);
      // Read once the switch shows the remembered default, so the click never turns it off.
      const remembered = autoModeSettingSchema.parse(
        await (await page.request.get("/api/settings/auto-mode")).json(),
      ).autoMode;
      await expect(autoMode).toHaveAttribute("aria-checked", String(remembered));
      if (!remembered) await head.getByText("Auto mode", { exact: true }).click();
      await expect(autoMode).toHaveAttribute("aria-checked", "true");
      await page.getByRole("button", { name: "Plan the Initiative" }).click();

      const read = async (id: string) =>
        taskSchema.parse(await (await page.request.get(`/api/tasks/${id}`)).json());
      const openOn = async (taskId: string) =>
        decisionListSchema
          .parse(await (await page.request.get("/api/decisions/open")).json())
          .filter((decision) => decision.taskId === taskId);
      // Jan asks on two Tasks at once and plans the one that waits for neither.
      await expect
        .poll(async () => (await read(INVOICE_BUTTON_TASK)).state, { timeout: 30_000 })
        .toBe("ready");
      await expect.poll(async () => (await openOn(INVOICE_CHART_TASK)).length).toBe(1);
      expect(await openOn(INVOICE_API_TASK)).toHaveLength(1);
      // The chart waits for the API, whose Decision keeps it unplanned: start_planning was refused.
      expect(await read(INVOICE_CHART_TASK)).toMatchObject({ state: "backlog" });
      expect(await read(INVOICE_API_TASK)).toMatchObject({
        state: "planning",
        markedPlanned: false,
      });

      await expect(
        page.getByText("1 of 3 Tasks planned · 2 waiting for your answer"),
      ).toBeVisible();
      await expect(page.getByText("Waiting for your answer", { exact: true })).toHaveCount(2);
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-initiative-waiting-for-answers.png"),
      });
      await showPalette(page, "dark");
      await page.screenshot({
        path: path.join(SCREENSHOTS, "dark-1600-initiative-waiting-for-answers.png"),
      });
      await showPalette(page, "light");

      // Both cards wait in the planning Thread, each naming its Task.
      const { planningThreadId } = initiativeSchema.parse(
        await (await page.request.get(`/api/initiatives/${initiative.id}`)).json(),
      );
      await page.goto(`${initiativeUrl}?initiativeThread=${planningThreadId}`);
      await expect(
        page.locator(".conversation-tabs").getByRole("tab", { selected: true }),
      ).toHaveText(/Jan/);
      const formatCard = page.getByRole("region", { name: `Decision: ${FORMAT_QUESTION}` });
      const rowCountCard = page.getByRole("region", { name: `Decision: ${ROW_COUNT_QUESTION}` });
      await expect(formatCard).toContainText("Invoice export API");
      await expect(rowCountCard).toContainText("Invoice chart");
      await formatCard.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-planning-thread-decisions.png"),
      });
      await showPalette(page, "dark");
      await page.screenshot({
        path: path.join(SCREENSHOTS, "dark-1600-planning-thread-decisions.png"),
      });
      await showPalette(page, "light");

      // The API's page has the Decision in Needs you, linking to the planning Thread, and in
      // Before Ready, and the answer given there resumes Jan's session.
      await page.goto(`/tasks/${INVOICE_API_TASK}`);
      const needsYou = page.getByRole("region", { name: "Needs you" });
      const onTask = needsYou.getByRole("region", { name: `Decision: ${FORMAT_QUESTION}` });
      await expect(
        onTask.getByRole("link", { name: /in the Initiative's planning Thread/ }),
      ).toBeVisible();
      const beforeReady = page.getByRole("region", { name: "Before Ready" });
      await expect(
        beforeReady.getByRole("listitem").filter({ hasText: "No Decision open" }),
      ).toContainText("1 open, in Needs you");
      await pickAndSubmit(onTask, "CSV");
      await expect(onTask).toHaveCount(0);

      await expect
        .poll(async () => (await read(INVOICE_API_TASK)).state, { timeout: 30_000 })
        .toBe("ready");
      // Jan rewrote the button for the answer: back to Backlog, into Planning, and Ready again.
      await expect
        .poll(async () => (await read(INVOICE_BUTTON_TASK)).plan, { timeout: 30_000 })
        .toBe("Add a Download button that saves the invoice export as a .csv file.");
      await expect.poll(async () => (await read(INVOICE_BUTTON_TASK)).state).toBe("ready");
      // The chart is planned, but waits for its own answer.
      await expect
        .poll(async () => (await read(INVOICE_CHART_TASK)).state, { timeout: 30_000 })
        .toBe("planning");
      expect(await read(INVOICE_CHART_TASK)).toMatchObject({ markedPlanned: false });

      const [rowCount] = await openOn(INVOICE_CHART_TASK);
      expect(
        (
          await page.request.post(`/api/decisions/${rowCount?.id}/answer`, {
            data: { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
          })
        ).ok(),
      ).toBe(true);
      await expect
        .poll(async () => (await read(INVOICE_CHART_TASK)).state, { timeout: 30_000 })
        .toBe("ready");
      await page.goto(initiativeUrl);
      await expect(page.getByText("3 of 3 Tasks planned")).toBeVisible();
      await expect(page.getByText("Waiting for your answer", { exact: true })).toHaveCount(0);

      const buttonMoves = await queryOfficeDatabase(
        `select from_state, to_state, changed_by from task_state_changes
          where task_id = $1 and from_state is not null order by id`,
        [INVOICE_BUTTON_TASK],
      );
      const planner = { kind: "person", roleKey: "planner" };
      expect(buttonMoves).toEqual([
        { from_state: "shaping", to_state: "backlog", changed_by: expect.anything() },
        { from_state: "backlog", to_state: "planning", changed_by: planner },
        {
          from_state: "planning",
          to_state: "ready",
          changed_by: expect.objectContaining({ kind: "auto-mode" }),
        },
        { from_state: "ready", to_state: "planning", changed_by: planner },
        {
          from_state: "planning",
          to_state: "ready",
          changed_by: expect.objectContaining({ kind: "auto-mode" }),
        },
      ]);

      // Nothing of it is left to weigh on the next tests' Start.
      for (const id of [INVOICE_API_TASK, INVOICE_BUTTON_TASK, INVOICE_CHART_TASK]) {
        expect((await page.request.post(`/api/tasks/${id}/drop`)).status()).toBe(200);
      }
    } finally {
      await repository.remove();
    }
  },
);

const WEB_APP_OUTPUT = [
  "chunk one: starting the web app",
  "chunk two: ready on port 5173",
  "chunk three: page compiled",
  "chunk four: stopping",
].map((line) => `${line}\n`);

// The engine replays the last session in e2e/sessions.jsonl: Jan starts a Process that prints two
// chunks and ends the turn, which holds at each `wait` step until the test reaches its mark through
// the e2e service's own route, as the scripted sessions run inside the service.
test(
  "a Process opened late shows its output so far, then each new chunk live and once, and how it ended",
  { tag: "@full" },
  async ({ page }) => {
    const { id: threadId } = threadSchema.parse(
      await (await page.request.post("/api/chats/planner/threads")).json(),
    );
    const sent = await page.request.post(`/api/threads/${threadId}/messages`, {
      data: { text: "Start the web app and leave it running." },
    });
    expect(sent.ok()).toBe(true);
    // Not found until the Process starts.
    const outputKept = async () => {
      const read = await page.request.get(
        `/api/threads/${threadId}/processes/process-web-app/output`,
      );
      return read.ok() ? processOutputSchema.parse(await read.json()).lastSequence : 0;
    };
    await expect.poll(outputKept, { timeout: 30_000 }).toBe(2);
    const reach = async (mark: string) =>
      expect((await page.request.post(`/api/e2e/marks/${mark}`)).status()).toBe(204);

    // The turn ended with the Process running: the page opens late.
    await page.goto(`/people?chat=planner&thread=${threadId}`);
    const jan = chatWith(page, "Jan");
    await expect(jan.getByText("The web app runs in the background.")).toBeVisible();
    await jan.getByRole("button", { name: "1 process running. Show them." }).click();
    const window = page.getByRole("dialog", { name: /^Sub-agents and processes/ });
    const output = window.getByLabel("Output", { exact: true });
    await expect(output).toHaveText(WEB_APP_OUTPUT.slice(0, 2).join(""));
    await expect(window.locator(".sub-agents-and-processes-command")).toHaveText(
      "npm run dev -w apps/web",
    );
    await expect(window.getByText("Following the end")).toBeVisible();
    await expect(window.getByText("Read-only: only the Agent can stop them")).toBeVisible();
    await expect(window.getByRole("button", { name: /stop/i })).toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-process-output.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-process-output.png") });
    await showPalette(page, "light");

    // What comes next arrives live, after what the late read had, with no chunk twice.
    await reach("process-output-goes-on");
    await expect(output).toHaveText(WEB_APP_OUTPUT.slice(0, 3).join(""));

    await reach("process-ends");
    await expect(window.locator(".sub-agents-and-processes-ending.finished")).toContainText(
      "Finished with exit code 0",
    );
    await expect(output).toHaveText(WEB_APP_OUTPUT.join(""));
    await expect(window.getByText("Following the end")).toHaveCount(0);
    await window.getByRole("button", { name: "Close", exact: true }).click();
    await expect(jan.getByRole("button", { name: "1 process ended. Show them." })).toBeVisible();
  },
);

/** What of the picked item's details reaches past the details pane's right edge, or scrolls hidden. */
async function overflowOfDetails(window: Locator): Promise<readonly string[]> {
  return window.locator(".sub-agents-and-processes-details").evaluate((details) => {
    const scroll = details.querySelector(".sub-agents-and-processes-scroll");
    if (scroll === null) return ["no scroll area"];
    const edge = details.getBoundingClientRect().right;
    const parts = details.querySelectorAll(
      ".turn, .tool-calls, .sub-agents-and-processes-reported, .sub-agents-and-processes-ending",
    );
    return [
      ...(scroll.scrollWidth > scroll.clientWidth
        ? [`scroll area ${scroll.scrollWidth} > ${scroll.clientWidth}`]
        : []),
      ...[...parts]
        .filter((part) => part.getBoundingClientRect().right > edge + 0.5)
        .map((part) => `${part.className} ends at ${part.getBoundingClientRect().right} > ${edge}`),
    ];
  });
}

// The engine replays the last session in e2e/sessions.jsonl: Jan starts a Sub-agent whose folded
// tool calls, code line and report back run long, then one that fails for a long reason.
test(
  "a Sub-agent's long tool calls and code wrap inside its details, beside the list and stacked",
  { tag: "@full" },
  async ({ page }) => {
    const { id: threadId } = threadSchema.parse(
      await (await page.request.post("/api/chats/planner/threads")).json(),
    );
    const sent = await page.request.post(`/api/threads/${threadId}/messages`, {
      data: { text: "Look for long lines with Sub-agents." },
    });
    expect(sent.ok()).toBe(true);

    await page.goto(`/people?chat=planner&thread=${threadId}`);
    const jan = chatWith(page, "Jan");
    await expect(jan.getByText("The Sub-agents looked for long lines.")).toBeVisible({
      timeout: 30_000,
    });
    await jan.getByRole("button", { name: /^2 sub-agents .*Show them\.$/ }).click();
    const window = page.getByRole("dialog", { name: /^Sub-agents and processes/ });
    // Stacked, the list is behind the details' way back.
    const pick = async (title: string) => {
      const back = window.getByRole("button", { name: "All sub-agents and processes" });
      if (await back.isVisible()) await back.click();
      await window.getByRole("button", { name: new RegExp(title) }).click();
    };
    await pick("Look for long lines");
    const details = window.locator(".sub-agents-and-processes-details");
    await expect(details.getByRole("heading", { name: "Look for long lines" })).toBeVisible();
    await detailsSwitch(details).check();
    const fold = details.locator("details.tool-calls");
    await expect(fold).toHaveCount(1);
    // The fold's own line is cut short with an ellipsis, as in a Thread.
    expect(
      await fold
        .locator(".tool-call-latest")
        .evaluate((line) => line.scrollWidth > line.clientWidth && line.clientWidth > 0),
    ).toBe(true);
    await fold.locator("summary").click();
    await expect(details.locator("pre", { hasText: "const widest=" })).toBeVisible();
    await expect(details.getByRole("region", { name: "Reported back" })).toBeVisible();
    expect(await overflowOfDetails(window)).toEqual([]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-sub-agent-long-lines.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-sub-agent-long-lines.png") });
    await showPalette(page, "light");

    await pick("Check the run tab");
    await expect(details.locator(".sub-agents-and-processes-ending.failed")).toBeVisible();
    expect(await overflowOfDetails(window)).toEqual([]);

    // Stacked: the details take the window's whole width.
    await page.setViewportSize({ width: NARROW_WIDTH_PX - 160, height: 900 });
    await pick("Look for long lines");
    await expect(details.getByRole("region", { name: "Reported back" })).toBeVisible();
    await expect(window.locator(".sub-agents-and-processes-list")).toBeHidden();
    expect(await overflowOfDetails(window)).toEqual([]);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-480-sub-agent-long-lines.png") });
    await showPalette(page, "dark");
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-480-sub-agent-long-lines.png") });
    await showPalette(page, "light");

    await detailsSwitch(details).uncheck();
    await page.setViewportSize({ width: 1600, height: 1000 });
  },
);

/** The id the chat's script answers by: a script names no record by an id made at run time. */
const DECISION_FOR_THE_USER_ID = "5d0b8c1e-7a3f-4e2b-9c6d-1f8a2b3c4d5e";
const DECISION_FOR_THE_USER_QUESTION = "Should the old export stay beside the new one?";

/** A Decision Jan asked on the Task, waiting on the user, by the id the chat's script names. */
async function seedDecisionForTheUser(taskId: string, plannerThreadId: string): Promise<void> {
  await queryOfficeDatabase(
    `insert into decisions (id, thread_id, task_id, role_key, kind, question, context, options, recommendation, questions, asked_at)
     values ($1, $2, $3, 'planner', 'question', $4, 'Some reports read the old one.', $5, $6, $7, now())`,
    [
      DECISION_FOR_THE_USER_ID,
      plannerThreadId,
      taskId,
      ...oneChoiceColumns(
        DECISION_FOR_THE_USER_QUESTION,
        ["Keep the old export", "Remove the old export"],
        "Reports read it.",
      ),
    ],
  );
  await queryOfficeDatabase(
    `insert into thread_messages (id, thread_id, body, at) values ($1, $2, $3, now())`,
    [
      crypto.randomUUID(),
      plannerThreadId,
      { kind: "decision", roleKey: "planner", decisionId: DECISION_FOR_THE_USER_ID },
    ],
  );
}

// The engine replays the last sessions in e2e/sessions.jsonl: Jan in his chat answers the Decision
// for the user with answer_decision, then Jan's planning Thread takes the answer.
test(
  "a person answers a Decision for the user from their chat, and its card says so",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Answered", "AN", PASSING_COMMANDS);
      const taskId = await readyTask(page, project.id, "Old export answered for the user");
      const [planning] = threadListSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}/threads`)).json(),
      );
      if (!planning) throw new Error("Planning opened no Thread.");
      await seedDecisionForTheUser(taskId, planning.id);

      const { id: chatId } = threadSchema.parse(
        await (await page.request.post("/api/chats/planner/threads")).json(),
      );
      const sent = await page.request.post(`/api/threads/${chatId}/messages`, {
        data: { text: "Answer your Decision on the old export for me: keep it." },
      });
      expect(sent.ok()).toBe(true);

      await page.goto(`/tasks/${taskId}`);
      const conversation = page.getByRole("complementary", { name: "Conversation" });
      await expect(conversation.getByText("Then the old export stays.")).toBeVisible({
        timeout: 30_000,
      });
      const card = conversation.getByRole("region", {
        name: `Decision: ${DECISION_FOR_THE_USER_QUESTION}`,
      });
      await expect(card.locator(".decision-answer-words")).toHaveText(
        "Keep the old export (recommended)",
      );
      await expect(card.locator(".decision-answered")).toHaveText(
        "Answered by Jan at your request",
      );
      await expect(
        conversation.getByText("Jan · answering the Decision at your request"),
      ).toBeVisible();
      await expect(page.getByRole("region", { name: "Needs you" })).not.toContainText(
        DECISION_FOR_THE_USER_QUESTION,
      );
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-answered-at-your-request.png"),
      });
      await showPalette(page, "dark");
      await page.screenshot({
        path: path.join(SCREENSHOTS, "dark-1600-answered-at-your-request.png"),
      });
      await showPalette(page, "light");

      // The card's way to the chat the user asked in opens it in the drawer.
      await card.getByRole("link", { name: "at your request" }).click();
      await expect(
        chatWith(page, "Jan").getByText("I answered it for you: keep it."),
      ).toBeVisible();
      expect(await chatThreadShown(page)).toBe(chatId);
    } finally {
      await repository.remove();
    }
  },
);

// The engine replays the last sessions in e2e/sessions.jsonl: Jan in his chat calls Nina with a
// request, Nina drafts a Proposal of the Project's commands in her Consultation, in her own chat,
// and answers him, and Jan takes her answer.
test(
  "a person calls another from their chat: the callee drafts a Proposal in their own chat, and the answer comes back",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      // Its id, "called-up", is the one Nina's script names.
      const project = await addedProject(page, repository, "Called up", "CU", PASSING_COMMANDS);
      expect(project.id).toBe("called-up");
      const { id: chatId } = threadSchema.parse(
        await (await page.request.post("/api/chats/planner/threads")).json(),
      );
      const sent = await page.request.post(`/api/threads/${chatId}/messages`, {
        data: { text: "Ask Devops to set up an End to end test command for Called up." },
      });
      expect(sent.ok()).toBe(true);

      await page.goto(`/now?chat=planner&thread=${chatId}`);
      const jan = chatWith(page, "Jan");
      await expect(jan.getByText("Nina drafted it: apply her Proposal in her chat.")).toBeVisible({
        timeout: 30_000,
      });
      const call = jan.getByRole("region", {
        name: "Decision: Add an End to end test command to Called up.",
      });
      await expect(call.locator(".decision-question")).toHaveText(
        "Asked Nina to: Add an End to end test command to Called up.",
      );
      await expect(call.locator(".decision-answer-words")).toHaveText(
        "I drafted a Proposal adding the End to end command to Called up, for the user to apply in my chat.",
      );
      await expect(call.locator(".decision-answered")).toHaveText(
        "Answered by Nina in a Consultation · Open the Consultation",
      );
      await expect(call).not.toContainText("Needs you");
      await call.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-call-from-a-chat.png") });

      const [consultation] = chatThreadPageSchema
        .parse(await (await page.request.get("/api/chats/devops/threads")).json())
        .rows.filter((thread) => thread.consultation?.askerThreadId === chatId);
      if (!consultation) throw new Error("No Consultation opened in Nina's chat.");
      expect(consultation.title).toBe("Consultation · Jan and Nina");
      await page.goto(`/now?chat=devops&thread=${consultation.id}`);
      const nina = chatWith(page, "Nina");
      await expect(
        nina.getByText("Jan asks you to: Add an End to end test command to Called up."),
      ).toBeVisible();
      await expect(
        nina.getByText(
          "Your answer to Jan: I drafted a Proposal adding the End to end command to Called up, for the user to apply in my chat.",
        ),
      ).toBeVisible();
      const proposal = nina.getByRole("region", { name: "Proposal: Change Called up's commands" });
      await expect(proposal.getByRole("listitem")).toHaveText([
        "End to end (test-e2e)None: addedTest · npm run e2e",
      ]);
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-1600-consultation-in-the-callee-chat.png"),
      });
    } finally {
      await repository.remove();
    }
  },
);

// The engine replays the last sessions in e2e/sessions.jsonl: Implement's turn refused because the
// 5-hour window is used up, its reset a minute after the refusal (`resetsInSeconds`), then a fresh
// session after the reset, as the refused turn left none, which does the work.
test(
  "a Stage refused for a used-up usage window pauses its Task until the reset, then goes on by itself",
  { tag: "@full" },
  async ({ page }) => {
    test.setTimeout(240_000);
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Export", "EX", PASSING_COMMANDS);
      const title = "Export keeps its filter";
      const taskId = await readyTask(page, project.id, title);
      const library = pipelineListSchema.parse(
        await (await page.request.get("/api/pipelines")).json(),
      );
      const implementOnly = asStageList(
        (library.find(({ id }) => id === "quick-fix")?.stages ?? []).filter(
          ({ key }) => key === "implement",
        ),
      );
      const edited = await page.request.put(`/api/tasks/${taskId}/stages`, {
        data: { stages: implementOnly },
      });
      expect(edited.status()).toBe(200);
      await page.goto(`/tasks/${taskId}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();

      // Paused with why and when it resumes, in local time, and no failure.
      const paused = page
        .locator(".task-head")
        .getByText(/^Usage window used up · resumes \d\d:\d\d$/);
      await expect(paused).toBeVisible({ timeout: 30_000 });
      const task = taskSchema.parse(await (await page.request.get(`/api/tasks/${taskId}`)).json());
      expect(task).toMatchObject({ state: "paused", pausedBy: "usage-window" });
      expect(task.resumesAt).not.toBeNull();
      // Work pauses the Task before the run is saved held: once it is, the refused first turn left
      // no session, so Resume begins the Stage anew.
      await expect(
        page.getByRole("button", { name: "Resume · fresh session with a Brief", exact: true }),
      ).toBeVisible();
      await screenshotScenario(page, "usage-window-task-page");

      // The Stage's Thread says why, as a notice.
      const rail = page.getByRole("region", { name: /^Pipeline · / });
      await rail.getByRole("button", { name: "Implement", exact: true }).click();
      const history = page.getByRole("dialog", { name: /^Stage history: Implement/ });
      await history.getByRole("tab", { name: "Thread" }).click();
      await expect(
        history.getByText(/^Claude Code's 5-hour window is used up until \d\d:\d\d$/),
      ).toBeVisible();
      await screenshotScenario(page, "usage-window-thread-line");
      await page.keyboard.press("Escape");

      // The board's card and Now say the same.
      await page.goto("/work");
      const card = page.getByRole("article", { name: title });
      await expect(
        card.getByRole("img", { name: /^Usage window used up · resumes \d\d:\d\d$/ }),
      ).toBeVisible();
      await screenshotScenario(page, "usage-window-board");
      await page.goto("/");
      await expect(page.getByRole("article", { name: `Running: ${title}` })).toContainText(
        /Usage window used up · resumes \d\d:\d\d/,
      );

      // At the reset the Task resumes by itself, and the Stage finishes its work.
      await page.goto(`/tasks/${taskId}`);
      await expect(page.locator(".task-head").getByText("Done", { exact: true })).toBeVisible({
        timeout: 120_000,
      });
      const resumed = taskSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}`)).json(),
      );
      expect(resumed).toMatchObject({ pausedBy: null, resumesAt: null });
    } finally {
      await repository.remove();
    }
  },
);

const REPORT_FORMAT_QUESTION = "Which format should the quarterly report export use?";

/** The open Decision whose first question is `question`, as Needs you lists it. */
async function openDecisionAsking(page: Page, question: string) {
  return decisionListSchema
    .parse(await (await page.request.get("/api/decisions/open")).json())
    .find(({ questions }) => questions[0]?.question === question);
}

// The engine replays the next session in e2e/sessions.jsonl: Bob's on the Initiative's shaping
// Thread, which holds at a mark before it opens a Decision of two questions on no Task, and at
// another before its turn ends; the answer reaches him as his next message, which he answers.
test(
  "Bob asks two questions on the whole Initiative while shaping it: the card is answered in the Thread, Needs you and the Notification lead there, and the answer reaches him",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Quarterly reports", "QR");
      const idea = ideaSchema.parse(
        await (
          await page.request.post("/api/ideas", {
            data: { title: "Quarterly report exports", notes: "", projectId: null },
          })
        ).json(),
      );
      const initiative = initiativeSchema.parse(
        await (await page.request.post(`/api/ideas/${idea.id}/initiative`)).json(),
      );
      const task = taskSchema.parse(
        await (
          await page.request.post(`/api/initiatives/${initiative.id}/tasks`, {
            data: {
              title: "Quarterly report download",
              projectId: project.id,
              priority: "normal",
              blockedBy: [],
            },
          })
        ).json(),
      );
      const reach = async (mark: string) =>
        expect((await page.request.post(`/api/e2e/marks/${mark}`)).status()).toBe(204);

      // Bob opens the Decision while the user is elsewhere: its Notification comes as a toast, once
      // the page has read those open before it (which it never shows again).
      const notificationsRead = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/notifications" && response.ok(),
      );
      await page.goto("/projects");
      await notificationsRead;
      await reach("report-exports-asks");
      await expect.poll(() => openDecisionAsking(page, REPORT_FORMAT_QUESTION)).toBeTruthy();
      const decision = await openDecisionAsking(page, REPORT_FORMAT_QUESTION);
      if (!decision) throw new Error("Bob's Decision isn't open.");
      expect(decision.taskId).toBeNull();
      const threadUrl = `/work/initiatives/${initiative.id}?initiativeThread=${decision.threadId}&decision=${decision.id}`;
      const notificationOf = async () =>
        notificationListSchema
          .parse(await (await page.request.get("/api/notifications")).json())
          .find(
            ({ kind, pointsTo }) =>
              kind === "needs-you.decision" &&
              pointsTo.kind === "initiative" &&
              pointsTo.decisionId === decision.id,
          );
      await expect.poll(notificationOf).toMatchObject({
        pointsTo: {
          kind: "initiative",
          initiativeId: initiative.id,
          threadId: decision.threadId,
          decisionId: decision.id,
        },
      });
      const toast = page.locator(".toasts").getByRole("button", {
        name: /On the Initiative Quarterly report exports, I need your answer: Which format/,
      });
      await toast.click();
      await expect(page).toHaveURL(
        new RegExp(
          `/work/initiatives/${initiative.id}\\?initiativeThread=${decision.threadId}&decision=${decision.id}$`,
        ),
      );

      // The card is answered in the Thread, the whole form in place; while Bob's turn runs, the
      // answer would reach him as it ends.
      const conversation = page.getByRole("complementary", { name: "Conversation" });
      const card = conversation.locator(`#decision-card-${decision.id}`);
      await expect(card).toHaveAttribute(
        "aria-label",
        `Decision: ${REPORT_FORMAT_QUESTION} (and 1 more question)`,
      );
      await expect(card.locator(".decision-on-task")).toHaveText(
        "On no Task: about the Initiative as a whole",
      );
      await expect(card.getByRole("group", { name: "Question 1" })).toContainText(
        REPORT_FORMAT_QUESTION,
      );
      await expect(card.getByRole("group", { name: "Question 2" })).toContainText(
        "How often should the export run?",
      );
      await expect(card.getByText("Reaches Bob when this turn ends.")).toBeVisible();
      await reach("report-exports-turn-ends");
      await expect(
        conversation.getByText("I asked you two things before I write the outcome."),
      ).toBeVisible();
      await expect(card.getByText("Reaches Bob when this turn ends.")).toHaveCount(0);
      // For a Task's review, the card at the top of its Thread, at each width: in a narrow window the
      // conversation is a drawer, which the address naming the Thread opens as the page loads.
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        for (const width of [1600, 900, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(threadUrl);
          await expect(page.locator("html")).toHaveAttribute("data-palette", colorScheme);
          await expect(card.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
          await card.evaluate((shown) => shown.scrollIntoView({ block: "start" }));
          await motionSettled(page);
          const sideways = await page
            .locator("html")
            .evaluate((html) => html.scrollWidth - html.clientWidth);
          expect(sideways).toBe(0);
          await page.screenshot({
            path: path.join(
              TASK_SCREENSHOTS,
              `initiative-decision-card-${colorScheme}-${width}.png`,
            ),
          });
        }
      }
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1600, height: 900 });

      // The Needs you panel lists it under the Initiative's title and Project, linking to the Thread.
      await page.goto("/projects");
      await page
        .getByRole("status", { name: "Status strip" })
        .getByRole("button", { name: /needs? you/ })
        .click();
      const panel = page.getByRole("dialog").filter({ hasText: "Needs you" });
      const inPanel = panel.locator('[aria-label="Decision on Quarterly report exports"]');
      await expect(inPanel.locator("a.needs-you-title")).toHaveText("Quarterly report exports");
      await expect(inPanel.locator("a.needs-you-title")).toHaveAttribute("href", threadUrl);
      await expect(inPanel.locator(".needs-you-heading .project-chip")).toContainText(
        "Quarterly reports",
      );
      await expect(
        inPanel.getByRole("region", { name: /^Decision: Which format should the quarterly/ }),
      ).toBeVisible();
      await screenshotScenario(page, "needs-you-initiative-decision", { inView: inPanel });
      await panel.getByRole("button", { name: "Close" }).click();
      await expect(panel).toHaveCount(0);

      // So does Now, whose title link opens the Thread at the card.
      await page.goto("/now");
      const onNow = page
        .getByRole("region", { name: "Needs you" })
        .locator('[aria-label="Decision on Quarterly report exports"]');
      await expect(onNow.locator(".needs-you-heading .project-chip")).toContainText(
        "Quarterly reports",
      );
      await onNow.locator("a.needs-you-title").click();
      await expect(page).toHaveURL(new RegExp(`/work/initiatives/${initiative.id}\\?`));
      await expect(card).toBeInViewport();

      // Submitted, it is answered in the Thread, leaves Needs you and handles the Notification, and
      // reaches Bob as his next message, which he answers.
      await card
        .getByRole("group", { name: "Question 1" })
        .getByRole("radio", { name: "PDF", exact: true })
        .check();
      await card.getByRole("button", { name: "Submit", exact: true }).click();
      // Answered, it shows what became of it, whole, no longer a card a link lands on.
      const answered = conversation.getByRole("region", {
        name: `Decision: ${REPORT_FORMAT_QUESTION} (and 1 more question)`,
      });
      await expect(answered.locator(".decision-answered")).toHaveText("Answered by you");
      await expect(answered).toContainText("PDF");
      await expect(answered).toContainText("Every quarter");
      await expect(
        conversation.getByText("A PDF every quarter: I'll write the outcome that way."),
      ).toBeVisible();
      await expect.poll(() => openDecisionAsking(page, REPORT_FORMAT_QUESTION)).toBeUndefined();
      await expect.poll(notificationOf).toBeUndefined();
      await page.goto("/now");
      await expect(
        page
          .getByRole("region", { name: "Needs you" })
          .locator('[aria-label="Decision on Quarterly report exports"]'),
      ).toHaveCount(0);

      // Nothing of it is left to weigh on the next tests: the Initiative is dropped with its Task.
      expect((await page.request.post(`/api/initiatives/${initiative.id}/drop`)).ok()).toBe(true);
      await expect
        .poll(
          async () =>
            taskSchema.parse(await (await page.request.get(`/api/tasks/${task.id}`)).json()).state,
        )
        .toBe("dropped");
    } finally {
      await repository.remove();
    }
  },
);

/** The Tasks the scripted Planner asks about by id, beside a Decision on the whole Initiative. */
const ARCHIVE_STORE_TASK = "8e2f4c0a-3d5b-4f9c-b6e7-1a2b3c4d5e01";
const ARCHIVE_PAGE_TASK = "8e2f4c0a-3d5b-4f9c-b6e7-1a2b3c4d5e02";
const ARCHIVE_SCOPE_QUESTION = "Should the archive take reports from before this year?";

// The engine replays the next two sessions in e2e/sessions.jsonl: Bob's on the Initiative's
// shaping Thread, then Jan's, who opens a Decision on each of the two Tasks by their ids and one on
// no Task, about the Initiative as a whole, and ends his turn.
test(
  "in the planning Thread Jan asks about the whole Initiative beside his Decisions on its Tasks",
  { tag: "@full" },
  async ({ page }) => {
    const repository = await createTemporaryRepository();
    try {
      const project = await addedProject(page, repository, "Report archive", "RA");
      const idea = ideaSchema.parse(
        await (
          await page.request.post("/api/ideas", {
            data: { title: "Report archive", notes: "", projectId: null },
          })
        ).json(),
      );
      const initiative = initiativeSchema.parse(
        await (await page.request.post(`/api/ideas/${idea.id}/initiative`)).json(),
      );
      const add = async (title: string) =>
        taskSchema.parse(
          await (
            await page.request.post(`/api/initiatives/${initiative.id}/tasks`, {
              data: { title, projectId: project.id, priority: "normal", blockedBy: [] },
            })
          ).json(),
        );
      const store = await add("Archive store");
      const archivePage = await add("Archive page");
      expect((await page.request.post(`/api/initiatives/${initiative.id}/confirm`)).ok()).toBe(
        true,
      );
      await giveTasksFixedIds([store.id, ARCHIVE_STORE_TASK], [archivePage.id, ARCHIVE_PAGE_TASK]);

      const initiativeUrl = `/work/initiatives/${initiative.id}`;
      await page.goto(initiativeUrl);
      await page.getByRole("button", { name: "Plan the Initiative" }).click();
      await expect.poll(() => openDecisionAsking(page, ARCHIVE_SCOPE_QUESTION)).toBeTruthy();
      const { planningThreadId } = initiativeSchema.parse(
        await (await page.request.get(`/api/initiatives/${initiative.id}`)).json(),
      );
      const inThread = async () =>
        decisionListSchema
          .parse(await (await page.request.get("/api/decisions/open")).json())
          .filter(({ threadId }) => threadId === planningThreadId)
          .map(({ taskId }) => taskId);
      await expect
        .poll(inThread)
        .toEqual(expect.arrayContaining([ARCHIVE_STORE_TASK, ARCHIVE_PAGE_TASK, null]));

      await page.goto(`${initiativeUrl}?initiativeThread=${planningThreadId}`);
      const conversation = page.getByRole("complementary", { name: "Conversation" });
      await expect(
        conversation.getByText(
          "Both Tasks wait for your answers, and I asked one thing about the whole Initiative.",
        ),
      ).toBeVisible();
      // The one on no Task is the whole form, answered here; each on a Task names it and leads to
      // its card.
      const onTheInitiative = conversation.getByRole("region", {
        name: `Decision: ${ARCHIVE_SCOPE_QUESTION}`,
      });
      await expect(onTheInitiative.locator(".decision-on-task")).toHaveText(
        "On no Task: about the Initiative as a whole",
      );
      await expect(
        onTheInitiative.getByRole("button", { name: "Submit", exact: true }),
      ).toBeVisible();
      for (const [question, title] of [
        ["Where should archived reports be kept?", "Archive store"],
        ["Should the archive page search inside reports?", "Archive page"],
      ] as const) {
        const onTask = conversation.getByRole("region", { name: `Decision: ${question}` });
        await expect(onTask.locator(".decision-on-task")).toContainText(title);
        await expect(onTask).toContainText("Waits on you.");
        await expect(onTask.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
      }

      // Now lists it under the Initiative beside those under their Tasks.
      await page.goto("/now");
      const needsYou = page.getByRole("region", { name: "Needs you" });
      await expect(needsYou.locator('[aria-label="Decision on Report archive"]')).toBeVisible();
      await expect(needsYou.locator('[aria-label="Decision on Archive store"]')).toBeVisible();
      await expect(needsYou.locator('[aria-label="Decision on Archive page"]')).toBeVisible();

      // Nothing of it is left to weigh on the next tests: dropped with its Tasks, the Initiative
      // closes every Decision in its planning Thread.
      expect((await page.request.post(`/api/initiatives/${initiative.id}/drop`)).ok()).toBe(true);
      await expect.poll(inThread).toEqual([]);
    } finally {
      await repository.remove();
    }
  },
);

test.describe("the Live view's comings and goings", { tag: "@full" }, () => {
  // A zone with no place keeps noon's light, so nobody has gone home whatever the runner's clock says.
  test.use({ timezoneId: "Etc/UTC" });

  test("in the Live view a hire walks in through the door and someone let go walks out; under reduced motion a hire is simply there", async ({
    page,
  }) => {
    const { card: developer } = roleSchema.parse(
      await (await page.request.get("/api/roles/developer")).json(),
    );
    const hire = async (name: string, title: string): Promise<string> => {
      const hired = await page.request.post("/api/roles", {
        data: { card: { ...developer, name, title, skills: [] } },
      });
      expect(hired.status()).toBe(201);
      return roleSchema.parse(await hired.json()).key;
    };
    const nameplate = (name: string) => page.locator(".live-nameplate").filter({ hasText: name });
    const placeOf = async (name: string): Promise<string | null> => {
      const box = await nameplate(name).boundingBox();
      return box ? `${Math.round(box.x)},${Math.round(box.y)}` : null;
    };
    /** Polls until two samples a few hundred milliseconds apart are the same. */
    const settles = async (name: string): Promise<void> => {
      let last: string | null = null;
      await expect
        .poll(
          async () => {
            const now = await placeOf(name);
            const still = now !== null && now === last;
            last = now;
            return still;
          },
          { intervals: [400], timeout: 30_000 },
        )
        .toBe(true);
    };

    await page.goto("/live-view");
    await expect(page.getByRole("img", { name: /\d+ (person|people): / })).toBeVisible();
    await expect(page.locator(".live-nameplate").first()).toBeVisible();

    // A hire comes in through the door and walks to their new desk.
    const walker = await hire("Wanda", "Courier");
    await expect(nameplate("Wanda")).toBeVisible({ timeout: 15_000 });
    const cameIn = await placeOf("Wanda");
    await expect.poll(() => placeOf("Wanda")).not.toBe(cameIn);
    await settles("Wanda");

    // Let go, they walk out at once and are gone.
    const atDesk = await placeOf("Wanda");
    expect((await page.request.post(`/api/roles/${walker}/let-go`)).status()).toBe(201);
    await expect.poll(() => placeOf("Wanda")).not.toBe(atDesk);
    await expect(nameplate("Wanda")).toHaveCount(0, { timeout: 30_000 });

    // Under reduced motion every move is a jump: a hire is at their desk the moment they show.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await hire("Rory", "Stillwater");
    await expect(nameplate("Rory")).toBeVisible({ timeout: 15_000 });
    const placed = await placeOf("Rory");
    // Watched over time on purpose: a walk would have moved it a tile in under half a second.
    for (let sample = 0; sample < 4; sample++) {
      await page.waitForTimeout(400);
      expect(await placeOf("Rory")).toBe(placed);
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });
});

// The engine replays the last two sessions in e2e/sessions.jsonl: Implement's turn refused on the
// first engine, its 5-hour window used up (reset a few seconds on, so later files find it free),
// then the same session resumed on the Stand-in Engine, where it holds at a mark mid-turn and then
// does the work.
test.describe("a Stage on a Stand-in Engine", { tag: "@full" }, () => {
  // A zone with no place keeps noon's light in the Live view.
  test.use({ timezoneId: "Etc/UTC" });

  test("a Stage refused for a used-up usage window goes on on a Stand-in Engine in the same run, and its Stage history says so", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const standInName = "Stand-in account";
    const repository = await createTemporaryRepository();
    try {
      await saveEngines(page, (engines) => [
        ...engines,
        {
          kind: "claude-code",
          name: standInName,
          defaultModel: "claude-sonnet-5-5",
          claudeCodeP: false,
        },
      ]);
      const settings = engineSettingsSchema.parse(
        await (await page.request.get("/api/settings/engines")).json(),
      );
      const standInId = await engineIdOf(page, standInName);
      const engineName = settings.engines.find(({ id }) => id === "claude-code")?.name ?? "";
      expect(engineName).not.toBe("");
      const standIns = await page.request.put("/api/settings/engines", {
        data: {
          ...settings,
          engines: settings.engines.map((engine) =>
            engine.kind === "claude-code" ? engine : { ...engine, keySet: undefined },
          ),
          standInEngines: [standInId],
        },
      });
      expect(standIns.ok()).toBe(true);

      const project = await addedProject(page, repository, "Sorted export", "SE", PASSING_COMMANDS);
      const title = "Sorted export keeps its sort order";
      const taskId = await readyTask(page, project.id, title);
      const library = pipelineListSchema.parse(
        await (await page.request.get("/api/pipelines")).json(),
      );
      const implementOnly = asStageList(
        (library.find(({ id }) => id === "quick-fix")?.stages ?? []).filter(
          ({ key }) => key === "implement",
        ),
      );
      const edited = await page.request.put(`/api/tasks/${taskId}/stages`, {
        data: { stages: implementOnly },
      });
      expect(edited.status()).toBe(200);
      await page.goto(`/tasks/${taskId}`);
      await page.getByRole("button", { name: "Start", exact: true }).click();

      // The Task goes on Running on the stand-in, never paused, and its head names it as it happens.
      const head = page.locator(".task-head");
      await expect(
        head.getByText(`On a Stand-in Engine: ${standInName} for ${engineName}`),
      ).toBeVisible({
        timeout: 30_000,
      });
      const running = taskSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}`)).json(),
      );
      expect(running).toMatchObject({ state: "in-progress", pausedBy: null });
      expect(running.engineStandIns).toMatchObject([{ engineId: "claude-code", standInId }]);
      await screenshotScenario(page, "stand-in-switch-task-page");

      // The run's head names the stand-in, and its Summary says why the Stage went on there.
      const switchWords = new RegExp(
        `^ ?${engineName}'s 5-hour window was used up until \\d\\d:\\d\\d, so the Stage went on on ${standInName}$`,
      );
      const rail = page.getByRole("region", { name: /^Pipeline · / });
      await rail.getByRole("button", { name: "Implement", exact: true }).click();
      const history = page.getByRole("dialog", { name: /^Stage history: Implement/ });
      const run = history.getByRole("region", { name: "Run 1" });
      await expect(run.locator(".run-details-head")).toContainText(`on ${standInName}`);
      await expect(run.locator(".run-details-head")).toContainText(`Stand-in for ${engineName}`);
      await history.getByRole("tab", { name: "Thread" }).click();
      await expect(run.locator(".message-office").filter({ hasText: switchWords })).toBeVisible();
      await history.getByRole("tab", { name: "Summary" }).click();
      await expect(run.locator(".run-engine-switch")).toHaveText(switchWords);
      await screenshotScenario(page, "stand-in-switch-stage-history");
      await page.keyboard.press("Escape");

      // The Live view says Ada works on the stand-in, standing in for the first engine.
      await page.goto("/live-view");
      await page.getByRole("button", { name: "List" }).click();
      await expect(
        page.getByRole("complementary", { name: "People" }).getByRole("link", {
          name: new RegExp(`on ${standInName}, standing in for ${engineName}$`),
        }),
      ).toBeVisible();

      // Let the stand-in's turn end: the Stage is done in the run the refusal came in.
      expect((await page.request.post("/api/e2e/marks/stand-in-turn-ends")).status()).toBe(204);
      await page.goto(`/tasks/${taskId}`);
      await expect(head.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
      const stages = taskStagesSchema.parse(
        await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
      );
      const [implement] = stages.stages ?? [];
      expect(implement?.runs).toHaveLength(1);
      expect(implement?.runs[0]).toMatchObject({
        outcome: { status: "done" },
        engine: { engineId: standInId, standInFor: { engineId: "claude-code" } },
        engineSwitches: [{ fromEngineId: "claude-code", toEngineId: standInId }],
      });
    } finally {
      await removeEngine(page, standInName);
      await repository.remove();
    }
  });

  // The engine replays the next four sessions in e2e/sessions.jsonl: each Task's Implement holds at
  // a mark, then its first turn is refused for a used-up 5-hour window (reset a minute on), its
  // context over the size Settings › Engines asks first above; then each Stage, once switched, opens
  // again on the Stand-in Engine and does the work.
  test("Stages over the size asked first above wait in one Decision in Needs you, and Switch now moves one to a Stand-in Engine", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const standInName = "Stand-in for choices";
    const repository = await createTemporaryRepository();
    const taskLimit = await setDevelopersTaskLimit(page, 3);
    let resetsAt: string | undefined;
    const { askBeforeSwitchAbove } = engineSettingsSchema.parse(
      await (await page.request.get("/api/settings/engines")).json(),
    );
    try {
      await saveEngines(page, (engines) => [
        ...engines,
        {
          kind: "claude-code",
          name: standInName,
          defaultModel: "claude-sonnet-5-5",
          claudeCodeP: false,
        },
      ]);
      const settings = engineSettingsSchema.parse(
        await (await page.request.get("/api/settings/engines")).json(),
      );
      const standInId = await engineIdOf(page, standInName);
      const engineName = settings.engines.find(({ id }) => id === "claude-code")?.name ?? "";
      expect(engineName).not.toBe("");
      // The scripted sessions' context is 30,100 tokens, over the 20,000 asked first above.
      const standIns = await page.request.put("/api/settings/engines", {
        data: {
          ...settings,
          engines: settings.engines.map((engine) =>
            engine.kind === "claude-code" ? engine : { ...engine, keySet: undefined },
          ),
          standInEngines: [standInId],
          askBeforeSwitchAbove: 20_000,
        },
      });
      expect(standIns.ok()).toBe(true);

      const project = await addedProject(
        page,
        repository,
        "Choice exports",
        "CE",
        PASSING_COMMANDS,
      );
      // Both Tasks are started at once.
      const roomy = await page.request.put(`/api/projects/${project.id}/project-limit`, {
        data: { projectLimit: 2 },
      });
      expect(roomy.status()).toBe(200);
      const library = pipelineListSchema.parse(
        await (await page.request.get("/api/pipelines")).json(),
      );
      const implementOnly = asStageList(
        (library.find(({ id }) => id === "quick-fix")?.stages ?? []).filter(
          ({ key }) => key === "implement",
        ),
      );
      const titles = ["Choice exports keep their columns", "Choice exports keep their totals"];
      const taskIds: string[] = [];
      for (const title of titles) {
        const taskId = await readyTask(page, project.id, title);
        const edited = await page.request.put(`/api/tasks/${taskId}/stages`, {
          data: { stages: implementOnly },
        });
        expect(edited.status()).toBe(200);
        await page.goto(`/tasks/${taskId}`);
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await expect
          .poll(
            async () =>
              taskSchema.parse(await (await page.request.get(`/api/tasks/${taskId}`)).json()).state,
            { timeout: 30_000 },
          )
          .toBe("in-progress");
        taskIds.push(taskId);
      }
      // Both sessions open on the first engine before either turn is refused: the mark is reached
      // again until both sessions passed it, as it reaches only the sessions open by then.
      await expect
        .poll(
          async () => {
            const reached = await page.request.post("/api/e2e/marks/stand-in-choices-refused");
            expect(reached.status()).toBe(204);
            return standInChoicesResponseSchema.parse(
              await (await page.request.get("/api/stand-in-choices")).json(),
            ).choices.length;
          },
          { timeout: 30_000 },
        )
        .toBe(2);

      // One card in Needs you, a row per Stage, each with Switch now, and Switch all now.
      await page.goto("/now");
      const decision = page.locator("section.stand-in-choice");
      const rows = decision.locator(".stand-in-choice-rows > li");
      await expect(decision).toHaveCount(1, { timeout: 30_000 });
      await expect(rows).toHaveCount(2, { timeout: 30_000 });
      await expect(
        page.getByText("Decision: switch Stages to a Stand-in Engine", { exact: true }),
      ).toHaveCount(1);
      await expect(decision).toContainText(
        "Their context is over the 20,000 tokens set in Settings › Engines",
      );
      for (const title of titles) {
        const row = decision.getByRole("listitem", { name: `Implement · ${title}` });
        await expect(row).toContainText(`${engineName} ran out; resets at`);
        await expect(row).toContainText(`Moves to ${standInName}`);
        await expect(row.getByRole("button", { name: "Switch now" })).toBeEnabled();
      }
      await expect(decision.getByRole("button", { name: "Switch all now" })).toBeEnabled();
      const choices = standInChoicesResponseSchema.parse(
        await (await page.request.get("/api/stand-in-choices")).json(),
      ).choices;
      expect(choices).toHaveLength(2);
      resetsAt = choices[0]?.resetsAt;
      for (const taskId of taskIds) {
        const paused = taskSchema.parse(
          await (await page.request.get(`/api/tasks/${taskId}`)).json(),
        );
        expect(paused.state).toBe("paused");
      }
      await screenshotScenario(page, "stand-in-choice-needs-you");

      // Switch now on the first Task's Stage: it goes on on the Stand-in Engine, one row is left.
      const [switchedId, waitingId] = taskIds as [string, string];
      const switched = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/stand-in-choices/switch") &&
          response.request().method() === "POST",
      );
      await decision
        .getByRole("listitem", { name: `Implement · ${titles[0]}` })
        .getByRole("button", { name: "Switch now" })
        .click();
      const answered = standInSwitchResponseSchema.parse(await (await switched).json());
      expect(answered.results).toMatchObject([
        { outcome: "switched", words: `It goes on on ${standInName}.` },
      ]);
      await expect(rows).toHaveCount(1);
      await expect(
        decision.getByRole("listitem", { name: `Implement · ${titles[1]}` }),
      ).toBeVisible();
      await expect(decision.getByRole("button", { name: "Switch all now" })).toHaveCount(0);
      await expect(decision).toContainText("Its context is over the 20,000 tokens");
      await screenshotScenario(page, "stand-in-choice-one-left");

      const doneOnStandIn = async (taskId: string) => {
        await expect
          .poll(
            async () =>
              taskSchema.parse(await (await page.request.get(`/api/tasks/${taskId}`)).json()).state,
            { timeout: 60_000 },
          )
          .toBe("done");
        const stages = taskStagesSchema.parse(
          await (await page.request.get(`/api/tasks/${taskId}/stages`)).json(),
        );
        const implement = stages.stages?.[0];
        expect(implement?.runs.at(-1)).toMatchObject({
          outcome: { status: "done" },
          engine: { engineId: standInId, standInFor: { engineId: "claude-code" } },
        });
      };
      await doneOnStandIn(switchedId);
      // The other still waits for the user's choice, Paused.
      const left = standInChoicesResponseSchema.parse(
        await (await page.request.get("/api/stand-in-choices")).json(),
      ).choices;
      expect(left.map(({ taskId }) => taskId)).toEqual([waitingId]);
      expect(
        taskSchema.parse(await (await page.request.get(`/api/tasks/${waitingId}`)).json()).state,
      ).toBe("paused");

      // Switched too, so nothing is left waiting for the reset.
      await decision.getByRole("button", { name: "Switch now" }).click();
      await expect(decision).toHaveCount(0);
      await doneOnStandIn(waitingId);
    } finally {
      // Later files find the first engine's window free again.
      if (resetsAt !== undefined) {
        const left = Date.parse(resetsAt) - Date.now();
        if (left > 0) await page.waitForTimeout(left + 2_000);
      }
      await removeEngine(page, standInName);
      const saved = engineSettingsSchema.parse(
        await (await page.request.get("/api/settings/engines")).json(),
      );
      const restored = await page.request.put("/api/settings/engines", {
        data: {
          ...saved,
          engines: saved.engines.map((engine) =>
            engine.kind === "claude-code" ? engine : { ...engine, keySet: undefined },
          ),
          askBeforeSwitchAbove,
        },
      });
      expect(restored.ok()).toBe(true);
      await setDevelopersTaskLimit(page, taskLimit);
      await repository.remove();
    }
  });
});
