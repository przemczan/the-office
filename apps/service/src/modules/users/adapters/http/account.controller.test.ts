import {
  EVENTS_PATH,
  accountSchema,
  signedInDeviceListSchema,
  userRefusalSchema,
} from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SIGNED_IN_CHECK_EVERY_MS,
  SIGNED_OUT,
} from "../../../../platform/websocket/event-stream.js";
import { addUser, type UserForTests } from "../../index.fixtures.js";
import {
  send,
  setCookieOf,
  startUsersApplication,
  type UsersApplication,
} from "../../users-application.fixtures.js";

let office: UsersApplication;
let user: UserForTests;

beforeEach(async () => {
  office = await startUsersApplication();
  user = await addUser(office.app);
});

afterEach(async () => {
  await office.app.close();
});

async function signInFrom(userAgent: string, as = user): Promise<string> {
  const answer = await send(office.port, {
    method: "POST",
    path: "/api/sign-in/password",
    headers: { "user-agent": userAgent },
    body: { email: as.email, password: as.password },
  });
  return setCookieOf(answer).cookie;
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

describe("signed-in devices", () => {
  it("lists the user's devices with this one marked, and signs out another", async () => {
    const laptop = await signInFrom("Firefox on the laptop");
    const phone = await signInFrom("Safari on the phone");
    const phoneSocket = await openWebSocket(phone);
    const phoneClosed = new Promise((resolve) => phoneSocket.once("close", resolve));

    const listed = await send(office.port, {
      path: "/api/account/signed-in-devices",
      headers: { cookie: laptop },
    });
    const devices = signedInDeviceListSchema.parse(listed.body);
    expect(
      devices.map(({ userAgent, thisDevice, addressKind }) => ({
        userAgent,
        thisDevice,
        addressKind,
      })),
    ).toEqual(
      expect.arrayContaining([
        { userAgent: "Firefox on the laptop", thisDevice: true, addressKind: "localhost" },
        { userAgent: "Safari on the phone", thisDevice: false, addressKind: "localhost" },
      ]),
    );
    const phoneDevice = devices.find((device) => !device.thisDevice);

    const signedOut = await send(office.port, {
      method: "DELETE",
      path: `/api/account/signed-in-devices/${phoneDevice?.id ?? ""}`,
      headers: { cookie: laptop },
    });

    expect(signedOut.status).toBe(204);
    expect(await phoneClosed).toBe(SIGNED_OUT);
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: phone } })).status,
    ).toBe(401);
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: laptop } })).status,
    ).toBe(200);
  });

  it("never signs out another user's device", async () => {
    const mine = await signInFrom("Firefox");
    const other = await addUser(office.app, { name: "Grace Hopper" });
    const theirs = await signInFrom("Chrome", other);
    const [theirDevice] = signedInDeviceListSchema.parse(
      (
        await send(office.port, {
          path: "/api/account/signed-in-devices",
          headers: { cookie: theirs },
        })
      ).body,
    );

    const refused = await send(office.port, {
      method: "DELETE",
      path: `/api/account/signed-in-devices/${theirDevice?.id ?? ""}`,
      headers: { cookie: mine },
    });

    expect(refused.status).toBe(404);
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: theirs } })).status,
    ).toBe(200);
  });

  it("closes an expired device's WebSocket at the next minute's check", async () => {
    const expiring = await signInFrom("Firefox on the laptop");
    const socket = await openWebSocket(expiring);
    const closedWith = new Promise((resolve) => socket.once("close", (code) => resolve(code)));

    office.schedule.setTime(new Date(office.schedule.now().getTime() + THIRTY_ONE_DAYS_MS));
    await office.schedule.advanceBy(SIGNED_IN_CHECK_EVERY_MS);

    expect(await closedWith).toBe(SIGNED_OUT);
  });
});

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

describe("Sign out", () => {
  it("ends this device and has the browser forget its cookie", async () => {
    const cookie = await signInFrom("Firefox");

    const signedOut = await send(office.port, {
      method: "POST",
      path: "/api/sign-out",
      headers: { cookie },
    });

    expect(signedOut.status).toBe(204);
    const cleared = setCookieOf(signedOut);
    expect(cleared.cookie).toBe("office_signed_in=");
    expect(cleared.attributes).toContain("Max-Age=0");
    expect((await send(office.port, { path: "/api/account", headers: { cookie } })).status).toBe(
      401,
    );
  });
});

describe("the account", () => {
  it("changes the name and email, refusing another user's email", async () => {
    const cookie = await signInFrom("Firefox");
    const other = await addUser(office.app, { name: "Grace Hopper" });

    const changed = await send(office.port, {
      method: "PATCH",
      path: "/api/account",
      headers: { cookie },
      body: { name: " Ada King ", email: `king-${user.email}` },
    });
    expect(accountSchema.parse(changed.body)).toMatchObject({
      name: "Ada King",
      email: `king-${user.email}`,
    });

    const taken = await send(office.port, {
      method: "PATCH",
      path: "/api/account",
      headers: { cookie },
      body: { email: other.email.toUpperCase() },
    });
    expect(taken.status).toBe(422);
    expect(userRefusalSchema.parse(taken.body).reasons).toEqual(["Another user has this email."]);
  });

  it("changes the password with the current one, signing out every other device", async () => {
    const laptop = await signInFrom("Firefox on the laptop");
    const phone = await signInFrom("Safari on the phone");
    const newPassword = "a brand new password, long enough";

    const wrong = await send(office.port, {
      method: "POST",
      path: "/api/account/password",
      headers: { cookie: laptop },
      body: { currentPassword: "not the password at all", newPassword },
    });
    expect(wrong.status).toBe(422);
    expect(userRefusalSchema.parse(wrong.body).reasons).toEqual(["The current password is wrong."]);

    const changed = await send(office.port, {
      method: "POST",
      path: "/api/account/password",
      headers: { cookie: laptop },
      body: { currentPassword: user.password, newPassword },
    });

    expect(changed.status).toBe(204);
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: phone } })).status,
    ).toBe(401);
    expect(
      (await send(office.port, { path: "/api/account", headers: { cookie: laptop } })).status,
    ).toBe(200);
    expect(
      (
        await send(office.port, {
          method: "POST",
          path: "/api/sign-in/password",
          body: { email: user.email, password: newPassword },
        })
      ).status,
    ).toBe(200);
  });

  it("keeps the user's palette and density, starting from the defaults", async () => {
    const cookie = await signInFrom("Firefox");
    const before = await send(office.port, { path: "/api/account", headers: { cookie } });
    expect(accountSchema.parse(before.body).appearance).toEqual({ palette: null, density: null });

    const chosen = await send(office.port, {
      method: "PUT",
      path: "/api/account/appearance",
      headers: { cookie },
      body: { palette: "mocha", density: "compact" },
    });
    expect(accountSchema.parse(chosen.body).appearance).toEqual({
      palette: "mocha",
      density: "compact",
    });

    const elsewhere = await signInFrom("Chrome on the desktop");
    const after = await send(office.port, { path: "/api/account", headers: { cookie: elsewhere } });
    expect(accountSchema.parse(after.body).appearance).toEqual({
      palette: "mocha",
      density: "compact",
    });
    const unknown = await send(office.port, {
      method: "PUT",
      path: "/api/account/appearance",
      headers: { cookie },
      body: { palette: "neon", density: null },
    });
    expect(unknown.status).toBe(400);
  });
});
