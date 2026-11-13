import type { LinkedIdentityList } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../shell/page.fixtures.tsx";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { LinkedIdentitiesSection } from "./linked-identities-section.tsx";

const LINKED: LinkedIdentityList = [
  {
    provider: "github",
    available: true,
    linked: {
      name: "ada-on-github",
      linkedAt: "2026-11-10T09:00:00.000Z",
      lastSignedInAt: null,
    },
  },
];
const NOT_LINKED: LinkedIdentityList = [{ provider: "github", available: true, linked: null }];

const pages = {
  "account/linked-identities": (): ReactNode => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <LinkedIdentitiesSection />
    </PageHeadingProvider>
  ),
};

afterEach(closePage);

describe("Account › Linked identities", () => {
  it("shows the linked GitHub login and unlinks it after asking", async () => {
    let current = LINKED;
    const sent = stubService({
      "GET /api/account/linked-identities": () => ({ status: 200, body: current }),
      "DELETE /api/account/linked-identities/github": () => {
        current = NOT_LINKED;
        return { status: 204 };
      },
    });
    const { page } = await openPage("/account/linked-identities", pages);
    await until(() => expect(page.textContent).toContain("ada-on-github"));
    expect(page.textContent).toContain("never signed in with");

    act(() => buttonNamed(page, "Unlink GitHub")?.click());
    expect(document.body.textContent).toContain("no longer signs you in as ada-on-github");
    act(() => buttonNamed(document.body, "Unlink the account")?.click());

    await until(() => expect(buttonNamed(page, "Link GitHub")).toBeDefined());
    expect(sent.map(({ request }) => request)).toContain(
      "DELETE /api/account/linked-identities/github",
    );
  });

  it("offers Link, disabled with the reason while the GitHub App isn't registered", async () => {
    stubService({
      "GET /api/account/linked-identities": () => ({
        status: 200,
        body: [{ provider: "github", available: false, linked: null }],
      }),
    });

    const { page } = await openPage("/account/linked-identities", pages);

    await until(() => expect(buttonNamed(page, "Link GitHub")).toBeDefined());
    expect(buttonNamed(page, "Link GitHub")?.disabled).toBe(true);
    expect(page.textContent).toContain("Register the GitHub App in Settings › Office identity");
  });

  it("starts linking at GitHub, and says why when it can't start", async () => {
    const sent = stubService({
      "GET /api/account/linked-identities": () => ({ status: 200, body: NOT_LINKED }),
      "POST /api/account/linked-identities/github": () => ({
        status: 409,
        body: { statusCode: 409, message: "Continue with GitHub isn't set up in this Office." },
      }),
    });
    const { page } = await openPage("/account/linked-identities", pages);
    await until(() => expect(buttonNamed(page, "Link GitHub")).toBeDefined());

    act(() => buttonNamed(page, "Link GitHub")?.click());

    await until(() => expect(page.textContent).toContain("isn't set up in this Office"));
    expect(sent.map(({ request }) => request)).toContain(
      "POST /api/account/linked-identities/github",
    );
  });

  it("says why linking failed, as GitHub's trip back said", async () => {
    stubService({
      "GET /api/account/linked-identities": () => ({ status: 200, body: NOT_LINKED }),
    });
    const why = "This GitHub account is linked to another user of The Office.";

    const { page } = await openPage(
      `/account/linked-identities?linkFailed=${encodeURIComponent(why)}`,
      pages,
    );

    await until(() => expect(page.textContent).toContain(why));
    expect(page.textContent).toContain("The identity wasn't linked");
  });
});
