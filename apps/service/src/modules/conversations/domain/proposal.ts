import { isDeepStrictEqual } from "node:util";
import {
  authorityWithHardSwitches,
  type Authority,
  type DutyKey,
  type HardSwitches,
  type RoleCard,
  type SetUpDuty,
  type SetUpHire,
} from "../../people/index.js";
import type {
  NewProject,
  ProjectFeatureSwitches,
  ProposedActions,
  ProposedCommands,
  ProposedTestTargets,
} from "../../projects/index.js";
import type { OfficeToolChangedField } from "../../engine/index.js";
import type { PinnedVersion } from "../../skills/index.js";
import { ProposalRefused } from "./proposal-refused.js";
import type { UserRef } from "./user.js";

/**
 * What a Proposal can change, by kind; the module that owns each kind applies it. A kind of change
 * joins here with its applier, so a Proposal can change anything the user confirms.
 */
export interface ProposedChanges {
  readonly hire: ProposedHire;
  readonly "hire-from-preset": ProposedPresetHire;
  readonly change: ProposedRoleChange;
  readonly "office-wide-limit": ProposedSettingChange<"office-wide-limit">;
  readonly "size-threshold": ProposedSettingChange<"size-threshold">;
  readonly "office-instructions": ProposedSettingChange<"office-instructions">;
  readonly duties: ProposedSettingChange<"duties">;
  readonly "prompt-template": ProposedPromptTemplateChange;
  readonly "office-setup": ProposedOfficeSetup;
  readonly initiative: ProposedInitiativeChange;
  readonly "project-commands": ProposedProjectCommands;
  readonly "test-targets": ProposedTestTargetsChange;
  readonly actions: ProposedActionsChange;
  readonly pipeline: ProposedPipelineChange;
  readonly "stage-template": ProposedStageTemplateChange;
  readonly "project-pipeline": ProposedProjectPipelineChange;
  readonly project: ProposedProject;
  readonly "skill-install": ProposedSkillInstall;
  readonly "skill-update": ProposedSkillUpdate;
  readonly skill: ProposedSkill;
  readonly "office-action": ProposedOfficeAction;
}

/** The kinds of change a Proposal can carry. */
export type ProposedChangeKind = keyof ProposedChanges;

/** What a Proposal changes. */
export type ProposedChange = ProposedChanges[ProposedChangeKind];

/** The fields of a Role card a change rewrites, each one given whole. */
export type RoleCardFields = Partial<RoleCard>;

/**
 * A card's fields as a contract or an Agent gives them: with an Authority, or, from an earlier
 * release or an open Proposal's draft, only the Hard switches, its four named groups.
 */
export type IncomingCardFields = Omit<RoleCardFields, "authority"> & {
  readonly authority?: Authority | undefined;
  readonly hardSwitches?: Partial<HardSwitches> | undefined;
};

/**
 * The fields of the Role keyed `roleKey` as the domain reads them: the Authority given, else one
 * made from the Hard switches given over `base` (the Role's Authority now on a change, none on a
 * hire); with neither, no Authority field.
 */
export function fieldsWithAuthority(
  roleKey: string,
  { hardSwitches, authority, ...fields }: IncomingCardFields,
  base: Authority,
): RoleCardFields {
  if (authority !== undefined) return { ...fields, authority };
  if (hardSwitches === undefined) return fields;
  return { ...fields, authority: authorityWithHardSwitches(roleKey, base, hardSwitches) };
}

/** A new Role: its whole card and the library skills it has besides the skills for everyone. */
export interface ProposedHire {
  readonly kind: "hire";
  readonly card: RoleCard;
  readonly skills: readonly string[];
  /** The Role the person was hired into, once the user applied it; undefined before. */
  readonly roleKey: string | undefined;
}

/** A person hired into a preset's Role, on the preset's card under the name given. */
export interface ProposedPresetHire {
  readonly kind: "hire-from-preset";
  /** The preset's key, which the Role keeps. */
  readonly roleKey: string;
  readonly name: string;
}

/**
 * A change to a hired Role's card: the fields it rewrites as the card had them when the Proposal
 * was drafted (`from`), and as proposed (`to`). Applying rewrites only those fields on the card as
 * it is then.
 */
