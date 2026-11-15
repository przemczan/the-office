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
  current: {
    commit: "0123456789abcdef0123456789abcdef01234567",
    shortCommit: "0123456",
    subject: "Add Settings › Updates",
    committedAt: "2026-11-14T09:00:00.000Z",
  },
  checking: false,
};

afterEach(closePage);

async function currentVersionShown(officeUpdate: OfficeUpdate): Promise<string> {
  stubService({ "GET /api/office-update": () => ({ status: 200, body: officeUpdate }) });
  const { page } = await openPage("/settings/updates", pages);
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
