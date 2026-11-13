import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * The one user every e2e file signs in as, created by `sign-in.setup.ts` through the first-user
 * page. Shared, so no test may lock them out: a wrong password is tried at most once in a row, and
 * a right one follows it.
 */
export const E2E_USER = {
  name: "Ada Lovelace",
  email: "ada@e2e.example",
  password: "The Office, signed in for e2e.",
} as const;

/** Where the setup keeps the user's signed-in device for every other project (git-ignored). */
export const E2E_STORAGE_STATE = path.resolve(
  import.meta.dirname,
  "../e2e-results/.auth/user.json",
);

/** A browser that isn't signed in: a context made with it has no cookie and no storage. */
export const NOT_SIGNED_IN = { cookies: [], origins: [] };

/** Signs in on the sign-in page shown, with the e2e user's password. */
export async function signInWithPassword(page: Page): Promise<void> {
  const form = page.getByRole("form", { name: "Sign in with a password" });
  await form.getByLabel("Email").fill(E2E_USER.email);
  await form.getByLabel("Password").fill(E2E_USER.password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}
