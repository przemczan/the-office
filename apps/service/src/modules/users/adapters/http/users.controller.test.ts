import {
  EVENTS_PATH,
  addedUserSchema,
  signInPageSchema,
  signInRefusalSchema,
  signedInDeviceListSchema,
  userListSchema,
  userRefusalSchema,
  type AddedUser,
  type User,
} from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { WebSocket as WsClient } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { SIGNED_OUT } from "../../../../platform/websocket/event-stream.js";
import { SignedInDevices } from "../../application/signed-in-devices.js";
import { Users } from "../../application/users.js";
import { UserIdNotFound } from "../../domain/user-refused.js";
import { A_PASSWORD, addUser, type UserForTests } from "../../index.fixtures.js";
import {
  send,
  setCookieOf,
  startUsersApplication,
  type Answer,
  type UsersApplication,
} from "../../users-application.fixtures.js";
import { signedInDevices, users } from "../postgres/users.schema.js";

const NOW = new Date("2026-11-13T09:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;
const OWN_PASSWORD = "a password of my very own";

let office: UsersApplication;
let me: UserForTests;
let myCookie: string;

beforeEach(async () => {
  office = await startUsersApplication();
  office.schedule.setTime(NOW);
  me = await addUser(office.app);
  myCookie = await signIn(me.email, me.password).then((answer) => setCookieOf(answer).cookie);
});

afterEach(async () => {
  await office.app.close();
});

function signIn(email: string, password: string, on = office): Promise<Answer> {
  return send(on.port, {
    method: "POST",
    path: "/api/sign-in/password",
    body: { email, password },
  });
}

function setPassword(
  email: string,
  oneTimePassword: string,
  password = OWN_PASSWORD,
  on = office,
): Promise<Answer> {
  return send(on.port, {
    method: "POST",
    path: "/api/sign-in/set-password",
    body: { email, oneTimePassword, password },
  });
}

async function addThroughSettings(
  name: string,
  cookie = myCookie,
  on = office,
): Promise<AddedUser> {
  const email = `${name.toLowerCase().replace(/\W/g, "-")}-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const answer = await send(on.port, {
    method: "POST",
    path: "/api/users",
    headers: { cookie },
    body: { name, email },
  });
  expect(answer.status).toBe(201);
  return addedUserSchema.parse(answer.body);
}

async function listed(cookie = myCookie, on = office): Promise<User[]> {
  const answer = await send(on.port, { path: "/api/users", headers: { cookie } });
  expect(answer.status).toBe(200);
  return userListSchema.parse(answer.body);
}

function remove(userId: string, cookie = myCookie, on = office): Promise<Answer> {
  return send(on.port, { method: "DELETE", path: `/api/users/${userId}`, headers: { cookie } });
}

function openWebSocket(cookie: string): Promise<WsClient> {
  const client = new WsClient(`ws://localhost:${office.port}${EVENTS_PATH}`, {
    headers: { cookie },
  });
  return new Promise((resolve, reject) => {
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

function rowOf(userId: string): Promise<typeof users.$inferSelect | undefined> {
  return office.app
    .get<Database>(DATABASE)
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .then(([row]) => row);
}

describe("Settings › Users", () => {
  it("lists the users with you marked, and shows a new user's one-time password once", async () => {
    const added = await addThroughSettings("Grace Hopper");

    expect(added.oneTimePassword).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/);
    expect(added.user).toMatchObject({ name: "Grace Hopper", you: false });
    expect(added.user.oneTimePasswordExpiresAt).toBe(
      new Date(NOW.getTime() + 7 * DAY).toISOString(),
    );
    const list = await listed();
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: me.id, you: true, oneTimePasswordExpiresAt: null }),
        expect.objectContaining({ id: added.user.id, you: false }),
      ]),
    );
    expect(JSON.stringify(list)).not.toContain(added.oneTimePassword);
  });

  it("keeps the one-time password only as a scrypt hash", async () => {
    const added = await addThroughSettings("Grace Hopper");

    const row = await rowOf(added.user.id);
    expect(row?.passwordHash).toMatch(/^scrypt\$/);
    expect(row?.passwordHash).not.toContain(added.oneTimePassword.replaceAll("-", ""));
    expect(JSON.stringify(row)).not.toContain(added.oneTimePassword);
  });

  it("refuses an email a user not removed has, ignoring case, and every problem at once", async () => {
    const taken = await send(office.port, {
      method: "POST",
      path: "/api/users",
      headers: { cookie: myCookie },
      body: { name: "Another Ada", email: me.email.toUpperCase() },
    });
    expect(taken.status).toBe(422);
    expect(userRefusalSchema.parse(taken.body).reasons).toEqual(["Another user has this email."]);

    const unfit = await send(office.port, {
      method: "POST",
      path: "/api/users",
      headers: { cookie: myCookie },
      body: { name: " ", email: "grace" },
    });
    expect(userRefusalSchema.parse(unfit.body).reasons).toEqual([
      "Give a name.",
      "Give an email such as ada@example.com.",
    ]);
  });
});

