import type { Account, SignedInDevice } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountAppearance } from "../../shell/account-appearance.tsx";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  typed,
  until,
  type Answers,
} from "../../shell/page.fixtures.tsx";
import { PageHeadingProvider } from "../../shell/page-heading.tsx";
import { ThemeMenu } from "../../shell/theme-menu.tsx";
import { AuthenticatorSection } from "./authenticator-section.tsx";
import { ProfileSection } from "./profile-section.tsx";
import { SignedInDevicesSection } from "./signed-in-devices-section.tsx";

const ADA: Account = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Ada",
  email: "ada@x.io",
  appearance: { palette: null, density: null },
  authenticator: { state: "off" },
};
const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const THIS_ONE: SignedInDevice = {
  id: "0b6a2f4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
  userAgent: CHROME,
  addressKind: "localhost",
  signedInAt: "2026-11-13T09:00:00.000Z",
  lastSeenAt: "2026-11-13T14:00:00.000Z",
  thisDevice: true,
};
const PHONE: SignedInDevice = {
  id: "7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b",
  userAgent: null,
  addressKind: "local-network-ip",
  signedInAt: "2026-11-10T09:00:00.000Z",
  lastSeenAt: "2026-11-12T08:00:00.000Z",
  thisDevice: false,
};

function stubAccount(more: Answers = {}): ReturnType<typeof stubService> {
  let devices = [THIS_ONE, PHONE];
  const signedOut = (id: string) => () => {
    devices = devices.filter((device) => device.id !== id);
    return { status: 204 };
  };
  return stubService({
    "GET /api/account": () => ({ status: 200, body: ADA }),
    "GET /api/account/signed-in-devices": () => ({ status: 200, body: devices }),
    [`DELETE /api/account/signed-in-devices/${THIS_ONE.id}`]: signedOut(THIS_ONE.id),
    [`DELETE /api/account/signed-in-devices/${PHONE.id}`]: signedOut(PHONE.id),
    ...more,
  });
}

/** A section as the account page shows it, under the shell's page heading. */
function section(Section: () => ReactNode): () => ReactNode {
  return () => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <Section />
    </PageHeadingProvider>
  );
}

