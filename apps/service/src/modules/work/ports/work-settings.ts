/** The Office settings Work's rules read; Settings edits them (task 17). */
export abstract class WorkSettings {
  /** How many Tasks may be started at once across The Office. */
  abstract officeWideLimit(): Promise<number>;
}