export interface ProposedRoleChange {
  readonly kind: "change";
  readonly roleKey: string;
  readonly from: RoleCardFields;
  readonly to: RoleCardFields;
}

/**
 * The Caretaker's set-up of The Office (spec §2.2, "Setting up an Office with nobody hired"): people
 * to hire, from presets or from scratch, and the duties that go to another Role than their default,
 * each with the Role key it named when drafted (`from`). A duty may name a Role a hire of the same
 * Proposal fills. People applies it all or none.
 */
export interface ProposedOfficeSetup {
  readonly kind: "office-setup";
  readonly hires: readonly SetUpHire[];
  readonly duties: readonly SetUpDuty[];
  /** The keys of the Roles hired, in the order of `hires`, once the user applied it; undefined before. */
  readonly hiredKeys: readonly string[] | undefined;
}

/** The value each Office setting holds. */
export interface OfficeSettingValues {
  readonly "office-wide-limit": number;
  readonly "size-threshold": number;
  readonly "office-instructions": string;
  /**
   * Duties by key, each to the key of the Role it names or null for none. A Proposal's `from` and
   * `to` name only the duties that change; the value now names every duty.
   */
  readonly duties: DutyHolders;
}

/** Duties by key, each to the key of a Role or null for none; a duty left out is not named. */
export type DutyHolders = Readonly<Partial<Record<DutyKey, string | null>>>;

export type OfficeSetting = keyof OfficeSettingValues;

/**
 * A new value for an Office setting (`to`), and its value when the Proposal was drafted (`from`).
 */
export type ProposedSettingChange<Setting extends OfficeSetting = OfficeSetting> = {
  readonly [Kind in Setting]: {
    readonly kind: Kind;
    readonly from: OfficeSettingValues[Kind];
    readonly to: OfficeSettingValues[Kind];
  };
}[Setting];

/**
 * A new text for a prompt template (spec §2.2), given whole (`to`), or its reset to the default
 * (`to` null), with its text when drafted, saved or the default (`from`); Prompt templates refuses
 * to apply it once that text changed. `name` keeps what the card and the Thread's history call it.
 */
export interface ProposedPromptTemplateChange {
  readonly kind: "prompt-template";
  readonly key: string;
  readonly name: string;
  readonly from: string;
  readonly to: string | null;
}

/**
 * A change whoever shapes Initiatives wants to an active Initiative (spec §2.1 Defaults), which
 * Work applies under the Initiative's hold, refusing it once the Initiative is done or dropped.
 */
export interface ProposedInitiativeChange {
  readonly kind: "initiative";
  readonly initiativeId: string;
  readonly edit: InitiativeEdit;
}

/**
 * What a Proposal changes on an Initiative: its outcome, a new Task, or the title, Description or a
 * dependency of its Task.
 */
export type InitiativeEdit =
  | { readonly kind: "outcome"; readonly outcome: string }
  | {
      readonly kind: "add-task";
      readonly title: string;
      readonly projectId: string;
      readonly priority: "high" | "normal" | "low";
      /** Undefined when none was given, as in every Proposal from before it could have one. */
      readonly description?: string | undefined;
      /** The Tasks it waits for from the start. */
      readonly blockedBy: readonly string[];
      /** The Task added, once the user applied it; undefined before. */
      readonly taskId: string | undefined;
    }
  | { readonly kind: "add-dependency"; readonly taskId: string; readonly blockerId: string }
  | { readonly kind: "remove-dependency"; readonly taskId: string; readonly blockerId: string }
  | { readonly kind: "task-title"; readonly taskId: string; readonly title: string }
  | { readonly kind: "task-description"; readonly taskId: string; readonly description: string }
  /** Another Pipeline as the Initiative's Pipeline in one Project it spans; null for None. */
  | {
      readonly kind: "pipeline";
      readonly projectId: string;
      readonly pipelineId: string | null;
    };

/**
 * A change, by whoever onboards Projects, to a Project's install command, install inputs and
 * commands (spec §2.3): each field as the Project had it when drafted, and as proposed. Projects
 * refuses to apply it once one of them changed.
 */
