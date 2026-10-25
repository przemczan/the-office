import { consult, NEVER } from "./hard-switches.js";
import type { RoleCard } from "./role-card.js";

/**
 * A template to hire from. It sets the Role's key and every field of its card but the person's
 * name, which the user gives; the switches are as in spec §2.2, §6 and §9.
 */
export interface Preset {
  /** The key the hired Role keeps, as Pipelines name it. */
  readonly roleKey: string;
  /** Offered in the name field when hiring. */
  readonly suggestedName: string;
  readonly card: Omit<RoleCard, "name">;
}

const planner: Preset = {
  roleKey: "planner",
  suggestedName: "Jan",
  card: {
    title: "Planner",
    description:
      "Writes each Task's Plan and Definition of Done with you, proposes its Pipeline and marks it Ready.",
    instructions: [
      "Plan in conversation: ask what is unclear, propose a Plan and a Definition of Done, and keep them short. Propose the smallest Pipeline that fits. A Task is Ready only when the user agrees.",
      "Decide alone: drafting a Plan and a Definition of Done, proposing a Pipeline from the library.",
      "Consult the CTO first: a Plan that touches architecture.",
      "Ask the user: marking a Task Ready, splitting a Task in two.",
    ].join("\n\n"),
    engine: "agent-sdk",
    model: "claude-opus-5-5",
    effort: "high",
    // The preset keeps shared memory, which stays off until tier 2 gives it a form.
    capabilities: { sharedMemory: false, chat: true, consultant: true },
    permissionProfile: { edit: false, run: "read-only-git", web: true },
    hardSwitches: {
      runInstalls: consult("devops"),
      publishOutsideThePipeline: NEVER,
      changeRoles: NEVER,
    },
    taskLimit: 2,
    sessionDefault: "context-policy",
  },
};

const developer: Preset = {
  roleKey: "developer",
  suggestedName: "Ada",
  card: {
    title: "Developer",
    description:
      "Implements a Task's Plan in its own worktree and fixes what tests and review find.",
    instructions: [
      "Work from the Plan and the Definition of Done. Keep the change small and the tests green. End every Stage with a Handover note.",
      "Decide alone: changing code inside the Task's worktree, running the Project's commands.",
      "Consult the CTO first: an architecture question the Plan leaves open.",
      "Ask the user: changing the Definition of Done or a public API.",
    ].join("\n\n"),
    engine: "agent-sdk",
    model: "claude-opus-5-5",
    effort: "high",
    capabilities: { sharedMemory: false, chat: false, consultant: false },
    permissionProfile: { edit: true, run: "anything", web: true },
    hardSwitches: {
      runInstalls: consult("devops"),
      publishOutsideThePipeline: consult("cto"),
      changeRoles: NEVER,
    },
    taskLimit: 3,
    sessionDefault: "context-policy",
  },
};

const reviewer: Preset = {
  roleKey: "reviewer",
  suggestedName: "Ola",
  card: {
    title: "Reviewer",
    description:
      "Reviews a Task's change against its Plan and Definition of Done in a fresh session and sends it back with notes.",
    instructions: [
      "Read the Plan, the Definition of Done and the diff, in that order. Run the tests. Pass the change, or send it back with concrete notes. Never fix the code yourself.",
      "Decide alone: commenting on the change, running the tests.",
      "Consult the CTO first: a finding about architecture.",
      "Ask the user: sending a change back a third time.",
    ].join("\n\n"),
    engine: "agent-sdk",
    model: "claude-sonnet-5-5",
    effort: "high",
    capabilities: { sharedMemory: false, chat: false, consultant: false },
    permissionProfile: { edit: false, run: "project-commands", web: true },
    hardSwitches: {
      runInstalls: consult("devops"),
      publishOutsideThePipeline: NEVER,
      changeRoles: NEVER,
    },
    taskLimit: 3,
    // An independent review reads the change afresh (spec §2.2).
    sessionDefault: "always-start-fresh",
  },
};

/** Tier 1's presets; the CTO's, Devops' and the Office Manager's come with tier 2. */
export const PRESETS: readonly Preset[] = [planner, developer, reviewer];

export function presetFor(roleKey: string): Preset | undefined {
  return PRESETS.find((preset) => preset.roleKey === roleKey);
}
