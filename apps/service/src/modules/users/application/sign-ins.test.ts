import { describe, expect, it, vi } from "vitest";
import type { PageAddress } from "../domain/page-address.js";
import type { SignInWay } from "../domain/sign-in-way.js";
import { userOf } from "../domain/user.js";
import type { SecondStep, SecondSteps } from "../ports/second-steps.js";
import { NoSecondSteps } from "../adapters/second-steps/no-second-steps.js";
import { SignInWays } from "./sign-in-ways.js";
import { SignIns } from "./sign-ins.js";
import type { SignedInDevices } from "./signed-in-devices.js";

const USER = userOf(
  "user-1",
  { name: "Ada", email: "ada@example.com" },
  "scrypt$…",
  new Date("2026-11-13T09:00:00.000Z"),
);
const REQUEST = { userAgent: "Firefox", addressKind: "localhost" } as const;
const PUBLIC_ADDRESS = "https://office.example.com";

function signedInDevicesSigningIn() {
  return vi.fn<SignedInDevices["signIn"]>().mockResolvedValue({
    token: "the-token",
    device: {
      id: "device-1",
      userId: USER.id,
      tokenHash: "hash",
      userAgent: "Firefox",
      addressKind: "localhost",
      signedInAt: USER.createdAt,
      lastSeenAt: USER.createdAt,
      expiresAt: USER.createdAt,
    },
  });
}

describe("SignIns.finish", () => {
  it("asks the second steps after the way, and with none signs the user in on a new device", async () => {
    const secondSteps = new NoSecondSteps();
    const after = vi.spyOn(secondSteps, "after");
    const signIn = signedInDevicesSigningIn();
    const signIns = new SignIns(secondSteps as SecondSteps, new SignInWays(), {
      signIn,
    } as unknown as SignedInDevices);

    const outcome = await signIns.finish(USER, "password", REQUEST);

    expect(after).toHaveBeenCalledWith(USER, "password");
    expect(signIn).toHaveBeenCalledWith(USER.id, REQUEST);
    expect(outcome).toEqual({
      outcome: "signed-in",
      token: "the-token",
      signedInDeviceId: "device-1",
    });
  });

  it("signs in with a passkey alone, even when the second steps would ask for a code", async () => {
    // The authenticator's step is a later Task's, so this fake's step is any non-empty answer.
    const askingStep = { outcome: "authenticator-code" } as unknown as SecondStep;
    const after = vi.fn<SecondSteps["after"]>().mockResolvedValue(askingStep);
    const signIn = signedInDevicesSigningIn();
    const signIns = new SignIns({ after } as SecondSteps, new SignInWays(), {
      signIn,
    } as unknown as SignedInDevices);

    expect(await signIns.finish(USER, "password", REQUEST)).toBe(askingStep);
    const outcome = await signIns.finish(USER, "passkey", REQUEST);

    expect(after).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ outcome: "signed-in", signedInDeviceId: "device-1" });
  });
});

describe("SignInWays", () => {
  const pages: Readonly<Record<string, PageAddress>> = {
    localhost: {
      kind: "localhost",
      host: "localhost:4310",
      secure: false,
      publicAddress: PUBLIC_ADDRESS,
    },
    "a loopback IP": {
      kind: "loopback-ip",
      host: "127.0.0.1:4310",
      secure: false,
      publicAddress: PUBLIC_ADDRESS,
    },
    "a local network IP": {
      kind: "local-network-ip",
      host: "192.168.1.20:4310",
      secure: false,
      publicAddress: PUBLIC_ADDRESS,
    },
    "the public address over HTTPS": {
      kind: "public",
      host: "office.example.com",
      secure: true,
      publicAddress: PUBLIC_ADDRESS,
    },
    "the public address over plain HTTP": {
      kind: "public",
      host: "office.example.com",
      secure: false,
      publicAddress: PUBLIC_ADDRESS,
    },
  };

  it.each([
    ["localhost", ["password", "passkey"], []],
    [
      "a loopback IP",
      ["password"],
      [{ kind: "passkey", reason: "ip-address", elsewhere: "http://localhost:4310" }],
    ],
    [
      "a local network IP",
      ["password"],
      [{ kind: "passkey", reason: "needs-https-domain", elsewhere: PUBLIC_ADDRESS }],
    ],
    ["the public address over HTTPS", ["password", "passkey"], []],
    [
      "the public address over plain HTTP",
      ["password"],
      [{ kind: "passkey", reason: "needs-https-domain", elsewhere: PUBLIC_ADDRESS }],
    ],
  ])("offers at %s %j, and says why not the others", async (page, ways, unavailable) => {
    expect(await new SignInWays().at(pages[page] as PageAddress)).toEqual({ ways, unavailable });
  });

  it("leaves out a way that isn't set up, wherever it would work", async () => {
    const notSetUp = {
      kind: "passkey",
      enoughAlone: true,
      unavailableAt: () => undefined,
      isAvailable: () => Promise.resolve(false),
    } satisfies SignInWay;
    const ways = new SignInWays();
    ways.add(notSetUp);

    const { ways: offered } = await ways.at(pages["localhost"] as PageAddress);

    expect(offered).toEqual(["password", "passkey"]);
  });

  it("knows which ways are enough alone", () => {
    const ways = new SignInWays();

    expect([ways.isEnoughAlone("password"), ways.isEnoughAlone("passkey")]).toEqual([false, true]);
  });
});
