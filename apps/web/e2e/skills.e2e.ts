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

/**
 * Clicks Upload and waits for the service's answer. The upload writes the skill's folder and moves
 * it into place, which on a loaded Windows machine waits for a scanner holding a file there.
 */
async function upload(page: Page): Promise<void> {
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/skills\/uploads(\?|$)/.test(response.url()) && response.request().method() === "POST",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Upload" }).click();
  expect((await uploaded).status()).toBe(201);
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
  await expect(
    dialog.getByText("Or ask someone to draft it as a Proposal from their chat."),
  ).toBeVisible();
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

test(
  "editing a written skill makes its next version, waiting for review",
  { tag: "@full" },
  async ({ page }) => {
    const written = await page.request.post("/api/skills", {
      data: {
        name: "changelog",
        description: "Writes a changelog.",
        instructions: "One line each.",
      },
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
  },
);

test(
  "the user uploads a .md and a zipped folder; each arrives off",
  { tag: "@full" },
  async ({ page }) => {
    await openAddASkill(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Upload" }).click();
    await dialog.getByLabel("A single .md file or a zipped folder").setInputFiles({
      name: "tdd.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(skillMd("tdd", "Test first: red, green, refactor.")),
    });
    await upload(page);
    await expect(page.getByText("tdd uploaded. It is off until you review it.")).toBeVisible();

    await page.getByRole("button", { name: "Add a skill" }).click();
    await dialog.getByRole("tab", { name: "Upload" }).click();
    await dialog.getByLabel("A single .md file or a zipped folder").setInputFiles({
      name: "collect.zip",
      mimeType: "application/zip",
      buffer: await aZip([
        {
          path: "collect/SKILL.md",
          text: skillMd("collect", "Collects the merged pull requests."),
        },
        { path: "collect/scripts/collect.sh", text: "#!/bin/sh\ngit log --merges\n" },
      ]),
    });
    await upload(page);
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
  },
);

test("a zip holding a link is refused with the reason", { tag: "@full" }, async ({ page }) => {
  await openAddASkill(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Upload" }).click();
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

const LONG_DESCRIPTION = `Writes the release notes from the merged pull requests. ${"It groups them by area, names who asked for each change, and leaves out what never reached the users. ".repeat(10)}`;

async function aProjectSkill(name: string, description: string, folder = ""): Promise<void> {
  const skillFolder = path.join(repository.path, folder, ".claude", "skills", name);
  await mkdir(skillFolder, { recursive: true });
  await writeFile(path.join(skillFolder, "SKILL.md"), skillMd(name, description));
}

/**
 * Shows the page in the system's light or dark, which the shared user follows: choosing a palette
 * would change it for that user in every file.
 */
async function showPalette(page: Page, palette: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: palette });
  await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
}

/** Name, description and path share one left edge, the switches one right edge, nothing scrolls. */
async function expectEveryEdgeLinedUp(page: Page): Promise<void> {
  const lefts = await page
    .locator(".project-skill .skill-chip, .project-skill-description, .project-skill-path")
    .evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().left));
  expect(new Set(lefts).size).toBe(1);
  const rights = await page
    .locator(".project-skill [role=switch]")
    .evaluateAll((switches) => switches.map((one) => one.getBoundingClientRect().right));
  expect(new Set(rights).size).toBe(1);
  const scrollingSideways = await page
    .locator("html, .project-skills")
    .evaluateAll((parts) => parts.filter((part) => part.scrollWidth > part.clientWidth).length);
  expect(scrollingSideways).toBe(0);
}

test(
  "a Project's page lists its own skills, read-only, with their switches",
  { tag: "@full" },
  async ({ page }) => {
    await aProjectSkill("deploy", "Deploys the panel.");
    await aProjectSkill("lint-all", "Lints the panel.");
    await aProjectSkill("notes", LONG_DESCRIPTION);
    await aProjectSkill("lint-all", "Lints the web app alone.", "apps/web");
    const newProject: NewProject = {
      name: "Own skills",
      path: repository.path,
      baseBranch: "main",
      mark: { label: "OS", colour: "teal" },
      installCommand: "npm ci",
      commands: [
        {
          key: "build",
          name: "Build",
          kind: "build",
          commandLine: "npm run build",
          rerunCommandLine: "",
        },
        {
          key: "lint",
          name: "Lint",
          kind: "lint",
          commandLine: "npm run lint",
          rerunCommandLine: "",
        },
        { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
      ],
      installInputs: [],
      publishingMode: "push-and-pull-request",
      defaultPipeline: "full",
    };
    await page.request.post("/api/skills", {
      data: { name: "notes", description: "The library's notes.", instructions: "Write them." },
    });
    const added = await page.request.post("/api/projects", { data: newProject });
    const project = projectSchema.parse(await added.json());
    await page.goto(`/projects/${project.id}/skills`);

    await expect(page.getByText("Deploys the panel.")).toBeVisible();
    await expect(page.getByText(".claude/skills/deploy")).toBeVisible();
    const skillSwitch = (name: string) =>
      page.getByRole("group", { name, exact: true }).getByRole("switch");
    const deploy = skillSwitch("deploy");
    const notes = skillSwitch("notes");

    // A skill turns off by itself, and stays off.
    await deploy.click();
    await expect(page.getByText("Sessions in Own skills start without deploy.")).toBeVisible();
    await expect(deploy).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(deploy).toHaveAttribute("aria-checked", "false");
    await expect(notes).toHaveAttribute("aria-checked", "true");

    // Only the switch changes a skill: selecting its path to copy it doesn't.
    const saved = page.waitForRequest(/skill-use$/, { timeout: 500 }).then(
      () => true,
      () => false,
    );
    await page.getByText(".claude/skills/notes").click();
    expect(await saved).toBe(false);

    // The library's skill of the same name matters only while the Project's is on.
    const alsoInLibrary = page
      .getByRole("group", { name: "notes", exact: true })
      .getByText("The library has a skill of this name too");
    await expect(alsoInLibrary).toBeVisible();
    await notes.click();
    await expect(notes).toHaveAttribute("aria-checked", "false");
    await expect(alsoInLibrary).toBeHidden();
    await notes.click();
    await expect(alsoInLibrary).toBeVisible();

    // Two rows of one key are one skill to the engine.
    const sameKey = page.getByRole("group", { name: "lint-all", exact: true });
    await expect(sameKey).toHaveCount(2);
    await expect(sameKey.first()).toContainText("Switches together with");
    await sameKey.first().getByRole("switch").click();
    await expect(sameKey.last().getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await sameKey.first().getByRole("switch").click();
    await expect(sameKey.last().getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // A long description holds to three lines, with the whole of it on hover.
    const long = page.locator(".project-skill-description").filter({ hasText: "release notes" });
    await expect(long).toHaveAttribute("title", LONG_DESCRIPTION.trim());
    const clamped = await long.evaluate((part) => {
      const { lineHeight, height } = getComputedStyle(part);
      return Number.parseFloat(height) / Number.parseFloat(lineHeight);
    });
    expect(Math.round(clamped)).toBe(3);

    // The reload clears the toasts off the screenshots.
    await page.reload();
    const skillsBlock = page.locator(".project-skills");
    await expect(deploy).toHaveAttribute("aria-checked", "false");
    await expectEveryEdgeLinedUp(page);
    await skillsBlock.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-project-skills.png"),
    });
    await showPalette(page, "dark");
    await skillsBlock.screenshot({
      path: path.join(SCREENSHOTS, "dark-1600-project-skills.png"),
    });
    await showPalette(page, "light");

    for (const width of [900, 600]) {
      await page.setViewportSize({ width, height: 900 });
      await expectEveryEdgeLinedUp(page);
      await skillsBlock.screenshot({
        path: path.join(SCREENSHOTS, `light-${width}-project-skills.png`),
      });
    }
    await page.setViewportSize({ width: 1600, height: 900 });

    // The switch for all of them holds each skill's setting until it comes back on.
    // The Engine block has a switch of its own.
    const useProjectSkills = page
      .locator("label")
      .filter({ hasText: "Use this Project's skills" })
      .getByRole("switch");
    await useProjectSkills.click();

    await expect(
      page.getByText("Sessions in Own skills start without its own skills."),
    ).toBeVisible();
    await expect(useProjectSkills).toHaveAttribute("aria-checked", "false");
    await expect(notes).toHaveAttribute("tabindex", "-1");
    await expect(page.locator(".project-skill:not(.off)")).toHaveCount(0);
    await page.reload();
    await expect(notes).toHaveAttribute("aria-checked", "true");
    await skillsBlock.screenshot({
      path: path.join(SCREENSHOTS, "light-1600-project-skills-all-off.png"),
    });
    await notes.click({ force: true });
    await expect(notes).toHaveAttribute("aria-checked", "true");
    await useProjectSkills.click();
    await expect(useProjectSkills).toHaveAttribute("aria-checked", "true");
    await expect(deploy).toHaveAttribute("aria-checked", "false");
    await expect(notes).toHaveAttribute("aria-checked", "true");
  },
);
