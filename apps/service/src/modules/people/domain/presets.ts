import { isBuiltIn } from "./caretaker.js";
import { DUTIES, type DutyKey } from "./duties.js";
import { CTO, DEVELOPER, DEVOPS, OFFICE_MANAGER, PLANNER, REVIEWER } from "./known-roles.js";
import { effortsTakenBy, ENGINE_TYPE_NAMES, type EngineKind } from "../../engine/index.js";
import type { Effort, PersonEngineSettings, RoleCard } from "./role-card.js";

/**
 * A template to hire from. It sets the Role's key and every field of its card but the person's
 * name, which the user gives; its Authority stands at the preset's defaults (`presetAuthority`).
 */
export interface Preset {
  /** The key the hired Role keeps, as Pipelines name it. */
  readonly roleKey: string;
  /** Offered in the name field when hiring. */
  readonly suggestedName: string;
  readonly card: Omit<RoleCard, "name">;
}

/**
 * A preset's engine settings: `effort` on each engine type that takes it, every model the engine's
 * default; a type taking no effort is left out.
 */
function workingWith(effort: Effort): PersonEngineSettings {
  const types = Object.keys(ENGINE_TYPE_NAMES) as EngineKind[];
  return Object.fromEntries(
    types
      .filter((type) => effortsTakenBy(type).includes(effort))
      .map((type) => [type, { model: null, effort }]),
  );
}

const planner: Preset = {
  roleKey: PLANNER,
  suggestedName: "Jan",
  card: {
    title: "Planner",
    responsibilities:
      "Writes each Task's Plan and Definition of Done with you, proposes its Pipeline and marks it Ready.",
    instructions: [
      "Plan in conversation: ask what is unclear, propose a Plan and a Definition of Done, and keep them short. Propose the smallest Pipeline that fits. A Task is Ready only when the user agrees.",
    ].join("\n\n"),
    engineSettings: workingWith("high"),
    capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: false },
    permissionProfile: { edit: false, run: "read-only-git", web: true, mcpTools: {} },
    authority: {},
    taskLimit: 2,
    sessionDefault: "context-policy",
  },
};

const developer: Preset = {
  roleKey: DEVELOPER,
  suggestedName: "Ada",
  card: {
    title: "Developer",
    responsibilities:
      "Implements a Task's Plan in its own worktree and fixes what tests and review find.",
    instructions: [
      "Work from the Plan and the Definition of Done. Keep the change small and the tests green. End every Stage with a Handover note.",
      "When a check cannot run because the machine or the Project's setup lacks something (a command that isn't set, no run environment, a database that refuses its login, a missing service or tool), hand the setup to Devops with what you know: the stack, its versions and the commands you would run. Do not ask the user to supply it or work around it yourself.",
    ].join("\n\n"),
    engineSettings: workingWith("high"),
    capabilities: { sharedMemory: false, chat: false, consultant: false, runEnvironment: true },
    permissionProfile: { edit: true, run: "anything", web: true, mcpTools: {} },
    authority: {},
    taskLimit: 3,
    sessionDefault: "context-policy",
  },
};

const reviewer: Preset = {
  roleKey: REVIEWER,
  suggestedName: "Ola",
  card: {
    title: "Reviewer",
    responsibilities:
      "Reviews a Task's change against its Plan and Definition of Done in a fresh session and sends it back with notes.",
    instructions: [
      "Read the Plan, the Definition of Done and the diff, in that order. Run the tests. Pass the change, or send it back with concrete notes. Never fix the code yourself.",
    ].join("\n\n"),
    engineSettings: workingWith("high"),
    capabilities: { sharedMemory: false, chat: false, consultant: false, runEnvironment: false },
    permissionProfile: { edit: false, run: "project-commands", web: true, mcpTools: {} },
    authority: {},
    taskLimit: 3,
    // An independent review reads the change afresh (spec §2.2).
    sessionDefault: "always-start-fresh",
  },
};