function rows(page: HTMLElement): HTMLTableRowElement[] {
  return [...page.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

function submitButton(page: HTMLElement, form: string): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(`form[aria-label="${form}"] button[type="submit"]`);
}

afterEach(closePage);

describe("Account › Signed-in devices", () => {
  const pages = {
    "account/signed-in-devices": section(SignedInDevicesSection),
    "sign-in": () => <p>The sign-in page</p>,
  };

  it("shows the user's signed-in devices, this one marked, each with Sign out", async () => {
    stubAccount();

    const { page } = await openPage("/account/signed-in-devices", pages);

    await until(() => expect(rows(page)).toHaveLength(2));
    const [first, second] = rows(page);
    expect(first?.textContent).toContain("Chrome on Linux");
    expect(first?.textContent).toContain("This device");
    expect(first?.textContent).toContain("Localhost");
    expect(second?.textContent).not.toContain("This device");
    expect(second?.textContent).toContain("Local network");
    expect(rows(page).map((row) => shownText(row.querySelector("button") ?? row))).toEqual([
      "Sign out",
      "Sign out",
    ]);
  });

  it("signs out another device and lists what is left", async () => {
    const sent = stubAccount();
    const { page } = await openPage("/account/signed-in-devices", pages);
    await until(() => expect(rows(page)).toHaveLength(2));

    act(() => rows(page)[1]?.querySelector("button")?.click());

    await until(() => expect(rows(page)).toHaveLength(1));
    expect(sent.map(({ request }) => request)).toContain(
      `DELETE /api/account/signed-in-devices/${PHONE.id}`,
    );
  });

  it("lands on the sign-in page once this device is signed out", async () => {
    stubAccount();
    const { page, router } = await openPage("/account/signed-in-devices", pages);
    await until(() => expect(rows(page)).toHaveLength(2));

    act(() => buttonNamed(page, "Sign out this device")?.click());

    await until(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(page.textContent).toContain("The sign-in page");
  });
});

const RECOVERY_CODES = Array.from({ length: 10 }, (_, index) => `ABCD${index}-EFGH${index}`);
const SETUP = {
  keyUri: "otpauth://totp/The%20Office:ada%40x.io?issuer=The+Office&secret=JBSWY3DPEHPK3PXP",
  secret: "JBSWY3DPEHPK3PXP",
};

/** The account with the authenticator off until a right first code, `123456`, turns it on. */
function stubAuthenticator(): ReturnType<typeof stubService> {
  let account: Account = ADA;
  return stubAccount({
    "GET /api/account": () => ({ status: 200, body: account }),
    "POST /api/account/authenticator": () => ({ status: 201, body: SETUP }),
    "POST /api/account/authenticator/confirm": (body) => {
      if ((body as { code: string }).code !== "123456") {
        return {
          status: 422,
          body: { statusCode: 422, message: "The code is wrong.", refusal: "wrong" },
        };
      }
      account = { ...ADA, authenticator: { state: "on", recoveryCodesLeft: 10 } };
      return { status: 200, body: { recoveryCodes: RECOVERY_CODES } };
    },
    "DELETE /api/account/authenticator": () => {
      account = ADA;
      return { status: 204 };
    },
  });
}

/** The window open, or the page's body while none is. */
function dialog(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[role="dialog"]') ?? document.body;
}

describe("Account › Authenticator", () => {
  const pages = { "account/authenticator": section(AuthenticatorSection) };

  it("is set up with its QR code and key, turns on only with a right first code, and shows the recovery codes once", async () => {
    stubAuthenticator();
    const { page } = await openPage("/account/authenticator", pages);
    await until(() => expect(buttonNamed(page, "Set up the authenticator")).toBeDefined());

    act(() => buttonNamed(page, "Set up the authenticator")?.click());

    await until(() => expect(dialog().querySelector("img")).not.toBeNull());
    expect(dialog().querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(dialog().textContent).toContain("JBSW Y3DP EHPK 3PXP");
    const codeField = dialog().querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]',
    );
    expect(codeField?.inputMode).toBe("numeric");
    expect(buttonNamed(dialog(), "Use a recovery code")).toBeUndefined();

    typed(dialog(), "Authenticator code", "654321");
    act(() => buttonNamed(dialog(), "Turn on the authenticator")?.click());
    await until(() => expect(dialog().textContent).toContain("The code is wrong."));

    typed(dialog(), "Authenticator code", "123456");
    act(() => buttonNamed(dialog(), "Turn on the authenticator")?.click());
    await until(() => expect(dialog().querySelectorAll("li")).toHaveLength(10));
    expect(dialog().textContent).toContain("ABCD0-EFGH0");
    expect(buttonNamed(dialog(), "Copy the codes")).toBeDefined();
    expect(buttonNamed(dialog(), "Download the codes")).toBeDefined();

    act(() => buttonNamed(dialog(), "Close")?.click());
    await until(() => expect(page.textContent).toContain("10 recovery codes left."));
    expect(document.body.textContent).not.toContain("ABCD0-EFGH0");
  });

  it("turns off with a recovery code", async () => {
    const sent = stubAuthenticator();
    const { page } = await openPage("/account/authenticator", pages);
    await until(() => expect(buttonNamed(page, "Set up the authenticator")).toBeDefined());
    act(() => buttonNamed(page, "Set up the authenticator")?.click());
    await until(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    typed(dialog(), "Authenticator code", "123456");
    act(() => buttonNamed(dialog(), "Turn on the authenticator")?.click());
    await until(() => expect(buttonNamed(dialog(), "Copy the codes")).toBeDefined());
    act(() => buttonNamed(dialog(), "Close")?.click());
    await until(() => expect(buttonNamed(page, "Turn off")).toBeDefined());

    act(() => buttonNamed(page, "Turn off")?.click());
    await until(() => expect(buttonNamed(dialog(), "Use a recovery code")).toBeDefined());
    act(() => buttonNamed(dialog(), "Use a recovery code")?.click());
    typed(dialog(), "Recovery code", "ABCD1-EFGH1");
    act(() => buttonNamed(dialog(), "Turn off")?.click());

    await until(() => expect(buttonNamed(page, "Set up the authenticator")).toBeDefined());
    expect(
      sent.find(({ request }) => request === "DELETE /api/account/authenticator")?.body,
    ).toEqual({ recoveryCode: "ABCD1-EFGH1" });
  });
});

describe("Account › Profile", () => {
  const pages = { "account/profile": section(ProfileSection) };

  it("changes the name and email", async () => {
    const sent = stubAccount({
      "PATCH /api/account": (body) => ({ status: 200, body: { ...ADA, ...(body as object) } }),
    });
    const { page } = await openPage("/account/profile", pages);
    await until(() => expect(page.querySelector("input")?.value).toBe("Ada"));
    expect(submitButton(page, "Profile")?.disabled).toBe(true);

    typed(page, "Name", "Ada King");
    act(() => submitButton(page, "Profile")?.click());

    await until(() => expect(page.textContent).toContain("Your profile was saved."));
    expect(sent.find(({ request }) => request === "PATCH /api/account")?.body).toEqual({
      name: "Ada King",
      email: "ada@x.io",
    });
  });

  it("changes the password only with the current one and the new one typed twice alike", async () => {
    let current = "the current password";
    const sent = stubAccount({
      "POST /api/account/password": (body) => {
        const { currentPassword } = body as { currentPassword: string };
        if (currentPassword === current) return { status: 204 };
        return {
          status: 422,
          body: {
            statusCode: 422,
            message: "The current password is wrong.",
            reasons: ["The current password is wrong."],
          },
        };
      },
    });
    const { page } = await openPage("/account/profile", pages);
    await until(() => expect(submitButton(page, "Change password")).not.toBeNull());

    typed(page, "Current password", "a wrong guess");
    typed(page, "New password", "a brand new password");
    typed(page, "Repeat the new password", "a brand new passwore");
    expect(submitButton(page, "Change password")?.disabled).toBe(true);
    expect(page.textContent).toContain("The two new passwords differ.");
    typed(page, "Repeat the new password", "a brand new password");
    act(() => submitButton(page, "Change password")?.click());
    await until(() => expect(page.textContent).toContain("The current password is wrong."));

    typed(page, "Current password", current);
    act(() => submitButton(page, "Change password")?.click());

    await until(() =>
      expect(page.textContent).toContain(
        "Your password was changed. Your other devices are signed out.",
      ),
    );
    expect(
      sent.filter(({ request }) => request === "POST /api/account/password").at(-1)?.body,
    ).toEqual({ currentPassword: current, newPassword: "a brand new password" });
    current = "a brand new password";
  });
});

/** The rail's Theme menu in the shell, which saves to the account. */
function ThemeMenuAndAccount(): ReactNode {
  return (
    <>
      <AccountAppearance />
      <ThemeMenu />
    </>
  );
}

describe("the account's appearance", () => {
  it("is shown as the account says, and the rail's Theme menu saves a choice to the account", async () => {
    const sent = stubAccount({
      "GET /api/account": () => ({
        status: 200,
        body: { ...ADA, appearance: { palette: "cobalt", density: "relaxed" } },
      }),
      "PUT /api/account/appearance": (body) => ({
        status: 200,
        body: { ...ADA, appearance: body },
      }),
    });

    const { page } = await openPage("/now", { now: ThemeMenuAndAccount });

    await until(() => expect(document.documentElement.dataset.palette).toBe("cobalt"));
    expect(document.documentElement.dataset.density).toBe("relaxed");
    act(() => buttonNamed(page, "Theme")?.click());
    const mocha = [...document.querySelectorAll<HTMLElement>('[role="menu"] button')].find((item) =>
      item.textContent.includes("Mocha"),
    );
    expect(mocha).toBeDefined();
    act(() => mocha?.click());

    await until(() =>
      expect(sent.find(({ request }) => request === "PUT /api/account/appearance")?.body).toEqual({
        palette: "mocha",
        density: "relaxed",
      }),
    );
    expect(document.documentElement.dataset.palette).toBe("mocha");
  });
});
