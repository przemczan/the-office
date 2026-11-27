import { describe, expect, it } from "vitest";
import { changeToApply, proposalTargets } from "./proposal.js";
import { aProposal, aProposedCard } from "./proposal.fixtures.js";
import { declineProposal } from "./proposal-changes.js";
import { ProposalRefused } from "./proposal-refused.js";
import { aThread } from "./thread.fixtures.js";
import { ANN_LEE } from "./user.fixtures.js";

const AT = new Date("2026-10-27T10:00:00.000Z");
const thread = aThread({
  home: { kind: "chat", roleKey: "office-manager" },
  roleKey: "office-manager",
});

const proposed = (action: string, input: Record<string, unknown>) =>
  aProposal({
    change: {
      kind: "office-action",
      action,
      title: action,
      input,
      subject: { kind: "role", id: "developer", title: "Ada" },
      fields: [],
      fingerprint: "abc",
      outOfDate: false,
    },
  });

describe("applying a Proposal", () => {
  it("applies it as drafted, or a new Role as the user edited it", () => {
    const edited = {
      kind: "hire",
      card: aProposedCard({ name: "Tom" }),
      skills: ["playwright"],
    } as const;

    expect(changeToApply(aProposal(), undefined)).toEqual(aProposal().change);
    expect(changeToApply(aProposal(), edited)).toEqual({
      kind: "hire",
      card: edited.card,
      skills: ["playwright"],
      roleKey: undefined,
    });
  });

  it("applies a hire_role or change_role_card Proposal with the card the user edited", () => {
    const card = aProposedCard({ name: "Tom" });
    const edited = { kind: "hire", card, skills: ["playwright"] } as const;
    const hired = proposed("hire_role", {
      card: { name: "Ada", hardSwitches: { runInstalls: "never" } },
    });
    expect(changeToApply(hired, edited)).toMatchObject({
      editedInput: {
        card: { ...card, skills: ["playwright"], hardSwitches: { runInstalls: "never" } },
      },
    });
    const changed = proposed("change_role_card", {
      key: "developer",
      name: "Ada",
      hardSwitches: { runInstalls: "never" },
    });
    expect(changeToApply(changed, edited)).toMatchObject({
      editedInput: {
        ...card,
        skills: ["playwright"],
        hardSwitches: { runInstalls: "never" },
        key: "developer",
      },
    });
    expect(() => changeToApply(proposed("change_task_title", { title: "x" }), edited)).toThrow(
      ProposalRefused,
    );
    expect(() =>
      changeToApply(proposed("hire_role", { roleKey: "qa", name: "Q" }), edited),
    ).toThrow(ProposalRefused);
  });

  it("refuses once it is applied or declined", () => {
    const applied = aProposal({ status: { kind: "applied", at: AT, by: ANN_LEE } });
    const declined = aProposal({ status: { kind: "declined", at: AT, by: ANN_LEE } });

    expect(() => changeToApply(applied, undefined)).toThrow("This Proposal is applied already.");
    expect(() => changeToApply(declined, undefined)).toThrow("This Proposal was declined.");
    expect(() => declineProposal(applied, thread, AT, ANN_LEE)).toThrow(ProposalRefused);
  });
});

describe("what a Proposal changes", () => {
  const officeAction = {
    kind: "office-action",
    action: "change_task_title",
    title: "Change a Task's title",
    input: { taskId: "task-1", title: "New" },
    subject: { kind: "task", id: "task-1", title: "Old" },
    fields: [],
    fingerprint: "abc",
    outOfDate: false,
  } as const;

  it("is the subject of an Office action, so two Proposals on it change the same", () => {
    expect(proposalTargets(officeAction)).toEqual(["office-action:task:task-1"]);
  });

  it("is nothing for a kind this release doesn't know", () => {
    expect(proposalTargets({ kind: "from-a-newer-release" } as never)).toEqual([]);
  });
});
