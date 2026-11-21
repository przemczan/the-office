import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  knownHostsSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  officeSshKeySchema,
  projectSchema,
  taskSchema,
  type NewProject,
  type Project,
  type Task,
} from "@the-office/contracts";
import { E2E_STORAGE_STATE, NOT_SIGNED_IN } from "./e2e-user.ts";
import {
  addIssue,
  addRef,
  addRun,
  addWorkflow,
  controlPullRequest,
  dispatches,
  FAKE_GITHUB_API_URL,
  FAKE_GITHUB_URL,
  grantPermissions,
  installApp,
} from "./fake-github.ts";
import { serveRepository } from "./git-host.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { pickPipeline } from "./pipeline-picker.ts";
import { E2E_HOST_KEY_FINGERPRINT } from "./ssh-host.ts";
import { screenshotScenario, TASK_SCREENSHOTS } from "./task-screenshots.ts";
import {
  createTemporaryRepository,
  createTemporaryRepositoryWithRemote,
  type TemporaryRepositoryWithRemote,
} from "./temporary-repository.ts";

const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

/** A workflow started by hand with a yes-no and a required choice, as GitHub's docs show one. */
const RELEASE_YAML = `name: Release
on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: Only show what it would publish
        type: boolean
        default: false
      channel:
        description: Where the release goes
        type: choice
        required: true
        options:
          - beta
          - stable
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - run: echo releasing
`;

/** Add a Project open on step 1 From GitHub. */
async function openFromGitHub(page: Page): Promise<Locator> {
  await page.goto("/projects");
  await page.getByRole("button", { name: "Add it yourself" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "From GitHub" }).click();
  return dialog;
}

/** A request held back until the test lets it go on, to see what shows meanwhile. */
function heldBack(): { held: Promise<void>; letGo: () => void } {
  let letGo!: () => void;
  const held = new Promise<void>((resolve) => {
    letGo = resolve;
  });
  return { held, letGo };
}

function repositoryList(page: Page): Locator {
  return page.getByRole("dialog").getByRole("list", { name: "Your GitHub repositories" });
}

