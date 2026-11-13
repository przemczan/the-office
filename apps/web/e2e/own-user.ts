import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import {
  accountSchema,
  addedUserSchema,
  type Account,
  type Appearance,
} from "@the-office/contracts";
import { E2E_STORAGE_STATE, NOT_SIGNED_IN } from "./e2e-user.ts";

/** What a browser context or a request context is made signed in with. */
export type SignedInState = Awaited<ReturnType<APIRequestContext["storageState"]>>;

/**
 * A user of the test's own, added by the shared e2e user and signed in once with their one-time
 * password, their own password set: what is theirs alone (their appearance) changes for no other
 * test running beside it.
 */
export interface OwnUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  /** Their signed-in device, for `browser.newContext({ storageState })`. */
  readonly storageState: SignedInState;
  /** The API as them, on that device. */
  readonly api: APIRequestContext;
  /** Keeps their palette and density, as Account › Appearance does; one left out is kept as is. */
  chooseAppearance(appearance: Partial<Appearance>): Promise<Account>;
  /** Removes them, as the shared user, which signs out their every device. */
  remove(): Promise<void>;
}

/**
 * Adds a user of the test's own through the API and signs them in with their one-time password,
 * setting their own password. Remove them at the test's end (the `ownUser` fixture does).
 */
export async function addOwnUser(
  playwright: PlaywrightWorkerArgs["playwright"],
  baseURL: string | undefined,
  name = "Own user",
): Promise<OwnUser> {
  const unique = randomUUID().slice(0, 8);
  const email = `own-${unique}@e2e.example`;
  const password = `Own e2e password ${unique}`;
  const shared = await playwright.request.newContext({ baseURL, storageState: E2E_STORAGE_STATE });
  const added = await shared.post("/api/users", { data: { name, email } });
  expect(added.status(), await added.text()).toBe(201);
  const { user, oneTimePassword } = addedUserSchema.parse(await added.json());

  const api = await playwright.request.newContext({ baseURL, storageState: NOT_SIGNED_IN });
  const signedIn = await api.post("/api/sign-in/set-password", {
    data: { email, oneTimePassword, password },
  });
  expect(await signedIn.json()).toEqual({ outcome: "signed-in" });
  const storageState = await api.storageState();

  const account = async (): Promise<Account> =>
    accountSchema.parse(await (await api.get("/api/account")).json());
  return {
    id: user.id,
    name,
    email,
    password,
    storageState,
    api,
    async chooseAppearance(appearance) {
      const kept = (await account()).appearance;
      const chosen = await api.put("/api/account/appearance", {
        data: { ...kept, ...appearance },
      });
      expect(chosen.ok(), await chosen.text()).toBe(true);
      return accountSchema.parse(await chosen.json());
    },
    async remove() {
      await api.dispose();
      const removed = await shared.delete(`/api/users/${user.id}`);
      // Already removed by the test itself is as good.
      expect([204, 404]).toContain(removed.status());
      await shared.dispose();
    },
  };
}

/**
 * The e2e test signed in as a user of its own (`ownUser`), whose `page`, `context` and `request`
 * are theirs: for a test that chooses a palette or a density, which are each user's own, so the
 * shared user's stay as every other file expects them. The user is removed at the test's end.
 */
export const asOwnUser = test.extend<{ ownUser: OwnUser }>({
  ownUser: async ({ playwright, baseURL }, use) => {
    const user = await addOwnUser(playwright, baseURL);
    await use(user);
    await user.remove();
  },
  storageState: async ({ ownUser }, use) => use(ownUser.storageState),
});
