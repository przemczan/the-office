import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  knownHostsSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  officeSshKeySchema,
} from "@the-office/contracts";
import { E2E_STORAGE_STATE, NOT_SIGNED_IN } from "./e2e-user.ts";
import { FAKE_GITHUB_URL, installApp } from "./fake-github.ts";
import { serveRepository } from "./git-host.ts";
import { E2E_HOST_KEY_FINGERPRINT } from "./ssh-host.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { createTemporaryRepository } from "./temporary-repository.ts";

const SCREENSHOTS = path.resolve(import.meta.dirname, "../e2e-results/screenshots");

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