export interface ProposedProjectCommands {
  readonly kind: "project-commands";
  readonly projectId: string;
  readonly changes: ProposedCommands;
}

/**
 * A change, by whoever onboards Projects, to a Project's test targets (spec §2.12, "Writing test
 * targets"): each target it adds, changes or removes as the Project had it when drafted and as
 * proposed. Projects refuses to apply it once one of them changed.
 */
export interface ProposedTestTargetsChange {
  readonly kind: "test-targets";
  readonly projectId: string;
  readonly changes: ProposedTestTargets;
}

/**
 * A change, by whoever onboards Projects, to a Project's Actions (spec §2.15, "Defining Actions"):
 * each Action it adds, changes or removes as the Project had it when drafted and as proposed.
 * Projects refuses to apply it once one of them changed, or when it clears Leaves the workstation.
 */
export interface ProposedActionsChange {
  readonly kind: "actions";
  readonly projectId: string;
  readonly changes: ProposedActions;
}

/**
 * New Stages, by whoever onboards Projects, for a library Pipeline (spec §2.3), and its Stages when
 * drafted (`from`); Pipelines refuses to apply it once they changed. Conversations keeps the Stages
 * as Pipelines gave them, without reading them, since Pipelines calls Conversations.
 */
export interface ProposedPipelineChange {
  readonly kind: "pipeline";
  readonly pipelineId: string;
  readonly from: readonly PipelineStage[];
  readonly to: readonly PipelineStage[];
  /** Where it puts End on the canvas, as Pipelines gave it; undefined keeps where End stands. */
  readonly endPosition?: PipelineEndPosition;
  /** Undefined on a Proposal drafted before Proposals carried routes. */
  readonly routes?: PipelineRoutes;
}

/** Where a Proposal puts a Pipeline's End on the flow editor's canvas, in canvas units. */
export interface PipelineEndPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * A new Stage, by whoever onboards Projects, for a Stage template (spec §2.3), and its Stage when
 * drafted (`from`); Pipelines refuses to apply it once it changed. Kept unread, as a Pipeline's
 * Stages are.
 */
export interface ProposedStageTemplateChange {
  readonly kind: "stage-template";
  readonly templateId: string;
  readonly from: PipelineStage;
  readonly to: PipelineStage;
}

/**
 * A new Project Pipeline by whoever onboards Projects, or their change to one (spec §2.3): the
 * fields as the Project Pipeline had them when drafted (`from`, null for a new one), and as
 * proposed (`to`). Pipelines refuses to apply it once one of them changed; a Proposal never removes
 * one or sets a Project's default.
 */
export interface ProposedProjectPipelineChange {
  readonly kind: "project-pipeline";
  readonly projectId: string;
  /** The Project Pipeline it changes; null for a new one until the user applied it. */
  readonly pipelineId: string | null;
  readonly from: ProjectPipelineFields | null;
  readonly to: ProjectPipelineFields;
  /** Undefined on a Proposal drafted before Proposals carried routes. */
  readonly routes?: PipelineRoutes;
}

/**
 * What a Proposal of a Project Pipeline gives it: its whole flow, kept unread as a Pipeline's Stages
 * are, and for a new one the Pipeline it is copied from, by id. A Proposal drafted before Project
 * Pipelines held their own flow kept a base Pipeline and Stage changes instead; Pipelines refuses it.
 */
export interface ProjectPipelineFields {
  readonly name: string;
  readonly description: string;
  readonly stages: readonly PipelineStage[];
  readonly endPosition?: PipelineEndPosition;
  readonly copyOf?: string;
}

/** A feature switch proposed for a Project to onboard (spec §2.1.1): on or off, and why. */
export interface ProposedFeatureSwitch {
  readonly on: boolean;
  readonly reason: string;
}

/** The proposed switches by feature, only those proposed; Run environment is asked apart. */
export type ProposedFeatureSwitches = Readonly<
  Partial<Record<keyof ProjectFeatureSwitches, ProposedFeatureSwitch>>
>;

/**
 * A Project whoever onboards Projects drafted to onboard (spec §2.1 Defaults): applying it adds the
 * Project and its Onboard Task on the Onboard Pipeline, started at once.
 */
