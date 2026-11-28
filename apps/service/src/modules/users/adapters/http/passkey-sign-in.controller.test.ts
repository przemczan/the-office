import {
  accountSchema,
  passkeyListSchema,
  passkeyRequestOptionsSchema,
  signInPageSchema,
  signInRefusalSchema,
  type PasskeyAuthentication,
  type PasskeyRequestOptions,
} from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { userHandleOf } from "../../domain/passkey.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  SoftwareAuthenticator,
  addPasskey,
  atLocalhost,
  atLoopbackIp,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import {
  setCookieOf,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { passkeys } from "../postgres/passkeys.schema.js";
import {
  SIGN_IN_START_EVERY_MS,
  SIGN_IN_STARTS_AT_ONCE,
  TOO_MANY_SIGN_IN_STARTS,
} from "./sign-in-starts.js";
import { signedInDevices } from "../postgres/users.schema.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const MINUTE = 60 * 1000;

let office: UsersApplication;
let me: UserForTests;
let localhost: PageAt;

beforeEach(async () => {
  office = await startUsersApplication();
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
});

afterEach(async () => {
  await office.app.close();
});

/** A passkey of the user's, added at `page` from a device signed in with their password. */
async function passkeyOfMine(
  page: PageAt,
  authenticator = new SoftwareAuthenticator(),
): Promise<SoftwareAuthenticator> {
  const cookie = await signedInAt(office.port, page, me);
  await addPasskey(office.port, page, cookie, authenticator);
  return authenticator;
}

interface Started {
  readonly options: PasskeyRequestOptions;
  /** The ceremony cookie, as the browser sends it back. */
  readonly cookie: string;
  readonly attributes: string[];
}

async function start(page: PageAt): Promise<Started> {
  const answer = await sendFrom(office.port, page, {
    method: "POST",
    path: "/api/sign-in/passkey/options",
  });
  expect(answer.status).toBe(200);
  const { cookie, attributes } = setCookieOf(answer);
  return { options: passkeyRequestOptionsSchema.parse(answer.body), cookie, attributes };
}

function finish(
  page: PageAt,
  cookie: string,
  authentication: PasskeyAuthentication,
): Promise<Answer> {
  return sendFrom(office.port, page, {
    method: "POST",
    path: "/api/sign-in/passkey",
    cookie,
    body: authentication,
  });
}

/** The refusal a sign-in answered, or undefined when it wasn't refused. */
function refusalOf(answer: Answer): string | undefined {
  return answer.status === 422 ? signInRefusalSchema.parse(answer.body).refusal : undefined;
}

async function signInCookieOf(answer: Answer): Promise<string> {
  expect(answer.status).toBe(200);
  expect(answer.body).toEqual({ outcome: "signed-in" });
  const setCookies = answer.headers["set-cookie"] ?? [];
  const signedIn = setCookies.find((cookie) => cookie.startsWith("office_signed_in="));
  expect(setCookies.some((cookie) => /^office_passkey_ceremony=;.*Max-Age=0/.test(cookie))).toBe(
    true,
  );
  return signedIn?.split(";")[0] ?? "";
}

describe("signing in with a passkey", () => {
  it("starts with discoverable options and a strict cookie for the passkey routes only", async () => {
    const { options, attributes } = await start(localhost);

    expect(options).toMatchObject({ rpId: "localhost", userVerification: "required" });
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(attributes).toEqual(
      expect.arrayContaining([
        "HttpOnly",
        "SameSite=Strict",
        "Path=/api/sign-in/passkey",
        "Max-Age=300",
      ]),
    );
    expect(attributes).not.toContain("Secure");
    expect((await start(atPublicAddress())).attributes).toContain("Secure");
  });

  it("signs in without an email on a new signed-in device, and saves the counter and last use", async () => {
    const authenticator = await passkeyOfMine(localhost, new SoftwareAuthenticator({ counter: 7 }));
    office.schedule.setTime(new Date(NOW.getTime() + MINUTE));
    const { options, cookie } = await start(localhost);

    const cookieSignedIn = await signInCookieOf(
      await finish(localhost, cookie, authenticator.signIn(options, localhost.origin)),
    );

    const account = await sendFrom(office.port, localhost, {
      path: "/api/account",
      cookie: cookieSignedIn,
    });
    expect(accountSchema.parse(account.body).id).toBe(me.id);
    const database = office.app.get<symbol, Database>(DATABASE);
    const [stored] = await database.select().from(passkeys).where(eq(passkeys.userId, me.id));
    expect(stored).toMatchObject({ counter: 8, lastUsedAt: new Date(NOW.getTime() + MINUTE) });
    const devices = await database
      .select()
      .from(signedInDevices)
      .where(eq(signedInDevices.userId, me.id));
    // One for adding the passkey, signed in with the password, and one for the passkey.
    expect(devices).toHaveLength(2);
  });

  it("signs in at the public address over HTTPS with a passkey added there", async () => {
    const publicAddress = atPublicAddress();
    const authenticator = await passkeyOfMine(publicAddress);
    const { options, cookie } = await start(publicAddress);

    expect(options.rpId).toBe("office.example.com");
    await signInCookieOf(
      await finish(publicAddress, cookie, authenticator.signIn(options, publicAddress.origin)),
    );
  });

  it("signs in while the password is locked out, since a passkey can't be guessed", async () => {
    const authenticator = await passkeyOfMine(localhost);
    for (let tries = 0; tries < 10; tries += 1) {
      office.schedule.setTime(new Date(NOW.getTime() + tries * MINUTE));
      await sendFrom(office.port, localhost, {
        method: "POST",
        path: "/api/sign-in/password",
        body: { email: me.email, password: "a wrong password, again" },
      });
    }
    const locked = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/sign-in/password",
      body: { email: me.email, password: me.password },
    });
    expect(signInRefusalSchema.parse(locked.body).refusal).toBe("locked");

    const { options, cookie } = await start(localhost);
    await signInCookieOf(
      await finish(localhost, cookie, authenticator.signIn(options, localhost.origin)),
    );
  });
});

