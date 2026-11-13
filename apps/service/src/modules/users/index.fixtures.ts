import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { expect } from "vitest";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { SIGN_IN_COOKIE } from "./adapters/http/sign-in-cookie.js";
import { userOf } from "./domain/user.js";
import { UserRepository } from "./ports/user-repository.js";

/** A password the rules take. */
export const A_PASSWORD = "correct horse battery staple";

export interface UserForTests {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/**
 * A user of the test's own, with an email no other test has, kept straight in the app's database:
 * the first user is the sign-in page's alone, and adding users is a later Task's.
 */
export async function addUser(
  app: INestApplication,
  { name = "Ada Lovelace", password = A_PASSWORD }: { name?: string; password?: string } = {},
): Promise<UserForTests> {
  const email = `ada-${randomUUID().slice(0, 8)}@example.com`;
  const hash = await new ScryptPasswordHashing().hash(password);
  const user = userOf(randomUUID(), { name, email, password }, hash, new Date());
  await app.get(UserRepository, { strict: false }).add(user);
  return { id: user.id, name, email, password };
}

/** The cookie a password sign-in gives the user, as a Cookie header sends it back. */
export async function signedInCookie(url: string, user: UserForTests): Promise<string> {
  const response = await fetch(`${url}/api/sign-in/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((set) => set.startsWith(`${SIGN_IN_COOKIE}=`));
  if (cookie === undefined) throw new Error("The sign-in set no cookie.");
  return cookie.split(";")[0] ?? "";
}

export {
  send,
  setCookieOf,
  startUsersApplication,
  type UsersApplication,
} from "./users-application.fixtures.js";
