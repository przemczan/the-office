import type { TaskLimit } from "../domain/task-start.js";

/** The people Work's use cases turn to, which the People module keeps; the composition root binds it. */
export abstract class KnownPeople {
  /** Who fills the Role, or undefined when nobody does. */
  abstract find(roleKey: string): Promise<KnownPerson | undefined>;
}

export interface KnownPerson {
  readonly roleKey: string;
  readonly card: { readonly name: string; readonly taskLimit: TaskLimit };
}
