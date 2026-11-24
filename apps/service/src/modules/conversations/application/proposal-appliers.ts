import { Injectable } from "@nestjs/common";
import type { BugTaskFields } from "../domain/decision.js";
import type { UserRef } from "../domain/user.js";
import type {
  OfficeSetting,
  OfficeSettingValues,
  ProposedChange,
  ProposedChangeKind,
  ProposedChanges,
} from "../domain/proposal.js";

/**
 * How the module that owns a kind of change sees to Proposals of it: what is wrong with one as it
 * is drafted, carrying it out when the user applies it, and, for a kind whose kept shape changed, how
 * its card shows one a previous release kept.
 */
export interface ProposalApplier<Kind extends ProposedChangeKind> {
  /** Every reason applying the change would be refused now, in words the drafter acts on. */
  problemsWith(change: ProposedChanges[Kind]): Promise<readonly string[]>;
  /**
   * Carries the change out for the user `appliedBy`, as proposed by the person `proposedBy` (their
   * Role's key), and answers it as applied. `proposalId` is the Proposal's own, for an applier that
   * records which Proposal set what; undefined when applied apart from a stored Proposal. Throws
   * ProposalRefused, changing nothing, when it can't.
   */
  apply(
    change: ProposedChanges[Kind],
    proposedBy: string,
    appliedBy: UserRef,
    proposalId?: string,
  ): Promise<ProposedChanges[Kind]>;
  /**
   * The change as its card shows it: one a previous release kept read as this release reads it, as
   * applying it does. Absent when every kept change reads as it is.
   */
  shown?(change: ProposedChanges[Kind]): ProposedChanges[Kind];
}

/** How the module that owns an Office setting sees to Proposals of it, and the value it has now. */
export interface SettingProposalApplier<
  Setting extends OfficeSetting,
> extends ProposalApplier<Setting> {
  valueNow(): Promise<OfficeSettingValues[Setting]>;
}

/** The Bug Task created from a bug-task Decision. */
export interface CreatedBugTask {
  readonly id: string;
  readonly title: string;
}

/**
 * How Work sees to a Bug Task an Agent proposes from a Stage (`propose_bug_task`): the Project of
 * the Agent's Task, which the proposal starts in; every problem with it as proposed; and creating
 * it when the user answers Create the Bug Task.
 */
export interface BugTaskApplier {
  /** The Task's Project, by its id; undefined when there is no such Task. */
  projectOf(taskId: string): Promise<string | undefined>;
  /** Every reason creating it would be refused now, such as an unknown Project or Task. */
  problemsWith(task: BugTaskFields): Promise<readonly string[]>;
  /**
   * Creates the Bug Task in Backlog, created by The Office for the user `createdBy`, found while
   * working on the Task `foundWhileWorkingOn`. Throws ProposalRefused, creating nothing, when it
   * can't.
   */
  create(
    task: BugTaskFields,
    foundWhileWorkingOn: string,
    createdBy: UserRef | null,
  ): Promise<CreatedBugTask>;
}

type Appliers = { [Kind in ProposedChangeKind]?: ProposalApplier<Kind> };
type SettingAppliers = { [Setting in OfficeSetting]?: SettingProposalApplier<Setting> };

/**
 * Who applies each kind of Proposal: the module that owns what it changes registers as it starts,
 * as modules give the Engine their Office tools. Conversations calls People itself; a module that
 * calls Conversations, such as Work, fills its kinds in here instead (module template).
 */
@Injectable()
export class ProposalAppliers {
  private readonly appliers: Appliers = {};
  private readonly settings: SettingAppliers = {};
  private bugTasks: BugTaskApplier | undefined;

  register<Kind extends ProposedChangeKind>(kind: Kind, applier: ProposalApplier<Kind>): void {
    if (this.appliers[kind]) throw new Error(`Proposals of "${kind}" have an applier already.`);
    // TypeScript writes to an entry keyed by a generic kind as if it were every kind at once.
    this.appliers[kind] = applier as Appliers[Kind];
  }

  /** As `register`, for an Office setting, whose value now a Proposal of it starts from. */
  registerSetting<Setting extends OfficeSetting>(
    setting: Setting,
    applier: SettingProposalApplier<Setting>,
  ): void {
    this.register(setting, applier);
    this.settings[setting] = applier as SettingAppliers[Setting];
  }

  /**
   * Registers who creates the Bug Tasks Agents propose: Work, as it starts. Proposed in a
   * bug-task Decision rather than a Proposal, a Bug Task is no ProposedChange.
   */
  registerBugTask(applier: BugTaskApplier): void {
    if (this.bugTasks) throw new Error("Bug Tasks have an applier already.");
    this.bugTasks = applier;
  }

  /** Who creates the Bug Tasks Agents propose. */
  bugTask(): BugTaskApplier {
    if (!this.bugTasks) throw new Error("Nothing creates proposed Bug Tasks.");
    return this.bugTasks;
  }

