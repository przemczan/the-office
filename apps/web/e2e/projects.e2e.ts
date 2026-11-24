import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  IMAGE_UPLOAD_BYTES,
  environmentCheckSchema,
  ideaSchema,
  latestEnvironmentCheckSchema,
  projectSchema,
  repositoryCloneSchema,
  taskSchema,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { addAnswering, chooseFolder, fillTheForm, sourceLine } from "./add-a-project.ts";
import { addFakeMcpServer } from "./fake-mcp-server.ts";
import { branchOnHost, serveRepository } from "./git-host.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { asOwnUser } from "./own-user.ts";
import { openPipelinePicker, optionNames } from "./pipeline-picker.ts";
import { addedBasePipeline, addedProjectPipeline } from "./project-pipelines.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import {
  commitFiles,
  createTemporaryRepository,
  createTemporaryRepositoryWithRemote,
  type TemporaryRepository,
} from "./temporary-repository.ts";

/** Saved on every run, for a person to compare with the click-through's. */
const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

/** A Task's screenshots for its review, kept by The Office across runs (git ignores it). */
const TASK_SCREENSHOTS = path.resolve(import.meta.dirname, "../../../.office/screenshots");

const ICON_FILE = {
  name: "icon.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

const LOGO_FILE = {
  name: "logo.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="teal"/></svg>',
  ),
};

/** The Logo's dark version: the same shape, light on the dark page. */
const DARK_LOGO_FILE = {
  name: "logo-dark.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="white"/></svg>',
  ),
};

const TRANSPARENT_ICON_FILE = {
  name: "circle.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3" fill="white"/></svg>',
  ),
};

const SVG_WITH_A_SCRIPT = {
  name: "scripted.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/><script>document.documentElement.setAttribute("data-script-ran", "yes"); alert("ran");</script></svg>`,
  ),
};

/** In the page's order, How it looks first, as it shows on top in one column. */
const APPEARANCE_BLOCKS = ["How it looks", "Mark", "Images"];

/** The Overview's blocks in the page's order: Onboarding and Work, then the dashboard's tiles. */
const OVERVIEW_BLOCKS = [
  "Onboarding",
  "Work",
  "Initiatives",
  "Ideas",
  "CI",
  "Pull requests",
  "Test instances",
  "Environment",
  "Remote sign-in",
  "Recent activity",
];

/** A Project's sections in the menu's order: each one's address and the blocks only it shows. */
const SECTIONS = [
  { name: "Overview", address: "", blocks: OVERVIEW_BLOCKS },
  { name: "Files", address: "/files", blocks: [] },
  { name: "Commands", address: "/commands", blocks: ["Commands"] },
  {
    name: "Environment",
    address: "/environment",
    blocks: ["Environment variables", "Environment check"],
  },
  { name: "Pipelines", address: "/pipelines", blocks: ["Default Pipeline"] },
  { name: "GitHub issues", address: "/issues", blocks: ["GitHub issues"] },
  { name: "Run environment", address: "/run-environment", blocks: ["Run environment"] },
  { name: "Devices", address: "/devices", blocks: ["Devices"] },
  { name: "Test targets", address: "/test-targets", blocks: ["Test targets", "Test instances"] },
  { name: "Actions", address: "/actions", blocks: [] },
  { name: "Engine", address: "/engine", blocks: ["Engine"] },
  { name: "Skills", address: "/skills", blocks: [/^Skills in the repository/] },
  { name: "Server values", address: "/server-values", blocks: ["Server values"] },
  { name: "Features", address: "/features", blocks: ["Features"] },
  { name: "Appearance", address: "/appearance", blocks: APPEARANCE_BLOCKS },
];

const ANY_BLOCK =
  /^(Onboarding|Initiatives|Ideas|CI|Pull requests|Environment|Remote sign-in|Recent activity|Environment variables|Environment check|Work|Commands|Default Pipeline|GitHub issues|Run environment|Devices|Test targets|Test instances|Engine|Skills in the repository.*|Server values|Features|How it looks|Mark|Images)$/;

let repository: TemporaryRepository;

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

test.beforeAll(async () => {
  repository = await createTemporaryRepository();
});

test.afterAll(async () => {
  await repository.remove();
});

/** Adds a Project through the API, for the tests that start on its page. */
const GRAY_950 = "rgb(15, 15, 14)";
const WHITE = "rgb(255, 255, 255)";

// A custom colour is the user's own data, not a style.
/* oxlint-disable office/restricted-syntax */
const LIGHT_CUSTOM_COLOUR = { value: "#ffee88", background: "rgb(255, 238, 136)", label: GRAY_950 };
const DARK_CUSTOM_COLOUR = { value: "#3366cc", background: "rgb(51, 102, 204)", label: WHITE };
const PAGE_LIKE_CUSTOM_COLOUR = { value: "#ffffff", background: WHITE, label: GRAY_950 };
const TILE_EDGE_WIDTH = "1px";
const NO_TILE = { background: "rgba(0, 0, 0, 0)", edgeWidth: "0px" };
/* oxlint-enable office/restricted-syntax */

async function expectCustomMark(
  mark: Locator,
  colours: { readonly background: string; readonly label: string },
): Promise<void> {
  await expect(mark).toHaveClass(/colour-custom/);
  await expect(mark).toHaveCSS("background-color", colours.background);
  await expect(mark).toHaveCSS("color", colours.label);
}

/** An Icon stands in for the mark's colour too, so nothing shows in its corners. */
async function expectNoTile(mark: Locator): Promise<void> {
  await expect(mark).toHaveCSS("background-color", NO_TILE.background);
  await expect(mark).toHaveCSS("border-top-width", NO_TILE.edgeWidth);
}

async function expectLoadedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
}

/** A repository holding images, a text file, a text file named as an image, and a folder. */
async function repositoryWithImages(): Promise<TemporaryRepository> {
  const imaged = await createTemporaryRepository();
  await commitFiles(imaged, {
    "assets/circle.svg": TRANSPARENT_ICON_FILE.buffer,
    "assets/icon.png": ICON_FILE.buffer,
    "assets/logo.svg": LOGO_FILE.buffer,
    "assets/PHOTO.JPG": ICON_FILE.buffer,
    "assets/fake.png": "<html>not a picture</html>",
    "assets/notes.txt": "Notes",
    "assets/old/older.webp": ICON_FILE.buffer,
  });
  return imaged;
}

type ImageName = "Icon" | "Logo";
type VersionName = "Light" | "Dark";

/** The image's section on Appearance: its name, where it shows, and a tile for each version. */
function imageSection(page: Page, image: ImageName): Locator {
  return page.getByRole("region", { name: image, exact: true });
}

/** One version's tile, as Light Icon or Dark Logo. */
function versionTile(page: Page, image: ImageName, version: VersionName = "Light"): Locator {
  return page.getByRole("group", { name: `${version} ${image}`, exact: true });
}

/** The file input behind a tile, which a press on the tile opens. */
function versionFile(page: Page, image: ImageName, version: VersionName = "Light"): Locator {
  return page.getByLabel(`${version} ${image} file`, { exact: true });
}

/** Opens the tile's window at `assets`, where the images are. */
async function openAssets(
  page: Page,
  image: ImageName,
  version: VersionName = "Light",
): Promise<Locator> {
  await versionTile(page, image, version)
    .getByRole("button", { name: "Choose from repository" })
    .click();
  const window = page.getByRole("dialog", { name: `Choose ${version} ${image}` });
  await window.getByRole("button", { name: "assets" }).click();
  return window;
}

async function chooseFromRepository(
  page: Page,
  image: ImageName,
  fileName: string,
  version: VersionName = "Light",
): Promise<void> {
  const window = await openAssets(page, image, version);
  await window.getByRole("button", { name: fileName }).click();
  await window.getByRole("button", { name: "Choose file" }).click();
  await expect(window).toBeHidden();
}

async function addedProject(
  page: Page,
  name: string,
  lines: Readonly<Record<"install" | "build" | "lint" | "test", string>> = {
    install: "npm ci",
    build: "npm run build",
    lint: "npm run lint",
    test: "npm test",
  },
  repositoryPath: string = repository.path,
): Promise<Project> {
  const newProject: NewProject = {
    name,
    path: repositoryPath,
    baseBranch: "main",
    mark: { label: "AP", colour: "violet" },
    installCommand: lines.install,
    commands: [
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: lines.build,
        rerunCommandLine: "",
      },
      { key: "lint", name: "Lint", kind: "lint", commandLine: lines.lint, rerunCommandLine: "" },
      { key: "test", name: "Test", kind: "test", commandLine: lines.test, rerunCommandLine: "" },
    ],
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

/** The tabs of the open Project's sections, under its head. */
function projectTabs(page: Page): Locator {
  return page.locator(".project-tabs").getByRole("tablist");
}

/** The Projects list, beside the open Project on a wide page. */
function projectsList(page: Page): Locator {
  return page.getByRole("navigation", { name: "Projects", exact: true });
}

/** Appearance's How it looks: the page head, the list item and the mark beside an item. */
function howItLooks(page: Page): Locator {
  return page.locator(".appearance-preview");
}

/** The section is open: its tab chosen, its blocks alone showing, under the Project's head. */
async function expectOpenSection(page: Page, project: Project, section: (typeof SECTIONS)[number]) {
  await expect(projectTabs(page).getByRole("tab", { selected: true })).toHaveText(section.name);
  await expect(
    page.locator(".project-section").getByRole("heading", { name: ANY_BLOCK }),
  ).toHaveText(section.blocks);
  const head = page.locator(".project-head");
  await expect(head.getByRole("heading", { name: project.name })).toBeVisible();
  await expect(head).toContainText(project.path);
  await expect(head).toContainText(project.baseBranch);
}

/**
 * Waits for the service to answer that a clone has ended, as the dialog reads it. A clone is real
 * git work, and on a loaded machine it takes longer than a look for the form would wait.
 */
function cloneEnded(page: Page): Promise<unknown> {
  return page.waitForResponse(
    async (response) =>
      /\/api\/repositories\/clones\/[^/]+$/.test(response.url()) &&
      response.request().method() === "GET" &&
      response.ok() &&
      repositoryCloneSchema.parse(await response.json()).state !== "cloning",
  );
}

test("the user adds a Project from the Projects page and lands on its page", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add a Project", exact: true }).click();
  await fillTheForm(page, { name: "Billing service", path: repository.path, branch: "main" });
  await page.getByRole("dialog").getByLabel("Install inputs").fill("package-lock.json,");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-add.png") });
  const question = page.getByRole("dialog").getByRole("radiogroup", {
    name: "Run this Project's checks in a run environment?",
  });
  await question.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-projects-add-run-environment.png"),
  });

  await page.getByRole("button", { name: "Add the Project" }).click();

  await expect(page).toHaveURL(/\/projects\/billing-service$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Billing service");
  await expect(page.getByText("Billing service added.")).toBeVisible();
  await expect(page.getByText(repository.path)).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project.png") });
  await projectTabs(page).getByRole("tab", { name: "Commands" }).click();
  await expect(page.getByText("package-lock.json")).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).first().click();
  await expect(page.getByRole("link", { name: /Billing service/ })).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects.png") });
});

test(
  "a folder that isn't a repository, or a branch it lacks, is refused with the reason",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Add a Project", exact: true }).click();
    await fillTheForm(page, { name: "Nowhere", path: repository.folder, branch: "main" });
    const add = page.getByRole("button", { name: "Add the Project" });

    await add.click();
    // The design system's Alert is a status.
    const refusal = page.getByRole("dialog").getByRole("status");
    await expect(refusal).toContainText(`${repository.folder} is not a git repository`);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-refused.png") });

    await sourceLine(page).getByRole("button", { name: "Change" }).click();
    await expect(page.getByRole("dialog").getByLabel("Repository folder")).toHaveValue(
      repository.folder,
    );
    await chooseFolder(page, repository.path);
    await expect(page.getByRole("dialog").getByLabel("Name")).toHaveValue("Nowhere");
    await page.getByRole("dialog").getByLabel("Base branch").fill("develop");
    await add.click();
    await expect(refusal).toContainText('The repository has no branch "develop".');
    await expect(page).toHaveURL(/\/projects$/);
  },
);

