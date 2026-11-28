import { writeFile } from "node:fs/promises";
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

test("a running environment check is followed from the strip's Activity figure to the Activity panel and leaves when it ends", async ({
  page,
}) => {
  // The check's install waits for this file, so the check runs until the test lets it end.
  const release = path.join(repository.folder, "release-the-check");
  const project = await quickProject(page, release);
  const started = await page.request.post(`/api/projects/${project.id}/environment-check`);
  expect(started.ok()).toBe(true);

  await page.goto("/now");
  // Only this Project's items, so what other tests leave running stays out.
  await page.getByRole("button", { name: /^Project filter:/ }).click();
  await page.getByRole("button", { name: `Show only ${project.name}` }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("status", { name: "Status strip" })
    .getByRole("button", { name: /^Activity: \d+ sessions?, \d+ other running$/ })
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
  await expect(card.getByRole("link", { name: "Environment check" })).toHaveAttribute(
    "href",
    `/projects/${project.id}/environment`,
  );
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "activity-panel.png") });

  // Once the check ends, it is no longer listed.
  await writeFile(release, "");
  await expect
    .poll(async () => (await environmentCheckOf(page, project)) === undefined, { timeout: 30_000 })
    .toBe(true);
  await expect(card).toHaveCount(0);

  // Esc closes the panel, and the old address opens it again.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/now$/);
  await page.goto("/activity");
  await expect(page).toHaveURL(/\/now\?activity=true$/);
  await expect(group).toHaveCount(0);
});

async function environmentCheckOf(page: Page, project: Project): Promise<ActivityItem | undefined> {
  const response = await page.request.get("/api/activity");
  expect(response.ok()).toBe(true);
  return activitySchema
    .parse(await response.json())
    .otherWork.find(
      ({ kind, projectId }) => kind === "environment-check" && projectId === project.id,
    );
}

/** A Project whose install waits until `release` exists, and whose commands end at once. */
async function quickProject(page: Page, release: string): Promise<Project> {
  const quick = { commandLine: "node --version", rerunCommandLine: "" };
  // Forward slashes, which Node takes on Windows too, keep the path whole in the quoted script.
  const releasePath = release.replaceAll("\\", "/");
  const waitForRelease = `node -e "const wait = () => require('node:fs').existsSync('${releasePath}') || setTimeout(wait, 100); wait();"`;
  const newProject: NewProject = {
    name: `Activity ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "AC", colour: "teal" },
    installCommand: waitForRelease,
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
