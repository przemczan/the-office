import type { AddedUser, User } from "@the-office/contracts";
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
import { UsersSection } from "./users-section.tsx";

const ADA: User = {
  id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Ada",
  email: "ada@x.io",
  you: true,
  oneTimePasswordExpiresAt: null,
  createdAt: "2026-11-01T09:00:00.000Z",
};
const GRACE: User = {
  id: "6e2d3c4b-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
  name: "Grace",
  email: "grace@x.io",
  you: false,
  oneTimePasswordExpiresAt: "2099-11-20T09:00:00.000Z",
  createdAt: "2026-11-13T09:00:00.000Z",
};

function Section(): ReactNode {
  return (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <UsersSection />
    </PageHeadingProvider>
  );
}

function rows(page: HTMLElement): HTMLTableRowElement[] {
  return [...page.querySelectorAll<HTMLTableRowElement>("tbody tr")];
}

function dialog(): HTMLElement {
  const shown = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!shown) throw new Error("No window is open.");
  return shown;
}

afterEach(closePage);

describe("Settings › Users", () => {
  it("lists the users, you marked and unable to remove yourself, and who waits for a first sign-in", async () => {
    stubService({ "GET /api/users": () => ({ status: 200, body: [ADA, GRACE] }) });

    const { page } = await openPage("/settings/users", { "settings/users": Section });

    await until(() => expect(rows(page)).toHaveLength(2));
    const [ada, grace] = rows(page);
    expect(ada?.textContent).toContain("You");
    expect(buttonNamed(page, "Remove Ada")?.disabled).toBe(true);
    expect(buttonNamed(page, "Remove Ada")?.title).toBe("You can't remove yourself.");
    expect(grace?.textContent).toContain("Waiting for first sign-in");
    expect(buttonNamed(page, "Remove Grace")?.disabled).toBe(false);
  });

  it("adds a user and shows their one-time password once, with Copy", async () => {
    let users = [ADA];
    const added: AddedUser = { user: GRACE, oneTimePassword: "ABCD-EFGH-JKMN-PQRS" };
    const sent = stubService({
      "GET /api/users": () => ({ status: 200, body: users }),
      "POST /api/users": () => {
        users = [ADA, GRACE];
        return { status: 201, body: added };
      },
    });
    const { page } = await openPage("/settings/users", { "settings/users": Section });
    await until(() => expect(rows(page)).toHaveLength(1));

    act(() => buttonNamed(page, "Add a user")?.click());
    typed(dialog(), "Name", "Grace");
    typed(dialog(), "Email", "grace@x.io");
    act(() => buttonNamed(dialog(), "Add the user")?.click());

    await until(() => expect(dialog().textContent).toContain("ABCD-EFGH-JKMN-PQRS"));
    expect(dialog().textContent).toContain("Shown only once");
    expect(buttonNamed(dialog(), "Copy")).toBeDefined();
    expect(sent.find(({ request }) => request === "POST /api/users")?.body).toEqual({
      name: "Grace",
      email: "grace@x.io",
    });
    await until(() => expect(rows(page)).toHaveLength(2));
    expect(page.textContent).not.toContain("ABCD-EFGH-JKMN-PQRS");
  });

  it("removes a user once confirmed, saying it signs out all their devices", async () => {
    let users = [ADA, GRACE];
    const sent = stubService({
      "GET /api/users": () => ({ status: 200, body: users }),
      [`DELETE /api/users/${GRACE.id}`]: () => {
        users = [ADA];
        return { status: 204 };
      },
    });
    const { page } = await openPage("/settings/users", { "settings/users": Section });
    await until(() => expect(rows(page)).toHaveLength(2));

    act(() => buttonNamed(page, "Remove Grace")?.click());
    expect(dialog().textContent).toContain("signed out on all their devices");
    expect(dialog().textContent).toContain("What they did keeps their name.");
    act(() => buttonNamed(dialog(), "Remove Grace")?.click());

    await until(() => expect(rows(page)).toHaveLength(1));
    expect(sent.map(({ request }) => request)).toContain(`DELETE /api/users/${GRACE.id}`);
  });
});
