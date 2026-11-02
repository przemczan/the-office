import type { RoleCard, RoleCardOptions } from "@the-office/contracts";

/**
 * The card a Role hired from scratch starts from: the most cautious choices, so the user widens
 * what the person may do instead of narrowing it. The first engine and its first model do the work.
 */
export function blankRoleCard({ engines, taskLimits }: RoleCardOptions): RoleCard {
  const [offered] = engines;
  const [model] = offered?.models ?? [];
  if (!offered || !model) throw new Error("The service offers no engine to work with.");
  return {
    name: "",
    title: "",
    responsibilities: "",
    instructions: "",
    engine: offered.engine,
    model,
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