export interface ProposedProject {
  readonly kind: "project";
  readonly project: NewProject;
  /**
   * The feature switches proposed, each with its reason; a feature left out is added on. Undefined
   * on a Proposal drafted before Proposals carried them, which proposed none.
   */
  readonly features?: ProposedFeatureSwitches;
  /** The Project added, once the user applied it; undefined before. */
  readonly projectId: string | undefined;
  /** Its Onboard Task, once the user applied it; undefined before. */
  readonly taskId: string | undefined;
}

/**
 * A skill whoever onboards Projects drafted to install from a Source (spec §2.6): the one in
 * `folder` of `repository` at its pinned version, as it was read when drafted. Applying fetches it
 * into the library, off until reviewed, refused once the name is taken or the Source's files
 * changed.
 */
export interface ProposedSkillInstall {
  readonly kind: "skill-install";
  /** As given: `owner/repo` on GitHub, or a git URL. */
  readonly repository: string;
  /** The skill's folder in the repository; empty for its top folder. */
  readonly folder: string;
  readonly pinnedVersion: PinnedVersion;
  readonly name: string;
  readonly description: string;
  /** Its files' paths, in its folder. */
  readonly files: readonly string[];
  readonly filesHash: string;
}

/**
 * An installed skill's update whoever onboards Projects drafted with notes (spec §2.6): from the
 * pinned version the skill had (`from`) to its Source's newer one (`to`), with its files there as
 * read when drafted. Applying is its review: the skill is pinned at `to`, on or off as it was;
 * refused once it moved off `from` or the Source's files changed.
 */
export interface ProposedSkillUpdate {
  readonly kind: "skill-update";
  readonly name: string;
  readonly repository: string;
  readonly folder: string;
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
  /** Its drafter's words on what the update changes. */
  readonly notes: string;
  /** Its files' paths at `to`, in its folder. */
  readonly files: readonly string[];
  readonly filesHash: string;
  /**
   * What it changed in the skill's files, kept as it is applied, so its card shows it once the
   * Source is gone or no longer has those versions.
   */
  readonly appliedDiff?: AppliedSkillDiff;
}

/** A skill update's diff of its folder, cut at a whole line when too long to show. */
export interface AppliedSkillDiff {
  readonly diff: string;
  readonly diffCut: boolean;
}

/**
 * A written skill someone drafted in their chat (spec §2.6): applying adds it to the library as the
 * Write form does, off until the user has reviewed it; refused once the name is taken.
 */