test(
  "Add a Project goes in two steps in a window that neither moves nor changes height",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Add a Project", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const bar = dialog.locator(".dialog-bar");
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    // Pinned to the top: 7% of the browser window from its top, 24px at least.
    expect(box!.y).toBeCloseTo(Math.max(24, viewport.height * 0.07), 0);
    expect(box!.height).toBeCloseTo(Math.min(640, viewport.height - 2 * box!.y), 0);
    const barTop = (await bar.boundingBox())!.y;
    await expect(bar).toContainText("Step 1 of 2");

    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByText("Write the repository's folder, as a full path.")).toBeVisible();
    for (const source of ["A git URL", "From GitHub", "A folder"]) {
      await dialog.getByRole("tab", { name: source }).click();
      expect(await dialog.boundingBox()).toEqual(box);
      expect((await bar.boundingBox())!.y).toBe(barTop);
    }

    await chooseFolder(page, repository.path);
    await expect(bar).toContainText("Step 2 of 2");
    await expect(sourceLine(page)).toContainText("A folder");
    await expect(dialog.getByLabel("Name")).toHaveValue(path.basename(repository.path));
    await expect(dialog.getByLabel("Repository folder")).toBeHidden();
    expect(await dialog.boundingBox()).toEqual(box);
    expect((await bar.boundingBox())!.y).toBe(barTop);
    // Only the body scrolls: the head and the bar stay where they were.
    await dialog.locator(".dialog-body").evaluate((body) => body.scrollTo(0, body.scrollHeight));
    await expect(dialog.getByRole("heading", { name: "Add a Project" })).toBeInViewport();
    expect((await bar.boundingBox())!.y).toBe(barTop);

    await sourceLine(page).getByRole("button", { name: "Change" }).click();
    await expect(bar).toContainText("Step 1 of 2");
    await expect(dialog.getByLabel("Repository folder")).toHaveValue(repository.path);
  },
);

test(
  "the user adds a Project by its git URL: cloned first, then the form opens from the clone",
  { tag: "@full" },
  async ({ page }) => {
    const url = serveRepository(repository, "acme", "storefront");
    branchOnHost("acme", "storefront", "release");
    await page.goto("/projects");
    await page.getByRole("button", { name: "Add a Project", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "A git URL" }).click();
    const repositoryUrl = dialog.getByLabel("Repository URL");
    const clone = dialog.getByRole("button", { name: "Clone" });

    await repositoryUrl.fill("http://git.example.test/acme/storefront.git");
    await clone.click();
    await expect(dialog.getByRole("status")).toContainText(
      "The Office clones over https and ssh only, not http.",
    );
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-add-git-url.png") });

    await repositoryUrl.fill(url);
    let ended = cloneEnded(page);
    await clone.click();
    await ended;
    await expect(dialog.getByLabel("Name")).toHaveValue("storefront");
    await expect(sourceLine(page)).toContainText("A git URL");
    await expect(sourceLine(page)).toContainText(url);
    await expect(sourceLine(page)).toContainText(/cloned into .*storefront/);
    await expect(dialog.locator(".dialog-bar")).toContainText("Step 2 of 2");

    // Change forgets the clone and the name it gave; the URL stays as written.
    await sourceLine(page).getByRole("button", { name: "Change" }).click();
    await expect(repositoryUrl).toHaveValue(url);
    ended = cloneEnded(page);
    await clone.click();
    await ended;
    await expect(dialog.getByLabel("Name")).toHaveValue("storefront");
    const baseBranch = dialog.getByLabel("Base branch");
    await expect(baseBranch).toHaveValue("main");
    await baseBranch.selectOption("release");
    await dialog.getByLabel("Name").fill("Storefront");
    await dialog.getByLabel("Install", { exact: true }).fill("npm ci");
    await dialog.getByLabel("Build").fill("npm run build");
    await dialog.getByLabel("Lint").fill("npm run lint");
    await dialog.getByLabel("Test").fill("npm test");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-add-cloned.png") });

    await page.getByRole("button", { name: "Add the Project" }).click();

    await expect(page).toHaveURL(/\/projects\/storefront$/);
    await expect(page.getByText("Repository URL")).toBeVisible();
    await expect(page.getByText(url)).toBeVisible();
    await expect(page.getByText("· release")).toBeVisible();
  },
);

test(
  "a Project's page says which part of the Office identity its remote needs and what is missing",
  { tag: "@full" },
  async ({ page }) => {
    // An ssh host of its own: office-identity.e2e.ts confirms its Unconfirmed host's key in parallel.
    const host = "remote-needs.invalid";
    const tracking = await createTemporaryRepository();
    try {
      const git = (...gitArguments: string[]): void => {
        execFileSync("git", gitArguments, { cwd: tracking.path, stdio: "ignore" });
      };
      git("remote", "add", "origin", `ssh://git@${host}/acme/notes.git`);
      git("config", "branch.main.remote", "origin");
      git("config", "branch.main.merge", "refs/heads/main");
      const project = await addedProject(page, "Remote over ssh", undefined, tracking.path);
      await page.goto(`/projects/${project.id}`);

      const remoteNeeds = page.locator(".project-remote-needs");
      await expect(remoteNeeds).toContainText(
        `Its remote, ${host}, is reached over ssh with the Office ssh key`,
      );
      // Whether the Office ssh key is made yet depends on the files running beside this one.
      await expect(remoteNeeds).toContainText(`${host}'s host key isn't confirmed yet`);
      await remoteNeeds.getByRole("link", { name: "Settings › Office identity" }).click();

      await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
    } finally {
      await tracking.remove();
    }
  },
);

test("the Project's commands are changed, added and removed in place, each kept", async ({
  page,
}) => {
  const project = await addedProject(page, "Command edits");
  await page.goto(`/projects/${project.id}/commands`);

  await page.getByRole("button", { name: "Change the Test command" }).click();
  const changing = page.getByRole("form", { name: "Change the Test command" });
  await changing.getByLabel("Name").fill("Unit tests");
  await changing.getByLabel("Command line").fill("npm test -- --run");
  await changing.getByLabel("Re-run command").fill("npm test -- --run --last-failed");
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "project-command-rerun-form.png") });
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Unit tests saved. Tasks run it as saved from their next Stage that runs it."),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "The Unit tests command" })).toContainText(
    "npm test -- --runRe-run npm test -- --run --last-failed",
  );

  await page.getByRole("button", { name: "Add a command" }).click();
  const adding = page.getByRole("form", { name: "Add a command" });
  await adding.getByLabel("Key").fill("install");
  await adding.getByLabel("Name").fill("End to end");
  await adding.getByLabel("Command line").fill("npm run e2e");
  await adding.getByRole("button", { name: "Add" }).click();
  await expect(adding).toContainText('The key "install" is kept for The Office\'s own use.');
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-command-add.png") });
  await adding.getByLabel("Key").fill("test-e2e");
  await adding.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("End to end added.")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-commands.png") });
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "project-commands-rerun.png") });

  await page.getByRole("button", { name: "Remove the Lint command" }).click();
  const confirming = page.getByRole("dialog", { name: "Remove Lint?" });
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-command-remove.png") });
  await confirming.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Lint removed.")).toBeVisible();

  await page.reload();
  const kept = projectSchema.parse(
    await (await page.request.get(`/api/projects/${project.id}`)).json(),
  );
  expect(
    kept.commands.map(({ key, name, commandLine, rerunCommandLine }) => [
      key,
      name,
      commandLine,
      rerunCommandLine,
    ]),
  ).toEqual([
    ["build", "Build", "npm run build", ""],
    ["test", "Unit tests", "npm test -- --run", "npm test -- --run --last-failed"],
    ["test-e2e", "End to end", "npm run e2e", ""],
  ]);
  await expect(page.getByRole("group", { name: "The End to end command" })).toContainText(
    "npm run e2e",
  );
});

test(
  "a Project overrides an MCP server's Server values, a secret never shown",
  { tag: "@full" },
  async ({ page }) => {
    const server = "e2e-project-values-server";
    const officeWideSecret = "office-wide-secret-value";
    const projectSecret = "project-secret-value";
    await addFakeMcpServer(page, server, [
      { name: "FAKE_TOKEN", secret: true, required: true, officeWideValue: officeWideSecret },
      { name: "FAKE_REGION", secret: false, required: false, officeWideValue: "eu" },
    ]);
    const project = await addedProject(page, "Values override");
    await page.goto(`/projects/${project.id}/server-values`);

    const values = page.getByRole("region", { name: `MCP server ${server}` });
    const token = values.getByRole("listitem", { name: "Server value FAKE_TOKEN" });
    const region = values.getByRole("listitem", { name: "Server value FAKE_REGION" });
    await expect(token).toContainText("Office-wide Set");
    await expect(token).toContainText("This Project The Office-wide value");
    await expect(region).toContainText("Office-wide eu");

    await values
      .getByRole("button", { name: `Change ${server}'s values for this Project` })
      .click();
    const editor = page.getByRole("form", { name: `MCP server ${server}` });
    await editor.getByLabel("FAKE_TOKEN for this Project").fill(projectSecret);
    await expect(editor.getByText("The value you typed is kept on Save.")).toBeVisible();
    await editor.getByLabel("FAKE_REGION for this Project").fill("us");
    await editor.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText(
        "Server values saved. Sessions in Values override get them from their next start.",
      ),
    ).toBeVisible();
    await expect(token).toContainText("This Project Set");
    await expect(region).toContainText("This Project us");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-server-values.png") });

    // The kept secret is only said to be set, in the editor and over the API.
    await page.reload();
    await values
      .getByRole("button", { name: `Change ${server}'s values for this Project` })
      .click();
    await expect(
      editor.getByText("A value is set. It is never shown; type a new one to replace it."),
    ).toBeVisible();
    await expect(editor.getByLabel("FAKE_TOKEN for this Project")).toHaveValue("");
    await expect(page.locator("body")).not.toContainText(projectSecret);
    await expect(page.locator("body")).not.toContainText(officeWideSecret);
    const listed = await (
      await page.request.get(`/api/projects/${project.id}/server-values`)
    ).text();
    expect(listed).not.toContain(projectSecret);
    expect(listed).not.toContain(officeWideSecret);
  },
);

test(
  "the install inputs are changed beside the install command",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Install inputs");
    await page.goto(`/projects/${project.id}/commands`);
    await expect(page.getByText("None: a worktree installs once.")).toBeVisible();

    await page.getByRole("button", { name: "Change the install inputs" }).click();
    await page.getByLabel("Install inputs").fill("package-lock.json, apps/web/package.json");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Install inputs saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("package-lock.json, apps/web/package.json")).toBeVisible();

    await page.getByRole("button", { name: "Change the install inputs" }).click();
    await page.getByLabel("Install inputs").fill("../package-lock.json");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText(
      'An install input is a path inside the repository; "../package-lock.json" is not.',
    );
  },
);

test(
  "the before and after publishing lines are set in Commands › Publish, kept, and cleared",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Publish lines");
    await page.goto(`/projects/${project.id}/commands`);
    const publish = page.getByRole("group", { name: "Publish", exact: true });
    const before = publish.getByRole("group", { name: "Before publishing" });
    const after = publish.getByRole("group", { name: "After publishing" });
    await expect(publish.getByLabel("Publishing", { exact: true })).toBeVisible();
    await expect(before).toContainText("None");
    await expect(after).toContainText("None");

    await page.getByRole("button", { name: "Change the before publishing line" }).click();
    await page.getByLabel("Before publishing line").fill("npm run changelog");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Before publishing line saved.")).toBeVisible();
    await page.getByRole("button", { name: "Change the after publishing line" }).click();
    await page.getByLabel("After publishing line").fill("./scripts/notify.sh");
    await page.keyboard.press("Enter");
    await expect(page.getByText("After publishing line saved.")).toBeVisible();

    await page.reload();
    await expect(before).toContainText("npm run changelog");
    await expect(after).toContainText("./scripts/notify.sh");
    // The page scrolls inside its own frame, so the Publish group is brought to its top first.
    await page
      .getByRole("heading", { name: "Publish", exact: true })
      .evaluate((title) => title.scrollIntoView({ block: "start" }));
    await screenshotScenario(page, "project-commands-publish");
    const kept = projectSchema.parse(
      await (await page.request.get(`/api/projects/${project.id}`)).json(),
    );
    expect([kept.beforePublishingCommand, kept.afterPublishingCommand]).toEqual([
      "npm run changelog",
      "./scripts/notify.sh",
    ]);

    // Unlike install, a publishing line can be cleared.
    await page.getByRole("button", { name: "Change the after publishing line" }).click();
    await page.getByLabel("After publishing line").fill("");
    await page.keyboard.press("Enter");
    await expect(page.getByText("After publishing line cleared.")).toBeVisible();
    await page.reload();
    await expect(after).toContainText("None");
  },
);

