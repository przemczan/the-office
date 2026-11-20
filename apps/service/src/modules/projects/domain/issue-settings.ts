/** A user as an issue record keeps them: their id and their name as it was then. */
export interface IssueUser {
  readonly userId: string;
  readonly name: string;
}

/** A Project's GitHub issue switches (spec §2.3). */
export interface IssueSettings {
  /** The label whose open issues The Office imports by itself; null leaves the auto-import off. */
  readonly autoImportLabel: string | null;
  /** The user who set the label, named as the creator of the Tasks the auto-import makes. */
  readonly autoImportLabelSetBy: IssueUser | null;
  /** Close the issue when its Task is Done (with `Fixes #n` in what Publish lands). */
  readonly closeOnDone: boolean;
  /** Comment on the issue when its Task starts and when it is Done. */
  readonly commentOnStartAndDone: boolean;
  /** Close the issue when its Task is Dropped. */
  readonly closeOnDrop: boolean;
}

/** A Project's issue switches until the user changes them: no auto-import, close on Done only. */
export const DEFAULT_ISSUE_SETTINGS: IssueSettings = {
  autoImportLabel: null,
  autoImportLabelSetBy: null,
  closeOnDone: true,
  commentOnStartAndDone: false,
  closeOnDrop: false,
};

/** What the user sets of the switches: who set the label is the change's own. */
export type IssueSettingsChange = Omit<IssueSettings, "autoImportLabelSetBy">;