export interface ProposedSkill {
  readonly kind: "skill";
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

/**
 * A call of an Office action its person's Authority rules Proposal (spec 5.4.1 › Office actions):
 * the action by its tool name and `title`, its `input` as the Agent gave it (kept here, never sent
 * to the web), the record it changes, and each field it changes. Applying runs the action's own
 * handler as the user does, once `fingerprint`, of the fields the handler reads and writes as they
 * were at the draft, still matches; when it doesn't, the Proposal is marked `outOfDate`.
 */
export interface ProposedOfficeAction {
  readonly kind: "office-action";
  readonly action: string;
  readonly title: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly subject: { readonly kind: string; readonly id: string; readonly title: string };
  readonly fields: readonly OfficeToolChangedField[];
  readonly fingerprint: string;
  readonly outOfDate: boolean;
  /**
   * The input the user edited before applying (`editedActionInput`), which the handler then runs
   * with; `input` stays as drafted, the fingerprint's own.
   */
  readonly editedInput?: Readonly<Record<string, unknown>>;
}

/** A Stage of a Pipeline, as Pipelines' library keeps it; Conversations doesn't read it. */
export type PipelineStage = object;

/**
 * What a Proposal of a Pipeline does to its routes, each Stage's as they were and as proposed, with
 * the check's answer when drafted, as Pipelines gave it; Conversations doesn't read it.
 */
export type PipelineRoutes = object;

/**
 * Why The Office declined a Proposal on its own (spec §2.2): its Consultation on a Task closed, so
 * no card of it can be opened any more, or the user applied a newer Proposal changing some of the
 * same.
 */
export type ProposalDeclinedBecause =
  | { readonly kind: "consultation-closed" }
  /** Its chat Thread was deleted, which takes the Proposal with it. */
  | { readonly kind: "thread-deleted" }
  | { readonly kind: "superseded"; readonly proposalId: string };

/**
 * Open until a user applies it or declines it; nothing changes before they apply it. `by` is the
 * user who did, null on a Proposal from before users existed and on one The Office declined on its
 * own, which says why (`because`).
 */
export type ProposalStatus =
  | { readonly kind: "open" }
  | { readonly kind: "applied"; readonly at: Date; readonly by: UserRef | null }
  | {
      readonly kind: "declined";
      readonly at: Date;
      readonly by: UserRef | null;
      readonly because?: ProposalDeclinedBecause | undefined;
    };

/**
 * A change a person drafts for the user to confirm with a click (spec §2.2), shown as a card in
 * the Thread it was drafted in. It takes effect only when the user applies it.
 */
export interface Proposal {
  readonly id: string;
  readonly threadId: string;
  /** Who drafted it, by the key of their Role. */
  readonly draftedBy: string;
  readonly draftedAt: Date;
  /** As drafted while open; as applied, with the user's edits, once applied. */
  readonly change: ProposedChange;
  readonly status: ProposalStatus;
}

/**
 * A new Role as the user edited it before hiring: from scratch, its card and skills; from a preset,
 * the person's name.
 */
export type EditedHire =
  | { readonly kind: "hire"; readonly card: RoleCard; readonly skills: readonly string[] }
  | { readonly kind: "hire-from-preset"; readonly name: string }
  | { readonly kind: "action-input"; readonly input: Readonly<Record<string, unknown>> };

/**
 * A change to the Role keyed `roleKey`, whose card is `card` now: the fields of `fields` that
 * differ from the card, each with the card's value as it was then.
 */
export function proposedRoleChange(
  roleKey: string,
  card: RoleCard,
  fields: RoleCardFields,
): ProposedRoleChange {
  const changed = (Object.keys(fields) as (keyof RoleCard)[]).filter(
    (field) => fields[field] !== undefined && !isDeepStrictEqual(fields[field], card[field]),
  );
  return { kind: "change", roleKey, from: fieldsOf(card, changed), to: fieldsOf(fields, changed) };
}

function fieldsOf(source: RoleCardFields, fields: readonly (keyof RoleCard)[]): RoleCardFields {
  // Each entry keeps its own field's value, which Object.fromEntries' type can't say.
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as RoleCardFields;
}

/**
 * Every problem with what is proposed that its owner doesn't judge, in words the drafter acts on.
 */
export function proposedChangeProblems(change: ProposedChange): string[] {
  if (change.kind !== "change") return [];
  return Object.keys(change.to).length === 0
    ? ["Nothing changes: give the fields of the Role card that change, each one whole."]
    : [];
}

/**
 * The change to apply: as drafted, or, for a new Role, as the user edited it before hiring. Refused
 * once the Proposal is applied or declined, and for an edit of anything else.
 */
export function changeToApply(proposal: Proposal, edited: EditedHire | undefined): ProposedChange {
  refuseUnlessOpen(proposal);
  const { change } = proposal;
  if (!edited) return change;
  if (change.kind === "hire" && edited.kind === "hire") {
    return { ...change, card: edited.card, skills: edited.skills };
  }
  if (change.kind === "hire-from-preset" && edited.kind === "hire-from-preset") {
    return { ...change, name: edited.name };
  }
  if (change.kind === "office-action" && edited.kind === "hire") {
    const editedInput = editedActionInput(change, edited);
    if (editedInput) return { ...change, editedInput };
  }
  if (change.kind === "office-action" && edited.kind === "action-input") {
    const editedInput = editedFlowActionInput(change, edited.input);
    if (editedInput) return { ...change, editedInput };
  }
  throw new ProposalRefused(["Only a new Role is edited before hiring, as it was proposed."]);
}

/**
 * The input of a `hire_role` from scratch or a `change_role_card` Proposal with the card the user
 * edited, as the action takes it; undefined for any other Proposal. A change keeps the Role it was
 * drafted for.
 */
function editedActionInput(
  { action, input }: ProposedOfficeAction,
  { card, skills }: Extract<EditedHire, { kind: "hire" }>,
): Record<string, unknown> | undefined {
  // The edited card gives its Authority whole, so the Hard switches the card was drafted with only
  // keep the card whole as the action takes it.
  const drafted = action === "hire_role" ? input["card"] : input;
  const hardSwitches = (drafted as { hardSwitches?: unknown } | undefined)?.hardSwitches;
  const edited = { ...card, hardSwitches, skills: [...skills] };
  if (action === "hire_role" && input["card"] !== undefined) return { card: edited };
  if (action === "change_role_card" && typeof input["key"] === "string") {
    return { ...edited, key: input["key"] };
  }
  return undefined;
}

/** The actions whose Proposals open in the Pipeline or Stage template editor, by what names the record. */
const EDITABLE_IN_LIBRARY_EDITORS: Readonly<Record<string, string | null>> = {
  add_library_pipeline: null,
  change_library_pipeline: "pipelineId",
  add_stage_template: null,
  change_stage_template: "templateId",
};

/** Whether "Edit before applying" opens this action's Proposal in a library editor. */
export function isEditableInLibraryEditor(action: string): boolean {
  return action in EDITABLE_IN_LIBRARY_EDITORS;
}

/**
 * The input of a library Pipeline or Stage template Proposal as the user edited it in the editor;
 * undefined for any other action. A change keeps the record it was drafted for.
 */
function editedFlowActionInput(
  { action, input }: ProposedOfficeAction,
  edited: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  if (!isEditableInLibraryEditor(action)) return undefined;
  const recordKey = EDITABLE_IN_LIBRARY_EDITORS[action];
  return recordKey === null || recordKey === undefined
    ? { ...edited }
    : { ...edited, [recordKey]: input[recordKey] };
}

/**
 * What a Proposal changes, each as a key two Proposals share when they change the same thing: a
 * field of a Role's card, an Office setting, a prompt template, one of a Project's commands, test
 * targets or Actions (each carries only what it changes), a Pipeline, a Stage template, a Project
 * Pipeline or an installed skill's version. None for one that adds something new, edits an
 * Initiative or names some duties, which another Proposal never makes stale; an Office action's
 * Proposal is the record it changes, so a newer one declines the older on the same record.
 */
export function proposalTargets(change: ProposedChange): readonly string[] {
  switch (change.kind) {
    case "change":
      return Object.keys(change.to).map((field) => `role:${change.roleKey}:${field}`);
    case "office-wide-limit":
    case "size-threshold":
    case "office-instructions":
      return [`setting:${change.kind}`];
    case "prompt-template":
      return [`prompt-template:${change.key}`];
    case "project-commands":
      return commandTargets(change.projectId, change.changes);
    case "test-targets":
      return change.changes.targets.map(({ key }) => `test-target:${change.projectId}:${key}`);
    case "actions":
      return change.changes.actions.map(({ key }) => `action:${change.projectId}:${key}`);
    case "pipeline":
      return [`pipeline:${change.pipelineId}`];
    case "stage-template":
      return [`stage-template:${change.templateId}`];
    case "project-pipeline":
      return change.pipelineId === null ? [] : [`project-pipeline:${change.pipelineId}`];
    case "skill-update":
      return [`skill-update:${change.name}`];
    case "office-action":
      return [`office-action:${change.subject.kind}:${change.subject.id}`];
    case "hire":
    case "hire-from-preset":
    case "office-setup":
    case "duties":
    case "initiative":
    case "project":
    case "skill-install":
    case "skill":
      return [];
    // A kind a later release kept, which a rollback reads: no target, so nothing is superseded.
    default:
      return [];
  }
}

/** Each of the Project's fields and commands a Proposal of its commands changes. */
function commandTargets(projectId: string, { commands, ...fields }: ProposedCommands): string[] {
  return [
    ...Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => `project-commands:${projectId}:${field}`),
    ...commands.map(({ key }) => `project-command:${projectId}:${key}`),
  ];
}

/** Refuses a change of a Proposal the user applied or declined already. */
export function refuseUnlessOpen({ status }: Proposal): void {
  if (status.kind === "applied") throw new ProposalRefused(["This Proposal is applied already."]);
  if (status.kind === "declined") throw new ProposalRefused(["This Proposal was declined."]);
}