// Registering the App, signing in, what needs the sign-in and signing out run in order, and stop
// at the first failure: each needs the one before. Sign-in is the Office's, shared with the files
// running beside this one, so every test that needs it is here, before signing out.
test.describe.serial("Sign in with GitHub", () => {
  test.afterAll(async ({ playwright }, testInfo) => {
    // Signed out even when a test before "signing out" failed.
    const api = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: E2E_STORAGE_STATE,
    });
    await api.delete("/api/github/sign-in");
    await api.delete("/api/account/linked-identities/github");
    await api.dispose();
  });

  test(
    "before the App is registered, From GitHub says to register it first",
    { tag: "@full" },
    async ({ page }) => {
      const dialog = await openFromGitHub(page);

      await expect(
        dialog.getByRole("heading", { name: "Register the GitHub App first" }),
      ).toBeVisible();
      await expect(dialog.getByLabel("Search your repositories")).toBeHidden();
      await expect(
        dialog.getByRole("link", { name: "Open Settings › Office identity" }),
      ).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Use a git URL instead" })).toBeVisible();
    },
  );

  test("registering the GitHub App posts its manifest to GitHub and comes back to The Office", async ({
    page,
  }) => {
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
    await page.getByRole("button", { name: "Register the GitHub App" }).click();

    await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
    await expect(
      page.getByText(/The GitHub App the-office-fake-\d+ is registered on office-user/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Install the App on repositories" }),
    ).toHaveAttribute(
      "href",
      new RegExp(`^${FAKE_GITHUB_URL}/apps/the-office-fake-\\d+/installations/new$`),
    );
  });

  test("signing in through GitHub's page shows who is signed in", async ({ page }) => {
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();

    await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
    await expect(page.getByText("Signed in as")).toBeVisible();
    await expect(page.getByText("office-user", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Install the App on more repositories" }),
    ).toBeVisible();
  });

  test("a user links their GitHub account and continues with it, leaving Sign in with GitHub as it was", async ({
    page,
    browser,
  }, testInfo) => {
    // Settings lists the callback URLs Continue with GitHub needs; registering listed them already.
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
    const continueWith = page.getByRole("region", { name: "Continue with GitHub" });
    await expect(continueWith).toContainText("/api/sign-in/github/callback");
    await screenshotScenario(page, "settings-office-identity-continue-with-github", {
      fullPage: true,
    });

    // The same GitHub account as the git identity's, office-user, linked from the account.
    await page.goto("/account/linked-identities");
    await page.getByRole("button", { name: "Link GitHub" }).click();
    await expect(page).toHaveURL("/account/linked-identities");
    await expect(page.locator(".account-identity").filter({ hasText: "GitHub" })).toContainText(
      "office-user",
    );
    await screenshotScenario(page, "account-linked-identities");

    // A browser not signed in continues with it from the sign-in page.
    const fresh = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: NOT_SIGNED_IN,
    });
    try {
      const signingIn = await fresh.newPage();
      await signingIn.goto("/sign-in?returnTo=%2Fsettings%2Foffice-identity");
      await screenshotScenario(signingIn, "sign-in-continue-with-github");
      await signingIn.getByRole("button", { name: "Continue with GitHub" }).click();

      await expect(signingIn).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
      // Sign in with GitHub is untouched: still signed in, its token still listing repositories.
      await expect(signingIn.getByText("Signed in as")).toBeVisible();
      await expect(signingIn.getByText("office-user", { exact: true })).toBeVisible();
      const repositories = await signingIn.request.get("/api/github/repositories");
      expect(repositories.status()).toBe(200);
    } finally {
      await fresh.close();
    }
  });

  test(
    "signed in, From GitHub lists the repositories Recent first, searched by name, owner and description",
    { tag: "@full" },
    async ({ page }) => {
      await installApp("office-user", [
        {
          fullName: "office-user/picked-notes",
          private: true,
          pushedAt: "2026-11-05T10:00:00Z",
          description: "Notes the test picks",
        },
        { fullName: "office-user/left-alone", pushedAt: "2026-11-06T10:00:00Z" },
        {
          fullName: "office-user/old-attic",
          pushedAt: "2025-01-01T10:00:00Z",
          description: "Boxes nobody opens",
        },
        { fullName: "office-user/never-served", pushedAt: "2024-06-01T10:00:00Z" },
      ]);
      const dialog = await openFromGitHub(page);
      const list = repositoryList(page);
      const card = dialog.getByRole("region", { name: /Your repositories/ });

      await expect(list.locator(".github-repository-name")).toHaveText([
        "left-alone",
        "picked-notes",
        "old-attic",
        "never-served",
      ]);
      await expect(card.locator(".github-repositories-count")).toHaveText("4");
      await expect(
        card.getByRole("link", { name: "Install the App on more repositories" }),
      ).toBeVisible();
      const picked = list.getByRole("button", { name: "office-user/picked-notes" });
      await expect(picked).toContainText("office-user · main · pushed 5 Nov");
      await expect(picked).toContainText("Notes the test picks");
      await expect(picked).toContainText("Private");

      const search = dialog.getByLabel("Search your repositories");
      await search.fill("NOBODY");
      await expect(list.locator(".github-repository-name")).toHaveText(["old-attic"]);
      await expect(list.locator("mark")).toHaveText(["nobody"]);
      await expect(card.locator(".github-repositories-count")).toHaveText("1 of 4");
      await search.fill("office-user");
      await expect(list.getByRole("button")).toHaveCount(4);
      await search.fill("nothing like it");
      await expect(card).toContainText("No repository matches “nothing like it”.");
      await search.fill("");
      // The search stays put while the rows scroll.
      const searchTop = (await search.boundingBox())!.y;
      await list.evaluate((rows) => rows.scrollTo(0, rows.scrollHeight));
      expect((await search.boundingBox())!.y).toBe(searchTop);
    },
  );

  test(
    "the list starts loading as the window opens, with the shared loader until it answers",
    { tag: "@full" },
    async ({ page }) => {
      let asked = false;
      const { held, letGo: answer } = heldBack();
      await page.route("**/api/github/repositories", async (route) => {
        asked = true;
        await held;
        await route.continue();
      });
      await page.goto("/projects");
      await page.getByRole("button", { name: "Add it yourself" }).click();
      await expect.poll(() => asked).toBe(true);
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "From GitHub" }).click();

      const loader = dialog.getByRole("status").filter({ hasText: "Loading your repositories…" });
      await expect(loader).toBeVisible();
      await expect(dialog.getByLabel("Search your repositories")).toBeVisible();
      await expect(dialog).not.toContainText("No repository matches");
      await expect(dialog).not.toContainText("installed on no repository");
      // Unseen for its first 200ms, then faded in.
      await expect(loader).toHaveCSS("opacity", "1");
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${colorScheme}-1280-add-project-loading.png`),
        });
      }

      answer();
      await expect(loader).toBeHidden();
      await expect(repositoryList(page).getByRole("button").first()).toBeVisible();
    },
  );

  test(
    "a picked repository clones with Clone, its progress in its row, and a failed one its problem there",
    { tag: "@full" },
    async ({ page }) => {
      const { held, letGo: start } = heldBack();
      await page.route("**/api/repositories/clones", async (route) => {
        await held;
        await route.continue();
      });
      const dialog = await openFromGitHub(page);
      const list = repositoryList(page);
      const clone = dialog.getByRole("button", { name: "Clone" });
      await expect(clone).toBeDisabled();
      const neverServed = list.getByRole("button", { name: "office-user/never-served" });
      await neverServed.click();
      await expect(neverServed).toHaveAttribute("aria-pressed", "true");
      await clone.click();

      // Its progress shows in its row while the others wait.
      const cloning = list.getByRole("group", { name: "office-user/never-served" });
      await expect(cloning.getByRole("progressbar")).toBeVisible();
      await expect(cloning).toContainText("Starting the clone");
      await expect(list.getByRole("button", { name: "office-user/left-alone" })).toBeDisabled();
      start();
      // Still picked, so Clone tries again.
      await expect(neverServed).toContainText("The clone failed:");
      await expect(neverServed).toHaveAttribute("aria-pressed", "true");
      await expect(clone).toBeEnabled();
      await expect(list.getByRole("button", { name: "office-user/left-alone" })).toBeEnabled();
    },
  );

  test(
    "a picked repository clones with Clone, then step 2 adds it with only a name",
    { tag: "@full" },
    async ({ page }) => {
      const repository = await createTemporaryRepository();
      try {
        const url = serveRepository(repository, "office-user", "picked-notes");
        const dialog = await openFromGitHub(page);
        await repositoryList(page)
          .getByRole("button", { name: "office-user/picked-notes" })
          .click();
        await dialog.getByRole("button", { name: "Clone" }).click();

        const source = dialog.getByRole("group", { name: "Where it is" });
        await expect(source).toContainText("From GitHub");
        await expect(source).toContainText("office-user/picked-notes");
        await expect(source).toContainText("Private");
        await expect(source).toContainText(/cloned into .*picked-notes/);
        await expect(dialog.locator(".dialog-bar")).toContainText("Step 2 of 2");
        await expect(dialog.getByLabel("Name")).toHaveValue("picked-notes");
        await expect(dialog.getByLabel("Base branch")).toHaveValue("main");
        for (const colorScheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme });
          await page.screenshot({
            path: path.join(SCREENSHOTS, `${colorScheme}-1280-add-project-step-2.png`),
          });
        }
        await page.emulateMedia({ colorScheme: "light" });

        // Change forgets the clone and the pick; picking again and Clone clones again.
        await source.getByRole("button", { name: "Change" }).click();
        await expect(dialog.locator(".dialog-bar")).toContainText("Step 1 of 2");
        await expect(dialog.getByRole("button", { name: "Clone" })).toBeDisabled();
        await repositoryList(page)
          .getByRole("button", { name: "office-user/picked-notes" })
          .click();
        await dialog.getByRole("button", { name: "Clone" }).click();
        await expect(dialog.getByLabel("Name")).toHaveValue("picked-notes");
        await expect(dialog).toContainText(
          "Optional. Leave any you don't know yet: set them later on the Project's page, or ask whoever onboards Projects.",
        );
        // A name is enough: the commands are left for later.
        await dialog.getByLabel("Name").fill("Picked notes");
        await dialog.getByRole("button", { name: "Add the Project" }).click();

        await expect(page).toHaveURL(/\/projects\/picked-notes$/);
        await expect(page.getByText(url)).toBeVisible();
        await page.goto("/projects/picked-notes/commands");
        const commandLines = page
          .locator(".command-row")
          .filter({ hasNot: page.getByText("None") });
        await expect(commandLines.locator(".command-empty")).toHaveText([
          "Not set",
          "Not set",
          "Not set",
          "Not set",
        ]);
        await page.screenshot({ path: path.join(SCREENSHOTS, "light-1280-commands-not-set.png") });
        await page.getByRole("button", { name: "Change the test command" }).click();
        await page.getByLabel("Test command").fill("npm test");
        await page.keyboard.press("Enter");
        await expect(page.locator(".command-line")).toHaveText(["npm test"]);
      } finally {
        await repository.remove();
      }
    },
  );

  test(
    "a repository already added shows its Project, can't be picked, and sits at the end",
    { tag: "@full" },
    async ({ page }) => {
      const dialog = await openFromGitHub(page);
      const list = repositoryList(page);

      await expect(list.locator(".github-repository-name").last()).toHaveText("picked-notes");
      const added = list.getByRole("group", { name: "office-user/picked-notes" });
      await expect(added).toContainText("Already added, as the Project Picked notes.");
      await expect(added).toContainText("Added");
      await expect(list.getByRole("button", { name: "office-user/picked-notes" })).toHaveCount(0);
      await expect(list.locator(".github-repositories-group")).toHaveText("Already added");
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.screenshot({
          path: path.join(SCREENSHOTS, `${colorScheme}-1280-add-project-from-github.png`),
        });
      }

      await dialog.getByLabel("Search your repositories").fill("notes");
      await expect(list.locator(".github-repository-name")).toHaveText(["picked-notes"]);
      await expect(list.locator(".github-repositories-group")).toHaveText("Already added");
    },
  );

  test(
    "From GitHub holds together at 600 wide, nothing scrolling sideways",
    { tag: "@full" },
    async ({ page }) => {
      await page.setViewportSize({ width: 600, height: 800 });
      const dialog = await openFromGitHub(page);
      await expect(repositoryList(page).getByRole("button").first()).toBeVisible();

      const body = dialog.locator(".dialog-body");
      expect(await body.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
      await page.screenshot({
        path: path.join(SCREENSHOTS, "light-600-add-project-from-github.png"),
      });
    },
  );

  test("Work › Pull requests shows a pull request's failing checks and conflicts after Refresh, and asks for the App's missing permissions", async ({
    page,
  }) => {
    const repository = await createTemporaryRepositoryWithRemote();
    const repositoryName = `pull-request-notes-${Date.now()}`;
    const fullName = `office-user/${repositoryName}`;
    try {
      // Installed with the permissions of an App registered before checks were read.
      await installApp("office-user", [{ fullName }]);
      const project = await addProjectOnGitHub(page, repository, fullName, "Pull request notes");
      const task = await createTask(page, project, "Show the pull request's checks");
      const number = await openPullRequestOnGitHub(fullName, task);
      await controlPullRequest({
        action: "setChecks",
        repository: fullName,
        number,
        checks: "failing",
      });
      await controlPullRequest({
        action: "setMergeable",
        repository: fullName,
        number,
        mergeable: false,
      });

      await page.goto("/work/pull-requests");
      const name = `#${number} ${task.title}`;
      const row = page.getByRole("row").filter({ hasText: name });
      // A refresh within 10 s of the watch's last round answers that round, so press it until the
      // round that reads this pull request has run.
      await expect(async () => {
        await page.getByRole("button", { name: "Refresh" }).click();
        await expect(row).toContainText("Failing", { timeout: 3_000 });
      }).toPass({ timeout: 45_000 });
      await expect(row).toContainText("Conflicts");
      await expect(row).toContainText(`office/${task.id} → main`);
      await expect(row.getByRole("link", { name })).toHaveAttribute(
        "href",
        `${FAKE_GITHUB_URL}/${fullName}/pull/${number}`,
      );
      await expect(page.getByRole("tab", { name: /^Pull requests/ })).toBeVisible();

      // The App lacks Checks, Commit statuses and Actions on this installation.
      const checked = await page.request.post("/api/github/permissions/check");
      expect(checked.status()).toBe(200);
      await page.reload();
      const prompt = page.locator(".github-permissions-prompt");
      await expect(prompt).toContainText("Checks (read)");
      await expect(prompt.getByRole("link", { name: "office-user" }).first()).toBeVisible();
      await expect(row).toContainText("Failing");
      await screenshotScenario(page, "work-pull-requests", { fullPage: true });

      await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
      await expect(prompt).toContainText("Commit statuses (read)");
      await expect(
        prompt.getByRole("link", { name: "Add them to the App on GitHub" }),
      ).toBeVisible();
      await screenshotScenario(page, "settings-office-identity-permissions", { inView: prompt });

      // Accepted on GitHub, Check again finds nothing missing.
      await grantPermissions("office-user", {
        checks: "read",
        statuses: "read",
        actions: "write",
        issues: "write",
      });
      await prompt.getByRole("button", { name: "Check again" }).click();
      await expect(prompt).toBeHidden();

      await page.goto("/work/pull-requests");
      await row.getByRole("link", { name: task.title, exact: true }).click();
      await expect(page).toHaveURL(`/tasks/${task.id}`);
    } finally {
      await repository.remove();
    }
  });

  test(
    "Work › Pull requests resolves a pull request's conflicts with a Conflict resolution Task, linked from both Tasks",
    { tag: "@full" },
    async ({ page }) => {
      const repository = await createTemporaryRepositoryWithRemote();
      const fullName = `office-user/pull-request-conflicts-${Date.now()}`;
      try {
        await installApp("office-user", [{ fullName }]);
        const project = await addProjectOnGitHub(
          page,
          repository,
          fullName,
          "Pull request conflicts",
        );
        const task = await createTask(page, project, "Resolve the pull request's conflicts");
        const number = await openPullRequestOnGitHub(fullName, task);
        await controlPullRequest({
          action: "setMergeable",
          repository: fullName,
          number,
          mergeable: false,
        });

        await page.goto("/work/pull-requests");
        const row = page.getByRole("row").filter({ hasText: `#${number} ${task.title}` });
        // A refresh within 10 s of the watch's last round answers that round, so press it until the
        // round that reads this pull request has run.
        await expect(async () => {
          await page.getByRole("button", { name: "Refresh" }).click();
          await expect(row).toContainText("Conflicts", { timeout: 3_000 });
        }).toPass({ timeout: 45_000 });
        const resolve = row.getByRole("button", { name: "Resolve conflicts" });
        await expect(resolve).toBeVisible();
        await screenshotScenario(page, "pull-requests-resolve-conflicts", { inView: row });

        await resolve.click();
        const title = `Resolve conflicts: ${task.title}`;
        await expect(row).toContainText(`Resolving: ${title} (`);
        await expect(resolve).toBeHidden();
        // Its Start may run, queue or be refused (the fake GitHub serves no git, and the Office's
        // hires depend on the tests before), so its state isn't checked.
        await screenshotScenario(page, "pull-requests-resolving", { inView: row });

        await row.getByRole("link", { name: title, exact: true }).click();
        await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+$/);
        const ofTheConflicts = page.getByRole("region", { name: "Conflict resolution" });
        await expect(ofTheConflicts).toContainText(`Resolves the conflicts of: ${task.title} (`);
        await ofTheConflicts.getByRole("link", { name: task.title, exact: true }).click();
        await expect(page).toHaveURL(`/tasks/${task.id}`);
        await expect(page.getByRole("region", { name: "Conflict resolution" })).toContainText(
          `Conflicts resolved by: ${title} (`,
        );
      } finally {
        await repository.remove();
      }
    },
  );

  // Needs the sign-in (the service lists and re-runs with its token) and the Actions permission
  // the pull request test above granted, so it lives here, between signing in and out.
  test("Work › CI shows a failed run and re-running its failed jobs queues it", async ({
    page,
  }) => {
    // The watch lists a Project's runs every minute; Refresh may be skipped within 10 s of a listing.
    test.setTimeout(120_000);
    const repository = await createTemporaryRepositoryWithRemote();
    const repositoryName = `ci-notes-${Date.now()}`;
    const fullName = `office-user/${repositoryName}`;
    try {
      await installApp("office-user", [{ fullName }]);
      await grantPermissions("office-user", {
        checks: "read",
        statuses: "read",
        actions: "write",
        issues: "write",
      });
      const projectName = `CI notes ${Date.now()}`;
      const newProject: NewProject = {
        name: projectName,
        path: repository.path,
        baseBranch: "main",
        mark: { label: "CI", colour: "teal" },
        installCommand: "",
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
          {
            key: "test",
            name: "Test",
            kind: "test",
            commandLine: "npm test",
            rerunCommandLine: "",
          },
        ],
        installInputs: [],
        publishingMode: "push-and-pull-request",
        defaultPipeline: "full",
      };
      const added = await page.request.post("/api/projects", { data: newProject });
      expect(added.status(), await added.text()).toBe(201);
      execFileSync("git", ["remote", "set-url", "origin", `${FAKE_GITHUB_URL}/${fullName}.git`], {
        cwd: repository.path,
        stdio: "ignore",
      });
      const runId = Date.now();
      const title = `Break the build ${runId}`;
      await addRun(fullName, {
        id: runId,
        name: "CI",
        displayTitle: title,
        runNumber: 7,
        status: "completed",
        conclusion: "failure",
        headBranch: "main",
      });

      await page.goto("/work/ci");
      const row = page.getByRole("row").filter({ hasText: title });
      // A refresh within 10 s of the last listing answers that one, so press it until the
      // listing that reads this run has run.
      await expect(async () => {
        await page.getByRole("button", { name: "Refresh" }).click();
        await expect(row).toContainText("Failed", { timeout: 3_000 });
      }).toPass({ timeout: 90_000 });
      await expect(row).toContainText(`CI #7 · ${title}`);

      await row.getByRole("button", { name: `More for CI #7 · ${title}` }).click();
      await page.getByRole("menu").getByRole("button", { name: "Re-run failed jobs" }).click();

      // The re-run lists the Project at once, and the fake's run starts again, queued.
      await expect(row).toContainText("Queued", { timeout: 15_000 });
      await expect(row).toContainText("attempt 2");
      await expect(row.getByRole("button", { name: /^More for/ })).toHaveCount(0);
    } finally {
      await repository.remove();
    }
  });

  // Needs the sign-in (the service reads the workflow files and starts one with its token) and the
  // Actions permission to write, so it lives here, between signing in and out.
  test("Work › CI starts a workflow by hand on a tag with its inputs, and its run shows queued", async ({
    page,
  }) => {
    const repository = await createTemporaryRepositoryWithRemote();
    const fullName = `office-user/release-by-hand-${Date.now()}`;
    try {
      await installApp("office-user", [{ fullName }]);
      await grantPermissions("office-user", {
        checks: "read",
        statuses: "read",
        actions: "write",
        issues: "write",
      });
      const project = await addProjectOnGitHub(page, repository, fullName, "Release by hand");
      await addWorkflow(fullName, { file: "release.yml", name: "Release", yaml: RELEASE_YAML });
      await addRef(fullName, { tag: "v1.2.0" });

      await page.goto("/work/ci");
      await page.getByRole("button", { name: "Start a workflow" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Project", { exact: true }).selectOption({ label: project.name });
      const ref = dialog.getByRole("combobox", { name: "Branch or tag" });
      await expect(ref).toHaveValue("main");
      await ref.fill("v1.2");
      await page.getByRole("option", { name: "v1.2.0 (tag)" }).click();
      await expect(ref).toHaveValue("v1.2.0 (tag)");
      await dialog.getByLabel("Workflow", { exact: true }).selectOption({ label: "Release" });

      const start = dialog.getByRole("button", { name: "Start", exact: true });
      await expect(dialog).toContainText("Where the release goes");
      await expect(start).toBeDisabled();
      await dialog.getByLabel("channel").selectOption("stable");
      const dryRun = dialog.getByRole("switch");
      await expect(dryRun).toHaveAttribute("aria-checked", "false");
      await dryRun.click();
      await expect(dryRun).toHaveAttribute("aria-checked", "true");
      await expect(start).toBeEnabled();
      await screenshotScenario(page, "start-workflow-dialog", { inView: dialog });
      await page.screenshot({ path: path.join(TASK_SCREENSHOTS, "start-workflow-dialog.png") });

      await start.click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Release started on v1.2.0.")).toBeVisible();
      // The start lists the Project at once, and the fake queues a run on the tag.
      const row = page
        .getByRole("row")
        .filter({ hasText: project.name })
        .filter({ hasText: "v1.2.0" });
      await expect(row).toContainText("Queued", { timeout: 15_000 });
      await expect(row).toContainText("Release #");
      expect((await dispatches()).filter((each) => each.repository === fullName)).toEqual([
        {
          repository: fullName,
          file: "release.yml",
          ref: "v1.2.0",
          inputs: { channel: "stable", dry_run: "true" },
        },
      ]);
    } finally {
      await repository.remove();
    }
  });

  // Needs the sign-in, as the service lists and reads the issues with its token.
  test("Import issues from the Work board picks two open issues, and they show in Backlog with their GitHub issue records", async ({
    page,
  }) => {
    const repository = await createTemporaryRepositoryWithRemote();
    const fullName = `office-user/issue-notes-${Date.now()}`;
    try {
      await installApp("office-user", [{ fullName }]);
      await grantPermissions("office-user", {
        checks: "read",
        statuses: "read",
        actions: "write",
        issues: "write",
      });
      const project = await addProjectOnGitHub(page, repository, fullName, "Issue notes");
      // A second Project, so the window offers its Project picker even when run alone.
      await addProjectOnGitHub(page, repository, fullName, "Issue notes elsewhere");
      const stamp = Date.now();
      const crash = `Live view freezes after waking ${stamp}`;
      const csvExport = `Export Stats as CSV ${stamp}`;
      const typo = `Typo on the sign-in page ${stamp}`;
      await addIssue(fullName, { number: 1, title: typo, author: "mona", labels: ["docs"] });
      await addIssue(fullName, { number: 2, title: csvExport, author: "hubot" });
      await addIssue(fullName, { number: 3, title: crash, labels: ["Bug", "live-view"] });
      // A pull request, which GitHub lists among the issues and the window leaves out.
      await addIssue(fullName, { number: 4, title: `Fix the typo ${stamp}`, pullRequest: true });

      // The Project's page: a Kind's own default Pipeline, and the GitHub issues section.
      await page.goto(`/projects/${project.id}/pipelines`);
      await pickPipeline(page, "Default Pipeline for Bugs", "Full");
      await expect(page.getByText(`${project.name}'s Bugs follow Full now.`)).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Default Pipeline for Features", exact: true }),
      ).toHaveText("Same as every Task");
      await screenshotScenario(page, "project-default-pipeline-by-kind");
      await page.getByRole("navigation", { name: "Project" }).getByText("GitHub issues").click();
      await expect(page).toHaveURL(`/projects/${project.id}/issues`);
      await expect(page.getByText("3 open issues not yet imported")).toBeVisible();
      await expect(page.getByText("Signed in with GitHub", { exact: true })).toBeVisible();
      await screenshotScenario(page, "project-github-issues", { fullPage: true });

      // Work › Board's Import issues…, in the Project picked in the window.
      await page.goto("/work");
      await page.getByRole("button", { name: "Import issues…" }).click();
      const dialog = page.getByRole("dialog", { name: "Import issues" });
      await dialog.getByRole("combobox", { name: "Project", exact: true }).click();
      await page
        .getByRole("listbox", { name: "Project", exact: true })
        .getByRole("option", { name: project.name, exact: true })
        .click();
      const rows = dialog.getByRole("group", { name: /^#\d+ / });
      await expect(rows).toHaveCount(3);
      // Newest first; the bug label (any case) previews Bug, others Feature.
      await expect(rows.nth(0)).toHaveAccessibleName(`#3 ${crash}`);
      await expect(rows.nth(0)).toContainText("Bug");
      await expect(rows.nth(1)).toContainText("Feature");
      await expect(dialog.getByRole("button", { name: "Import issues" })).toBeDisabled();

      await dialog.getByRole("group", { name: `#3 ${crash}` }).click();
      await dialog.getByRole("group", { name: `#2 ${csvExport}` }).click();
      await expect(dialog).toContainText("3 open issues not yet imported · 2 picked");
      await dialog.getByLabel("Search the issues").fill("typo");
      await expect(rows).toHaveCount(1);
      await dialog.getByLabel("Search the issues").fill("");
      await screenshotScenario(page, "import-issues-window", { inView: dialog });
      await dialog.getByRole("button", { name: "Import 2 issues" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("2 Tasks added to Backlog.")).toBeVisible();

      const backlog = page.getByRole("region", { name: "Backlog", exact: true });
      const crashCard = backlog.getByRole("article", { name: crash });
      await expect(crashCard).toBeVisible();
      await expect(crashCard.getByRole("img", { name: "Bug", exact: true })).toBeAttached();
      await expect(
        backlog.getByRole("article", { name: csvExport }).getByRole("img", { name: "Feature" }),
      ).toBeAttached();
      await expect(backlog.getByRole("article", { name: typo })).toHaveCount(0);

      await crashCard.getByRole("link", { name: crash }).click();
      await expect(page).toHaveURL(/\/tasks\//);
      const issue = page.getByRole("region", { name: "GitHub issue" });
      await expect(issue.getByRole("link", { name: `#3 ${crash}` })).toHaveAttribute(
        "href",
        `${FAKE_GITHUB_URL}/${fullName}/issues/3`,
      );
      await expect(issue).toContainText("opened by");
      await expect(issue).toContainText("imported by You");
      await screenshotScenario(page, "task-page-imported-bug", { inView: issue });

      // Imported once: the Project's page counts the one left.
      await page.goto(`/projects/${project.id}/issues`);
      await expect(page.getByText("1 open issue not yet imported")).toBeVisible();
    } finally {
      await repository.remove();
    }
  });

  test("Work › Pull requests merges a pull request after GitHub's refusal, closes another, and their Tasks show it", async ({
    page,
  }) => {
    const repository = await createTemporaryRepositoryWithRemote();
    const fullName = `office-user/pull-request-merges-${Date.now()}`;
    try {
      await installApp("office-user", [{ fullName }]);
      const project = await addProjectOnGitHub(page, repository, fullName, "Pull request merges");
      const merged = await createTask(page, project, "Merge the pull request from The Office");
      const closed = await createTask(page, project, "Close the pull request from The Office");
      const mergedNumber = await openPullRequestOnGitHub(fullName, merged);
      const closedNumber = await openPullRequestOnGitHub(fullName, closed);
      for (const number of [mergedNumber, closedNumber]) {
        await controlPullRequest({
          action: "setChecks",
          repository: fullName,
          number,
          checks: "passing",
        });
      }
      await controlPullRequest({
        action: "refuseMerge",
        repository: fullName,
        number: mergedNumber,
        status: 405,
        message: 'Required status check "build" is expected.',
      });

      await page.goto("/work/pull-requests");
      const mergedRow = page
        .getByRole("row")
        .filter({ hasText: `#${mergedNumber} ${merged.title}` });
      const closedRow = page
        .getByRole("row")
        .filter({ hasText: `#${closedNumber} ${closed.title}` });
      // Merge sends the head commit a round read, so wait for the round that reads both.
      await expect(async () => {
        await page.getByRole("button", { name: "Refresh" }).click();
        await expect(mergedRow).toContainText("Passing", { timeout: 3_000 });
        await expect(closedRow).toContainText("Passing", { timeout: 3_000 });
      }).toPass({ timeout: 45_000 });

      await mergedRow.getByRole("button", { name: "Merge…" }).click();
      const mergeDialog = page.getByRole("dialog");
      // The design system's radios take no accessible name; each sits in its option's label.
      await expect(
        mergeDialog.locator("label").filter({ hasText: "Squash and merge" }).getByRole("radio"),
      ).toBeChecked();
      await mergeDialog.getByRole("button", { name: "Merge pull request" }).click();
      await expect(mergeDialog).toContainText(
        `GitHub won't merge #${mergedNumber}: Required status check "build" is expected.`,
      );
      await expect(mergedRow).toBeVisible();
      await screenshotScenario(page, "merge-pull-request-refused", { inView: mergeDialog });

      await controlPullRequest({
        action: "allowMerge",
        repository: fullName,
        number: mergedNumber,
      });
      await mergeDialog.getByRole("button", { name: "Merge pull request" }).click();
      await expect(mergeDialog).toBeHidden();
      await expect(mergedRow).toBeHidden();

      await closedRow.getByRole("button", { name: "Close…" }).click();
      const closeDialog = page.getByRole("dialog");
      await expect(closeDialog).toContainText(`Close #${closedNumber} without merging?`);
      await closeDialog.getByRole("button", { name: "Close pull request" }).click();
      await expect(closeDialog).toBeHidden();
      await expect(closedRow).toBeHidden();

      await page.goto(`/tasks/${merged.id}`);
      await expect(page.getByText("Pull request merged")).toBeVisible();
      await screenshotScenario(page, "task-pull-request-merged");
      await page.goto(`/tasks/${closed.id}`);
      await expect(page.getByText("Pull request closed")).toBeVisible();
    } finally {
      await repository.remove();
    }
  });

  test("signing out forgets who was signed in", async ({ page }) => {
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
    await expect(page.getByText("Signed in as")).toBeHidden();
  });

  test(
    "signed out, From GitHub says to sign in, with Settings and a git URL instead",
    { tag: "@full" },
    async ({ page }) => {
      const dialog = await openFromGitHub(page);

      await expect(
        dialog.getByRole("heading", { name: "Sign in with GitHub first" }),
      ).toBeVisible();
      await expect(dialog.getByLabel("Search your repositories")).toBeHidden();
      await expect(repositoryList(page)).toBeHidden();
      await dialog.getByRole("button", { name: "Use a git URL instead" }).click();
      await expect(dialog.getByLabel("Repository URL")).toBeVisible();
      await dialog.getByRole("tab", { name: "From GitHub" }).click();
      await dialog.getByRole("link", { name: "Open Settings › Office identity" }).click();

      await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
    },
  );
});

test(
  "why registering or signing in failed is shown until dismissed",
  { tag: "@full" },
  async ({ page }) => {
    // Where GitHub's return lands the browser when The Office couldn't finish either.
    const failures = new URLSearchParams({
      [GITHUB_APP_REGISTRATION_FAILED_PARAMETER]: "GitHub's code expired.",
      [GITHUB_SIGN_IN_FAILED_PARAMETER]: "You cancelled on GitHub's page.",
    });
    await page.goto(`${OFFICE_IDENTITY_SETTINGS_PATH}?${failures}`);

    const registration = page.getByRole("status").filter({ hasText: "wasn't registered" });
    const signIn = page.getByRole("status").filter({ hasText: "Signing in with GitHub failed" });
    await expect(registration).toContainText("GitHub's code expired.");
    await expect(signIn).toContainText("You cancelled on GitHub's page.");

    await registration.getByRole("button", { name: "Dismiss" }).click();
    await expect(registration).toBeHidden();
    await signIn.getByRole("button", { name: "Dismiss" }).click();

    await expect(signIn).toBeHidden();
    await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
  },
);

test.describe("the Office ssh key", { tag: "@full" }, () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("its public half is masked until shown, copied whole either way, never its private half", async ({
    page,
  }) => {
    const { publicKey: whole } = officeSshKeySchema.parse(
      await (await page.request.get("/api/office-identity/ssh-key")).json(),
    );
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);

    const publicKey = page.getByLabel("The Office ssh key's public half");
    await expect(publicKey).toHaveText(/^ssh-ed25519 •+ the-office@/);
    await page.getByRole("button", { name: "Copy the public key" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(whole);

    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(publicKey).toHaveText(whole);
    await expect(publicKey).not.toContainText("PRIVATE KEY");
    await page.getByRole("button", { name: "Hide", exact: true }).click();
    await expect(publicKey).toHaveText(/^ssh-ed25519 •+ the-office@/);
  });

  test("regenerating it needs the consequences acknowledged, and Close keeps the key", async ({
    page,
  }) => {
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
    await page.getByRole("button", { name: "Show", exact: true }).click();
    const publicKey = page.getByLabel("The Office ssh key's public half");
    await expect(publicKey).toHaveText(/^ssh-ed25519 [^•\s]+ the-office@/);
    const before = await publicKey.textContent();

    await page.getByRole("button", { name: "Regenerate…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("deleted for good");
    await expect(dialog).toContainText("Settings › SSH and GPG keys");
    await expect(dialog).toContainText(
      "Sign in with GitHub, https remotes and the Trusted hosts are not affected",
    );
    const regenerate = dialog.getByRole("button", { name: "Regenerate the key" });
    await expect(regenerate).toBeDisabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(publicKey).toHaveText(before ?? "");

    await page.getByRole("button", { name: "Regenerate…" }).click();
    const understood = dialog
      .locator("label")
      .filter({ hasText: "I understand The Office loses access to every ssh host" })
      .getByRole("checkbox");
    await understood.click();
    await expect(understood).toHaveAttribute("aria-checked", "true");
    await expect(regenerate).toBeEnabled();
    await regenerate.click();

    await expect(dialog).toBeHidden();
    await expect(publicKey).toHaveText(/^ssh-ed25519 [^•\s]+ the-office@/);
    await expect(publicKey).not.toHaveText(before ?? "");
    await expect(page.getByText("The Office ssh key is new.")).toBeVisible();
  });
});

test(
  "an Unconfirmed host becomes a Trusted host once its fingerprint is confirmed",
  { tag: "@full" },
  async ({ page }) => {
    // Cloning from an ssh host The Office doesn't trust makes it an Unconfirmed host; `.invalid`
    // never resolves, so the clone itself fails.
    const host = "unconfirmed.invalid:2222";
    await page.request.post("/api/repositories/clones", {
      data: { url: `ssh://git@${host}/office/notes.git` },
    });
    await expect
      .poll(async () => {
        const knownHosts = knownHostsSchema.parse(
          await (await page.request.get("/api/office-identity/known-hosts")).json(),
        );
        return knownHosts.unconfirmed.map((each) => `${each.host}:${each.port}`);
      })
      .toContain(host);
    await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);

    const unconfirmed = page.getByRole("listitem", { name: host, exact: true });
    await unconfirmed.getByRole("button", { name: "Scan" }).click();
    await expect(unconfirmed).toContainText(E2E_HOST_KEY_FINGERPRINT);
    await unconfirmed.getByRole("button", { name: "Confirm fingerprint" }).click();

    // Other tests' remotes may still be listed, so only this host's Scan is expected to go.
    await expect(unconfirmed.getByRole("button", { name: "Scan" })).toBeHidden();
    const trusted = page.getByRole("listitem", { name: host, exact: true });
    await expect(trusted.getByRole("list", { name: `Fingerprints of ${host}` })).toHaveText(
      E2E_HOST_KEY_FINGERPRINT,
    );
  },
);

/**
 * A Project whose base branch tracks `fullName` on the fake GitHub, which the pull request watch
 * reads without fetching; nothing fetches or pushes, as the fake serves no git.
 */
async function addProjectOnGitHub(
  page: Page,
  repository: TemporaryRepositoryWithRemote,
  fullName: string,
  name: string,
): Promise<Project> {
  const newProject: NewProject = {
    name: `${name} ${Date.now()}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "PR", colour: "teal" },
    installCommand: "",
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
  const added = await page.request.post("/api/projects", { data: newProject });
  expect(added.status(), await added.text()).toBe(201);
  const project = projectSchema.parse(await added.json());
  execFileSync("git", ["remote", "set-url", "origin", `${FAKE_GITHUB_URL}/${fullName}.git`], {
    cwd: repository.path,
    stdio: "ignore",
  });
  return project;
}

async function createTask(page: Page, project: Project, title: string): Promise<Task> {
  const created = await page.request.post("/api/tasks", {
    data: { title, projectId: project.id, priority: "normal" },
  });
  expect(created.status()).toBe(201);
  return taskSchema.parse(await created.json());
}

/**
 * Opens the Task's pull request on the fake GitHub from its `office/<task id>` branch, as Publish
 * opens it (pushing needs a remote the fake can't serve), as the signed-in user; the watch adopts
 * it by its branch. Gives its number.
 */
async function openPullRequestOnGitHub(fullName: string, task: Task): Promise<number> {
  const [signIn] = await queryOfficeDatabase("select access_token from github_sign_in", []);
  const opened = await fetch(`${FAKE_GITHUB_API_URL}/repos/${fullName}/pulls`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${String(signIn?.["access_token"])}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ head: `office/${task.id}`, base: "main", title: task.title }),
  });
  expect(opened.status).toBe(201);
  return ((await opened.json()) as { number: number }).number;
}
