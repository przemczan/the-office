import { expect, test } from "@playwright/test";
import {
  GITHUB_APP_REGISTRATION_FAILED_PARAMETER,
  GITHUB_SIGN_IN_FAILED_PARAMETER,
  knownHostsSchema,
  OFFICE_IDENTITY_SETTINGS_PATH,
} from "@the-office/contracts";
import { FAKE_GITHUB_URL } from "./fake-github.ts";
import { E2E_HOST_KEY_FINGERPRINT } from "./ssh-host.ts";

// The tests that register the App and sign in run in order: signing in needs the App registered.
test("registering the GitHub App posts its manifest to GitHub and comes back to The Office", async ({
  page,
}) => {
  await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
  await page.getByRole("button", { name: "Register the GitHub App" }).click();

  await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
  await expect(
    page.getByText(/The GitHub App the-office-fake-\d+ is registered on office-user/),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Install the App on repositories" })).toHaveAttribute(
    "href",
    new RegExp(`^${FAKE_GITHUB_URL}/apps/the-office-fake-\\d+/installations/new$`),
  );
});

test("signing in through GitHub's page shows who is signed in, until signing out", async ({
  page,
}) => {
  await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();

  await expect(page).toHaveURL(OFFICE_IDENTITY_SETTINGS_PATH);
  await expect(page.getByText("Signed in as")).toBeVisible();
  await expect(page.getByText("office-user", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Install the App on more repositories" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();

  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  await expect(page.getByText("Signed in as")).toBeHidden();
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

test("the Office ssh key's public half is shown, never its private half", async ({ page }) => {
  await page.goto(OFFICE_IDENTITY_SETTINGS_PATH);

  const publicKey = page.getByLabel("The Office ssh key's public half");
  await expect(publicKey).toHaveText(/^ssh-ed25519 \S+ the-office@/);
  await expect(publicKey).not.toContainText("PRIVATE KEY");
  await expect(page.getByRole("button", { name: "Copy the public key" })).toBeVisible();
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

  await expect(page.getByText("No Unconfirmed host.")).toBeVisible();
  const trusted = page.getByRole("listitem", { name: host, exact: true });
  await expect(trusted.getByRole("list", { name: `Fingerprints of ${host}` })).toHaveText(
    E2E_HOST_KEY_FINGERPRINT,
  );
});
