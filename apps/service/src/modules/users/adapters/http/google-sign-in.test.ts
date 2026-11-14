import { randomUUID } from "node:crypto";
import { accountSchema } from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  backFromProvider,
  continueAt,
  cookieNamed,
  linkAt,
  locationOf,
  startLinking,
  startSignIn,
  startWithFakeGoogle,
  stateOf,
  type OfficeWithProvider,
} from "../../linked-identities.fixtures.js";
import {
  atLocalhost,
  atLoopbackIp,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import { SecondSteps, type SecondStep } from "../../ports/second-steps.js";
import { PUBLIC_ADDRESS } from "../../users-application.fixtures.js";
import { linkedIdentities } from "../postgres/linked-identities.schema.js";
import { IDENTITY_TRIP_COOKIE } from "./identity-trip-cookie.js";
import { SIGN_IN_COOKIE } from "./sign-in-cookie.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");

/** Asks for no second step unless a test says otherwise. */
class StubbedSecondSteps extends SecondSteps {
  after(): Promise<SecondStep | undefined> {
    return Promise.resolve(undefined);
  }
}

let office: OfficeWithProvider;
let secondSteps: StubbedSecondSteps;
let me: UserForTests;
let localhost: PageAt;
let cookie: string;
let subject: string;

beforeEach(async () => {
  secondSteps = new StubbedSecondSteps();
  office = await startWithFakeGoogle({
    overrides: [{ provide: SecondSteps, useValue: secondSteps }],
  });
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  cookie = await signedInAt(office.port, localhost, me);
  // Each test's own Google account, as the table is shared by every test of the run.
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

describe("linking a Google identity", () => {
  it("links the Google account from the account, keeping google, its sub and the email for display, and unlinks it", async () => {
    const answer = await linkAt(office, localhost, cookie);

    expect(failureOf(locationOf(answer), "/account/linked-identities", "linkFailed")).toBeNull();
    expect(await rowsOf(me.id)).toEqual([
      expect.objectContaining({ provider: "google", subject, name: "ada@example.com" }),
    ]);

    const unlinked = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: "/api/account/linked-identities/google",
      cookie,
    });

    expect(unlinked.status).toBe(204);
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it("refuses a Google account linked to another user", async () => {
    await linkAt(office, localhost, cookie);
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const graceCookie = await signedInAt(office.port, localhost, grace);

    const answer = await linkAt(office, localhost, graceCookie);

    expect(failureOf(locationOf(answer), "/account/linked-identities", "linkFailed")).toContain(
      "This Google account is linked to another user",
    );
    expect(await rowsOf(grace.id)).toEqual([]);
  });

  it("refuses to start linking at an IP address, with where it works", async () => {
    const loopback = atLoopbackIp(office.port);
    const atIp = await signedInAt(office.port, loopback, me);

    const answer = await sendFrom(office.port, loopback, {
      method: "POST",
      path: "/api/account/linked-identities/google",
      cookie: atIp,
    });

    expect(answer.status).toBe(409);
    expect(answer.body).toEqual(
      expect.objectContaining({
        message: `Continue with Google doesn't work at this address: open The Office at http://localhost:${office.port}.`,
      }),
    );
  });

  it("links only for the signed-in device that started it", async () => {
    const otherDevice = await signedInAt(office.port, localhost, me);
    const state = stateOf(await startLinking(office.port, localhost, cookie, "google"));

    const answer = await backFromProvider(
      office.port,
      localhost,
      { state, code: office.provider.codeOf(state) },
      otherDevice,
      "google",
    );

    expect(failureOf(locationOf(answer), "/account/linked-identities", "linkFailed")).toContain(
      "wasn't started from this browser",
    );
    expect(await rowsOf(me.id)).toEqual([]);
  });
});

describe("Continue with Google", () => {
  it("signs in a linked Google identity through SignIns.finish, with the signed-in device cookie", async () => {
    await linkAt(office, localhost, cookie);
    const after = vi.spyOn(secondSteps, "after");

    const answer = await continueAt(office, localhost, "/board");

    expect(locationOf(answer).pathname).toBe("/board");
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ id: me.id }));
    const token = cookieNamed(answer, SIGN_IN_COOKIE);
    expect(token).toBeTruthy();
    const account = await sendFrom(office.port, localhost, {
      path: "/api/account",
      cookie: `${SIGN_IN_COOKIE}=${token}`,
    });
    expect(accountSchema.parse(account.body).id).toBe(me.id);
  });

  it("refuses an unlinked Google account, even with a user's email, back on the sign-in page with why", async () => {
    office.provider.signedInAs = { subject: randomUUID(), name: me.email };

    const answer = await continueAt(office, localhost);

    expect(failureOf(locationOf(answer), "/sign-in", "signInFailed")).toBe(
      "This Google account isn't linked to a user of The Office. Sign in another way, then link it from your account.",
    );
    expect(cookieNamed(answer, SIGN_IN_COOKIE)).toBeUndefined();
  });

  it("refuses a trip back without its trip cookie, an unknown state and a state used already", async () => {
    await linkAt(office, localhost, cookie);
    const { authorizeUrl, tripCookie } = await startSignIn(office.port, localhost, "/", "google");
    const state = stateOf(authorizeUrl);
    const query = { state, code: office.provider.codeOf(state) };
    const back = (sent: Record<string, string>, as?: string) =>
      backFromProvider(office.port, localhost, sent, as, "google");

    const withoutCookie = await back(query);
    const again = await startSignIn(office.port, localhost, "/", "google");
    const againState = stateOf(again.authorizeUrl);
    const againQuery = { state: againState, code: office.provider.codeOf(againState) };
    const unknown = await back({ ...againQuery, state: "unknown" }, again.tripCookie);
    const first = await back(againQuery, again.tripCookie);
    const reused = await back(againQuery, again.tripCookie);

    for (const refused of [withoutCookie, unknown, reused]) {
      expect(failureOf(locationOf(refused), "/sign-in", "signInFailed")).toContain(
        "wasn't started from this browser",
      );
      expect(cookieNamed(refused, SIGN_IN_COOKIE)).toBeUndefined();
    }
    expect(locationOf(first).pathname).toBe("/");
    expect(tripCookie).toContain(IDENTITY_TRIP_COOKIE);
  });

  it("returns only to a path of The Office's own", async () => {
    await linkAt(office, localhost, cookie);

    for (const returnTo of ["//evil.example", "https://evil.example/"]) {
      expect(locationOf(await continueAt(office, localhost, returnTo)).href).toBe(
        "http://office.invalid/",
      );
    }
  });

  it("refuses to start at an IP address, with where it works", async () => {
    const answer = await sendFrom(office.port, atLoopbackIp(office.port), {
      method: "POST",
      path: "/api/sign-in/google",
      body: {},
    });

    expect(answer.status).toBe(409);
    expect(answer.body).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(`open The Office at http://localhost:${office.port}`),
      }),
    );
  });

  it("asks Google to send the browser back to localhost's origin, and to the public address from its setting", async () => {
    const atLocalhostPage = await startSignIn(office.port, localhost, "/", "google");
    const atPublic = await startSignIn(office.port, atPublicAddress(), "/", "google");

    expect(new URL(atLocalhostPage.authorizeUrl).searchParams.get("redirect_uri")).toBe(
      `http://localhost:${office.port}/api/sign-in/google/callback`,
    );
    expect(new URL(atPublic.authorizeUrl).searchParams.get("redirect_uri")).toBe(
      `${PUBLIC_ADDRESS}/api/sign-in/google/callback`,
    );
  });
});
