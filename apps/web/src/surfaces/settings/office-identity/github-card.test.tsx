import type {
  GitHubMissingPermissions,
  GitHubState,
  IdentityCallbackUrls,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
  type Sent,
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

const MISSING: GitHubMissingPermissions = {
  missing: [
    { name: "checks", level: "read" },
    { name: "statuses", level: "read" },
  ],
  appPermissionsUrl: "https://github.com/settings/apps/the-office-ada/permissions",
  installations: [
    { account: "ada", acceptUrl: "https://github.com/settings/installations/7" },
    {
      account: "ada-labs",
      acceptUrl: "https://github.com/organizations/ada-labs/settings/installations/8",
    },
  ],
};

function openCard(
  state: GitHubState,
  checked: GitHubState = state,
): Promise<{ readonly page: HTMLElement }> {
  sent = stubService({
    "GET /api/github": () => ({ status: 200, body: state }),
    "POST /api/github/permissions/check": () => ({ status: 200, body: checked }),
    "GET /api/account/identity-callback-urls/github": () => ({ status: 200, body: CALLBACK_URLS }),
  });
  return openPage("/settings/office-identity", { "settings/office-identity": GitHubCard });
}

let sent: Sent[] = [];

afterEach(closePage);

describe("Settings › Office identity's GitHub card", () => {
  it("lists the callback URLs Continue with GitHub needs, each with Copy, and the private App's note", async () => {
    const { page } = await openCard({
      status: "signed-in",
      app: APP,
      login: "ada",
      permissions: null,
    });

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

  it("asks for the permissions the App lacks, with where to add and accept them, until Check again finds none", async () => {
    const { page } = await openCard(
      { status: "signed-in", app: APP, login: "ada", permissions: MISSING },
      { status: "signed-in", app: APP, login: "ada", permissions: null },
    );

    await until(() => expect(page.textContent).toContain("The GitHub App needs more permissions"));
    expect(page.textContent).toContain("Checks (read)");
    expect(page.textContent).toContain("Commit statuses (read)");
    const links = [...page.querySelectorAll("a")];
    const added = links.find((link) => link.textContent === "Add them to the App on GitHub");
    expect(added?.getAttribute("href")).toBe(MISSING.appPermissionsUrl);
    expect(added?.getAttribute("target")).toBe("_blank");
    for (const { account, acceptUrl } of MISSING.installations) {
      expect(links.find((link) => link.textContent === account)?.getAttribute("href")).toBe(
        acceptUrl,
      );
    }

    buttonNamed(page, "Check again")?.click();

    await until(() =>
      expect(page.textContent).not.toContain("The GitHub App needs more permissions"),
    );
    expect(sent.map(({ request }) => request)).toContain("POST /api/github/permissions/check");
  });

  it("asks for nothing while every installation has them all", async () => {
    const { page } = await openCard({
      status: "signed-in",
      app: APP,
      login: "ada",
      permissions: null,
    });

    await until(() => expect(page.textContent).toContain("Signed in as"));
    expect(page.textContent).not.toContain("needs more permissions");
  });
});
