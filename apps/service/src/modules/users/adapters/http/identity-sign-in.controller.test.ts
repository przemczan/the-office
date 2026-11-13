import { randomUUID } from "node:crypto";
import { accountSchema, signInPageSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInWays } from "../../application/sign-in-ways.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  backFromProvider,
  continueAt,
  cookieNamed,
  linkAt,
  locationOf,
  startSignIn,
  startWithFakeProvider,
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
import { SecondSteps } from "../../ports/second-steps.js";
import { PUBLIC_ADDRESS, startUsersApplication } from "../../users-application.fixtures.js";
import { NoSecondSteps } from "../second-steps/no-second-steps.js";
import { IDENTITY_TRIP_COOKIE } from "./identity-trip-cookie.js";
import { SIGN_IN_COOKIE } from "./sign-in-cookie.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const MINUTE = 60 * 1000;

let office: OfficeWithProvider;
let secondSteps: NoSecondSteps;
let me: UserForTests;
let localhost: PageAt;

beforeEach(async () => {
  secondSteps = new NoSecondSteps();
  office = await startWithFakeProvider({
    overrides: [{ provide: SecondSteps, useValue: secondSteps }],
  });
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  // Each test's own GitHub user, as the table is shared by every test of the run.
  office.provider.signedInAs = { subject: randomUUID(), name: "ada-on-github" };
});

afterEach(async () => {
  await office.app.close();
});

/** Links the provider's signed-in person to `me` from their account at localhost. */
async function linkMe(): Promise<void> {
  const cookie = await signedInAt(office.port, localhost, me);
  expect(locationOf(await linkAt(office, localhost, cookie)).pathname).toBe(
    "/account/linked-identities",
  );
}

function signInFailureOf(location: URL): string | null {
  expect(location.pathname).toBe("/sign-in");
  return location.searchParams.get("signInFailed");
}

describe("the sign-in page's ways", () => {
  it("lists Continue with GitHub at localhost, a loopback IP and the public address once set up", async () => {
    for (const page of [localhost, atLoopbackIp(office.port), atPublicAddress()]) {
      const answer = await sendFrom(office.port, page, { path: "/api/sign-in" });
      expect(signInPageSchema.parse(answer.body).ways).toContainEqual({ kind: "github" });
    }
  });

  it("lists it at a local network IP too", async () => {
    const ways = await office.app.get(SignInWays).at({
      kind: "local-network-ip",
      host: "192.168.1.20:4310",
      secure: false,
      publicAddress: PUBLIC_ADDRESS,
    });

    expect(ways.ways).toContain("github");
    expect(ways.unavailable).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ kind: "github" })]),
    );
  });

  it("never lists it while the provider isn't set up, nor where no provider is bound", async () => {
    office.provider.available = false;
    const unset = await sendFrom(office.port, localhost, { path: "/api/sign-in" });
    const unbound = await startUsersApplication();
    try {
      const none = await sendFrom(unbound.port, atLocalhost(unbound.port), {
        path: "/api/sign-in",
      });

      for (const answer of [unset, none]) {
        const page = signInPageSchema.parse(answer.body);
        expect(page.ways).not.toContainEqual({ kind: "github" });
        expect(page.unavailable).toEqual([]);
      }
    } finally {
      await unbound.app.close();
    }
  });
});

