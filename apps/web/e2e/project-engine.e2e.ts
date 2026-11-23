import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  projectSchema,
  roleSchema,
  taskSchema,
  type NewProject,
  type Project,
  type Task,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

// A Project's Engine card (spec §5.4.5; screens/project-page.md "Engine"), and where the Role card
// and the Task page's Runs on say a model and effort come from. Only the Caretaker is sure to be
// hired in a file run alone (hiring is people.e2e.ts's), so the person set here is the Caretaker,
// and the Task's one Stage names them. Only the fresh Office's own Claude Code engine is named: a
// Settings › Engines Save sends every engine, so engines are added only in people.e2e.ts. Nothing
// here opens a session.

const CARETAKER = "caretaker";

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

/** A word no other test's records hold, so names stay apart across files run in parallel. */
function aWordOfItsOwn(): string {
  return `w${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Adds a Project through the API, on the Office default, with nothing set for its people. */
async function addedProject(page: Page, name: string): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "PE", colour: "teal" },
    installCommand: "npm ci",
    commands: [
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

/**
 * A Task in Backlog on the full Pipeline whose own Stages are one the Caretaker works, so its Runs
 * on names them (beside whoever plans, when someone is hired to).
 */
async function caretakersTask(page: Page, project: Project, title: string): Promise<Task> {
  const response = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  expect(response.status()).toBe(201);
  const task = taskSchema.parse(await response.json());
  const piped = await page.request.put(`/api/tasks/${task.id}/pipeline`, {
    data: { pipelineId: "full" },
  });
  expect(piped.status()).toBe(200);
  await queryOfficeDatabase(
    `insert into task_stages (task_id, pipeline_id, stages, made_at) values ($1, 'full', $2, now())`,
    [
      task.id,
      JSON.stringify([
        {
          kind: "agent",
          key: "implement",
          name: "Implement",
          optional: false,
          role: CARETAKER,
          brief: "Implement the Plan.",
          session: "fresh",
          budget: 100000,
        },
      ]),
    ],
  );
  return task;
}

/** The Caretaker's line in the Task page's Runs on, its Engine fold unfolded. */
async function caretakerRunsOn(page: Page, task: Task, name: string): Promise<Locator> {
  await page.goto(`/tasks/${task.id}`);
  const fold = page.getByRole("region", { name: "Engine", exact: true });
  const head = fold.getByRole("button", { name: /^Engine/ });
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  return fold
    .getByRole("list", { name: "Runs on" })
    .getByRole("listitem")
    .filter({ hasText: name });
}

/** The Caretaker's Role card's line for the Project, among the Projects where something else applies. */
async function roleCardLine(page: Page, project: Project): Promise<Locator> {
  await page.goto(`/people/${CARETAKER}/role`);
  return page
    .getByRole("region", { name: "Engine" })
    .getByRole("listitem")
    .filter({ hasText: `In ${project.name}:` });
}

test(
  "the user sets a Project's engine type and account, forces a model and effort, and gives a person their own, and the Role card and Runs on say where each comes from",
  { tag: "@full" },
  async ({ page }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Engine card shop ${word}`);
    const task = await caretakersTask(page, project, `Engine card export ${word}`);
    const { card } = roleSchema.parse(
      await (await page.request.get(`/api/roles/${CARETAKER}`)).json(),
    );
    const name = card.name;
    try {
      await page.goto(`/projects/${project.id}/engine`);
      const where = page.getByRole("region", { name: "Where sessions run" });
      const forEveryone = page.getByRole("region", { name: "Model and effort for everyone" });
      const perPerson = page.getByRole("region", { name: "Model and effort per person" });
      const projectDefault = where.getByRole("group", { name: "Project default" });
      const engineType = projectDefault.getByRole("combobox", { name: "Engine type" });
      const account = projectDefault.getByRole("combobox", { name: "Account" });
      // The design system's Switch names no switch by its label and marks one held off only by
      // leaving it out of the tab order, so it is the group's one switch, read by its tabindex.
      const force = forEveryone.getByRole("switch");

      // A new Project runs on the Office default, so the force waits for a type of its own.
      await expect(engineType.locator("option:checked")).toHaveText(
        "Office's default (Claude Code)",
      );
      await expect(account).toBeDisabled();
      await expect(force).toHaveAttribute("tabindex", "-1");
      await expect(forEveryone).toContainText("Pick an engine type first.");
      await expect(perPerson).toContainText(
        "Nobody has a setting of their own here, so each person works with their Role card's.",
      );

      // Picking a type picks its first account.
      await engineType.selectOption({ label: "Claude Code" });
      await expect(page.getByText(`${project.name} runs on Claude Code by default.`)).toBeVisible();
      await expect(account).toBeEnabled();
      await expect(account).toHaveValue("claude-code");

      // The force starts on each engine's default, then takes a model and an effort.
      await force.click();
      await expect(force).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByText(
          `Everyone in ${project.name} works with Engine's default · Engine's default on Claude Code.`,
        ),
      ).toBeVisible();
      await forEveryone.getByLabel("Model").selectOption({ label: "Haiku 5.5" });
      await expect(forEveryone.getByLabel("Model")).toHaveValue("claude-haiku-5-5");
      await forEveryone.getByLabel("Effort").selectOption({ label: "Low" });
      await expect(
        page.getByText(`Everyone in ${project.name} works with Haiku 5.5 · Low on Claude Code.`),
      ).toBeVisible();
      await expect(forEveryone).toContainText("Only for sessions on Claude Code");

      // Kept on a reload.
      await page.reload();
      await expect(account).toHaveValue("claude-code");
      await expect(force).toHaveAttribute("aria-checked", "true");
      await expect(forEveryone.getByLabel("Model")).toHaveValue("claude-haiku-5-5");
      await expect(forEveryone.getByLabel("Effort")).toHaveValue("low");
      expect(
        projectSchema.parse(await (await page.request.get(`/api/projects/${project.id}`)).json())
          .engine,
      ).toEqual({
        default: { engineType: "claude-code", engineId: "claude-code" },
        force: { model: "claude-haiku-5-5", effort: "low" },
        people: [],
        standIns: { useOwnList: false, engineIds: [] },
      });

      // The Role card and the Task's Runs on say the force gives it.
      await expect(await roleCardLine(page, project)).toHaveText(
        `In ${project.name}: Haiku 5.5 · effort low on Claude Code, forced by the Project`,
      );
      const forcedRow = await caretakerRunsOn(page, task, name);
      await expect(forcedRow).toContainText("Haiku 5.5 · effort low");
      await expect(forcedRow).toContainText("forced by the Project");

      // A person of their own: the Add a person window, the forced type dimmed under the force.
      await page.goto(`/projects/${project.id}/engine`);
      await perPerson.getByRole("button", { name: "Add a person" }).click();
      const adding = page.getByRole("dialog", {
        name: `Model and effort for a person in ${project.name}`,
      });
      const add = adding.getByRole("button", { name: "Add", exact: true });
      await expect(add).toBeDisabled();
      await adding.getByLabel("Person").selectOption({ label: `${name} · ${card.title}` });
      const claudeCode = adding.getByRole("group", { name: "Claude Code", exact: true });
      await expect(claudeCode).toContainText("Role card:");
      await expect(claudeCode).toContainText(
        "Forced above: Haiku 5.5 · Low wins while the force is on.",
      );
      // Nothing set yet, so there is nothing to add.
      await expect(add).toBeDisabled();
      await claudeCode.getByLabel("Model").selectOption({ label: "Opus 5.5" });
      await claudeCode.getByLabel("Effort").selectOption({ label: "Medium" });
      await add.click();
      await expect(adding).toHaveCount(0);
      await expect(
        page.getByText(`${name} has their own model and effort in ${project.name}.`),
      ).toBeVisible();
      const row = perPerson.getByRole("row").filter({ hasText: `${name} · ${card.title}` });
      await expect(row).toContainText("Opus 5.5 · Medium");
      await expect(perPerson.getByRole("columnheader", { name: /Claude Code/ })).toContainText(
        "Forced above",
      );

      // The force still wins over the person's own setting.
      await expect(await roleCardLine(page, project)).toContainText("forced by the Project");

      // Off, the person's own setting here gives it.
      await page.goto(`/projects/${project.id}/engine`);
      await force.click();
      await expect(force).toHaveAttribute("aria-checked", "false");
      await expect(
        page.getByText(`People in ${project.name} work with their own settings again.`),
      ).toBeVisible();
      await expect(perPerson.getByRole("columnheader", { name: /Claude Code/ })).not.toContainText(
        "Forced above",
      );
      await expect(await roleCardLine(page, project)).toHaveText(
        `In ${project.name}: Opus 5.5 · effort medium on Claude Code, from the Project's setting for ${name}`,
      );
      const ownRow = await caretakerRunsOn(page, task, name);
      await expect(ownRow).toContainText("Opus 5.5 · effort medium");
      await expect(ownRow).toContainText(`from the Project's setting for ${name}`);

      // Edit: the window opens on what is set; the effort back to the person's setting.
      await page.goto(`/projects/${project.id}/engine`);
      await row.getByRole("button", { name: `Edit ${name}` }).click();
      const editing = page.getByRole("dialog", {
        name: `${name}'s model and effort in ${project.name}`,
      });
      const editedType = editing.getByRole("group", { name: "Claude Code", exact: true });
      await expect(editing.getByLabel("Person")).toHaveCount(0);
      await expect(editedType.getByLabel("Model")).toHaveValue("claude-opus-5-5");
      await expect(editedType.getByLabel("Effort")).toHaveValue("medium");
      await editedType.getByLabel("Model").selectOption({ label: "Sonnet 5.5" });
      await editedType.getByLabel("Effort").selectOption({ label: "Person's setting" });
      await editing.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editing).toHaveCount(0);
      await expect(
        page.getByText(`${name}'s model and effort in ${project.name} are saved.`),
      ).toBeVisible();
      await expect(row).toContainText("Sonnet 5.5 · Person's setting");
      expect(
        projectSchema.parse(await (await page.request.get(`/api/projects/${project.id}`)).json())
          .engine.people,
      ).toEqual([
        {
          roleKey: CARETAKER,
          engineSettings: { "claude-code": { model: "claude-sonnet-5-5", effort: null } },
        },
      ]);

      // Remove asks first; then the person works with their Role card here again.
      await row.getByRole("button", { name: `Remove ${name}` }).click();
      const removing = page.getByRole("dialog", {
        name: `Remove ${name}'s settings in ${project.name}?`,
      });
      await expect(removing).toContainText(
        "They work with their Role card's model and effort here again.",
      );
      await removing.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(removing).toHaveCount(0);
      await expect(
        page.getByText(`${name}'s model and effort in ${project.name} are removed.`),
      ).toBeVisible();
      await expect(perPerson.getByRole("table")).toHaveCount(0);
      await expect(perPerson).toContainText("Nobody has a setting of their own here");

      // The Project's engine is the Office's own, so nothing else applies there any more.
      await expect(await roleCardLine(page, project)).toHaveCount(0);
      const cardRow = await caretakerRunsOn(page, task, name);
      await expect(cardRow).toContainText(/Role card|engine's default/);
      await expect(cardRow).not.toContainText("Project");
    } finally {
      await page.request.put(`/api/projects/${project.id}/engine`, {
        data: { default: null, force: null, people: [] },
      });
    }
  },
);