describe("the first sign-in of a user added by another", () => {
  it("answers set-password without a signed-in device, then signs in with their own password", async () => {
    const { user, oneTimePassword } = await addThroughSettings("Grace Hopper");

    const first = await signIn(user.email, oneTimePassword);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ outcome: "set-password" });
    expect(first.headers["set-cookie"]).toBeUndefined();

    const tooShort = await setPassword(user.email, oneTimePassword, "short");
    expect(userRefusalSchema.parse(tooShort.body).reasons).toEqual([
      "A password has at least 12 characters.",
    ]);
    // Typed without the dashes and in small letters, it works the same.
    const set = await setPassword(user.email, oneTimePassword.replaceAll("-", "").toLowerCase());
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ outcome: "signed-in" });
    const { cookie } = setCookieOf(set);
    const devices = signedInDeviceListSchema.parse(
      (await send(office.port, { path: "/api/account/signed-in-devices", headers: { cookie } }))
        .body,
    );
    expect(devices).toHaveLength(1);

    expect((await signIn(user.email, oneTimePassword)).status).toBe(422);
    expect((await setPassword(user.email, oneTimePassword, "yet another password")).status).toBe(
      422,
    );
    expect((await signIn(user.email, OWN_PASSWORD)).body).toEqual({ outcome: "signed-in" });
    expect(await listed()).toContainEqual(
      expect.objectContaining({ id: user.id, oneTimePasswordExpiresAt: null }),
    );
  });

  it("refuses a one-time password after 7 days, and a new one ends the old", async () => {
    const { user, oneTimePassword } = await addThroughSettings("Grace Hopper");

    await office.schedule.advanceBy(7 * DAY);
    const expired = await signIn(user.email, oneTimePassword);
    expect(expired.status).toBe(422);
    expect(signInRefusalSchema.parse(expired.body).refusal).toBe("expired");

    const renewed = await send(office.port, {
      method: "POST",
      path: `/api/users/${user.id}/one-time-password`,
      headers: { cookie: myCookie },
    });
    expect(renewed.status).toBe(200);
    const { oneTimePassword: newOne } = renewed.body as { oneTimePassword: string };
    expect(
      signInRefusalSchema.parse((await signIn(user.email, oneTimePassword)).body).refusal,
    ).toBe("wrong");
    expect((await signIn(user.email, newOne)).body).toEqual({ outcome: "set-password" });

    await setPassword(user.email, newOne);
    const again = await send(office.port, {
      method: "POST",
      path: `/api/users/${user.id}/one-time-password`,
      headers: { cookie: myCookie },
    });
    expect(again.status).toBe(422);
  });

  it("slows down and locks out wrong one-time passwords as it does wrong passwords", async () => {
    const { user, oneTimePassword } = await addThroughSettings("Grace Hopper");
    const wrongTry = async (): Promise<unknown> => {
      const answer = await setPassword(user.email, "WRONG-WRONG-WRONG-WRNG");
      const { refusal, tryAgainAt } = signInRefusalSchema.parse(answer.body);
      return {
        status: answer.status,
        refusal,
        ...(tryAgainAt !== undefined && {
          waitSeconds: (Date.parse(tryAgainAt) - office.schedule.now().getTime()) / SECOND,
        }),
      };
    };

    for (let index = 0; index < 3; index += 1) {
      expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong" });
    }
    expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong", waitSeconds: 2 });
    expect((await setPassword(user.email, oneTimePassword)).status).toBe(429);
    for (const waitSeconds of [4, 8, 16, 16, 16]) {
      await office.schedule.advanceBy(16 * SECOND);
      expect(await wrongTry()).toEqual({ status: 422, refusal: "wrong", waitSeconds });
    }
    await office.schedule.advanceBy(16 * SECOND);
    expect(await wrongTry()).toEqual({ status: 429, refusal: "locked", waitSeconds: 15 * 60 });
    // Locked for the sign-in page's form too, the right one-time password included.
    expect(
      signInRefusalSchema.parse((await signIn(user.email, oneTimePassword)).body).refusal,
    ).toBe("locked");

    await office.schedule.advanceBy(15 * MINUTE);
    expect((await setPassword(user.email, oneTimePassword)).body).toEqual({ outcome: "signed-in" });
  });
});

