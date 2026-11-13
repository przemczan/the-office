import { createHash } from "node:crypto";
import {
  accountSchema,
  authenticatorSetupSchema,
  recoveryCodesSchema,
  signInRefusalSchema,
} from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import {
  addUser,
  authenticatorCodeOf,
  signedInCookie,
  type UserForTests,
} from "../../index.fixtures.js";
import {
  send,
  setCookieOf,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import {
  authenticators,
  pendingSignIns,
  recoveryCodes,
  signedInDevices,
} from "../postgres/users.schema.js";
import { PENDING_SIGN_IN_COOKIE, SIGN_IN_COOKIE } from "./sign-in-cookie.js";

const NOW = new Date("2026-11-13T09:00:10.000Z");
const SECOND = 1000;
const STEP = 30 * SECOND;
const MINUTE = 60 * SECOND;
const RECOVERY_CODE_SHAPE = /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/;

let office: UsersApplication;
let user: UserForTests;
let cookie: string;
let events: DomainEvent[];

beforeEach(async () => {
  office = await startUsersApplication();
  office.schedule.setTime(NOW);
  user = await addUser(office.app);
  cookie = await signedInCookie(`http://localhost:${office.port}`, user);
  events = [];
  office.app.get(EventBus).subscribeToEveryEvent((event) => void events.push(event));
});

afterEach(async () => {
  await office.app.close();
});

function database(): Database {
  return office.app.get<symbol, Database>(DATABASE);
}

/** The code the user's app shows now, or `steps` time steps from now. */
function codeOf(secret: string, steps = 0): string {
  return authenticatorCodeOf(secret, office.schedule.now(), steps);
}

async function setUp(): Promise<{ keyUri: string; secret: string }> {
  const answer = await send(office.port, {
    method: "POST",
    path: "/api/account/authenticator",
    headers: { cookie },
  });
  expect(answer.status).toBe(201);
  return authenticatorSetupSchema.parse(answer.body);
}

function confirm(code: string): Promise<Answer> {
  return send(office.port, {
    method: "POST",
    path: "/api/account/authenticator/confirm",
    headers: { cookie },
    body: { code },
  });
}

/** Sets up the authenticator and turns it on; answers its secret and the recovery codes. */
async function turnOn(): Promise<{ secret: string; codes: readonly string[] }> {
  const { secret } = await setUp();
  const confirmed = await confirm(codeOf(secret));
  expect(confirmed.status).toBe(200);
  return { secret, codes: recoveryCodesSchema.parse(confirmed.body).recoveryCodes };
}

async function account(): Promise<unknown> {
  return accountSchema.parse(
    (await send(office.port, { path: "/api/account", headers: { cookie } })).body,
  ).authenticator;
}

function passwordSignIn(password = user.password): Promise<Answer> {
  return send(office.port, {
    method: "POST",
    path: "/api/sign-in/password",
    body: { email: user.email, password },
  });
}

/** Signs in with the password, which asks for the code; answers the pending sign-in's cookie. */
async function pendingCookie(): Promise<string> {
  const answer = await passwordSignIn();
  expect(answer).toMatchObject({ status: 200, body: { outcome: "code-needed" } });
  return setCookieOf(answer, PENDING_SIGN_IN_COOKIE).cookie;
}

function codeSignIn(pending: string, body: unknown): Promise<Answer> {
  return send(office.port, {
    method: "POST",
    path: "/api/sign-in/code",
    headers: { cookie: pending },
    body,
  });
}

/** The answer as the code page reads it: its status, refusal and seconds until the next try. */
function refusalOf(answer: Answer): unknown {
  if (answer.status === 200) return { status: 200 };
  const { refusal, tryAgainAt } = signInRefusalSchema.parse(answer.body);
  return {
    status: answer.status,
    refusal,
    ...(tryAgainAt !== undefined && {
      waitSeconds: (Date.parse(tryAgainAt) - office.schedule.now().getTime()) / SECOND,
    }),
  };
}

async function devicesOfUser(): Promise<number> {
  const rows = await database()
    .select()
    .from(signedInDevices)
    .where(eq(signedInDevices.userId, user.id));
  return rows.length;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("setting up the authenticator", () => {
  it("shows the QR code's address and the secret, and turns on only after a right first code", async () => {
    const { keyUri, secret } = await setUp();

    expect(keyUri).toMatch(/^otpauth:\/\/totp\/The%20Office:/);
    const address = new URL(keyUri);
    expect(Object.fromEntries(address.searchParams)).toEqual({
      issuer: "The Office",
      algorithm: "SHA1",
      secret,
      period: "30",
      digits: "6",
    });
    expect(decodeURIComponent(address.pathname)).toContain(user.email);
    expect(await account()).toEqual({ state: "off" });

    const wrong = await confirm(codeOf(secret, 5));
    expect(wrong.status).toBe(422);
    expect(await account()).toEqual({ state: "off" });
    // Set up anew before it is on: the first secret no longer counts.
    const again = await setUp();
    expect((await confirm(codeOf(secret))).status).toBe(422);

    const confirmed = await confirm(codeOf(again.secret));
    expect(confirmed.status).toBe(200);
    expect(await account()).toEqual({ state: "on", recoveryCodesLeft: 10 });
    expect(
      (
        await send(office.port, {
          method: "POST",
          path: "/api/account/authenticator",
          headers: { cookie },
        })
      ).status,
    ).toBe(422);
  });

  it("shows 10 recovery codes once, keeping only their hashes, and never sends the secret again", async () => {
    const { secret } = await setUp();
    const confirmed = await confirm(codeOf(secret));

    expect(confirmed.headers["cache-control"]).toBe("no-store");
    const { recoveryCodes: codes } = recoveryCodesSchema.parse(confirmed.body);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(RECOVERY_CODE_SHAPE);

    const rows = await database()
      .select()
      .from(recoveryCodes)
      .where(eq(recoveryCodes.userId, user.id));
    expect(rows.map(({ codeHash }) => codeHash).toSorted()).toEqual(
      codes.map((code) => sha256(code.replace("-", ""))).toSorted(),
    );
    const kept = JSON.stringify(rows);
    for (const code of codes) {
      expect(kept).not.toContain(code);
      expect(kept).not.toContain(code.replace("-", ""));
    }

    const accountAnswer = await send(office.port, { path: "/api/account", headers: { cookie } });
    expect(JSON.stringify(accountAnswer.body)).not.toContain(secret);
    expect((await confirm(codeOf(secret, 1))).status).toBe(422);
  });
});

describe("signing in with the authenticator on", () => {
  it("answers code-needed to a right password, with a pending sign-in cookie and no device", async () => {
    await turnOn();
    const before = await devicesOfUser();

    const answer = await passwordSignIn();

    expect(answer).toMatchObject({ status: 200, body: { outcome: "code-needed" } });
    expect(answer.headers["set-cookie"]).toHaveLength(1);
    const { cookie: pending, attributes } = setCookieOf(answer, PENDING_SIGN_IN_COOKIE);
    expect(attributes).toEqual(["HttpOnly", "SameSite=Lax", "Path=/api/sign-in", "Max-Age=300"]);
    expect(await devicesOfUser()).toBe(before);
    const token = pending.split("=")[1] ?? "";
    const rows = await database()
      .select()
      .from(pendingSignIns)
      .where(eq(pendingSignIns.userId, user.id));
    expect(rows.map(({ tokenHash }) => tokenHash)).toEqual([sha256(token)]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("refuses the pending token at the guard, as either cookie", async () => {
    await turnOn();
    const pending = await pendingCookie();
    const token = pending.split("=")[1] ?? "";

    for (const asCookie of [pending, `${SIGN_IN_COOKIE}=${token}`]) {
      const answer = await send(office.port, {
        path: "/api/account",
        headers: { cookie: asCookie },
      });
      expect(answer.status).toBe(401);
    }
  });

  it("signs the device in with a right code, once, and refuses a code of a step already used", async () => {
    const { secret } = await turnOn();
    const pending = await pendingCookie();

    // The step of the confirming code is used: its code is taken no more.
    expect(refusalOf(await codeSignIn(pending, { code: codeOf(secret) }))).toEqual({
      status: 422,
      refusal: "wrong",
    });
    await office.schedule.advanceBy(STEP);
    const signedIn = await codeSignIn(pending, { code: codeOf(secret) });

    expect(signedIn).toMatchObject({ status: 200, body: { outcome: "signed-in" } });
    const device = setCookieOf(signedIn, SIGN_IN_COOKIE).cookie;
    expect(setCookieOf(signedIn, PENDING_SIGN_IN_COOKIE).attributes).toContain("Max-Age=0");
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: device } })).status,
    ).toBe(200);
    // The pending sign-in is used up.
    expect((await codeSignIn(pending, { code: codeOf(secret, 1) })).status).toBe(401);
    // A new one doesn't take the code already used in its step.
    expect((await codeSignIn(await pendingCookie(), { code: codeOf(secret) })).status).toBe(422);
  });

  it("takes a code of the step before or after now, a phone's clock being a little off", async () => {
    const { secret } = await turnOn();
    await office.schedule.advanceBy(5 * STEP);

    expect((await codeSignIn(await pendingCookie(), { code: codeOf(secret, -1) })).status).toBe(
      200,
    );
    expect((await codeSignIn(await pendingCookie(), { code: codeOf(secret, 1) })).status).toBe(200);
    expect((await codeSignIn(await pendingCookie(), { code: codeOf(secret, 3) })).status).toBe(422);
  });

  it("refuses the pending sign-in once it expired", async () => {
    const { secret } = await turnOn();
    const pending = await pendingCookie();

    await office.schedule.advanceBy(5 * MINUTE);

    const answer = await codeSignIn(pending, { code: codeOf(secret) });
    expect(answer.status).toBe(401);
    expect(answer.body).toMatchObject({ message: "This sign-in has ended: sign in again." });
  });

  it("refuses a code without a pending sign-in", async () => {
    expect((await codeSignIn("", { code: "123456" })).status).toBe(401);
  });

  it("signs the device in with a recovery code, however typed, and takes each once", async () => {
    const { codes } = await turnOn();
    const [first = ""] = codes;

    const typed = ` ${first.toLowerCase().replace("-", " ")} `;
    expect((await codeSignIn(await pendingCookie(), { recoveryCode: typed })).status).toBe(200);
    expect(await account()).toEqual({ state: "on", recoveryCodesLeft: 9 });
    expect(refusalOf(await codeSignIn(await pendingCookie(), { recoveryCode: first }))).toEqual({
      status: 422,
      refusal: "wrong",
    });
  });
});

