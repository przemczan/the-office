import { expect, test, type WebSocket } from "@playwright/test";
import { E2E_USER, NOT_SIGNED_IN, signInWithPassword } from "./e2e-user.ts";
import { screenshotScenario } from "./task-screenshots.ts";
import { openUserMenu } from "./top-bar.ts";

// Each test starts in a browser that isn't signed in, rather than as the setup's signed-in device,
// which every other file shares and none may sign out. The shared user's password is tried wrong
// at most once in a row, and right after, so no test locks them out.
test.use({
  storageState: NOT_SIGNED_IN,
  colorScheme: "light",
  viewport: { width: 1600, height: 900 },
});

test("before signing in only the sign-in page shows, with no WebSocket; signing in returns to the page asked for, and Sign out ends it", async ({
  page,
}) => {
  const sockets: WebSocket[] = [];
  page.on("websocket", (socket) => sockets.push(socket));

  await page.goto("/work/ideas");

  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fwork%2Fideas$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to The Office");
  // No shell: no rail, no top bar, no status strip.
  await expect(page.getByRole("navigation", { name: "Surfaces" })).toHaveCount(0);
  await expect(page.locator(".shell")).toHaveCount(0);
  // Only the ways this address offers: on localhost, a password alone for now.
  await expect(page.getByRole("form")).toHaveCount(1);
  await expect(page.getByRole("form", { name: "Sign in with a password" })).toBeVisible();
  await screenshotScenario(page, "sign-in-page");

  const form = page.getByRole("form", { name: "Sign in with a password" });
  await form.getByLabel("Email").fill(E2E_USER.email);
  await form.getByLabel("Password").fill("not the password at all");
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("The email or password is wrong.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
  expect(sockets).toHaveLength(0);

  await signInWithPassword(page);

  await expect(page).toHaveURL(/\/work\/ideas$/);
  await expect(page.getByRole("navigation", { name: "Surfaces" })).toBeVisible();
  await expect
    .poll(() => sockets.map((socket) => new URL(socket.url()).pathname))
    .toEqual(["/api/events"]);
  const menu = await openUserMenu(page, E2E_USER.name);
  await expect(menu.getByRole("button", { name: "Account" })).toBeVisible();
  await screenshotScenario(page, "user-menu");

  await menu.getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("form", { name: "Sign in with a password" })).toBeVisible();
  expect((await page.request.get("/api/account")).status()).toBe(401);
});

test("signing out another device on the Account page ends it: its WebSocket closes and it lands on the sign-in page", async ({
  page,
  browser,
}, testInfo) => {
  // The other device, told apart in the list by its browser.
  const elsewhere = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    storageState: NOT_SIGNED_IN,
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  });
  const other = await elsewhere.newPage();
  const otherSocket = other.waitForEvent("websocket");
  await other.goto("/projects");
  await signInWithPassword(other);
  await expect(other).toHaveURL(/\/projects$/);
  const socket = await otherSocket;
  const socketClosed = new Promise<void>((resolve) => socket.on("close", () => resolve()));

  await page.goto("/account");
  await signInWithPassword(page);
  await expect(page).toHaveURL(/\/account$/);
  const devices = page.getByRole("table");
  const thisDevice = devices.getByRole("row").filter({ hasText: "This device" });
  await expect(thisDevice).toHaveCount(1);
  // Playwright's Desktop Chrome says it is Chrome on Windows.
  await expect(thisDevice).toContainText("Chrome on Windows");
  const otherRow = devices.getByRole("row").filter({ hasText: "Firefox on Linux" });
  await expect(otherRow).toHaveCount(1);
  await expect(otherRow).not.toContainText("This device");
  await screenshotScenario(page, "account-page");

  await otherRow.getByRole("button", { name: /^Sign out/ }).click();

  await expect(otherRow).toHaveCount(0);
  await socketClosed;
  await expect(other).toHaveURL(/\/sign-in\?returnTo=%2Fprojects$/);
  expect((await other.request.get("/api/account")).status()).toBe(401);
  await elsewhere.close();

  // This device's own Sign out, on the Account page, lands on the sign-in page too.
  await thisDevice.getByRole("button", { name: "Sign out this device" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
