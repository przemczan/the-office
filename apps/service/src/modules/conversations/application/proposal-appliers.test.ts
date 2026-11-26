import { describe, expect, it } from "vitest";
import type { ProposedChange } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ANN_LEE } from "../domain/user.fixtures.js";
import { ProposalAppliers } from "./proposal-appliers.js";

const FROM_A_NEWER_RELEASE = { kind: "from-a-newer-release" } as unknown as ProposedChange;

describe("a Proposal of a kind this release doesn't know", () => {
  it("is read as it is, and refused when applied, with a reason", async () => {
    const appliers = new ProposalAppliers();

    expect(appliers.shown(FROM_A_NEWER_RELEASE)).toBe(FROM_A_NEWER_RELEASE);
    await expect(appliers.problemsWith(FROM_A_NEWER_RELEASE)).resolves.toEqual([
      "This release doesn't know this kind of Proposal.",
    ]);
    await expect(
      appliers.apply(FROM_A_NEWER_RELEASE, "planner", ANN_LEE, "proposal-1"),
    ).rejects.toBeInstanceOf(ProposalRefused);
  });
});
