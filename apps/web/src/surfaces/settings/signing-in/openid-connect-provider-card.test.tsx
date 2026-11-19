import type { IdentityCallbackUrls, OpenIdConnectProviderSetting } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  typed as typedAnywhere,
  until,
} from "../../../shell/page.fixtures.tsx";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { SigningInSection } from "./signing-in-section.tsx";

const ISSUER = "https://auth.example.com";
const SECRET = "the-oidc-client-secret";
const REDIRECT_URIS: IdentityCallbackUrls = {
  thisAddress: "http://localhost:4310/api/sign-in/openid-connect/callback",
  publicAddress: "https://office.example.com/api/sign-in/openid-connect/callback",
};
const SAVED: OpenIdConnectProviderSetting = {
  provider: { name: "Zitadel", issuer: ISSUER, clientId: "office-1", secretSet: true },
};

const pages = {
  "settings/signing-in": (): ReactNode => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <SigningInSection />
    </PageHeadingProvider>
  ),
};

afterEach(closePage);

function stubGoogleAndUris(): Record<string, () => { status: number; body: unknown }> {
  return {
    "GET /api/settings/google-client": () => ({ status: 200, body: { client: null } }),
    "GET /api/account/identity-callback-urls/google": () => ({
      status: 200,
      body: REDIRECT_URIS,
    }),
    "GET /api/account/identity-callback-urls/openid-connect": () => ({
      status: 200,
      body: REDIRECT_URIS,
    }),
  };
}

function providerForm(page: HTMLElement): HTMLElement {
  const form = page.querySelector<HTMLElement>("form[aria-label='OpenID Connect provider']");
  if (!form) throw new Error("The OpenID Connect form isn't shown.");
  return form;
}

/** Types into a field of the OpenID Connect form: the Google card has fields of the same labels. */
function typed(page: HTMLElement, label: string, text: string): void {
  typedAnywhere(providerForm(page), label, text);
}

function formButton(page: HTMLElement, name: string): HTMLButtonElement | undefined {
  return buttonNamed(providerForm(page), name);
}

function inputLabelled(page: HTMLElement, label: string): HTMLInputElement {
  const found = [...providerForm(page).querySelectorAll("label")].find(
    (each) => each.textContent?.replace("*", "").trim() === label,
  );
  const input = found && page.ownerDocument.getElementById(found.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input labelled ${label}.`);
  return input;
}

describe("Settings › Signing in › OpenID Connect", () => {
  it("saves a provider with its fields, then shows that a secret is set, never the secret", async () => {
    let current: OpenIdConnectProviderSetting = { provider: null };
    const sent = stubService({
      ...stubGoogleAndUris(),
      "GET /api/settings/openid-connect-provider": () => ({ status: 200, body: current }),
      "PUT /api/settings/openid-connect-provider": () => {
        current = SAVED;
        return { status: 200, body: SAVED.provider };
      },
    });
    const { page } = await openPage("/settings/signing-in", pages);
    await until(() => expect(page.textContent).toContain("Continue with an OpenID Connect"));

    typed(page, "Name", "Zitadel");
    typed(page, "Issuer URL", ISSUER);
    typed(page, "Client ID", "office-1");
    typed(page, "Client secret", SECRET);
    expect(page.textContent).not.toContain("unlinks every linked identity");
    act(() => formButton(page, "Save")?.click());

    await until(() => expect(page.textContent).toContain("Secret set"));
    expect(
      sent.find(({ request }) => request === "PUT /api/settings/openid-connect-provider")?.body,
    ).toEqual({ name: "Zitadel", issuer: ISSUER, clientId: "office-1", clientSecret: SECRET });
    expect(inputLabelled(page, "Client secret").value).toBe("");
    expect(page.innerHTML).not.toContain(SECRET);
  });

  it("keeps the saved secret when blank, warns only when the issuer differs, and removes after asking", async () => {
    let current: OpenIdConnectProviderSetting = SAVED;
    const sent = stubService({
      ...stubGoogleAndUris(),
      "GET /api/settings/openid-connect-provider": () => ({ status: 200, body: current }),
      "PUT /api/settings/openid-connect-provider": () => ({ status: 200, body: SAVED.provider }),
      "DELETE /api/settings/openid-connect-provider": () => {
        current = { provider: null };
        return { status: 204 };
      },
    });
    const { page } = await openPage("/settings/signing-in", pages);
    await until(() => expect(inputLabelled(page, "Issuer URL").value).toBe(ISSUER));
    expect(inputLabelled(page, "Client secret").required).toBe(false);

    typed(page, "Issuer URL", `${ISSUER}/`);
    expect(page.textContent).not.toContain("unlinks every linked identity");

    typed(page, "Issuer URL", "https://login.example.org");
    expect(page.textContent).toContain("unlinks every linked identity");

    typed(page, "Issuer URL", ISSUER);
    expect(page.textContent).not.toContain("unlinks every linked identity");

    typed(page, "Name", "Company login");
    act(() => formButton(page, "Save")?.click());
    await until(() =>
      expect(sent.map(({ request }) => request)).toContain(
        "PUT /api/settings/openid-connect-provider",
      ),
    );
    expect(
      sent.find(({ request }) => request === "PUT /api/settings/openid-connect-provider")?.body,
    ).toEqual({ name: "Company login", issuer: ISSUER, clientId: "office-1", clientSecret: "" });

    act(() => formButton(page, "Remove")?.click());
    expect(document.body.textContent).toContain("The accounts users linked stay linked");
    act(() => buttonNamed(document.body, "Remove the provider")?.click());

    await until(() => expect(page.textContent).toContain("Continue with an OpenID Connect"));
    expect(sent.map(({ request }) => request)).toContain(
      "DELETE /api/settings/openid-connect-provider",
    );
  });

  it("shows the service's reasons when it refuses", async () => {
    stubService({
      ...stubGoogleAndUris(),
      "GET /api/settings/openid-connect-provider": () => ({
        status: 200,
        body: { provider: null },
      }),
      "PUT /api/settings/openid-connect-provider": () => ({
        status: 422,
        body: {
          message: "The issuer's discovery document can't be read.",
          reasons: ["The issuer's discovery document can't be read."],
        },
      }),
    });
    const { page } = await openPage("/settings/signing-in", pages);
    await until(() => expect(page.textContent).toContain("Continue with an OpenID Connect"));

    typed(page, "Name", "Zitadel");
    typed(page, "Issuer URL", ISSUER);
    typed(page, "Client ID", "office-1");
    typed(page, "Client secret", SECRET);
    act(() => formButton(page, "Save")?.click());

    await until(() =>
      expect(page.textContent).toContain("The OpenID Connect provider wasn't saved"),
    );
    expect(page.textContent).toContain("discovery document can't be read");
  });

  it("shows the redirect URIs with Copy, and the note on Zitadel's Development mode", async () => {
    stubService({
      ...stubGoogleAndUris(),
      "GET /api/settings/openid-connect-provider": () => ({
        status: 200,
        body: { provider: null },
      }),
    });
    const { page } = await openPage("/settings/signing-in", pages);

    await until(() => expect(page.textContent).toContain("openid-connect/callback"));
    for (const uri of [REDIRECT_URIS.thisAddress, REDIRECT_URIS.publicAddress]) {
      expect(buttonNamed(page, `Copy ${uri}`)).toBeDefined();
    }
    expect(page.textContent).toContain("Development mode");
  });
});