test(
  "the Project limit starts at 1, is changed in Overview › Work, and is kept after a reload",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Project limit");
    await page.goto(`/projects/${project.id}`);
    const limit = page.getByRole("status", { name: "running Tasks at once in this Project" });
    await expect(limit).toHaveText("1");
    await expect(
      page.getByRole("button", { name: "Lower running Tasks at once in this Project" }),
    ).toBeDisabled();

    const raise = page.getByRole("button", { name: "Raise running Tasks at once in this Project" });
    await raise.click();
    await expect(limit).toHaveText("2");
    await expect(raise).toBeEnabled();
    await raise.click();
    await expect(limit).toHaveText("3");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-limit.png") });

    await page.reload();
    await expect(limit).toHaveText("3");
    await expect(
      page.getByText(
        "Lowering it lets running Tasks finish; nothing new starts in this Project until one ends.",
      ),
    ).toBeVisible();
  },
);

test(
  "the default Pipeline picker lists the library, the built-ins first",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Pipeline choice");
    await page.goto(`/projects/${project.id}/pipelines`);
    const picker = await openPipelinePicker(page, "Default Pipeline");

    // Other tests add Pipelines of their own after the built-ins.
    await expect(picker.getByRole("option").first()).toHaveAccessibleName("Full");
    const options = await optionNames(picker);
    expect(options.slice(0, 5)).toEqual([
      "Full",
      "Quick fix",
      "Document",
      "Onboard",
      "Proof of concept",
    ]);
    await picker.getByRole("option", { name: "Quick fix", exact: true }).click();

    await expect(
      page.getByText(`${project.name}'s default Pipeline is Quick fix now.`),
    ).toBeVisible();
    await expect(page.getByText(/^Implement → Tests → Publish\./)).toBeVisible();
  },
);

test("the default Pipeline picker opens over the rows under it, not pushing them down", async ({
  page,
}) => {
  const project = await addedProject(page, "Picker overlay");
  await page.goto(`/projects/${project.id}/pipelines`);
  const under = page.getByText(/A new Task has no Pipeline until/);
  const before = await under.boundingBox();

  const picker = await openPipelinePicker(page, "Default Pipeline");
  await expect(picker).toBeVisible();

  expect(await under.boundingBox()).toEqual(before);
  const coveredByList = await under.evaluate((line) => {
    const box = line.getBoundingClientRect();
    const onTop = document.elementFromPoint(box.left + 4, box.top + 8);
    return onTop?.closest('[role="listbox"]') !== null;
  });
  expect(coveredByList).toBe(true);
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "default-pipeline-picker-open.png") });
});

test(
  "a Project's default Pipeline is set to one of its own Project Pipelines",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Own default");
    const base = await addedBasePipeline(page, "Own base");
    const own = await addedProjectPipeline(page, project.id, base, "Own Full");
    await page.goto(`/projects/${project.id}/pipelines`);

    const picker = await openPipelinePicker(page, "Default Pipeline");
    const groups = picker.getByRole("group");
    await expect(groups.first()).toHaveAccessibleName(`${project.name}'s Pipelines`);
    await expect(groups.last()).toHaveAccessibleName("Office-wide Pipelines");
    await groups.first().getByRole("option", { name: own.name, exact: true }).click();

    await expect(
      page.getByText(`${project.name}'s default Pipeline is ${own.name} now.`),
    ).toBeVisible();
    const saved = projectSchema.parse(
      await (await page.request.get(`/api/projects/${project.id}`)).json(),
    );
    expect(saved.defaultPipeline).toBe(own.id);
  },
);

test(
  "a command changed in one tab shows in another",
  { tag: "@full" },
  async ({ page, context }) => {
    const project = await addedProject(page, "Two tabs");
    const other = await context.newPage();
    // The other tab must have subscribed before the change, or it never hears of it.
    const subscribed = new Promise<void>((resolve) => {
      other.on("websocket", (socket) => {
        socket.on("framereceived", ({ payload }) => {
          if (
            String(payload).includes('"subscriptions"') &&
            String(payload).includes("project.command-changed")
          ) {
            resolve();
          }
        });
      });
    });
    await other.goto(`/projects/${project.id}/commands`);
    await subscribed;
    await page.goto(`/projects/${project.id}/commands`);

    await page.getByRole("button", { name: "Change the Lint command" }).click();
    await page.getByLabel("Command line").fill("oxlint");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(other.getByText("oxlint", { exact: true })).toBeVisible();
  },
);

/** Presses the Environment section's Save and waits for the service to keep the environment. */
async function saveEnvironment(page: Page): Promise<void> {
  const saving = page.waitForResponse(
    (response) => response.url().endsWith("/environment") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saving).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
}

test("the environment is saved by Save, and the environment check tries it without changing it", async ({
  page,
}) => {
  const passes = `node -e "process.exit(0)"`;
  const project = await addedProject(page, "Environment check", {
    install: passes,
    build: passes,
    lint: `node -e "console.error('lint error: 1 problem'); process.exit(1)"`,
    test: `node -e "process.exit(process.env.GREETING === 'hello' ? 0 : 1)"`,
  });
  await page.goto(`/projects/${project.id}/environment`);
  await expect(page.getByText("Not checked yet.")).toBeVisible();
  const checks = page.getByRole("list", { name: "Environment checks" });
  const variables = page.getByLabel("Variables to set");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  // Discard drops an edit; Save keeps one, with no check.
  await variables.fill("GREETING=bye");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(variables).toHaveValue("");
  await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
  await variables.fill("GREETING=hello");
  await saveEnvironment(page);
  await expect(page.getByText("Not checked yet.")).toBeVisible();

  await page.getByRole("button", { name: "Run the environment check" }).click();

  await expect(page.getByText("Failed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(checks).toContainText("failed with exit code 1");
  await expect(checks.getByLabel("Output")).toHaveText("lint error: 1 problem");
  await expect(checks.getByRole("img", { name: "Passed" })).toHaveCount(4);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-project-environment-failed.png"),
  });
  // A failed check leaves the saved environment as it is.
  await page.reload();
  await expect(variables).toHaveValue("GREETING=hello");

  await page.request.put(`/api/projects/${project.id}/commands/lint`, {
    data: { name: "Lint", kind: "lint", commandLine: passes },
  });
  await page.getByRole("button", { name: "Run the environment check" }).click();

  await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-environment.png") });
});

test("a Secret variable is set, kept and removed, and its value never comes back", async ({
  page,
}) => {
  // Three checks run in turn.
  test.setTimeout(120_000);
  const passes = `node -e "process.exit(0)"`;
  const token = "npm_e2e_s3cret";
  const project = await addedProject(page, "Secret variables", {
    install: passes,
    build: passes,
    lint: passes,
    test: `node -e "console.log('token: ' + (process.env.NPM_TOKEN ?? 'none'))"`,
  });
  await page.goto(`/projects/${project.id}/environment`);
  const secrets = page.getByRole("group", { name: "Secret variables" });
  const checks = page.getByRole("list", { name: "Environment checks" });
  const run = page.getByRole("button", { name: "Run the environment check" });
  /** Runs a check and waits for that one to pass: the badge says Ready from the one before too. */
  const runCheck = async (): Promise<void> => {
    const starting = page.waitForResponse(
      (response) =>
        response.url().endsWith("/environment-check") && response.request().method() === "POST",
    );
    await run.click();
    const { startedAt } = environmentCheckSchema.parse(await (await starting).json());
    await expect
      .poll(
        async () => {
          const address = `/api/projects/${project.id}/environment-check`;
          const { check } = latestEnvironmentCheckSchema.parse(
            await (await page.request.get(address)).json(),
          );
          return check?.startedAt === startedAt ? check.state : "not yet";
        },
        { timeout: 30_000 },
      )
      .toBe("passed");
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  };
  /** The test check's output, from a fresh page, where each passed check shows it on a press. */
  const testOutput = async (): Promise<Locator> => {
    await page.reload();
    // Test is the last check.
    const testCheck = checks.getByRole("listitem").last();
    await testCheck.getByRole("button", { name: "Show the output" }).click();
    return testCheck.getByLabel("Output");
  };

  // A short value, or a name used for a plain variable too, is refused with why.
  await secrets.getByRole("button", { name: "Add a Secret variable" }).click();
  const added = secrets.getByRole("group", { name: "the new Secret variable" });
  await added.getByLabel("Name").fill("NPM_TOKEN");
  const row = secrets.getByRole("group", { name: "the Secret variable NPM_TOKEN" });
  await row.getByLabel("Value").fill("12345");
  await page.getByLabel("Variables to set").fill("NPM_TOKEN=plain");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const reasons = page.getByRole("alert").filter({ hasText: "Secret variable" });
  await expect(reasons).toContainText(
    "The value of the Secret variable NPM_TOKEN is shorter than 6 characters",
  );
  await expect(reasons).toContainText(
    "NPM_TOKEN is both a plain and a Secret variable: make it one or the other.",
  );

  // Set: the commands get it, and its output hides it.
  await page.getByLabel("Variables to set").fill("");
  await row.getByLabel("Value").fill(token);
  await saveEnvironment(page);
  await runCheck();
  await expect(await testOutput()).toHaveText("token: [secret NPM_TOKEN]");

  // Kept: never shown again, in the page or the API, and given again with nothing typed.
  await page.reload();
  await expect(row.getByLabel("Value")).toHaveValue("");
  await expect(
    row.getByText("A value is set. It is never shown; type a new one to replace it."),
  ).toBeVisible();
  await expect(row.getByRole("button", { name: "Remove the value" })).toHaveCount(0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-project-environment-secrets.png"),
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await secrets.screenshot({
    path: path.join(SCREENSHOTS, "dark-1600-project-environment-secrets.png"),
  });
  await page.emulateMedia({ colorScheme: "light" });
  await runCheck();
  await expect(await testOutput()).toHaveText("token: [secret NPM_TOKEN]");
  await expect(page.locator("body")).not.toContainText(token);
  for (const address of [
    `/api/projects/${project.id}`,
    `/api/projects/${project.id}/environment-check`,
  ]) {
    expect(await (await page.request.get(address)).text()).not.toContain(token);
  }

  // Removed and saved: the commands no longer get it.
  await row.getByRole("button", { name: "Remove the Secret variable NPM_TOKEN" }).click();
  await saveEnvironment(page);
  await runCheck();
  await expect(await testOutput()).toHaveText("token: none");
  const saved = projectSchema.parse(
    await (await page.request.get(`/api/projects/${project.id}`)).json(),
  );
  expect(saved.environment.set).toEqual([]);
});

test(
  "the mark is changed in Appearance: previewed, saved, and shown on the head and the card",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "New look");
    await page.goto(`/projects/${project.id}/appearance`);
    const head = page.locator(".project-head .project-mark");
    const picker = page.locator(".mark-picker");
    const preview = howItLooks(page);
    const save = page.getByRole("button", { name: "Save" });
    await expect(head).toHaveText("AP");
    await expect(save).toBeDisabled();
    await expect(page.getByRole("button", { name: "Discard" })).toBeHidden();
    await expect(preview.getByText("Not saved")).toBeHidden();

    await picker.getByLabel("Mark label").fill("NL");
    await picker.getByRole("radio", { name: "Teal" }).check();

    await expect(picker.locator(".project-mark")).toHaveText("NL");
    await expect(picker.locator(".project-mark")).toHaveClass(/colour-teal/);
    // Every place the preview draws shows the draft, while the real head keeps the saved mark.
    await expect(preview.locator(".project-mark")).toHaveText(["NL", "NL", "NL"]);
    await expect(preview.locator(".project-mark.mark-colour-teal")).toHaveCount(3);
    await expect(preview.getByText("Not saved")).toBeVisible();
    await expect(head).toHaveText("AP");
    await expect(head).toHaveClass(/colour-violet/);

    await save.click();

    await expect(page.getByText("Mark saved for New look.")).toBeVisible();
    await expect(head).toHaveText("NL");
    await expect(head).toHaveClass(/colour-teal/);
    await expect(save).toBeDisabled();
    await expect(preview.getByText("Not saved")).toBeHidden();

    await page.reload();
    await expect(page.locator(".project-head .project-mark")).toHaveText("NL");
    await expect(page.getByLabel("Mark label")).toHaveValue("NL");

    await page.getByRole("link", { name: "Projects", exact: true }).first().click();
    const card = page.getByRole("link", { name: /New look/ }).locator(".project-mark");
    await expect(card).toHaveText("NL");
    await expect(card).toHaveClass(/colour-teal/);
  },
);

