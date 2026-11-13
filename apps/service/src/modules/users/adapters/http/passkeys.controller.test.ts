import {
  passkeyListSchema,
  passkeySchema,
  userRefusalSchema,
  type PasskeyList,
} from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  SoftwareAuthenticator,
  addPasskey,
  addingOptions,
  atLocalhost,
  atLoopbackIp,
  atPublicAddress,
  sendFrom,
  signedInAt,
  type PageAt,
} from "../../passkeys.fixtures.js";
import { startUsersApplication, type UsersApplication } from "../../users-application.fixtures.js";
import { passkeys } from "../postgres/passkeys.schema.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const MINUTE = 60 * 1000;

let office: UsersApplication;
let me: UserForTests;
let localhost: PageAt;
let myCookie: string;

beforeEach(async () => {
  office = await startUsersApplication();
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  localhost = atLocalhost(office.port);
  myCookie = await signedInAt(office.port, localhost, me);
});

afterEach(async () => {
  await office.app.close();
});

async function listAt(page: PageAt, cookie = myCookie): Promise<PasskeyList> {
  const answer = await sendFrom(office.port, page, { path: "/api/account/passkeys", cookie });
  expect(answer.status).toBe(200);
  return passkeyListSchema.parse(answer.body);
}

describe("adding a passkey", () => {
  it("asks for the current password, then adds the passkey with its name at localhost", async () => {
    const wrongPassword = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/account/passkeys/options",
      cookie: myCookie,
      body: { currentPassword: "not my password at all" },
    });
    expect(wrongPassword.status).toBe(422);
    expect(userRefusalSchema.parse(wrongPassword.body).reasons).toEqual([
      "The current password is wrong.",
    ]);

    const options = await addingOptions(office.port, localhost, myCookie);
    expect(options.rp).toEqual({ name: "The Office", id: "localhost" });
    expect(options.user.name).toBe(me.email);
    expect(Buffer.from(options.user.id, "base64url").toString("utf8")).toBe(me.id);
    expect(options.attestation).toBe("none");
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });

    const authenticator = new SoftwareAuthenticator();
    const added = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/account/passkeys",
      cookie: myCookie,
      body: {
        name: "  Work laptop  ",
        registration: authenticator.register(options, localhost.origin),
      },
    });

    expect(added.status).toBe(201);
    expect(passkeySchema.parse(added.body)).toEqual({
      id: expect.any(String),
      name: "Work laptop",
      rpId: "localhost",
      at: "this-address",
      createdAt: NOW.toISOString(),
      lastUsedAt: null,
    });
    expect(await listAt(localhost)).toEqual({
      passkeys: [passkeySchema.parse(added.body)],
      addingUnavailable: null,
    });
  });

  it("refuses the passkeys the user already has at this address when adding another", async () => {
    const first = new SoftwareAuthenticator();
    await addPasskey(office.port, localhost, myCookie, first);

    const options = await addingOptions(office.port, localhost, myCookie);

    expect(options.excludeCredentials?.map(({ id }) => id)).toEqual([first.credentialId]);
  });

  it("refuses a credential kept already, even for another user", async () => {
    const authenticator = new SoftwareAuthenticator();
    await addPasskey(office.port, localhost, myCookie, authenticator);
    const someoneElse = await addUser(office.app);
    const theirCookie = await signedInAt(office.port, localhost, someoneElse);
    const options = await addingOptions(office.port, localhost, theirCookie);

    const answer = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/account/passkeys",
      cookie: theirCookie,
      body: { name: "Copied", registration: authenticator.register(options, localhost.origin) },
    });

    expect(answer.status).toBe(422);
    expect(userRefusalSchema.parse(answer.body).reasons).toEqual([
      "The passkey wasn't added: start again.",
    ]);
    expect((await listAt(localhost, theirCookie)).passkeys).toEqual([]);
  });

  it("adds at the public address over HTTPS for its hostname and origin", async () => {
    const publicAddress = atPublicAddress();
    const cookie = await signedInAt(office.port, publicAddress, me);

    const passkey = await addPasskey(
      office.port,
      publicAddress,
      cookie,
      new SoftwareAuthenticator(),
    );

    expect(passkey).toMatchObject({ rpId: "office.example.com", at: "this-address" });
  });

  it.each([
    ["another origin", { origin: "https://evil.example.com" }],
    ["another relying party", { rpId: "evil.example.com" }],
    ["no user verification", { userVerified: false }],
  ])("refuses a passkey made with %s", async (_, tampering) => {
    const options = await addingOptions(office.port, localhost, myCookie);
    const registration = new SoftwareAuthenticator().register(options, localhost.origin, tampering);

    const answer = await sendFrom(office.port, localhost, {
      method: "POST",
      path: "/api/account/passkeys",
      cookie: myCookie,
      body: { name: "Laptop", registration },
    });

    expect(answer.status).toBe(422);
    expect(userRefusalSchema.parse(answer.body).reasons).toEqual([
      "The passkey wasn't added: start again.",
    ]);
    expect((await listAt(localhost)).passkeys).toEqual([]);
  });

  it("takes the ceremony once, from the signed-in device that started it, within 5 minutes", async () => {
    const otherDevice = await signedInAt(office.port, localhost, me);
    const finish = (cookie: string, registration: unknown) =>
      sendFrom(office.port, localhost, {
        method: "POST",
        path: "/api/account/passkeys",
        cookie,
        body: { name: "Laptop", registration },
      });

    const fromOtherDevice = await finish(
      otherDevice,
      new SoftwareAuthenticator().register(
        await addingOptions(office.port, localhost, myCookie),
        localhost.origin,
      ),
    );
    expect(fromOtherDevice.status).toBe(422);

    const registration = new SoftwareAuthenticator().register(
      await addingOptions(office.port, localhost, myCookie),
      localhost.origin,
    );
    expect((await finish(myCookie, registration)).status).toBe(201);
    expect((await finish(myCookie, registration)).status).toBe(422);

    const late = new SoftwareAuthenticator().register(
      await addingOptions(office.port, localhost, myCookie),
      localhost.origin,
    );
    office.schedule.setTime(new Date(NOW.getTime() + 5 * MINUTE + 1));
    expect((await finish(myCookie, late)).status).toBe(422);
    expect((await listAt(localhost)).passkeys).toHaveLength(1);
  });

  it("refuses a name that is empty or longer than 60 characters", async () => {
    const options = await addingOptions(office.port, localhost, myCookie);
    const registration = new SoftwareAuthenticator().register(options, localhost.origin);

    const answers = await Promise.all(
      [" ", "x".repeat(61)].map((name) =>
        sendFrom(office.port, localhost, {
          method: "POST",
          path: "/api/account/passkeys",
          cookie: myCookie,
          body: { name, registration },
        }),
      ),
    );

    expect(answers.map(({ body }) => userRefusalSchema.parse(body).reasons)).toEqual([
      ["Give the passkey a name."],
      ["A passkey's name has at most 60 characters."],
    ]);
  });
});