describe("wrong codes", () => {
  it("slow down and lock out as wrong passwords do, a right password resetting nothing, across a restart", async () => {
    const { secret } = await turnOn();
    const pending = await pendingCookie();
    const wrongCode = (): Promise<unknown> =>
      codeSignIn(pending, { code: codeOf(secret, 10) }).then(refusalOf);

    for (let index = 0; index < 3; index += 1) {
      expect(await wrongCode()).toEqual({ status: 422, refusal: "wrong" });
    }
    expect(await wrongCode()).toEqual({ status: 422, refusal: "wrong", waitSeconds: 2 });
    expect(refusalOf(await codeSignIn(pending, { code: codeOf(secret, 1) }))).toEqual({
      status: 429,
      refusal: "slow-down",
      waitSeconds: 2,
    });

    // A right password counts nothing off: the next wrong code waits longer still.
    await office.schedule.advanceBy(2 * SECOND);
    expect((await passwordSignIn()).body).toEqual({ outcome: "code-needed" });
    expect(await wrongCode()).toEqual({ status: 422, refusal: "wrong", waitSeconds: 4 });

    const at = office.schedule.now();
    await office.app.close();
    office = await startUsersApplication();
    office.schedule.setTime(at);
    expect(refusalOf(await codeSignIn(pending, { code: codeOf(secret, 1) }))).toEqual({
      status: 429,
      refusal: "slow-down",
      waitSeconds: 4,
    });

    for (const waitSeconds of [8, 16, 16, 16]) {
      await office.schedule.advanceBy(16 * SECOND);
      expect(await wrongCode()).toEqual({ status: 422, refusal: "wrong", waitSeconds });
    }
    await office.schedule.advanceBy(16 * SECOND);
    expect(await wrongCode()).toEqual({ status: 429, refusal: "locked", waitSeconds: 15 * 60 });
    // The password is locked along with the codes.
    expect(refusalOf(await passwordSignIn())).toEqual({
      status: 429,
      refusal: "locked",
      waitSeconds: 15 * 60,
    });
  });

  it("are counted with recovery codes too, and a right code resets the count", async () => {
    const { secret } = await turnOn();
    const pending = await pendingCookie();
    for (let index = 0; index < 3; index += 1) {
      await codeSignIn(pending, { recoveryCode: "AAAAA-AAAAA" });
    }
    expect(refusalOf(await codeSignIn(pending, { recoveryCode: "AAAAA-AAAAA" }))).toEqual({
      status: 422,
      refusal: "wrong",
      waitSeconds: 2,
    });

    await office.schedule.advanceBy(STEP);
    expect((await codeSignIn(pending, { code: codeOf(secret) })).status).toBe(200);
    expect(refusalOf(await passwordSignIn("not the password at all"))).toEqual({
      status: 422,
      refusal: "wrong",
    });
  });
});