describe("a passkey sign-in refused", () => {
  it("takes each ceremony once, only with its own cookie, within 5 minutes", async () => {
    const authenticator = await passkeyOfMine(localhost);

    const first = await start(localhost);
    const other = await start(localhost);
    expect(
      refusalOf(
        await finish(
          localhost,
          other.cookie,
          authenticator.signIn(first.options, localhost.origin),
        ),
      ),
    ).toBe("passkey");
    expect(
      refusalOf(await finish(localhost, "", authenticator.signIn(first.options, localhost.origin))),
    ).toBe("passkey");

    const once = await start(localhost);
    const answer = authenticator.signIn(once.options, localhost.origin);
    await signInCookieOf(await finish(localhost, once.cookie, answer));
    expect(refusalOf(await finish(localhost, once.cookie, answer))).toBe("passkey");

    const late = await start(localhost);
    office.schedule.setTime(new Date(NOW.getTime() + 5 * MINUTE + 1));
    expect(
      refusalOf(
        await finish(localhost, late.cookie, authenticator.signIn(late.options, localhost.origin)),
      ),
    ).toBe("passkey");
  });

  it.each([
    ["another origin", { origin: "https://evil.example.com" }],
    ["another relying party", { rpId: "evil.example.com" }],
    ["no user verification", { userVerified: false }],
    ["a user handle that isn't its user's", { userHandle: userHandleOf("someone-else") }],
  ])("refuses an answer with %s", async (_, tampering) => {
    const authenticator = await passkeyOfMine(localhost);
    const { options, cookie } = await start(localhost);

    expect(
      refusalOf(
        await finish(localhost, cookie, authenticator.signIn(options, localhost.origin, tampering)),
      ),
    ).toBe("passkey");
  });

  it("refuses a counter that went backwards as a possible copy, and lets 0 stay 0", async () => {
    const counting = await passkeyOfMine(localhost, new SoftwareAuthenticator({ counter: 5 }));
    const synced = await passkeyOfMine(localhost);

    for (const authenticator of [synced, synced]) {
      const { options, cookie } = await start(localhost);
      await signInCookieOf(
        await finish(localhost, cookie, authenticator.signIn(options, localhost.origin)),
      );
    }
    counting.counter = 2;
    const { options, cookie } = await start(localhost);
    expect(
      refusalOf(await finish(localhost, cookie, counting.signIn(options, localhost.origin))),
    ).toBe("passkey");
  });

  it("refuses a passkey added at localhost on the public address", async () => {
    const authenticator = await passkeyOfMine(localhost);
    const publicAddress = atPublicAddress();
    const { options, cookie } = await start(publicAddress);

    expect(
      refusalOf(
        await finish(
          publicAddress,
          cookie,
          authenticator.signIn(options, publicAddress.origin, { rpId: "localhost" }),
        ),
      ),
    ).toBe("passkey");
  });

  it("refuses the passkey of a user since removed, whose passkeys went with them", async () => {
    const authenticator = await passkeyOfMine(localhost);
    const remover = await addUser(office.app, { name: "Grace Hopper" });
    const removerCookie = await signedInAt(office.port, localhost, remover);
    const removed = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: `/api/users/${me.id}`,
      cookie: removerCookie,
    });
    expect(removed.status).toBe(204);
    const database = office.app.get<symbol, Database>(DATABASE);
    expect(await database.select().from(passkeys).where(eq(passkeys.userId, me.id))).toEqual([]);

    const { options, cookie } = await start(localhost);
    expect(
      refusalOf(await finish(localhost, cookie, authenticator.signIn(options, localhost.origin))),
    ).toBe("passkey");
  });
});

