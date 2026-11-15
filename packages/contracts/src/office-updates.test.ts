import { describe, expect, it } from "vitest";
import { officeUpdateSchema } from "./office-updates.js";

const CHECKOUT = {
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
