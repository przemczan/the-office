import type { RoleCard, RoleCardOptions } from "@the-office/contracts";

/**
 * The card a Role hired from scratch starts from: the most cautious choices, so the user widens
 * what the person may do instead of narrowing it. It runs on the Office default.
 */
export function blankRoleCard({ taskLimits }: RoleCardOptions): RoleCard {
  return {
    name: "",
    title: "",
    responsibilities: "",
    instructions: "",
    roleOverride: null,
    effort: "medium",
    capabilities: { sharedMemory: false, chat: true, consultant: false },
    permissionProfile: { edit: false, run: "read-only-git", web: false, mcpTools: {} },
    hardSwitches: {
      runInstalls: { kind: "ask-me" },
      publishOutsideThePipeline: { kind: "ask-me" },
      changeRoles: { kind: "never" },
    },
    taskLimit: taskLimits.lowest,
    sessionDefault: "context-policy",
    skills: [],
  };
}