describe("turning the authenticator off and new recovery codes", () => {
  it("each need a code, and new recovery codes replace all the old ones", async () => {
    const { secret, codes } = await turnOn();
    await office.schedule.advanceBy(STEP);

    const newCodes = (code: string): Promise<Answer> =>
      send(office.port, {
        method: "POST",
        path: "/api/account/recovery-codes",
        headers: { cookie },
        body: { code },
      });
    expect((await newCodes("000000")).status).toBe(422);
    const made = await newCodes(codeOf(secret));
    expect(made.status).toBe(200);
    const { recoveryCodes: fresh } = recoveryCodesSchema.parse(made.body);
    expect(fresh).toHaveLength(10);
    expect(fresh).not.toEqual(expect.arrayContaining([codes[0]]));

    const turnOff = (body: unknown): Promise<Answer> =>
      send(office.port, {
        method: "DELETE",
        path: "/api/account/authenticator",
        headers: { cookie },
        body,
      });
    expect((await turnOff({})).status).toBe(400);
    expect((await turnOff({ recoveryCode: codes[0] })).status).toBe(422);
    expect(await account()).toMatchObject({ state: "on" });
    expect((await turnOff({ recoveryCode: fresh[0] })).status).toBe(204);

    expect(await account()).toEqual({ state: "off" });
    expect(
      await database().select().from(authenticators).where(eq(authenticators.userId, user.id)),
    ).toEqual([]);
    expect(
      await database().select().from(recoveryCodes).where(eq(recoveryCodes.userId, user.id)),
    ).toEqual([]);
    // Off, a right password signs in alone again.
    expect((await passwordSignIn()).body).toEqual({ outcome: "signed-in" });
  });

  it("turns off with a current code", async () => {
    const { secret } = await turnOn();
    await office.schedule.advanceBy(STEP);

    const answer = await send(office.port, {
      method: "DELETE",
      path: "/api/account/authenticator",
      headers: { cookie },
      body: { code: codeOf(secret) },
    });

    expect(answer.status).toBe(204);
    expect(await account()).toEqual({ state: "off" });
  });
});

describe("events", () => {
  it("name the user, never a secret, code or recovery code", async () => {
    const { secret, codes } = await turnOn();
    const [first = ""] = codes;
    await office.schedule.advanceBy(STEP);
    await codeSignIn(await pendingCookie(), { code: codeOf(secret) });
    await codeSignIn(await pendingCookie(), { recoveryCode: first });
    await send(office.port, {
      method: "DELETE",
      path: "/api/account/authenticator",
      headers: { cookie },
      body: { recoveryCode: codes[1] },
    });

    expect(events.map((event) => event.constructor.name)).toEqual(
      expect.arrayContaining([
        "AuthenticatorSetUp",
        "RecoveryCodesMade",
        "RecoveryCodeUsed",
        "AuthenticatorRemoved",
        "SignedIn",
      ]),
    );
    const published = JSON.stringify(events);
    expect(published).not.toContain(secret);
    for (const code of codes) {
      expect(published).not.toContain(code);
      expect(published).not.toContain(code.replace("-", ""));
    }
  });
});