/** Starts a passkey sign-in at `page`, with these headers too. */
function optionsFrom(page: PageAt, headers: Record<string, string> = {}): Promise<Answer> {
  return sendFrom(
    office.port,
    { ...page, headers: { ...page.headers, ...headers } },
    { method: "POST", path: "/api/sign-in/passkey/options" },
  );
}

describe("passkey sign-ins started", () => {
  it("are counted per address: 20 at once, then one every 3 seconds", async () => {
    const statuses: number[] = [];
    for (let started = 0; started < SIGN_IN_STARTS_AT_ONCE; started++) {
      statuses.push((await optionsFrom(localhost)).status);
    }

    expect(statuses).toEqual(Array<number>(SIGN_IN_STARTS_AT_ONCE).fill(200));
    const refused = await optionsFrom(localhost);
    expect(refused).toMatchObject({ status: 429, body: { message: TOO_MANY_SIGN_IN_STARTS } });
    await office.schedule.advanceBy(SIGN_IN_START_EVERY_MS);
    expect((await optionsFrom(localhost)).status).toBe(200);
  });

  it("at the public address, count by the address its proxy says the browser has", async () => {
    const publicAddress = atPublicAddress();
    for (let started = 0; started < SIGN_IN_STARTS_AT_ONCE; started++) {
      await optionsFrom(publicAddress, { "x-forwarded-for": "203.0.113.7" });
    }

    expect(
      (await optionsFrom(publicAddress, { "x-forwarded-for": "198.51.100.1, 203.0.113.7" })).status,
    ).toBe(429);
    expect((await optionsFrom(publicAddress, { "x-forwarded-for": "203.0.113.8" })).status).toBe(
      200,
    );
  });
});

describe("the sign-in page's passkey", () => {
  it.each([
    ["localhost", (port: number) => atLocalhost(port), true],
    ["the public address over HTTPS", () => atPublicAddress(), true],
    ["a loopback IP", (port: number) => atLoopbackIp(port), false],
    ["the public address over plain HTTP", () => atPublicAddress({ secure: false }), false],
  ])("is offered at %s: %s", async (_, pageOf, offered) => {
    const page = pageOf(office.port);
    const answer = await sendFrom(office.port, page, { path: "/api/sign-in" });
    const { ways, unavailable } = signInPageSchema.parse(answer.body);

    expect(ways.some(({ kind }) => kind === "passkey")).toBe(offered);
    expect(unavailable.some(({ kind }) => kind === "passkey")).toBe(!offered);
  });

  it("isn't started at a loopback IP, which says to use localhost", async () => {
    const page = atLoopbackIp(office.port);
    const answer = await sendFrom(office.port, page, {
      method: "POST",
      path: "/api/sign-in/passkey/options",
    });
    expect(refusalOf(answer)).toBe("passkey");

    const signInPage = signInPageSchema.parse(
      (await sendFrom(office.port, page, { path: "/api/sign-in" })).body,
    );
    expect(signInPage.unavailable).toEqual([
      { kind: "passkey", reason: "ip-address", elsewhere: `http://localhost:${office.port}` },
    ]);
  });

  it("lists the user's passkeys only to them, not at the sign-in page", async () => {
    await passkeyOfMine(localhost);
    const answer = await sendFrom(office.port, localhost, { path: "/api/account/passkeys" });

    expect(answer.status).toBe(401);
    expect(passkeyListSchema.safeParse(answer.body).success).toBe(false);
  });
});