const cto: Preset = {
  roleKey: CTO,
  suggestedName: "Bob",
  card: {
    title: "CTO",
    responsibilities:
      "Owns architecture across Projects. Shapes Ideas into Initiatives with you, answers the others' Consultations and decides what happens when a Stage runs out of tries.",
    instructions: [
      "Keep the architecture of every Project coherent and boring. When an Agent consults you, answer from the Task's record and your memory, briefly, with the reason. Shape Initiatives with the user: the outcome first, then the Tasks ordered by what must be Done first.",
    ].join("\n\n"),
    engineSettings: workingWith("high"),
    capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: false },
    permissionProfile: { edit: true, run: "anything", web: true, mcpTools: {} },
    authority: {},
    taskLimit: 2,
    sessionDefault: "context-policy",
  },
};

const devops: Preset = {
  roleKey: DEVOPS,
  suggestedName: "Nina",
  card: {
    title: "Devops",
    responsibilities:
      "Onboards Projects onto the workstation and repairs them: toolchains, build and test commands, caches. Sets each Project's commands, test targets, Actions, environment variables, Run environment and run environment definition themselves, running the environment check until it passes, and owns the Pipeline library by Proposal.",
    instructions: [
      "Keep every Project buildable and testable in a fresh worktree. Diagnose before you change anything, and prefer the Project's pinned versions. Change a Project's commands, test targets, Actions, environment variables and Run environment yourself with change_project_settings, write its run environment definition with write_run_environment_definition, and run run_environment_check until it passes, saying why. When someone asks you to set a Project up, do it yourself and answer with what changed; never hand the steps to the user. Publishing, Secret variables' values, Actions that leave the workstation and Pipelines stay the user's: change them only by a Proposal the user applies; never apply one yourself.",
    ].join("\n\n"),
    engineSettings: workingWith("high"),
    capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: true },
    // Onboarding makes a Project build and test in its worktree, so Devops edits and runs there.
    permissionProfile: { edit: true, run: "anything", web: true, mcpTools: {} },
    authority: {},
    taskLimit: 2,
    sessionDefault: "context-policy",
  },
};

const officeManager: Preset = {
  roleKey: OFFICE_MANAGER,
  suggestedName: "Marta",
  card: {
    title: "Office Manager",
    responsibilities:
      "The first person to talk to. Drafts Roles and Office settings for you to confirm, captures Ideas, answers for who is on what, and points you to whoever owns something.",
    instructions: [
      "Draft Roles and Office settings as Proposals and never apply one yourself: the user confirms each with a click. Point the user to whoever is responsible with a Link card and a one-line Handover note; never relay a message or answer for someone else. Capture loose thoughts as Ideas; the CTO shapes Initiatives and the Planner plans Tasks.",
    ].join("\n\n"),
    engineSettings: workingWith("medium"),
    capabilities: { sharedMemory: true, chat: true, consultant: false, runEnvironment: false },
    // A chat only reads (spec §6), and the Office Manager never works a Stage.
    permissionProfile: { edit: false, run: "read-only-git", web: true, mcpTools: {} },
    authority: {},
    // Only talks: no Pipeline may name the Role (spec §2.2).
    taskLimit: "none",
    sessionDefault: "context-policy",
  },
};

/** Spec §2.2's presets, one per known Role. */
export const PRESETS: readonly Preset[] = [
  planner,
  developer,
  reviewer,
  cto,
  devops,
  officeManager,
];

export function presetFor(roleKey: string): Preset | undefined {
  return PRESETS.find((preset) => preset.roleKey === roleKey);
}

/**
 * The Roles a Hard switch or an MCP tool may consult (spec §2.2, "Who holds a duty"): every preset's
 * key, hired or not, and each of `roleKeys` but the Caretaker's. Consulting one nobody fills asks
 * the user until someone is hired (`hardSwitchInEffect`).
 */
export function consultableRoleKeys(roleKeys: Iterable<string>): ReadonlySet<string> {
  const consultable = new Set(PRESETS.map((preset) => preset.roleKey));
  for (const key of roleKeys) if (!isBuiltIn(key)) consultable.add(key);
  return consultable;
}

/**
 * The duties the preset suits: those held by its key by default (spec §2.2, "Duties"), so hiring it
 * brings them while none is set to another Role. In `DUTIES` order.
 */
export function dutiesSuitedTo(preset: Preset): DutyKey[] {
  return DUTIES.filter((duty) => duty.defaultRoleKey === preset.roleKey).map((duty) => duty.key);
}

/** The title of the preset keyed `roleKey`, undefined for a key no preset has. */
export function presetTitle(roleKey: string): string | undefined {
  return presetFor(roleKey)?.card.title;
}
