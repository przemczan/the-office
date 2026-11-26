import type { RoleCardOptions, SavedRoleCard } from "@the-office/contracts";

/**
 * The card a Role hired from scratch starts from: the most cautious choices, so the user widens
 * what the person may do instead of narrowing it. It works with each engine's default model and
 * effort, and every Authority row stands at from scratch's default (`fromScratchAuthority`).
 */
export function blankRoleCard({ taskLimits }: RoleCardOptions): SavedRoleCard {
  return {
    name: "",
    title: "",
    responsibilities: "",
    instructions: "",
    engineSettings: {},
    capabilities: { sharedMemory: false, chat: true, consultant: false, runEnvironment: false },
    permissionProfile: { edit: false, run: "read-only-git", web: false, mcpTools: {} },
    hardSwitches: {
      runInstalls: { kind: "ask-me" },
      publishOutsideThePipeline: { kind: "ask-me" },
      changeRoles: { kind: "never" },
      changeProjectSettings: { kind: "ask-me" },
    },
    authority: {},
    taskLimit: taskLimits.lowest,
    sessionDefault: "context-policy",
    skills: [],
  };
}
