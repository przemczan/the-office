import { expect, type Locator, type Page } from "@playwright/test";
import { projectSchema, type Project } from "@the-office/contracts";

/** Step 1 of Add a Project from a folder: its path, then Continue to step 2. */
export async function chooseFolder(page: Page, folder: string): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Repository folder").fill(folder);
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(sourceLine(page)).toContainText(folder);
}

/** Step 2's first line: where the repository is, with Change. */
export function sourceLine(page: Page): Locator {
  return page.getByRole("dialog").getByRole("group", { name: "Where it is" });
}

/** Steps 1 and 2 of Add a Project from a folder, with the same commands every time. */
export async function fillTheForm(
  page: Page,
  fields: { name: string; path: string; branch: string },
): Promise<void> {
  await chooseFolder(page, fields.path);
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(fields.name);
  await form.getByLabel("Base branch").fill(fields.branch);
  await form.getByLabel("Install", { exact: true }).fill("npm ci");
  await form.getByLabel("Build").fill("npm run build");
  await form.getByLabel("Lint").fill("npm run lint");
  await form.getByLabel("Test").fill("npm test");
}

/** Adds a Project from the folder, answering the dialog's run environment question. */
export async function addAnswering(
  page: Page,
  name: string,
  folder: string,
  answer: "Yes" | "No" | "Decide later",
): Promise<Project> {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add a Project", exact: true }).click();
  await fillTheForm(page, { name, path: folder, branch: "main" });
  const question = page
    .getByRole("dialog")
    .getByRole("radiogroup", { name: "Run this Project's checks in a run environment?" });
  await expect(question.getByRole("radio", { name: "Decide later" })).toBeChecked();
  await question.getByRole("radio", { name: answer, exact: true }).check();
  const added = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/projects") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add the Project" }).click();
  const project = projectSchema.parse(await (await added).json());
  await expect(page).toHaveURL(`/projects/${project.id}`);
  return project;
}
