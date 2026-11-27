import { describe, expect, it } from "vitest";
import type { Proposal } from "../../domain/proposal.js";
import { draftsTestTargetsOf } from "./projects-test-targets-chat-registration.js";

function officeAction(action: string, projectId: string, labels: string[]): Proposal["change"] {
  return {
    kind: "office-action",
    action,
    title: "Change settings",
    input: {},
    subject: { kind: "project", id: projectId, title: "P" },
    fields: labels.map((label) => ({ label, before: null, after: "x", form: "short" as const })),
    fingerprint: "f",
    outOfDate: false,
  };
}

describe("draftsTestTargetsOf", () => {
  it("counts a change_project_settings Proposal of the Project with a Test targets field", () => {
    expect(
      draftsTestTargetsOf(officeAction("change_project_settings", "p1", ["Test targets"]), "p1"),
    ).toBe(true);
  });

  it("ignores another Project, another action and a Proposal without that field", () => {
    expect(
      draftsTestTargetsOf(officeAction("change_project_settings", "p2", ["Test targets"]), "p1"),
    ).toBe(false);
    expect(
      draftsTestTargetsOf(officeAction("change_server_values", "p1", ["Test targets"]), "p1"),
    ).toBe(false);
    expect(
      draftsTestTargetsOf(officeAction("change_project_settings", "p1", ["Actions"]), "p1"),
    ).toBe(false);
  });
});
