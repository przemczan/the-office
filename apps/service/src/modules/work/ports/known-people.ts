/** The people Work's use cases turn to, which the People module keeps; the composition root binds it. */
export abstract class KnownPeople {
  /** Who fills the Role, or undefined when nobody does. */
  abstract find(roleKey: string): Promise<{ readonly roleKey: string } | undefined>;
}
