import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { projectSchema, type NewProject, type Project } from "@the-office/contracts";
import { NEWER_SUBJECTS } from "./office-checkout.ts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

// Long enough to outlast the test: the environment check it runs is the busy work the update waits for.
const SLOW_INSTALL = `node -e "setTimeout(() => {}, 600000)"`;

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

// The e2e service's checkout is two commits behind its upstream (office-checkout.ts). An update
// scheduled while nothing is busy would stop the service, so an environment check runs all along;
// meanwhile other files' Starts queue, and Cancel releases them.
test("Settings › Updates checks, schedules an update that waits for what is busy, and cancels it", async ({
  page,
}) => {
  const project = await slowProject(page);
  const started = await page.request.post(`/api/projects/${project.id}/environment-check`, {
    data: { environment: { set: [], unset: [], prependPath: [] } },
  });
  expect(started.ok()).toBe(true);

  await page.goto("/settings/updates");
  await expect(page.getByLabel("Current version")).toContainText("The version running");
  await page.getByRole("button", { name: "Check for updates" }).click();
  const available = page.getByRole("region", { name: "Update available" });
  await expect(available).toContainText("2 commits");
  await expect(available.getByRole("list", { name: "Commits behind" })).toContainText(
    NEWER_SUBJECTS[1],
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-settings-updates.png") });

  await available.getByRole("button", { name: "Update" }).click();
  const waitingFor = page.getByRole("list", { name: "What the update waits for" });
  await expect(waitingFor).toContainText(`The environment check of the Project "${project.name}"`);
  await expect(page.getByRole("status", { name: "Status strip" })).toContainText(
    "Update scheduled",
  );
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-settings-updates-scheduled.png"),
  });

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(waitingFor).toBeHidden();
  await expect(page.getByRole("status", { name: "Status strip" })).not.toContainText(
    "Update scheduled",
  );
  await expect(available.getByRole("button", { name: "Update" })).toBeVisible();
});

async function slowProject(page: Page): Promise<Project> {
  const newProject: NewProject = {
    name: `Updates ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "UP", colour: "teal" },
    installCommand: SLOW_INSTALL,
    commands: [
      { key: "build", name: "Build", kind: "build", commandLine: "node --version" },
      { key: "lint", name: "Lint", kind: "lint", commandLine: "node --version" },
      { key: "test", name: "Test", kind: "test", commandLine: "node --version" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}
