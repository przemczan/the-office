import { randomUUID } from "node:crypto";
import { identityCallbackUrlsSchema, linkedIdentityListSchema } from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { IdentityLinked, IdentityUnlinked } from "../../domain/user-events.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  backFromProvider,
  linkAt,
  locationOf,
  startLinking,
  startWithFakeProvider,
  stateOf,
  type OfficeWithProvider,
} from "../../linked-identities.fixtures.js";
import {
  atLoopbackIp,
  atLocalhost,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import { PUBLIC_ADDRESS } from "../../users-application.fixtures.js";
import { linkedIdentities } from "../postgres/linked-identities.schema.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");

let office: OfficeWithProvider;
let me: UserForTests;
let localhost: PageAt;
let cookie: string;
let subject: string;
let published: DomainEvent[];

beforeEach(async () => {
  office = await startWithFakeProvider();
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  cookie = await signedInAt(office.port, localhost, me);
  // Each test's own GitHub user, as the table is shared by every test of the run.
  subject = randomUUID();
  office.provider.signedInAs = { subject, name: "ada-on-github" };
  published = [];
  office.app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await office.app.close();
});

async function listed(as = cookie) {
  const answer = await sendFrom(office.port, localhost, {
    path: "/api/account/linked-identities",
    cookie: as,
  });
  expect(answer.status).toBe(200);
  return linkedIdentityListSchema.parse(answer.body);
}

function rowsOf(userId: string) {
  return office.app
    .get<Database>(DATABASE)
    .select()
    .from(linkedIdentities)
    .where(eq(linkedIdentities.userId, userId));
}

function linkFailureOf(location: URL): string | null {
  expect(location.pathname).toBe("/account/linked-identities");
  return location.searchParams.get("linkFailed");
}

describe("/api/account/linked-identities", () => {
  it("links the identity the user signs in to at the provider, keeping the provider, its id and the name", async () => {
    expect(await listed()).toEqual([
      { provider: "github", available: true, unavailableHere: null, linked: null },
    ]);

    const answer = await linkAt(office, localhost, cookie);

    expect(linkFailureOf(locationOf(answer))).toBeNull();
    expect(await listed()).toEqual([
      {
        provider: "github",
        available: true,
        unavailableHere: null,
        linked: { name: "ada-on-github", linkedAt: NOW.toISOString(), lastSignedInAt: null },
      },
    ]);
    expect(await rowsOf(me.id)).toEqual([
      expect.objectContaining({ provider: "github", subject, name: "ada-on-github" }),
    ]);
    expect(published.filter((event) => event instanceof IdentityLinked)).toEqual([
      expect.objectContaining({ userId: me.id, provider: "github" }),
    ]);
  });

  it("takes linking again as the same user as the new name, and keeps one row", async () => {
    await linkAt(office, localhost, cookie);
    office.provider.signedInAs = { subject, name: "ada-renamed" };

    const again = await linkAt(office, localhost, cookie);

    expect(linkFailureOf(locationOf(again))).toBeNull();
    expect(await rowsOf(me.id)).toEqual([
      expect.objectContaining({ subject, name: "ada-renamed" }),
    ]);
  });

  it("refuses an identity linked to another user, without saying whose", async () => {
    await linkAt(office, localhost, cookie);
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const graceCookie = await signedInAt(office.port, localhost, grace);

    const answer = await linkAt(office, localhost, graceCookie);

    const why = linkFailureOf(locationOf(answer)) ?? "";
    expect(why).toContain("linked to another user");
    expect(why).not.toContain(me.name);
    expect(await rowsOf(grace.id)).toEqual([]);
    expect(await rowsOf(me.id)).toHaveLength(1);
  });

  it("refuses a second identity of the same provider", async () => {
    await linkAt(office, localhost, cookie);
    office.provider.signedInAs = { subject: randomUUID(), name: "another-account" };

    const answer = await linkAt(office, localhost, cookie);

    expect(linkFailureOf(locationOf(answer))).toContain("unlink it first");
  });

  it("links only for the signed-in device that started it", async () => {
    const otherDevice = await signedInAt(office.port, localhost, me);
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const graceCookie = await signedInAt(office.port, localhost, grace);
    const back = async (as: string | undefined) => {
      const state = stateOf(await startLinking(office.port, localhost, cookie));
      const answer = await backFromProvider(
        office.port,
        localhost,
        { state, code: office.provider.codeOf(state) },
        as,
      );
      return locationOf(answer).searchParams.get("linkFailed");
    };

    expect(await back(otherDevice)).toContain("wasn't started from this browser");
    expect(await back(graceCookie)).toContain("wasn't started from this browser");
    expect(await back(undefined)).toContain("wasn't started from this browser");
    expect(await rowsOf(me.id)).toEqual([]);
    expect(await rowsOf(grace.id)).toEqual([]);
    expect(office.provider.returns).toEqual([]);
  });

  it("unlinks the user's own identity, which then signs nobody in", async () => {
    await linkAt(office, localhost, cookie);

    const unlinked = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: "/api/account/linked-identities/github",
      cookie,
    });
    const again = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: "/api/account/linked-identities/github",
      cookie,
    });

    expect(unlinked.status).toBe(204);
    expect(again.status).toBe(404);
    expect(await rowsOf(me.id)).toEqual([]);
    expect(published.filter((event) => event instanceof IdentityUnlinked)).toHaveLength(1);
  });

  it("says the provider isn't set up, and refuses to start linking then", async () => {
    office.provider.available = false;

    const start = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/account/linked-identities/github",
      cookie,
    });

    expect(await listed()).toEqual([
      { provider: "github", available: false, unavailableHere: null, linked: null },
    ]);
    expect(start.status).toBe(409);
  });

  it("forgets a removed user's linked identities", async () => {
    await linkAt(office, localhost, cookie);
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const graceCookie = await signedInAt(office.port, localhost, grace);

    const removal = await sendFrom(office.port, localhost, {
      method: "DELETE",
      path: `/api/users/${me.id}`,
      cookie: graceCookie,
    });

    expect(removal.status).toBe(204);
    expect(await rowsOf(me.id)).toEqual([]);
  });
});

describe("/api/account/identity-callback-urls/github", () => {
  it("answers this address's callback URL and the public address's", async () => {
    const urlsAt = async (page: PageAt) => {
      const as = await signedInAt(office.port, page, me);
      const answer = await sendFrom(office.port, page, {
        path: "/api/account/identity-callback-urls/github",
        cookie: as,
      });
      return identityCallbackUrlsSchema.parse(answer.body);
    };

    expect(await urlsAt(atLoopbackIp(office.port))).toEqual({
      thisAddress: `http://127.0.0.1:${office.port}/api/sign-in/github/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/github/callback`,
    });
    expect(await urlsAt(atPublicAddress())).toEqual({
      thisAddress: `${PUBLIC_ADDRESS}/api/sign-in/github/callback`,
      publicAddress: `${PUBLIC_ADDRESS}/api/sign-in/github/callback`,
    });
  });
});