test(
  "Discard shows only while the mark has a draft, and brings back the saved mark",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Second thoughts");
    await page.goto(`/projects/${project.id}/appearance`);
    const picker = page.locator(".mark-picker");
    const discard = page.getByRole("button", { name: "Discard" });
    await expect(discard).toBeHidden();

    await picker.getByLabel("Mark label").fill("ST");
    await picker.getByRole("radio", { name: "Ink" }).check();
    await expect(discard).toBeVisible();

    await discard.click();

    await expect(picker.getByLabel("Mark label")).toHaveValue("AP");
    await expect(picker.getByRole("radio", { name: "Violet" })).toBeChecked();
    await expect(howItLooks(page).locator(".project-mark").first()).toHaveText("AP");
    await expect(howItLooks(page).getByText("Not saved")).toBeHidden();
    await expect(discard).toBeHidden();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    // Typed back to the saved mark, there is nothing to discard either.
    await picker.getByLabel("Mark label").fill("AQ");
    await expect(discard).toBeVisible();
    await picker.getByLabel("Mark label").fill("AP");
    await expect(discard).toBeHidden();
  },
);

test(
  "the colours are swatches picked by the keyboard, each named",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Keyed");
    await page.goto(`/projects/${project.id}/appearance`);
    const colours = page.getByRole("radiogroup", { name: "Colour" });
    await expect(colours.getByRole("radio")).toHaveCount(5);
    for (const name of ["Teal", "Violet", "Gray", "Ink", "Custom"]) {
      await expect(colours.getByRole("radio", { name })).toBeVisible();
    }

    await colours.getByRole("radio", { name: "Violet" }).focus();
    await page.keyboard.press("ArrowRight");

    await expect(colours.getByRole("radio", { name: "Gray" })).toBeChecked();
    await expect(page.locator(".mark-picker .project-mark")).toHaveClass(/colour-gray/);
    await expect(page.getByRole("tooltip")).toHaveText("Gray");
  },
);

test(
  "an Icon replaces the letters everywhere, without a reload, until it is removed",
  { tag: "@full" },
  async ({ page, context }) => {
    const project = await addedProject(page, "Iconic");
    const created = await page.request.post("/api/tasks", {
      data: { title: "Shows the Project's Icon", projectId: project.id, priority: "normal" },
    });
    expect(created.status()).toBe(201);
    const board = await context.newPage();
    await board.goto("/work");
    const boardMark = board
      .locator(".board-card", { hasText: "Shows the Project's Icon" })
      .locator(".project-mark");
    await expect(boardMark).toHaveText("AP");

    await page.goto(`/projects/${project.id}/appearance`);
    const row = versionTile(page, "Icon");
    const head = page.locator(".project-head .project-mark");
    const iconNote = page.getByText("The Icon shows in place of these letters.");
    await expect(
      page.getByText("PNG, JPEG, WebP or SVG, at most 2 MB. Saved as soon as picked."),
    ).toBeVisible();
    await expect(
      imageSection(page, "Icon").getByText(
        "in place of the mark's letters and colour, wherever the mark shows",
      ),
    ).toBeVisible();
    await expect(row.getByText("Drop an image or browse")).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove" })).toBeHidden();
    await expect(iconNote).toBeHidden();

    await versionFile(page, "Icon").setInputFiles(ICON_FILE);

    await expect(page.getByText("Light Icon saved for Iconic.")).toBeVisible();
    await expectLoadedImage(head.locator("img"));
    await expectLoadedImage(row.locator(".version-tile-image"));
    await expect(row.getByText("Drop an image or browse")).toBeHidden();
    // The picker edits the letters, so it keeps them; How it looks shows the Icon in their place.
    await expect(page.locator(".mark-picker .project-mark")).toHaveText("AP");
    await expect(iconNote).toBeVisible();
    const previewIcons = howItLooks(page).locator(".project-mark img");
    await expect(previewIcons).toHaveCount(3);
    for (const icon of await previewIcons.all()) await expectLoadedImage(icon);
    await expect(head).not.toHaveText("AP");
    await expectLoadedImage(boardMark.locator("img"));
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-icon.png") });

    await page.goto("/projects");
    await expectLoadedImage(
      page.getByRole("link", { name: /Iconic/ }).locator(".project-mark img"),
    );

    await page.goto(`/projects/${project.id}/appearance`);
    await versionTile(page, "Icon").getByRole("button", { name: "Remove" }).click();

    await expect(page.locator(".project-head .project-mark")).toHaveText("AP");
    await expect(boardMark).toHaveText("AP");
  },
);

test(
  "a Logo stands for the Project on its page, the list keeps the mark, and the mark comes back without it",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Logoed");
    await page.goto(`/projects/${project.id}/appearance`);
    const row = versionTile(page, "Logo");
    // An empty row shows a place for the Logo, not the mark that shows without one.
    await expect(row.getByText("Drop an image or browse")).toBeVisible();
    await expect(row.locator("img")).toHaveCount(0);
    await expect(
      imageSection(page, "Logo").getByText("Stands for the Project on its page, in place"),
    ).toBeVisible();

    await versionFile(page, "Logo").setInputFiles(LOGO_FILE);

    await expect(page.getByText("Light Logo saved for Logoed.")).toBeVisible();
    const headLogo = page.locator(".project-head .project-logo");
    await expectLoadedImage(headLogo);
    await expectLoadedImage(row.locator(".version-tile-image"));
    await expect(row.getByText("Drop an image or browse")).toBeHidden();
    // How it looks shows the Logo on the page head only, and the mark in the list and beside an item.
    await expect(howItLooks(page).locator(".project-logo")).toHaveCount(1);
    await expect(howItLooks(page).locator(".project-mark")).toHaveText(["AP", "AP"]);
    await expect(page.locator(".project-head .project-mark")).toBeHidden();
    // Its own proportions, 4 to 1, inside the head's limit.
    await expect(headLogo).toHaveJSProperty("naturalWidth", 400);
    const box = await headLogo.boundingBox();
    expect(box && Math.round(box.width / box.height)).toBe(4);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-logo.png") });

    // The Projects list keeps the mark, so every name starts at the same place.
    await page.goto("/projects");
    const card = page.getByRole("link", { name: /Logoed/ });
    await expect(card.locator(".project-mark")).toHaveText("AP");
    await expect(card.locator(".project-logo")).toHaveCount(0);
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-logo.png") });

    await page.goto(`/projects/${project.id}/appearance`);
    await versionTile(page, "Logo").getByRole("button", { name: "Remove" }).click();

    await expect(page.locator(".project-head .project-mark")).toHaveText("AP");
  },
);

test(
  "without a Logo the Icon stands in, with no tile behind it in the dark palette too",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Both images");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/projects/${project.id}/appearance`);
    await versionFile(page, "Icon").setInputFiles(TRANSPARENT_ICON_FILE);
    await versionFile(page, "Logo").setInputFiles(LOGO_FILE);
    await expectLoadedImage(page.locator(".project-head .project-logo"));
    await expectLoadedImage(versionTile(page, "Icon").locator(".version-tile-image"));
    await page.screenshot({ path: path.join(SCREENSHOTS, "dark-1600-project-images.png") });

    await versionTile(page, "Logo").getByRole("button", { name: "Remove" }).click();

    const head = page.locator(".project-head .project-mark");
    await expectLoadedImage(head.locator("img"));
    await expect(page.locator(".project-head .project-logo")).toBeHidden();
    await expectNoTile(head);

    await page.getByRole("radio", { name: "Custom" }).check();
    await page.getByLabel("Custom colour").fill(DARK_CUSTOM_COLOUR.value);
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Mark saved for Both images.")).toBeVisible();
    await expect(head).toHaveClass(/colour-custom/);
    await expectNoTile(head);
  },
);

test(
  "a replaced image shows at once, and its old address answers no more",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Reimaged");
    await page.goto(`/projects/${project.id}/appearance`);
    await versionFile(page, "Icon").setInputFiles(ICON_FILE);
    const image = page.locator(".project-head .project-mark img");
    await expectLoadedImage(image);
    const oldAddress = await image.getAttribute("src");

    await versionFile(page, "Icon").setInputFiles({ ...LOGO_FILE, name: "other.svg" });

    await expect(image).not.toHaveAttribute("src", oldAddress ?? "");
    await expectLoadedImage(image);
    expect((await page.request.get(oldAddress ?? "")).status()).toBe(404);
    await expect(
      versionTile(page, "Icon").getByRole("button", { name: "Replace", exact: true }),
    ).toBeVisible();
  },
);

test(
  "a file that isn't an image, or is too large, is refused in its row, and the image stays",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Refusing");
    await page.goto(`/projects/${project.id}/appearance`);
    await versionFile(page, "Icon").setInputFiles(ICON_FILE);
    const image = page.locator(".project-head .project-mark img");
    await expectLoadedImage(image);
    const address = await image.getAttribute("src");
    const row = versionTile(page, "Icon");

    await versionFile(page, "Icon").setInputFiles({
      name: "renamed.png",
      mimeType: "image/png",
      buffer: Buffer.from("<html>not a picture</html>"),
    });

    await expect(row.getByRole("alert")).toHaveText(
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    );
    await expect(image).toHaveAttribute("src", address ?? "");
    await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-image-refused.png") });

    await versionFile(page, "Icon").setInputFiles({
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(IMAGE_UPLOAD_BYTES + 1),
    });

    await expect(row.getByRole("alert")).toHaveText("An image may be at most 2 MB.");
    await expect(image).toHaveAttribute("src", address ?? "");

    await versionFile(page, "Icon").setInputFiles(LOGO_FILE);
    await expect(row.getByRole("alert")).toBeHidden();
  },
);

test(
  "the window to choose an image shows only images and folders, in any case",
  { tag: "@full" },
  async ({ page }) => {
    const imaged = await repositoryWithImages();
    try {
      const project = await addedProject(page, "Filtered images", undefined, imaged.path);
      await page.goto(`/projects/${project.id}/appearance`);

      const window = await openAssets(page, "Icon");

      await expect(window.locator(".repository-file-entry")).toHaveText([
        "old",
        "circle.svg",
        "fake.png",
        "icon.png",
        "logo.svg",
        "PHOTO.JPG",
      ]);
      await expect(window.getByRole("button", { name: "Choose file" })).toBeDisabled();

      await window.getByRole("button", { name: "Close" }).last().click();
      await expect(window).toBeHidden();
      await expect(page.locator(".project-head .project-mark")).toHaveText("AP");
    } finally {
      await imaged.remove();
    }
  },
);

test(
  "an Icon and a Logo chosen from the repository show everywhere, without a reload",
  { tag: "@full" },
  async ({ page }) => {
    const imaged = await repositoryWithImages();
    try {
      const project = await addedProject(page, "Chosen images", undefined, imaged.path);
      await page.goto(`/projects/${project.id}/appearance`);

      await chooseFromRepository(page, "Icon", "icon.png");

      await expect(page.getByText("Light Icon saved for Chosen images.")).toBeVisible();
      const iconRow = versionTile(page, "Icon");
      await expectLoadedImage(page.locator(".project-head .project-mark img"));
      await expectLoadedImage(iconRow.locator(".version-tile-image"));
      await expect(iconRow.getByRole("button", { name: "Replace", exact: true })).toBeVisible();

      await chooseFromRepository(page, "Logo", "logo.svg");

      await expect(page.getByText("Light Logo saved for Chosen images.")).toBeVisible();
      await expectLoadedImage(page.locator(".project-head .project-logo"));

      // The Projects list shows the Icon whether or not the Project holds a Logo.
      await page.goto("/projects");
      const card = page.getByRole("link", { name: /Chosen images/ });
      await expectLoadedImage(card.locator(".project-mark img"));

      await page.goto(`/projects/${project.id}/appearance`);
      await page
        .getByRole("group", { name: "Light Logo", exact: true })
        .getByRole("button", { name: "Remove" })
        .click();
      await expectLoadedImage(page.locator(".project-head .project-mark img"));
    } finally {
      await imaged.remove();
    }
  },
);

test(
  "a chosen image stays as it was after a new commit, until it is chosen again",
  { tag: "@full" },
  async ({ page }) => {
    const imaged = await repositoryWithImages();
    try {
      const project = await addedProject(page, "Copied image", undefined, imaged.path);
      await page.goto(`/projects/${project.id}/appearance`);
      await chooseFromRepository(page, "Icon", "icon.png");
      const image = page.locator(".project-head .project-mark img");
      await expectLoadedImage(image);
      const address = (await image.getAttribute("src")) ?? "";

      await commitFiles(imaged, { "assets/icon.png": LOGO_FILE.buffer });
      await page.reload();

      await expectLoadedImage(image);
      await expect(image).toHaveAttribute("src", address);
      const kept = await page.request.get(address);
      expect((await kept.body()).equals(ICON_FILE.buffer)).toBe(true);

      await chooseFromRepository(page, "Icon", "icon.png");

      await expect(image).not.toHaveAttribute("src", address);
      await expectLoadedImage(image);
      const chosenAgain = await page.request.get((await image.getAttribute("src")) ?? "");
      expect((await chosenAgain.body()).equals(LOGO_FILE.buffer)).toBe(true);
      expect((await page.request.get(address)).status()).toBe(404);
    } finally {
      await imaged.remove();
    }
  },
);

