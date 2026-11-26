import type { SessionRole } from "../../people/index.js";

/** The Planner's card, as its preset has it, named Jan. */
export function aPlannerCard(fields: Partial<SessionRole["card"]> = {}): SessionRole["card"] {
  return {
    name: "Jan",
    title: "Planner",
    responsibilities: "Writes each Task's Plan and Definition of Done with you.",
    instructions: "Plan in conversation: ask what is unclear.",
    engineSettings: {},
    capabilities: { sharedMemory: false, chat: true, consultant: true, runEnvironment: false },
    permissionProfile: { edit: false, run: "read-only-git", web: true, mcpTools: {} },
    // Set, as tests give the card under keys of their own, whose other rows are from scratch's.
    authority: {
      runInstalls: { kind: "consult", role: "devops" },
      publishOutsideThePipeline: { kind: "never" },
      changeRoles: { kind: "never" },
      changeProjectSettings: { kind: "never" },
    },
    taskLimit: 2,
    sessionDefault: "context-policy",
    ...fields,
  };
}
