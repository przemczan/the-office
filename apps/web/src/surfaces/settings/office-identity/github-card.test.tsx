import type { GitHubState, IdentityCallbackUrls } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../../shell/page.fixtures.tsx";
import { GitHubCard } from "./github-card.tsx";

const APP = {
  slug: "the-office-ada",
  owner: "ada",
  installUrl: "https://github.com/apps/the-office-ada/installations/new",
};
const CALLBACK_URLS: IdentityCallbackUrls = {
  thisAddress: "http://192.168.1.20:4310/api/sign-in/github/callback",
  publicAddress: "https://office.example.com/api/sign-in/github/callback",
};

function openCard(state: GitHubState): Promise<{ readonly page: HTMLElement }> {
  stubService({
    "GET /api/github": () => ({ status: 200, body: state }),
    "GET /api/account/identity-callback-urls/github": () => ({ status: 200, body: CALLBACK_URLS }),
  });
  return openPage("/settings/office-identity", { "settings/office-identity": GitHubCard });
}

afterEach(closePage);

describe("Settings › Office identity's GitHub card", () => {
  it("lists the callback URLs Continue with GitHub needs, each with Copy, and the private App's note", async () => {
    const { page } = await openCard({ status: "signed-in", app: APP, login: "ada" });

    await until(() => expect(page.textContent).toContain(CALLBACK_URLS.thisAddress));
    expect(page.textContent).toContain(CALLBACK_URLS.publicAddress);
    expect(buttonNamed(page, `Copy ${CALLBACK_URLS.thisAddress}`)).toBeDefined();
    expect(buttonNamed(page, `Copy ${CALLBACK_URLS.publicAddress ?? ""}`)).toBeDefined();
    expect(page.textContent).toContain("at most 10");
    expect(page.textContent).toContain("GitHub lets only ada");
    expect(page.textContent).toContain("Advanced › Make public");
    expect(page.textContent).toContain("Don't revoke the App's authorization");
  });

  it("shows them while signed out of GitHub too, but not before the App is registered", async () => {
    const signedOut = await openCard({ status: "signed-out", app: APP });
    await until(() => expect(signedOut.page.textContent).toContain(CALLBACK_URLS.thisAddress));
    closePage();

    const { page } = await openCard({ status: "not-registered" });

    await until(() => expect(page.textContent).toContain("Register the GitHub App"));
    expect(page.textContent).not.toContain("Continue with GitHub");
  });
});