test(
  "a text file named .png is refused in its row, and the image stays",
  { tag: "@full" },
  async ({ page }) => {
    const imaged = await repositoryWithImages();
    try {
      const project = await addedProject(page, "Refused choice", undefined, imaged.path);
      await page.goto(`/projects/${project.id}/appearance`);
      await chooseFromRepository(page, "Icon", "icon.png");
      const image = page.locator(".project-head .project-mark img");
      await expectLoadedImage(image);
      const address = await image.getAttribute("src");

      await chooseFromRepository(page, "Icon", "fake.png");

      const row = versionTile(page, "Icon");
      await expect(row.getByRole("alert")).toHaveText(
        "The file isn't a PNG, JPEG, WebP or SVG image.",
      );
      await expect(image).toHaveAttribute("src", address ?? "");

      await chooseFromRepository(page, "Icon", "PHOTO.JPG");
      await expect(row.getByRole("alert")).toBeHidden();
    } finally {
      await imaged.remove();
    }
  },
);

test(
  "a Project whose folder has gone says so plainly in the window",
  { tag: "@full" },
  async ({ page }) => {
    const imaged = await repositoryWithImages();
    const project = await addedProject(page, "Gone folder", undefined, imaged.path);
    await imaged.remove();
    await page.goto(`/projects/${project.id}/appearance`);

    await versionTile(page, "Icon").getByRole("button", { name: "Choose from repository" }).click();

    const window = page.getByRole("dialog", { name: "Choose Light Icon" });
    const refusal = window.getByRole("status");
    await expect(refusal).toContainText("The base branch can't be read");
    await expect(refusal).not.toContainText("Internal server error");
  },
);

// As a user of its own, since it chooses palettes, which are each user's.
asOwnUser(
  "a dark Logo shows in the dark palette, swapped without a reload, and the light one stands in without it",
  { tag: "@full" },
  async ({ page, context }) => {
    const project = await addedProject(page, "Two-toned");
    await page.goto(`/projects/${project.id}/appearance`);
    await versionFile(page, "Logo", "Light").setInputFiles(LOGO_FILE);
    await expect(page.getByText("Light Logo saved for Two-toned.")).toBeVisible();
    const darkTile = versionTile(page, "Logo", "Dark");
    // One version alone shows in both palettes, and the empty tile says so.
    await expect(darkTile.getByText("Uses the light version")).toBeVisible();

    await versionFile(page, "Logo", "Dark").setInputFiles(DARK_LOGO_FILE);

    await expect(page.getByText("Dark Logo saved for Two-toned.")).toBeVisible();
    const lightAddress = await imageAddressIn(versionTile(page, "Logo", "Light"));
    const darkAddress = await imageAddressIn(darkTile);
    await expect(darkTile.getByText("Uses the light version")).toBeHidden();
    const headLogo = page.locator(".project-head .project-logo");
    await expect(headLogo).toHaveAttribute("src", lightAddress);
    const previewLogos = howItLooks(page).locator(".project-logo");
    await expect(previewLogos).toHaveCount(1);
    for (const logo of await previewLogos.all())
      await expect(logo).toHaveAttribute("src", lightAddress);

    // How it looks shows the other palette on its own, with that palette's version.
    await howItLooks(page).getByRole("tab", { name: "Dark" }).click();
    for (const logo of await previewLogos.all())
      await expect(logo).toHaveAttribute("src", darkAddress);
    await expect(headLogo).toHaveAttribute("src", lightAddress);
    await howItLooks(page).getByRole("tab", { name: "Light" }).click();

    const settings = await context.newPage();
    await settings.goto("/account/appearance");
    await settings
      .getByRole("group", { name: "Palette" })
      .getByRole("button", { name: "Dark" })
      .click();

    await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
    await expect(headLogo).toHaveAttribute("src", darkAddress);
    await expectLoadedImage(headLogo);

    // Graphite, Midnight, Mocha, Aubergine, Lagoon and Emerald count as dark, and Paper, Mist, Sage,
    // Lavender, Cobalt and Citrine as light, on the page and in How it looks, which opens on the version
    // for the palette shown.
    for (const [name, base, address] of [
      ["Graphite", "Dark", darkAddress],
      ["Paper", "Light", lightAddress],
      ["Midnight", "Dark", darkAddress],
      ["Mist", "Light", lightAddress],
      ["Mocha", "Dark", darkAddress],
      ["Sage", "Light", lightAddress],
      ["Aubergine", "Dark", darkAddress],
      ["Lavender", "Light", lightAddress],
      ["Lagoon", "Dark", darkAddress],
      ["Cobalt", "Light", lightAddress],
      ["Emerald", "Dark", darkAddress],
      ["Citrine", "Light", lightAddress],
    ] as const) {
      await settings.getByRole("group", { name: "Palette" }).getByRole("button", { name }).click();
      await expect(page.locator("html")).toHaveAttribute("data-palette", name.toLowerCase());
      await page.goto(`/projects/${project.id}/appearance`);
      await expect(headLogo).toHaveAttribute("src", address);
      await expect(howItLooks(page).getByRole("tab", { name: base })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      for (const logo of await previewLogos.all())
        await expect(logo).toHaveAttribute("src", address);
      await page.screenshot({
        path: path.join(SCREENSHOTS, `${name.toLowerCase()}-1600-project-appearance.png`),
      });
    }

    await page.goto(`/projects/${project.id}/appearance`);
    await darkTile.getByRole("button", { name: "Remove" }).click();

    await expect(page.getByText("Dark Logo removed for Two-toned.")).toBeVisible();
    await expect(darkTile.getByText("Uses the light version")).toBeVisible();
    await expect(headLogo).toHaveAttribute("src", lightAddress);
    expect((await page.request.get(darkAddress)).status()).toBe(404);
    await settings
      .getByRole("group", { name: "Palette" })
      .getByRole("button", { name: "Light" })
      .click();
    await settings.close();
  },
);

test(
  "a file dropped on a tile is saved, and one too large is refused inside the tile",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Dropped on");
    await page.goto(`/projects/${project.id}/appearance`);
    const tile = versionTile(page, "Icon", "Dark");
    // The zone is named for what a press does, which changes once a version is held.
    const zone = tile.locator(".version-tile-drop");
    await expect(zone).toHaveAccessibleName("Upload a Dark Icon");

    await zone.dispatchEvent("dragenter", { dataTransfer: await fileTransfer(page, ICON_FILE) });
    await expect(zone).toHaveClass(/dragged-over/);
    await zone.dispatchEvent("drop", { dataTransfer: await fileTransfer(page, ICON_FILE) });

    await expect(page.getByText("Dark Icon saved for Dropped on.")).toBeVisible();
    await expect(zone).not.toHaveClass(/dragged-over/);
    await expectLoadedImage(tile.locator(".version-tile-image"));
    const address = await imageAddressIn(tile);
    // The light palette shows the dark version, the only one held.
    await expect(page.locator(".project-head .project-mark img")).toHaveAttribute("src", address);
    await expect(
      versionTile(page, "Icon", "Light").getByText("Uses the dark version"),
    ).toBeVisible();

    await expect(zone).toHaveAccessibleName("Replace the Dark Icon");
    await zone.dispatchEvent("drop", {
      dataTransfer: await fileTransfer(page, {
        name: "large.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(IMAGE_UPLOAD_BYTES + 1),
      }),
    });

    await expect(tile.getByRole("alert")).toHaveText("An image may be at most 2 MB.");
    await expect(versionTile(page, "Icon", "Light").getByRole("alert")).toHaveCount(0);
    await expect(tile.locator(".version-tile-image")).toHaveAttribute("src", address);
  },
);

test(
  "a version tile opens the file picker from the keyboard",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Keyed");
    await page.goto(`/projects/${project.id}/appearance`);
    const zone = versionTile(page, "Logo", "Light").getByRole("button", {
      name: "Upload a Light Logo",
    });
    await zone.focus();
    await expect(zone).toBeFocused();
    await expect(zone).toHaveCSS("outline-style", "solid");

    const picking = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await picking).setFiles(LOGO_FILE);

    await expect(page.getByText("Light Logo saved for Keyed.")).toBeVisible();
  },
);

/** The address of the version a tile previews. */
async function imageAddressIn(tile: Locator): Promise<string> {
  const image = tile.locator(".version-tile-image");
  await expectLoadedImage(image);
  return (await image.getAttribute("src")) ?? "";
}