describe("removing a user", () => {
  it("signs out all their devices, keeps their name, refuses their sign-in and frees their email", async () => {
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const laptop = setCookieOf(await signIn(grace.email, grace.password)).cookie;
    const phone = setCookieOf(await signIn(grace.email, grace.password)).cookie;
    const socket = await openWebSocket(laptop);
    const closedWith = new Promise((resolve) => socket.once("close", (code) => resolve(code)));

    const removed = await remove(grace.id);

    expect(removed.status).toBe(204);
    expect(await closedWith).toBe(SIGNED_OUT);
    for (const cookie of [laptop, phone]) {
      expect((await send(office.port, { path: "/api/account", headers: { cookie } })).status).toBe(
        401,
      );
    }
    expect((await listed()).map(({ id }) => id)).not.toContain(grace.id);
    // The same answer as an unknown email.
    const refused = await signIn(grace.email, grace.password);
    expect(refused.status).toBe(422);
    expect(signInRefusalSchema.parse(refused.body).message).toBe("The email or password is wrong.");
    expect((await office.app.get(Users).namesOf([grace.id, me.id])).get(grace.id)).toBe(
      "Grace Hopper",
    );
    const row = await rowOf(grace.id);
    expect(row).toMatchObject({ name: "Grace Hopper", passwordHash: null });
    expect(row?.removedAt).not.toBeNull();

    const again = await send(office.port, {
      method: "POST",
      path: "/api/users",
      headers: { cookie: myCookie },
      body: { name: "Grace Hopper", email: grace.email },
    });
    expect(again.status).toBe(201);
    expect((await remove(grace.id)).status).toBe(404);
  });

  it("forgets their devices with the removal, and refuses a sign-in that found them before it", async () => {
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    await signIn(grace.email, grace.password);

    expect((await remove(grace.id)).status).toBe(204);

    const database = office.app.get<Database>(DATABASE);
    const devicesOf = (): Promise<unknown[]> =>
      database.select().from(signedInDevices).where(eq(signedInDevices.userId, grace.id));
    expect(await devicesOf()).toEqual([]);
    // A sign-in that checked her password before the removal saves its device only after it.
    await expect(
      office.app
        .get(SignedInDevices)
        .signIn(grace.id, { userAgent: undefined, addressKind: "localhost" }),
    ).rejects.toBeInstanceOf(UserIdNotFound);
    expect(await devicesOf()).toEqual([]);
  });

  it("signs nothing in with a device left of a removed user", async () => {
    const grace = await addUser(office.app, { name: "Grace Hopper" });
    const laptop = setCookieOf(await signIn(grace.email, grace.password)).cookie;
    const account = (): Promise<number> =>
      send(office.port, { path: "/api/account", headers: { cookie: laptop } }).then(
        ({ status }) => status,
      );
    expect(await account()).toBe(200);

    // Removed with her device left, as no removal through The Office leaves it.
    await office.app
      .get<Database>(DATABASE)
      .update(users)
      .set({ removedAt: NOW })
      .where(eq(users.id, grace.id));

    expect(await account()).toBe(401);
  });

  it("refuses removing yourself", async () => {
    const refused = await remove(me.id);

    expect(refused.status).toBe(422);
    expect(userRefusalSchema.parse(refused.body).reasons).toEqual(["You can't remove yourself."]);
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: myCookie } })).status,
    ).toBe(200);
  });
});

describe("in an Office of its own", () => {
  let database: FreshTestDatabase;
  let own: UsersApplication;

  beforeAll(async () => {
    database = await freshTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  beforeEach(async () => {
    own = await startUsersApplication({ databaseUrl: database.url });
  });

  afterEach(async () => {
    await own.app.close();
  });

  it("two users removing each other at once leave one, and the first-user form never opens again", async () => {
    const ada = await addUser(own.app, { name: "Ada Lovelace", password: A_PASSWORD });
    const grace = await addUser(own.app, { name: "Grace Hopper", password: A_PASSWORD });
    const adasCookie = setCookieOf(await signIn(ada.email, ada.password, own)).cookie;
    const gracesCookie = setCookieOf(await signIn(grace.email, grace.password, own)).cookie;

    const answers = await Promise.all([
      remove(grace.id, adasCookie, own),
      remove(ada.id, gracesCookie, own),
    ]);

    // The other is refused: as signed out when the first was done before it was let in, else
    // as removed meanwhile.
    const [done, refused] = answers.toSorted((one, other) => one.status - other.status);
    expect(done?.status).toBe(204);
    expect([401, 422]).toContain(refused?.status);
    const left = await own.app.get(Users).list();
    expect(left).toHaveLength(1);

    const [survivor] = left;
    const survivorsCookie = survivor?.id === ada.id ? adasCookie : gracesCookie;
    const removedId = survivor?.id === ada.id ? grace.id : ada.id;
    expect(
      (await send(own.port, { path: "/api/account", headers: { cookie: survivorsCookie } })).status,
    ).toBe(200);
    expect((await own.app.get(Users).namesOf([removedId])).size).toBe(1);
    const page = signInPageSchema.parse((await send(own.port, { path: "/api/sign-in" })).body);
    expect(page.firstRun).toBe(false);
  });
});
