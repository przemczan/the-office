import type { SignInPage } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonNamed } from "../../shell/page.fixtures.tsx";
import { closeSignInPage, openSignInPage, stubService, until } from "./sign-in-page.fixtures.tsx";

const WITH_ZITADEL: SignInPage = {
  firstRun: false,
  ways: [{ kind: "password" }, { kind: "openid-connect", name: "Zitadel" }],
  unavailable: [],
};

afterEach(closeSignInPage);

describe("the sign-in page's Continue with the OpenID Connect provider", () => {
  it("is offered under the provider's name", async () => {
    stubService({ "GET /api/sign-in": () => ({ status: 200, body: WITH_ZITADEL }) });

    const { page } = await openSignInPage("/sign-in");

    await until(() => expect(buttonNamed(page, "Continue with Zitadel")).toBeDefined());
  });

  it("starts with where the page returns to, and shows why it can't start", async () => {
    const sent = stubService({
      "GET /api/sign-in": () => ({ status: 200, body: WITH_ZITADEL }),
      "POST /api/sign-in/openid-connect": () => ({
        status: 409,
        body: { statusCode: 409, message: "Continue with Zitadel isn't set up in this Office." },
      }),
    });
    const { page } = await openSignInPage("/sign-in?returnTo=%2Fwork");
    await until(() => expect(buttonNamed(page, "Continue with Zitadel")).toBeDefined());

    act(() => buttonNamed(page, "Continue with Zitadel")?.click());

    await until(() => expect(page.textContent).toContain("isn't set up in this Office"));
    expect(
      sent.find(({ request }) => request === "POST /api/sign-in/openid-connect")?.body,
    ).toEqual({ returnTo: "/work" });
  });
});
