import type { SessionRole } from "../../people/index.js";

/** The Planner's card, as its preset has it, named Jan. */
export function aPlannerCard(fields: Partial<SessionRole["card"]> = {}): SessionRole["card"] {
  return {
    name: "Jan",
    title: "Planner",
    responsibilities: "Writes each Task's Plan and Definition of Done with you.",
    instructions: "Plan in conversation: ask what is unclear.",
    roleOverride: null,
    effort: "high",
    capabilities: { sharedMemory: false, chat: true, consultant: true },
    permissionProfile: { edit: false, run: "read-only-git", web: true, mcpTools: {} },
    hardSwitches: {
      runInstalls: { kind: "consult", role: "devops" },
      publishOutsideThePipeline: { kind: "never" },
      changeRoles: { kind: "never" },
    },
    taskLimit: 2,
    sessionDefault: "context-policy",
    ...fields,
  };
}
