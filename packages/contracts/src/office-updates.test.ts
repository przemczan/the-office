import { describe, expect, it } from "vitest";
import { officeUpdateResultSchema, officeUpdateSchema } from "./office-updates.js";

const CHECKOUT = {
  install: "checkout",
  current: {
    commit: "0123456789abcdef0123456789abcdef01234567",
    shortCommit: "0123456",
    subject: "Add Settings › Updates",
    committedAt: "2026-11-14T09:00:00.000Z",
  },
  checking: false,
};

describe("Settings › Updates' version", () => {
  it("carries an Office release's version", () => {
    expect(officeUpdateSchema.parse({ ...CHECKOUT, version: "1.2.3" }).version).toBe("1.2.3");
  });

  it("has none from a checkout, and never an empty one", () => {
    expect(officeUpdateSchema.parse(CHECKOUT).version).toBeUndefined();
    expect(officeUpdateSchema.safeParse({ ...CHECKOUT, version: "" }).success).toBe(false);
  });
});

describe("Settings › Updates' releases", () => {
  const release = {
    version: "1.4.0",
    name: "The Office 1.4.0",
    publishedAt: "2026-11-14T10:00:00.000Z",
    url: "https://github.com/owner/the-office/releases/tag/v1.4.0",
  };

  it("lists newer releases with their notes, and schedules one by its version", () => {
    const parsed = officeUpdateSchema.parse({
      ...CHECKOUT,
      install: "release",
      version: "1.3.0",
      check: {
        checkedAt: "2026-11-15T10:00:00.000Z",
        behind: [],
        releases: [{ ...release, notes: "## What's new" }],
      },
      scheduled: {
        target: { kind: "release", ...release },
        scheduledAt: "2026-11-15T10:00:00.000Z",
        busy: [],
      },
    });

    expect(parsed.check?.releases.map(({ notes }) => notes)).toEqual(["## What's new"]);
    expect(parsed.scheduled?.target.kind).toBe("release");
  });

  it("refuses an install kind it doesn't know", () => {
    expect(officeUpdateSchema.safeParse({ ...CHECKOUT, install: "snap" }).success).toBe(false);
  });

  it("carries a failed release update's step and a failed rollback", () => {
    const result = officeUpdateResultSchema.parse({
      outcome: "failed",
      from: "1.3.0",
      to: "1.4.0",
      failedStep: "start",
      rollbackFailed: true,
      finishedAt: "2026-11-15T10:00:00.000Z",
    });

    expect(result).toMatchObject({ failedStep: "start", rollbackFailed: true });
  });
});
