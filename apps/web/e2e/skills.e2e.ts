import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { projectSchema, type NewProject } from "@the-office/contracts";
import { ZipFile } from "yazl";
import { createTemporaryRepository, type TemporaryRepository } from "./temporary-repository.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

/** A zip of `files`, each a regular file unless it names a link's target. */
async function aZip(
  files: readonly { path: string; text?: string; linkTo?: string }[],
): Promise<Buffer> {
  const zip = new ZipFile();
  for (const file of files) {
    if (file.linkTo === undefined) zip.addBuffer(Buffer.from(file.text ?? ""), file.path);
    else zip.addBuffer(Buffer.from(file.linkTo), file.path, { mode: 0o120777 });
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`;
}

async function openAddASkill(page: Page): Promise<void> {
  await page.goto("/settings/skills");
  await page.getByRole("button", { name: "Add a skill" }).click();
}

function row(page: Page, name: string) {
  return page.getByRole("row").filter({ hasText: name });
}

test("the user writes a skill, reviews it, turns it on and gives it to everyone", async ({
  page,
}) => {
  await openAddASkill(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Write one" }).click();
  await dialog.getByLabel("Name").fill("release-notes");
  await dialog.getByLabel("Description").fill("Writes release notes from merged pull requests.");
  await dialog.getByLabel("Instructions").fill("Group them as Added, Changed and Fixed.");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skills-write.png") });

  await dialog.getByRole("button", { name: "Add to the library" }).click();

  await expect(page.getByRole("heading", { name: "Review release-notes" })).toBeVisible();
  await expect(dialog.getByText("Group them as Added, Changed and Fixed.")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skills-review.png") });
  await dialog.getByRole("button", { name: "Turn it on" }).click();

  await expect(page.getByText("release-notes is on. Choose who has it.")).toBeVisible();
  await dialog.getByRole("switch").click();
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(row(page, "release-notes")).toContainText("On");
  await expect(row(page, "release-notes")).toContainText("Everyone");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skills.png") });
});

test("editing a written skill makes its next version, waiting for review", async ({ page }) => {
  const written = await page.request.post("/api/skills", {
    data: { name: "changelog", description: "Writes a changelog.", instructions: "One line each." },
  });
  expect(written.status()).toBe(201);
  await page.request.put("/api/skills/changelog/state", { data: { state: "on" } });
  await page.goto("/settings/skills");

  await row(page, "changelog").getByRole("button", { name: "Review" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Instructions")
    .fill("One line each, in the past tense.");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("changelog saved as version 2. It waits for your review."),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByText("in the past tense")).toBeVisible();
  await expect(row(page, "changelog")).toContainText("Off · waiting for your review");
  await expect(row(page, "changelog")).toContainText("v2");
});

test("the user uploads a .md and a zipped folder; each arrives off", async ({ page }) => {
  await openAddASkill(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("A single .md file or a zipped folder").setInputFiles({
    name: "tdd.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(skillMd("tdd", "Test first: red, green, refactor.")),
  });
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("tdd uploaded. It is off until you review it.")).toBeVisible();

  await page.getByRole("button", { name: "Add a skill" }).click();
  await dialog.getByLabel("A single .md file or a zipped folder").setInputFiles({
    name: "collect.zip",
    mimeType: "application/zip",
    buffer: await aZip([
      { path: "collect/SKILL.md", text: skillMd("collect", "Collects the merged pull requests.") },
      { path: "collect/scripts/collect.sh", text: "#!/bin/sh\ngit log --merges\n" },
    ]),
  });
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("collect uploaded. It is off until you review it.")).toBeVisible();

  await expect(row(page, "tdd")).toContainText("Uploaded · one file");
  await expect(row(page, "collect")).toContainText("Uploaded · folder");
  await expect(
    page.getByText(/skills wait for your review before anyone can use them/),
  ).toBeVisible();
  await row(page, "collect").getByRole("button", { name: "Review" }).click();
  await expect(
    dialog.getByText(
      "It includes a script. Scripts run with the permissions of whoever uses the skill.",
    ),
  ).toBeVisible();
  await expect(dialog.getByText("scripts/collect.sh")).toBeVisible();
});

test("a zip holding a link is refused with the reason", async ({ page }) => {
  await openAddASkill(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("A single .md file or a zipped folder").setInputFiles({
    name: "secrets.zip",
    mimeType: "application/zip",
    buffer: await aZip([
      { path: "SKILL.md", text: skillMd("secrets", "Reads the secrets.") },
      { path: "keys", linkTo: "../../.ssh" },
    ]),
  });

  await dialog.getByRole("button", { name: "Upload" }).click();

  await expect(dialog.getByRole("status")).toContainText(
    '"keys" is a link; a skill holds only its own files.',
  );
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-skills-refused.png") });
});

test("a Project's page lists its own skills, read-only, with the switch", async ({ page }) => {
  const skillFolder = path.join(repository.path, ".claude", "skills", "deploy");
  await mkdir(skillFolder, { recursive: true });
  await writeFile(path.join(skillFolder, "SKILL.md"), skillMd("deploy", "Deploys the panel."));
  const newProject: NewProject = {
    name: "Own skills",
    path: repository.path,
    baseBranch: "main",
    mark: { label: "OS", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await page.request.post("/api/projects", { data: newProject });
  const project = projectSchema.parse(await added.json());
  await page.goto(`/projects/${project.id}`);

  await expect(page.getByText("Deploys the panel.")).toBeVisible();
  await expect(page.getByText(".claude/skills/deploy")).toBeVisible();
  await page.getByRole("switch").click();

  await expect(
    page.getByText("Sessions in Own skills start without its own skills."),
  ).toBeVisible();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-skills.png") });
});
