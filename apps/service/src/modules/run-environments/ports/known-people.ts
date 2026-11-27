/** A person who fills a Role, as a Project setting change records them. */
export interface KnownPerson {
  readonly card: { readonly name: string; readonly title: string };
}

/**
 * The people who fill Roles, whom the People module keeps, for the change "Set up run environment"
 * records when a person turns it On. Bound to People's `RoleCards` in app.module.ts.
 */
export abstract class KnownPeople {
  /** Undefined when nobody fills the Role. */
  abstract find(roleKey: string): Promise<KnownPerson | undefined>;
}