test(
  "the user turns on a Project's own Stand-in Engines, adds one and goes back to the Office's list, greyed out",
  { tag: "@full" },
  async ({ page }) => {
    const word = aWordOfItsOwn();
    const project = await addedProject(page, `Stand-in shop ${word}`);
    const officeList = (
      (await (await page.request.get("/api/settings/engines")).json()) as {
        readonly standInEngines: readonly string[];
      }
    ).standInEngines;
    try {
      await page.goto(`/projects/${project.id}/engine`);
      const standIns = page.getByRole("region", { name: "Stand-in Engines" });
      // The group's one switch, as the force's is (see above).
      const ownList = standIns.getByRole("switch");
      const rows = standIns.getByRole("list", { name: "Stand-in Engines" }).getByRole("listitem");

      // Off: the Office's list under its link, read-only.
      await expect(ownList).toHaveAttribute("aria-checked", "false");
      await expect(standIns.getByRole("link", { name: "From Settings › Engines" })).toHaveAttribute(
        "href",
        "/settings/engines",
      );
      if (officeList.length === 0) {
        await expect(standIns).toContainText("The Office has no Stand-in Engine.");
      } else {
        await expect(rows).toHaveCount(officeList.length);
      }
      await expect(standIns.getByLabel("Add a stand-in")).toHaveCount(0);
      await screenshotScenario(page, "project-engine-stand-ins-office", { inView: standIns });

      // On: the Project's own list, empty at first, then a stand-in added.
      await ownList.click();
      await expect(page.getByText(`${project.name} uses its own Stand-in Engines.`)).toBeVisible();
      await expect(ownList).toHaveAttribute("aria-checked", "true");
      await expect(standIns).toContainText(
        `No Stand-in Engine in ${project.name}, so its work waits for its own engine's usage window to free up.`,
      );
      const add = standIns.getByLabel("Add a stand-in");
      await add.selectOption({ index: 1 });
      await expect(rows).toHaveCount(1);
      const added = projectSchema.parse(
        await (await page.request.get(`/api/projects/${project.id}`)).json(),
      ).engine.standIns;
      expect(added.useOwnList).toBe(true);
      expect(added.engineIds).toHaveLength(1);
      await expect(
        standIns.getByRole("button", { name: /Remove .* from the Stand-in Engines/ }),
      ).toBeEnabled();
      await screenshotScenario(page, "project-engine-stand-ins-own", { inView: standIns });

      // Kept on a reload.
      await page.reload();
      await expect(ownList).toHaveAttribute("aria-checked", "true");
      await expect(rows).toHaveCount(1);

      // Off again: the Office's list, greyed out; the Project's list kept for next time.
      await ownList.click();
      await expect(
        page.getByText(`${project.name} uses the Office's Stand-in Engines again.`),
      ).toBeVisible();
      await expect(standIns.getByLabel("Add a stand-in")).toHaveCount(0);
      await expect(standIns.getByRole("button", { name: /Remove/ })).toHaveCount(0);
      if (officeList.length > 0) {
        await expect(standIns.locator("ol[data-read-only]")).toBeVisible();
      }
      expect(
        projectSchema.parse(await (await page.request.get(`/api/projects/${project.id}`)).json())
          .engine.standIns,
      ).toEqual({ useOwnList: false, engineIds: added.engineIds });
    } finally {
      await page.request.put(`/api/projects/${project.id}/engine`, {
        data: { standIns: { useOwnList: false, engineIds: [] } },
      });
    }
  },
);
