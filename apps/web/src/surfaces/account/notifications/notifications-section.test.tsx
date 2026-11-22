import type { NotificationRouting, NotificationTiming, RoutedChannel } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  closePage,
  openPage,
  stubService,
  until,
  type Answers,
} from "../../../shell/page.fixtures.tsx";
import { PageHeadingProvider, type PageHeading } from "../../../shell/page-heading.tsx";
import { NotificationsSection } from "./notifications-section.tsx";

const TIMING: NotificationTiming = {
  holdPhoneMinutes: 5,
  awayMinutes: 5,
  batchOutcomesMinutes: 2,
  quietHours: null,
};

const inherited = (on: boolean): RoutedChannel => ({ on, from: on ? "office" : null });
const ROUTING: NotificationRouting = {
  office: {
    "in-app": { on: true, from: "office" },
    desktop: { on: true, from: "office" },
    phone: { on: false, from: null },
  },
  "office.alarm-lifted": {
    "in-app": inherited(true),
    desktop: inherited(true),
    phone: inherited(false),
  },
};

function stubNotifications(more: Answers = {}): ReturnType<typeof stubService> {
  return stubService({
    "GET /api/account/notifications/routing": () => ({ status: 200, body: ROUTING }),
    "GET /api/account/notifications/timing": () => ({ status: 200, body: TIMING }),
    ...more,
  });
}

let heading: PageHeading | undefined;

function NotificationsPage(): ReactNode {
  return (
    <PageHeadingProvider
      setPageHeading={(shown) => {
        heading = typeof shown === "function" ? shown(heading) : shown;
      }}
    >
      <NotificationsSection />
    </PageHeadingProvider>
  );
}

function cell(page: HTMLElement, name: string): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

afterEach(() => {
  closePage();
  heading = undefined;
});

describe("Account › Notifications", () => {
  const pages = { "account/notifications": NotificationsPage };

  it("shows the user's own What goes where and timing, under the Account heading", async () => {
    stubNotifications();

    const { page } = await openPage("/account/notifications", pages);

    await until(() =>
      expect(cell(page, "Phone for Alarm lifted with work waiting")).not.toBeNull(),
    );
    expect(heading).toMatchObject({ title: "Account", crumb: "Notifications" });
    expect(page.textContent).toContain("What goes where");
    expect(cell(page, "Desktop for Alarm lifted with work waiting")?.title).toBe(
      "Inherited from Office",
    );
    expect(page.textContent).toContain("Hold phone pushes while you are at the desk");
    expect(page.textContent).toContain("Send anything still unhandled to your phone");
    expect(page.textContent).toContain("Off until you set them.");
  });

  it("sets a cell and the timing through the user's own routes", async () => {
    const sent = stubNotifications({
      "PUT /api/account/notifications/routing/office.alarm-lifted": () => ({
        status: 200,
        body: {
          ...ROUTING,
          "office.alarm-lifted": {
            ...ROUTING["office.alarm-lifted"],
            phone: { on: true, from: "office.alarm-lifted" },
          },
        },
      }),
      "PUT /api/account/notifications/timing": (body) => ({ status: 200, body }),
    });
    const { page } = await openPage("/account/notifications", pages);
    await until(() =>
      expect(cell(page, "Phone for Alarm lifted with work waiting")).not.toBeNull(),
    );

    act(() => cell(page, "Phone for Alarm lifted with work waiting")?.click());
    await until(() =>
      expect(cell(page, "Phone for Alarm lifted with work waiting")?.title).toBe("Set here"),
    );
    act(() => page.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await until(() =>
      expect(
        sent.find(({ request }) => request === "PUT /api/account/notifications/timing")?.body,
      ).toEqual({ ...TIMING, quietHours: { from: "22:00", to: "07:00" } }),
    );

    expect(
      sent.find(
        ({ request }) => request === "PUT /api/account/notifications/routing/office.alarm-lifted",
      )?.body,
    ).toEqual({ channel: "phone", on: true });
  });
});
