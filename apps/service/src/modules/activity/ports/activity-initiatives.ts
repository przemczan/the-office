/** The Initiatives, which Work keeps; the composition root binds it. */
export abstract class ActivityInitiatives {
  /** The Initiatives of these ids that Work knows, each with its title. */
  abstract titlesOf(
    ids: readonly string[],
  ): Promise<readonly { readonly initiativeId: string; readonly title: string }[]>;
}
