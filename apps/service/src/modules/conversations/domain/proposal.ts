import { isDeepStrictEqual } from "node:util";
import type { DutyKey, RoleCard } from "../../people/index.js";
import type { NewProject, ProposedCommands } from "../../projects/index.js";
import type { PinnedVersion } from "../../skills/index.js";
import { ProposalRefused } from "./proposal-refused.js";

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
  readonly initiative: ProposedInitiativeChange;
  readonly "project-commands": ProposedProjectCommands;
  readonly pipeline: ProposedPipelineChange;
  readonly "stage-template": ProposedStageTemplateChange;
  readonly "project-pipeline": ProposedProjectPipelineChange;
  readonly project: ProposedProject;
  readonly "skill-install": ProposedSkillInstall;
  readonly "skill-update": ProposedSkillUpdate;
  readonly skill: ProposedSkill;
}

/** The kinds of change a Proposal can carry. */
export type ProposedChangeKind = keyof ProposedChanges;

/** What a Proposal changes. */
export type ProposedChange = ProposedChanges[ProposedChangeKind];

/** The fields of a Role card a change rewrites, each one given whole. */
export type RoleCardFields = Partial<RoleCard>;

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

/** `holders` cut to the duties `named` names, as a Proposal of them starts from. */
export function holdersNamedIn(holders: DutyHolders, named: DutyHolders): DutyHolders {
  return Object.fromEntries(
    Object.entries(holders).filter(([duty]) => Object.hasOwn(named, duty)),
  ) as DutyHolders;
}

export type OfficeSetting = keyof OfficeSettingValues;

/** The Office settings a Proposal can change, each applied by the module that owns it. */
export const OFFICE_SETTINGS = [
  "office-wide-limit",
  "size-threshold",
  "office-instructions",
  "duties",
] as const satisfies readonly OfficeSetting[];

/** A new value for an Office setting (`to`), and its value when the Proposal was drafted (`from`). */
export type ProposedSettingChange<Setting extends OfficeSetting = OfficeSetting> = {
  readonly [Kind in Setting]: {
    readonly kind: Kind;
    readonly from: OfficeSettingValues[Kind];
    readonly to: OfficeSettingValues[Kind];
  };
}[Setting];

/** A new value for an Office setting, as the person drafting it gives it. */
export type ProposedSettingValue = {
  readonly [Setting in OfficeSetting]: {
    readonly setting: Setting;
    readonly value: OfficeSettingValues[Setting];
  };
}[OfficeSetting];

/**
 * A change the CTO wants to an active Initiative (spec §2.1 Defaults), which Work applies under the
 * Initiative's hold, refusing it once the Initiative is done or dropped.
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
 * Devops' change to a Project's install command, install inputs and commands (spec §2.3): each
 * field as the Project had it when drafted, and as proposed. Projects refuses to apply it once one
 * of them changed.
 */
export interface ProposedProjectCommands {
  readonly kind: "project-commands";
  readonly projectId: string;
  readonly changes: ProposedCommands;
}

/**
 * Devops' new Stages for a library Pipeline (spec §2.3), and its Stages when drafted (`from`);
 * Pipelines refuses to apply it once they changed. Conversations keeps the Stages as Pipelines
 * gave them, without reading them, since Pipelines calls Conversations.
 */
export interface ProposedPipelineChange {
  readonly kind: "pipeline";
  readonly pipelineId: string;
  readonly from: readonly PipelineStage[];
  readonly to: readonly PipelineStage[];
}

/**
 * Devops' new Stage for a Stage template (spec §2.3), and its Stage when drafted (`from`);
 * Pipelines refuses to apply it once it changed. Kept unread, as a Pipeline's Stages are.
 */
export interface ProposedStageTemplateChange {
  readonly kind: "stage-template";
  readonly templateId: string;
  readonly from: PipelineStage;
  readonly to: PipelineStage;
}

/**
 * Devops' new Project Pipeline, or its change to one (spec §2.3): the fields as the Project Pipeline
 * had them when drafted (`from`, null for a new one), and as proposed (`to`). Pipelines refuses to
 * apply it once one of them changed; a Proposal never removes one or sets a Project's default.
 */
export interface ProposedProjectPipelineChange {
  readonly kind: "project-pipeline";
  readonly projectId: string;
  /** The Project Pipeline it changes; null for a new one until the user applied it. */
  readonly pipelineId: string | null;
  readonly from: ProjectPipelineFields | null;
  readonly to: ProjectPipelineFields;
}

/** What a Proposal of a Project Pipeline gives it, its Stage changes kept unread as its Stages are. */
export interface ProjectPipelineFields {
  readonly name: string;
  readonly description: string;
  readonly basePipelineId: string;
  readonly stageChanges: readonly PipelineStageChange[];
}

/**
 * A Project Devops drafted to onboard (spec §2.1 Defaults): applying it adds the Project and its
 * Onboard Task, Ready on the Onboard Pipeline.
 */
export interface ProposedProject {
  readonly kind: "project";
  readonly project: NewProject;
  /** The Project added, once the user applied it; undefined before. */
  readonly projectId: string | undefined;
  /** Its Onboard Task, once the user applied it; undefined before. */
  readonly taskId: string | undefined;
}

/**
 * A skill Devops drafted to install from a Source (spec §2.6): the one in `folder` of `repository`
 * at its pinned version, as it was read when drafted. Applying fetches it into the library, off
 * until reviewed, refused once the name is taken or the Source's files changed.
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
 * An installed skill's update Devops drafted with notes (spec §2.6): from the pinned version the
 * skill had (`from`) to its Source's newer one (`to`), with its files there as read when drafted.
 * Applying is its review: the skill is pinned at `to`, on or off as it was; refused once it moved
 * off `from` or the Source's files changed.
 */
export interface ProposedSkillUpdate {
  readonly kind: "skill-update";
  readonly name: string;
  readonly repository: string;
  readonly folder: string;
  readonly from: PinnedVersion;
  readonly to: PinnedVersion;
  /** Devops' words on what the update changes. */
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

/** A Stage of a Pipeline, as Pipelines' library keeps it; Conversations doesn't read it. */
export type PipelineStage = object;

/** A Stage change of a Project Pipeline, as Pipelines keeps it; Conversations doesn't read it. */
export type PipelineStageChange = object;

/** Open until the user applies it or declines it; nothing changes before they apply it. */
export type ProposalStatus =
  | { readonly kind: "open" }
  | { readonly kind: "applied"; readonly at: Date }
  | { readonly kind: "declined"; readonly at: Date };

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
  | { readonly kind: "hire-from-preset"; readonly name: string };

/**
 * A change to the Role keyed `roleKey`, whose card is `card` now: the fields of `fields` that differ
 * from the card, each with the card's value as it was then.
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

/** Every problem with what is proposed that its owner doesn't judge, in words the drafter acts on. */
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
  throw new ProposalRefused(["Only a new Role is edited before hiring, as it was proposed."]);
}

/** Refuses a change of a Proposal the user applied or declined already. */
export function refuseUnlessOpen({ status }: Proposal): void {
  if (status.kind === "applied") throw new ProposalRefused(["This Proposal is applied already."]);
  if (status.kind === "declined") throw new ProposalRefused(["This Proposal was declined."]);
}
