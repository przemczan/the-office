/** The base branch tip's `.devcontainer/`, written out for one pairing environment. */
export interface PairingDefinition {
  /** A temporary folder holding the definition and nothing else. */
  readonly folder: string;
  /** Removes the folder; never throws. */
  remove(): Promise<void>;
}

/** What a Project device's pairing environment is made from (spec §5.5, "A pairing environment"). */
export abstract class PairingDefinitions {
  /** Every reason it can't be written out, in the UI's words, or the definition. */
  abstract exportDefinition(
    projectId: string,
  ): Promise<PairingDefinition | { readonly problems: readonly string[] }>;
}