  /** The Office setting's value now, as the module that owns it keeps it. */
  settingNow<Setting extends OfficeSetting>(
    setting: Setting,
  ): Promise<OfficeSettingValues[Setting]> {
    const applier = this.settings[setting];
    if (!applier) throw new Error(`Nothing applies Proposals of "${setting}".`);
    return applier.valueNow();
  }

  problemsWith(change: ProposedChange): Promise<readonly string[]> {
    switch (change.kind) {
      case "hire":
        return this.applierOf("hire").problemsWith(change);
      case "hire-from-preset":
        return this.applierOf("hire-from-preset").problemsWith(change);
      case "change":
        return this.applierOf("change").problemsWith(change);
      case "office-wide-limit":
        return this.applierOf("office-wide-limit").problemsWith(change);
      case "size-threshold":
        return this.applierOf("size-threshold").problemsWith(change);
      case "office-instructions":
        return this.applierOf("office-instructions").problemsWith(change);
      case "duties":
        return this.applierOf("duties").problemsWith(change);
      case "prompt-template":
        return this.applierOf("prompt-template").problemsWith(change);
      case "office-setup":
        return this.applierOf("office-setup").problemsWith(change);
      case "initiative":
        return this.applierOf("initiative").problemsWith(change);
      case "project-commands":
        return this.applierOf("project-commands").problemsWith(change);
      case "test-targets":
        return this.applierOf("test-targets").problemsWith(change);
      case "actions":
        return this.applierOf("actions").problemsWith(change);
      case "pipeline":
        return this.applierOf("pipeline").problemsWith(change);
      case "stage-template":
        return this.applierOf("stage-template").problemsWith(change);
      case "project-pipeline":
        return this.applierOf("project-pipeline").problemsWith(change);
      case "project":
        return this.applierOf("project").problemsWith(change);
      case "skill-install":
        return this.applierOf("skill-install").problemsWith(change);
      case "skill-update":
        return this.applierOf("skill-update").problemsWith(change);
      case "skill":
        return this.applierOf("skill").problemsWith(change);
    }
  }

  apply(
    change: ProposedChange,
    proposedBy: string,
    appliedBy: UserRef,
    proposalId?: string,
  ): Promise<ProposedChange> {
    switch (change.kind) {
      case "hire":
        return this.applierOf("hire").apply(change, proposedBy, appliedBy);
      case "hire-from-preset":
        return this.applierOf("hire-from-preset").apply(change, proposedBy, appliedBy);
      case "change":
        return this.applierOf("change").apply(change, proposedBy, appliedBy);
      case "office-wide-limit":
        return this.applierOf("office-wide-limit").apply(change, proposedBy, appliedBy);
      case "size-threshold":
        return this.applierOf("size-threshold").apply(change, proposedBy, appliedBy);
      case "office-instructions":
        return this.applierOf("office-instructions").apply(change, proposedBy, appliedBy);
      case "duties":
        return this.applierOf("duties").apply(change, proposedBy, appliedBy);
      case "prompt-template":
        return this.applierOf("prompt-template").apply(change, proposedBy, appliedBy);
      case "office-setup":
        return this.applierOf("office-setup").apply(change, proposedBy, appliedBy);
      case "initiative":
        return this.applierOf("initiative").apply(change, proposedBy, appliedBy);
      case "project-commands":
        return this.applierOf("project-commands").apply(change, proposedBy, appliedBy);
      case "test-targets":
        return this.applierOf("test-targets").apply(change, proposedBy, appliedBy, proposalId);
      case "actions":
        return this.applierOf("actions").apply(change, proposedBy, appliedBy, proposalId);
      case "pipeline":
        return this.applierOf("pipeline").apply(change, proposedBy, appliedBy);
      case "stage-template":
        return this.applierOf("stage-template").apply(change, proposedBy, appliedBy);
      case "project-pipeline":
        return this.applierOf("project-pipeline").apply(change, proposedBy, appliedBy);
      case "project":
        return this.applierOf("project").apply(change, proposedBy, appliedBy);
      case "skill-install":
        return this.applierOf("skill-install").apply(change, proposedBy, appliedBy);
      case "skill-update":
        return this.applierOf("skill-update").apply(change, proposedBy, appliedBy);
      case "skill":
        return this.applierOf("skill").apply(change, proposedBy, appliedBy);
    }
  }

  /**
   * The change as its card shows it, by the module that owns its kind: Pipelines reads the Stages
   * and routes of a Proposal a previous release kept as it applies them, a Stage template's Stage
   * among them.
   */
  shown(change: ProposedChange): ProposedChange {
    switch (change.kind) {
      case "pipeline":
        return this.appliers.pipeline?.shown?.(change) ?? change;
      case "stage-template":
        return this.appliers["stage-template"]?.shown?.(change) ?? change;
      case "project-pipeline":
        return this.appliers["project-pipeline"]?.shown?.(change) ?? change;
      default:
        return change;
    }
  }

  private applierOf<Kind extends ProposedChangeKind>(kind: Kind): ProposalApplier<Kind> {
    const applier = this.appliers[kind];
    if (!applier) throw new Error(`Nothing applies Proposals of "${kind}".`);
    return applier;
  }
}
