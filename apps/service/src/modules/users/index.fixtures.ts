import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";
import { authenticatorSetupSchema, recoveryCodesSchema } from "@the-office/contracts";
import { expect } from "vitest";
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { SIGN_IN_COOKIE } from "./adapters/http/sign-in-cookie.js";
import { timeStepAt } from "./domain/authenticator.js";
import { userOf } from "./domain/user.js";
import { UserRepository } from "./ports/user-repository.js";
import { send } from "./users-application.fixtures.js";

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
  const user = userOf(randomUUID(), { name, email }, hash, new Date());
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

/** The code the user's authenticator app shows at `at`, or `steps` time steps from it. */
export function authenticatorCodeOf(secret: string, at: Date, steps = 0): string {
  return generateHOTP(decodeBase32IgnorePadding(secret), BigInt(timeStepAt(at) + steps), 6);
}

/**
 * Sets up the signed-in user's authenticator and turns it on with the code of `at`; answers its
 * secret and the recovery codes.
 */
export async function turnOnAuthenticator(
  port: number,
  cookie: string,
  at: Date,
): Promise<{ readonly secret: string; readonly recoveryCodes: readonly string[] }> {
  const setUp = await send(port, {
    method: "POST",
    path: "/api/account/authenticator",
    headers: { cookie },
  });
  const { secret } = authenticatorSetupSchema.parse(setUp.body);
  const confirmed = await send(port, {
    method: "POST",
    path: "/api/account/authenticator/confirm",
    headers: { cookie },
    body: { code: authenticatorCodeOf(secret, at) },
  });
  expect(confirmed.status).toBe(200);
  return { secret, recoveryCodes: recoveryCodesSchema.parse(confirmed.body).recoveryCodes };
}

export {
  send,
  setCookieOf,
  startUsersApplication,
  type UsersApplication,
} from "./users-application.fixtures.js";
