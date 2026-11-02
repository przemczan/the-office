import type { RoleCard } from "../../people/index.js";
import type { Proposal } from "./proposal.js";

/** A Tester's card, as the Office Manager would propose one. */
export function aProposedCard(fields: Partial<RoleCard> = {}): RoleCard {
  return {
    name: "Tess",
    title: "Tester",
    responsibilities: "Tests each change before it is published.",
    instructions: "Run the tests and try the change as the user would.",
    roleOverride: null,
    effort: "medium",
    capabilities: { sharedMemory: false, chat: true, consultant: false },
    permissionProfile: { edit: false, run: "read-only-git", web: false, mcpTools: {} },
    hardSwitches: {
      runInstalls: { kind: "never" },
      publishOutsideThePipeline: { kind: "never" },
      changeRoles: { kind: "never" },
    },
    taskLimit: 1,
    sessionDefault: "context-policy",
    ...fields,
  };
}

/** An open Proposal of a new Tester, drafted by the Office Manager in a chat. */
export function aProposal(fields: Partial<Proposal> = {}): Proposal {
  return {
    id: "3a7c2e10-5b4d-4f6a-8c9e-0d1f2a3b4c5d",
    threadId: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    draftedBy: "office-manager",
    draftedAt: new Date("2026-10-27T09:00:00.000Z"),
    change: { kind: "hire", card: aProposedCard(), skills: [], roleKey: undefined },
    status: { kind: "open" },
    ...fields,
  };
}
