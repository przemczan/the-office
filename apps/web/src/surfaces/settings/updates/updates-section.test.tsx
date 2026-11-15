import type { OfficeUpdate } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buttonNamed,
  closePage,
  openPage,
  stubService,
  until,
} from "../../../shell/page.fixtures.tsx";
import { PageHeadingProvider } from "../../../shell/page-heading.tsx";
import { UpdatesSection } from "./updates-section.tsx";

const pages = {
  "settings/updates": (): ReactNode => (
    <PageHeadingProvider setPageHeading={() => undefined}>
      <UpdatesSection />
    </PageHeadingProvider>
  ),
};

const CHECKOUT: OfficeUpdate = {
  install: "checkout",
  current: {
    commit: "0123456789abcdef0123456789abcdef01234567",
    shortCommit: "0123456",
    subject: "Add Settings › Updates",
    committedAt: "2026-11-14T09:00:00.000Z",
  },
  restart: {},
  checking: false,
};

afterEach(closePage);

async function opened(officeUpdate: OfficeUpdate): Promise<HTMLElement> {
  stubService({ "GET /api/office-update": () => ({ status: 200, body: officeUpdate }) });
  const { page } = await openPage("/settings/updates", pages);
  return page;
}

async function currentVersionShown(officeUpdate: OfficeUpdate): Promise<string> {
  const page = await opened(officeUpdate);
  let shown = "";
  await until(() => {
    shown = page.querySelector('[aria-label="Current version"]')?.textContent ?? "";
    expect(shown).not.toBe("");
  });
  return shown;
}

describe("Settings › Updates' Version card", () => {
  it("shows an Office release's version before its commit", async () => {
    const shown = await currentVersionShown({ ...CHECKOUT, version: "1.2.3" });

    expect(shown).toMatch(/^1\.2\.3 · 0123456 · Add Settings › Updates · /);
  });

  it("shows a checkout's commit alone", async () => {
    const shown = await currentVersionShown(CHECKOUT);

    expect(shown).toMatch(/^0123456 · Add Settings › Updates · /);
  });
});

const RELEASE: OfficeUpdate = {
  ...CHECKOUT,
  install: "release",
  version: "1.3.0",
  check: {
    checkedAt: "2026-11-15T09:00:00.000Z",
    behind: [],
    releases: [
      {
        version: "1.5.0",
        name: "The Office 1.5.0",
        publishedAt: "2026-11-14T10:00:00.000Z",
        notes: "## What's new\n\n- Self-update from released versions",
        url: "https://github.com/owner/the-office/releases/tag/v1.5.0",
      },
      {
        version: "1.4.0",
        name: "1.4.0",
        publishedAt: "2026-11-01T10:00:00.000Z",
        notes: "Older notes",
        url: "https://github.com/owner/the-office/releases/tag/v1.4.0",
      },
    ],
  },
};

describe("Settings › Updates for a release install", () => {
  it("says how The Office was installed and lists each newer version, the newest's notes open", async () => {
    const page = await opened(RELEASE);

    await until(() => {
      expect(page.querySelector('[aria-label="Update available"]')).not.toBeNull();
    });
    expect(page.querySelector('[aria-label="How The Office was installed"]')?.textContent).toBe(
      "Installed from a release tarball",
    );
    expect(page.textContent).toContain("Version 1.5.0 available");
    const releases = [...page.querySelectorAll("details.updates-release")];
    expect(releases.map((release) => release.hasAttribute("open"))).toEqual([true, false]);
    expect(releases[0]?.querySelector(".markdown-document")?.textContent).toContain(
      "Self-update from released versions",
    );
    expect(
      [...page.querySelectorAll("a")]
        .filter((link) => link.textContent === "Release notes")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://github.com/owner/the-office/releases/tag/v1.5.0",
      "https://github.com/owner/the-office/releases/tag/v1.4.0",
    ]);
    expect(page.querySelector('[aria-label="Update available"] button')?.textContent).toContain(
      "Update",
    );
  });

  it("shows a scheduled release update by its version", async () => {
    const page = await opened({
      ...RELEASE,
      scheduled: {
        kind: "update",
        target: {
          kind: "release",
          version: "1.5.0",
          name: "The Office 1.5.0",
          publishedAt: "2026-11-14T10:00:00.000Z",
          url: "https://github.com/owner/the-office/releases/tag/v1.5.0",
        },
        scheduledAt: "2026-11-15T09:00:00.000Z",
        busy: [],
      },
    });

    await until(() => expect(page.textContent).toContain("To 1.5.0 · 14 Nov"));
  });
});

