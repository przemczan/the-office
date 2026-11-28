import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_USER, NOT_SIGNED_IN, signInWithPassword } from "./e2e-user.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { openUserMenu } from "./top-bar.ts";

// Each test signs in on a device of its own, since signing out the setup's saved one would sign out
// every file.
test.use({
  storageState: NOT_SIGNED_IN,
  colorScheme: "light",
  viewport: { width: 1600, height: 900 },
});

/**
 * A passkey authenticator on the page, through Chromium's DevTools protocol: a platform one that
 * keeps discoverable passkeys, verifies the user and answers without a touch. It lives with the
 * page, so a test adds a passkey and signs in with it on the same page.
 */
async function addVirtualAuthenticator(page: Page): Promise<void> {
  const devTools = await page.context().newCDPSession(page);
  await devTools.send("WebAuthn.enable");
  await devTools.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** A passkey of the e2e user's for `old.example.com`, an address no longer The Office's. */
async function addPasskeyAtAnOldAddress(name: string): Promise<{ readonly name: string }> {
  await queryOfficeDatabase(
    `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, name,
       rp_id, device_type, backed_up, created_at)
     SELECT $1, id, $2, '\\x00'::bytea, 0, '{}', $3, 'old.example.com', 'multi-device', true, now()
     FROM users WHERE lower(email) = lower($4) AND removed_at IS NULL`,
    [randomUUID(), randomUUID(), name, E2E_USER.email],
  );
  return { name };
}

test("a user adds a passkey with a name, renames it, signs in with it alone and removes it", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);
  await page.goto("/account/passkeys");
  await signInWithPassword(page);
  await expect(page).toHaveURL(/\/account\/passkeys$/);
  const name = `Virtual key ${randomUUID().slice(0, 8)}`;

  await page.getByRole("button", { name: "Add a passkey" }).click();
  const adding = page.getByRole("dialog");
  await adding.getByRole("textbox", { name: "Current password" }).fill(E2E_USER.password);
  await adding.getByRole("button", { name: "Continue" }).click();
  await adding.getByRole("textbox", { name: "Name" }).fill(name);
  await adding.getByRole("button", { name: "Add the passkey" }).click();

  const added = page.getByRole("row").filter({ hasText: name });
  await expect(added).toContainText("Works at localhost");
  await expect(added).toContainText("Never");
  // One added at an earlier public address, which only the database can make here.
  const old = await addPasskeyAtAnOldAddress(`Old key ${randomUUID().slice(0, 8)}`);
  await page.reload();
  const oldRow = page.getByRole("row").filter({ hasText: old.name });
  await expect(oldRow).toContainText("Old address");
  await expect(oldRow).toContainText("Added at old.example.com, no longer The Office's address");
  await screenshotScenario(page, "account-passkeys");
  await oldRow.getByRole("button", { name: `Remove ${old.name}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove the passkey" }).click();
  await expect(oldRow).toHaveCount(0);

  const renamed = `${name}, renamed`;
  await added.getByRole("button", { name: `Rename ${name}` }).click();
  const renaming = page.getByRole("dialog");
  await renaming.getByRole("textbox", { name: "Name" }).fill(renamed);
  await renaming.getByRole("button", { name: "Save" }).click();
  const row = page.getByRole("row").filter({ hasText: renamed });
  await expect(row).toHaveCount(1);

  const menu = await openUserMenu(page, E2E_USER.name);
  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await screenshotScenario(page, "sign-in-with-a-passkey");

  // No email: the passkey names its user.
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto("/account/passkeys");
  await expect(row).not.toContainText("Never");

  await row.getByRole("button", { name: `Remove ${renamed}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove the passkey" }).click();
  await expect(row).toHaveCount(0);
});

test(
  "at 127.0.0.1 the sign-in page hides passkeys and says to use localhost",
  { tag: "@full" },
  async ({ page }, testInfo) => {
    const { port } = new URL(String(testInfo.project.use.baseURL));

    await page.goto(`http://127.0.0.1:${port}/sign-in`);

    await expect(page.getByRole("form", { name: "Sign in with a password" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
    await expect(page.getByText("Passkeys don't work at an IP address.")).toBeVisible();
    await expect(page.getByRole("link", { name: `Open localhost:${port}` })).toHaveAttribute(
      "href",
      `http://localhost:${port}/sign-in`,
    );
  },
);
