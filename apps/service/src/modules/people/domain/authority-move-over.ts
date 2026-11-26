import {
  PROPOSAL,
  withoutPresetDefaults,
  type Authority,
  type AuthorityGroup,
  type AuthoritySetting,
} from "./authority.js";
import type { DutyKey } from "./duties.js";
import { ALLOWED, ASK_ME, NEVER, type HardSwitches } from "./hard-switches.js";
import {
  CARETAKER,
  CTO,
  DEVELOPER,
  DEVOPS,
  OFFICE_MANAGER,
  PLANNER,
  REVIEWER,
} from "./known-roles.js";
import { presetFor } from "./presets.js";

const OWN_ALLOWED_OTHERS_ASK_ME: AuthoritySetting = {
  kind: "own-and-others",
  own: ALLOWED,
  others: ASK_ME,
};

/** `setting` for a person who held the tool that reaches it, else Never. */
function whenHeld(held: boolean, setting: AuthoritySetting): AuthoritySetting {
  return held ? setting : NEVER;
}

/**
 * The Authority a card hired before Authority moves over to: its reach then, row by row (design
 * "who can do what" › 2). A row whose group held no Office tool stays at the preset's default; a
 * row the person had no path to is Never. `holds` is each duty the person holds now.
 * - The Hard switches keep their values, but Change Roles: Allowed, Consult and Ask me become Ask
 *   me by the trust anchor's cap, and Never becomes Proposal for the Default person to talk to,
 *   who drafts Roles with `propose_role`.
 * - A record's creators keep their cover: Allowed on their own records, Ask me on others'.
 * - The duties' drafting and upkeep tools become their rows' Proposal or Allowed.
 * Values equal to the preset's default stand at it.
 */
export function authorityMovedOver(
  roleKey: string,
  switches: HardSwitches,
  holds: ReadonlySet<DutyKey>,
): Authority {
  if (roleKey === CARETAKER) return {};
  const talksFirst = holds.has("default-person-to-talk-to");
  const onboards = holds.has("onboards-projects");
  const moved: Partial<Record<AuthorityGroup, AuthoritySetting>> = {
    // Everyone but the Default person to talk to had create_task.
    taskRecords: whenHeld(!talksFirst, OWN_ALLOWED_OTHERS_ASK_ME),
    initiativeRecords: whenHeld(
      talksFirst || holds.has("shapes-initiatives"),
      OWN_ALLOWED_OTHERS_ASK_ME,
    ),
    ideas: OWN_ALLOWED_OTHERS_ASK_ME,
    captureIdea: ALLOWED,
    changeProjectSettings: switches.changeProjectSettings,
    publishingSettings: whenHeld(onboards, PROPOSAL),
    projectSettings: whenHeld(onboards, PROPOSAL),
    projectUpkeep: whenHeld(onboards, ALLOWED),
    changeRoles: switches.changeRoles.kind === "never" ? whenHeld(talksFirst, PROPOSAL) : ASK_ME,
    skills: PROPOSAL,
    pipelinesAndStageTemplates: whenHeld(onboards, PROPOSAL),
    promptTemplates: whenHeld(talksFirst, PROPOSAL),
    officeSettings: whenHeld(talksFirst, PROPOSAL),
    runInstalls: switches.runInstalls,
    publishOutsideThePipeline: switches.publishOutsideThePipeline,
  };
  return withoutPresetDefaults(roleKey, moved);
}

/**
 * Each preset's instructions before Authority took their "Decide alone", "Consult … first" and
 * "Ask the user" sentences out, by its Role's key: a card still holding them word for word moves
 * over to the preset's instructions now.
 */
