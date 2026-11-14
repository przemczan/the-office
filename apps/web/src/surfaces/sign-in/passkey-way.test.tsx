import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type {
  PasskeyAuthentication,
  PasskeyRequestOptions,
  SignInPage,
} from "@the-office/contracts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonNamed } from "../../shell/page.fixtures.tsx";
import { closeSignInPage, openSignInPage, stubService, until } from "./sign-in-page.fixtures.tsx";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn<() => boolean>(() => true),
  startAuthentication: vi.fn<typeof import("@simplewebauthn/browser").startAuthentication>(),
}));

const OPTIONS: PasskeyRequestOptions = {
  challenge: "a-challenge",
  rpId: "localhost",
  allowCredentials: [],
  userVerification: "required",
};
const AUTHENTICATION: PasskeyAuthentication = {
  id: "credential-1",
  rawId: "credential-1",
  type: "public-key",
  response: {
    clientDataJSON: "client-data",
    authenticatorData: "authenticator-data",
    signature: "signature",
    userHandle: "user-handle",
  },
};
const WITH_PASSKEY: SignInPage = {
  firstRun: false,
  ways: [{ kind: "password" }, { kind: "passkey" }],
  unavailable: [],
};

function passkeyButton(page: HTMLElement): HTMLButtonElement | undefined {
  return buttonNamed(page, "Sign in with a passkey");
}

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  vi.mocked(startAuthentication).mockReset();
});

afterEach(closeSignInPage);

describe("the sign-in page's passkey", () => {
  it("signs in with a passkey, no email asked, and returns where the page was asked to", async () => {
    vi.mocked(startAuthentication).mockResolvedValue(
      AUTHENTICATION as Awaited<ReturnType<typeof startAuthentication>>,
    );
    const sent = stubService({
      "GET /api/sign-in": () => ({ status: 200, body: WITH_PASSKEY }),
      "POST /api/sign-in/passkey/options": () => ({ status: 200, body: OPTIONS }),
      "POST /api/sign-in/passkey": () => ({ status: 200, body: { outcome: "signed-in" } }),
    });
    const { page, router } = await openSignInPage("/sign-in?returnTo=%2Fwork");
    await until(() => expect(passkeyButton(page)).toBeDefined());
    expect(page.querySelector('[role="separator"]')?.textContent).toBe("or");

    act(() => passkeyButton(page)?.click());

    await until(() => expect(router.state.location.pathname).toBe("/work"));
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(sent.find(({ request }) => request === "POST /api/sign-in/passkey")?.body).toEqual(
      AUTHENTICATION,
    );
  });

  it("is quiet when the browser's window is closed, and shows the service's refusal", async () => {
    const closed = Object.assign(new Error("The operation was not allowed."), {
      name: "NotAllowedError",
    });
    vi.mocked(startAuthentication).mockRejectedValueOnce(closed);
    stubService({
      "GET /api/sign-in": () => ({ status: 200, body: WITH_PASSKEY }),
      "POST /api/sign-in/passkey/options": () => ({ status: 200, body: OPTIONS }),
      "POST /api/sign-in/passkey": () => ({
        status: 422,
        body: {
          statusCode: 422,
          message: "That passkey didn't sign you in: try again, or use another way.",
          refusal: "passkey",
        },
      }),
    });
    const { page } = await openSignInPage("/sign-in");
    await until(() => expect(passkeyButton(page)).toBeDefined());

    act(() => passkeyButton(page)?.click());
    await until(() => expect(page.textContent).toContain("No passkey was used."));
    expect(page.textContent).not.toContain("didn't sign you in");

    vi.mocked(startAuthentication).mockResolvedValueOnce(
      AUTHENTICATION as Awaited<ReturnType<typeof startAuthentication>>,
    );
    act(() => passkeyButton(page)?.click());
    await until(() =>
      expect(page.textContent).toContain("That passkey didn't sign you in: try again"),
    );
    expect(page.textContent).not.toContain("No passkey was used.");
  });

  it("says why passkeys don't work at a loopback IP, with a link to localhost", async () => {
    stubService({
      "GET /api/sign-in": () => ({
        status: 200,
        body: {
          firstRun: false,
          ways: [{ kind: "password" }],
          unavailable: [
            { kind: "passkey", reason: "ip-address", elsewhere: "http://localhost:4310" },
          ],
        } satisfies SignInPage,
      }),
    });
    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(page.textContent).toContain("Passkeys don't work at an IP address."));
    expect(passkeyButton(page)).toBeUndefined();
    const link = page.querySelector<HTMLAnchorElement>('a[href="http://localhost:4310/sign-in"]');
    expect(link?.textContent).toBe("Open localhost:4310");
  });

  it("says a browser without passkeys can't use one, in place of the button", async () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false);
    stubService({ "GET /api/sign-in": () => ({ status: 200, body: WITH_PASSKEY }) });
    const { page } = await openSignInPage("/sign-in");

    await until(() =>
      expect(page.textContent).toContain("This browser can't sign in with a passkey."),
    );
    expect(passkeyButton(page)).toBeUndefined();
  });
});
