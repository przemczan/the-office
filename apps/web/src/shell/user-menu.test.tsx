import type { Account } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonNamed, closePage, openPage, stubService, until } from "./page.fixtures.tsx";
import { UserMenu } from "./user-menu.tsx";

const ADA: Account = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Ada",
  email: "ada@x.io",
  appearance: { palette: null, density: null },
  authenticator: { state: "off" },
};

async function openedMenu(): Promise<Awaited<ReturnType<typeof openPage>>> {
  const opened = await openPage("/now", {
    now: UserMenu,
    account: () => <p>The account</p>,
    "sign-in": () => <p>The sign-in page</p>,
  });
  await until(() => expect(buttonNamed(opened.page, "User menu: Ada")).toBeDefined());
  act(() => buttonNamed(opened.page, "User menu: Ada")?.click());
  return opened;
}

function menu(): HTMLElement {
  const shown = document.querySelector<HTMLElement>('[role="menu"]');
  if (!shown) throw new Error("The user menu isn't open.");
  return shown;
}

afterEach(closePage);

describe("the user menu", () => {
  it("names the user and opens the account", async () => {
    stubService({ "GET /api/account": () => ({ status: 200, body: ADA }) });
    const { page, router } = await openedMenu();

    expect(page.textContent).toContain("Ada");
    act(() => buttonNamed(menu(), "Account")?.click());

    await until(() => expect(router.state.location.pathname).toBe("/account"));
  });

  it("signs out this device and lands on the sign-in page", async () => {
    const sent = stubService({
      "GET /api/account": () => ({ status: 200, body: ADA }),
      "POST /api/sign-out": () => ({ status: 204 }),
    });
    const { page, router } = await openedMenu();

    act(() => buttonNamed(menu(), "Sign out")?.click());

    await until(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(page.textContent).toContain("The sign-in page");
    expect(sent.map(({ request }) => request)).toContain("POST /api/sign-out");
  });
});
