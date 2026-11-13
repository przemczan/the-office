import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import type {
  Passkey,
  PasskeyCreationOptions,
  PasskeyList,
  PasskeyRegistration,
} from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { PasskeysSection } from "./passkeys-section.tsx";

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn<() => boolean>(() => true),
  startRegistration: vi.fn<typeof import("@simplewebauthn/browser").startRegistration>(),
}));

const LAPTOP: Passkey = {
  id: "0b6a2f4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
  name: "Laptop",
  rpId: "localhost",
  at: "this-address",
  createdAt: "2026-11-10T09:00:00.000Z",
  lastUsedAt: "2026-11-13T08:00:00.000Z",
};
const PHONE: Passkey = {
  id: "7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b",
  name: "Phone",
  rpId: "office.example.com",
  at: "other-address",
  otherAddress: "https://office.example.com",
  createdAt: "2026-11-11T09:00:00.000Z",
  lastUsedAt: null,
};
const OLD: Passkey = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Old key",
  rpId: "old.example.com",
  at: "old-address",
  createdAt: "2026-10-01T09:00:00.000Z",
  lastUsedAt: null,
};
const OPTIONS: PasskeyCreationOptions = {
  rp: { name: "The Office", id: "localhost" },
  user: { id: "dXNlci0x", name: "ada@x.io", displayName: "Ada" },
  challenge: "a-challenge",
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
  authenticatorSelection: { residentKey: "required", userVerification: "required" },
  attestation: "none",
};
const REGISTRATION: PasskeyRegistration = {
  id: "credential-1",
  rawId: "credential-1",
  type: "public-key",
  response: { clientDataJSON: "client-data", attestationObject: "attestation" },
};

const pages = {
  "account/passkeys": (): ReactNode => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <PasskeysSection />
    </PageHeadingProvider>
  ),
};

function stubPasskeys(list: PasskeyList, more: Answers = {}): ReturnType<typeof stubService> {
  let current = list;
  return stubService({
    "GET /api/account/passkeys": () => ({ status: 200, body: current }),
    [`DELETE /api/account/passkeys/${LAPTOP.id}`]: () => {
      current = { ...current, passkeys: current.passkeys.filter(({ id }) => id !== LAPTOP.id) };
      return { status: 204 };
    },
    ...more,
  });
}

function rows(page: HTMLElement): HTMLTableRowElement[] {
  return [...page.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true);
  vi.mocked(startRegistration).mockReset();
});

afterEach(closePage);

describe("Account › Passkeys", () => {
  it("shows where each passkey works, links the other address and marks an old one", async () => {
    stubPasskeys({ passkeys: [LAPTOP, PHONE, OLD], addingUnavailable: null });

    const { page } = await openPage("/account/passkeys", pages);

    await until(() => expect(rows(page)).toHaveLength(3));
    const [laptop, phone, old] = rows(page).map(shownText);
    expect(laptop).toContain("Works at localhost");
    expect(phone).toContain("Use it at office.example.com");
    expect(phone).toContain("Never");
    const link = page.querySelector<HTMLAnchorElement>(
      'a[href="https://office.example.com/account/passkeys"]',
    );
    expect(link?.textContent).toBe("Use it at office.example.com");
    expect(old).toContain("Old address");
    expect(old).toContain("no longer The Office's address: it can't sign in.");
    expect(buttonNamed(page, "Remove Old key")).toBeDefined();
    expect(buttonNamed(page, "Add a passkey")?.disabled).toBe(false);
  });

  it("adds a passkey after the current password, then its name", async () => {
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION as Awaited<ReturnType<typeof startRegistration>>,
    );
    const added: Passkey = { ...LAPTOP, id: "new-passkey", name: "Desk", lastUsedAt: null };
    const sent = stubPasskeys(
      { passkeys: [], addingUnavailable: null },
      {
        "POST /api/account/passkeys/options": () => ({ status: 200, body: OPTIONS }),
        "POST /api/account/passkeys": () => ({ status: 201, body: added }),
      },
    );
    const { page } = await openPage("/account/passkeys", pages);
    await until(() => expect(buttonNamed(page, "Add a passkey")).toBeDefined());

    act(() => buttonNamed(document.body, "Add a passkey")?.click());
    typed(document.body, "Current password", "correct horse battery staple");
    act(() => buttonNamed(document.body, "Continue")?.click());
    await until(() => expect(buttonNamed(document.body, "Add the passkey")).toBeDefined());
    typed(document.body, "Name", "  Desk ");
    act(() => buttonNamed(document.body, "Add the passkey")?.click());

    await until(() =>
      expect(sent.some(({ request }) => request === "POST /api/account/passkeys")).toBe(true),
    );
    expect(
      sent.find(({ request }) => request === "POST /api/account/passkeys/options")?.body,
    ).toEqual({ currentPassword: "correct horse battery staple" });
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(sent.find(({ request }) => request === "POST /api/account/passkeys")?.body).toEqual({
      name: "Desk",
      registration: REGISTRATION,
    });
  });

  it("removes a passkey once confirmed", async () => {
    const sent = stubPasskeys({ passkeys: [LAPTOP], addingUnavailable: null });
    const { page } = await openPage("/account/passkeys", pages);
    await until(() => expect(rows(page)).toHaveLength(1));

    act(() => buttonNamed(page, "Remove Laptop")?.click());
    act(() => buttonNamed(document.body, "Remove the passkey")?.click());

    await until(() => expect(shownText(page)).toContain("No passkeys yet."));
    expect(sent.map(({ request }) => request)).toContain(
      `DELETE /api/account/passkeys/${LAPTOP.id}`,
    );
  });

  it("says at an IP address why a passkey can't be added there, and where it can", async () => {
    stubPasskeys({
      passkeys: [LAPTOP],
      addingUnavailable: { reason: "ip-address", elsewhere: "http://localhost:4310" },
    });
    const { page } = await openPage("/account/passkeys", pages);

    await until(() => expect(shownText(page)).toContain("Passkeys don't work at an IP address."));
    expect(buttonNamed(page, "Add a passkey")).toBeUndefined();
    expect(
      page.querySelector('a[href="http://localhost:4310/account/passkeys"]')?.textContent,
    ).toBe("Open localhost:4310 to add one");
  });
});