describe("where passkeys work", () => {
  it.each([
    [
      "a loopback IP",
      (port: number) => atLoopbackIp(port),
      (port: number) => ({ reason: "ip-address", elsewhere: `http://localhost:${port}` }),
    ],
    [
      "the public address over plain HTTP",
      () => atPublicAddress({ secure: false }),
      () => ({ reason: "needs-https-domain", elsewhere: "https://office.example.com" }),
    ],
  ])("says at %s why a passkey can't be added, and refuses one", async (_, pageOf, whyAt) => {
    const page = pageOf(office.port);
    const cookie = await signedInAt(office.port, page, me);

    expect((await listAt(page, cookie)).addingUnavailable).toEqual(whyAt(office.port));
    const options = await sendFrom(office.port, page, {
      method: "POST",
      path: "/api/account/passkeys/options",
      cookie,
      body: { currentPassword: me.password },
    });
    expect(options.status).toBe(422);
  });

  it("marks a passkey for the other address, and one for an address no longer The Office's", async () => {
    const minutesLater = (minutes: number) =>
      office.schedule.setTime(new Date(NOW.getTime() + minutes * MINUTE));
    const add = (page: PageAt, cookie: string, name: string) =>
      addPasskey(office.port, page, cookie, new SoftwareAuthenticator(), name);
    const publicAddress = atPublicAddress();
    const publicCookie = await signedInAt(office.port, publicAddress, me);

    const atLocal = await add(localhost, myCookie, "Here");
    minutesLater(1);
    await add(publicAddress, publicCookie, "There");
    minutesLater(2);
    await add(localhost, myCookie, "Here too");
    const database = office.app.get<symbol, Database>(DATABASE);
    await database
      .update(passkeys)
      .set({ rpId: "old.example.com" })
      .where(eq(passkeys.id, atLocal.id));

    const listed = (await listAt(localhost)).passkeys;

    expect(listed.map(({ name, at, otherAddress }) => ({ name, at, otherAddress }))).toEqual([
      { name: "Here", at: "old-address", otherAddress: undefined },
      { name: "There", at: "other-address", otherAddress: "https://office.example.com" },
      { name: "Here too", at: "this-address", otherAddress: undefined },
    ]);
  });
});

describe("renaming and removing a passkey", () => {
  it("renames and removes the user's own, and answers 404 for another user's", async () => {
    const passkey = await addPasskey(office.port, localhost, myCookie, new SoftwareAuthenticator());
    const other = await addUser(office.app, { name: "Grace Hopper" });
    const otherCookie = await signedInAt(office.port, localhost, other);
    const change = (method: "PATCH" | "DELETE", cookie: string) =>
      sendFrom(office.port, localhost, {
        method,
        path: `/api/account/passkeys/${passkey.id}`,
        cookie,
        ...(method === "PATCH" && { body: { name: "Desk" } }),
      });

    expect((await change("PATCH", otherCookie)).status).toBe(404);
    expect((await change("DELETE", otherCookie)).status).toBe(404);

    const renamed = await change("PATCH", myCookie);
    expect(renamed.status).toBe(200);
    expect(passkeySchema.parse(renamed.body).name).toBe("Desk");

    expect((await change("DELETE", myCookie)).status).toBe(204);
    expect((await listAt(localhost)).passkeys).toEqual([]);
    expect((await change("DELETE", myCookie)).status).toBe(404);
  });
});