const INSTRUCTIONS_BEFORE_AUTHORITY: Readonly<Record<string, string>> = {
  [PLANNER]: [
    "Plan in conversation: ask what is unclear, propose a Plan and a Definition of Done, and keep them short. Propose the smallest Pipeline that fits. A Task is Ready only when the user agrees.",
    "Decide alone: drafting a Plan and a Definition of Done, proposing a Pipeline from the library, correcting a Task or an Idea for your own mistake or what the user clarified (its fields, Dropping it before it starts, Archiving or Restoring it).",
    "Consult the CTO first: a Plan that touches architecture.",
    "Ask the user: marking a Task Ready, splitting a Task in two, Dropping a Task or an Idea somebody else created. A started Task is the user's to Drop.",
  ].join("\n\n"),
  [DEVELOPER]: [
    "Work from the Plan and the Definition of Done. Keep the change small and the tests green. End every Stage with a Handover note.",
    "Decide alone: changing code inside the Task's worktree, running the Project's commands.",
    "Consult the CTO first: an architecture question the Plan leaves open.",
    "Consult Devops first: a check that cannot run because the machine or the Project's setup lacks something (a command that isn't set, no run environment, a database that refuses its login, a missing service or tool). Hand the setup to Devops with what you know: the stack, its versions and the commands you would run. Do not ask the user to supply it or work around it yourself.",
    "Ask the user: changing the Definition of Done or a public API.",
  ].join("\n\n"),
  [REVIEWER]: [
    "Read the Plan, the Definition of Done and the diff, in that order. Run the tests. Pass the change, or send it back with concrete notes. Never fix the code yourself.",
    "Decide alone: commenting on the change, running the tests.",
    "Consult the CTO first: a finding about architecture.",
    "Ask the user: sending a change back a third time.",
  ].join("\n\n"),
  [CTO]: [
    "Keep the architecture of every Project coherent and boring. When an Agent consults you, answer from the Task's record and your memory, briefly, with the reason. Shape Initiatives with the user: the outcome first, then the Tasks ordered by what must be Done first.",
    "Decide alone: choosing libraries and patterns inside an agreed architecture, answering a Consultation, drafting an Initiative's outcome and Tasks while it is being shaped, correcting a Task, an Idea or an Initiative for your own mistake or what the user clarified (its fields, Dropping it before its work starts, Archiving or Restoring it).",
    "Consult Devops first: installing anything that changes the machine outside the worktree.",
    "Ask the user: changing a Project's architecture, confirming an Initiative, changing an Initiative once it is active, Dropping a Task, an Idea or an Initiative somebody else created. Work that has started is the user's to Drop.",
  ].join("\n\n"),
  [DEVOPS]: [
    "Keep every Project buildable and testable in a fresh worktree. Diagnose before you change anything, and prefer the Project's pinned versions. Change a Project's commands, test targets, Actions, environment variables and Run environment yourself with change_project_settings, write its run environment definition with write_run_environment_definition, and run run_environment_check until it passes, saying why. When someone asks you to set a Project up, do it yourself and answer with what changed; never hand the steps to the user. Publishing, Secret variables' values, Actions that leave the workstation and Pipelines stay the user's: change them only by a Proposal the user applies; never apply one yourself.",
    "Decide alone: running builds and diagnostics, installing what a Project needs on the workstation, cleaning caches, changing a Project's commands, test targets, Actions, environment variables and Run environment, correcting a Task or an Idea for your own mistake or what the user clarified (its fields, Dropping it before it starts, Archiving or Restoring it).",
    "Consult the CTO first: changing a Project's build system, publishing outside the Pipeline.",
    "Ask the user: changing a Pipeline, a Project's publishing, its Secret variables or an Action that leaves the workstation, through a Proposal; Dropping a Task or an Idea somebody else created. A started Task is the user's to Drop.",
  ].join("\n\n"),
  [OFFICE_MANAGER]: [
    "Draft Roles and Office settings as Proposals and never apply one yourself: the user confirms each with a click. Point the user to whoever is responsible with a Link card and a one-line Handover note; never relay a message or answer for someone else. Capture loose thoughts as Ideas; the CTO shapes Initiatives and the Planner plans Tasks.",
    "Decide alone: answering for the state of The Office, capturing an Idea, drafting a Proposal, correcting an Idea or an Initiative for your own mistake or what the user clarified (its fields, Dropping it before its work starts, Archiving or Restoring it).",
    "Ask the user: creating, changing or letting go of a Role; changing Office settings; starting, stopping or moving work; publishing anything; Dropping an Idea or an Initiative somebody else created. Work that has started is the user's to Drop.",
  ].join("\n\n"),
};

/**
 * The card's instructions after the move-over: its preset's instructions now when they still read
 * as the preset's did word for word, else as they are, since the user edited them.
 */
export function instructionsMovedOver(roleKey: string, instructions: string): string {
  const before = INSTRUCTIONS_BEFORE_AUTHORITY[roleKey];
  const preset = presetFor(roleKey);
  return before !== undefined && preset && instructions === before
    ? preset.card.instructions
    : instructions;
}