describe("Continue with GitHub", () => {
  it("signs in a linked identity through SignIns.finish, with the signed-in device cookie, and returns where asked", async () => {
    await linkMe();
    const after = vi.spyOn(secondSteps, "after");

    const answer = await continueAt(office, localhost, "/board?tags=auth");

    expect(locationOf(answer).href).toBe("http://office.invalid/board?tags=auth");
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ id: me.id }), "github");
    const token = cookieNamed(answer, SIGN_IN_COOKIE);
    expect(token).toBeTruthy();
    expect(cookieNamed(answer, IDENTITY_TRIP_COOKIE)).toBe("");
    const account = await sendFrom(office.port, localhost, {
      path: "/api/account",
      cookie: `${SIGN_IN_COOKIE}=${token}`,
    });
    expect(accountSchema.parse(account.body).id).toBe(me.id);
  });

  it("refuses an identity linked to no user, even named as a user is, back on the sign-in page with why", async () => {
    office.provider.signedInAs = { subject: randomUUID(), name: me.email };

    const answer = await continueAt(office, localhost);

    expect(signInFailureOf(locationOf(answer))).toContain("isn't linked to a user of The Office");
    expect(cookieNamed(answer, SIGN_IN_COOKIE)).toBeUndefined();
  });

  it("refuses the identity of a removed user", async () => {
    await linkMe();
    const remover = await addUser(office.app, { name: "Grace" });
    const cookie = await signedInAt(office.port, localhost, remover);
    const removal = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: `/api/users/${me.id}`,
      cookie,
    });
    expect(removal.status).toBe(204);

    const answer = await continueAt(office, localhost);

    expect(signInFailureOf(locationOf(answer))).toContain("isn't linked");
  });

  it("refuses a trip back without its trip cookie, so another browser can't be signed in", async () => {
    await linkMe();
    const asked = office.provider.returns.length;
    const { authorizeUrl } = await startSignIn(office.port, localhost);
    const state = stateOf(authorizeUrl);

    const answer = await backFromProvider(office.port, localhost, {
      state,
      code: office.provider.codeOf(state),
    });

    expect(signInFailureOf(locationOf(answer))).toContain("wasn't started from this browser");
    expect(cookieNamed(answer, SIGN_IN_COOKIE)).toBeUndefined();
    expect(office.provider.returns).toHaveLength(asked);
  });

  it("refuses an unknown state, a state used once already, and one past ten minutes", async () => {
    await linkMe();
    const { authorizeUrl, tripCookie } = await startSignIn(office.port, localhost);
    const state = stateOf(authorizeUrl);
    const query = { state, code: office.provider.codeOf(state) };
    const late = await startSignIn(office.port, localhost);
    const lateState = stateOf(late.authorizeUrl);

    const unknown = await backFromProvider(
      office.port,
      localhost,
      { ...query, state: "unknown" },
      tripCookie,
    );
    const first = await backFromProvider(office.port, localhost, query, tripCookie);
    const again = await backFromProvider(office.port, localhost, query, tripCookie);
    office.schedule.setTime(new Date(NOW.getTime() + 10 * MINUTE));
    const expired = await backFromProvider(
      office.port,
      localhost,
      { state: lateState, code: office.provider.codeOf(lateState) },
      late.tripCookie,
    );

    expect(signInFailureOf(locationOf(unknown))).toContain("wasn't started from this browser");
    expect(locationOf(first).pathname).toBe("/");
    expect(signInFailureOf(locationOf(again))).toContain("wasn't started from this browser");
    expect(signInFailureOf(locationOf(expired))).toContain("ten minutes");
  });

  it("returns only to a path of The Office's own", async () => {
    await linkMe();

    for (const returnTo of [
      "//evil.example",
      "https://evil.example/",
      "/\\evil.example",
      "board",
    ]) {
      expect(locationOf(await continueAt(office, localhost, returnTo)).href).toBe(
        "http://office.invalid/",
      );
    }
  });

  it("asks the provider to send the browser back to this address, the public one from its setting", async () => {
    const loopback = await startSignIn(office.port, atLoopbackIp(office.port));
    const publicPage = await startSignIn(office.port, atPublicAddress());

    expect(new URL(loopback.authorizeUrl).searchParams.get("redirect_uri")).toBe(
      `http://127.0.0.1:${office.port}/api/sign-in/github/callback`,
    );
    expect(new URL(publicPage.authorizeUrl).searchParams.get("redirect_uri")).toBe(
      `${PUBLIC_ADDRESS}/api/sign-in/github/callback`,
    );
  });

  it("sets the trip cookie HttpOnly, SameSite=Lax, on the sign-in routes, for ten minutes, Secure over HTTPS", async () => {
    const answer = await sendFrom(office.port, atPublicAddress(), {
      method: "POST",
      path: "/api/sign-in/github",
      body: {},
    });

    const [cookie] = answer.headers["set-cookie"] ?? [];
    expect(cookie?.split("; ").slice(1)).toEqual([
      "HttpOnly",
      "SameSite=Lax",
      "Path=/api/sign-in",
      "Max-Age=600",
      "Secure",
    ]);
  });

  it("answers why when the provider isn't set up", async () => {
    office.provider.available = false;

    const answer = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/sign-in/github",
      body: {},
    });

    expect(answer.status).toBe(409);
    expect(answer.body).toEqual(
      expect.objectContaining({ message: expect.stringContaining("isn't set up") }),
    );
  });

  it("lands on the sign-in page with the provider's refusal, such as a cancel", async () => {
    const { authorizeUrl, tripCookie } = await startSignIn(office.port, localhost);

    const answer = await backFromProvider(
      office.port,
      localhost,
      { state: stateOf(authorizeUrl), error: "access_denied" },
      tripCookie,
    );

    expect(signInFailureOf(locationOf(answer))).toContain("access_denied");
  });
});
