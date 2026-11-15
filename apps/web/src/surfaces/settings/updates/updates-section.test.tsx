import type { OfficeUpdate } from "@the-office/contracts";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { closePage, openPage, stubService, until } from "../../../shell/page.fixtures.tsx";
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
