import type { Account, SignedInDevice } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  shownText,
  stubService,
  until,
} from "../../shell/page.fixtures.tsx";
import { AccountPage } from "./account-page.tsx";

const ADA: Account = { id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Ada", email: "ada@x.io" };
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

function stubAccount(): ReturnType<typeof stubService> {
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
  });
}

function rows(page: HTMLElement): HTMLTableRowElement[] {
  return [...page.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

afterEach(closePage);

describe("the account", () => {
  it("shows the user and their signed-in devices, this one marked, each with Sign out", async () => {
    stubAccount();

    const { page } = await openPage("/account", { account: AccountPage });

    await until(() => expect(rows(page)).toHaveLength(2));
    expect(page.textContent).toContain("ada@x.io");
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
    const { page } = await openPage("/account", { account: AccountPage });
    await until(() => expect(rows(page)).toHaveLength(2));

    act(() => rows(page)[1]?.querySelector("button")?.click());

    await until(() => expect(rows(page)).toHaveLength(1));
    expect(sent.map(({ request }) => request)).toContain(
      `DELETE /api/account/signed-in-devices/${PHONE.id}`,
    );
  });

  it("lands on the sign-in page once this device is signed out", async () => {
    stubAccount();
    const { page, router } = await openPage("/account", {
      account: AccountPage,
      "sign-in": () => <p>The sign-in page</p>,
    });
    await until(() => expect(rows(page)).toHaveLength(2));

    act(() => buttonNamed(page, "Sign out this device")?.click());

    await until(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(page.textContent).toContain("The sign-in page");
  });
});