const NO_LAUNCHER =
  "Nothing here would start The Office again: it runs without its launcher. Restart it where it runs.";

describe("Settings › Updates' Restart card", () => {
  it("schedules a restart", async () => {
    let current = CHECKOUT;
    const sent = stubService({
      "GET /api/office-update": () => ({ status: 200, body: current }),
      "POST /api/office-restart/schedule": () => {
        current = {
          ...CHECKOUT,
          restart: { refusal: "A restart is scheduled already." },
          scheduled: { kind: "restart", scheduledAt: "2026-11-15T09:00:00.000Z", busy: [] },
        };
        return { status: 204 };
      },
    });
    const { page } = await openPage("/settings/updates", pages);
    await until(() => expect(buttonNamed(page, "Restart The Office")?.disabled).toBe(false));
    expect(page.textContent).toContain("Waits for the work going on, as an update does.");

    act(() => buttonNamed(page, "Restart The Office")?.click());

    await until(() => expect(page.textContent).toContain("Restart scheduled"));
    expect(sent.map(({ request }) => request)).toContain("POST /api/office-restart/schedule");
    expect(page.textContent).toContain("Nothing is busy, so The Office is restarting.");
    expect(buttonNamed(page, "Restart The Office")?.disabled).toBe(true);
  });

  it("disables Restart The Office with the reason it is refused", async () => {
    const page = await opened({ ...CHECKOUT, restart: { refusal: NO_LAUNCHER } });

    await until(() => expect(buttonNamed(page, "Restart The Office")).toBeDefined());
    const button = buttonNamed(page, "Restart The Office");
    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe(NO_LAUNCHER);
    expect(page.textContent).toContain("Restart is refused");
    expect(page.textContent).toContain(NO_LAUNCHER);
  });

  it("shows a scheduled restart with what it waits for, and cancels it", async () => {
    let current: OfficeUpdate = {
      ...CHECKOUT,
      restart: { refusal: "A restart is scheduled already." },
      scheduled: {
        kind: "restart",
        scheduledAt: "2026-11-15T09:00:00.000Z",
        busy: [{ kind: "environment-check", label: 'The environment check of the Project "Up"' }],
      },
    };
    const sent = stubService({
      "GET /api/office-update": () => ({ status: 200, body: current }),
      "DELETE /api/office-restart/schedule": () => {
        current = CHECKOUT;
        return { status: 204 };
      },
    });
    const { page } = await openPage("/settings/updates", pages);
    await until(() => expect(page.textContent).toContain("Restart scheduled"));

    const waitsFor = page.querySelector('[aria-label="What the restart waits for"]');
    expect(waitsFor?.textContent).toBe('The environment check of the Project "Up"');
    expect(page.textContent).toContain("Waiting for 1 thing:");
    expect(page.textContent).toContain("Meanwhile, new Starts join the queue");
    expect(page.textContent).not.toContain("Restart is refused");

    act(() => buttonNamed(page, "Cancel")?.click());

    await until(() => expect(page.textContent).not.toContain("Restart scheduled"));
    expect(sent.map(({ request }) => request)).toContain("DELETE /api/office-restart/schedule");
    expect(buttonNamed(page, "Restart The Office")?.disabled).toBe(false);
  });

  it("shows a refused cancel's reason", async () => {
    stubService({
      "GET /api/office-update": () => ({
        status: 200,
        body: {
          ...CHECKOUT,
          scheduled: { kind: "restart", scheduledAt: "2026-11-15T09:00:00.000Z", busy: [] },
        },
      }),
      "DELETE /api/office-restart/schedule": () => ({
        status: 422,
        body: {
          statusCode: 422,
          message: "The Office is restarting.",
          reasons: ["The Office is restarting."],
        },
      }),
    });
    const { page } = await openPage("/settings/updates", pages);
    await until(() => expect(buttonNamed(page, "Cancel")).toBeDefined());

    act(() => buttonNamed(page, "Cancel")?.click());

    await until(() => expect(page.textContent).toContain("The restart wasn't cancelled"));
    expect(page.textContent).toContain("The Office is restarting.");
  });
});
