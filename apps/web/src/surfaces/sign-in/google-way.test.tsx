import type { SignInPage } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonNamed } from "../../shell/page.fixtures.tsx";
import { closeSignInPage, openSignInPage, stubService, until } from "./sign-in-page.fixtures.tsx";

const WITH_GOOGLE: SignInPage = {
  firstRun: false,
  ways: [{ kind: "password" }, { kind: "google" }],
  unavailable: [],
};

function googleButton(page: HTMLElement): HTMLButtonElement | undefined {
  return buttonNamed(page, "Continue with Google");
}

afterEach(closeSignInPage);

describe("the sign-in page's Continue with Google", () => {
  it("is offered when the service lists it", async () => {
    stubService({ "GET /api/sign-in": () => ({ status: 200, body: WITH_GOOGLE }) });

    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(googleButton(page)).toBeDefined());
  });

  it("isn't offered at an IP address, saying where it works instead", async () => {
    stubService({
      "GET /api/sign-in": () => ({
        status: 200,
        body: {
          firstRun: false,
          ways: [{ kind: "password" }],
          unavailable: [
            { kind: "google", reason: "ip-address", elsewhere: "http://localhost:4310" },
          ],
        },
      }),
    });

    const { page } = await openSignInPage("/sign-in");

    await until(() =>
      expect(page.textContent).toContain("Continue with Google doesn't work at an IP address."),
    );
    expect(googleButton(page)).toBeUndefined();
    expect(page.querySelector('a[href="http://localhost:4310/sign-in"]')?.textContent).toBe(
      "Open localhost:4310",
    );
  });

  it("starts with where the page returns to, and shows why it can't start", async () => {
    const sent = stubService({
      "GET /api/sign-in": () => ({ status: 200, body: WITH_GOOGLE }),
      "POST /api/sign-in/google": () => ({
        status: 409,
        body: { statusCode: 409, message: "Continue with Google isn't set up in this Office." },
      }),
    });
    const { page } = await openSignInPage("/sign-in?returnTo=%2Fwork");
    await until(() => expect(googleButton(page)).toBeDefined());

    act(() => googleButton(page)?.click());

    await until(() => expect(page.textContent).toContain("isn't set up in this Office"));
    expect(sent.find(({ request }) => request === "POST /api/sign-in/google")?.body).toEqual({
      returnTo: "/work",
    });
  });
});
