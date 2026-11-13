import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { NOT_SIGNED_IN } from "./e2e-user.ts";
import { queryOfficeDatabase } from "./office-database.ts";
import { screenshotScenario } from "./task-screenshots.ts";

// A user of this file's own, so the shared e2e user never gets an authenticator: every other file
// signs in as them with a password alone.
const GRACE = {
  name: "Grace Hopper",
  email: `grace-${randomUUID().slice(0, 8)}@e2e.example`,
  password: "A ship in port is safe, but that is not what ships are for.",
};

test.use({
  storageState: NOT_SIGNED_IN,
  colorScheme: "light",
  viewport: { width: 1600, height: 900 },
});

test.beforeAll(async () => {
  await queryOfficeDatabase(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, now())",
    [randomUUID(), GRACE.name, GRACE.email, passwordHashOf(GRACE.password)],
  );
});

/**
 * The password as the service keeps it, `scrypt$N$r$p$salt$key`: adding a user is no screen yet,
 * so the user is seeded. A lower cost than the service's own, which reads it from the hash, so the
 * seeding stays quick.
 */
function passwordHashOf(password: string): string {
  const [cost, blockSize, parallelization] = [2 ** 14, 8, 1];
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFC"), salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelization,
  });
  return [
    "scrypt",
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** The code the authenticator app shows `steps` time steps from now, on the service's own clock. */
function codeOf(key: string, steps = 0): string {
  const step = Math.floor(Date.now() / 30_000) + steps;
  return generateHOTP(decodeBase32IgnorePadding(key), BigInt(step), 6);
}

async function signInWithPassword(page: Page, path: string): Promise<void> {
  await page.goto(path);
  const form = page.getByRole("form", { name: "Sign in with a password" });
  await form.getByLabel("Email").fill(GRACE.email);
  await form.getByLabel("Password").fill(GRACE.password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** A new browser, signed in as nobody, at a size the screenshots start from. */
async function newBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: NOT_SIGNED_IN,
    colorScheme: "light",
    viewport: { width: 1600, height: 900 },
  });
  return context.newPage();
}

test("the user sets up an authenticator, signs in with a password and its code, then with a recovery code, and turns it off", async ({
  page,
  browser,
}) => {
  await signInWithPassword(page, "/account");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("Off: your password alone signs you in.")).toBeVisible();
  await page.getByRole("button", { name: "Set up the authenticator" }).click();

  const setUp = page.getByRole("dialog", { name: "Set up the authenticator" });
  await expect(
    setUp.getByRole("img", { name: "The QR code for your authenticator app" }),
  ).toBeVisible();
  const key = (await setUp.getByLabel("The key").innerText()).replaceAll(" ", "");
  await screenshotScenario(page, "authenticator-set-up");
  await setUp.getByRole("textbox", { name: "Authenticator code" }).fill(codeOf(key, 5));
  await setUp.getByRole("button", { name: "Turn on the authenticator" }).click();
  await expect(setUp.getByText("The code is wrong.")).toBeVisible();
  await setUp.getByRole("textbox", { name: "Authenticator code" }).fill(codeOf(key));
  await setUp.getByRole("button", { name: "Turn on the authenticator" }).click();

  const saved = page.getByRole("dialog", { name: "Save your recovery codes" });
  const shownCodes = saved.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
  await expect(shownCodes).toHaveCount(10);
  const codes = await shownCodes.allInnerTexts();
  await screenshotScenario(page, "authenticator-recovery-codes");
  await saved.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("10 recovery codes left.")).toBeVisible();
  await screenshotScenario(page, "account-authenticator-on");

  // A password alone no longer signs in: the code page asks for the code, outside the shell. The
  // first code's step is taken, so the next step's code, within the drift, signs in at once.
  const withCode = await newBrowser(browser);
  await signInWithPassword(withCode, "/work");
  await expect(withCode).toHaveURL(/\/sign-in\/code\?returnTo=%2Fwork$/);
  await expect(withCode.getByRole("heading", { level: 1 })).toHaveText("Authenticator code");
  await expect(withCode.locator(".shell")).toHaveCount(0);
  await screenshotScenario(withCode, "sign-in-code");
  await withCode.getByRole("textbox", { name: "Authenticator code" }).fill(codeOf(key, 1));
  await withCode.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(withCode).toHaveURL(/\/work/);
  await expect(withCode.locator(".shell")).toBeVisible();

  const withRecoveryCode = await newBrowser(browser);
  await signInWithPassword(withRecoveryCode, "/account");
  await withRecoveryCode.getByRole("button", { name: "Use a recovery code" }).click();
  await withRecoveryCode.getByRole("textbox", { name: "Recovery code" }).fill(codes[0] ?? "");
  await withRecoveryCode.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(withRecoveryCode).toHaveURL(/\/account$/);
  await expect(withRecoveryCode.getByText("9 recovery codes left.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Turn off" }).click();
  const turnOff = page.getByRole("dialog", { name: "Turn off the authenticator" });
  await turnOff.getByRole("button", { name: "Use a recovery code" }).click();
  await turnOff.getByRole("textbox", { name: "Recovery code" }).fill(codes[0] ?? "");
  await turnOff.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(turnOff.getByText("The code is wrong.")).toBeVisible();
  await turnOff.getByRole("textbox", { name: "Recovery code" }).fill(codes[1] ?? "");
  await turnOff.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(turnOff).toHaveCount(0);
  await expect(page.getByText("Off: your password alone signs you in.")).toBeVisible();

  const passwordAlone = await newBrowser(browser);
  await signInWithPassword(passwordAlone, "/account");
  await expect(passwordAlone).toHaveURL(/\/account$/);
});
