import { describe, expect, it, vi } from "vitest";
import type { PageAddress } from "../domain/page-address.js";
import { PASSKEY_WAY, PASSWORD_WAY, type SignInWay } from "../domain/sign-in-way.js";
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

const PUBLIC_ADDRESS = "https://office.example.com";

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

const notEnoughAlone: SignInWay = PASSWORD_WAY;
const enoughAlone: SignInWay = PASSKEY_WAY;

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
});
