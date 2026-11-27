import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  activitySchema,
  projectSchema,
  type ActivityItem,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

/** A Task's screenshots for its review, kept by The Office across runs (git ignores it). */
const TASK_SCREENSHOTS = path.resolve(import.meta.dirname, "../../../.office/screenshots");

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

test("an environment check is followed from the strip's Activity figure to the Activity panel, marked New until seen", async ({
  page,
}) => {
  const project = await quickProject(page);
  const started = await page.request.post(`/api/projects/${project.id}/environment-check`);
  expect(started.ok()).toBe(true);
  // The check ends quickly; its ended item stays listed until the user has seen it.
  await expect
    .poll(async () => (await environmentCheckOf(page, project))?.ended, { timeout: 30_000 })
    .toBe(true);
  const ended = await environmentCheckOf(page, project);

  await page.goto("/now");
  // Only this Project's items, so what other tests leave running stays out.
  await page.getByRole("button", { name: /^Project filter:/ }).click();
  await page.getByRole("button", { name: `Show only ${project.name}` }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("status", { name: "Status strip" })
    .getByRole("button", { name: /^Activity: \d+ running, \d+ ended not yet seen$/ })
    .click();
  // A panel over the page, which stays where it was.
  await expect(page).toHaveURL(/\/now\?activity=true$/);
  const panel = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Activity", exact: true }) });
  await expect(panel).toBeVisible();

  const group = panel.getByRole("region", { name: "Off-board Tasks and environment checks" });
  const card = group.getByRole("article", { name: /: Environment check$/ });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("New", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: "Environment check" })).toHaveAttribute(
    "href",
    `/projects/${project.id}/environment`,
  );
  await expect(card).toContainText(/ for (<1 min|\d+ min)$/);
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "activity-panel.png") });

  // Seen after a second in view: the card stays for this visit, without its mark.
  await expect
    .poll(async () => (await activityIds(page)).includes(ended?.id ?? ""), { timeout: 30_000 })
    .toBe(false);
  await expect(card.getByText("New", { exact: true })).toHaveCount(0);
  await expect(card).toHaveCount(1);

  // The next visit leaves it out; Esc closes the panel, and the old address opens it again.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/now$/);
  await page.goto("/activity");
  await expect(page).toHaveURL(/\/now\?activity=true$/);
  // "…in these Projects." only while another test's Project has an item.
  await expect(panel.getByText(/^Nothing is running( in these Projects)?\.$/)).toBeVisible();
  await expect(group).toHaveCount(0);
});

async function environmentCheckOf(page: Page, project: Project): Promise<ActivityItem | undefined> {
  const response = await page.request.get("/api/activity");
  expect(response.ok()).toBe(true);
  return activitySchema
    .parse(await response.json())
    .items.find(({ kind, projectId }) => kind === "environment-check" && projectId === project.id);
}

async function activityIds(page: Page): Promise<readonly string[]> {
  const response = await page.request.get("/api/activity");
  return activitySchema.parse(await response.json()).items.map(({ id }) => id);
}

async function quickProject(page: Page): Promise<Project> {
  const quick = { commandLine: "node --version", rerunCommandLine: "" };
  const newProject: NewProject = {
    name: `Activity ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "AC", colour: "teal" },
    installCommand: "node --version",
    commands: [
      { key: "build", name: "Build", kind: "build", ...quick },
      { key: "lint", name: "Lint", kind: "lint", ...quick },
      { key: "test", name: "Test", kind: "test", ...quick },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}
