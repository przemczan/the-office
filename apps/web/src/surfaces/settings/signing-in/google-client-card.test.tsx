import type { GoogleClientSetting, IdentityCallbackUrls } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  typed,
  until,
} from "../../../shell/page.fixtures.tsx";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { SigningInSection } from "./signing-in-section.tsx";

const CLIENT_ID = "1234-office.apps.googleusercontent.com";
const SECRET = "GOCSPX-the-client-secret";
const REDIRECT_URIS: IdentityCallbackUrls = {
  thisAddress: "http://localhost:4310/api/sign-in/google/callback",
  publicAddress: "https://office.example.com/api/sign-in/google/callback",
};

const pages = {
  "settings/signing-in": (): ReactNode => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <SigningInSection />
    </PageHeadingProvider>
  ),
};

afterEach(closePage);

function inputLabelled(page: HTMLElement, label: string): HTMLInputElement {
  const found = [...page.querySelectorAll("label")].find(
    (each) => each.textContent?.replace("*", "").trim() === label,
  );
  const input = found && page.ownerDocument.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input labelled ${label}.`);
  return input;
}

describe("Settings › Signing in", () => {
  it("saves a client, then shows its id and that a secret is set, never the secret", async () => {
    let current: GoogleClientSetting = { client: null };
    const sent = stubService({
      "GET /api/settings/google-client": () => ({ status: 200, body: current }),
      "PUT /api/settings/google-client": () => {
        current = { client: { clientId: CLIENT_ID, secretSet: true } };
        return { status: 200, body: current.client };
      },
      "GET /api/account/identity-callback-urls/google": () => ({
        status: 200,
        body: REDIRECT_URIS,
      }),
    });
    const { page } = await openPage("/settings/signing-in", pages);
    await until(() => expect(page.textContent).toContain("Continue with Google isn't offered"));

    typed(page, "Client ID", CLIENT_ID);
    typed(page, "Client secret", SECRET);
    act(() => buttonNamed(page, "Save")?.click());

    await until(() => expect(page.textContent).toContain("Secret set"));
    expect(sent.find(({ request }) => request === "PUT /api/settings/google-client")?.body).toEqual(
      { clientId: CLIENT_ID, clientSecret: SECRET },
    );
    expect(inputLabelled(page, "Client ID").value).toBe(CLIENT_ID);
    expect(inputLabelled(page, "Client secret").value).toBe("");
    expect(page.innerHTML).not.toContain(SECRET);
  });

  it("changes the client id keeping the saved secret, and removes the client after asking", async () => {
    let current: GoogleClientSetting = { client: { clientId: CLIENT_ID, secretSet: true } };
    const sent = stubService({
      "GET /api/settings/google-client": () => ({ status: 200, body: current }),
      "PUT /api/settings/google-client": () => ({
        status: 200,
        body: { clientId: "5678-office.apps.googleusercontent.com", secretSet: true },
      }),
      "DELETE /api/settings/google-client": () => {
        current = { client: null };
        return { status: 204 };
      },
      "GET /api/account/identity-callback-urls/google": () => ({
        status: 200,
        body: REDIRECT_URIS,
      }),
    });
    const { page } = await openPage("/settings/signing-in", pages);
    await until(() => expect(inputLabelled(page, "Client ID").value).toBe(CLIENT_ID));
    expect(inputLabelled(page, "Client secret").required).toBe(false);

    typed(page, "Client ID", "5678-office.apps.googleusercontent.com");
    act(() => buttonNamed(page, "Save")?.click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain("PUT /api/settings/google-client"),
    );
    expect(sent.find(({ request }) => request === "PUT /api/settings/google-client")?.body).toEqual(
      { clientId: "5678-office.apps.googleusercontent.com", clientSecret: "" },
    );

    act(() => buttonNamed(page, "Remove")?.click());
    expect(document.body.textContent).toContain("The Google accounts users linked stay linked");
    act(() => buttonNamed(document.body, "Remove the client")?.click());

    await until(() => expect(page.textContent).toContain("Continue with Google isn't offered"));
    expect(sent.map(({ request }) => request)).toContain("DELETE /api/settings/google-client");
  });

  it("shows the redirect URIs to register with copy buttons, and the setup steps", async () => {
    stubService({
      "GET /api/settings/google-client": () => ({ status: 200, body: { client: null } }),
      "GET /api/account/identity-callback-urls/google": () => ({
        status: 200,
        body: REDIRECT_URIS,
      }),
    });

    const { page } = await openPage("/settings/signing-in", pages);

    await until(() => expect(page.textContent).toContain(REDIRECT_URIS.thisAddress));
    for (const uri of [REDIRECT_URIS.thisAddress, REDIRECT_URIS.publicAddress]) {
      expect(buttonNamed(page, `Copy ${uri}`)).toBeDefined();
    }
    expect(page.textContent).toContain("Create credentials › OAuth client ID");
    expect(page.textContent).toContain("add each user's Google account as a test user");
  });
});
