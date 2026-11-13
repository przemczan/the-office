import { describe, expect, it, vi } from "vitest";
import type { SignInWay } from "../domain/sign-in-way.js";
import { userOf } from "../domain/user.js";
import type { SecondSteps } from "../ports/second-steps.js";
import { NoSecondSteps } from "../adapters/second-steps/no-second-steps.js";
import { SignInWays } from "./sign-in-ways.js";
import { SignIns } from "./sign-ins.js";
import type { SignedInDevices } from "./signed-in-devices.js";

const USER = userOf(
  "user-1",
  { name: "Ada", email: "ada@example.com", password: "" },
  "scrypt$…",
  new Date("2026-11-13T09:00:00.000Z"),
);
const REQUEST = { userAgent: "Firefox", addressKind: "localhost" } as const;

describe("SignIns.finish", () => {
  it("asks the second steps after the way, and with none signs the user in on a new device", async () => {
    const secondSteps = new NoSecondSteps();
    const after = vi.spyOn(secondSteps, "after");
    const signIn = vi.fn<SignedInDevices["signIn"]>().mockResolvedValue({
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
    const signIns = new SignIns(
      secondSteps as SecondSteps,
      { signIn } as unknown as SignedInDevices,
    );

    const outcome = await signIns.finish(USER, "password", REQUEST);

    expect(after).toHaveBeenCalledWith(USER, "password");
    expect(signIn).toHaveBeenCalledWith(USER.id, REQUEST);
    expect(outcome).toEqual({
      outcome: "signed-in",
      token: "the-token",
      signedInDeviceId: "device-1",
    });
  });
});

describe("SignInWays", () => {
  // A way of a later Task's, working only where a name and HTTPS or localhost are.
  const named = {
    kind: "password",
    worksAt: (addressKind) => addressKind === "localhost" || addressKind === "public",
    isAvailable: () => Promise.resolve(true),
  } satisfies SignInWay;
  const unavailable = { ...named, isAvailable: () => Promise.resolve(false) } satisfies SignInWay;

  it.each([
    ["localhost", 2],
    ["loopback-ip", 1],
    ["local-network-ip", 1],
    ["public", 2],
  ] as const)("lists at %s only the ways set up that work there", async (addressKind, count) => {
    const ways = new SignInWays();
    ways.add(named);
    ways.add(unavailable);

    expect(await ways.at(addressKind)).toHaveLength(count);
  });
});