/** A drag's data holding one file, made in the page as a drop from the desktop would be. */
async function fileTransfer(
  page: Page,
  file: { readonly name: string; readonly mimeType: string; readonly buffer: Buffer },
) {
  return page.evaluateHandle(
    ({ name, mimeType, base64 }) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], name, { type: mimeType }));
      return transfer;
    },
    { name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") },
  );
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [1600, 600]) {
    test(
      `Appearance and the window to choose an image hold together, ${colorScheme} at ${width}`,
      { tag: "@full" },
      async ({ page }) => {
        const imaged = await repositoryWithImages();
        try {
          const project = await addedProject(
            page,
            `Look ${colorScheme} ${width}`,
            undefined,
            imaged.path,
          );
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.goto(`/projects/${project.id}/appearance`);
          await expectAppearanceLaidOut(page, width);
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${colorScheme}-${width}-project-appearance.png`),
          });

          await chooseFromRepository(page, "Icon", "circle.svg");
          await chooseFromRepository(page, "Logo", "logo.svg");
          await expectLoadedImage(page.locator(".project-head .project-logo"));
          const button = page
            .getByRole("group", { name: "Light Logo", exact: true })
            .getByRole("button", { name: "Choose from repository" });
          // Centred, as scrollIntoViewIfNeeded leaves a button a fraction of a pixel past the edge.
          await button.evaluate((element) => element.scrollIntoView({ block: "center" }));
          await expect(button).toBeInViewport({ ratio: 1 });
          await expectAppearanceLaidOut(page, width);
          await expect(page.getByText(/saved for Look/)).toHaveCount(0);
          await page.locator(".shell-main").evaluate((main) => main.scrollTo(0, 0));
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${colorScheme}-${width}-project-images-appearance.png`),
          });
          // Each version's tile on its own palette's page, a light version held and a dark one not.
          await page.locator(".project-image-versions").screenshot({
            path: path.join(SCREENSHOTS, `${colorScheme}-${width}-project-image-versions.png`),
          });

          const fileWindow = await openAssets(page, "Icon");
          await fileWindow.getByRole("button", { name: "icon.png" }).click();
          await expect(fileWindow.getByRole("button", { name: "icon.png" })).toHaveAttribute(
            "aria-pressed",
            "true",
          );
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${colorScheme}-${width}-project-image-window.png`),
          });
        } finally {
          await imaged.remove();
        }
      },
    );

    test(
      `the add dialog's mark holds together, ${colorScheme} at ${width}`,
      { tag: "@full" },
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.goto("/projects");
        await page.getByRole("button", { name: "Add a Project", exact: true }).click();
        await chooseFolder(page, repository.path);
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Name").fill("Swatched");
        const colours = dialog.getByRole("radiogroup", { name: "Colour" });
        await colours.getByRole("radio", { name: "Custom" }).check();

        await expect(colours.getByRole("radio")).toHaveCount(5);
        await expect(dialog.getByLabel("Custom colour")).toBeVisible();
        const scrollsSideways = await dialog
          .locator(".dialog-body")
          .evaluate((body) => body.scrollWidth > body.clientWidth);
        expect(scrollsSideways).toBe(false);
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${colorScheme}-${width}-add-project-mark.png`),
        });
      },
    );
  }
}

/**
 * Appearance's columns, the cards beside How it looks on a wide page and under it on a narrow
 * one, with nothing scrolling sideways.
 */
async function expectAppearanceLaidOut(page: Page, width: number): Promise<void> {
  await expect(
    page.locator(".project-section").getByRole("heading", { name: ANY_BLOCK }),
  ).toHaveText(APPEARANCE_BLOCKS);
  const preview = await howItLooks(page).boundingBox();
  const mark = await page.locator(".appearance-edit").boundingBox();
  expect(preview && mark).toBeTruthy();
  if (preview && mark) {
    if (width >= 1600) expect(preview.x).toBeGreaterThanOrEqual(mark.x + mark.width);
    else expect(preview.y + preview.height).toBeLessThanOrEqual(mark.y);
  }
  const scrollsSideways = await page.evaluate(() => {
    const main = document.querySelector(".shell-main");
    return (
      document.documentElement.scrollWidth > window.innerWidth ||
      (main !== null && main.scrollWidth > main.clientWidth)
    );
  });
  expect(scrollsSideways).toBe(false);
}

test(
  "an Icon whose versions can't be loaded leaves the letters and the colour",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Unloaded");
    for (const palette of ["light", "dark"]) {
      const response = await page.request.post(
        `/api/projects/${project.id}/images/icon/${palette}`,
        { headers: { "Content-Type": "application/octet-stream" }, data: ICON_FILE.buffer },
      );
      expect(response.status()).toBe(201);
    }
    await page.route("**/images/*/content", (route) => route.abort());

    await page.goto(`/projects/${project.id}/appearance`);

    const head = page.locator(".project-head .project-mark");
    await expect(head).toHaveText("AP");
    await expect(head).toHaveClass(/colour-violet/);
    await expect(head).not.toHaveClass(/has-icon/);
    await expect(head).not.toHaveCSS("background-color", NO_TILE.background);
  },
);

test(
  "an SVG's script runs neither where The Office draws it nor at its own address",
  { tag: "@full" },
  async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const project = await addedProject(page, "Scripted");
    await page.goto(`/projects/${project.id}/appearance`);

    await versionFile(page, "Icon").setInputFiles(SVG_WITH_A_SCRIPT);

    const image = page.locator(".project-head .project-mark img");
    await expectLoadedImage(image);
    const address = await image.getAttribute("src");

    await page.goto(address ?? "");

    await expect(page.locator("svg")).toBeAttached();
    await expect(page.locator("svg")).not.toHaveAttribute("data-script-ran", "yes");
    expect(dialogs).toEqual([]);
  },
);

test(
  "a custom colour is previewed, saved, and shown everywhere until a named one replaces it",
  { tag: "@full" },
  async ({ page, context }) => {
    const project = await addedProject(page, "Custom look");
    const projectsTab = await context.newPage();
    await projectsTab.goto("/projects");
    await page.goto(`/projects/${project.id}/appearance`);
    const head = page.locator(".project-head .project-mark");
    const picker = page.locator(".mark-picker");
    const preview = picker.locator(".project-mark");
    const customColour = picker.getByLabel("Custom colour");
    await expect(customColour).toHaveCount(0);

    await picker.getByRole("radio", { name: "Custom" }).check();
    await customColour.fill(LIGHT_CUSTOM_COLOUR.value);

    await expect(picker.getByText(LIGHT_CUSTOM_COLOUR.value)).toBeVisible();
    await expectCustomMark(preview, LIGHT_CUSTOM_COLOUR);
    await expect(head).toHaveClass(/colour-violet/);

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Mark saved for Custom look.")).toBeVisible();
    await expectCustomMark(head, LIGHT_CUSTOM_COLOUR);
    const cardInTheOtherTab = projectsTab
      .getByRole("link", { name: /Custom look/ })
      .locator(".project-mark");
    await expectCustomMark(cardInTheOtherTab, LIGHT_CUSTOM_COLOUR);

    await page.reload();
    await expectCustomMark(page.locator(".project-head .project-mark"), LIGHT_CUSTOM_COLOUR);
    await expect(picker.getByRole("radio", { name: "Custom" })).toBeChecked();
    await expect(customColour).toHaveValue(LIGHT_CUSTOM_COLOUR.value);

    await customColour.fill(DARK_CUSTOM_COLOUR.value);
    await expectCustomMark(preview, DARK_CUSTOM_COLOUR);

    await picker.getByRole("radio", { name: "Teal" }).check();
    await expect(customColour).toHaveCount(0);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(head).toHaveClass(/colour-teal/);
    await expect(cardInTheOtherTab).toHaveClass(/colour-teal/);
    await expect(head).not.toHaveClass(/colour-custom/);
  },
);

test("a Project is added with a custom colour", { tag: "@full" }, async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add a Project", exact: true }).click();
  await fillTheForm(page, { name: "Own colour", path: repository.path, branch: "main" });
  const form = page.getByRole("dialog");

  await form.getByRole("radio", { name: "Custom" }).check();
  await form.getByLabel("Custom colour").fill(DARK_CUSTOM_COLOUR.value);
  await expectCustomMark(form.locator(".mark-picker .project-mark"), DARK_CUSTOM_COLOUR);
  await page.getByRole("button", { name: "Add the Project" }).click();

  await expect(page).toHaveURL(/\/projects\/own-colour$/);
  await expectCustomMark(page.locator(".project-head .project-mark"), DARK_CUSTOM_COLOUR);
});

test(
  "a custom colour stays the same in both palettes, its tile's edge showing",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Pale mark");
    await page.goto(`/projects/${project.id}/appearance`);
    const head = page.locator(".project-head .project-mark");
    await page.getByRole("radio", { name: "Custom" }).check();
    await page.getByLabel("Custom colour").fill(PAGE_LIKE_CUSTOM_COLOUR.value);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(head).toHaveClass(/colour-custom/);

    for (const palette of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: palette });
      await expect(page.locator("html")).toHaveAttribute("data-palette", palette);
      await expectCustomMark(head, PAGE_LIKE_CUSTOM_COLOUR);
      await expect(head).toHaveCSS("border-top-width", TILE_EDGE_WIDTH);
    }
  },
);

test(
  "a mark changed in one tab shows in another, on its cards and an untouched Appearance",
  { tag: "@full" },
  async ({ page, context }) => {
    const project = await addedProject(page, "Two marks");
    const projectsTab = await context.newPage();
    const appearanceTab = await context.newPage();
    const subscribed = [projectsTab, appearanceTab].map(
      (tab) =>
        new Promise<void>((resolve) => {
          tab.on("websocket", (socket) => {
            socket.on("framereceived", ({ payload }) => {
              if (
                String(payload).includes('"subscriptions"') &&
                String(payload).includes("project.mark-changed")
              ) {
                resolve();
              }
            });
          });
        }),
    );
    await projectsTab.goto("/projects");
    await appearanceTab.goto(`/projects/${project.id}/appearance`);
    await Promise.all(subscribed);
    await page.goto(`/projects/${project.id}/appearance`);

    await page.getByLabel("Mark label").fill("TM");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(
      projectsTab.getByRole("link", { name: /Two marks/ }).locator(".project-mark"),
    ).toHaveText("TM");
    await expect(appearanceTab.getByLabel("Mark label")).toHaveValue("TM");
    await expect(howItLooks(appearanceTab).locator(".project-mark")).toHaveText(["TM", "TM", "TM"]);
    await expect(howItLooks(appearanceTab).getByText("Not saved")).toBeHidden();
  },
);

test(
  "a label that isn't letters or digits is refused in Appearance, and what was typed stays",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Bad label");
    await page.goto(`/projects/${project.id}/appearance`);

    await page.getByLabel("Mark label").fill("A-");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "The mark's label is 1 to 3 letters or digits.",
    );
    await expect(page.getByLabel("Mark label")).toHaveValue("A-");
    await expect(page.locator(".project-head .project-mark")).toHaveText("AP");

    await page.getByLabel("Mark label").fill("AB");
    await expect(page.getByRole("alert")).toHaveCount(0);
  },
);

test(
  "an edit made while Appearance saves stays as the next draft",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Quick hands");
    await page.goto(`/projects/${project.id}/appearance`);
    let finishSave: (() => void) | undefined;
    const saveHeld = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    await page.route(`**/api/projects/${project.id}/mark`, async (route) => {
      await saveHeld;
      await route.continue();
    });
    const label = page.getByLabel("Mark label");

    await label.fill("QH");
    await page.getByRole("button", { name: "Save" }).click();
    await label.fill("Q2");
    finishSave?.();

    await expect(page.locator(".project-head .project-mark")).toHaveText("QH");
    await expect(label).toHaveValue("Q2");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  },
);

test(
  "the add form's label follows the name until the user writes one, its colour kept",
  { tag: "@full" },
  async ({ page }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Add a Project", exact: true }).click();
    await chooseFolder(page, repository.path);
    const form = page.getByRole("dialog");
    const label = form.getByLabel("Mark label");

    await form.getByRole("radio", { name: "Violet" }).check();
    await form.getByLabel("Name").fill("Admin panel");
    await expect(label).toHaveValue("AP");
    await form.getByLabel("Name").fill("Billing service tools");
    await expect(label).toHaveValue("BST");
    await expect(form.locator(".mark-picker .project-mark")).toHaveClass(/colour-violet/);

    await label.fill("X1");
    await form.getByLabel("Name").fill("Admin panel");
    await expect(label).toHaveValue("X1");
    await expect(form.locator(".mark-picker .project-mark")).toHaveClass(/colour-violet/);
  },
);

const VALID_RUN_ENVIRONMENT = {
  ".devcontainer/devcontainer.json": '{ "dockerComposeFile": "compose.yaml", "service": "app" }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

function runEnvironmentBlock(page: Page): Locator {
  return page.locator(".project-section");
}

/** Turns the Project's Run environment On or Off as its block's switch does. */
async function switchRunEnvironment(page: Page, projectId: string, setting: "on" | "off") {
  const changed = await page.request.put(`/api/projects/${projectId}/run-environment`, {
    data: { runEnvironment: setting },
  });
  expect(changed.status(), await changed.text()).toBe(200);
}

// Set up run environment without a valid .devcontainer/ starts an Off-board Task, whose session
// takes a script, so pressing it is people.e2e.ts's, as is Add a Project's Yes on such a repository.
test(
  "Run environment starts Off with its tab hidden, turns On with no .devcontainer/ on the base branch, and offers to set up one that isn't valid",
  { tag: "@full" },
  async ({ page }) => {
    const ownRepository = await createTemporaryRepository();
    try {
      const project = await addedProject(
        page,
        "Run environment set-up",
        undefined,
        ownRepository.path,
      );
      expect(project.runEnvironment).toBe("off");
      await page.goto(`/projects/${project.id}/run-environment`);
      await expect(
        page.getByText(`Run environment is switched off for «${project.name}».`),
      ).toBeVisible();

      await switchRunEnvironment(page, project.id, "on");
      await page.reload();
      const block = runEnvironmentBlock(page);
      await expect(block.getByRole("tab", { name: "On" })).toHaveAttribute("aria-selected", "true");
      await expect(block.getByText("Not found")).toBeVisible();
      await expect(block).toContainText(
        "each Task's checks run in the containers the .devcontainer/ on the Task's own branch defines",
      );
      await expect(block.getByText("Not decided yet")).toHaveCount(0);
      await expect(block.getByRole("alert")).toHaveCount(0);

      await block.getByRole("tab", { name: "Off" }).click();
      await expect(page.getByText(`Checks in ${project.name} run on this computer.`)).toBeVisible();
      await expect(
        page.getByText(`Run environment is switched off for «${project.name}».`),
      ).toBeVisible();

      await commitFiles(ownRepository, {
        ".devcontainer/devcontainer.json": '{ "dockerComposeFile": "compose.yaml" }',
      });
      await switchRunEnvironment(page, project.id, "on");
      await page.reload();
      await expect(block.getByText("Not valid")).toBeVisible();
      await expect(block.getByText("devcontainer.json names no service")).toBeVisible();
      await expect(block.getByRole("button", { name: "Set up run environment" })).toBeVisible();
    } finally {
      await ownRepository.remove();
    }
  },
);

test(
  "Features' Run environment switch turns it On at once, with no .devcontainer/ on the base branch",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Run environment at once");
    await page.goto(`/projects/${project.id}/features`);
    await page
      .getByRole("group", { name: "Run environment", exact: true })
      .getByRole("switch")
      .click();

    await expect(page.getByText(/run in its run environment\./)).toBeVisible();
    await page.goto(`/projects/${project.id}/run-environment`);
    const block = runEnvironmentBlock(page);
    await expect(block.getByRole("tab", { name: "On" })).toHaveAttribute("aria-selected", "true");
    await expect(block.getByRole("button", { name: "Set up run environment" })).toBeVisible();
  },
);

/**
 * Adds a Project from the folder in the window, answering its run environment question, which
 * starts at No.
 */
test(
  "Add a Project asks about a run environment: Yes turns a valid one On, No leaves it Off",
  { tag: "@full" },
  async ({ page }) => {
    const withDefinition = await createTemporaryRepository();
    try {
      await commitFiles(withDefinition, VALID_RUN_ENVIRONMENT);
      const block = runEnvironmentBlock(page);

      const off = await addAnswering(page, "Run environment no", repository.path, "No");
      expect(off.runEnvironment).toBe("off");
      await page.goto(`/projects/${off.id}/run-environment`);
      await expect(
        page.getByText(`Run environment is switched off for «${off.name}».`),
      ).toBeVisible();

      const on = await addAnswering(
        page,
        "Run environment yes at once",
        withDefinition.path,
        "Yes",
      );
      expect(on.runEnvironment).toBe("on");
      await page.goto(`/projects/${on.id}/run-environment`);
      await expect(block.getByRole("tab", { name: "On" })).toHaveAttribute("aria-selected", "true");
      await expect(
        block.getByRole("region", { name: /^Set up the run environment · / }),
      ).toHaveCount(0);
    } finally {
      await withDefinition.remove();
    }
  },
);

test(
  "a Project's tabs open each section at its own address, which survives a reload",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Menu sections");
    // A new Project's Run environment is Off, which hides its tab.
    const shown = SECTIONS.filter(({ name }) => name !== "Run environment");
    await page.goto(`/projects/${project.id}`);
    await expect(projectTabs(page).getByRole("tab")).toHaveText(
      shown.map((section) => section.name),
    );

    // Overview last, as it opens first and its tab must also come back from a section.
    for (const section of [...shown.slice(1), shown[0]!]) {
      await projectTabs(page).getByRole("tab", { name: section.name, exact: true }).click();
      await expect(page).toHaveURL(`/projects/${project.id}${section.address}`);
      await expectOpenSection(page, project, section);

      await page.reload();
      await expectOpenSection(page, project, section);
    }
  },
);

test(
  "a Project that doesn't exist says so at each section's address, with the way back",
  { tag: "@full" },
  async ({ page }) => {
    for (const section of SECTIONS) {
      await page.goto(`/projects/nowhere${section.address}`);

      await expect(page.getByText('There is no Project "nowhere".')).toBeVisible();
      await expect(projectTabs(page)).toHaveCount(0);
      await page.getByRole("link", { name: "Back to Projects" }).click();
      await expect(page).toHaveURL(/\/projects$/);
    }
  },
);

/** A base branch a pairing environment starts from: a valid `.devcontainer/` alone. */
const PAIRING_DEFINITION = {
  ".devcontainer/devcontainer.json":
    '{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }',
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

// The e2e service's scripted runtime answers adb as a phone that pairs and is a Pixel 9
// (`ScriptedAdb`, in apps/service/src/e2e.ts); the Task's run environment never runs, so the lent
// phone waits for it and goes back Paired.
test("a phone paired on the Project's Devices is lent to a Task, given back and Paired again", async ({
  page,
}) => {
  const withDefinition = await createTemporaryRepository();
  try {
    await commitFiles(withDefinition, PAIRING_DEFINITION);
    const project = await addedProject(
      page,
      `Paired phones ${Date.now()}`,
      undefined,
      withDefinition.path,
    );
    const on = await page.request.put(`/api/projects/${project.id}/run-environment`, {
      data: { runEnvironment: "on" },
    });
    expect(on.status(), await on.text()).toBe(200);
    const switched = await page.request.put(`/api/projects/${project.id}/features`, {
      data: { features: { "connected-devices": true } },
    });
    expect(switched.status(), await switched.text()).toBe(200);
    const created = await page.request.post("/api/tasks", {
      data: { title: "Try the shop on a phone", projectId: project.id, priority: "normal" },
    });
    expect(created.status()).toBe(201);
    const task = taskSchema.parse(await created.json());

    await page.goto(`/projects/${project.id}/devices`);
    await page.getByRole("button", { name: "Add a device" }).click();
    await page
      .getByRole("menu")
      .getByRole("button", { name: "Phone over wireless debugging" })
      .click();
    const window = page.getByRole("dialog", { name: "Add a phone over wireless debugging" });
    await window.getByLabel("IP address").fill("192.168.1.20");
    await window.getByLabel("Port", { exact: true }).fill("37000");
    await window.getByLabel("Pairing port").fill("37001");
    await window.getByLabel("Pairing code").fill("123456");
    await window.getByRole("button", { name: "Pair" }).click();
    await expect(page.getByText(`Pixel 9 paired with ${project.name}.`)).toBeVisible();
    await expect(window).toBeHidden();
    const projectDevices = page.getByRole("list", { name: `${project.name}'s devices` });
    const phone = projectDevices.getByRole("listitem", { name: "Pixel 9" });
    await expect(phone).toContainText("Paired");
    await expect(phone).toContainText("Not used yet");

    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: "Use a Project device" }).click();
    await page
      .getByRole("menu")
      .getByRole("button", { name: /^Pixel 9/ })
      .click();
    await expect(page.getByText("Pixel 9 connected.")).toBeVisible();
    const lent = page
      .getByRole("list", { name: "Devices connected" })
      .getByRole("listitem", { name: "Pixel 9" });
    await expect(lent.getByRole("link", { name: `From ${project.name}'s devices` })).toBeVisible();
    await lent.getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText(`Pixel 9 given back to ${project.name}'s devices.`)).toBeVisible();

    await page.goto(`/projects/${project.id}/devices`);
    await expect(phone).toContainText("Paired");
    await expect(phone).toContainText(`Last used by ${task.title} · `);
    await expect(phone).toContainText("given back");
  } finally {
    await withDefinition.remove();
  }
});

