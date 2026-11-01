import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  OFFICE_IDENTITY_SETTINGS_PATH,
  projectSchema,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { addFakeMcpServer } from "./fake-mcp-server.ts";
import { branchOnHost, serveRepository } from "./git-host.ts";
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

/** Adds a Project through the API, for the tests that start on its page. */
async function addedProject(
  page: Page,
  name: string,
  commands: NewProject["commands"] = {
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
    commands,
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const response = await page.request.post("/api/projects", { data: newProject });
  expect(response.status()).toBe(201);
  return projectSchema.parse(await response.json());
}

async function fillTheForm(page: Page, fields: { name: string; path: string; branch: string }) {
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill(fields.name);
  await form.getByLabel("Repository folder").fill(fields.path);
  await form.getByLabel("Base branch").fill(fields.branch);
  await form.getByLabel("Install", { exact: true }).fill("npm ci");
  await form.getByLabel("Build").fill("npm run build");
  await form.getByLabel("Lint").fill("npm run lint");
  await form.getByLabel("Test").fill("npm test");
}

test("the user adds a Project from the Projects page and lands on its page", async ({ page }) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add it yourself" }).click();
  await fillTheForm(page, { name: "Billing service", path: repository.path, branch: "main" });
  await page.getByRole("dialog").getByLabel("Install inputs").fill("package-lock.json,");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-add.png") });

  await page.getByRole("button", { name: "Add the Project" }).click();

  await expect(page).toHaveURL(/\/projects\/billing-service$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Billing service");
  await expect(page.getByText("Billing service added.")).toBeVisible();
  await expect(page.getByText(repository.path)).toBeVisible();
  await expect(page.getByText("package-lock.json")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project.png") });

  await page.getByRole("link", { name: "Projects", exact: true }).first().click();
  await expect(page.getByRole("link", { name: /Billing service/ })).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects.png") });
});

test("a folder that isn't a repository, or a branch it lacks, is refused with the reason", async ({
  page,
}) => {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add it yourself" }).click();
  await fillTheForm(page, { name: "Nowhere", path: repository.folder, branch: "main" });
  const add = page.getByRole("button", { name: "Add the Project" });

  await add.click();
  // The design system's Alert is a status.
  const refusal = page.getByRole("dialog").getByRole("status");
  await expect(refusal).toContainText(`${repository.folder} is not a git repository`);
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-projects-refused.png") });

  await page.getByRole("dialog").getByLabel("Repository folder").fill(repository.path);
  await page.getByRole("dialog").getByLabel("Base branch").fill("develop");
  await add.click();
  await expect(refusal).toContainText('The repository has no branch "develop".');
  await expect(page).toHaveURL(/\/projects$/);
});

test("the user adds a Project by its git URL: cloned first, then the form opens from the clone", async ({
  page,
}) => {
  const url = serveRepository(repository, "acme", "storefront");
  branchOnHost("acme", "storefront", "release");
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add it yourself" }).click();
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
  await clone.click();
  await expect(dialog.getByLabel("Name")).toHaveValue("storefront");
  await expect(repositoryUrl).toHaveValue(url);
  await expect(dialog.getByText(/Cloned into .*storefront/)).toBeVisible();
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
});

test("a Project's page says which part of the Office identity its remote needs and what is missing", async ({
  page,
}) => {
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
});

test("editing a command saves it, and the toast says Tasks run it from their next Script Stage", async ({
  page,
}) => {
  const project = await addedProject(page, "Command edits");
  await page.goto(`/projects/${project.id}`);

  await page.getByRole("button", { name: "Change the test command" }).click();
  await page.getByLabel("Test command").fill("npm test -- --run");
  await page.keyboard.press("Enter");

  await expect(
    page.getByText("Command saved. Tasks run it from their next Test Stage."),
  ).toBeVisible();
  await expect(page.getByText("npm test -- --run")).toBeVisible();
  await page.reload();
  await expect(page.getByText("npm test -- --run")).toBeVisible();
});

test("a Project overrides an MCP server's Server values, a secret never shown", async ({
  page,
}) => {
  const server = "e2e-project-values-server";
  const officeWideSecret = "office-wide-secret-value";
  const projectSecret = "project-secret-value";
  await addFakeMcpServer(page, server, [
    { name: "FAKE_TOKEN", secret: true, required: true, officeWideValue: officeWideSecret },
    { name: "FAKE_REGION", secret: false, required: false, officeWideValue: "eu" },
  ]);
  const project = await addedProject(page, "Values override");
  await page.goto(`/projects/${project.id}`);

  const values = page.getByRole("region", { name: `MCP server ${server}` });
  const token = values.getByRole("listitem", { name: "Server value FAKE_TOKEN" });
  const region = values.getByRole("listitem", { name: "Server value FAKE_REGION" });
  await expect(token).toContainText("Office-wide Set");
  await expect(token).toContainText("This Project The Office-wide value");
  await expect(region).toContainText("Office-wide eu");

  await values.getByRole("button", { name: `Change ${server}'s values for this Project` }).click();
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
  await values.getByRole("button", { name: `Change ${server}'s values for this Project` }).click();
  await expect(
    editor.getByText("A value is set. It is never shown; type a new one to replace it."),
  ).toBeVisible();
  await expect(editor.getByLabel("FAKE_TOKEN for this Project")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(projectSecret);
  await expect(page.locator("body")).not.toContainText(officeWideSecret);
  const listed = await (await page.request.get(`/api/projects/${project.id}/server-values`)).text();
  expect(listed).not.toContain(projectSecret);
  expect(listed).not.toContain(officeWideSecret);
});

test("the install inputs are changed beside the install command", async ({ page }) => {
  const project = await addedProject(page, "Install inputs");
  await page.goto(`/projects/${project.id}`);
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
});

test("the default Pipeline picker lists the library, the built-ins first", async ({ page }) => {
  const project = await addedProject(page, "Pipeline choice");
  await page.goto(`/projects/${project.id}`);
  const picker = page.getByLabel("Default Pipeline");

  // Other tests add Pipelines of their own after the built-ins.
  await expect(picker.locator("option").first()).toHaveText("Full");
  const options = await picker.locator("option").allTextContents();
  expect(options.slice(0, 5)).toEqual([
    "Full",
    "Quick fix",
    "Document",
    "Onboard",
    "Proof of concept",
  ]);
  await picker.selectOption({ label: "Quick fix" });

  await expect(page.getByText(`New Tasks in ${project.name} start from Quick fix.`)).toBeVisible();
  await expect(page.getByText(/^Implement → Tests → Publish\./)).toBeVisible();
});

test("a command changed in one tab shows in another", async ({ page, context }) => {
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
  await other.goto(`/projects/${project.id}`);
  await subscribed;
  await page.goto(`/projects/${project.id}`);

  await page.getByRole("button", { name: "Change the lint command" }).click();
  await page.getByLabel("Lint command").fill("oxlint");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(other.getByText("oxlint", { exact: true })).toBeVisible();
});

test("the environment check shows each check, and saves the environment only once all pass", async ({
  page,
}) => {
  const passes = `node -e "process.exit(0)"`;
  const project = await addedProject(page, "Environment check", {
    install: passes,
    build: passes,
    lint: `node -e "console.error('lint error: 1 problem'); process.exit(1)"`,
    test: `node -e "process.exit(process.env.GREETING === 'hello' ? 0 : 1)"`,
  });
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByText("Not checked yet.")).toBeVisible();
  const checks = page.getByRole("list", { name: "Environment checks" });

  await page.getByLabel("Variables to set").fill("GREETING=hello");
  await page.getByRole("button", { name: "Run the environment check" }).click();

  await expect(page.getByText("Failed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(checks).toContainText("failed with exit code 1");
  await expect(checks.getByLabel("Output")).toHaveText("lint error: 1 problem");
  await expect(checks.getByRole("img", { name: "Passed" })).toHaveCount(4);
  await page.screenshot({
    path: path.join(SCREENSHOTS, "light-1600-project-environment-failed.png"),
  });

  await page.request.put(`/api/projects/${project.id}/commands/lint`, {
    data: { commandLine: passes },
  });
  await page.getByRole("button", { name: "Run the environment check" }).click();

  await expect(page.getByText("Ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await expect(page.getByLabel("Variables to set")).toHaveValue("GREETING=hello");
  await page.screenshot({ path: path.join(SCREENSHOTS, "light-1600-project-environment.png") });
});

test("a Project that doesn't exist says so, with the way back", async ({ page }) => {
  await page.goto("/projects/nowhere");

  await expect(page.getByText('There is no Project "nowhere".')).toBeVisible();
  await page.getByRole("link", { name: "Back to Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
