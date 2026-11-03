import { expect, test } from "@playwright/test";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  knownHostsSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
  officeSshKeySchema,
} from "@the-office/contracts";
import { FAKE_GITHUB_URL, installApp } from "./fake-github.ts";
import { serveRepository } from "./git-host.ts";
import { E2E_HOST_KEY_FINGERPRINT } from "./ssh-host.ts";
import { createTemporaryRepository } from "./temporary-repository.ts";

// Registering the App, signing in, what needs the sign-in and signing out run in order, and stop
// at the first failure: each needs the one before. Sign-in is the Office's, shared with the files
// running beside this one, so every test that needs it is here, before signing out.
test.describe.serial("Sign in with GitHub", () => {
  test.afterAll(async ({ playwright }, testInfo) => {
    // Signed out even when a test before "signing out" failed.
    const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
    await api.delete("/api/github/sign-in");
    await api.dispose();
  });

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

  test("signed in, Add Project picks a repository from GitHub and clones it as a typed URL", async ({
    page,
  }) => {
    const repository = await createTemporaryRepository();
    try {
      const url = serveRepository(repository, "office-user", "picked-notes");
      await installApp("office-user", [
        { fullName: "office-user/picked-notes", private: true },
        { fullName: "office-user/left-alone" },
      ]);
      await page.goto("/projects");
      await page.getByRole("button", { name: "Add it yourself" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("tab", { name: "From GitHub" }).click();

      const repositories = dialog.getByRole("list", { name: "Your GitHub repositories" });
      await expect(repositories.getByRole("button")).toHaveText([
        /office-user\/left-alone\s*main/,
        /office-user\/picked-notes\s*Private\s*main/,
      ]);
      await dialog.getByLabel("Search your repositories").fill("PICKED");
      await expect(repositories.getByRole("button")).toHaveCount(1);
      await dialog.getByLabel("Search your repositories").fill("nothing like it");
      await expect(dialog.getByText("No repository matches.")).toBeVisible();
      await dialog.getByLabel("Search your repositories").fill("picked");
      await repositories.getByRole("button", { name: /office-user\/picked-notes/ }).click();

      await expect(dialog.getByLabel("Name")).toHaveValue("picked-notes");
      await expect(dialog.getByLabel("Repository URL")).toHaveValue(url);
      await expect(dialog.getByText(/Cloned into .*picked-notes/)).toBeVisible();
      await expect(dialog.getByLabel("Base branch")).toHaveValue("main");
      await dialog.getByLabel("Name").fill("Picked notes");
      await dialog.getByLabel("Install", { exact: true }).fill("npm ci");
      await dialog.getByLabel("Build").fill("npm run build");
      await dialog.getByLabel("Lint").fill("npm run lint");
      await dialog.getByLabel("Test").fill("npm test");
      await dialog.getByRole("button", { name: "Add the Project" }).click();

      await expect(page).toHaveURL(/\/projects\/picked-notes$/);
      await expect(page.getByText(url)).toBeVisible();
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

  test("signed out, Add Project's From GitHub says to sign in, linking Settings", async ({
    page,
  }) => {
    await page.goto("/projects");
    await page.getByRole("button", { name: "Add it yourself" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "From GitHub" }).click();

    await expect(dialog).toContainText("Sign in with GitHub in Settings › Office identity");
    await expect(dialog.getByRole("list", { name: "Your GitHub repositories" })).toBeHidden();
    await dialog.getByRole("link", { name: "Settings › Office identity" }).click();

    await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
  });
});

test("why registering or signing in failed is shown until dismissed", async ({ page }) => {
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
});

test.describe("the Office ssh key", () => {
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

  test("regenerating it needs the consequences acknowledged, and Cancel keeps the key", async ({
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
    await dialog.getByRole("button", { name: "Cancel" }).click();
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

test("an Unconfirmed host becomes a Trusted host once its fingerprint is confirmed", async ({
  page,
}) => {
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
});
