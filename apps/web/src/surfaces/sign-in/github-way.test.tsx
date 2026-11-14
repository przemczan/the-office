import type { SignInPage } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonNamed } from "../../shell/page.fixtures.tsx";
import { closeSignInPage, openSignInPage, stubService, until } from "./sign-in-page.fixtures.tsx";

const WITH_GITHUB: SignInPage = {
  firstRun: false,
  ways: [{ kind: "password" }, { kind: "github" }],
  unavailable: [],
};

function gitHubButton(page: HTMLElement): HTMLButtonElement | undefined {
  return buttonNamed(page, "Continue with GitHub");
}

afterEach(closeSignInPage);

describe("the sign-in page's Continue with GitHub", () => {
  it("is offered when the service lists it, never as Sign in with GitHub", async () => {
    stubService({ "GET /api/sign-in": () => ({ status: 200, body: WITH_GITHUB }) });

    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(gitHubButton(page)).toBeDefined());
    expect(page.textContent).not.toContain("Sign in with GitHub");
  });

  it("isn't offered when the service doesn't list it", async () => {
    stubService({
      "GET /api/sign-in": () => ({
        status: 200,
        body: { firstRun: false, ways: [{ kind: "password" }], unavailable: [] },
      }),
    });

    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(page.querySelector("form")).not.toBeNull());
    expect(gitHubButton(page)).toBeUndefined();
  });

  it("starts with where the page returns to, and shows why it can't start", async () => {
    const sent = stubService({
      "GET /api/sign-in": () => ({ status: 200, body: WITH_GITHUB }),
      "POST /api/sign-in/github": () => ({
        status: 409,
        body: { statusCode: 409, message: "Continue with GitHub isn't set up in this Office." },
      }),
    });
    const { page } = await openSignInPage("/sign-in?returnTo=%2Fwork");
    await until(() => expect(gitHubButton(page)).toBeDefined());

    act(() => gitHubButton(page)?.click());

    await until(() => expect(page.textContent).toContain("isn't set up in this Office"));
    expect(sent.find(({ request }) => request === "POST /api/sign-in/github")?.body).toEqual({
      returnTo: "/work",
    });
  });

  it("says why GitHub's trip back signed nobody in, until dismissed", async () => {
    stubService({ "GET /api/sign-in": () => ({ status: 200, body: WITH_GITHUB }) });
    const why = "This GitHub account isn't linked to a user of The Office.";

    const { page, router } = await openSignInPage(
      `/sign-in?signInFailed=${encodeURIComponent(why)}`,
    );

    await until(() => expect(page.textContent).toContain(why));
    expect(page.textContent).toContain("You weren't signed in");
    act(() => buttonNamed(page, "Dismiss")?.click());
    await until(() => expect(page.textContent).not.toContain(why));
    expect(router.state.location.search).toEqual({});
  });
});
