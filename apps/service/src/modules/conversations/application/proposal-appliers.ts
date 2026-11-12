import { Injectable } from "@nestjs/common";
import type {
  OfficeSetting,
  OfficeSettingValues,
  ProposedChange,
  ProposedChangeKind,
  ProposedChanges,
} from "../domain/proposal.js";

/**
 * How the module that owns a kind of change sees to Proposals of it: what is wrong with one as it
 * is drafted, and carrying it out when the user applies it.
 */
export interface ProposalApplier<Kind extends ProposedChangeKind> {
  /** Every reason applying the change would be refused now, in words the drafter acts on. */
  problemsWith(change: ProposedChanges[Kind]): Promise<readonly string[]>;
  /**
   * Carries the change out for the user, as proposed by the person `proposedBy` (their Role's
   * key), and answers it as applied. Throws ProposalRefused, changing nothing, when it can't.
   */
  apply(change: ProposedChanges[Kind], proposedBy: string): Promise<ProposedChanges[Kind]>;
}

/** How the module that owns an Office setting sees to Proposals of it, and the value it has now. */
export interface SettingProposalApplier<
  Setting extends OfficeSetting,
> extends ProposalApplier<Setting> {
  valueNow(): Promise<OfficeSettingValues[Setting]>;
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
      case "initiative":
        return this.applierOf("initiative").problemsWith(change);
      case "project-commands":
        return this.applierOf("project-commands").problemsWith(change);
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

  apply(change: ProposedChange, proposedBy: string): Promise<ProposedChange> {
    switch (change.kind) {
      case "hire":
        return this.applierOf("hire").apply(change, proposedBy);
      case "hire-from-preset":
        return this.applierOf("hire-from-preset").apply(change, proposedBy);
      case "change":
        return this.applierOf("change").apply(change, proposedBy);
      case "office-wide-limit":
        return this.applierOf("office-wide-limit").apply(change, proposedBy);
      case "size-threshold":
        return this.applierOf("size-threshold").apply(change, proposedBy);
      case "office-instructions":
        return this.applierOf("office-instructions").apply(change, proposedBy);
      case "initiative":
        return this.applierOf("initiative").apply(change, proposedBy);
      case "project-commands":
        return this.applierOf("project-commands").apply(change, proposedBy);
      case "pipeline":
        return this.applierOf("pipeline").apply(change, proposedBy);
      case "stage-template":
        return this.applierOf("stage-template").apply(change, proposedBy);
      case "project-pipeline":
        return this.applierOf("project-pipeline").apply(change, proposedBy);
      case "project":
        return this.applierOf("project").apply(change, proposedBy);
      case "skill-install":
        return this.applierOf("skill-install").apply(change, proposedBy);
      case "skill-update":
        return this.applierOf("skill-update").apply(change, proposedBy);
      case "skill":
        return this.applierOf("skill").apply(change, proposedBy);
    }
  }

  private applierOf<Kind extends ProposedChangeKind>(kind: Kind): ProposalApplier<Kind> {
    const applier = this.appliers[kind];
    if (!applier) throw new Error(`Nothing applies Proposals of "${kind}".`);
    return applier;
  }
}
