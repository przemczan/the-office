import { randomUUID } from "node:crypto";
import {
  accountSchema,
  identityCallbackUrlsSchema,
  linkedIdentityListSchema,
  signInPageSchema,
} from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  addUser,
  authenticatorCodeOf,
  setCookieOf,
  turnOnAuthenticator,
  type UserForTests,
} from "../../index.fixtures.js";
import {
  continueAt,
  cookieNamed,
  linkAt,
  locationOf,
  startWithFakeOpenIdConnect,
  type OfficeWithOpenIdConnect,
} from "../../linked-identities.fixtures.js";
import {
  atLocalhost,
  atLoopbackIp,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import { PUBLIC_ADDRESS, send } from "../../users-application.fixtures.js";
import { linkedIdentities } from "../postgres/linked-identities.schema.js";
import { PENDING_SIGN_IN_COOKIE, SIGN_IN_COOKIE } from "./sign-in-cookie.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");

let database: FreshTestDatabase;
let office: OfficeWithOpenIdConnect;
let me: UserForTests;
let localhost: PageAt;
let cookie: string;
let subject: string;

// A database of its own: starting a pending sign-in removes every one expired by this file's
// clock, which would end the pending sign-ins of other files running at an earlier one.
beforeAll(async () => {
  database = await freshTestDatabase();
});

afterAll(async () => {
  await database.drop();
});

beforeEach(async () => {
  office = await startWithFakeOpenIdConnect({ databaseUrl: database.url });
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  cookie = await signedInAt(office.port, localhost, me);
  // Each test's own identity at the provider, as the table is shared by every test of the run.
  subject = randomUUID();
  office.provider.signedInAs = { subject, name: "ada@example.com" };
});

afterEach(async () => {
  await office.app.close();
});

function rowsOf(userId: string) {
  return office.app
    .get<Database>(DATABASE)
    .select()
    .from(linkedIdentities)
    .where(eq(linkedIdentities.userId, userId));
}

function failureOf(location: URL, path: string, parameter: string): string | null {
  expect(location.pathname).toBe(path);
  return location.searchParams.get(parameter);
}

describe("the sign-in page", () => {
  it("offers Continue with the provider under the name it is saved with, at every address", async () => {
    for (const page of [localhost, atLoopbackIp(office.port), atPublicAddress()]) {
      const answer = await sendFrom(office.port, page, { path: "/api/sign-in" });

      expect(signInPageSchema.parse(answer.body).ways).toContainEqual({
        kind: "openid-connect",
        name: "Zitadel",
      });
    }
  });
});

describe("linking an OpenID Connect identity", () => {
  it("links it from the account under the provider's name, keeping its sub and the email, and unlinks it", async () => {
    const answer = await linkAt(office, localhost, cookie);

    expect(failureOf(locationOf(answer), "/account/linked-identities", "linkFailed")).toBeNull();
    expect(await rowsOf(me.id)).toEqual([
      expect.objectContaining({ provider: "openid-connect", subject, name: "ada@example.com" }),
    ]);
    const listed = await sendFrom(office.port, localhost, {
      path: "/api/account/linked-identities",
      cookie,
    });
    expect(linkedIdentityListSchema.parse(listed.body)).toContainEqual(
      expect.objectContaining({
        provider: "openid-connect",
        providerName: "Zitadel",
        linked: expect.objectContaining({ name: "ada@example.com" }),
      }),
    );

    const unlinked = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: "/api/account/linked-identities/openid-connect",
      cookie,
    });

    expect(unlinked.status).toBe(204);
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it("refuses an identity linked to another user, naming the provider", async () => {
    await linkAt(office, localhost, cookie);
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const graceCookie = await signedInAt(office.port, localhost, grace);

    const answer = await linkAt(office, localhost, graceCookie);

    expect(failureOf(locationOf(answer), "/account/linked-identities", "linkFailed")).toContain(
      "This Zitadel account is linked to another user",
    );
    expect(await rowsOf(grace.id)).toEqual([]);
  });

  it("links at a loopback IP too", async () => {
    const loopback = atLoopbackIp(office.port);
    const atIp = await signedInAt(office.port, loopback, me);

    const answer = await linkAt(office, loopback, atIp);

    expect(failureOf(locationOf(answer), "/account/linked-identities", "linkFailed")).toBeNull();
    expect(await rowsOf(me.id)).toHaveLength(1);
  });
});

describe("Continue with the OpenID Connect provider", () => {
  it("signs in a linked identity with the signed-in device cookie", async () => {
    await linkAt(office, localhost, cookie);

    const answer = await continueAt(office, localhost, "/board");

    expect(locationOf(answer).pathname).toBe("/board");
    const token = cookieNamed(answer, SIGN_IN_COOKIE);
    expect(token).toBeTruthy();
    const account = await sendFrom(office.port, localhost, {
      path: "/api/account",
      cookie: `${SIGN_IN_COOKIE}=${token}`,
    });
    expect(accountSchema.parse(account.body).id).toBe(me.id);
  });

  it("asks a user with an authenticator for its code, then signs in", async () => {
    await linkAt(office, localhost, cookie);
    const { secret } = await turnOnAuthenticator(office.port, cookie, NOW);

    const answer = await continueAt(office, localhost, "/board");

    expect(locationOf(answer).pathname).toBe("/sign-in/code");
    expect(cookieNamed(answer, SIGN_IN_COOKIE)).toBeUndefined();
    const pending = `${PENDING_SIGN_IN_COOKIE}=${cookieNamed(answer, PENDING_SIGN_IN_COOKIE)}`;
    office.schedule.advanceBy(30_000);
    const code = await send(office.port, {
      method: "POST",
      path: "/api/sign-in/code",
      headers: { cookie: pending },
      body: { code: authenticatorCodeOf(secret, office.schedule.now()) },
    });
    expect(code.status).toBe(200);
    expect(setCookieOf(code).cookie).toContain(SIGN_IN_COOKIE);
  });

  it("refuses an unlinked identity, even with a user's email, naming the provider", async () => {
    office.provider.signedInAs = { subject: randomUUID(), name: me.email };

    const answer = await continueAt(office, localhost);

    expect(failureOf(locationOf(answer), "/sign-in", "signInFailed")).toBe(
      "This Zitadel account isn't linked to a user of The Office. Sign in another way, then link it from your account.",
    );
    expect(cookieNamed(answer, SIGN_IN_COOKIE)).toBeUndefined();
  });

  it("works at a loopback IP, unlike Google", async () => {
    await linkAt(office, localhost, cookie);

    const answer = await continueAt(office, atLoopbackIp(office.port), "/board");

    expect(locationOf(answer).pathname).toBe("/board");
    expect(cookieNamed(answer, SIGN_IN_COOKIE)).toBeTruthy();
  });
});

describe("/api/account/identity-callback-urls/openid-connect", () => {
  it("answers this address's callback URL, even at an IP address, and the public address's", async () => {
    const urlsAt = async (page: PageAt) => {
      const as = await signedInAt(office.port, page, me);
      const answer = await sendFrom(office.port, page, {
        path: "/api/account/identity-callback-urls/openid-connect",
        cookie: as,
      });
      return identityCallbackUrlsSchema.parse(answer.body);
    };

    expect(await urlsAt(localhost)).toEqual({
      thisAddress: `http://localhost:${office.port}/api/sign-in/openid-connect/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/openid-connect/callback`,
    });
    expect(await urlsAt(atLoopbackIp(office.port))).toEqual({
      thisAddress: `http://127.0.0.1:${office.port}/api/sign-in/openid-connect/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/openid-connect/callback`,
    });
  });
});
