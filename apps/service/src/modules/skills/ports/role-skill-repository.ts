import type {
  AssignmentsChange,
  RoleSkillAssignment,
  RoleSkillsChange,
} from "../domain/role-skills.js";

/** Where the library's skills are assigned to Roles, with each Role's changes. */
export abstract class RoleSkillRepository {
  /** Every assignment, of every Role. */
  abstract list(): Promise<readonly RoleSkillAssignment[]>;

  /**
   * Applies `change` to every assignment as stored, holding them against other changes until the
   * result and its changes are saved, so two changes at once never lose one.
   */
  abstract update(
    change: (assignments: readonly RoleSkillAssignment[]) => AssignmentsChange,
  ): Promise<AssignmentsChange>;

  /** The Role's changes, newest first. */
  abstract changes(roleKey: string): Promise<readonly RoleSkillsChange[]>;
}
