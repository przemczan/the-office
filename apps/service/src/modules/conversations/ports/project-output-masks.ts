/** Hides text in what a session writes into its Thread. */
export interface TextMask {
  mask(text: string): string;
}

/** Shows text as it is: a session with no Project has no Secret variables. */
export const NO_MASK: TextMask = { mask: (text) => text };

/**
 * Each Project's Secret variables, hidden in what a session on one of its Tasks writes into a
 * Thread (spec §6), which the Projects module keeps; the composition root binds it.
 */
export abstract class ProjectOutputMasks {
  abstract outputMaskOf(projectId: string): Promise<TextMask>;
}