test("on a wide page the Projects list sits beside the open Project, and switches it", async ({
  page,
}) => {
  const first = await addedProject(page, "Listed first");
  const second = await addedProject(page, "Listed second");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/projects");

  const list = projectsList(page);
  const item = (project: Project): Locator =>
    list.getByRole("link", { name: project.name, exact: true });
  await expect(item(first)).toBeVisible();
  await expect(item(second)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projects");
  await expect(page.getByText("Open a Project from the list, or add one")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add it yourself" })).toBeVisible();
  await expect(page.getByRole("link", { name: "‹ All Projects" })).toHaveCount(0);
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1600-projects-list.png") });

  await page.getByRole("button", { name: "Add a Project", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Add a Project" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await item(first).click();
  await expect(page).toHaveURL(`/projects/${first.id}`);
  await expect(list).toBeVisible();
  await expect(item(first)).toHaveClass(/active/);
  await expect(item(second)).not.toHaveClass(/active/);
  await expect(
    page.locator(".project-head").getByRole("heading", { name: first.name }),
  ).toBeVisible();

  await projectTabs(page).getByRole("tab", { name: "Pipelines" }).click();
  await expect(page).toHaveURL(`/projects/${first.id}/pipelines`);
  await expect(item(first)).toHaveClass(/active/);
  const listBox = await list.boundingBox();
  const headBox = await page.locator(".project-head").boundingBox();
  expect(listBox && headBox).toBeTruthy();
  if (listBox && headBox) expect(headBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width);
  await page.screenshot({
    path: path.join(TASK_SCREENSHOTS, "light-1600-project-beside-list.png"),
  });

  await item(second).click();
  await expect(page).toHaveURL(`/projects/${second.id}`);
  await expect(item(second)).toHaveClass(/active/);
  await expect(item(first)).not.toHaveClass(/active/);
  await expect(projectTabs(page).getByRole("tab", { selected: true })).toHaveText("Overview");
});

test("on a narrow page the Projects list shows alone, then the Project with the way back", async ({
  page,
}) => {
  const project = await addedProject(page, "Narrow listed");
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/projects");

  const list = projectsList(page);
  await expect(list).toBeVisible();
  await expect(page.getByText("Open a Project from the list, or add one")).toBeHidden();
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1000-projects-list.png") });

  await list.getByRole("link", { name: project.name, exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  await expect(list).toBeHidden();
  await expect(
    page.locator(".project-head").getByRole("heading", { name: project.name }),
  ).toBeVisible();
  const back = page.getByRole("link", { name: "‹ All Projects" });
  await expect(back).toBeVisible();
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1000-project.png") });

  await back.click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(list).toBeVisible();
});

/** One tile of the Overview's dashboard, by its title. */
function overviewTile(page: Page, title: string): Locator {
  return page
    .locator(".project-overview-tile")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

test("a Project's Overview is a dashboard: Onboarding, Work, then its tiles, updating live", async ({
  page,
}) => {
  const project = await addedProject(page, "Dashboard overview");
  const created = await page.request.post("/api/tasks", {
    data: { title: "Ship the dashboard", projectId: project.id, priority: "normal" },
  });
  expect(created.status()).toBe(201);
  const task = taskSchema.parse(await created.json());
  await page.goto(`/projects/${project.id}`);

  await expect(
    page.locator(".project-section").getByRole("heading", { name: ANY_BLOCK }),
  ).toHaveText(OVERVIEW_BLOCKS);
  const activity = overviewTile(page, "Recent activity");
  await expect(activity).toContainText("Nothing in the last 7 days.");
  await expect(overviewTile(page, "Initiatives")).toContainText(
    `No Initiative spans ${project.name} right now.`,
  );
  await expect(
    overviewTile(page, "Environment").getByRole("link", { name: "Environment" }),
  ).toHaveAttribute("href", `/projects/${project.id}/environment`);

  // Done without a walk, held archived so no event tells the page yet; Restore is the event.
  await queryOfficeDatabase(
    `update tasks set state = 'done', ended_at = now(), archived_at = now() where id = $1`,
    [task.id],
  );
  const restored = await page.request.post(`/api/tasks/${task.id}/restore`);
  expect(restored.ok()).toBe(true);
  await expect(activity).toContainText("Done:");
  await expect(activity.getByRole("link", { name: task.title })).toHaveAttribute(
    "href",
    `/tasks/${task.id}`,
  );
  await activity.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1600-project-overview.png") });

  // A narrow pane lays the tiles in one column.
  await page.setViewportSize({ width: 600, height: 900 });
  const lefts = await page
    .locator(".project-overview-tile")
    .evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  await overviewTile(page, "Environment").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-600-project-overview.png") });
});

test(
  "a Project's deep addresses open the same section after a reload, beside the list",
  { tag: "@full" },
  async ({ page }) => {
    const project = await addedProject(page, "Deep linked");
    const base = await addedBasePipeline(page, "Deep base");
    const own = await addedProjectPipeline(page, project.id, base, "Deep own");
    await page.setViewportSize({ width: 1600, height: 900 });
    const item = projectsList(page).getByRole("link", { name: project.name, exact: true });

    const files = `/projects/${project.id}/files?branch=main&path=README.md`;
    await page.goto(files);
    await page.reload();
    await expect(page).toHaveURL(files);
    await expect(projectTabs(page).getByRole("tab", { selected: true })).toHaveText("Files");
    await expect(
      page.getByRole("tree", { name: "Files on main" }).locator('[data-path="README.md"]'),
    ).toHaveAttribute("aria-selected", "true");
    await expect(item).toHaveClass(/active/);

    const pipeline = `/projects/${project.id}/pipelines/${own.id}`;
    await page.goto(pipeline);
    await page.reload();
    await expect(page).toHaveURL(pipeline);
    await expect(projectTabs(page).getByRole("tab", { selected: true })).toHaveText("Pipelines");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(own.name);
    await expect(item).toHaveClass(/active/);
  },
);

test(
  "a Project the Project filter hides still opens beside the list, with no item marked",
  { tag: "@full" },
  async ({ page }) => {
    const shown = await addedProject(page, "Filter shown");
    const hidden = await addedProject(page, "Filter hidden");
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/projects");
    await page.getByRole("button", { name: /^Project filter:/ }).click();
    await page.getByRole("button", { name: `Show only ${shown.name}` }).click();
    await page.keyboard.press("Escape");
    const list = projectsList(page);
    await expect(list.getByRole("link", { name: shown.name, exact: true })).toBeVisible();
    await expect(list.getByRole("link", { name: hidden.name, exact: true })).toHaveCount(0);
    await expect(page.getByText(/hidden by the Project filter/)).toBeVisible();

    await page.goto(`/projects/${hidden.id}`);
    await expect(
      page.locator(".project-head").getByRole("heading", { name: hidden.name }),
    ).toBeVisible();
    await expect(list.locator("a.active")).toHaveCount(0);
  },
);

test("a Project command Action is added, marked Leaves the workstation, and removed, in the Actions section", async ({
  page,
}) => {
  const project = await addedProject(page, "Actions defined");
  await page.goto(`/projects/${project.id}/actions`);
  const list = page.getByRole("navigation", { name: `${project.name}'s Actions` });
  await expect(page.getByText(/^No Actions yet\./)).toBeVisible();

  await page.getByRole("button", { name: "Add an Action" }).first().click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Key").fill("build-web");
  await editor.getByLabel("Name").fill("Build web");
  await editor.getByRole("radio", { name: /^Project command/ }).check();
  await editor.getByLabel("Command", { exact: true }).selectOption("build");
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1600-action-editor.png") });
  await editor.getByRole("button", { name: "Add the Action" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByText("Build web added.")).toBeVisible();
  const row = list.getByRole("listitem").filter({ hasText: "Build web" });
  await expect(row).toContainText("build-web");
  await expect(row).toContainText("Project command · build");
  await expect(row).toContainText("Set by you");
  await expect(row).not.toContainText("Leaves the workstation");

  await row.getByRole("button", { name: "Change Build web" }).click();
  await expect(editor.getByText("build-web", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Key")).toHaveCount(0);
  const mark = editor
    .locator("label")
    .filter({ hasText: "Leaves the workstation" })
    .getByRole("checkbox");
  await expect(mark).toHaveAttribute("aria-checked", "false");
  await mark.click();
  await expect(mark).toHaveAttribute("aria-checked", "true");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();
  await expect(row).toContainText("Leaves the workstation");

  // The mark and who set it outlive a reload: they are kept in The Office.
  await page.reload();
  await expect(row).toContainText("Leaves the workstation");
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(`/projects/${project.id}/actions/build-web`);
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1600-project-actions.png") });
  await row.getByRole("button", { name: "Remove Build web" }).click();
  await expect(page.getByText("Build web removed.")).toBeVisible();
  await expect(page.getByText(/^No Actions yet\./)).toBeVisible();
});

test("a Project command Action runs from the Overview's Actions tile, Running then Succeeded, its log in History", async ({
  page,
}) => {
  // The command waits a moment, so the run is seen Running before it Succeeds.
  const project = await addedProject(page, "Actions run", {
    install: "npm ci",
    build: `node -e "console.log('built for ' + process.env.OFFICE_ACTION_BRANCH); setTimeout(() => {}, 1500)"`,
    lint: "npm run lint",
    test: "npm test",
  });
  const defined = await page.request.put(`/api/projects/${project.id}/actions`, {
    data: {
      actions: [
        {
          key: "build-web",
          name: "Build web",
          leavesTheWorkstation: false,
          kind: "project-command",
          settings: { commandKey: "build", commandsBefore: [], timeLimitMinutes: null },
        },
      ],
    },
  });
  expect(defined.status()).toBe(200);
  await page.goto(`/projects/${project.id}`);
  const tile = page.getByRole("list", { name: `${project.name}'s Actions` });
  const row = tile.getByRole("listitem").filter({ hasText: "Build web" });
  await expect(row).toContainText("Not run yet");

  await row.getByRole("button", { name: "Run Build web" }).click();
  const runWindow = page.getByRole("dialog", { name: "Run Build web" });
  await expect(runWindow.locator(".run-window-tip code")).toHaveText(/^[0-9a-f]{7}$/);
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1600-run-window.png") });
  await runWindow.getByRole("button", { name: "Run", exact: true }).click();
  await expect(runWindow).toBeHidden();
  await expect(page.getByText("Build web started on main.")).toBeVisible();
  await expect(row).toContainText("Running");
  await expect(row.getByRole("button", { name: "Run Build web" })).toBeDisabled();
  await expect(row).toContainText("Succeeded", { timeout: 20_000 });

  await row.getByRole("link", { name: "Build web" }).click();
  await expect(page).toHaveURL(`/projects/${project.id}/actions/build-web`);
  const history = page.locator(".action-history");
  await expect(history.getByRole("row")).toHaveCount(2);
  await history.getByRole("button", { name: /^Open the log of the run started / }).click();
  const log = page.getByRole("dialog").getByLabel("Build web's log");
  await expect(log).toContainText("built for main");
  await expect(log).toContainText("Succeeded.");
  await expect(page).toHaveURL(/\?run=[0-9a-f-]{36}$/);
  await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "light-1600-action-run-log.png") });

  // ?run=<id> opens the run's log, as an Outcome Notification does.
  await page.reload();
  await expect(page.getByRole("dialog").getByLabel("Build web's log")).toContainText(
    "built for main",
  );
});

test("an Action that leaves the workstation runs from the base branch after its confirm step, refused once the branch moved", async ({
  page,
}) => {
  // A local remote, which the Run window's read of main fetches.
  const remoteRepository = await createTemporaryRepositoryWithRemote();
  try {
    const project = await addedProject(
      page,
      "Actions confirm",
      {
        install: "npm ci",
        build: `node -e "console.log('deployed ' + process.env.OFFICE_ACTION_COMMIT)"`,
        lint: "npm run lint",
        test: "npm test",
      },
      remoteRepository.path,
    );
    const defined = await page.request.put(`/api/projects/${project.id}/actions`, {
      data: {
        actions: [
          {
            key: "deploy",
            name: "Deploy",
            leavesTheWorkstation: true,
            kind: "project-command",
            settings: { commandKey: "build", commandsBefore: [], timeLimitMinutes: null },
          },
        ],
      },
    });
    expect(defined.status(), await defined.text()).toBe(200);
    await page.goto(`/projects/${project.id}`);
    const row = page
      .getByRole("list", { name: `${project.name}'s Actions` })
      .getByRole("listitem")
      .filter({ hasText: "Deploy" });
    await row.getByRole("button", { name: "Run Deploy" }).click();
    const runWindow = page.getByRole("dialog", { name: "Run Deploy" });

    // The base branch only, no Branch picker, and its commit and subject.
    await expect(runWindow).toContainText("It leaves the workstation, so it runs from main only.");
    await expect(runWindow.getByRole("combobox")).toHaveCount(0);
    const confirm = runWindow.getByRole("button", { name: /^Run Deploy on main at [0-9a-f]{7}$/ });
    await expect(confirm).toBeEnabled();
    await expect(runWindow.locator(".run-window-confirm")).toContainText("(First commit)?");
    await page.screenshot({
      path: path.join(TASK_SCREENSHOTS, "light-1600-run-window-confirm.png"),
    });

    // main moves on the remote after the window read it: the start is refused, and the window
    // reads main again for the next try.
    const shown = (await confirm.textContent()) ?? "";
    execFileSync("git", ["commit", "--quiet", "--allow-empty", "--message", "Second commit"], {
      cwd: remoteRepository.path,
    });
    execFileSync("git", ["push", "--quiet", "origin", "main"], { cwd: remoteRepository.path });
    await confirm.click();
    const refusal = runWindow.getByRole("status");
    await expect(refusal).toContainText("The Action didn't start");
    await expect(refusal).toContainText("since you looked. Run it again to run that commit.");
    await expect(runWindow.locator(".run-window-confirm")).toContainText("(Second commit)?");
    expect(await confirm.textContent()).not.toBe(shown);

    await confirm.click();
    await expect(runWindow).toBeHidden();
    await expect(page.getByText("Deploy started on main.")).toBeVisible();
    await expect(row).toContainText("Succeeded", { timeout: 20_000 });
  } finally {
    await remoteRepository.remove();
  }
});

test("the Files tab shows a branch's files, a folder read as it unfolds, and opens from a Task's and an Initiative's Browse files", async ({
  page,
}) => {
  // Five screenshot scenarios, six screenshots each.
  test.setTimeout(120_000);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const files = await createTemporaryRepository();
  try {
    await commitFiles(files, {
      "src/app.ts": 'export const greeting = "hello";\nexport const answer = 42;\n',
      "docs/guide.md": "# Browsing guide\n\nRead **this** first.\n",
    });
    const gitIn = (...gitArguments: string[]): void =>
      void execFileSync("git", gitArguments, { cwd: files.path, stdio: "ignore" });
    gitIn("checkout", "--quiet", "-b", "feature/export");
    await commitFiles(files, { "export.txt": "exported rows\n" });
    gitIn("checkout", "--quiet", "main");
    const project = await addedProject(page, "Files to browse", undefined, files.path);

    await page.goto(`/projects/${project.id}/files`);

    const branch = page.getByRole("combobox", { name: "Branch" });
    await expect(branch).toContainText("main");
    const tree = page.getByRole("tree", { name: "Files on main" });
    const item = (filePath: string): Locator =>
      tree.locator(`[role="treeitem"][data-path="${filePath}"]`);
    await expect(item("docs")).toHaveAttribute("aria-expanded", "false");
    // A folder's entries are read only once it unfolds.
    await expect(item("docs/guide.md")).toHaveCount(0);
    await item("docs").locator(".repository-tree-row").click();
    await expect(item("docs")).toHaveAttribute("aria-expanded", "true");
    await expect(item("docs/guide.md")).toBeVisible();

    await item("src").locator(".repository-tree-row").click();
    await item("src/app.ts").locator(".repository-tree-row").click();
    await expect(item("src/app.ts")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/path=src%2Fapp\.ts/);
    const preview = page.getByRole("region", { name: "Preview" });
    await expect(preview.getByRole("heading", { name: "app.ts" })).toBeVisible();
    await expect(preview.locator(".plain-text-file-numbers")).toContainText("1");
    await expect(preview.locator(".plain-text-file-numbers")).toContainText("2");
    await expect(preview.locator(".plain-text-file-lines")).toContainText(
      'export const greeting = "hello";',
    );
    await expect(preview.getByRole("link", { name: "Download" })).toHaveAttribute("download");
    await preview.getByRole("button", { name: "Copy path" }).click();
    await expect(page.getByText("Path copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("src/app.ts");
    await screenshotScenario(page, "files-text");

    // The address reopens the same file, its folders unfolded down to it and no other.
    await page.reload();
    await expect(item("src/app.ts")).toHaveAttribute("aria-selected", "true");
    await expect(preview.locator(".plain-text-file-lines")).toContainText("answer = 42");
    await expect(item("docs")).toHaveAttribute("aria-expanded", "false");
    await item("docs").locator(".repository-tree-row").click();

    await item("docs/guide.md").locator(".repository-tree-row").click();
    await expect(
      preview.locator(".markdown-document").getByRole("heading", { name: "Browsing guide" }),
    ).toBeVisible();
    await screenshotScenario(page, "files-markdown");
    await preview.getByRole("tab", { name: "Source" }).click();
    await expect(preview.locator(".plain-text-file-lines")).toContainText("# Browsing guide");

    await branch.click();
    const branches = page.getByRole("listbox", { name: "Branch" });
    await expect(branches.getByRole("group", { name: "Base branch" })).toContainText("base branch");
    await expect(
      branches
        .getByRole("group", { name: "Local branches" })
        .getByRole("option", { name: "feature/export" }),
    ).toBeVisible();
    await screenshotScenario(page, "files-branches");
    await branches.getByRole("option", { name: "feature/export" }).click();
    await expect(page).toHaveURL(/branch=feature%2Fexport/);
    const featureTree = page.getByRole("tree", { name: "Files on feature/export" });
    await featureTree.locator('[data-path="export.txt"] .repository-tree-row').click();
    await expect(preview.locator(".plain-text-file-lines")).toContainText("exported rows");

    // A Task's branch, as Start would make it, opens from the Task's Browse files.
    const taskResponse = await page.request.post("/api/tasks", {
      data: { title: "Export the rows to browse", projectId: project.id, priority: "normal" },
    });
    expect(taskResponse.status()).toBe(201);
    const task = taskSchema.parse(await taskResponse.json());
    gitIn("branch", `office/${task.id}`, "feature/export");
    await page.goto(`/tasks/${task.id}`);
    const browseFiles = page.getByRole("link", { name: "Browse files" });
    await expect(browseFiles).toBeVisible();
    await screenshotScenario(page, "task-browse-files");
    await browseFiles.click();
    await expect(page).toHaveURL(
      `/projects/${project.id}/files?branch=${encodeURIComponent(`office/${task.id}`)}`,
    );
    await expect(page.getByRole("tree", { name: `Files on office/${task.id}` })).toBeVisible();

    // An Initiative's branch opens from its Browse files; confirming one needs the CTO's session.
    const idea = await page.request.post("/api/ideas", {
      data: { title: "Browse the export Initiative", notes: "", projectId: null },
    });
    expect(idea.status()).toBe(201);
    const initiativeId = crypto.randomUUID();
    await queryOfficeDatabase(
      `insert into initiatives (id, name, outcome, state, origin_idea_id, created_by, created_at, short_name)
       values ($1, $2, '', 'active', $3, $4, now(), $5)`,
      [
        initiativeId,
        "Browse the export Initiative",
        ideaSchema.parse(await idea.json()).id,
        { kind: "user" },
        "browse-export",
      ],
    );
    await queryOfficeDatabase(`update tasks set initiative_id = $2 where id = $1`, [
      task.id,
      initiativeId,
    ]);
    gitIn("branch", "initiative/browse-export", "feature/export");
    await page.goto(`/work/initiatives/${initiativeId}`);
    const browseInitiative = page.getByRole("link", { name: "Browse files" });
    await expect(browseInitiative).toBeVisible();
    await screenshotScenario(page, "initiative-browse-files");
    await browseInitiative.click();
    await expect(
      page.getByRole("tree", { name: "Files on initiative/browse-export" }),
    ).toBeVisible();
  } finally {
    await files.remove();
  }
});
