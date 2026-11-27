import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page, type WebSocket } from "@playwright/test";
import { userListSchema } from "@the-office/contracts";
import { E2E_USER, NOT_SIGNED_IN } from "./e2e-user.ts";
import { addOwnUser, type SignedInState } from "./own-user.ts";
import { screenshotScenario } from "./task-screenshots.ts";

test.use({ colorScheme: "light", viewport: { width: 1600, height: 900 } });

/** Signs in on the sign-in page shown with an email and a password, one-time or not. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  const form = page.getByRole("form", { name: "Sign in with a password" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** What the page's init script recorded under `name`, such as the palette at its first load. */
function recorded(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate((key) => (window as unknown as Record<string, string>)[key], name);
}

// The new user is this test's own: the shared user is only the one who adds and removes them.
test("a user added in Settings › Users signs in with their one-time password, sets their own, and is signed out everywhere once removed", async ({
  page,
  browser,
}, testInfo) => {
  // A second browser signs in twice and sets a password: about 17s with every step passing alone,
  // past the default 60 s under the Tests Stage's load.
  test.setTimeout(120_000);
  const unique = randomUUID().slice(0, 8);
  const name = `Grace Hopper ${unique}`;
  const email = `grace-${unique}@e2e.example`;
  const password = `Grace's own password ${unique}`;

  // The account's own sections, only looked at: the shared user's profile and appearance stay.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account\/profile$/);
  await expect(page.getByRole("form", { name: "Profile" }).getByLabel("Email")).toHaveValue(
    E2E_USER.email,
  );
  await screenshotScenario(page, "account-profile");
  await page.goto("/settings/appearance");
  await expect(page).toHaveURL(/\/account\/appearance$/);
  await expect(page.getByRole("group", { name: "Palette" })).toBeVisible();
  await screenshotScenario(page, "account-appearance");

  await page.goto("/settings/users");
  const users = page.getByRole("table");
  const you = users.getByRole("row").filter({ hasText: E2E_USER.email });
  await expect(you).toContainText("You");
  // Removing yourself is refused: the button is off, and the service says so too.
  const removeYourself = you.getByRole("button", { name: `Remove ${E2E_USER.name}` });
  await expect(removeYourself).toBeDisabled();
  await expect(removeYourself).toHaveAttribute("title", "You can't remove yourself.");
  const listed = userListSchema.parse(await (await page.request.get("/api/users")).json());
  const yourId = listed.find((user) => user.you)?.id;
  const refused = await page.request.delete(`/api/users/${yourId}`);
  expect(refused.status()).toBe(422);
  expect(await refused.json()).toMatchObject({ reasons: ["You can't remove yourself."] });

  await page.getByRole("button", { name: "Add a user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Add the user" }).click();

  const shown = dialog.getByLabel("One-time password");
  await expect(shown).toHaveText(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  await expect(dialog.getByText("Shown only once")).toBeVisible();
  const oneTimePassword = (await shown.textContent()) ?? "";
  await screenshotScenario(page, "user-added");
  await page.keyboard.press("Escape");
  const row = users.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("Waiting for first sign-in");
  await expect(row).not.toContainText("You");
  await screenshotScenario(page, "settings-users");

  // Their own browser: the one-time password signs in only as far as setting their own.
  const theirs = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: NOT_SIGNED_IN,
  });
  const other = await theirs.newPage();
  const sockets: WebSocket[] = [];
  other.on("websocket", (socket) => sockets.push(socket));
  await other.goto("/now");
  await expect(other).toHaveURL(/\/sign-in\?returnTo=%2Fnow$/);
  await signInAs(other, email, oneTimePassword);
  const setPassword = other.getByRole("form", { name: "Set your password" });
  await expect(setPassword).toBeVisible();
  expect((await other.request.get("/api/account")).status()).toBe(401);
  await setPassword.getByLabel(/^New password/).fill(password);
  await setPassword.getByLabel("Repeat the new password").fill(password);
  await screenshotScenario(other, "set-your-password");
  await setPassword.getByRole("button", { name: "Set the password and sign in" }).click();

  await expect(other).toHaveURL(/\/now$/);
  await expect(
    other.getByRole("button", { name: `User menu: ${name}`, exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => sockets.filter((socket) => new URL(socket.url()).pathname === "/api/events"))
    .toHaveLength(1);
  const socket = sockets.find((one) => new URL(one.url()).pathname === "/api/events");
  const socketClosed = new Promise<void>((resolve) => socket?.on("close", () => resolve()));
  // Signed in with their own password now, the row waits no longer, without a reload.
  await expect(row).not.toContainText("Waiting for first sign-in");

  await row.getByRole("button", { name: `Remove ${name}` }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText(`${name} is signed out on all their devices at once`);
  await confirm.getByRole("button", { name: `Remove ${name}` }).click();

  await expect(page.getByText(`${name} was removed.`)).toBeVisible();
  await expect(row).toHaveCount(0);
  await socketClosed;
  await expect(other).toHaveURL(/\/sign-in\?returnTo=%2Fnow$/);
  expect((await other.request.get("/api/account")).status()).toBe(401);
  await theirs.close();
});

// Two users of the test's own, each in their own browser: a palette and a density are each
// user's, so the shared user's appearance, which every other file sees, is never changed.
test(
  "each user sees their own palette and density, which follow them to another browser and paint before the page's first frame",
  { tag: "@full" },
  async ({ browser, playwright, baseURL }) => {
    const ada = await addOwnUser(playwright, baseURL, "Ada of her own");
    const grace = await addOwnUser(playwright, baseURL, "Grace of her own");
    try {
      await ada.chooseAppearance({ palette: "mocha", density: "compact" });
      await grace.chooseAppearance({ palette: "paper", density: "relaxed" });
      // A system in light, so a dark palette shows as the user's, not the system's.
      const browserOf = async (storageState: SignedInState): Promise<BrowserContext> => {
        const context = await browser.newContext({ baseURL, storageState, colorScheme: "light" });
        // What `<html>` says when the document's parsing ends, before the account is read, and when
        // the shell's rail first shows, however the page got there.
        await context.addInitScript(() => {
          const record = window as unknown as Record<string, string | undefined>;
          document.addEventListener("DOMContentLoaded", () => {
            record["paletteAtLoad"] = document.documentElement.dataset["palette"];
            record["densityAtLoad"] = document.documentElement.dataset["density"];
          });
          new MutationObserver((_, observer) => {
            if (document.querySelector('nav[aria-label="Surfaces"]') === null) return;
            record["paletteAtShell"] = document.documentElement.dataset["palette"];
            record["densityAtShell"] = document.documentElement.dataset["density"];
            observer.disconnect();
          }).observe(document, { childList: true, subtree: true });
        });
        return context;
      };
      const adasContext = await browserOf(ada.storageState);
      const adas = await adasContext.newPage();
      const gracesContext = await browserOf(grace.storageState);
      const graces = await gracesContext.newPage();
      await adas.goto("/now");
      await graces.goto("/now");

      await expect(adas.locator("html")).toHaveAttribute("data-palette", "mocha");
      await expect(adas.locator("html")).toHaveAttribute("data-density", "compact");
      await expect(graces.locator("html")).toHaveAttribute("data-palette", "paper");
      await expect(graces.locator("html")).toHaveAttribute("data-density", "relaxed");

      // Chosen in the rail, kept for Ada: this browser's cache paints it on a reload, before the
      // account is read.
      await adas.getByRole("button", { name: "Theme" }).click();
      await adas.getByRole("menu").getByRole("button", { name: "Lagoon" }).click();
      await expect(adas.locator("html")).toHaveAttribute("data-palette", "lagoon");
      await expect
        .poll(async () => (await ada.api.get("/api/account")).json())
        .toMatchObject({ appearance: { palette: "lagoon", density: "compact" } });
      await adas.reload();
      await expect(adas.getByRole("navigation", { name: "Surfaces" })).toBeVisible();
      expect(await recorded(adas, "paletteAtLoad")).toBe("lagoon");
      expect(await recorded(adas, "densityAtLoad")).toBe("compact");
      // Grace's stays hers.
      await graces.reload();
      await expect(graces.locator("html")).toHaveAttribute("data-palette", "paper");
      expect(await recorded(graces, "paletteAtLoad")).toBe("paper");

      // Ada signs in on another browser, which has never shown her palette: the shell's first
      // paint is already hers.
      const elsewhereContext = await browserOf(NOT_SIGNED_IN);
      const elsewhere = await elsewhereContext.newPage();
      await elsewhere.goto("/now");
      await expect(elsewhere).toHaveURL(/\/sign-in\?returnTo=%2Fnow$/);
      await expect(elsewhere.locator("html")).toHaveAttribute("data-palette", "light");
      await signInAs(elsewhere, ada.email, ada.password);
      await expect(elsewhere).toHaveURL(/\/now$/);
      await expect(elsewhere.getByRole("navigation", { name: "Surfaces" })).toBeVisible();
      expect(await recorded(elsewhere, "paletteAtShell")).toBe("lagoon");
      expect(await recorded(elsewhere, "densityAtShell")).toBe("compact");

      // Chosen there in Account › Appearance, it follows her back to the first browser.
      await elsewhere.goto("/account/appearance");
      await elsewhere
        .getByRole("group", { name: "Palette" })
        .getByRole("button", { name: "Citrine" })
        .click();
      await elsewhere
        .getByRole("group", { name: "Density" })
        .getByRole("button", { name: "Comfortable" })
        .click();
      await expect(elsewhere.locator("html")).toHaveAttribute("data-palette", "citrine");
      await expect(elsewhere.locator("html")).toHaveAttribute("data-density", "comfortable");
      await expect
        .poll(async () => (await ada.api.get("/api/account")).json())
        .toMatchObject({ appearance: { palette: "citrine", density: "comfortable" } });
      await adas.reload();
      await expect(adas.locator("html")).toHaveAttribute("data-palette", "citrine");
      await expect(adas.locator("html")).toHaveAttribute("data-density", "comfortable");
      await graces.reload();
      await expect(graces.locator("html")).toHaveAttribute("data-palette", "paper");
      await expect(graces.locator("html")).toHaveAttribute("data-density", "relaxed");

      await elsewhereContext.close();
      await adasContext.close();
      await gracesContext.close();
    } finally {
      await ada.remove();
      await grace.remove();
    }
  },
);
