/** The Project settings whose changes are recorded (spec §6, "Project settings by Agents"). */
export type ProjectSetting =
  "run-environment" | "commands" | "environment" | "test-targets" | "actions";

/** A user, as a change records them. */
export interface SettingChangeUser {
  readonly userId: string;
  readonly name: string;
}

/**
 * Who changed a Project setting: a user on the Project page, a Proposal a user applied, or a person
 * through their Office tools on a Task. Callers only build it; Projects records it.
 */
export type SettingChangedBy =
  | { readonly kind: "user"; readonly user: SettingChangeUser }
  | {
      readonly kind: "proposal";
      readonly proposalId: string;
      /** Null for a Proposal applied before users existed. */
      readonly user: SettingChangeUser | null;
    }
  | {
      readonly kind: "person";
      readonly roleKey: string;
      readonly name: string;
      readonly title: string;
      /** The Task whose Thread the person changed it from; none from a chat. */
      readonly taskId?: string;
      /** The user who asked the person for the change, where their Thread has one. */
      readonly askedBy?: SettingChangeUser;
      /** The user whose Allow once let the person's call run, where it was held for approval. */
      readonly allowedBy?: SettingChangeUser;
    };

/**
 * One recorded change. The summary is a phrase that follows who made it ("turned Run environment
 * On", "changed the command test"), and never holds a Secret variable's value, only names.
 */
export interface ProjectSettingChange {
  readonly id: string;
  readonly projectId: string;
  readonly setting: ProjectSetting;
  readonly summary: string;
  readonly by: SettingChangedBy;
  readonly at: Date;
}

/** What a setting's change records, before it is saved with the change. */
export interface SettingChangeToRecord {
  readonly setting: ProjectSetting;
  readonly summary: string;
  readonly by: SettingChangedBy;
}
