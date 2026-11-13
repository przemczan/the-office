import { describe, expect, it, vi } from "vitest";
import { PASSWORD_WAY, type SignInWay } from "../domain/sign-in-way.js";
import { userOf } from "../domain/user.js";
import { SecondSteps, type SecondStep } from "../ports/second-steps.js";
import { SignInWays } from "./sign-in-ways.js";
import { SignIns } from "./sign-ins.js";
import type { SignedInDevices } from "./signed-in-devices.js";
import type { UserWrongTries } from "./user-wrong-tries.js";

const USER = userOf(
  "user-1",
  { name: "Ada", email: "ada@example.com" },
  "scrypt$…",
  new Date("2026-11-13T09:00:00.000Z"),
);
const REQUEST = { userAgent: "Firefox", addressKind: "localhost" } as const;
const CODE_NEEDED: SecondStep = { outcome: "code-needed", pendingToken: "pending-token" };

/** Second steps asking for the code, as a user's authenticator once on does. */
class CodeAlwaysNeeded extends SecondSteps {
  after(): Promise<SecondStep | undefined> {
    return Promise.resolve(CODE_NEEDED);
  }
}

function signInsWith(secondSteps: SecondSteps) {
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
  const clear = vi.fn<UserWrongTries["clear"]>().mockResolvedValue();
  const signIns = new SignIns(
    secondSteps,
    { signIn } as unknown as SignedInDevices,
    { clear } as unknown as UserWrongTries,
  );
  return { signIns, signIn, clear };
}

// A way of a later Task's: GitHub and Google aren't enough alone, a passkey is.
const notEnoughAlone: SignInWay = { ...PASSWORD_WAY };
const enoughAlone: SignInWay = { ...PASSWORD_WAY, enoughAlone: true };

describe("SignIns.finish", () => {
  it("asks for the code after a way that isn't enough alone, signing nobody in", async () => {
    const { signIns, signIn } = signInsWith(new CodeAlwaysNeeded());

    expect(await signIns.finish(USER, notEnoughAlone, REQUEST)).toEqual(CODE_NEEDED);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs the user in after a way enough alone, such as a passkey, without asking", async () => {
    const secondSteps = new CodeAlwaysNeeded();
    const after = vi.spyOn(secondSteps, "after");
    const { signIns, signIn, clear } = signInsWith(secondSteps);

    const outcome = await signIns.finish(USER, enoughAlone, REQUEST);

    expect(after).not.toHaveBeenCalled();
    expect(signIn).toHaveBeenCalledWith(USER.id, REQUEST);
    expect(clear).toHaveBeenCalledWith(USER.id);
    expect(outcome).toEqual({
      outcome: "signed-in",
      token: "the-token",
      signedInDeviceId: "device-1",
    });
  });

  it("signs the user in when no second step is asked for", async () => {
    const noneNeeded = new (class extends SecondSteps {
      after(): Promise<SecondStep | undefined> {
        return Promise.resolve(undefined);
      }
    })();
    const { signIns, signIn } = signInsWith(noneNeeded);

    expect(await signIns.finish(USER, notEnoughAlone, REQUEST)).toMatchObject({
      outcome: "signed-in",
    });
    expect(signIn).toHaveBeenCalledWith(USER.id, REQUEST);
  });
});

describe("SignInWays", () => {
  // A way of a later Task's, working only where a name and HTTPS or localhost are.
  const named = {
    kind: "password",
    enoughAlone: true,
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
